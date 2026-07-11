// owner の「レビュアー管理」カード（Home）のサービス層（docs/design-independent-dual-review.md §7.1）。
// 登録済み一覧の読込 + 追加（モード変更は確認ダイアログを挟む）+ 解除（revoked 行の追記）を担う。
// Google 側の共有（スプレッドシート / フォルダ）はアプリからは行わず、案内文言のみ（§7.1 手順 1）
import type { ReviewerAssignment, ReviewerRole, ReviewMode } from '../../domain/reviewer';
import {
  appendReviewerAssignment,
  foldReviewerAssignments,
  latestReviewerAssignment,
  readReviewerAssignments,
} from '../../features/project/reviewerRepository';
import { getCurrentUserEmail, type ProfileDeps } from '../../lib/google/identity';
import type { GoogleApiDeps } from '../../lib/google/types';
import { nowIso8601 } from '../../utils/iso8601';
import type { ReviewersState, Store } from '../store';
import { showToast } from '../ui/toast';

export interface ReviewerAdminServiceDeps {
  google: GoogleApiDeps;
  profile: ProfileDeps;
  now?: () => string;
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
    showToast(
      input.role === 'revoked'
        ? `${input.email} の登録を解除しました`
        : `${input.email} を登録しました`,
    );
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
