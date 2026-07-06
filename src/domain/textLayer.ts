// PDF テキスト層の型（experiments/anchor-spike の出力 JSON 形式を正式化）。
// tests/fixtures/pdf/*.json（テキスト層 fixture）と extracted_texts の素材であり、
// highlightMap（文字範囲 → span 座標写像）の入力になる。runtime 依存ゼロの純粋型

/** PDF ユーザー空間への変換行列 [a, b, c, d, e, f]（e, f が原点座標） */
export type PdfTransform = [number, number, number, number, number, number];

/** ページの表示回転（/Rotate。時計回りの度数） */
export type PageRotation = 0 | 90 | 180 | 270;

/** span 1 個ぶんのテキスト層 item */
export interface TextLayerItem {
  /** ページテキスト内の開始文字オフセット */
  charStart: number;
  str: string;
  transform: PdfTransform;
  /** PDF ポイント単位 */
  width: number;
  height: number;
  /** item 直後に改行が入るか（ページテキスト側は charStart + str.length の位置に \n） */
  hasEOL: boolean;
}

export interface TextLayerPage {
  /** 1-indexed ページ番号 */
  page: number;
  /** item を読み順（コンテンツストリーム順）で連結したテキスト。hasEOL 位置に \n を挿入 */
  text: string;
  /** PDF ポイント単位のページサイズ（回転適用後の表示寸法。/Rotate 90 の縦置きページは横長になる） */
  width: number;
  height: number;
  /**
   * ページの表示回転。item の transform は回転前の生座標系なので、
   * 表示座標への変換（app/ui/pdfViewer）はこの回転を適用する必要がある
   */
  rotation: PageRotation;
  items: TextLayerItem[];
}

export interface TextLayerDocument {
  pdfId: string;
  file: string;
  pdfjsVersion: string;
  pageCount: number;
  pages: TextLayerPage[];
}
