// QuoteSets タブの作成・追記・読み込みを扱う。
// 不正なデータ行は読み飛ばし、ヘッダの不整合はエラーとして通知する。
import type { QuoteSetRow } from '../../domain/quoteSet';
import { SHEET_HEADERS } from '../../domain/sheetsSchema';
import { addSheetTab, appendRows, getSheetTitles, getSheetValues, writeHeaderRow } from '../../lib/google/sheets';
import type { GoogleApiDeps } from '../../lib/google/types';

const TAB = 'QuoteSets';
const COLUMNS = [
  'setId', 'savedAt', 'savedBy', 'annotator', 'annotatorType', 'studyId', 'fieldId',
  'entityKey', 'schemaVersion', 'kind', 'seq', 'quoteId', 'source', 'evidenceId',
  'originAnnotator', 'documentId', 'quote', 'page', 'section', 'theme', 'anchorStatus', 'baseRunId',
] as const;

/** QuoteSets タブが無ければヘッダ付きで作成する。 */
export async function ensureQuoteSetsTab(spreadsheetId: string, deps: GoogleApiDeps): Promise<void> {
  const titles = await getSheetTitles(spreadsheetId, deps);
  if (titles.includes(TAB)) return;
  await addSheetTab(spreadsheetId, TAB, deps);
  await writeHeaderRow(spreadsheetId, TAB, SHEET_HEADERS.QuoteSets, deps);
}

/** 引用スナップショットの行をシートへ追記する。 */
export async function appendQuoteSetRows(
  spreadsheetId: string, rows: readonly QuoteSetRow[], deps: GoogleApiDeps,
): Promise<void> {
  if (rows.length === 0) return;
  await ensureQuoteSetsTab(spreadsheetId, deps);
  await appendRows(spreadsheetId, TAB, rows.map((row) => COLUMNS.map((key) => row[key])), deps);
}

/** 有効な引用スナップショット行をシート順に読み込む。 */
export async function readQuoteSetRows(spreadsheetId: string, deps: GoogleApiDeps): Promise<QuoteSetRow[]> {
  const titles = await getSheetTitles(spreadsheetId, deps);
  if (!titles.includes(TAB)) return [];
  const values = await getSheetValues(spreadsheetId, TAB, deps);
  const header = values[0];
  if (header === undefined) throw new Error('QuoteSets タブにヘッダ行がありません（プロジェクト初期化が不完全です）');
  SHEET_HEADERS.QuoteSets.forEach((name, index) => {
    if (header[index] !== name) throw new Error(`QuoteSets のヘッダ ${index + 1} 列目が "${name}" ではありません`);
  });
  const result: QuoteSetRow[] = [];
  for (const raw of values.slice(1)) {
    const cell = (index: number): string => raw[index] ?? '';
    if (!['quote', 'empty', 'reset'].includes(cell(9)) ||
        !['', 'ai', 'human'].includes(cell(12)) ||
        !['ai', 'human_with_ai', 'human_independent', 'consensus'].includes(cell(4)) ||
        !['', 'exact', 'normalized', 'fuzzy', 'failed'].includes(cell(20))) continue;
    const integer = (index: number): number | null => {
      const value = cell(index);
      if (value === '') return null;
      const parsed = Number(value);
      return parsed;
    };
    const row: Record<string, string | number | null> = Object.fromEntries(
      COLUMNS.map((key, index) => [key, index < 10 ? cell(index) : cell(index) || null]),
    );
    row.schemaVersion = integer(8);
    row.seq = integer(10);
    row.page = integer(17);
    if (!Number.isInteger(row.schemaVersion) ||
        (row.seq !== null && !Number.isInteger(row.seq)) ||
        (row.page !== null && !Number.isInteger(row.page))) continue;
    result.push(row as unknown as QuoteSetRow);
  }
  return result;
}
