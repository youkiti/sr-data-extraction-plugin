// §5-1 の共通正規化。quote とページテキストの双方に適用する。
// base = requirements.md §5 に書かれたとおりの正規化
// extended = base + ダッシュ / 引用符の折り畳み（スパイクで追加の要否を計測するための実験版）

/** requirements.md §5 どおりの正規化（NFKC がリガチャ ﬁ→fi と全角半角を吸収する） */
export function normalizeBase(input: string): string {
  let s = input.normalize('NFKC');
  // 行末ハイフネーション結合: exam-\nple → example（英字に挟まれた行末ハイフンのみ）
  s = s.replace(/([A-Za-z])-\s*\n\s*([a-z])/g, '$1$2');
  // 空白圧縮（改行含む）
  s = s.replace(/\s+/g, ' ').trim();
  return s;
}

/** base + ダッシュ類 / 引用符類 / マイナス記号の折り畳み（§5 への追加候補を計測する） */
export function normalizeExtended(input: string): string {
  let s = normalizeBase(input);
  s = s.replace(/[‐-―−]/g, '-'); // ハイフン・ダッシュ・マイナスを ASCII ハイフンへ
  s = s.replace(/[‘’ʼ]/g, "'"); // シングル引用符
  s = s.replace(/[“”]/g, '"'); // ダブル引用符
  return s;
}
