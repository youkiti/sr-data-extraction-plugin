// quote アンカリングの型定義（requirements.md §5）。runtime 依存ゼロの純粋型

/** 段階的マッチングの結果区分。Evidence.anchor_status に記録する */
export type AnchorStatus = 'exact' | 'normalized' | 'fuzzy' | 'failed';

/** テキスト内の文字範囲 [start, end)（UTF-16 オフセット） */
export interface CharRange {
  start: number;
  end: number;
}

/** 正規化済みのページテキスト（extracted_texts のページ別テキストに共通正規化を適用したもの） */
export interface NormalizedPage {
  /** 1-indexed ページ番号 */
  page: number;
  text: string;
}

export interface AnchorResult {
  status: AnchorStatus;
  /** マッチしたページ（1-indexed）。failed 時は null */
  page: number | null;
  /** exact / normalized の全ページ合計出現数（複数一致の計測・切替 UI 用） */
  matchCount: number;
  /** fuzzy / failed 時の最良編集距離。exact / normalized は 0 */
  bestDistance: number | null;
  /** bestDistance / quote 長。fuzzy 閾値（0.15）との比較・計測用 */
  distanceRatio: number | null;
}
