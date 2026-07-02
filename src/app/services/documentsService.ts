// #/documents（S3）のサービス層。lib/google + features/documents を 1 段抽象化し、
// 画面状態（AppState.documents）の遷移を一手に引き受ける。
// view は render(state) の純粋関数のまま、コールバック経由でここを呼ぶ（architecture.md §2.2）
import type { DocumentRecord } from '../../domain/document';
import { readDocuments, updateDocument } from '../../features/documents/documentRepository';
import {
  importDocuments,
  type ImportDocumentsResult,
  type ImportStage,
} from '../../features/documents/importDocuments';
import type { DisposablePdfDocument } from '../../features/documents/extractTextLayer';
import { ensureChildFolder } from '../../lib/google/drive';
import { openPdfPicker, type PickerDeps } from '../../lib/google/picker';
import { getCurrentUserEmail, type ProfileDeps } from '../../lib/google/identity';
import type { GoogleApiDeps } from '../../lib/google/types';
import type { DocumentsState, ImportRow, Store } from '../store';
import { showToast } from '../ui/toast';

export interface DocumentsServiceDeps {
  google: GoogleApiDeps;
  profile: ProfileDeps;
  picker: PickerDeps;
  /** lib/pdf/loadPdf.ts（テストは fake で完結させるため注入） */
  loadPdf: (data: ArrayBuffer) => Promise<DisposablePdfDocument>;
}

const IMPORT_STAGE_LABELS: Record<ImportStage, string> = {
  copy: 'コピー',
  extract: 'テキスト抽出',
  save: 'Documents への保存',
};

function toMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/** documents スライスだけを差し替える setState ヘルパ（他スライスは維持） */
function patchDocuments(store: Store, patch: Partial<DocumentsState>): void {
  store.setState({ documents: { ...store.getState().documents, ...patch } });
}

/** 一覧の反映と同時に進捗カウント（ガード / #/home サマリ）も揃える */
function setRecords(store: Store, records: DocumentRecord[]): void {
  const state = store.getState();
  store.setState({
    documents: { ...state.documents, loading: false, loadError: null, records },
    counts: { ...state.counts, documents: records.length },
  });
}

/**
 * Documents タブから一覧を読み込む。読込済み（records !== null)なら force 指定時のみ再読込。
 * プロジェクト未選択・読込中は no-op
 */
export async function loadDocuments(
  store: Store,
  deps: DocumentsServiceDeps,
  options: { force?: boolean } = {},
): Promise<void> {
  const state = store.getState();
  if (!state.currentProject || state.documents.loading) {
    return;
  }
  if (state.documents.records !== null && options.force !== true) {
    return;
  }
  patchDocuments(store, { loading: true, loadError: null });
  try {
    const records = await readDocuments(state.currentProject.spreadsheetId, deps.google);
    setRecords(store, records);
  } catch (err) {
    patchDocuments(store, { loading: false, loadError: toMessage(err) });
  }
}

/** 取り込み結果を進捗行へ反映する（成功 = done / 失敗 = 段階 + 理由付きの failed） */
function finalizeImportRows(rows: ImportRow[], result: ImportDocumentsResult): ImportRow[] {
  return rows.map((row) => {
    const failure = result.failures.find((f) => f.sourceFileId === row.sourceFileId);
    if (failure) {
      return {
        ...row,
        status: 'failed',
        detail: `${IMPORT_STAGE_LABELS[failure.stage]}に失敗: ${failure.detail}`,
      };
    }
    return { ...row, status: 'done', detail: null };
  });
}

/**
 * Drive Picker を開いて選択された PDF を取り込む（S3 の中核フロー）。
 * Picker キャンセルは何もしない。ファイル単位の失敗は進捗行へ赤バッジ表示し、成功分は一覧へ反映する
 */
export async function importFromPicker(
  store: Store,
  deps: DocumentsServiceDeps,
): Promise<void> {
  const state = store.getState();
  const project = state.currentProject;
  if (!project || state.documents.importing) {
    return;
  }

  let selections: Awaited<ReturnType<typeof openPdfPicker>>;
  try {
    selections = await openPdfPicker(deps.picker);
  } catch (err) {
    showToast(`Drive Picker を開けませんでした: ${toMessage(err)}`);
    return;
  }
  if (selections === null || selections.length === 0) {
    return;
  }

  let rows: ImportRow[] = selections.map((selection) => ({
    sourceFileId: selection.sourceFileId,
    filename: selection.filename,
    status: 'queued',
    detail: null,
  }));
  patchDocuments(store, { importing: true, importRows: rows });
  const setRow = (index: number, patch: Partial<ImportRow>): void => {
    rows = rows.map((row, i) => (i === index ? { ...row, ...patch } : row));
    patchDocuments(store, { importRows: rows });
  };

  try {
    // プロジェクト生成時のサブフォルダを名前で解決する（Meta にはトップフォルダ ID しか持たないため）
    const documentsFolder = await ensureChildFolder('documents', project.driveFolderId, deps.google);
    const extractedTextsFolder = await ensureChildFolder(
      'extracted_texts',
      project.driveFolderId,
      deps.google,
    );
    const importedBy = (await getCurrentUserEmail(deps.profile)) ?? '';

    const result = await importDocuments(
      {
        spreadsheetId: project.spreadsheetId,
        documentsFolderId: documentsFolder.id,
        extractedTextsFolderId: extractedTextsFolder.id,
        selections,
        importedBy,
      },
      {
        google: deps.google,
        loadPdf: deps.loadPdf,
        onProgress: (progress) => setRow(progress.fileIndex, { status: progress.stage }),
      },
    );

    rows = finalizeImportRows(rows, result);
    const records = [...(store.getState().documents.records ?? []), ...result.imported];
    setRecords(store, records);
    patchDocuments(store, { importing: false, importRows: rows });
    if (result.failures.length > 0) {
      showToast(
        `${result.imported.length} 件取り込み、${result.failures.length} 件失敗しました`,
      );
    } else {
      showToast(`${result.imported.length} 件の PDF を取り込みました`);
    }
  } catch (err) {
    // フォルダ解決など一括で中断する失敗（ファイル単位の失敗は importDocuments が failures で返す）
    rows = rows.map((row) => ({ ...row, status: 'failed' as const, detail: toMessage(err) }));
    patchDocuments(store, { importing: false, importRows: rows });
    showToast(`取り込みに失敗しました: ${toMessage(err)}`);
  }
}

/**
 * 一覧のインライン編集で study_label を保存する（Documents は行上書き可。documentRepository 冒頭コメント）。
 * 空文字は保存せず案内し、失敗時は再描画で元の値へ戻す
 */
export async function saveStudyLabel(
  store: Store,
  deps: DocumentsServiceDeps,
  documentId: string,
  rawLabel: string,
): Promise<void> {
  const state = store.getState();
  const project = state.currentProject;
  const records = state.documents.records;
  const record = records?.find((doc) => doc.documentId === documentId);
  if (!project || !records || !record) {
    return;
  }
  const label = rawLabel.trim();
  if (label === '') {
    showToast('study_label は空にできません');
    patchDocuments(store, {}); // 再描画して入力値を元へ戻す
    return;
  }
  if (label === record.studyLabel) {
    patchDocuments(store, {}); // 前後空白だけの変更は再描画で正規化する
    return;
  }
  const updated: DocumentRecord = { ...record, studyLabel: label };
  try {
    await updateDocument(project.spreadsheetId, updated, deps.google);
    patchDocuments(store, {
      records: records.map((doc) => (doc.documentId === documentId ? updated : doc)),
    });
    showToast('study_label を保存しました');
  } catch (err) {
    showToast(`study_label の保存に失敗しました: ${toMessage(err)}`);
    patchDocuments(store, {}); // 再描画で元の値へ戻す
  }
}
