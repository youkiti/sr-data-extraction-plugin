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
import { openPdfPicker, type PickerDeps } from '../../lib/google/picker';
import type { GoogleApiDeps } from '../../lib/google/types';
import { getLocal, setLocal } from '../../lib/storage/chromeStorage';
import type { RoleState, Store } from '../store';
import { showToast } from '../ui/toast';

export interface RoleServiceDeps {
  google: GoogleApiDeps;
  profile: ProfileDeps;
  picker: PickerDeps;
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
  patchRole(store, { resolving: true, error: null });
  try {
    const role = await resolveProjectRole(project.spreadsheetId, deps);
    const folderAccessGranted =
      role === 'owner' ? true : (await getLocal<boolean>(folderAccessStorageKey(project.spreadsheetId))) === true;
    patchRole(store, { role, resolving: false, error: null, folderAccessGranted });
  } catch (err) {
    patchRole(store, { resolving: false, error: toMessage(err) });
  }
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
    showToast(`Drive Picker を開けませんでした: ${toMessage(err)}`);
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
    showToast('プロジェクトフォルダへのアクセスを確認しました');
  } catch (err) {
    patchRole(store, { folderAccessChecking: false, folderAccessError: toMessage(err) });
    showToast(`フォルダへのアクセスを確認できませんでした: ${toMessage(err)}`);
  }
}
