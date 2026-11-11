import type { DocumentRecord } from '../../domain/document';
import type { PreviewPdfRunWarning } from '../../domain/extractionRun';
import type { ExtractDataPage } from '../extraction/skills/extractData';
import { detectPreviewWatermark } from './detectPreviewWatermark';

export interface PreviewCheck {
  warnings: PreviewPdfRunWarning[];
  loadDocumentPages: (documentId: string) => Promise<ExtractDataPage[]>;
}

/** 確認から実行まで共有する本文ローダーを作り、プレビュー疑いを調べる。 */
export async function preparePreviewCheck(
  documents: readonly DocumentRecord[],
  load: PreviewCheck['loadDocumentPages'],
): Promise<PreviewCheck> {
  const pagesById = new Map<string, Promise<ExtractDataPage[]>>();
  const loadDocumentPages: PreviewCheck['loadDocumentPages'] = (documentId) => {
    let pages = pagesById.get(documentId);
    if (pages === undefined) {
      pages = Promise.resolve().then(() => load(documentId)).catch((error: unknown) => {
        pagesById.delete(documentId);
        throw error;
      });
      pagesById.set(documentId, pages);
    }
    return pages;
  };
  const matches = new Set<number>();
  const entries = documents.entries();
  const checkDocuments = async (): Promise<void> => {
    for (const [index, doc] of entries) {
      if (doc.textStatus === 'no_text_layer') {
        continue;
      }
      try {
        if (detectPreviewWatermark(await loadDocumentPages(doc.documentId))) {
          matches.add(index);
        }
      } catch {
        // 判定できない文書は実行時に再読込する。
      }
    }
  };
  await Promise.all(Array.from({ length: 4 }, checkDocuments));
  const warnings: PreviewPdfRunWarning[] = [];
  for (const [index, doc] of documents.entries()) {
    if (matches.has(index)) {
      warnings.push({
        kind: 'preview_pdf',
        documentId: doc.documentId,
        filename: doc.filename,
        message: `「${doc.filename}」はプレビュー版の疑いがあります。全文ではない可能性があります。結果の章が無いと AI は値を拾えません。全文の PDF に差し替えてください。`,
      });
    }
  }
  return { warnings, loadDocumentPages };
}
