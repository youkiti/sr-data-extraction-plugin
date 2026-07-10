// 検証パネル左ペインの「抽出テキスト」表示（issue #28 案2）用の純関数。
// highlights.ts と同じ正規化 + indexOf 機構（buildNormalizedPages / collectRawOccurrences /
// nearestIndex）を再利用し、Evidence の quote をページ本文上で再特定して
// 前後文脈付きスニペットを組み立てる（重複実装しない）。
//
// 入力は TextLayerPage の構造的サブセット（{ page, text }）に絞ってあり、items / width 等の
// PDF 描画専用フィールドには依存しない。案3（Drive の extracted_texts = parseExtractedText の
// 出力）へ差し替わっても、page / text さえ揃えれば同じ関数がそのまま使える
import type { Evidence } from '../../domain/evidence';
import { normalizeTextWithMap } from '../anchoring/normalizeText';
import { buildNormalizedPages, collectRawOccurrences, nearestIndex } from './highlights';

/** 前後文脈の目標文字数（issue #28 案2の指定域 300〜500 字の中央値） */
export const CONTEXT_CHARS = 400;

/** textContext が読む最小限のページ構造。TextLayerPage はこれを構造的に満たす */
export interface TextContextPage {
  /** 1-indexed ページ番号 */
  page: number;
  text: string;
}

export interface QuoteSnippet {
  /** 引用の直前 CONTEXT_CHARS 文字（ページ先頭で足りない場合は短くなる） */
  before: string;
  /** ページ本文上で再特定できた引用そのもの（evidence.quote と空白等の表記が異なりうる） */
  quote: string;
  /** 引用の直後 CONTEXT_CHARS 文字（ページ末尾で足りない場合は短くなる） */
  after: string;
}

export interface QuoteContext {
  /** quote が見つかったページ（1-indexed） */
  page: number;
  snippet: QuoteSnippet;
}

/**
 * Evidence の quote をページ本文上で再特定し、前後 CONTEXT_CHARS 文字の文脈付きスニペットを返す。
 *
 * - 全ページを正規化 indexOf で横断探索する（highlights.ts の collectOccurrences と同じ機構）。
 *   これにより「記録ページ（ai_page）に quote が無い」場合も他ページから再特定できる
 * - 出現が複数あるときは ai_page に最も近いものを既定にする（highlights.ts の nearestIndex と
 *   同じ規則。同距離は先勝ち = ページ昇順の先頭）
 * - anchor_status は分岐に使わない: fuzzy / failed（正規化しても厳密一致しない）は
 *   この全ページ探索でも見つからず null になりうるが、それは意図した挙動
 *   （呼び出し側は quote 全文 + 「再特定できません」表示へフォールバックする）
 * - ページ境界をまたいだ文脈連結はしない（そのページ内で before / after が短くなるだけ）
 */
export function findQuoteContext(
  evidence: Pick<Evidence, 'quote' | 'page' | 'anchorStatus'>,
  pages: readonly TextContextPage[],
): QuoteContext | null {
  if (evidence.quote === null) {
    return null;
  }
  const normalizedQuote = normalizeTextWithMap(evidence.quote).text;
  if (normalizedQuote === '') {
    return null;
  }
  const entries = buildNormalizedPages(pages);
  const occurrences = collectRawOccurrences(normalizedQuote, entries);
  if (occurrences.length === 0) {
    return null;
  }
  const index = nearestIndex(occurrences, evidence.page);
  const { page, range } = occurrences[index] as (typeof occurrences)[number];
  // page は entries（= pages 由来）から見つかった出現のページ番号のため、必ず引ける
  const textByPage = new Map(entries.map((entry) => [entry.page.page, entry.page.text]));
  const pageText = textByPage.get(page) as string;
  return {
    page,
    snippet: {
      before: pageText.slice(Math.max(0, range.start - CONTEXT_CHARS), range.start),
      quote: pageText.slice(range.start, range.end),
      after: pageText.slice(range.end, range.end + CONTEXT_CHARS),
    },
  };
}
