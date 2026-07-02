// Decisions タブに対応する型（requirements.md §3.2）。判定監査ログ・追記型。
// 人間の判定操作を 1 操作 = 1 行で追記し、undo も 1 行として残す
import type { AnnotatorType } from './annotation';

export type DecisionAction = 'accept' | 'edit' | 'reject' | 'not_reported' | 'undo';

export interface Decision {
  decidedAt: string;
  /** 判定操作を行った人間の email */
  decidedBy: string;
  documentId: string;
  fieldId: string;
  entityKey: string;
  /**
   * 判定対象の annotator 行（StudyData / ResultsData のどの行への判定か）。
   * MVP では decided_by 本人の human_with_ai 行。P1 の adjudication では consensus 行へ判定する
   */
  annotator: string;
  annotatorType: AnnotatorType;
  /** 判定時点で対象行が依拠していたスキーマ版（改訂 → 再抽出後の再検証を区別する） */
  schemaVersion: number;
  action: DecisionAction;
  /** 操作後の値 */
  value: string | null;
  /** 検証時のメモ（例: Table 2 と本文で数値不一致、Table 2 を採用） */
  note: string | null;
}
