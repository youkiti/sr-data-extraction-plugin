// quote アンカリングの共通正規化（requirements.md §5-1）。
// quote とページテキストの双方に同じ正規化を適用してから照合する。
// 実装は experiments/anchor-spike の normalizeBase を移植（スパイクで anchor 成功率 96.2% を実証。
// ダッシュ / 引用符の折り畳みを加えた拡張版は効果ゼロだったため採用しない）

/** NFKC がリガチャ（ﬁ→fi）と全角 / 半角の統一を吸収する */
export function normalizeText(input: string): string {
  let s = input.normalize('NFKC');
  // 行末ハイフネーション結合: exam-\nple → example（英字に挟まれた行末ハイフンのみ）
  s = s.replace(/([A-Za-z])-\s*\n\s*([a-z])/g, '$1$2');
  // 空白圧縮（改行含む）
  s = s.replace(/\s+/g, ' ').trim();
  return s;
}
