// §5-2 の段階的マッチング: exact（ai_page ± 1）→ normalized（全ページ）→ fuzzy（編集距離 15%）→ failed
import { bestSubstringDistance } from './levenshtein.js';

export type AnchorStatus = 'exact' | 'normalized' | 'fuzzy' | 'failed';

export interface AnchorResult {
  status: AnchorStatus;
  /** マッチしたページ（1-indexed）。failed 時は null */
  page: number | null;
  /** exact / normalized の全ページ出現数（複数一致の計測用） */
  matchCount: number;
  /** fuzzy / failed 時の最良編集距離と quote 長比 */
  bestDistance: number | null;
  distanceRatio: number | null;
}

export interface NormalizedPage {
  page: number;
  text: string;
}

function countOccurrences(haystack: string, needle: string): number {
  let count = 0;
  let idx = haystack.indexOf(needle);
  while (idx !== -1) {
    count++;
    idx = haystack.indexOf(needle, idx + 1);
  }
  return count;
}

/**
 * 正規化済み quote を正規化済みページ群にアンカリングする。
 * 正規化方式（base / extended）は呼び出し側で quote / pages に同じものを適用しておく。
 */
export function anchorQuote(
  normalizedQuote: string,
  pages: NormalizedPage[],
  aiPage: number | null,
): AnchorResult {
  if (normalizedQuote.length === 0) {
    return { status: 'failed', page: null, matchCount: 0, bestDistance: null, distanceRatio: null };
  }

  // 全ページの出現を先に数える（複数一致計測 + 近接選択に使う）
  const hits: Array<{ page: number; count: number }> = [];
  for (const p of pages) {
    const c = countOccurrences(p.text, normalizedQuote);
    if (c > 0) hits.push({ page: p.page, count: c });
  }
  const totalHits = hits.reduce((n, h) => n + h.count, 0);

  const pickNearest = (): number => {
    if (aiPage == null) return (hits[0] as { page: number }).page;
    let best = (hits[0] as { page: number }).page;
    let bestDist = Math.abs(best - aiPage);
    for (const h of hits) {
      const d = Math.abs(h.page - aiPage);
      if (d < bestDist) {
        best = h.page;
        bestDist = d;
      }
    }
    return best;
  };

  if (totalHits > 0) {
    // exact: ai_page ± 1 のページ内での一致
    const inWindow =
      aiPage != null ? hits.filter((h) => Math.abs(h.page - aiPage) <= 1) : [];
    if (inWindow.length > 0) {
      return {
        status: 'exact',
        page: (inWindow[0] as { page: number }).page,
        matchCount: totalHits,
        bestDistance: 0,
        distanceRatio: 0,
      };
    }
    // normalized: 全ページでの一致（ai_page 近接を採用）
    return {
      status: 'normalized',
      page: pickNearest(),
      matchCount: totalHits,
      bestDistance: 0,
      distanceRatio: 0,
    };
  }

  // fuzzy: 全ページを準大域アライメントで走査し、最小編集距離が quote 長の 15% 以内なら採用
  const threshold = Math.ceil(normalizedQuote.length * 0.15);
  let bestDistance = Number.MAX_SAFE_INTEGER;
  let bestPage: number | null = null;
  for (const p of pages) {
    if (p.text.length === 0) continue;
    const { distance } = bestSubstringDistance(normalizedQuote, p.text);
    if (
      distance < bestDistance ||
      (distance === bestDistance && aiPage != null && bestPage != null &&
        Math.abs(p.page - aiPage) < Math.abs(bestPage - aiPage))
    ) {
      bestDistance = distance;
      bestPage = p.page;
    }
  }
  const ratio = bestDistance / normalizedQuote.length;
  if (bestDistance <= threshold) {
    return {
      status: 'fuzzy',
      page: bestPage,
      matchCount: 0,
      bestDistance,
      distanceRatio: ratio,
    };
  }
  return { status: 'failed', page: null, matchCount: 0, bestDistance, distanceRatio: ratio };
}
