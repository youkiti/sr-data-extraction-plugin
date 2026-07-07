// extracted_texts/{document_id}.txt を読み、ページ別テキストへ復元する。
// extractionService（executeRun）の loadDocumentPages 依存の実装（architecture.md §2.3）
import type { DocumentRecord } from '../../domain/document';
import { getFileText } from '../../lib/google/drive';
import type { GoogleApiDeps } from '../../lib/google/types';
import type { ExtractDataPage } from '../extraction/skills/extractData';
import { parseExtractedText } from './extractedText';

/**
 * Drive の URL（webViewLink 等）からファイル ID を取り出す。
 * `/file/d/{id}/...` 形式と `?id={id}` 形式に対応。取り出せなければ null
 */
export function parseDriveFileId(url: string): string | null {
  const pathMatch = /\/(?:file\/)?d\/([\w-]+)/.exec(url);
  if (pathMatch?.[1] !== undefined) {
    return pathMatch[1];
  }
  try {
    const id = new URL(url).searchParams.get('id');
    return id === null || id === '' ? null : id;
  } catch {
    return null;
  }
}

/**
 * documents 一覧を束縛した loadDocumentPages を作る。
 * runExtraction（app/services/extractionService.ts）へそのまま注入できる
 */
export function makeLoadDocumentPages(
  documents: readonly DocumentRecord[],
  google: GoogleApiDeps,
): (documentId: string) => Promise<ExtractDataPage[]> {
  const byId = new Map(documents.map((doc) => [doc.documentId, doc]));
  return async (documentId: string): Promise<ExtractDataPage[]> => {
    const doc = byId.get(documentId);
    if (doc === undefined) {
      throw new Error(`document_id "${documentId}" が documents 一覧に見つかりません`);
    }
    if (doc.textRef === null) {
      throw new Error(`文献 "${doc.filename}" にはテキスト層がありません（text_ref なし）`);
    }
    const fileId = parseDriveFileId(doc.textRef);
    if (fileId === null) {
      throw new Error(`text_ref からファイル ID を解決できません: ${doc.textRef}`);
    }
    return parseExtractedText(await getFileText(fileId, google));
  };
}
