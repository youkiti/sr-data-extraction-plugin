// アウトカムの一覧を、版ごとの追記型タブから読み書きする。
import type { OutcomeAddedVia, SchemaOutcome } from '../../domain/schemaOutcome';
import { SHEET_HEADERS } from '../../domain/sheetsSchema';
import { addSheetTab, appendRows, getSheetTitles, getSheetValues, writeHeaderRow } from '../../lib/google/sheets';
import type { GoogleApiDeps } from '../../lib/google/types';

const TAB = 'SchemaOutcomes';
const ADDED_VIA: readonly string[] = ['schema_editor', 'ai_draft', 'pilot_verify', 'pilot_candidate', 'migration', 'file_import'];

async function validateHeader(spreadsheetId: string, deps: GoogleApiDeps): Promise<string[][]> {
  const values = await getSheetValues(spreadsheetId, TAB, deps);
  if (!values[0]?.some((cell) => cell.trim() !== '')) {
    return [];
  }
  if (SHEET_HEADERS.SchemaOutcomes.some((name, index) => values[0]?.[index] !== name)) {
    throw new Error('SchemaOutcomes: ヘッダーが一致しません');
  }
  return values;
}

/** タブとヘッダーを確かめて全版のアウトカムを読む。 */
export async function readAllSchemaOutcomes(spreadsheetId: string, deps: GoogleApiDeps): Promise<SchemaOutcome[]> {
  const titles = await getSheetTitles(spreadsheetId, deps);
  if (!titles.includes(TAB)) {
    return [];
  }
  const values = await validateHeader(spreadsheetId, deps);
  return values.slice(1).flatMap<SchemaOutcome>((row) => {
    const schemaVersion = Number(row[0]);
    const outcomeId = row[2]?.trim();
    if (!row[0]?.trim() || !Number.isFinite(schemaVersion) || !outcomeId) {
      return [];
    }
    return [{
      schemaVersion,
      outcomeIndex: Number(row[1]),
      outcomeId,
      outcomeLabel: row[3] ?? '',
      description: row[4] || null,
      typicalTimepoints: row[5] || null,
      addedVia: ADDED_VIA.includes(row[6] ?? '') ? row[6] as OutcomeAddedVia : 'schema_editor',
      note: row[7] || null,
    }];
  });
}

/** 必要ならタブを作成し、版のアウトカムの全行を追記する。 */
export async function appendSchemaOutcomes(spreadsheetId: string, outcomes: readonly SchemaOutcome[], deps: GoogleApiDeps): Promise<void> {
  if (outcomes.length === 0) {
    return;
  }
  const titles = await getSheetTitles(spreadsheetId, deps);
  if (!titles.includes(TAB)) {
    await addSheetTab(spreadsheetId, TAB, deps);
    await writeHeaderRow(spreadsheetId, TAB, SHEET_HEADERS.SchemaOutcomes, deps);
  } else {
    const values = await validateHeader(spreadsheetId, deps);
    if (values.length === 0) {
      await writeHeaderRow(spreadsheetId, TAB, SHEET_HEADERS.SchemaOutcomes, deps);
    }
  }
  await appendRows(spreadsheetId, TAB, outcomes.map((row) => [
    row.schemaVersion, row.outcomeIndex, row.outcomeId, row.outcomeLabel,
    row.description ?? '', row.typicalTimepoints ?? '', row.addedVia, row.note ?? '',
  ]), deps);
}
