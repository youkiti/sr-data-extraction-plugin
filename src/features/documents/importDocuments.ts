// 文献取り込み（S3 / requirements.md ※Q9）: Picker で選択済みの PDF を
// 「documents/ へコピー（凍結スナップショット）→ テキスト層抽出 → extracted_texts/ へ保存 →
// Documents タブへ追記」まで進めるパイプライン。Picker の起動・選択は UI（S3 画面）の責務。
// 失敗したファイルは飛ばして残りを続行し、failures として返す（S3 の進捗行に赤バッジ表示）
import type { DocumentRecord } from '../../domain/document';
import { copyFile, getFileBinary, uploadTextFile } from '../../lib/google/drive';
import type { GoogleApiDeps } from '../../lib/google/types';
import { nowIso8601 } from '../../utils/iso8601';
import { generateUuid } from '../../utils/uuid';
import { appendDocuments } from './documentRepository';
import { extractTextLayer, type DisposablePdfDocument } from './extractTextLayer';

/** Picker で選択されたファイル（UI 側が渡す） */
export interface ImportSelection {
  sourceFileId: string;
  filename: string;
}

export type ImportStage =
  | 'copy' // documents/ へのコピー + 実体ダウンロード
  | 'extract' // テキスト層抽出 + extracted_texts/ への保存
  | 'save'; // Documents タブへの追記

export interface ImportFailure {
  sourceFileId: string;
  filename: string;
  stage: ImportStage;
  detail: string;
}

export interface ImportProgress {
  /** 0 始まりの処理中ファイル番号 */
  fileIndex: number;
  totalFiles: number;
  filename: string;
  /** いま始まった段階（ui-states.md の「コピー → テキスト抽出の 2 段階表示」） */
  stage: Extract<ImportStage, 'copy' | 'extract'>;
}

export interface ImportDocumentsParams {
  spreadsheetId: string;
  /** プロジェクトの documents/ フォルダ ID */
  documentsFolderId: string;
  /** プロジェクトの extracted_texts/ フォルダ ID */
  extractedTextsFolderId: string;
  selections: readonly ImportSelection[];
  /** Documents.imported_by（ログイン中ユーザーの email） */
  importedBy: string;
}

export interface ImportDocumentsDeps {
  google: GoogleApiDeps;
  /** lib/pdf/loadPdf.ts を注入する（テストは fake で完結） */
  loadPdf: (data: ArrayBuffer) => Promise<DisposablePdfDocument>;
  newUuid?: () => string;
  now?: () => string;
  onProgress?: (progress: ImportProgress) => void;
}

export interface ImportDocumentsResult {
  /** Documents タブへ追記済みのレコード（取り込み順） */
  imported: DocumentRecord[];
  failures: ImportFailure[];
}

/** study_label の初期値はファイル名（拡張子抜き）。AI 提案（suggest_study_label）は後続対応 */
export function defaultStudyLabel(filename: string): string {
  return filename.replace(/\.pdf$/i, '');
}

function toDetail(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

export async function importDocuments(
  params: ImportDocumentsParams,
  deps: ImportDocumentsDeps,
): Promise<ImportDocumentsResult> {
  const uuid = deps.newUuid ?? generateUuid;
  const now = deps.now ?? nowIso8601;

  const imported: DocumentRecord[] = [];
  const failures: ImportFailure[] = [];

  for (const [fileIndex, selection] of params.selections.entries()) {
    const fail = (stage: ImportStage, err: unknown): void => {
      failures.push({
        sourceFileId: selection.sourceFileId,
        filename: selection.filename,
        stage,
        detail: toDetail(err),
      });
    };
    const notify = (stage: ImportProgress['stage']): void => {
      deps.onProgress?.({
        fileIndex,
        totalFiles: params.selections.length,
        filename: selection.filename,
        stage,
      });
    };

    // 段階 1: documents/ へコピーし、以後はコピー（凍結スナップショット）だけを参照する
    notify('copy');
    let driveFileId: string;
    let pdfData: ArrayBuffer;
    try {
      const copied = await copyFile(
        selection.sourceFileId,
        { name: selection.filename, parentId: params.documentsFolderId },
        deps.google,
      );
      driveFileId = copied.id;
      pdfData = await getFileBinary(copied.id, deps.google);
    } catch (err) {
      fail('copy', err);
      continue;
    }

    // 段階 2: テキスト層抽出 + extracted_texts/{document_id}.txt 保存
    notify('extract');
    const documentId = uuid();
    let textRef: string | null = null;
    let textStatus: DocumentRecord['textStatus'];
    let pageCount: number;
    let charCount: number;
    try {
      const extracted = await extractTextLayer(pdfData, { loadPdf: deps.loadPdf });
      textStatus = extracted.textStatus;
      pageCount = extracted.pageCount;
      charCount = extracted.charCount;
      if (extracted.serializedText !== null) {
        const uploaded = await uploadTextFile(
          {
            name: `${documentId}.txt`,
            content: extracted.serializedText,
            parentId: params.extractedTextsFolderId,
          },
          deps.google,
        );
        textRef = uploaded.webViewLink;
      }
    } catch (err) {
      fail('extract', err);
      continue;
    }

    imported.push({
      documentId,
      studyLabel: defaultStudyLabel(selection.filename),
      driveFileId,
      sourceFileId: selection.sourceFileId,
      filename: selection.filename,
      pmid: null,
      doi: null,
      textRef,
      textStatus,
      pageCount,
      charCount,
      importedAt: now(),
      importedBy: params.importedBy,
      note: null,
    });
  }

  // 段階 3: Documents タブへ一括追記。失敗したら成功済みファイルも save 失敗として返す
  // （Drive 上のコピー / txt は残るが、Documents に行がないため UI からは見えない = 再取り込みで回復）
  if (imported.length > 0) {
    try {
      await appendDocuments(params.spreadsheetId, imported, deps.google);
    } catch (err) {
      for (const doc of imported) {
        failures.push({
          sourceFileId: doc.sourceFileId,
          filename: doc.filename,
          stage: 'save',
          detail: toDetail(err),
        });
      }
      return { imported: [], failures };
    }
  }

  return { imported, failures };
}
