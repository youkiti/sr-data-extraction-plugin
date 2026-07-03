// PDF バイト列 → ページ別テキスト + text_status + extracted_texts 本文（architecture.md §2）。
// PDF.js 依存は loadPdf として注入する（テストは fake ドキュメントで完結。architecture.md §4.2）
import type { TextLayerPage } from '../../domain/textLayer';
import type { PdfDocumentLike } from '../../lib/pdf/textLayer';
import { extractTextLayerPages } from '../../lib/pdf/textLayer';
import { detectTextStatus, type TextStatusResult } from './detectTextStatus';
import { serializeExtractedText } from './extractedText';

/** loadPdf の戻り値に要求する最小形（pdfjs の PDFDocumentProxy が構造的に満たす） */
export interface DisposablePdfDocument extends PdfDocumentLike {
  destroy(): Promise<unknown> | void;
}

export interface ExtractTextLayerResult extends TextStatusResult {
  /** span 座標付きテキスト層（テキスト層 fixture / ビューアの素材） */
  pages: TextLayerPage[];
  /** extracted_texts/{document_id}.txt に保存する本文。no_text_layer のときは null */
  serializedText: string | null;
}

export interface ExtractTextLayerDeps {
  loadPdf: (data: ArrayBuffer) => Promise<DisposablePdfDocument>;
}

/**
 * PDF からテキスト層を抽出し、text_status を判定して extracted_texts 本文まで組み立てる。
 * no_text_layer（全ページ実質テキストなし）の場合は本文を作らない
 * （text_only モードでは抽出不可・ハイライト不可。※Q7）
 */
export async function extractTextLayer(
  data: ArrayBuffer,
  deps: ExtractTextLayerDeps,
): Promise<ExtractTextLayerResult> {
  const doc = await deps.loadPdf(data);
  let pages: TextLayerPage[];
  try {
    pages = await extractTextLayerPages(doc);
  } finally {
    await doc.destroy();
  }
  const status = detectTextStatus(pages);
  const serializedText =
    status.textStatus === 'no_text_layer'
      ? null
      : serializeExtractedText(pages.map((page) => ({ page: page.page, text: page.text })));
  return { ...status, pages, serializedText };
}
