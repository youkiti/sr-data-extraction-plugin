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
  miss: boolean;
}
export interface PilotMatrixCell {
  studyId: string;
  entities: PilotEntity[];
  misses: number;
  status: PilotCellStatus;
}
export interface PilotMatrixRow {
  field: SchemaField;
  cells: PilotMatrixCell[];
  misses: number;
  missedStudies: number;
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
      return { studyId, entities, misses: entities.filter((item) => item.miss).length,
        status: entities[0]?.status ?? 'empty' };
    });
    return { field, cells, misses: cells.reduce((n, cell) => n + cell.misses, 0),
      missedStudies: cells.filter((cell) => cell.misses > 0).length,
      extractedStudies: cells.filter((cell) => cell.entities.length > 0).length,
      decided: cells.flatMap((cell) => cell.entities).filter((item) => item.decision !== null).length };
  });
}

export function sortPilotMatrix(rows: readonly PilotMatrixRow[]): PilotMatrixRow[] {
  return [...rows].sort((a, b) =>
    b.missedStudies / (b.extractedStudies || 1) - a.missedStudies / (a.extractedStudies || 1)
    || b.misses - a.misses || a.field.fieldIndex - b.field.fieldIndex);
}

export type PilotComparison = 'improved' | 'worsened' | 'unchanged' | 'unavailable';
export function comparePilotRows(current: PilotMatrixRow, previous?: PilotMatrixRow): PilotComparison {
  if (!previous || previous.extractedStudies === 0 || current.decided === 0 || previous.decided === 0) {
    return 'unavailable';
  }
  const difference = current.missedStudies * previous.extractedStudies - previous.missedStudies * current.extractedStudies;
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
