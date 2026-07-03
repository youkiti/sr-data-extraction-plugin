// PDF ドキュメント → ページ別テキスト + span 座標（domain/textLayer.ts の TextLayerPage）。
// experiments/anchor-spike/src/extract-text.ts の抽出ロジックを正式化したもの。
// pdfjs-dist へ直接依存せず構造的な最小型で受けるため、テストは fake ドキュメントで完結する
import type { PdfTransform, TextLayerItem, TextLayerPage } from '../../domain/textLayer';

/** pdfjs の TextItem のうち本モジュールが読む部分（TextMarkedContent は str を持たない） */
interface PdfTextItemLike {
  str?: string;
  transform?: number[];
  width?: number;
  height?: number;
  hasEOL?: boolean;
  /** TextMarkedContent 側の識別子。読まないが、union を構造的に受けるために宣言する */
  type?: string;
}

export interface PdfPageLike {
  getViewport(options: { scale: number }): { width: number; height: number };
  getTextContent(): Promise<{ items: PdfTextItemLike[] }>;
  cleanup(): void;
}

export interface PdfDocumentLike {
  numPages: number;
  getPage(pageNumber: number): Promise<PdfPageLike>;
}

/**
 * 全ページのテキスト層を抽出する。
 * - item は読み順（コンテンツストリーム順）で連結し、hasEOL 位置に \n を挿入する
 * - `str` を持たない item（TextMarkedContent）はスキップする
 */
export async function extractTextLayerPages(doc: PdfDocumentLike): Promise<TextLayerPage[]> {
  const pages: TextLayerPage[] = [];
  for (let p = 1; p <= doc.numPages; p++) {
    const page = await doc.getPage(p);
    const viewport = page.getViewport({ scale: 1 });
    const content = await page.getTextContent();
    let text = '';
    const items: TextLayerItem[] = [];
    for (const raw of content.items) {
      if (typeof raw.str !== 'string') {
        continue;
      }
      items.push({
        charStart: text.length,
        str: raw.str,
        transform: (raw.transform ?? [1, 0, 0, 1, 0, 0]) as PdfTransform,
        width: raw.width ?? 0,
        height: raw.height ?? 0,
        hasEOL: raw.hasEOL ?? false,
      });
      text += raw.str;
      if (raw.hasEOL === true) {
        text += '\n';
      }
    }
    pages.push({ page: p, text, width: viewport.width, height: viewport.height, items });
    page.cleanup();
  }
  return pages;
}
