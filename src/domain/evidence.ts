// Evidence タブに対応する型（requirements.md §3.2）。AI 根拠・追記型。
// ハイライト表示（§5）と audit.csv の素材。ai annotator 行の値はここから転記される
import type { AnchorStatus } from './anchor';

/** プロンプトで自己申告させる確信度 */
export type Confidence = 'high' | 'medium' | 'low';

/**
 * 1 行 = 1 run × 1 study × 1 field × 1 entity_key（+ quote の出所 document）。
 * 14 タブ中このタブだけが document_id を持ち続ける（quote は特定 PDF の中にあるため。§3.2）
 */
export interface Evidence {
  evidenceId: string;
  runId: string;
  studyId: string;
  fieldId: string;
  /** quote の出所文書。ビューアはこの文書を開いてハイライトする。not_reported で quote なしなら空可 */
  documentId: string;
  /** study レベルは STUDY_ENTITY_KEY（`-`） */
  entityKey: string;
  /** AI 出力の原本 */
  value: string | null;
  /** AI が「本文に報告なし」と判断 */
  notReported: boolean;
  /** verbatim 引用（根拠箇所）。ハイライトの元データ */
  quote: string | null;
  /** 1-indexed ページヒント */
  page: number | null;
  confidence: Confidence | null;
  /** quote アンカリング結果（§5）。Evidence 保存時に確定する */
  anchorStatus: AnchorStatus | null;
}
