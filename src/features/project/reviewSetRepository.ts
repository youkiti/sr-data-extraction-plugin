// 担当セットは追記順で後勝ち。旧プロジェクトのタブは初回書き込みで作る。
import { compareReviewSetIds, type ReviewSetRow } from '../../domain/reviewSet';
import { SHEET_HEADERS } from '../../domain/sheetsSchema';
import {
  addSheetTab,
  appendRows,
  getSheetTitles,
  getSheetValues,
  writeHeaderRow,
} from '../../lib/google/sheets';
import type { GoogleApiDeps } from '../../lib/google/types';

const REVIEW_SETS_TAB = 'ReviewSets';

function normalizeEmails(emails: readonly string[]): string[] {
  return [...new Set(emails.map((email) => email.trim()).filter((email) => email !== ''))];
}

export async function readReviewSetRows(
  spreadsheetId: string,
  deps: GoogleApiDeps,
): Promise<ReviewSetRow[]> {
  const titles = await getSheetTitles(spreadsheetId, deps);
  if (!titles.includes(REVIEW_SETS_TAB)) return [];
  const values = await getSheetValues(spreadsheetId, REVIEW_SETS_TAB, deps);
  const header = values[0];
  if (header === undefined) throw new Error('ReviewSets タブにヘッダ行がありません');
  SHEET_HEADERS.ReviewSets.forEach((name, i) => {
    if (header[i] !== name)
      throw new Error(`ReviewSets のヘッダ ${i + 1} 列目が "${name}" ではありません`);
  });
  return values.slice(1).map((row) => ({
    setId: row[0] ?? '',
    reviewerEmails: normalizeEmails((row[1] ?? '').split(';')),
    seed: row[2] || null,
    updatedBy: row[3] ?? '',
    updatedAt: row[4] ?? '',
  }));
}

export async function appendReviewSetRows(
  spreadsheetId: string,
  rows: readonly ReviewSetRow[],
  deps: GoogleApiDeps,
): Promise<void> {
  if (rows.length === 0) return;
  const titles = await getSheetTitles(spreadsheetId, deps);
  if (!titles.includes(REVIEW_SETS_TAB)) {
    await addSheetTab(spreadsheetId, REVIEW_SETS_TAB, deps);
    await writeHeaderRow(spreadsheetId, REVIEW_SETS_TAB, SHEET_HEADERS.ReviewSets, deps);
  }
  await appendRows(
    spreadsheetId,
    REVIEW_SETS_TAB,
    rows.map((row) => [
      row.setId,
      normalizeEmails(row.reviewerEmails).join(';'),
      row.seed,
      row.updatedBy,
      row.updatedAt,
    ]),
    deps,
  );
}

/** owner の追記行だけを採用し、set_id ごとの最終行を表示順で返す */
export function foldReviewSets(
  rows: readonly ReviewSetRow[],
  ownerEmail: string,
): { sets: ReviewSetRow[]; ignoredCount: number } {
  const latest = new Map<string, ReviewSetRow>();
  let ignoredCount = 0;
  for (const row of rows) {
    if (row.updatedBy !== ownerEmail) {
      ignoredCount++;
      continue;
    }
    const previous = latest.get(row.setId);
    const split =
      row.seed === null && previous?.seed != null
        ? { seed: previous.seed, splitUpdatedAt: previous.splitUpdatedAt ?? previous.updatedAt }
        : {};
    latest.set(row.setId, {
      ...row,
      ...split,
      reviewerEmails: normalizeEmails(row.reviewerEmails),
    });
  }
  return {
    sets: [...latest.values()].sort((a, b) => compareReviewSetIds(a.setId, b.setId)),
    ignoredCount,
  };
}
