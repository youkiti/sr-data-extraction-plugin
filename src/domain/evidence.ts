// Evidence タブに対応する型（requirements.md §3.2）。AI 根拠・追記型。
// ハイライト表示（§5）と audit.csv の素材。ai annotator 行の値はここから転記される
import type { AnchorStatus } from './anchor';

/** プロンプトで自己申告させる確信度 */
export type Confidence = 'high' | 'medium' | 'low';

/** 1 行 = 1 run × 1 document × 1 field × 1 entity_key */
export interface Evidence {
  evidenceId: string;
  runId: string;
  documentId: string;
  fieldId: string;
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
