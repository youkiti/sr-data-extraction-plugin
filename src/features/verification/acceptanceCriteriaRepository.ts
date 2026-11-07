// 合格基準を追記型タブから読み書きする（issue #382）。
// 正典は docs/requirements.md §3.2 AcceptanceCriteria。
import { SHEET_HEADERS } from '../../domain/sheetsSchema';
import { addSheetTab, appendRows, getSheetTitles, getSheetValues, writeHeaderRow } from '../../lib/google/sheets';
import type { GoogleApiDeps } from '../../lib/google/types';
import { criteriaToRow, parseCriteriaRows, type AcceptanceCriteria } from './acceptanceCriteria';

const TAB = 'AcceptanceCriteria';

export async function readAcceptanceCriteria(spreadsheetId: string, deps: GoogleApiDeps): Promise<{
  versions: AcceptanceCriteria[]; ignoredCount: number;
}> {
  const titles = await getSheetTitles(spreadsheetId, deps);
  if (!titles.includes(TAB)) {
    return { versions: [], ignoredCount: 0 };
  }
  const values = await getSheetValues(spreadsheetId, TAB, deps);
  if (SHEET_HEADERS.AcceptanceCriteria.some((name, index) => values[0]?.[index] !== name)) {
    throw new Error('AcceptanceCriteria: invalid header');
  }
  return parseCriteriaRows(values.slice(1));
}

export async function appendAcceptanceCriteria(spreadsheetId: string, criteria: AcceptanceCriteria, deps: GoogleApiDeps): Promise<void> {
  const titles = await getSheetTitles(spreadsheetId, deps);
  if (!titles.includes(TAB)) {
    await addSheetTab(spreadsheetId, TAB, deps);
    await writeHeaderRow(spreadsheetId, TAB, SHEET_HEADERS.AcceptanceCriteria, deps);
  }
  await appendRows(spreadsheetId, TAB, [criteriaToRow(criteria)], deps);
}
