// owner の「レビュアー管理」カード（Home）のサービス層（docs/design-independent-dual-review.md §7.1）。
// 登録済み一覧の読込 + 追加（モード変更は確認ダイアログを挟む）+ 解除（revoked 行の追記）を担う。
// 追加・モード変更の確定時には、スプレッドシート（編集可）とプロジェクトフォルダ（閲覧）を
// 対象 email へ自動共有する（drive.file スコープで permissions.create。tiab-review と同方式）。
// 共有失敗は登録行を残したまま警告に縮退する。解除では自動アンシェアはしない（破壊的操作のため）
import type { ReviewerAssignment, ReviewerRole, ReviewMode } from '../../domain/reviewer';
import {
  appendReviewerAssignment,
  foldReviewerAssignments,
  latestReviewerAssignment,
  readReviewerAssignments,
} from '../../features/project/reviewerRepository';
import { shareFileWithUser } from '../../lib/google/drive';
import { getCurrentUserEmail, type ProfileDeps } from '../../lib/google/identity';
import type { GoogleApiDeps } from '../../lib/google/types';
import { nowIso8601 } from '../../utils/iso8601';
import type { ReviewersState, Store } from '../store';
import { showToast } from '../ui/toast';

/** 追加時に共有する対象（currentProject から取り出す最小情報） */
export interface ShareableProject {
  spreadsheetId: string;
  driveFolderId: string;
}

export interface ReviewerAdminServiceDeps {
  google: GoogleApiDeps;
  profile: ProfileDeps;
  now?: () => string;
  /**
   * レビュアー追加時にプロジェクトのシート（編集可）とフォルダ（閲覧）を email へ共有する。
   * 既定は lib/google/drive の shareFileWithUser を使う実装。テストは fake を注入する
   */
  shareProjectWithReviewer?: (
    project: ShareableProject,
    email: string,
    google: GoogleApiDeps,
  ) => Promise<void>;
  /** クリップボードへの書き込み。既定は navigator.clipboard.writeText。テストは fake を注入する */
  writeClipboard?: (text: string) => Promise<void>;
}

/**
 * 既定の共有実装。スプレッドシートは編集者（判定行・Decisions を書き込むため）、
 * プロジェクトフォルダは閲覧者（PDF を読むため）で共有する。シートのみ通知メールを送り、
 * レビュアーが対象を見つけやすくする（フォルダはシート配下扱いで通知は重複させない）。
 */
async function defaultShareProjectWithReviewer(
  project: ShareableProject,
  email: string,
  google: GoogleApiDeps,
): Promise<void> {
  await shareFileWithUser(project.spreadsheetId, email, 'writer', google, {
    sendNotificationEmail: true,
  });
  await shareFileWithUser(project.driveFolderId, email, 'reader', google);
}

/** 追加フォームが送信する入力（email + role + review_mode）。review_mode は role='reviewer' のときのみ使う */
export interface AddReviewerFormInput {
  email: string;
  /** 追加フォームでは 'revoked' は選ばせない（解除は revokeReviewer 専用の操作） */
  role: 'reviewer' | 'adjudicator';
  reviewMode: ReviewMode;
}

function toMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/** reviewers スライスだけを差し替える setState ヘルパ（他スライスは維持） */
function patchReviewers(store: Store, patch: Partial<ReviewersState>): void {
  store.setState({ reviewers: { ...store.getState().reviewers, ...patch } });
}

/**
 * Reviewers タブの登録状況（email ごとに畳み込んだ最新行）を読み込む。
 * 読込済み（assignments !== null）なら force 指定時のみ再読込。プロジェクト未選択・読込中は no-op
 */
export async function loadReviewers(
  store: Store,
  deps: ReviewerAdminServiceDeps,
  options: { force?: boolean } = {},
): Promise<void> {
  const state = store.getState();
  const project = state.currentProject;
  if (!project || state.reviewers.loading) {
    return;
  }
  // owner 専用のカードのため、ロールが解決済みで owner でないと分かっている間は読み込まない
  if (state.role.role !== null && state.role.role !== 'owner') {
    return;
  }
  if (state.reviewers.assignments !== null && options.force !== true) {
    return;
  }
  patchReviewers(store, { loading: true, loadError: null });
  try {
    const rows = await readReviewerAssignments(project.spreadsheetId, deps.google);
    patchReviewers(store, { loading: false, assignments: foldReviewerAssignments(rows) });
  } catch (err) {
    patchReviewers(store, { loading: false, loadError: toMessage(err) });
  }
}

function toAssignmentInput(input: AddReviewerFormInput): {
  email: string;
  role: ReviewerRole;
  reviewMode: ReviewMode | null;
} {
  return {
    email: input.email,
    role: input.role,
    reviewMode: input.role === 'reviewer' ? input.reviewMode : null,
  };
}

/**
 * レビュアー追加フォームの送信。既存登録があり、role='reviewer' のまま review_mode だけを
 * 変える場合は「モード変更は盲検を破る可能性がある」旨の確認ダイアログを先に出す（§2.1）。
 * それ以外（新規登録・role 変更・同一内容の再送信）はそのまま追記する
 */
export async function requestAddReviewer(
  store: Store,
  deps: ReviewerAdminServiceDeps,
  rawInput: AddReviewerFormInput,
): Promise<void> {
  const email = rawInput.email.trim();
  if (email === '') {
    showToast('email を入力してください');
    return;
  }
  const input: AddReviewerFormInput = { ...rawInput, email };
  const existing = latestReviewerAssignment(store.getState().reviewers.assignments ?? [], email);
  const isModeChange =
    existing !== null &&
    existing.role === 'reviewer' &&
    input.role === 'reviewer' &&
    existing.reviewMode !== null &&
    existing.reviewMode !== input.reviewMode;
  if (isModeChange) {
    patchReviewers(store, { confirmingChange: toAssignmentInput(input) });
    return;
  }
  await submitReviewerAssignment(store, deps, toAssignmentInput(input));
}

/** モード変更確認ダイアログの「続行」 */
export async function confirmReviewerChange(
  store: Store,
  deps: ReviewerAdminServiceDeps,
): Promise<void> {
  const pending = store.getState().reviewers.confirmingChange;
  if (pending === null) {
    return;
  }
  patchReviewers(store, { confirmingChange: null });
  await submitReviewerAssignment(store, deps, pending);
}

/** モード変更確認ダイアログの「キャンセル」 */
export function cancelReviewerChange(store: Store): void {
  patchReviewers(store, { confirmingChange: null });
}

/** Reviewers への 1 行追記（追加・モード変更・解除で共通）。成功で一覧へ反映、失敗はトースト */
async function submitReviewerAssignment(
  store: Store,
  deps: ReviewerAdminServiceDeps,
  input: { email: string; role: ReviewerRole; reviewMode: ReviewMode | null },
): Promise<void> {
  const project = store.getState().currentProject;
  if (!project) {
    return;
  }
  patchReviewers(store, { saving: true, saveError: null });
  try {
    const assignedBy = (await getCurrentUserEmail(deps.profile)) ?? '';
    const assignedAt = (deps.now ?? nowIso8601)();
    await appendReviewerAssignment(
      project.spreadsheetId,
      { ...input, assignedBy, assignedAt },
      deps.google,
    );
    const row: ReviewerAssignment = { ...input, assignedBy, assignedAt };
    const current = store.getState().reviewers.assignments ?? [];
    patchReviewers(store, {
      saving: false,
      assignments: foldReviewerAssignments([...current, row]),
    });
    if (input.role === 'revoked') {
      // 解除は行追記のみ（他人の Drive アクセスを消す自動アンシェアはしない）
      showToast(`${input.email} の登録を解除しました`);
      return;
    }
    // 役割登録が成功した後で Drive を自動共有する。共有失敗は登録を巻き戻さず警告に縮退する
    const share = deps.shareProjectWithReviewer ?? defaultShareProjectWithReviewer;
    try {
      await share(
        { spreadsheetId: project.spreadsheetId, driveFolderId: project.driveFolderId },
        input.email,
        deps.google,
      );
      showToast(`${input.email} を登録し、シート（編集可）とフォルダ（閲覧）を共有しました`);
    } catch (shareErr) {
      showToast(
        `${input.email} を登録しました。ただし自動共有に失敗したため、Google Drive で手動共有してください（${toMessage(
          shareErr,
        )}）`,
      );
    }
  } catch (err) {
    patchReviewers(store, { saving: false, saveError: toMessage(err) });
    showToast(`保存に失敗しました: ${toMessage(err)}`);
  }
}

/** レビュアーの登録解除（role='revoked' の行を追記。§2.1「解除も追記で表現する」） */
export async function revokeReviewer(
  store: Store,
  deps: ReviewerAdminServiceDeps,
  email: string,
): Promise<void> {
  await submitReviewerAssignment(store, deps, { email, role: 'revoked', reviewMode: null });
}

export interface ReviewInviteInput {
  projectName: string;
  spreadsheetId: string;
  reviewerEmail: string;
  /** 未登録・adjudicator 等でモードが無いときは null（AI 結果レビューとして案内する） */
  reviewMode: ReviewMode | null;
}

/**
 * レビュー相手へそのまま送れる依頼文を組み立てる（owner がコピーして共有ツールで渡す想定）。
 * スプレッドシート URL（ID 直打ちでも URL でも Popup が受ける）+ 参加手順 + レビュー方式を含む。
 */
export function buildReviewInvite(input: ReviewInviteInput): string {
  const url = `https://docs.google.com/spreadsheets/d/${input.spreadsheetId}/edit`;
  const modeNote =
    input.reviewMode === 'independent'
      ? 'レビュー方式: AI 抜きの独立入力（AI の抽出結果・根拠は表示されません。PDF を読んでご自身で値を入力してください）'
      : 'レビュー方式: AI の結果をレビュー（AI が抽出した各項目を accept / edit / reject / not_reported で判定してください）';
  return [
    `${input.reviewerEmail} さん`,
    '',
    `系統的レビューのデータ抽出「${input.projectName}」の第 2 レビュアーをお願いします。以下の手順で参加してください。`,
    '',
    '1. Chrome 拡張「SR Data Extraction Plugin」をインストールし、ご自身の Google アカウントでログイン',
    '2. 拡張アイコン →「スプレッドシート ID / URL で開く」に次を貼り付けて開く:',
    `   ${url}`,
    '3. Home の「プロジェクトフォルダへのアクセスを付与」で、共有されたプロジェクトフォルダを選択',
    '4.「検証」画面で担当ぶんを判定してください',
    '',
    modeNote,
  ].join('\n');
}

/**
 * 対象レビュアーへの依頼文を組み立ててクリップボードへコピーする（レビュアー管理カードの
 * コピーボタン）。currentProject 未選択なら no-op。コピー成否はトーストで知らせる。
 */
export async function copyReviewInvite(
  store: Store,
  deps: ReviewerAdminServiceDeps,
  email: string,
): Promise<void> {
  const project = store.getState().currentProject;
  if (!project) {
    return;
  }
  const assignment = latestReviewerAssignment(store.getState().reviewers.assignments ?? [], email);
  const text = buildReviewInvite({
    projectName: project.name,
    spreadsheetId: project.spreadsheetId,
    reviewerEmail: email,
    reviewMode: assignment?.reviewMode ?? null,
  });
  const write = deps.writeClipboard ?? ((value: string) => navigator.clipboard.writeText(value));
  try {
    await write(text);
    showToast('レビュー依頼文をコピーしました');
  } catch (err) {
    showToast(`コピーに失敗しました: ${toMessage(err)}`);
  }
}
