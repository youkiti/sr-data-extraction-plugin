// Evidence タブに対応する型（requirements.md §3.2）。AI 根拠・追記型。
// ハイライト表示（§5）と audit.csv の素材。ai annotator 行の値はここから転記される
import type { AnchorStatus } from './anchor';

/** プロンプトで自己申告させる確信度 */
export type Confidence = 'high' | 'medium' | 'low';

/**
 * quote の bounding box（pdf_native / box_2d。handoff-scanned-pdf-native-highlight.md §7.2）。
 * 座標規約: `[ymin, xmin, ymax, xmax]` 相当を 0–1000 に正規化した整数。原点は**画像左上**、
 * 基準フレームは**回転適用後の表示フレーム**（回転 0 のページはユーザー空間と一致するが、
 * 回転ページは表示フレームの寸法・向きで解釈する。§7.3）。機械検証はできない（人手判定に委ねる）
 */
export interface EvidenceBbox {
  ymin: number;
  xmin: number;
  ymax: number;
  xmax: number;
}

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
  /**
   * bbox が乗るページ（1-indexed）。pdf_native（画像入力）の run で Gemini が box_2d を
   * 返したときだけ非 null。quote/anchorStatus とは別軸（bbox は機械検証不能）。
   * 不変条件: bboxPage と bbox は両方 null か両方非 null（片方だけの欠損はあり得ない）
   */
  bboxPage: number | null;
  bbox: EvidenceBbox | null;
}
