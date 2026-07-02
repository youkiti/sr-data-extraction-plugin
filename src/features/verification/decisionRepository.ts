// Decisions タブ I/O（requirements.md §3.1: 追記のみ・上書き禁止）。
// 判定 1 操作 = 1 行で追記し、undo も 1 行として残す（§4.2 の監査証跡）。
// 現在のセル状態は cellState.ts が判定履歴の畳み込みで導出する
import type { AnnotatorType } from '../../domain/annotation';
import type { Decision, DecisionAction } from '../../domain/decision';
import { SHEET_HEADERS } from '../../domain/sheetsSchema';
import { appendRows, getSheetValues } from '../../lib/google/sheets';
import type { GoogleApiDeps } from '../../lib/google/types';

const DECISIONS_TAB = 'Decisions';

const DECISION_ACTIONS: readonly DecisionAction[] = [
  'accept',
  'edit',
  'reject',
  'not_reported',
  'undo',
];

const ANNOTATOR_TYPES: readonly AnnotatorType[] = [
  'ai',
  'human_with_ai',
  'human_independent',
  'consensus',
];

/** Sheets の values はラグ配列（末尾の空セルが落ちる）。欠けたセルは空文字として読む */
function cellAt(row: readonly string[], index: number): string {
  return row[index] ?? '';
}

function emptyToNull(value: string): string | null {
  return value === '' ? null : value;
}

/** Decision → シート行。列順は SHEET_HEADERS.Decisions（domain/sheetsSchema.ts）に対応 */
export function decisionToRow(decision: Decision): (string | number | null)[] {
  return [
    decision.decidedAt,
    decision.decidedBy,
    decision.documentId,
    decision.fieldId,
    decision.entityKey,
    decision.annotator,
    decision.annotatorType,
    decision.schemaVersion,
    decision.action,
    decision.value,
    decision.note,
  ];
}

/**
 * Decisions をまとめて追記する。空配列は no-op。
 * 追記のみで更新 API は提供しない（追記型タブ。取り消しは action=undo の追記で表現する）
 */
export async function appendDecisionRows(
  spreadsheetId: string,
  decisions: readonly Decision[],
  deps: GoogleApiDeps,
): Promise<void> {
  await appendRows(spreadsheetId, DECISIONS_TAB, decisions.map(decisionToRow), deps);
}

function parseAction(value: string, context: string): DecisionAction {
  if ((DECISION_ACTIONS as readonly string[]).includes(value)) {
    return value as DecisionAction;
  }
  throw new Error(`${context}: action "${value}" が不正です`);
}

function parseAnnotatorType(value: string, context: string): AnnotatorType {
  if ((ANNOTATOR_TYPES as readonly string[]).includes(value)) {
    return value as AnnotatorType;
  }
  throw new Error(`${context}: annotator_type "${value}" が不正です`);
}

function parseSchemaVersion(value: string, context: string): number {
  const parsed = Number(value);
  if (!Number.isInteger(parsed)) {
    throw new Error(`${context}: schema_version "${value}" が整数ではありません`);
  }
  return parsed;
}

/**
 * 指定 document の判定履歴を読み込む（S6 / S8 検証画面の初期状態の素材）。
 * シート行順のまま返す。畳み込み時の時系列順序は cellState 側で decided_at ソートする
 */
export async function readDecisionsByDocument(
  spreadsheetId: string,
  documentId: string,
  deps: GoogleApiDeps,
): Promise<Decision[]> {
  const values = await getSheetValues(spreadsheetId, DECISIONS_TAB, deps);
  const header = values[0];
  if (header === undefined) {
    throw new Error('Decisions タブにヘッダ行がありません（プロジェクト初期化が不完全です）');
  }
  SHEET_HEADERS.Decisions.forEach((name, i) => {
    if (cellAt(header, i) !== name) {
      throw new Error(
        `Decisions のヘッダ ${i + 1} 列目が "${name}" ではありません（実際: "${cellAt(header, i)}"）`,
      );
    }
  });
  const decisions: Decision[] = [];
  values.slice(1).forEach((raw, i) => {
    if (cellAt(raw, 2) !== documentId) {
      return;
    }
    const context = `Decisions ${i + 2} 行目`;
    decisions.push({
      decidedAt: cellAt(raw, 0),
      decidedBy: cellAt(raw, 1),
      documentId: cellAt(raw, 2),
      fieldId: cellAt(raw, 3),
      entityKey: cellAt(raw, 4),
      annotator: cellAt(raw, 5),
      annotatorType: parseAnnotatorType(cellAt(raw, 6), context),
      schemaVersion: parseSchemaVersion(cellAt(raw, 7), context),
      action: parseAction(cellAt(raw, 8), context),
      value: emptyToNull(cellAt(raw, 9)),
      note: emptyToNull(cellAt(raw, 10)),
    });
  });
  return decisions;
}
