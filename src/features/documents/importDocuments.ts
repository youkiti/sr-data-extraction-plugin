// 文献取り込み（S3 / requirements.md ※Q9）: Picker で選択済みの PDF、または D&D /
// ファイル選択で渡されたローカル PDF を「documents/ へコピー・アップロード（凍結スナップショット）
// → テキスト層抽出 → extracted_texts/ へ保存 → Documents タブへ追記」まで進めるパイプライン。
// Picker / ローカル選択の起動は UI（S3 画面）の責務。
// 失敗したファイルは飛ばして残りを続行し、failures として返す（S3 の進捗行に赤バッジ表示）
import { DEFAULT_DOCUMENT_ROLE, type DocumentRecord } from '../../domain/document';
import type { StudyRecord } from '../../domain/study';
import { copyFile, getFileBinary, uploadBinaryFile, uploadTextFile } from '../../lib/google/drive';
import type { GoogleApiDeps } from '../../lib/google/types';
import { nowIso8601 } from '../../utils/iso8601';
import { generateUuid } from '../../utils/uuid';
import { detectRegistrationId } from './detectRegistrationId';
import { appendDocuments } from './documentRepository';
import { appendStudies } from './studyRepository';
import { extractTextLayer, type DisposablePdfDocument } from './extractTextLayer';

/**
 * 取り込み対象 1 ファイル（Picker 選択 / ローカル D&D・ファイル選択の両対応）。
 * バイト取得元が違うだけで以降（テキスト抽出・study 生成・保存）は共通のため union で吸収する
 */
export interface ImportSelection {
  /** 進捗行・重複排除のキー（Drive = sourceFileId / ローカル = `local:{filename}:{size}`） */
  key: string;
  filename: string;
  /** Documents.source_file_id。ローカル取り込みは出所 Drive ファイルが無いため null */
  sourceFileId: string | null;
  source: { kind: 'drive'; fileId: string } | { kind: 'local'; data: ArrayBuffer };
}

export type ImportStage =
  | 'copy' // documents/ へのコピー（Drive）または新規アップロード（ローカル）+ 実体ダウンロード
  | 'extract' // テキスト層抽出 + extracted_texts/ への保存
  | 'save'; // Documents タブへの追記

export interface ImportFailure {
  /** 進捗行との突き合わせキー（ImportSelection.key と同値） */
  key: string;
  filename: string;
  stage: ImportStage;
  detail: string;
}

export interface ImportProgress {
  /** 進捗行との突き合わせキー（ImportSelection.key と同値。重複スキップで行番号がずれるため key で対応付ける） */
  key: string;
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
  /** Studies タブへ追記済みの自動生成 study（取り込み順。1 PDF = 1 study。§4.5） */
  importedStudies: StudyRecord[];
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

  const importedStudies: StudyRecord[] = [];
  const imported: DocumentRecord[] = [];
  // imported と同じ添字で進捗キーを持つ（DocumentRecord は key を持たないため段階 3 の失敗記録に使う）
  const importedKeys: string[] = [];
  const failures: ImportFailure[] = [];

  for (const [fileIndex, selection] of params.selections.entries()) {
    const fail = (stage: ImportStage, err: unknown): void => {
      failures.push({
        key: selection.key,
        filename: selection.filename,
        stage,
        detail: toDetail(err),
      });
    };
    const notify = (stage: ImportProgress['stage']): void => {
      deps.onProgress?.({
        key: selection.key,
        fileIndex,
        totalFiles: params.selections.length,
        filename: selection.filename,
        stage,
      });
    };

    // 段階 1: documents/ へコピー（Drive）または新規アップロード（ローカル）し、
    // 以後はその結果（凍結スナップショット）だけを参照する
    notify('copy');
    let driveFileId: string;
    let pdfData: ArrayBuffer;
    try {
      if (selection.source.kind === 'drive') {
        const copied = await copyFile(
          selection.source.fileId,
          { name: selection.filename, parentId: params.documentsFolderId },
          deps.google,
        );
        driveFileId = copied.id;
        pdfData = await getFileBinary(copied.id, deps.google);
      } else {
        pdfData = selection.source.data;
        const uploaded = await uploadBinaryFile(
          { name: selection.filename, data: pdfData, parentId: params.documentsFolderId },
          deps.google,
        );
        driveFileId = uploaded.id;
      }
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
    // 試験登録番号を抽出テキストから検出し、自動生成 study の初期値にする（§4.5）
    let registrationId: string | null = null;
    try {
      const extracted = await extractTextLayer(pdfData, { loadPdf: deps.loadPdf });
      textStatus = extracted.textStatus;
      pageCount = extracted.pageCount;
      charCount = extracted.charCount;
      if (extracted.serializedText !== null) {
        registrationId = detectRegistrationId(extracted.serializedText);
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

    // 1 PDF = 1 study を自動生成する（§4.5。グルーピングは取り込み後の S3 で行う）
    const studyId = uuid();
    importedStudies.push({
      studyId,
      studyLabel: defaultStudyLabel(selection.filename),
      registrationId,
      createdAt: now(),
      createdBy: params.importedBy,
      note: null,
    });
    imported.push({
      documentId,
      studyId,
      documentRole: DEFAULT_DOCUMENT_ROLE,
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
    importedKeys.push(selection.key);
  }

  // 段階 3: Studies → Documents の順で一括追記（Documents.study_id が必ず解決できる不変条件）。
  // 失敗したら成功済みファイルも save 失敗として返す
  // （Drive 上のコピー / txt・参照 0 の Studies 行は残るが、Documents に行がないため UI からは見えない
  //   = 再取り込みで回復。参照 0 の study は非アクティブ扱いで一覧に出ない §3.2）
  if (imported.length > 0) {
    try {
      await appendStudies(params.spreadsheetId, importedStudies, deps.google);
      await appendDocuments(params.spreadsheetId, imported, deps.google);
    } catch (err) {
      imported.forEach((doc, i) => {
        failures.push({
          key: importedKeys[i] as string,
          filename: doc.filename,
          stage: 'save',
          detail: toDetail(err),
        });
      });
      return { importedStudies: [], imported: [], failures };
    }
  }

  return { importedStudies, imported, failures };
}
