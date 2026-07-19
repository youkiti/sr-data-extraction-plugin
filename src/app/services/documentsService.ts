// #/documents（S3）のサービス層。lib/google + features/documents を 1 段抽象化し、
// 画面状態（AppState.documents）の遷移を一手に引き受ける。
// v0.10 で study / document を分離: 取り込みは 1 PDF = 1 study 自動生成、S3 で後から統合する（§4.5）。
// view は render(state) の純粋関数のまま、コールバック経由でここを呼ぶ（architecture.md §2.2）
import type { DocumentRecord, DocumentRole } from '../../domain/document';
import type { ProjectRef } from '../../domain/project';
import type { StudyRecord } from '../../domain/study';
import {
  dedupSelections,
  DUPLICATE_REASON_LABELS,
} from '../../features/documents/dedupSelections';
import { readDocuments, updateDocument } from '../../features/documents/documentRepository';
import {
  findMergeCandidates,
  hasExtractedData,
  ignoredCandidateKey,
  mergeStudies,
} from '../../features/documents/groupStudies';
import {
  importDocuments,
  type ImportDocumentsResult,
  type ImportSelection,
  type ImportStage,
} from '../../features/documents/importDocuments';
import type { DisposablePdfDocument } from '../../features/documents/extractTextLayer';
import {
  appendStudies,
  readStudies,
  resolveActiveStudies,
  updateStudy,
} from '../../features/documents/studyRepository';
import { readRunStudyCoverage } from '../../features/extraction/runRepository';
import { loadTiabHandoff } from '../../features/project/tiabHandoffStore';
import { ensureChildFolder, listFolderPdfs } from '../../lib/google/drive';
import {
  FOLDER_MIME_TYPE,
  openPdfPicker,
  type PickerDeps,
  type PickerSelection,
} from '../../lib/google/picker';
import { getCurrentUserEmail, type ProfileDeps } from '../../lib/google/identity';
import type { GoogleApiDeps } from '../../lib/google/types';
import { getLocal, setLocal } from '../../lib/storage/chromeStorage';
import { nowIso8601 } from '../../utils/iso8601';
import { generateUuid } from '../../utils/uuid';
import type { DocumentsState, ImportRow, MergeDialogState, Store, TiabHandoffState } from '../store';
import { showToast } from '../ui/toast';
import { t, type MessageKey } from '../../lib/i18n';

export interface DocumentsServiceDeps {
  google: GoogleApiDeps;
  profile: ProfileDeps;
  picker: PickerDeps;
  /** lib/pdf/loadPdf.ts（テストは fake で完結させるため注入） */
  loadPdf: (data: ArrayBuffer) => Promise<DisposablePdfDocument>;
  /** テスト差し替え用の UUID 発番 / 現在時刻 */
  newUuid?: () => string;
  now?: () => string;
}

// 表示言語に追従させるため、段階ラベルは使用時に t() で解決する（キー対応表のみ固定。issue #93）
const IMPORT_STAGE_LABEL_KEYS: Record<ImportStage, MessageKey> = {
  copy: 'documents.stageCopy',
  extract: 'documents.stageExtract',
  save: 'documents.stageSave',
};

/** 無視した統合候補ペアを保存する storage.local キー（プロジェクト単位。§4.5） */
export function ignoredCandidatesKey(spreadsheetId: string): string {
  return `sr-data-extraction:ignored-merge-candidates:${spreadsheetId}`;
}

function toMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/** documents スライスだけを差し替える setState ヘルパ（他スライスは維持） */
function patchDocuments(store: Store, patch: Partial<DocumentsState>): void {
  store.setState({ documents: { ...store.getState().documents, ...patch } });
}

/**
 * Documents / Studies 一覧 + 抽出済み study + 無視候補を読み込む。
 * 読込済み（records !== null)なら force 指定時のみ再読込。プロジェクト未選択・読込中は no-op
 */
export async function loadDocuments(
  store: Store,
  deps: DocumentsServiceDeps,
  options: { force?: boolean } = {},
): Promise<void> {
  const state = store.getState();
  const project = state.currentProject;
  if (!project || state.documents.loading) {
    return;
  }
  if (state.documents.records !== null && options.force !== true) {
    return;
  }
  patchDocuments(store, { loading: true, loadError: null });
  try {
    const spreadsheetId = project.spreadsheetId;
    const records = await readDocuments(spreadsheetId, deps.google);
    const studies = await readStudies(spreadsheetId, deps.google);
    const coverage = await readRunStudyCoverage(spreadsheetId, deps.google);
    const ignored = (await getLocal<string[]>(ignoredCandidatesKey(spreadsheetId))) ?? [];
    // 引き継ぎ状態（プロジェクト単位キー）の読み出しは Sheets 読みの後 = setState の直前に置く。
    // Sheets 読み中に「この案内を閉じる」で storage が破棄された場合に、先に読んだ古い値で
    // パネルを復活させてしまう競合窓を最小化するため
    const handoff = await loadTiabHandoff(project.projectId);
    const current = store.getState();
    // 取り込み完了後の force 再読込中でも running / error 表示が消えないよう、
    // 直前の tiabHandoff があればその running / error を維持する
    const previousHandoff = current.documents.tiabHandoff;
    const tiabHandoff: TiabHandoffState | null =
      handoff !== null
        ? {
            tiabSheetId: handoff.tiabSheetId,
            running: previousHandoff?.running ?? false,
            error: previousHandoff?.error ?? null,
          }
        : null;
    store.setState({
      documents: {
        ...current.documents,
        loading: false,
        loadError: null,
        records,
        studies,
        extractedStudyIds: [...coverage.extracted],
        ignoredCandidateKeys: ignored,
        selectedStudyIds: [],
        tiabHandoff,
      },
      counts: { ...current.counts, documents: records.length },
    });
  } catch (err) {
    patchDocuments(store, { loading: false, loadError: toMessage(err) });
  }
}

/** 取り込み結果を進捗行へ反映する（成功 = done / 失敗 = 段階 + 理由付きの failed。重複スキップ行は据え置き） */
function finalizeImportRows(rows: ImportRow[], result: ImportDocumentsResult): ImportRow[] {
  return rows.map((row) => {
    if (row.status === 'skipped') {
      return row;
    }
    const failure = result.failures.find((f) => f.key === row.key);
    if (failure) {
      return {
        ...row,
        status: 'failed',
        detail: t('documents.stageFailed', {
          stage: t(IMPORT_STAGE_LABEL_KEYS[failure.stage]),
          detail: failure.detail,
        }),
      };
    }
    return { ...row, status: 'done', detail: null };
  });
}

/** 完了トースト文言（ui-states.md §3「重複スキップ」。従来 2 文言はスキップ 0 件時に維持） */
function importResultToast(imported: number, skipped: number, failed: number): string {
  if (skipped === 0 && failed === 0) {
    return t('documents.toastImported', { n: imported });
  }
  if (imported === 0 && failed === 0) {
    return t('documents.toastAllSkipped', { n: skipped });
  }
  const parts = [t('documents.toastMixedImported', { n: imported })];
  if (skipped > 0) {
    parts.push(t('documents.toastMixedSkipped', { n: skipped }));
  }
  if (failed > 0) {
    parts.push(t('documents.toastMixedFailed', { n: failed }));
  }
  return t('documents.toastMixedSuffix', { parts: parts.join('、') });
}

/**
 * Picker の選択（ファイル + フォルダ混在）を取り込み対象の PDF 一覧へ展開する。
 * フォルダは直下 PDF を列挙して個別選択ファイルと結合し、sourceFileId（= key）で重複排除する
 * （同じ PDF が個別選択とフォルダ配下で二重に来ても 1 回だけ取り込む）。
 * 列挙失敗は例外を投げる（呼び出し側で中断）
 */
async function expandSelections(
  selections: readonly PickerSelection[],
  deps: DocumentsServiceDeps,
): Promise<ImportSelection[]> {
  const files: ImportSelection[] = [];
  for (const selection of selections) {
    if (selection.mimeType === FOLDER_MIME_TYPE) {
      const pdfs = await listFolderPdfs(selection.sourceFileId, deps.google);
      for (const pdf of pdfs) {
        files.push({
          key: pdf.id,
          filename: pdf.name,
          sourceFileId: pdf.id,
          source: { kind: 'drive', fileId: pdf.id },
        });
      }
    } else {
      files.push({
        key: selection.sourceFileId,
        filename: selection.filename,
        sourceFileId: selection.sourceFileId,
        source: { kind: 'drive', fileId: selection.sourceFileId },
      });
    }
  }
  const seen = new Set<string>();
  return files.filter((file) => {
    if (seen.has(file.key)) {
      return false;
    }
    seen.add(file.key);
    return true;
  });
}

/**
 * 展開済みの取り込み対象を実際に実行する（Drive Picker 経路・ローカル D&D / ファイル選択
 * 経路で共通）。進捗行の初期化 → documents/extracted_texts フォルダ解決 → importDocuments
 * 呼び出し → 結果を records/studies へ反映 → トースト、まで面倒を見る。
 * importing フラグを既に立てているかどうかは呼び出し側の責務（本関数は立て直すだけ）
 */
async function runImportSelections(
  store: Store,
  deps: DocumentsServiceDeps,
  project: ProjectRef,
  fileSelections: readonly ImportSelection[],
): Promise<void> {
  let rows: ImportRow[] = fileSelections.map((selection) => ({
    key: selection.key,
    filename: selection.filename,
    status: 'queued',
    detail: null,
  }));
  patchDocuments(store, { importing: true, importRows: rows });
  // 重複スキップで importDocuments へ渡す選択が行より少なくなりうるため、行番号ではなく key で対応付ける
  const setRowByKey = (key: string, patch: Partial<ImportRow>): void => {
    rows = rows.map((row) => (row.key === key ? { ...row, ...patch } : row));
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

    // 重複取り込みの防止（issue #102 / §4.5）: 既存 Documents と突き合わせて重複をスキップする。
    // records 未読込なら Sheets から読む（判定は常に保存済みの一覧に対して行う）。
    // 判定中の API 失敗は catch へ伝播させて取り込み全体を中断する（フェイルクローズ）
    const existingDocuments =
      store.getState().documents.records ??
      (await readDocuments(project.spreadsheetId, deps.google));
    const dedup = await dedupSelections(
      {
        selections: fileSelections,
        existingDocuments,
        documentsFolderId: documentsFolder.id,
      },
      { google: deps.google },
    );
    for (const skip of dedup.skipped) {
      setRowByKey(skip.key, { status: 'skipped', detail: DUPLICATE_REASON_LABELS[skip.reason] });
    }

    const result: ImportDocumentsResult =
      dedup.accepted.length === 0
        ? { importedStudies: [], imported: [], failures: [] }
        : await importDocuments(
            {
              spreadsheetId: project.spreadsheetId,
              documentsFolderId: documentsFolder.id,
              extractedTextsFolderId: extractedTextsFolder.id,
              selections: dedup.accepted,
              importedBy,
            },
            {
              google: deps.google,
              loadPdf: deps.loadPdf,
              newUuid: deps.newUuid,
              now: deps.now,
              onProgress: (progress) => setRowByKey(progress.key, { status: progress.stage }),
            },
          );

    rows = finalizeImportRows(rows, result);
    const after = store.getState();
    const records = [...(after.documents.records ?? []), ...result.imported];
    const studies = [...(after.documents.studies ?? []), ...result.importedStudies];
    store.setState({
      documents: {
        ...after.documents,
        loading: false,
        loadError: null,
        records,
        studies,
        importing: false,
        importRows: rows,
      },
      counts: { ...after.counts, documents: records.length },
    });
    showToast(
      importResultToast(result.imported.length, dedup.skipped.length, result.failures.length),
    );
  } catch (err) {
    // フォルダ解決など一括で中断する失敗（ファイル単位の失敗は importDocuments が failures で返す）
    rows = rows.map((row) => ({ ...row, status: 'failed' as const, detail: toMessage(err) }));
    patchDocuments(store, { importing: false, importRows: rows });
    showToast(t('documents.toastImportFailed', { reason: toMessage(err) }));
  }
}

/**
 * Picker で確定した選択（ファイル + フォルダ混在）を実際に取り込む（フォルダの展開 →
 * runImportSelections 呼び出しまでを担う共通処理）。importFromPicker の Picker 確定後の処理を
 * 抽出したもので、tiab-review 引き継ぎパネル（tiabImportService.runTiabHandoffImport。
 * ui-states.md §3）のファイル許可モード Picker 確定後の取り込みとしても再利用する。
 * project 未選択・取り込み中は取り込まずに false を返す（Picker 確定は非同期のため、
 * Picker を開いている間に別の取り込みが始まっていることがある。黙って捨てると
 * 「選択したのに何も起きない」になるので、呼び出し側が false を見てユーザーへ知らせる）。
 * 取り込み処理に入った（結果はトースト / 進捗行で提示済み）ときは true
 */
export async function importPickedSelections(
  store: Store,
  deps: DocumentsServiceDeps,
  selections: readonly PickerSelection[],
): Promise<boolean> {
  const state = store.getState();
  const project = state.currentProject;
  if (!project || state.documents.importing || selections.length === 0) {
    return false;
  }

  // フォルダ選択を直下 PDF へ展開する（列挙に数秒かかりうるため先に importing を立てる）
  patchDocuments(store, { importing: true });
  if (selections.some((selection) => selection.mimeType === FOLDER_MIME_TYPE)) {
    showToast(t('documents.toastExpandingFolder'));
  }
  let fileSelections: ImportSelection[];
  try {
    fileSelections = await expandSelections(selections, deps);
  } catch (err) {
    patchDocuments(store, { importing: false });
    showToast(t('documents.toastFolderFailed', { reason: toMessage(err) }));
    return true;
  }
  if (fileSelections.length === 0) {
    patchDocuments(store, { importing: false });
    showToast(t('documents.toastNoPdfInFolder'));
    return true;
  }

  await runImportSelections(store, deps, project, fileSelections);
  return true;
}

/**
 * Drive Picker を開いて選択された PDF を取り込む（S3 の中核フロー）。
 * ファイルに加えてフォルダも選択でき、フォルダは直下 PDF を列挙して一括取り込みする。
 * 1 PDF = 1 study を自動生成する（§4.5）。Picker キャンセルは何もしない。
 * ファイル単位の失敗は進捗行へ赤バッジ表示し、成功分は一覧へ反映する
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
    showToast(t('common.pickerFailed', { reason: toMessage(err) }));
    return;
  }
  if (selections === null || selections.length === 0) {
    return;
  }

  // Picker を開いている間に別の取り込み（ローカル D&D 等）が始まっていた場合、確定した
  // 選択は取り込まれない。黙って捨てると「選択したのに何も起きない」になるため知らせる
  if (!(await importPickedSelections(store, deps, selections))) {
    showToast(t('documents.toastImportBusy'));
  }
}

/** ローカルファイルの進捗行キー兼バッチ内の粗い重複排除キー（filename + size。内容同一の判定は dedupSelections の MD5 が担う） */
function localFileKey(file: File): string {
  return `local:${file.name}:${file.size}`;
}

/** application/pdf の MIME か .pdf 拡張子かで PDF 判定する（ローカル D&D はドラッグ元により MIME が空のことがある） */
function isPdfFile(file: File): boolean {
  return file.type === 'application/pdf' || /\.pdf$/i.test(file.name);
}

/**
 * ローカル PDF（D&D / ファイル選択ダイアログ）を取り込む（S3。Drive Picker 経路の追加手段）。
 * 出所 Drive ファイルが無いため、コピー段は importDocuments 側で documents/ への新規
 * アップロード（uploadBinaryFile）に切り替わる。ここでの重複排除は filename + size による
 * バッチ内の粗い間引きのみで、クロスセッション・内容同一の判定は runImportSelections の
 * dedupSelections（MD5 突き合わせ。issue #102）が両経路共通で行う
 */
export async function importFromFiles(
  store: Store,
  deps: DocumentsServiceDeps,
  files: readonly File[],
): Promise<void> {
  const state = store.getState();
  const project = state.currentProject;
  if (!project || state.documents.importing) {
    return;
  }

  const pdfFiles = files.filter(isPdfFile);
  const excludedCount = files.length - pdfFiles.length;

  const seen = new Set<string>();
  const targets = pdfFiles.filter((file) => {
    const key = localFileKey(file);
    if (seen.has(key)) {
      return false;
    }
    seen.add(key);
    return true;
  });

  if (targets.length === 0) {
    if (excludedCount > 0) {
      showToast(t('documents.toastNoPdfSelected'));
    }
    return;
  }
  if (excludedCount > 0) {
    showToast(t('documents.toastExcluded', { n: excludedCount }));
  }

  const fileSelections: ImportSelection[] = await Promise.all(
    targets.map(async (file) => ({
      key: localFileKey(file),
      filename: file.name,
      sourceFileId: null,
      source: { kind: 'local' as const, data: await file.arrayBuffer() },
    })),
  );

  await runImportSelections(store, deps, project, fileSelections);
}

/** 対象 study を find するヘルパ（未読込・未選択なら null） */
function findStudy(store: Store, studyId: string): StudyRecord | null {
  return store.getState().documents.studies?.find((s) => s.studyId === studyId) ?? null;
}

/**
 * study_label のインライン編集を保存する（Studies 行の上書き。§3.1）。
 * 空文字は保存せず案内し、失敗時は再描画で元の値へ戻す
 */
export async function saveStudyLabel(
  store: Store,
  deps: DocumentsServiceDeps,
  studyId: string,
  rawLabel: string,
): Promise<void> {
  const project = store.getState().currentProject;
  const study = findStudy(store, studyId);
  if (!project || !study) {
    return;
  }
  const label = rawLabel.trim();
  if (label === '') {
    showToast(t('documents.toastLabelEmpty'));
    patchDocuments(store, {}); // 再描画して入力値を元へ戻す
    return;
  }
  if (label === study.studyLabel) {
    patchDocuments(store, {}); // 前後空白だけの変更は再描画で正規化する
    return;
  }
  await saveStudyField(store, deps, project.spreadsheetId, { ...study, studyLabel: label }, 'study_label');
}

/**
 * registration_id のインライン編集を保存する（空は null へ解除）。
 */
export async function saveRegistrationId(
  store: Store,
  deps: DocumentsServiceDeps,
  studyId: string,
  rawValue: string,
): Promise<void> {
  const project = store.getState().currentProject;
  const study = findStudy(store, studyId);
  if (!project || !study) {
    return;
  }
  const value = rawValue.trim();
  const next = value === '' ? null : value;
  if (next === study.registrationId) {
    patchDocuments(store, {}); // 変化なしは再描画で正規化
    return;
  }
  await saveStudyField(store, deps, project.spreadsheetId, { ...study, registrationId: next }, 'registration_id');
}

/** Studies 行の上書き（共通）。成功は楽観反映、失敗はトースト + 再描画で元へ戻す */
async function saveStudyField(
  store: Store,
  deps: DocumentsServiceDeps,
  spreadsheetId: string,
  updated: StudyRecord,
  label: string,
): Promise<void> {
  try {
    await updateStudy(spreadsheetId, updated, deps.google);
    // 呼び出し側で対象 study を検出済みのため studies は非 null
    const studies = store.getState().documents.studies as StudyRecord[];
    patchDocuments(store, {
      studies: studies.map((s) => (s.studyId === updated.studyId ? updated : s)),
    });
    showToast(t('documents.toastFieldSaved', { field: label }));
  } catch (err) {
    showToast(t('documents.toastFieldSaveFailed', { field: label, reason: toMessage(err) }));
    patchDocuments(store, {}); // 再描画で元の値へ戻す
  }
}

/** document_role のインライン編集を保存する（Documents 行の上書き） */
export async function saveDocumentRole(
  store: Store,
  deps: DocumentsServiceDeps,
  documentId: string,
  role: DocumentRole,
): Promise<void> {
  const state = store.getState();
  const project = state.currentProject;
  const record = state.documents.records?.find((doc) => doc.documentId === documentId);
  if (!project || !record || record.documentRole === role) {
    patchDocuments(store, {});
    return;
  }
  const updated: DocumentRecord = { ...record, documentRole: role };
  try {
    await updateDocument(project.spreadsheetId, updated, deps.google);
    // 呼び出し側で対象 document を検出済みのため records は非 null
    const records = store.getState().documents.records as DocumentRecord[];
    patchDocuments(store, {
      records: records.map((doc) => (doc.documentId === documentId ? updated : doc)),
    });
    showToast(t('documents.toastFieldSaved', { field: 'document_role' }));
  } catch (err) {
    showToast(t('documents.toastFieldSaveFailed', { field: 'document_role', reason: toMessage(err) }));
    patchDocuments(store, {});
  }
}

/** 統合対象チェックボックスの切替 */
export function toggleStudySelection(store: Store, studyId: string, selected: boolean): void {
  const current = store.getState().documents.selectedStudyIds;
  if (selected) {
    if (!current.includes(studyId)) {
      patchDocuments(store, { selectedStudyIds: [...current, studyId] });
    }
  } else {
    patchDocuments(store, { selectedStudyIds: current.filter((id) => id !== studyId) });
  }
}

/** 選択中 study からの統合ダイアログを開く（2 件以上必要） */
export function openMergeDialog(store: Store): void {
  openMergeFor(store, store.getState().documents.selectedStudyIds);
}

/** 統合候補バナーからの統合ダイアログを開く */
export function openMergeCandidate(store: Store, studyIds: readonly string[]): void {
  openMergeFor(store, studyIds);
}

/** ダイアログの初期値を計算して開く（既定 = 最初に取り込まれた study の値。§4.5） */
function openMergeFor(store: Store, studyIds: readonly string[]): void {
  const state = store.getState().documents;
  const set = new Set(studyIds);
  const ordered = (state.studies ?? []).filter((s) => set.has(s.studyId));
  if (ordered.length < 2) {
    showToast(t('documents.toastMergeNeedTwo'));
    return;
  }
  const first = ordered[0] as StudyRecord;
  const dialog: MergeDialogState = {
    studyIds: ordered.map((s) => s.studyId),
    label: first.studyLabel,
    registrationId: first.registrationId ?? '',
    hasExtractedData: hasExtractedData(
      ordered.map((s) => s.studyId),
      new Set(state.extractedStudyIds),
    ),
  };
  patchDocuments(store, { mergeDialog: dialog, mergeError: null });
}

/** 統合ダイアログの入力（label / registration_id）を更新する */
export function updateMergeDialog(store: Store, patch: Partial<MergeDialogState>): void {
  const dialog = store.getState().documents.mergeDialog;
  if (dialog === null) {
    return;
  }
  patchDocuments(store, { mergeDialog: { ...dialog, ...patch } });
}

export function cancelMerge(store: Store): void {
  patchDocuments(store, { mergeDialog: null, mergeError: null });
}

/**
 * 統合を確定する（§4.5）。新 study_id を発行して Studies へ追記し、対象文書の study_id を付け替える。
 * 旧 study 行は残置（追記型）＝ 参照 0 になり非アクティブ化する。完了後に一覧を再読込する
 */
export async function confirmMerge(
  store: Store,
  deps: DocumentsServiceDeps,
): Promise<void> {
  const state = store.getState();
  const project = state.currentProject;
  const dialog = state.documents.mergeDialog;
  if (!project || dialog === null || state.documents.merging) {
    return;
  }
  const studies = state.documents.studies ?? [];
  const records = state.documents.records ?? [];
  patchDocuments(store, { merging: true, mergeError: null });
  try {
    const createdBy = (await getCurrentUserEmail(deps.profile)) ?? '';
    const result = mergeStudies({
      studies,
      documents: records,
      targetStudyIds: dialog.studyIds,
      label: dialog.label.trim() === '' ? undefined : dialog.label.trim(),
      registrationId: dialog.registrationId.trim() === '' ? null : dialog.registrationId.trim(),
      createdBy,
      createdAt: (deps.now ?? nowIso8601)(),
      newStudyId: (deps.newUuid ?? generateUuid)(),
    });
    await appendStudies(project.spreadsheetId, [result.newStudy], deps.google);
    // reassignments は records から生成されるため対応 document は必ず存在する
    const byId = new Map(records.map((doc) => [doc.documentId, doc]));
    for (const reassign of result.reassignments) {
      const doc = byId.get(reassign.documentId) as DocumentRecord;
      await updateDocument(project.spreadsheetId, { ...doc, studyId: reassign.studyId }, deps.google);
    }
    patchDocuments(store, { merging: false, mergeDialog: null, selectedStudyIds: [] });
    showToast(t('documents.toastMerged'));
    await loadDocuments(store, deps, { force: true });
  } catch (err) {
    patchDocuments(store, { merging: false, mergeError: toMessage(err) });
    showToast(t('documents.toastMergeFailed', { reason: toMessage(err) }));
  }
}

/**
 * 統合候補を無視する（storage.local へ永続化して再提案を抑止。§4.5）。
 * シートには書かない
 */
export async function ignoreCandidate(
  store: Store,
  deps: DocumentsServiceDeps,
  studyIds: readonly string[],
): Promise<void> {
  const project = store.getState().currentProject;
  if (!project) {
    return;
  }
  const key = ignoredCandidateKey(studyIds);
  const current = store.getState().documents.ignoredCandidateKeys;
  if (current.includes(key)) {
    return;
  }
  const next = [...current, key];
  patchDocuments(store, { ignoredCandidateKeys: next });
  try {
    await setLocal(ignoredCandidatesKey(project.spreadsheetId), next);
  } catch (err) {
    showToast(t('documents.toastIgnoreFailed', { reason: toMessage(err) }));
  }
}

/**
 * 表示中のアクティブ study（Documents から参照される study。作成順）と、その配下文書を返す。
 * view が描画に使う純粋な派生（非アクティブ study は一覧に出さない §3.2）
 */
export function activeStudyGroups(
  studies: readonly StudyRecord[],
  documents: readonly DocumentRecord[],
): { study: StudyRecord; documents: DocumentRecord[] }[] {
  const active = resolveActiveStudies(studies, documents);
  return active.map((study) => ({
    study,
    documents: documents.filter((doc) => doc.studyId === study.studyId),
  }));
}

/** 未無視の統合候補（registration_id 一致のアクティブ study が複数）を返す */
export function visibleMergeCandidates(state: DocumentsState): ReturnType<typeof findMergeCandidates> {
  const active = resolveActiveStudies(state.studies ?? [], state.records ?? []);
  const ignored = new Set(state.ignoredCandidateKeys);
  return findMergeCandidates(active).filter(
    (candidate) => !ignored.has(ignoredCandidateKey(candidate.studyIds)),
  );
}
