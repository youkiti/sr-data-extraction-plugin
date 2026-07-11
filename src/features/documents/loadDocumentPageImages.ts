// no_text_layer 文書のページ画像ローダ（pdf_native 抽出経路。
// handoff-scanned-pdf-native-highlight.md §7.4 PR2）。
// loadDocumentPages.ts（テキスト層の抽出済みテキストを読む）と対になる注入ファクトリで、
// こちらは Drive の PDF バイナリを取得し、pdfjs でページを canvas へ描画してから
// PNG data URL 化・base64 抽出して LLM へ添付できる形（DocumentPageImage）にする。
import type { DocumentRecord } from '../../domain/document';
import { getFileBinary } from '../../lib/google/drive';
import type { GoogleApiDeps } from '../../lib/google/types';
import { loadDisposablePdf, type DisposablePdf } from '../../lib/pdf/loadPdf';
import { renderPdfPageToCanvas, type RenderablePdfPage } from '../../lib/pdf/renderPage';

/**
 * LLM へ添付する 1 ページぶんの画像。
 * 型は features/extraction/skills/extractData.ts の ExtractDataImagePage と同一形
 * （こちらが正典。extractData 側は import して使う）
 */
export interface DocumentPageImage {
  /** 1-indexed ページ番号 */
  page: number;
  mimeType: string;
  dataBase64: string;
}

/**
 * ページ画像の描画倍率。experiments/multimodal-bbox-spike の実測と同値。
 * 大きいほど文字の読み取り精度（LLM の OCR 相当の認識精度）は上がるが、
 * 画像トークン量 = コストも増える（lib/llm/pricing.ts の APPROX_IMAGE_TOKENS_PER_PAGE は
 * この scale を前提にした概算値）というトレードオフがある
 */
export const PAGE_IMAGE_RENDER_SCALE = 2.0;

export interface LoadDocumentPageImagesDeps {
  /**
   * PDF ロード（テスト時に fake へ差し替える）。既定は lib/pdf/loadPdf.ts の loadDisposablePdf
   */
  loadPdf?: (data: ArrayBuffer) => Promise<DisposablePdf>;
}

/**
 * documents 一覧を束縛した loadDocumentPageImages を作る。
 * executeRun（app/services/extractionService.ts 経由）へそのまま注入できる
 */
export function makeLoadDocumentPageImages(
  documents: readonly DocumentRecord[],
  google: GoogleApiDeps,
  deps: LoadDocumentPageImagesDeps = {},
): (documentId: string) => Promise<DocumentPageImage[]> {
  const byId = new Map(documents.map((doc) => [doc.documentId, doc]));
  const loadPdf = deps.loadPdf ?? loadDisposablePdf;
  return async (documentId: string): Promise<DocumentPageImage[]> => {
    const doc = byId.get(documentId);
    if (doc === undefined) {
      throw new Error(`document_id "${documentId}" が documents 一覧に見つかりません`);
    }
    const binary = await getFileBinary(doc.driveFileId, google);
    const pdf = await loadPdf(binary);
    try {
      const images: DocumentPageImage[] = [];
      for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber += 1) {
        // pdfjs の PDFPageProxy は構造的に RenderablePdfPage を満たす
        // （features/verification/pdfViewCache.ts と同じ割り切り方）
        const page = (await pdf.getPage(pageNumber)) as unknown as RenderablePdfPage;
        const canvas = document.createElement('canvas');
        // devicePixelRatio を 1 に固定する: LLM へ送るページ画像は表示用ではなく読み取り用のため、
        // 実行環境（ブラウザ / OS）の DPR で解像度・トークン量が変動してはいけない
        const { promise } = renderPdfPageToCanvas(page, canvas, PAGE_IMAGE_RENDER_SCALE, {
          devicePixelRatio: 1,
        });
        await promise;
        const dataUrl = canvas.toDataURL('image/png');
        const dataBase64 = dataUrl.slice(dataUrl.indexOf(',') + 1);
        images.push({ page: pageNumber, mimeType: 'image/png', dataBase64 });
      }
      return images;
    } finally {
      await pdf.destroy();
    }
  };
}
