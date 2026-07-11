// consensus 裁定の書き込みペイロード組み立て（docs/design-independent-dual-review.md §6.5・§2.2）。
// consensus 行は annotator='consensus' / annotator_type='consensus' のリテラル固定（更新キーの
// 一意性を構造的に保証する）。action の読み替え: 一致セルの一括採用 = accept、A/B いずれか採用・
// 第 3 の値 = edit、not_reported 裁定 = not_reported、取り消し = undo（cellState の畳み込みに乗る）
import { NOT_REPORTED_TOKEN } from '../../domain/annotation';
import type { Decision, DecisionAction } from '../../domain/decision';
import type { SchemaField } from '../../domain/schemaField';
import { type CellState, undoRevertValue } from '../verification/cellState';
import type { AdjudicationCell } from './cellMatch';

/** 1 セルぶんの consensus 書き込み内容（Decision + StudyData/ResultsData 反映に必要な最小情報） */
export interface ConsensusCellWrite {
  field: SchemaField;
  entityKey: string;
  action: DecisionAction;
  /** 操作後の値。NOT_REPORTED_TOKEN は not_reported を表す（既存の annotationRepository と同じ規約） */
  value: string | null;
}

export interface ConsensusWriteParams {
  studyId: string;
  /** 裁定操作を行った人間の email（Decisions.decided_by） */
  decidedBy: string;
  decidedAt: string;
  /** consensus 行 / Decision に記録する schema_version（裁定に使った表のデザインの版） */
  schemaVersion: number;
}

/** ConsensusCellWrite → Decision（annotator は常に 'consensus'） */
export function toConsensusDecision(write: ConsensusCellWrite, params: ConsensusWriteParams): Decision {
  return {
    decidedAt: params.decidedAt,
    decidedBy: params.decidedBy,
    studyId: params.studyId,
    fieldId: write.field.fieldId,
    entityKey: write.entityKey,
    annotator: 'consensus',
    annotatorType: 'consensus',
    schemaVersion: params.schemaVersion,
    action: write.action,
    value: write.value,
    note: null,
  };
}

/**
 * 一致セルの一括採用（§6.5: action='accept'）。
 * 既に consensus が判定済みのセルは対象外にする（再クリックしても上書きしない = 冪等）
 */
export function buildBulkAcceptWrites(
  cells: readonly AdjudicationCell[],
  consensusStates: ReadonlyMap<string, CellState>,
): ConsensusCellWrite[] {
  return cells
    .filter((cell) => cell.matches)
    .filter((cell) => (consensusStates.get(cell.cellKey)?.status ?? 'unverified') === 'unverified')
    .map((cell) => ({
      field: cell.field,
      entityKey: cell.entityKey,
      action: 'accept' as const,
      value: cell.valueA,
    }));
}

/** A または B の値を採用する個別裁定（§6.5: action='edit'） */
export function buildChoiceWrite(cell: AdjudicationCell, choice: 'A' | 'B'): ConsensusCellWrite {
  return {
    field: cell.field,
    entityKey: cell.entityKey,
    action: 'edit',
    value: choice === 'A' ? cell.valueA : cell.valueB,
  };
}

/** 第 3 の値を入力する個別裁定（§6.5: action='edit'）。空欄は明示的な空値として扱う */
export function buildCustomValueWrite(cell: AdjudicationCell, rawValue: string): ConsensusCellWrite {
  const trimmed = rawValue.trim();
  return {
    field: cell.field,
    entityKey: cell.entityKey,
    action: 'edit',
    value: trimmed === '' ? null : trimmed,
  };
}

/** not_reported 裁定（§6.5: action='not_reported'） */
export function buildNotReportedWrite(cell: AdjudicationCell): ConsensusCellWrite {
  return { field: cell.field, entityKey: cell.entityKey, action: 'not_reported', value: NOT_REPORTED_TOKEN };
}

/** 取り消し（undo）。consensus 側にまだ判定が無ければ null（戻すものが無い） */
export function buildUndoWrite(cell: AdjudicationCell, consensusState: CellState): ConsensusCellWrite | null {
  if (consensusState.stack.length === 0) {
    return null;
  }
  return {
    field: cell.field,
    entityKey: cell.entityKey,
    action: 'undo',
    value: undoRevertValue(consensusState),
  };
}
