// プロジェクトに対する実効ロールの解決 + reviewer オンボーディング（フォルダアクセス付与）。
// docs/design-independent-dual-review.md §1（ロールモデル）・§7.2（reviewer 側オンボーディング）。
//
// ロール解決はメインビュー起動時に 1 回行う: ログイン email が Meta.created_by と一致 → owner。
// Reviewers の有効行（latest-wins）に一致 → role='adjudicator' なら adjudicator、role='reviewer' なら
// review_mode により reviewer_with_ai / reviewer_independent。どちらでもない（revoked 含む）→
// unregistered（bootstrap 側が全画面エラーで以降の読み込みを中断する）
import type { DocumentRecord } from '../../domain/document';
import type { ProjectRole } from '../../domain/reviewer';
import { readDocuments } from '../../features/documents/documentRepository';
import { parseDriveFileId } from '../../features/documents/loadDocumentPages';
import { loadProjectMeta } from '../../features/project/selectProject';
import { latestReviewerAssignment, readReviewerAssignments } from '../../features/project/reviewerRepository';
import { getFileMd5, getFileText } from '../../lib/google/drive';
import { getCurrentUserEmail, type ProfileDeps } from '../../lib/google/identity';
import {
  openProjectFilesPicker,
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

/**
 * プロジェクトファイルのアクセス付与フラグを保存する storage.local キー。
 * drive.file の付与は（アプリ × Google アカウント）単位のため、同一 Chrome プロファイルで
 * アカウントを切り替えても他アカウントの付与を流用しないよう email を軸に含める（レビュー指摘）
 */
export function folderAccessStorageKey(spreadsheetId: string, email: string): string {
  return `sr-data-extraction:folder-access-granted:${spreadsheetId}:${email}`;
}

/** 既定の伝播待ち sleep（grantSpreadsheetAccess / grantFolderAccess 共用。テストは deps.sleep で差し替える） */
const defaultSleep = (ms: number): Promise<void> =>
  new Promise<void>((resolve) => setTimeout(resolve, ms));

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
    const email = (await getCurrentUserEmail(deps.profile)) ?? '';
    const folderAccessGranted =
      role === 'owner'
        ? true
        : (await getLocal<boolean>(folderAccessStorageKey(project.spreadsheetId, email))) === true;
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
  const sleep = deps.sleep ?? defaultSleep;
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
 * Documents から付与が必要な Drive ファイル ID（PDF = drive_file_id / 抽出テキスト = text_ref）を
 * 重複なく集める。sampleTextId は到達性確認に使う先頭の抽出テキスト ID（解析可能なものが無ければ null）
 */
function collectRequiredFileIds(documents: readonly DocumentRecord[]): {
  ids: string[];
  sampleTextId: string | null;
} {
  const ids = new Set<string>();
  let sampleTextId: string | null = null;
  for (const doc of documents) {
    if (doc.driveFileId !== '') {
      ids.add(doc.driveFileId);
    }
    const textFileId = doc.textRef === null ? null : parseDriveFileId(doc.textRef);
    if (textFileId !== null) {
      ids.add(textFileId);
      sampleTextId ??= textFileId;
    }
  }
  return { ids: [...ids], sampleTextId };
}

/**
 * reviewer オンボーディングのファイルアクセス付与ステップ（§7.2 手順 4・issue #139）。
 * 共有フォルダの Picker 選択では drive.file の読み取りが配下ファイルへ付与されないことが
 * 実機で確定したため（issue #62）、Documents タブから必要ファイル ID を集めて Picker に列挙し、
 * reviewer に全選択してもらってファイル単位で付与する。全件選択を照合したうえで、到達性を
 * 1 件だけ試し読み（抽出テキストがあれば本文 / 無ければ先頭 PDF のメタデータ）して確認する
 * （付与直後の伝播遅延に備え、試し読みのみ最大 3 回・約 2 秒間隔でリトライ）。
 * 付与対象が 0 件なら選択操作なしでフラグを立てる。キャンセルは何もしない。
 * 付与済み後も再実行できる（Home の再付与ボタン。owner が後から取り込んだ文献のぶんを追加付与する）。
 * 関数名・state キー（folderAccess*）は互換のため旧称のまま
 */
export async function grantFolderAccess(store: Store, deps: RoleServiceDeps): Promise<void> {
  const state = store.getState();
  const project = state.currentProject;
  if (!project || state.role.folderAccessChecking) {
    return;
  }
  patchRole(store, { folderAccessChecking: true, folderAccessError: null });

  const fail = (reason: string): void => {
    patchRole(store, { folderAccessChecking: false, folderAccessError: reason });
    showToast(t('home.toastFolderAccessFailed', { reason }));
  };
  const confirmGranted = async (): Promise<void> => {
    const email = (await getCurrentUserEmail(deps.profile)) ?? '';
    try {
      await setLocal(folderAccessStorageKey(project.spreadsheetId, email), true);
    } catch (err) {
      fail(toMessage(err));
      return;
    }
    patchRole(store, { folderAccessChecking: false, folderAccessGranted: true, folderAccessError: null });
    showToast(t('home.toastFolderAccessConfirmed'));
  };

  let documents: DocumentRecord[];
  try {
    documents = await readDocuments(project.spreadsheetId, deps.google);
  } catch (err) {
    fail(toMessage(err));
    return;
  }

  const { ids: requiredIds, sampleTextId } = collectRequiredFileIds(documents);
  const [firstRequiredId] = requiredIds;
  if (firstRequiredId === undefined) {
    await confirmGranted();
    return;
  }

  let selections: Awaited<ReturnType<typeof openProjectFilesPicker>>;
  try {
    selections = await openProjectFilesPicker(deps.picker, requiredIds);
  } catch (err) {
    patchRole(store, { folderAccessChecking: false, folderAccessError: toMessage(err) });
    showToast(t('common.pickerFailed', { reason: toMessage(err) }));
    return;
  }
  if (selections === null || selections.length === 0) {
    patchRole(store, { folderAccessChecking: false });
    return;
  }

  // 一部だけ選択された場合は付与漏れとして弾く（漏れたファイルは検証画面で読めない）
  const selectedIds = new Set(selections.map((s) => s.sourceFileId));
  const missing = requiredIds.filter((id) => !selectedIds.has(id));
  if (missing.length > 0) {
    fail(t('home.folderAccessPartial', { missing: missing.length, total: requiredIds.length }));
    return;
  }

  // 到達性の確認のみ。内容は使わない。抽出テキストが 1 件も無いプロジェクト（全スキャン PDF）は
  // 先頭 PDF のメタデータ取得で代替する（バイナリのダウンロードは避ける）。
  // リトライは試し読みだけに掛ける（保存やトーストの失敗を到達性エラーと誤分類しない）
  const probe =
    sampleTextId !== null
      ? (): Promise<unknown> => getFileText(sampleTextId, deps.google)
      : (): Promise<unknown> => getFileMd5(firstRequiredId, deps.google);
  const sleep = deps.sleep ?? defaultSleep;
  for (let attempt = 1; attempt <= GRANT_RETRY_MAX; attempt += 1) {
    try {
      await probe();
      break;
    } catch (err) {
      if (attempt >= GRANT_RETRY_MAX) {
        fail(toMessage(err));
        return;
      }
      await sleep(GRANT_RETRY_INTERVAL_MS);
    }
  }
  await confirmGranted();
}
