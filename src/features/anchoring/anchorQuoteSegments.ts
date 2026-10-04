// 断片照合（requirements.md §5-2。issue #294）: 引用全体の照合に失敗した quote を
// 改行・省略記号で分け、断片ごとに anchorQuote で照合し直す。
// 行見出しとデータ行のように、原文で隣り合っていない箇所をつないだ引用を救う
import type { AnchorResult, NormalizedPage } from '../../domain/anchor';
import { anchorQuote } from './anchorQuote';
import { normalizeText } from './normalizeText';

/** 短すぎる断片の偶然一致を避けるための正規化後の最小文字数 */
export const MIN_SEGMENT_LENGTH = 8;

/** 全体照合に失敗した引用を分割し、全グループの照合が成功した場合だけ返す。 */
export function anchorQuoteSegments(
  quote: string,
  pages: NormalizedPage[],
  aiPage: number | null,
): Array<{ quote: string; anchor: AnchorResult }> | null {
  const fragments = quote.split(/\r\n|\n|\r|\.{3,}|…/).map((part) => part.trim()).filter(Boolean);
  if (fragments.length <= 1) return null;

  const groups = [fragments[0] as string];
  for (const fragment of fragments.slice(1)) {
    const joined = `${groups[groups.length - 1]} ${fragment}`;
    const normalized = normalizeText(joined);
    if (pages.some((page) => page.text.includes(normalized))) {
      groups[groups.length - 1] = joined;
    } else {
      groups.push(fragment);
    }
  }
  if (groups.length === 1) return null;
  if (groups.some((group) => normalizeText(group).length < MIN_SEGMENT_LENGTH)) return null;

  const segments = groups.map((group) => ({
    quote: group,
    anchor: anchorQuote(normalizeText(group), pages, aiPage),
  }));
  return segments.some((segment) => segment.anchor.status === 'failed') ? null : segments;
}
