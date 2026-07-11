// Reviewers タブ I/O（docs/design-independent-dual-review.md §2.1）。
// 追記型・email ごとに最新行が有効（latest-wins。上書きしない方針は他タブと同じ）。
// 旧プロジェクトにはタブが無いため、読み出しは「タブなし = 登録なし（空配列）」、
// 書き込みは「タブがなければ作る」で後方互換を取る（ArmStructures 導入時と同じパターン）
import type { ReviewerAssignment, ReviewerRole, ReviewMode } from '../../domain/reviewer';
import { SHEET_HEADERS } from '../../domain/sheetsSchema';
import { addSheetTab, appendRows, getSheetTitles, getSheetValues, writeHeaderRow } from '../../lib/google/sheets';
import type { GoogleApiDeps } from '../../lib/google/types';

const REVIEWERS_TAB = 'Reviewers';

const REVIEWER_ROLES: readonly ReviewerRole[] = ['reviewer', 'adjudicator', 'revoked'];
const REVIEW_MODES: readonly ReviewMode[] = ['with_ai', 'independent'];

/** Sheets の values はラグ配列（末尾の空セルが落ちる）。欠けたセルは空文字として読む */
function cellAt(row: readonly string[], index: number): string {
  return row[index] ?? '';
}

function parseReviewerRole(value: string, context: string): ReviewerRole {
  if ((REVIEWER_ROLES as readonly string[]).includes(value)) {
    return value as ReviewerRole;
  }
  throw new Error(`${context}: role "${value}" が不正です`);
}

/** review_mode は role='reviewer' のときのみ意味を持つ。空文字は null（adjudicator / revoked 行） */
function parseReviewMode(value: string, context: string): ReviewMode | null {
  if (value === '') {
    return null;
  }
  if ((REVIEW_MODES as readonly string[]).includes(value)) {
    return value as ReviewMode;
  }
  throw new Error(`${context}: review_mode "${value}" が不正です`);
}

function assertHeader(header: readonly string[]): void {
  SHEET_HEADERS.Reviewers.forEach((name, i) => {
    if (cellAt(header, i) !== name) {
      throw new Error(
        `Reviewers のヘッダ ${i + 1} 列目が "${name}" ではありません（実際: "${cellAt(header, i)}"）`,
      );
    }
  });
}

/** ReviewerAssignment → シート行。列順は SHEET_HEADERS.Reviewers に対応 */
export function reviewerAssignmentToRow(row: ReviewerAssignment): (string | null)[] {
  return [row.email, row.role, row.reviewMode ?? '', row.assignedBy, row.assignedAt];
}

function parseRows(values: string[][]): ReviewerAssignment[] {
  return values.slice(1).map((raw, i) => {
    const context = `Reviewers ${i + 2} 行目`;
    return {
      email: cellAt(raw, 0),
      role: parseReviewerRole(cellAt(raw, 1), context),
      reviewMode: parseReviewMode(cellAt(raw, 2), context),
      assignedBy: cellAt(raw, 3),
      assignedAt: cellAt(raw, 4),
    };
  });
}

/**
 * Reviewers タブの全行を読み込む（追記順 = シート行順）。
 * タブ自体が無い旧プロジェクトは「まだ誰も登録されていない」として空配列を返す
 */
export async function readReviewerAssignments(
  spreadsheetId: string,
  deps: GoogleApiDeps,
): Promise<ReviewerAssignment[]> {
  const titles = await getSheetTitles(spreadsheetId, deps);
  if (!titles.includes(REVIEWERS_TAB)) {
    return [];
  }
  const values = await getSheetValues(spreadsheetId, REVIEWERS_TAB, deps);
  const header = values[0];
  if (header === undefined) {
    throw new Error('Reviewers タブにヘッダ行がありません（プロジェクト初期化が不完全です）');
  }
  assertHeader(header);
  return parseRows(values);
}

export interface AssignReviewerInput {
  email: string;
  role: ReviewerRole;
  /** role = 'reviewer' のときのみ必須。'adjudicator' / 'revoked' は null */
  reviewMode: ReviewMode | null;
  assignedBy: string;
  assignedAt: string;
}

/**
 * レビュアー割り当て（追加・モード変更・解除）を 1 行追記する。
 * 旧プロジェクトでタブが無ければ作成 + ヘッダ書き込みしてから追記する（後方互換）
 */
export async function appendReviewerAssignment(
  spreadsheetId: string,
  input: AssignReviewerInput,
  deps: GoogleApiDeps,
): Promise<void> {
  const titles = await getSheetTitles(spreadsheetId, deps);
  if (!titles.includes(REVIEWERS_TAB)) {
    await addSheetTab(spreadsheetId, REVIEWERS_TAB, deps);
    await writeHeaderRow(spreadsheetId, REVIEWERS_TAB, SHEET_HEADERS.Reviewers, deps);
  }
  const row: ReviewerAssignment = {
    email: input.email,
    role: input.role,
    reviewMode: input.reviewMode,
    assignedBy: input.assignedBy,
    assignedAt: input.assignedAt,
  };
  await appendRows(spreadsheetId, REVIEWERS_TAB, [reviewerAssignmentToRow(row)], deps);
}

/**
 * email ごとに最新行（追記順で最後の行）を有効な割り当てとして畳み込む。
 * 見つからなければ null（= 未登録）
 */
export function latestReviewerAssignment(
  rows: readonly ReviewerAssignment[],
  email: string,
): ReviewerAssignment | null {
  const own = rows.filter((row) => row.email === email);
  return own.length === 0 ? null : (own[own.length - 1] as ReviewerAssignment);
}

/**
 * email ごとに畳み込んだ「現在の登録状態」一覧を返す（一覧表示用。§8.1 レビュアー管理カード）。
 * 出現順（初出の email の順）を保つ
 */
export function foldReviewerAssignments(
  rows: readonly ReviewerAssignment[],
): ReviewerAssignment[] {
  const order: string[] = [];
  const latestByEmail = new Map<string, ReviewerAssignment>();
  for (const row of rows) {
    if (!latestByEmail.has(row.email)) {
      order.push(row.email);
    }
    latestByEmail.set(row.email, row);
  }
  return order.map((email) => latestByEmail.get(email) as ReviewerAssignment);
}
