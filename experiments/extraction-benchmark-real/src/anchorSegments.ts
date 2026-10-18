// 失敗した引用を断片に分け、本番アンカリングで救済できる範囲を分類する。
import { normalizeText } from '../../../src/features/anchoring/normalizeText';
import { anchorQuote } from '../../../src/features/anchoring/anchorQuote';
import type { NormalizedPage } from '../../../src/domain/anchor';

export const SEGMENT_CLASSES = [
  'single', 'has_short_segment', 'all_same_page', 'all_diff_pages', 'partial', 'none',
] as const;
export type SegmentClass = typeof SEGMENT_CLASSES[number];

/** 改行と省略記号で分割し、照合対象になる空でない断片を返す。 */
export function splitSegments(quote: string): string[] {
  return quote.split(/\r\n|\n|\r|\.{3,}|…/).map((segment) => segment.trim()).filter(Boolean);
}

/** 短い断片による偶然の一致を除き、全断片の照合結果から排他的な分類を返す。 */
export function classifySegments(quote: string, pages: NormalizedPage[], aiPage: number | null): SegmentClass {
  const segments = splitSegments(quote).map(normalizeText);
  if (segments.length <= 1) return 'single';
  if (segments.some((segment) => segment.length < 8)) return 'has_short_segment';
  const results = segments.map((segment) => anchorQuote(segment, pages, aiPage));
  const matched = results.filter((result) => result.status !== 'failed');
  if (matched.length === results.length) {
    return new Set(matched.map((result) => result.page)).size === 1 ? 'all_same_page' : 'all_diff_pages';
  }
  return matched.length > 0 ? 'partial' : 'none';
}
