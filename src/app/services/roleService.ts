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
 * 付与済みファイル ID セットを保存する storage.local キー（issue #141: 差分付与）。
 * folderAccessStorageKey（boolean のオンボーディング完了ゲート）とは別キーで、
 * 「どのファイルまで付与済みか」を Drive ファイル ID の集合として保持する
 */
export function fileAccessRecordStorageKey(spreadsheetId: string, email: string): string {
  return `sr-data-extraction:file-access-record:${spreadsheetId}:${email}`;
}

/** 付与済み / スキップ済みの Drive ファイル ID 集合（issue #141）。granted は Picker で
 * 付与済みと記録した ID、skipped はユーザーが「読めないファイルをスキップ」で明示的に
 * 諦めた ID（Drive 上で削除済み等）。両方とも required の候補から除外される */
export interface FileAccessRecord {
  granted: string[];
  skipped: string[];
}

/** 配列でなければ空配列、配列なら文字列以外の要素を取り除いて返す（storage.local の
 * 外部データを堅く扱うためのフィールド単位の正規化。フィールドが丸ごと壊れていても
 * 他方のフィールドまでは道連れにしない） */
function toStringIdList(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.filter((item): item is string => typeof item === 'string');
}

/** storage.local から読んだ生値を FileAccessRecord へ正規化する。形が崩れていたら
 * （配列でない・要素が文字列でない等）そのフィールドを空配列にフォールバックする
 * （外部データ扱いで堅く。raw 自体が null / undefined / オブジェクトでなくても安全） */
function toFileAccessRecord(raw: unknown): FileAccessRecord {
  const candidate = raw as Partial<FileAccessRecord> | null | undefined;
  return {
    granted: toStringIdList(candidate?.granted),
    skipped: toStringIdList(candidate?.skipped),
  };
}

/** FileAccessRecord の生値（未設定なら undefined）を読む。checkMissingFileAccess は
 * undefined かどうか（＝レコード未記録のレガシーユーザーか）を区別する必要があるため、
 * 正規化前の値を返す */
function loadFileAccessRecordRaw(spreadsheetId: string, email: string): Promise<unknown> {
  return getLocal<unknown>(fileAccessRecordStorageKey(spreadsheetId, email));
}

function saveFileAccessRecord(
  spreadsheetId: string,
  email: string,
  record: FileAccessRecord,
): Promise<void> {
  return setLocal(fileAccessRecordStorageKey(spreadsheetId, email), record);
}

/**
 * Documents から付与が必要な Drive ファイル ID（PDF = drive_file_id / 抽出テキスト = text_ref）を
 * 重複なく集める。sampleTextId は到達性確認に使う先頭の抽出テキスト ID（解析可能なものが無ければ null）
 */
export function collectRequiredFileIds(documents: readonly DocumentRecord[]): {
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
 * reviewer オンボーディングのファイルアクセス付与ステップ（§7.2 手順 4・issue #139・#141）。
 * 共有フォルダの Picker 選択では drive.file の読み取りが配下ファイルへ付与されないことが
 * 実機で確定したため（issue #62）、Documents タブから必要ファイル ID を集めて Picker に列挙し、
 * reviewer にファイル単位で付与してもらう。
 *
 * issue #141 で「差分付与」に変更: 付与済み ID セット（FileAccessRecord.granted）を
 * storage.local に永続化し、Picker には required から granted / skipped を除いた不足分
 * （candidates）だけを列挙する。一部だけ選択されても、選択した分はその場で永続化した上で
 * 不足分の件数（folderAccessMissingCount）を state に残すだけで、エラーとして弾かない
 * （収束型: 次にこの関数を呼んだときは残りの不足分だけが再提示される）。
 * candidates が 0 件（＝ required が granted / skipped で埋まっている）なら Picker を開かず、
 * 到達性を 1 件だけ試し読み（抽出テキストがあれば本文 / 無ければ先頭 PDF のメタデータ）して
 * 確認する（付与直後の伝播遅延に備え、試し読みのみ最大 3 回・約 2 秒間隔でリトライ）。
 * 付与対象（required）が 0 件なら選択操作なしでフラグを立てる。キャンセルは何もしない。
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

  // candidates 計算・storage.local 保存の両方で使うため先に取得する
  const email = (await getCurrentUserEmail(deps.profile)) ?? '';

  const confirmGranted = async (): Promise<void> => {
    try {
      await setLocal(folderAccessStorageKey(project.spreadsheetId, email), true);
    } catch (err) {
      fail(toMessage(err));
      return;
    }
    patchRole(store, {
      folderAccessChecking: false,
      folderAccessGranted: true,
      folderAccessError: null,
      folderAccessMissingCount: 0,
    });
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

  // 到達性の確認のみ。内容は使わない。抽出テキストが 1 件も無いプロジェクト（全スキャン PDF）は
  // 先頭 PDF のメタデータ取得で代替する（バイナリのダウンロードは避ける）。
  // リトライは試し読みだけに掛ける（保存やトーストの失敗を到達性エラーと誤分類しない）
  const probeReachable = async (): Promise<boolean> => {
    const probe =
      sampleTextId !== null
        ? (): Promise<unknown> => getFileText(sampleTextId, deps.google)
        : (): Promise<unknown> => getFileMd5(firstRequiredId, deps.google);
    const sleep = deps.sleep ?? defaultSleep;
    // 最終試行だけループの外に出す: TypeScript は for ループが必ず return することを
    // 静的に証明できないため、ループ内だけで完結させると到達不能な末尾 return が必要になる
    // （実行されないコードはカバレッジ 100% 要件に反する）。最終試行を独立させることで
    // 全パスが明示的に return し、末尾の到達不能コードを避ける
    for (let attempt = 1; attempt < GRANT_RETRY_MAX; attempt += 1) {
      try {
        await probe();
        return true;
      } catch {
        await sleep(GRANT_RETRY_INTERVAL_MS);
      }
    }
    try {
      await probe();
      return true;
    } catch (err) {
      fail(toMessage(err));
      return false;
    }
  };

  let record: FileAccessRecord;
  try {
    record = toFileAccessRecord(await loadFileAccessRecordRaw(project.spreadsheetId, email));
  } catch (err) {
    fail(toMessage(err));
    return;
  }
  const grantedSet = new Set(record.granted);
  const skippedSet = new Set(record.skipped);
  const candidates = requiredIds.filter((id) => !grantedSet.has(id) && !skippedSet.has(id));

  if (candidates.length === 0) {
    // 不足分が既に無い（前回までの付与で required が granted / skipped で埋まっている）:
    // Picker を開かず到達性のみ確認する
    if (await probeReachable()) {
      await confirmGranted();
    }
    return;
  }

  let selections: Awaited<ReturnType<typeof openProjectFilesPicker>>;
  try {
    // 全件ではなく不足分（candidates）のみを列挙する（issue #141: 差分付与）
    selections = await openProjectFilesPicker(deps.picker, candidates);
  } catch (err) {
    patchRole(store, { folderAccessChecking: false, folderAccessError: toMessage(err) });
    showToast(t('common.pickerFailed', { reason: toMessage(err) }));
    return;
  }
  if (selections === null || selections.length === 0) {
    patchRole(store, { folderAccessChecking: false });
    return;
  }

  const candidateSet = new Set(candidates);
  const selected = selections.map((s) => s.sourceFileId).filter((id) => candidateSet.has(id));
  for (const id of selected) {
    grantedSet.add(id);
  }
  // 部分選択でも進捗を失わないよう、到達性プローブより先に永続化する
  try {
    await saveFileAccessRecord(project.spreadsheetId, email, {
      granted: [...grantedSet],
      skipped: record.skipped,
    });
  } catch (err) {
    fail(toMessage(err));
    return;
  }

  const missing = requiredIds.filter((id) => !grantedSet.has(id) && !skippedSet.has(id));
  if (missing.length > 0) {
    // 一部のみ選択されてもエラーにせず弾かない（issue #141）: 選択した分は記録済みのため、
    // 次にこの関数を呼んだときは不足分だけが再提示される（収束型）。ゲートは開かないため
    // #/verify は引き続きブロックされる
    patchRole(store, {
      folderAccessChecking: false,
      folderAccessMissingCount: missing.length,
      folderAccessError: null,
    });
    return;
  }

  if (await probeReachable()) {
    await confirmGranted();
  }
}

/**
 * 読めないファイルをスキップして続行する（issue #141 課題 2）。Drive 上で削除済みのファイルの
 * 残存 Documents 行が全選択ゲートを恒久ブロックする問題の逃げ道。required から
 * granted / skipped 済みを除いた不足分すべてを skipped として記録し、boolean ゲートを開く。
 * スキップした文書は検証画面で個別に読み込みエラーになる（ここでは警告のみでブロックしない）
 */
export async function skipMissingFileAccess(store: Store, deps: RoleServiceDeps): Promise<void> {
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

  const email = (await getCurrentUserEmail(deps.profile)) ?? '';

  let documents: DocumentRecord[];
  try {
    documents = await readDocuments(project.spreadsheetId, deps.google);
  } catch (err) {
    fail(toMessage(err));
    return;
  }
  const { ids: requiredIds } = collectRequiredFileIds(documents);

  let record: FileAccessRecord;
  try {
    record = toFileAccessRecord(await loadFileAccessRecordRaw(project.spreadsheetId, email));
  } catch (err) {
    fail(toMessage(err));
    return;
  }
  const grantedSet = new Set(record.granted);
  const skippedSet = new Set(record.skipped);
  const missing = requiredIds.filter((id) => !grantedSet.has(id) && !skippedSet.has(id));
  for (const id of missing) {
    skippedSet.add(id);
  }

  try {
    await saveFileAccessRecord(project.spreadsheetId, email, {
      granted: record.granted,
      skipped: [...skippedSet],
    });
    await setLocal(folderAccessStorageKey(project.spreadsheetId, email), true);
  } catch (err) {
    fail(toMessage(err));
    return;
  }

  patchRole(store, {
    folderAccessChecking: false,
    folderAccessGranted: true,
    folderAccessMissingCount: 0,
    folderAccessError: null,
  });
  showToast(t('home.toastSkippedMissing', { n: missing.length }));
}

/** checkMissingFileAccess が 1 回に走査する候補の上限（Drive API 呼び出し数の上限）。
 * 起動時の差分検知はあくまで補助的な通知であり、大量のファイルを抱えるプロジェクトで
 * 起動のたびに大量の Drive API 呼び出しを発生させないための保守的な制限。超過分は
 * プローブせずそのまま missing 扱いにする（次回の付与操作 / 再入場でカバーされる） */
const CHECK_MISSING_PROBE_LIMIT = 25;

/**
 * 起動時の差分検知（issue #141 課題 1）。owner が後から取り込んだ文献の不足に reviewer が
 * 気づけるよう、付与済み Home で不足分の有無を静かに確認して banner（folderAccessMissingCount）
 * を立てる。ネットワーク I/O を伴うため bootstrap の起動シーケンスから loadRole 完了後に
 * fire-and-forget で呼ぶ（起動をブロックしない。loadRole 内には入れない）。
 *
 * 多重実行ガード: folderAccessMissingCount が null でなければ（前回までに計算済みなら）
 * 再計算しない、という store 上の冪等ガードを採用した（role スライスへ専用の実行中フラグを
 * 増やさずに済み、テストも store の状態だけで検証できるため。issue #141 PR-1 の設計判断）
 */
export async function checkMissingFileAccess(store: Store, deps: RoleServiceDeps): Promise<void> {
  const state = store.getState();
  const project = state.currentProject;
  const role = state.role.role;
  if (
    !project ||
    role === null ||
    role === 'owner' ||
    !state.role.folderAccessGranted ||
    state.role.folderAccessMissingCount !== null
  ) {
    return;
  }

  try {
    const email = (await getCurrentUserEmail(deps.profile)) ?? '';
    const raw = await loadFileAccessRecordRaw(project.spreadsheetId, email);
    if (raw === undefined) {
      // レガシー（旧 boolean のみで付与した既存 reviewer）はレコードが無いため検知対象外
      // （誤検知の probe 嵐を避ける）。次回の付与 / 再付与操作からレコードが記録され、
      // 以降はこの検知が効くようになる
      return;
    }
    const record = toFileAccessRecord(raw);
    const documents = await readDocuments(project.spreadsheetId, deps.google);
    const { ids: requiredIds } = collectRequiredFileIds(documents);
    const grantedSet = new Set(record.granted);
    const skippedSet = new Set(record.skipped);
    const candidates = requiredIds.filter((id) => !grantedSet.has(id) && !skippedSet.has(id));
    if (candidates.length === 0) {
      patchRole(store, { folderAccessMissingCount: 0 });
      return;
    }

    const toProbe = candidates.slice(0, CHECK_MISSING_PROBE_LIMIT);
    const missing: string[] = candidates.slice(CHECK_MISSING_PROBE_LIMIT);
    let selfHealed = false;
    for (const id of toProbe) {
      try {
        await getFileMd5(id, deps.google);
        // 別端末で付与済みだった分の自己修復: 読めた ID は granted へ足す
        grantedSet.add(id);
        selfHealed = true;
      } catch {
        missing.push(id);
      }
    }
    if (selfHealed) {
      await saveFileAccessRecord(project.spreadsheetId, email, {
        granted: [...grantedSet],
        skipped: record.skipped,
      });
    }
    patchRole(store, { folderAccessMissingCount: missing.length });
  } catch {
    // Documents 読込等の途中の失敗は UI に出さず握りつぶす（次回入場で再試行される）
  }
}
