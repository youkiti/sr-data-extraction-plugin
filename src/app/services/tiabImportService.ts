// S3「tiab-review から採用リストを読み込む」のサービス層（issue #68・requirements.md §4.5 / ※Q2）。
// tiab-review シートの直読み（tiabSheetReader）→ include 抽出 + 反映プラン計算（tiabReview）→
// Studies 上書き + Documents 転記（各リポジトリのバッチ更新）を担い、
// AppState.documents.tiabImport の遷移を一手に引き受ける。
// view は render(state) の純粋関数のまま、コールバック経由でここを呼ぶ（architecture.md §2.2）
import { updateDocuments } from '../../features/documents/documentRepository';
import { updateStudies } from '../../features/documents/studyRepository';
import {
  parseTiabSpreadsheetId,
  planTiabImport,
  resolveAdoptedReferences,
} from '../../features/documents/tiabReview';
import { readTiabSheet } from '../../features/documents/tiabSheetReader';
import type { Store, TiabImportState } from '../store';
import { showToast } from '../ui/toast';
import { loadDocuments, type DocumentsServiceDeps } from './documentsService';

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
    plan: null,
    applying: false,
    result: null,
  });
}

/**
 * tiab-review シートを読み、最終判定 include の抽出 → 反映プランの計算までを行う（プレビュー）。
 * 実際の書き込みは applyTiabImport が担う
 */
export async function previewTiabImport(
  store: Store,
  deps: DocumentsServiceDeps,
  rawInput: string,
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
      error: 'tiab-review のスプレッドシートの URL または ID を入力してください',
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
      error: '文献一覧の読み込みが完了してから実行してください',
      plan: null,
      result: null,
    });
    return;
  }
  patchTiab(store, { sheetInput: rawInput, loading: true, error: null, plan: null, result: null });
  try {
    const sheet = await readTiabSheet(spreadsheetId, deps.google);
    const adopted = resolveAdoptedReferences(
      sheet.references,
      sheet.decisions,
      sheet.activeFulltextAiRound,
    );
    const plan = planTiabImport({ adopted, studies, documents: records });
    patchTiab(store, { loading: false, plan });
  } catch (err) {
    patchTiab(store, { loading: false, error: toMessage(err) });
  }
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
    showToast('tiab-review の採用リストを反映しました');
    await loadDocuments(store, deps, { force: true });
  } catch (err) {
    patchTiab(store, { applying: false, error: toMessage(err) });
    showToast(`取り込みに失敗しました: ${toMessage(err)}`);
  }
}
