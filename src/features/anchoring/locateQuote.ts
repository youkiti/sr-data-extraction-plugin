// アンカリング済みページの正規化テキスト上で quote の文字範囲を特定する
// （architecture.md §2.3: anchorQuote() ──文字範囲──▶ highlightMap() の中間段）
import type { AnchorStatus, CharRange } from '../../domain/anchor';
import { bestSubstringDistance } from './fuzzyMatch';

/** 文字列を UTF-16 コード単位で反転する（DP が charCodeAt 単位のため対で使う） */
function reverseUnits(s: string): string {
  return s.split('').reverse().join('');
}

/**
 * anchorQuote が決定したページの正規化テキスト上で quote の範囲を求める。
 * - exact / normalized: 最初の出現を返す（ページ内複数一致の切替 UI は P1。件数は
 *   AnchorResult.matchCount で計測済み）
 * - fuzzy: 準大域アライメントの終端に加え、反転 DP で始端を復元する
 * - failed / 空 quote / ページ上に見つからない場合は null（検証画面の
 *   フォールバック検索 UI に委ねる）
 */
export function locateQuoteRange(
  normalizedQuote: string,
  normalizedPageText: string,
  status: AnchorStatus,
): CharRange | null {
  if (status === 'failed' || normalizedQuote.length === 0) {
    return null;
  }
  if (status === 'exact' || status === 'normalized') {
    const idx = normalizedPageText.indexOf(normalizedQuote);
    if (idx === -1) {
      return null; // ページ選択と食い違う入力への防御
    }
    return { start: idx, end: idx + normalizedQuote.length };
  }
  // fuzzy: 終端は forward DP、始端は反転文字列に対する同じ DP で得る
  const { endIndex } = bestSubstringDistance(normalizedQuote, normalizedPageText);
  const reversed = bestSubstringDistance(
    reverseUnits(normalizedQuote),
    reverseUnits(normalizedPageText.slice(0, endIndex)),
  );
  return { start: endIndex - reversed.endIndex, end: endIndex };
}
