// Evidence の quote → PDF ページ上のハイライト矩形（requirements.md §5-3/5-4）。
// 抽出時に確定した anchor_status を信頼し、表示時はページテキスト上の出現位置を
// 再特定して矩形化する（normalizeTextWithMap → locateQuoteRange → toRawRange → highlightMap）。
// exact / normalized は全ページの全出現を列挙し、「他 n 箇所に一致」の切替（§5-3）に使う。
// fuzzy は anchor 済みページ内の最良一致 1 件のみ
//
// issue #28 案3: PDF（textPages/items 付き）は表示中の 1 文書しか読み込まないため、
// 再特定は 2 段に分ける。
// (1) テキストのみの再特定（buildDocumentTextMatches / buildStudyTextMatches）: extracted_texts
//     の軽量ページ（{page, text}）に対して行い、matchCount・選択出現・ページ番号だけを持つ
//     （rects なし）。study の全文書ぶんを bundle 組み立て時に一度だけ計算でき、PDF の
//     ロード状態に関係なく一貫した matchCount / ページ表示ができる
// (2) 矩形の実体化（buildDocumentHighlights）: 対象文書の PDF が読み込まれ TextLayerPage
//     （items 付き）が揃ってから、そのページのテキストに対して行う。extracted_texts と
//     PDF テキスト層は同じ抽出結果由来のため、同じ quote に対して両者の出現順序・件数は一致する
import type { Evidence, EvidenceBbox } from '../../domain/evidence';
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
  /**
   * 矩形の座標空間。省略時 'user'（従来どおりの PDF ユーザー空間。描画側が toDisplayRect で
   * 回転込みの表示座標へ写す）。'display' は bbox 由来（§7.3）で、**既に回転適用後の
   * 表示フレーム座標（scale 1）** になっているため、描画側は toDisplayRect を通してはならない
   * （通すと二重回転になる。handoff-scanned-pdf-native-highlight.md §7.3）
   */
  space?: 'user' | 'display';
}

export interface EvidenceHighlight {
  evidenceId: string;
  /** quote の出所文書（v0.10: study 内の複数文書を跨ぐため、どの PDF のハイライトかを持つ） */
  documentId: string;
  /** 対応する検証セル（fieldId × entityKey）。フォーム側との双方向ジャンプに使う */
  cellKey: string;
  /** bbox 由来（source: 'bbox'）は機械検証不能のため anchor_status を持たず null */
  status: Exclude<AnchorStatus, 'failed'> | null;
  /** 出現位置（ページ昇順）。exact / normalized は複数になりうる */
  occurrences: HighlightOccurrence[];
  /** 既定で表示する出現（ai_page に最も近いページ。§5-3） */
  selectedIndex: number;
  /** 座標源: 'anchor' = テキスト層アンカリング（従来）/ 'bbox' = box_2d（§7.4 PR3） */
  source: 'anchor' | 'bbox';
}

/**
 * box を表示フレーム矩形（'display' 空間。scale 1）へ変換する（§7.3 案(i)「表示フレームへ直接」）。
 *
 * box_2d はモデルに見せたページ画像（= 回転適用後の描画フレーム）の座標系で返ってくる。
 * 回転 0 のページはユーザー空間と表示フレームが一致するため一見どちらでも writable に見えるが、
 * 回転ページ（/Rotate 90 等）ではユーザー空間 ≠ 表示フレームであり、
 * 「回転 0 のユーザー空間矩形を組み立てて toDisplayRect(rotation) に通す」（案(ii)）は
 * 表示フレーム座標を未回転ユーザー空間と誤解して**二重に回転**させてしまう
 * （スパイク REPORT §10 の追試で 1200px 超のズレを実測・案(ii)は禁止）。
 * そのため bbox は常にこの関数で表示フレームへ直接変換し、pdfViewer 側は
 * `space: 'display'` の矩形に toDisplayRect を通さない（§7.3 / app/ui/pdfViewer.ts）
 */
export function bboxToDisplayRect(
  bbox: EvidenceBbox,
  dims: { width: number; height: number },
): HighlightRect {
  return {
    // テキスト層 item 由来ではないため itemIndex は意味を持たない（デバッグ用の -1 を置く）
    itemIndex: -1,
    x: (bbox.xmin / 1000) * dims.width,
    y: (bbox.ymin / 1000) * dims.height,
    width: ((bbox.xmax - bbox.xmin) / 1000) * dims.width,
    height: ((bbox.ymax - bbox.ymin) / 1000) * dims.height,
  };
}

/**
 * ページ本文 + 正規化写像の組。P は既定で TextLayerPage だが、抽出テキスト表示
 * （features/verification/textContext.ts）は items/width 等を持たない構造的サブセット
 * （{ page, text }）でも動くよう総称化してある（重複実装しないための共通化）
 */
export interface NormalizedPageEntry<P extends { page: number; text: string } = TextLayerPage> {
  page: P;
  map: NormalizedTextMap;
}

export function buildNormalizedPages<P extends { page: number; text: string }>(
  pages: readonly P[],
): NormalizedPageEntry<P>[] {
  return pages.map((page) => ({ page, map: normalizeTextWithMap(page.text) }));
}

/**
 * 正規化テキスト上の全出現を [start, end) の生テキスト範囲として列挙する（ページ横断・出現順）。
 * quote の前後文脈抽出（textContext.ts の findQuoteContext）とも共有する indexOf ベースの機構
 */
export function collectRawOccurrences<P extends { page: number; text: string }>(
  normalizedQuery: string,
  entries: readonly NormalizedPageEntry<P>[],
): Array<{ page: number; range: CharRange }> {
  const occurrences: Array<{ page: number; range: CharRange }> = [];
  for (const entry of entries) {
    let from = 0;
    let idx: number;
    while ((idx = entry.map.text.indexOf(normalizedQuery, from)) !== -1) {
      // indexOf の一致範囲（非空・テキスト内）は常に元テキストへ写像できる
      const range = toRawRange(entry.map, {
        start: idx,
        end: idx + normalizedQuery.length,
      }) as CharRange;
      occurrences.push({ page: entry.page.page, range });
      from = idx + 1;
    }
  }
  return occurrences;
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
  const entryByPage = new Map(entries.map((entry) => [entry.page.page, entry]));
  return collectRawOccurrences(normalizedQuote, entries).map(({ page, range }) => ({
    page,
    rects: highlightMap((entryByPage.get(page) as NormalizedPageEntry).page.items, range),
  }));
}

/**
 * ai_page に最も近い要素の index を返す（同距離は先勝ち = 昇順の先頭）。
 * textContext.ts の quote 前後文脈抽出でも同じ規則を使う（P は `page` を持つ要素なら何でもよい）
 */
export function nearestIndex<T extends { page: number }>(
  occurrences: readonly T[],
  aiPage: number | null,
): number {
  if (aiPage === null) {
    return 0;
  }
  let best = 0;
  for (let i = 1; i < occurrences.length; i++) {
    const currentDistance = Math.abs((occurrences[i] as T).page - aiPage);
    const bestDistance = Math.abs((occurrences[best] as T).page - aiPage);
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
    // bbox 経路（pdf_native の box_2d。§7.4 PR3）を先に判定する。テキスト層アンカリングとは
    // 独立の別軸なので、bbox があればそちらを優先し、無ければ従来のアンカリング経路へ進む
    if (item.bbox !== null && item.bboxPage !== null) {
      const page = pages.find((candidate) => candidate.page === item.bboxPage);
      if (page === undefined) {
        // bbox が指すページ自体が無い（想定外だが安全側に倒して skip。フォーム側の
        // quote 全文表示 + 本文検索フォールバックに委ねる）
        continue;
      }
      highlights.push({
        evidenceId: item.evidenceId,
        documentId,
        cellKey: cellKeyOf(item.fieldId, item.entityKey),
        status: null,
        source: 'bbox',
        occurrences: [
          { page: item.bboxPage, rects: [bboxToDisplayRect(item.bbox, page)], space: 'display' },
        ],
        selectedIndex: 0,
      });
      continue;
    }
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
      source: 'anchor',
      occurrences,
      selectedIndex: nearestIndex(occurrences, item.page),
    });
  }
  return highlights;
}

/** テキストのみで再特定した 1 件ぶんの出現位置（rects なし。PDF 未読込でも計算できる） */
export interface EvidenceTextMatch {
  evidenceId: string;
  /** quote の出所文書 */
  documentId: string;
  /** 対応する検証セル（fieldId × entityKey） */
  cellKey: string;
  status: Exclude<AnchorStatus, 'failed'>;
  /** 出現位置（ページ昇順）。exact / normalized は複数になりうる */
  occurrences: Array<{ page: number; range: CharRange }>;
  /** 既定で選択する出現（ai_page に最も近いページ。§5-3） */
  selectedIndex: number;
}

/**
 * 1 document の Evidence をテキストのみで再特定する（rects 化しない版の buildDocumentHighlights）。
 * extracted_texts の軽量ページ（{page, text}）に対して行うため、PDF が未読込でも計算できる。
 * 除外条件（quote なし / anchor_status なし・failed / 正規化後空 / 見つからない）は
 * buildDocumentHighlights と同一
 */
export function buildDocumentTextMatches<P extends { page: number; text: string }>(
  documentId: string,
  evidence: readonly Evidence[],
  pages: readonly P[],
): EvidenceTextMatch[] {
  const entries = buildNormalizedPages(pages);
  const matches: EvidenceTextMatch[] = [];
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
    let occurrences: Array<{ page: number; range: CharRange }>;
    if (item.anchorStatus === 'fuzzy') {
      const entry = entries.find((candidate) => candidate.page.page === item.page);
      if (entry === undefined) {
        continue;
      }
      // fuzzy + 非空 quote では locateQuoteRange は必ず範囲を返す（null は failed / 空 quote のみ）
      const range = locateQuoteRange(normalizedQuote, entry.map.text, 'fuzzy') as CharRange;
      const rawRange = toRawRange(entry.map, range);
      occurrences = rawRange === null ? [] : [{ page: entry.page.page, range: rawRange }];
    } else {
      occurrences = collectRawOccurrences(normalizedQuote, entries);
    }
    if (occurrences.length === 0) {
      continue;
    }
    matches.push({
      evidenceId: item.evidenceId,
      documentId,
      cellKey: cellKeyOf(item.fieldId, item.entityKey),
      status: item.anchorStatus,
      occurrences,
      selectedIndex: nearestIndex(occurrences, item.page),
    });
  }
  return matches;
}

/**
 * study 配下の全文書の Evidence をテキストのみで再特定する（v0.10 フェーズ 3 + issue #28 案3）。
 * 各文書の Evidence（document_id 一致）をその文書の extracted_texts に対してアンカリングし、
 * documentId で出所を持たせる。表示順は documents の並び（role 固定順 → 取り込み順）。
 * PDF の読み込み状態に関係なく計算できるため、bundle 組み立て時に一度だけ計算すればよい
 */
export function buildStudyTextMatches(
  documents: readonly VerificationDocumentView[],
  evidence: readonly Evidence[],
): EvidenceTextMatch[] {
  return documents.flatMap((view) =>
    buildDocumentTextMatches(
      view.document.documentId,
      evidence.filter((item) => item.documentId === view.document.documentId),
      view.extractedPages,
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
