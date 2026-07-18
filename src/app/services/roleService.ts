// プロジェクトに対する実効ロールの解決 + reviewer オンボーディング（フォルダアクセス付与）。
// docs/design-independent-dual-review.md §1（ロールモデル）・§7.2（reviewer 側オンボーディング）。
//
// ロール解決はメインビュー起動時に 1 回行う: ログイン email が Meta.created_by と一致 → owner。
// Reviewers の有効行（latest-wins）に一致 → role='adjudicator' なら adjudicator、role='reviewer' なら
// review_mode により reviewer_with_ai / reviewer_independent。どちらでもない（revoked 含む）→
// unregistered（bootstrap 側が全画面エラーで以降の読み込みを中断する）
import type { ProjectRole } from '../../domain/reviewer';
import { readDocuments } from '../../features/documents/documentRepository';
import { parseDriveFileId } from '../../features/documents/loadDocumentPages';
import { loadProjectMeta } from '../../features/project/selectProject';
import { latestReviewerAssignment, readReviewerAssignments } from '../../features/project/reviewerRepository';
import { getFileText } from '../../lib/google/drive';
import { getCurrentUserEmail, type ProfileDeps } from '../../lib/google/identity';
import {
  openPdfPicker,
  openSpreadsheetPicker,
  type PickerDeps,
  type SpreadsheetPickResult,
} from '../../lib/google/picker';
import { SheetsAccessDeniedError } from '../../lib/google/sheets';
import type { GoogleApiDeps } from '../../lib/google/types';
import { getLocal, setLocal } from '../../lib/storage/chromeStorage';
import type { RoleState, Store } from '../store';
import { showToast } from '../ui/toast';
import { t } from '../../lib/i18n';

export interface RoleServiceDeps {
  google: GoogleApiDeps;
  profile: ProfileDeps;
  picker: PickerDeps;
  /** 許可後の再解決リトライの間隔待ち（テストで固定するため注入可能。省略時 setTimeout） */
  sleep?: (ms: number) => Promise<void>;
}

function toMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/** role スライスだけを差し替える setState ヘルパ（他スライスは維持） */
function patchRole(store: Store, patch: Partial<RoleState>): void {
  store.setState({ role: { ...store.getState().role, ...patch } });
}

/**
 * ログイン email のプロジェクトに対する実効ロールを解決する（ネットワーク I/O あり）。
 * Meta.created_by との一致判定に loadProjectMeta を再利用する（projectService と同じ Meta 読み出し経路）
 */
export async function resolveProjectRole(
  spreadsheetId: string,
  deps: RoleServiceDeps,
): Promise<ProjectRole> {
  const email = (await getCurrentUserEmail(deps.profile)) ?? '';
  const meta = await loadProjectMeta(spreadsheetId, deps.google);
  if (email !== '' && email === meta.createdBy) {
    return 'owner';
  }
  const assignments = await readReviewerAssignments(spreadsheetId, deps.google);
  const mine = latestReviewerAssignment(assignments, email);
  if (mine === null || mine.role === 'revoked') {
    return 'unregistered';
  }
  if (mine.role === 'adjudicator') {
    return 'adjudicator';
  }
  return mine.reviewMode === 'independent' ? 'reviewer_independent' : 'reviewer_with_ai';
}

/** プロジェクトフォルダのアクセス付与フラグを保存する storage.local キー（プロジェクト単位） */
export function folderAccessStorageKey(spreadsheetId: string): string {
  return `sr-data-extraction:folder-access-granted:${spreadsheetId}`;
}

/**
 * ロールを解決して store へ反映する（bootstrap の起動シーケンスで 1 回。§1）。
 * 既に解決済み（role.role !== null）・解決中・プロジェクト未選択なら no-op（loadProgressCounts と同じ運用）。
 * owner はフォルダアクセス付与が不要なため常に付与済み扱いにする
 */
export async function loadRole(store: Store, deps: RoleServiceDeps): Promise<void> {
  const state = store.getState();
  const project = state.currentProject;
  if (!project || state.role.resolving || state.role.role !== null) {
    return;
  }
  patchRole(store, { resolving: true, error: null, accessDenied: false });
  try {
    const role = await resolveProjectRole(project.spreadsheetId, deps);
    const folderAccessGranted =
      role === 'owner' ? true : (await getLocal<boolean>(folderAccessStorageKey(project.spreadsheetId))) === true;
    patchRole(store, { role, resolving: false, error: null, folderAccessGranted });
  } catch (err) {
    patchRole(store, {
      resolving: false,
      error: toMessage(err),
      // drive.file のアクセス拒否なら「Google で許可する」導線を出す（issue #131。
      // 既存コラボレータは currentProject が残ったまま再入場するため、この経路が主動線）
      accessDenied: err instanceof SheetsAccessDeniedError,
    });
  }
}

/** 許可後の再解決リトライ（docs/ui-states.md §3 ロール解決。popup の導線と同じ間隔） */
const GRANT_RETRY_MAX = 3;
const GRANT_RETRY_INTERVAL_MS = 2_000;

/**
 * 再入場時のアクセス許可誘導（issue #131）。ロールエラー画面の「Google で許可する」から呼ぶ。
 * スプレッドシート Picker で drive.file を付与 → ロールを未解決に戻して再解決（最大 3 回・
 * 約 2 秒間隔）。なお拒否が続けば一般エラーへ切り替えて打ち切る（再誘導ループしない）。
 * すべての終端で store をパッチし、呼び出し側 UI（disabled 化したボタン）を再描画させる
 */
export async function grantSpreadsheetAccess(store: Store, deps: RoleServiceDeps): Promise<void> {
  const project = store.getState().currentProject;
  if (!project) {
    return;
  }
  let result: SpreadsheetPickResult;
  try {
    result = await openSpreadsheetPicker(deps.picker, project.spreadsheetId);
  } catch (err) {
    showToast(t('common.pickerFailed', { reason: toMessage(err) }));
    patchRole(store, {});
    return;
  }
  if (result === 'cancelled') {
    patchRole(store, {});
    return;
  }
  if (result === 'mismatch') {
    showToast(t('app.roleAccessMismatch'));
    patchRole(store, {});
    return;
  }
  const sleep =
    deps.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  for (let attempt = 1; attempt <= GRANT_RETRY_MAX; attempt += 1) {
    patchRole(store, { role: null, resolving: false, error: null, accessDenied: false });
    await loadRole(store, deps);
    if (!store.getState().role.accessDenied) {
      // 解決成功、またはアクセス以外のエラー（通常のロールエラー表示に任せる）
      return;
    }
    if (attempt < GRANT_RETRY_MAX) {
      await sleep(GRANT_RETRY_INTERVAL_MS);
    }
  }
  // 打ち切り: 許可ボタンなしの一般エラーへ切り替える（docs/ui-states.md §3）
  patchRole(store, { accessDenied: false, error: t('app.roleAccessStillDenied') });
}

/**
 * reviewer オンボーディングのフォルダアクセス付与ステップ（§7.2 手順 4）。
 * Picker でプロジェクトフォルダ（または個別ファイル）を選択させ、Documents 先頭行の
 * extracted_texts を 1 件試し読みして到達性を確認する。Documents が 0 件なら選択成功だけで
 * フラグを立てる。キャンセルは何もしない
 */
export async function grantFolderAccess(store: Store, deps: RoleServiceDeps): Promise<void> {
  const state = store.getState();
  const project = state.currentProject;
  if (!project || state.role.folderAccessChecking) {
    return;
  }
  patchRole(store, { folderAccessChecking: true, folderAccessError: null });

  let selections: Awaited<ReturnType<typeof openPdfPicker>>;
  try {
    selections = await openPdfPicker(deps.picker);
  } catch (err) {
    patchRole(store, { folderAccessChecking: false, folderAccessError: toMessage(err) });
    showToast(t('common.pickerFailed', { reason: toMessage(err) }));
    return;
  }
  if (selections === null || selections.length === 0) {
    patchRole(store, { folderAccessChecking: false });
    return;
  }

  try {
    const documents = await readDocuments(project.spreadsheetId, deps.google);
    const sample = documents.find((doc) => doc.textRef !== null);
    if (sample?.textRef) {
      const fileId = parseDriveFileId(sample.textRef);
      if (fileId !== null) {
        await getFileText(fileId, deps.google); // 到達性の確認のみ。内容は使わない
      }
    }
    await setLocal(folderAccessStorageKey(project.spreadsheetId), true);
    patchRole(store, { folderAccessChecking: false, folderAccessGranted: true, folderAccessError: null });
    showToast(t('home.toastFolderAccessConfirmed'));
  } catch (err) {
    patchRole(store, { folderAccessChecking: false, folderAccessError: toMessage(err) });
    showToast(t('home.toastFolderAccessFailed', { reason: toMessage(err) }));
  }
}
