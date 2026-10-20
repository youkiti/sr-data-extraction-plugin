import type { Decision } from '../../domain/decision';
import type { Evidence } from '../../domain/evidence';
import type { SchemaField } from '../../domain/schemaField';
import type { ExtractionRun } from '../../domain/extractionRun';
import { deriveCellStates } from './cellState';
import { bundleEvidence } from './evidenceBundles';

export type PilotCellStatus = 'accept' | 'edit' | 'reject' | 'nrAccepted' | 'nrMiss' | 'nr' | 'failed' | 'unverified' | 'empty';
export const PILOT_SYMBOLS: Record<PilotCellStatus, string> = {
  accept: '✓', edit: '✎', reject: '✗', nrAccepted: 'NR✓', nrMiss: 'NR✗',
  nr: 'NR', failed: '⚠', unverified: '·', empty: '',
};
export interface PilotEntity {
  evidence: Evidence;
  decision: Decision | null;
  status: PilotCellStatus;
  /** 外れの候補（未判定のアンカリング失敗を含む。項目編集欄の参考情報に使う） */
  miss: boolean;
}
// 外れの数と割合は、人が判定したものだけで数える（issue #381）。未判定（未判定のアンカリング失敗を
// 含む）は「外れ 0」と読めないように分母から外し、未判定の件数として別に示す
export interface PilotMatrixCell {
  studyId: string;
  entities: PilotEntity[];
  /** 判定済みで外れた entity の数 */
  misses: number;
  /** 判定済みの entity の数 */
  judged: number;
  /** 未判定の entity の数 */
  pending: number;
  status: PilotCellStatus;
}
export interface PilotMatrixRow {
  field: SchemaField;
  cells: PilotMatrixCell[];
  misses: number;
  missedStudies: number;
  /** 外れた論文と、抽出がある entity をすべて判定した論文（割合の分母） */
  judgedStudies: number;
  /** 抽出はあるが判定が済んでいない論文（外れた論文を除く） */
  pendingStudies: number;
  extractedStudies: number;
  decided: number;
}

/** 判定は検証 UI と同じ undo スタックで畳み込む。呼び出し元で本人の判定だけに絞る。 */
export function buildPilotMatrix(
  studyIds: readonly string[], fields: readonly SchemaField[],
  evidence: readonly Evidence[], decisions: readonly Decision[],
): PilotMatrixRow[] {
  const byStudy = new Map(studyIds.map((studyId) => {
    const states = deriveCellStates(decisions.filter((item) => item.studyId === studyId));
    const entities = [...bundleEvidence(evidence.filter((item) => item.studyId === studyId))]
      .map(([key, bundle]): PilotEntity => {
        const stack = states.get(key)?.stack ?? [];
        const decision = stack[stack.length - 1] ?? null;
        let status: PilotCellStatus;
        if (decision !== null) {
          status = decision.action === 'not_reported'
            ? (bundle.evidence.notReported ? 'nrAccepted' : 'nrMiss')
            : decision.action as 'accept' | 'edit' | 'reject';
        } else if (bundle.evidence.notReported) {
          status = 'nr';
        } else {
          // 複数引用にセル単位の失敗規則がないため、全引用の失敗だけを外れとする。
          const quotes = bundle.quotes.length > 0 ? bundle.quotes : [bundle.evidence];
          status = quotes.every((quote) => quote.anchorStatus === 'failed') ? 'failed' : 'unverified';
        }
        return { evidence: bundle.evidence, decision, status,
          miss: ['edit', 'reject', 'nrMiss', 'failed'].includes(status) };
      });
    return [studyId, entities] as const;
  }));
  return [...fields].sort((a, b) => a.fieldIndex - b.fieldIndex).map((field) => {
    const cells = [...byStudy].map(([studyId, all]): PilotMatrixCell => {
      const entities = all.filter((item) => item.evidence.fieldId === field.fieldId);
      const judged = entities.filter((item) => item.decision !== null);
      return { studyId, entities, misses: judged.filter((item) => item.miss).length,
        judged: judged.length, pending: entities.length - judged.length,
        status: entities[0]?.status ?? 'empty' };
    });
    const extracted = cells.filter((cell) => cell.entities.length > 0);
    const judgedStudies = extracted.filter((cell) => cell.misses > 0 || cell.pending === 0).length;
    return { field, cells, misses: cells.reduce((n, cell) => n + cell.misses, 0),
      missedStudies: cells.filter((cell) => cell.misses > 0).length,
      judgedStudies, pendingStudies: extracted.length - judgedStudies,
      extractedStudies: extracted.length,
      decided: cells.flatMap((cell) => cell.entities).filter((item) => item.decision !== null).length };
  });
}

export function sortPilotMatrix(rows: readonly PilotMatrixRow[]): PilotMatrixRow[] {
  return [...rows].sort((a, b) =>
    b.missedStudies / (b.judgedStudies || 1) - a.missedStudies / (a.judgedStudies || 1)
    || b.misses - a.misses || a.field.fieldIndex - b.field.fieldIndex);
}

export type PilotComparison = 'improved' | 'worsened' | 'unchanged' | 'unavailable';
export function comparePilotRows(current: PilotMatrixRow, previous?: PilotMatrixRow): PilotComparison {
  // 判定済みの論文だけで比べる（issue #381）
  if (!previous || previous.judgedStudies === 0 || current.judgedStudies === 0) {
    return 'unavailable';
  }
  const difference = current.missedStudies * previous.judgedStudies - previous.missedStudies * current.judgedStudies;
  return difference < 0 ? 'improved' : difference > 0 ? 'worsened' : 'unchanged';
}

/** 判定には runId がない。同じ版・同じ study の再実行では今回開始前の履歴を前回とする。 */
export function previousPilotDecisions(
  current: ExtractionRun, previous: ExtractionRun, decisions: readonly Decision[],
): Decision[] {
  return decisions.filter((decision) => decision.schemaVersion === previous.schemaVersion
    && (current.schemaVersion !== previous.schemaVersion || !current.studyIds.includes(decision.studyId)
      || (current.startedAt !== null && decision.decidedAt < current.startedAt)));
}
