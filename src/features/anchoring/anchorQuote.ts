// 段階的マッチング（requirements.md §5-2）: exact（ai_page ± 1）→ normalized（全ページ）
// → fuzzy（編集距離 ≤ quote 長の 15%）→ failed。
// experiments/anchor-spike の実装を移植（スパイクで anchor 成功率 96.2% を実証済み）
import type { AnchorResult, NormalizedPage } from '../../domain/anchor';
import { bestSubstringDistance } from './fuzzyMatch';

/** fuzzy マッチの採用閾値: quote 長に対する編集距離の割合（requirements.md §5-2） */
export const FUZZY_DISTANCE_RATIO_THRESHOLD = 0.15;

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
 * 正規化（normalizeText）は呼び出し側で quote / pages の双方に適用しておくこと。
 * 複数一致時は ai_page に最も近い出現ページを採用する（requirements.md §5-3）
 */
export function anchorQuote(
  normalizedQuote: string,
  pages: NormalizedPage[],
  aiPage: number | null,
): AnchorResult {
  if (normalizedQuote.length === 0) {
    return { status: 'failed', page: null, matchCount: 0, bestDistance: null, distanceRatio: null };
  }

  // 全ページの出現を先に数える（複数一致の計測 + 近接選択に使う）
  const hits: Array<{ page: number; count: number }> = [];
  for (const p of pages) {
    const c = countOccurrences(p.text, normalizedQuote);
    if (c > 0) {
      hits.push({ page: p.page, count: c });
    }
  }
  const totalHits = hits.reduce((n, h) => n + h.count, 0);

  const pickNearest = (): number => {
    const first = hits[0] as { page: number };
    if (aiPage == null) {
      return first.page;
    }
    let best = first.page;
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
    // exact: ai_page ± 1 のページ内での一致（window 内でも ai_page 最近接を採用 §5-3）
    if (aiPage != null) {
      const inWindow = hits.filter((h) => Math.abs(h.page - aiPage) <= 1);
      const firstInWindow = inWindow[0];
      if (firstInWindow) {
        let bestHit = firstInWindow;
        for (const h of inWindow) {
          if (Math.abs(h.page - aiPage) < Math.abs(bestHit.page - aiPage)) {
            bestHit = h;
          }
        }
        return {
          status: 'exact',
          page: bestHit.page,
          matchCount: totalHits,
          bestDistance: 0,
          distanceRatio: 0,
        };
      }
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

  // fuzzy: 全ページを準大域アライメントで走査し、最小編集距離が閾値以内なら採用
  const threshold = Math.ceil(normalizedQuote.length * FUZZY_DISTANCE_RATIO_THRESHOLD);
  let bestDistance = Number.MAX_SAFE_INTEGER;
  let bestPage: number | null = null;
  for (const p of pages) {
    if (p.text.length === 0) {
      continue;
    }
    const { distance } = bestSubstringDistance(normalizedQuote, p.text);
    // 同距離のページが複数あるときは ai_page に近い方を採用する（bestPage は
    // bestDistance と同時に設定されるため、同距離比較の時点で必ず非 null）
    const better =
      distance < bestDistance ||
      (distance === bestDistance &&
        aiPage != null &&
        Math.abs(p.page - aiPage) < Math.abs((bestPage as number) - aiPage));
    if (better) {
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
