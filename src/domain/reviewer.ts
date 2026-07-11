// Reviewers タブに対応する型 + プロジェクトに対する解決済みロール
// （docs/design-independent-dual-review.md §1「ロールモデル」・§2.1「Reviewers タブの新設」）。
// 独立二重レビュー機能（issue #44）の基盤。追記型・email ごとに最新行が有効（latest-wins。
// 上書きしない方針は他タブと同じ）

/** Reviewers タブ 1 行の role 列。解除も追記で表現する（`revoked`） */
export type ReviewerRole = 'reviewer' | 'adjudicator' | 'revoked';

/**
 * role = 'reviewer' のときの review_mode 列。
 * ① AI の結果をレビュー（with_ai）/ ② AI 抜きでレビュー（independent）
 */
export type ReviewMode = 'with_ai' | 'independent';

/** Reviewers タブ 1 行（追記型。email ごとに最後の行が現在の有効な割り当て） */
export interface ReviewerAssignment {
  email: string;
  role: ReviewerRole;
  /** role = 'reviewer' のときのみ意味を持つ。'adjudicator' / 'revoked' 行は null */
  reviewMode: ReviewMode | null;
  /** 割り当て操作を行った owner の email */
  assignedBy: string;
  assignedAt: string;
}

/**
 * メインビュー起動時に 1 回解決される、ログイン email のプロジェクトに対する実効ロール。
 *
 * - `owner`: `Meta.created_by` と一致
 * - `reviewer_with_ai` / `reviewer_independent`: Reviewers の有効行が role='reviewer'
 *   （review_mode で分岐）
 * - `adjudicator`: Reviewers の有効行が role='adjudicator'
 * - `unregistered`: 上記いずれにも該当しない（共有はされているが未登録 / 解除済み）
 */
export type ProjectRole =
  | 'owner'
  | 'reviewer_with_ai'
  | 'reviewer_independent'
  | 'adjudicator'
  | 'unregistered';
