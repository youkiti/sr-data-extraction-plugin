// Evidence の quote → PDF ページ上のハイライト矩形（requirements.md §5-3/5-4）。
// 抽出時に確定した anchor_status を信頼し、表示時はページテキスト上の出現位置を
// 再特定して矩形化する（normalizeTextWithMap → locateQuoteRange → toRawRange → highlightMap）。
// exact / normalized は全ページの全出現を列挙し、「他 n 箇所に一致」の切替（§5-3）に使う。
// fuzzy は anchor 済みページ内の最良一致 1 件のみ
import type { Evidence } from '../../domain/evidence';
import type { AnchorStatus, CharRange } from '../../domain/anchor';
import type { TextLayerPage } from '../../domain/textLayer';
import type { VerificationDocumentView } from './types';
import { highlightMap, type HighlightRect } from '../anchoring/highlightMap';
import { locateQuoteRange } from '../anchoring/locateQuote';
import {
  normalizeTextWithMap,
  toRawRange,
  type NormalizedTextMap,
} from '../anchoring/normalizeText';
import { cellKeyOf } from './cellState';

/** 1 出現ぶんのハイライト（1 ページ内の矩形集合） */
export interface HighlightOccurrence {
  page: number;
  rects: HighlightRect[];
}

export interface EvidenceHighlight {
  evidenceId: string;
  /** quote の出所文書（v0.10: study 内の複数文書を跨ぐため、どの PDF のハイライトかを持つ） */
  documentId: string;
  /** 対応する検証セル（fieldId × entityKey）。フォーム側との双方向ジャンプに使う */
  cellKey: string;
  status: Exclude<AnchorStatus, 'failed'>;
  /** 出現位置（ページ昇順）。exact / normalized は複数になりうる */
  occurrences: HighlightOccurrence[];
  /** 既定で表示する出現（ai_page に最も近いページ。§5-3） */
  selectedIndex: number;
}

interface NormalizedPageEntry {
  page: TextLayerPage;
  map: NormalizedTextMap;
}

function buildNormalizedPages(pages: readonly TextLayerPage[]): NormalizedPageEntry[] {
  return pages.map((page) => ({ page, map: normalizeTextWithMap(page.text) }));
}

/** 正規化テキスト上の範囲を元テキストへ写像し、span 矩形へ変換する。写像不能は null */
function rangeToOccurrence(
  entry: NormalizedPageEntry,
  range: { start: number; end: number },
): HighlightOccurrence | null {
  const rawRange = toRawRange(entry.map, range);
  if (rawRange === null) {
    return null;
  }
  return { page: entry.page.page, rects: highlightMap(entry.page.items, rawRange) };
}

/** ページ正規化テキスト上の全出現を列挙する（exact / normalized 用） */
function collectOccurrences(
  normalizedQuote: string,
  entries: readonly NormalizedPageEntry[],
): HighlightOccurrence[] {
  const occurrences: HighlightOccurrence[] = [];
  for (const entry of entries) {
    let from = 0;
    let idx: number;
    while ((idx = entry.map.text.indexOf(normalizedQuote, from)) !== -1) {
      // indexOf の一致範囲（非空・テキスト内）は常に元テキストへ写像できる
      const rawRange = toRawRange(entry.map, {
        start: idx,
        end: idx + normalizedQuote.length,
      }) as CharRange;
      occurrences.push({
        page: entry.page.page,
        rects: highlightMap(entry.page.items, rawRange),
      });
      from = idx + 1;
    }
  }
  return occurrences;
}

/** ai_page に最も近い出現を既定表示にする（同距離は先勝ち = ページ昇順の先頭） */
function nearestIndex(occurrences: readonly HighlightOccurrence[], aiPage: number | null): number {
  if (aiPage === null) {
    return 0;
  }
  let best = 0;
  for (let i = 1; i < occurrences.length; i++) {
    const currentDistance = Math.abs((occurrences[i] as HighlightOccurrence).page - aiPage);
    const bestDistance = Math.abs((occurrences[best] as HighlightOccurrence).page - aiPage);
    if (currentDistance < bestDistance) {
      best = i;
    }
  }
  return best;
}

/**
 * 1 document の Evidence をハイライトへ変換する。
 * anchor_status = failed / quote なし / ページ上に再特定できないものは含めない
 * （フォーム側の quote 全文 + 検索フォールバック UI に委ねる。ui-states.md §3）。
 * evidence はこの document（documentId）由来のものだけを渡すこと
 */
export function buildDocumentHighlights(
  documentId: string,
  evidence: readonly Evidence[],
  pages: readonly TextLayerPage[],
): EvidenceHighlight[] {
  const entries = buildNormalizedPages(pages);
  const highlights: EvidenceHighlight[] = [];
  for (const item of evidence) {
    if (
      item.quote === null ||
      item.anchorStatus === null ||
      item.anchorStatus === 'failed'
    ) {
      continue;
    }
    const normalizedQuote = normalizeTextWithMap(item.quote).text;
    if (normalizedQuote === '') {
      continue;
    }
    let occurrences: HighlightOccurrence[];
    if (item.anchorStatus === 'fuzzy') {
      // fuzzy は anchor 済みページ内の最良一致のみ（全ページ走査は表示時コストが高い）
      const entry = entries.find((candidate) => candidate.page.page === item.page);
      if (entry === undefined) {
        continue;
      }
      // fuzzy + 非空 quote では locateQuoteRange は必ず範囲を返す（null は failed / 空 quote のみ）
      const range = locateQuoteRange(normalizedQuote, entry.map.text, 'fuzzy') as CharRange;
      const occurrence = rangeToOccurrence(entry, range);
      occurrences = occurrence === null ? [] : [occurrence];
    } else {
      occurrences = collectOccurrences(normalizedQuote, entries);
    }
    if (occurrences.length === 0) {
      continue;
    }
    highlights.push({
      evidenceId: item.evidenceId,
      documentId,
      cellKey: cellKeyOf(item.fieldId, item.entityKey),
      status: item.anchorStatus,
      occurrences,
      selectedIndex: nearestIndex(occurrences, item.page),
    });
  }
  return highlights;
}

/**
 * study 配下の全文書の Evidence をハイライトへ変換する（v0.10 フェーズ 3）。
 * 各文書の Evidence（document_id 一致）をその文書のテキスト層に対してアンカリングし、
 * documentId で出所を持たせる。表示順は documents の並び（role 固定順 → 取り込み順）
 */
export function buildStudyHighlights(
  documents: readonly VerificationDocumentView[],
  evidence: readonly Evidence[],
): EvidenceHighlight[] {
  return documents.flatMap((view) =>
    buildDocumentHighlights(
      view.document.documentId,
      evidence.filter((item) => item.documentId === view.document.documentId),
      view.textPages,
    ),
  );
}

/**
 * ビューアのテキスト検索（§4.2 のフォールバック検索を含む）。
 * クエリとページ双方を正規化して全出現を返す（ページ昇順・ページ内出現順）
 */
export function searchPages(
  query: string,
  pages: readonly TextLayerPage[],
): HighlightOccurrence[] {
  const normalizedQuery = normalizeTextWithMap(query).text;
  if (normalizedQuery === '') {
    return [];
  }
  return collectOccurrences(normalizedQuery, buildNormalizedPages(pages));
}
