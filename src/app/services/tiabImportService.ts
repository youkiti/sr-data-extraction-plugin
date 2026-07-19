// S3「tiab-review から採用リストを読み込む」のサービス層（issue #68・requirements.md §4.5 / ※Q2）。
// tiab-review シートの直読み（tiabSheetReader）→ include 抽出 + 反映プラン計算（tiabReview）→
// Studies 上書き + Documents 転記（各リポジトリのバッチ更新）を担い、
// AppState.documents.tiabImport の遷移を一手に引き受ける。
// view は render(state) の純粋関数のまま、コールバック経由でここを呼ぶ（architecture.md §2.2）
//
// アクセス拒否からの Picker 許可導線（issue #142）: tiab-review は別 OAuth クライアントが
// 作成したシートのため、drive.file スコープでは初回のみ Picker 許可が必要（#128〜#132）。
// readTiabSheet が SheetsAccessDeniedError を投げたら accessDenied フラグを立て、
// grantTiabSheetAccess（「Google で許可する」から呼ぶ）でスプレッドシート Picker を起動し、
// 許可されたらプレビューを自動リトライする（roleService.grantSpreadsheetAccess と同じトンマナ）
import { updateDocuments } from '../../features/documents/documentRepository';
import { clearTiabHandoff } from '../../features/project/tiabHandoffStore';
import { updateStudies } from '../../features/documents/studyRepository';
import {
  extractDriveFileId,
  parseTiabSpreadsheetId,
  planTiabImport,
  resolveAdoptedReferences,
} from '../../features/documents/tiabReview';
import { readTiabSheet, type TiabSheetData } from '../../features/documents/tiabSheetReader';
import {
  openProjectFilesPicker,
  openSpreadsheetPicker,
  type SpreadsheetPickResult,
} from '../../lib/google/picker';
import { SheetsAccessDeniedError } from '../../lib/google/sheets';
import type { Store, TiabHandoffState, TiabImportState } from '../store';
import { showToast } from '../ui/toast';
import { t } from '../../lib/i18n';
import {
  importPickedSelections,
  loadDocuments,
  type DocumentsServiceDeps,
} from './documentsService';

function toMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/** tiabImport スライスだけを差し替える setState ヘルパ（他スライスは維持） */
function patchTiab(store: Store, patch: Partial<TiabImportState>): void {
  const documents = store.getState().documents;
  store.setState({
    documents: { ...documents, tiabImport: { ...documents.tiabImport, ...patch } },
  });
}

/**
 * tiabHandoff スライスだけを差し替える setState ヘルパ（他スライスは維持）。
 * 直前の tiabHandoff が null（dismiss 済み・そもそも非表示）なら no-op にする
 * （runTiabHandoffImport の実行中に dismissTiabHandoff が呼ばれた場合の競合対策）
 */
function patchTiabHandoff(store: Store, patch: Partial<TiabHandoffState>): void {
  const documents = store.getState().documents;
  if (documents.tiabHandoff === null) {
    return;
  }
  store.setState({
    documents: { ...documents, tiabHandoff: { ...documents.tiabHandoff, ...patch } },
  });
}

/** 取り込みカードを開く */
export function openTiabImport(store: Store): void {
  patchTiab(store, { open: true });
}

/** 取り込みカードを閉じる（入力・プレビュー・結果を破棄して初期状態へ戻す） */
export function closeTiabImport(store: Store): void {
  patchTiab(store, {
    open: false,
    sheetInput: '',
    loading: false,
    error: null,
    accessDenied: false,
    plan: null,
    applying: false,
    result: null,
  });
}

/**
 * tiab-review シートを読み、最終判定 include の抽出 → 反映プランの計算までを行う（プレビュー）。
 * 実際の書き込みは applyTiabImport が担う。
 * prefetched を渡すとシートの再読込を省く（引き継ぎパネルの自動プレビュー用。呼び出し側が
 * 直前に読んだ TiabSheetData を流用し、Sheets API の読みを 1 往復に抑える）
 */
export async function previewTiabImport(
  store: Store,
  deps: DocumentsServiceDeps,
  rawInput: string,
  prefetched?: TiabSheetData,
): Promise<void> {
  const state = store.getState();
  const project = state.currentProject;
  const tiab = state.documents.tiabImport;
  if (!project || tiab.loading || tiab.applying) {
    return;
  }
  const spreadsheetId = parseTiabSpreadsheetId(rawInput);
  if (spreadsheetId === null) {
    patchTiab(store, {
      sheetInput: rawInput,
      error: t('documents.tiabErrInput'),
      accessDenied: false,
      plan: null,
      result: null,
    });
    return;
  }
  const records = state.documents.records;
  const studies = state.documents.studies;
  if (records === null || studies === null) {
    patchTiab(store, {
      sheetInput: rawInput,
      error: t('documents.tiabErrNotLoaded'),
      accessDenied: false,
      plan: null,
      result: null,
    });
    return;
  }
  patchTiab(store, {
    sheetInput: rawInput,
    loading: true,
    error: null,
    accessDenied: false,
    plan: null,
    result: null,
  });
  try {
    const sheet = prefetched ?? (await readTiabSheet(spreadsheetId, deps.google));
    const adopted = resolveAdoptedReferences(
      sheet.references,
      sheet.decisions,
      sheet.activeFulltextAiRound,
    );
    const plan = planTiabImport({ adopted, studies, documents: records });
    patchTiab(store, { loading: false, plan });
  } catch (err) {
    // drive.file 未許可（SheetsAccessDeniedError）は「Google で許可する」導線を出す（issue #142。
    // roleService.loadRole の accessDenied 判定と同じ考え方）
    patchTiab(store, {
      loading: false,
      error: toMessage(err),
      accessDenied: err instanceof SheetsAccessDeniedError,
    });
  }
}

/**
 * tiab-review シートへの drive.file アクセス拒否（issue #142）からの復帰導線。
 * `#tiab-error` の「Google で許可する」から呼ぶ。スプレッドシート Picker を対象 1 件に限定して開き
 * （selectProject 側 #130 の roleService.grantSpreadsheetAccess と同じトンマナ）、
 * granted ならエラー表示を消してプレビューを自動リトライする。
 * mismatch / cancelled はエラー表示・許可導線を維持したまま（再クリックできる）。
 * 呼び出し側 UI は Picker 起動中の二重クリックを DOM 側で防ぐ（roleService と同じ運用）
 */
export async function grantTiabSheetAccess(
  store: Store,
  deps: DocumentsServiceDeps,
): Promise<void> {
  const state = store.getState();
  const tiab = state.documents.tiabImport;
  if (!state.currentProject || !tiab.accessDenied || tiab.loading || tiab.applying) {
    return;
  }
  const spreadsheetId = parseTiabSpreadsheetId(tiab.sheetInput);
  if (spreadsheetId === null) {
    // accessDenied は readTiabSheet 成功後（= 入力の解釈に成功した後）にしか立たないため
    // 通常到達しないが、念のためのフェイルクローズ
    return;
  }
  let result: SpreadsheetPickResult;
  try {
    result = await openSpreadsheetPicker(deps.picker, spreadsheetId);
  } catch (err) {
    showToast(t('common.pickerFailed', { reason: toMessage(err) }));
    patchTiab(store, {});
    return;
  }
  if (result === 'cancelled') {
    patchTiab(store, {});
    return;
  }
  if (result === 'mismatch') {
    showToast(t('documents.tiabAccessMismatch'));
    patchTiab(store, {});
    return;
  }
  await previewTiabImport(store, deps, tiab.sheetInput);
}

/**
 * プレビュー済みプランを反映する（Studies.study_label の上書き + Documents.pmid / doi の転記）。
 * それぞれ 1 read + values:batchUpdate 1 回。完了後に一覧を強制再読込する
 */
export async function applyTiabImport(store: Store, deps: DocumentsServiceDeps): Promise<void> {
  const state = store.getState();
  const project = state.currentProject;
  const tiab = state.documents.tiabImport;
  const plan = tiab.plan;
  if (!project || plan === null || tiab.applying || tiab.loading) {
    return;
  }
  if (plan.studyUpdates.length === 0 && plan.documentUpdates.length === 0) {
    return;
  }
  patchTiab(store, { applying: true, error: null });
  try {
    await updateStudies(project.spreadsheetId, plan.studyUpdates, deps.google);
    await updateDocuments(project.spreadsheetId, plan.documentUpdates, deps.google);
    const unmatched = plan.items.filter((item) => item.status === 'unmatched').length;
    patchTiab(store, {
      applying: false,
      plan: null,
      result: {
        studiesUpdated: plan.studyUpdates.length,
        documentsUpdated: plan.documentUpdates.length,
        unmatched,
      },
    });
    showToast(t('documents.tiabToastApplied'));
    // 引き継ぎパネル経由の反映が確定したら storage の引き継ぎ状態をクリアする（force 再読込の
    // 同期でパネルが消える。ui-states.md §3「反映実行（#tiab-apply）成功で…」）。
    // 手動でカードに別の tiab シートを入れて反映したケースでは保留中の引き継ぎを消さないよう、
    // 反映したシートが引き継ぎ対象と一致するときだけクリアする。クリアはベストエフォート —
    // Sheets への反映は既に成功しているので、storage の失敗で成功済みの反映を失敗扱いにしない
    const handoffAfterApply = store.getState().documents.tiabHandoff;
    if (
      handoffAfterApply !== null &&
      parseTiabSpreadsheetId(tiab.sheetInput) === handoffAfterApply.tiabSheetId
    ) {
      await clearTiabHandoff(project.projectId).catch(() => undefined);
    }
    await loadDocuments(store, deps, { force: true });
  } catch (err) {
    patchTiab(store, { applying: false, error: toMessage(err) });
    showToast(t('documents.toastImportFailed', { reason: toMessage(err) }));
  }
}

/**
 * S3 tiab-review 引き継ぎパネル（S1 #popup-tiab-handoff からの継続。ui-states.md §3）の
 * 「include の PDF をまとめて取り込む」を実行する: tiab シートの直読み（drive.file は S1 の
 * Picker 選択で付与済み）→ include の fulltext_url から Drive ファイル ID を列挙（重複除去）→
 * ファイル許可モード Picker（reviewer オンボーディング #139/#141 と同じ全選択方式）→ 通常の
 * 取り込みパイプライン（documentsService.importPickedSelections）→ tiab カードを自動で開いて
 * シート ID を入力済みにし、反映プレビューを自動実行する。反映の確定（#tiab-apply）は
 * 従来どおり手動のまま（プレビュー → ユーザー確定の 2 段階を維持）
 */
export async function runTiabHandoffImport(
  store: Store,
  deps: DocumentsServiceDeps,
): Promise<void> {
  const state = store.getState();
  const project = state.currentProject;
  const handoff = state.documents.tiabHandoff;
  if (
    !project ||
    handoff === null ||
    handoff.running ||
    state.documents.importing ||
    state.documents.tiabImport.loading ||
    state.documents.tiabImport.applying
  ) {
    return;
  }
  patchTiabHandoff(store, { running: true, error: null });
  try {
    const sheet = await readTiabSheet(handoff.tiabSheetId, deps.google);
    const adopted = resolveAdoptedReferences(
      sheet.references,
      sheet.decisions,
      sheet.activeFulltextAiRound,
    );
    const fileIds = [
      ...new Set(
        adopted.includes
          .map((ref) => (ref.fulltextUrl === null ? null : extractDriveFileId(ref.fulltextUrl)))
          .filter((id): id is string => id !== null),
      ),
    ];
    if (fileIds.length === 0) {
      patchTiabHandoff(store, { running: false, error: t('documents.tiabHandoffNoFulltext') });
      return;
    }
    const selections = await openProjectFilesPicker(deps.picker, fileIds);
    if (selections === null || selections.length === 0) {
      // キャンセル / タブを閉じる / 空選択: 状態を維持する（案内・ボタンは残る）
      patchTiabHandoff(store, { running: false });
      return;
    }
    // Picker を開いている間に別の取り込みが始まっていた場合は取り込まれない（false）。
    // そのままプレビューへ進むと include が全件「PDF 未取り込み」に見えてしまうため、
    // ここで打ち切ってエラーとして知らせる
    if (!(await importPickedSelections(store, deps, selections))) {
      patchTiabHandoff(store, { running: false, error: t('documents.tiabHandoffBusy') });
      return;
    }
    openTiabImport(store);
    // シートは直前に読んだ内容を流用してプレビューする（Sheets API の読みを 1 往復に抑える）
    await previewTiabImport(store, deps, handoff.tiabSheetId, sheet);
    patchTiabHandoff(store, { running: false });
  } catch (err) {
    // Picker 起動失敗も含め、ここで一括して案内する（トーストは不要 — パネル内エラーで完結）
    patchTiabHandoff(store, { running: false, error: toMessage(err) });
  }
}

/**
 * 「この案内を閉じる」: storage の引き継ぎ状態（現在のプロジェクトぶん）を破棄してパネルを消す
 * （以降は tiab-review 採用リスト取り込みカードの従来の手動導線のみになる）
 */
export async function dismissTiabHandoff(store: Store): Promise<void> {
  const project = store.getState().currentProject;
  if (project !== null) {
    await clearTiabHandoff(project.projectId);
  }
  const documents = store.getState().documents;
  store.setState({ documents: { ...documents, tiabHandoff: null } });
}
