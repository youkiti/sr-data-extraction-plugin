// アウトカムの一覧の後方互換と追記・ヘッダー検証のテスト。
import { SHEET_HEADERS } from '../../../../src/domain/sheetsSchema';
import { appendSchemaOutcomes, readAllSchemaOutcomes } from '../../../../src/features/schema/schemaOutcomeRepository';
import { addSheetTab, appendRows, getSheetTitles, getSheetValues, writeHeaderRow } from '../../../../src/lib/google/sheets';
import type { GoogleApiDeps } from '../../../../src/lib/google/types';

jest.mock('../../../../src/lib/google/sheets');
const deps = {} as GoogleApiDeps;
const header = [...SHEET_HEADERS.SchemaOutcomes];
const row = ['1', '1', 'mortality', '全死亡', '定義', '30d|90d', 'migration', '注記'];
const outcome = {
  schemaVersion: 1, outcomeIndex: 1, outcomeId: 'mortality', outcomeLabel: '全死亡',
  description: '定義', typicalTimepoints: '30d|90d', addedVia: 'migration' as const, note: '注記',
};

test('AI ドラフト由来の経路を読み書きする', async () => {
  jest.mocked(getSheetTitles).mockResolvedValue(['SchemaOutcomes']);
  const draftedRow = [...row];
  draftedRow[6] = 'ai_draft';
  jest.mocked(getSheetValues).mockResolvedValue([header, draftedRow]);
  const drafted = { ...outcome, addedVia: 'ai_draft' as const };
  await expect(readAllSchemaOutcomes('s', deps)).resolves.toEqual([drafted]);
  await appendSchemaOutcomes('s', [drafted], deps);
  expect(appendRows).toHaveBeenCalledWith('s', 'SchemaOutcomes', [[1, 1, ...draftedRow.slice(2)]], deps);
});

test('タブの無い旧プロジェクトは空で読む', async () => {
  jest.mocked(getSheetTitles).mockResolvedValue([]);
  await expect(readAllSchemaOutcomes('s', deps)).resolves.toEqual([]);
  expect(getSheetValues).not.toHaveBeenCalled();
});

test('ヘッダーを検証し、壊れた行を捨て、未知の追加経路を既定値で読む', async () => {
  jest.mocked(getSheetTitles).mockResolvedValue(['SchemaOutcomes']);
  jest.mocked(getSheetValues).mockResolvedValue([['wrong']]);
  await expect(readAllSchemaOutcomes('s', deps)).rejects.toThrow('ヘッダー');
  await expect(appendSchemaOutcomes('s', [outcome], deps)).rejects.toThrow('ヘッダー');
  jest.mocked(getSheetValues).mockResolvedValue([
    [...header, 'future_column'], row, ['2', '1', 'pain', '疼痛', '', '', 'future'],
    ['bad', '1', 'x'], ['', '1', 'x'], ['1', '1', ''], [], ['1', '2', 'sparse'],
  ]);
  await expect(readAllSchemaOutcomes('s', deps)).resolves.toEqual([
    outcome,
    { ...outcome, schemaVersion: 2, outcomeId: 'pain', outcomeLabel: '疼痛', description: null, typicalTimepoints: null, addedVia: 'schema_editor', note: null },
    { ...outcome, outcomeIndex: 2, outcomeId: 'sparse', outcomeLabel: '', description: null, typicalTimepoints: null, addedVia: 'schema_editor', note: null },
  ]);
});

test('空なら I/O せず、初回はタブとヘッダーを作り、以降は検証して追記する', async () => {
  await appendSchemaOutcomes('s', [], deps);
  expect(getSheetTitles).not.toHaveBeenCalled();
  jest.mocked(getSheetTitles).mockResolvedValue([]);
  await appendSchemaOutcomes('s', [outcome], deps);
  expect(addSheetTab).toHaveBeenCalledWith('s', 'SchemaOutcomes', deps);
  expect(writeHeaderRow).toHaveBeenCalledWith('s', 'SchemaOutcomes', header, deps);
  expect(appendRows).toHaveBeenCalledWith('s', 'SchemaOutcomes', [[1, 1, ...row.slice(2)]], deps);
  jest.mocked(addSheetTab).mockClear();
  jest.mocked(getSheetTitles).mockResolvedValue(['SchemaOutcomes']);
  jest.mocked(getSheetValues).mockResolvedValue([header]);
  await appendSchemaOutcomes('s', [{ ...outcome, description: null, typicalTimepoints: null, note: null }], deps);
  expect(addSheetTab).not.toHaveBeenCalled();
  expect(appendRows).toHaveBeenLastCalledWith('s', 'SchemaOutcomes', [[1, 1, 'mortality', '全死亡', '', '', 'migration', '']], deps);
});

test.each<{ values: string[][] }>([{ values: [] }, { values: [[]] }, { values: [['', '  ']] }])('空のタブは空一覧として読み、ヘッダーを復旧してから追記する: %j', async ({ values }) => {
  jest.mocked(getSheetTitles).mockResolvedValue(['SchemaOutcomes']);
  jest.mocked(getSheetValues).mockResolvedValue(values);
  await expect(readAllSchemaOutcomes('s', deps)).resolves.toEqual([]);
  await appendSchemaOutcomes('s', [outcome], deps);
  expect(addSheetTab).not.toHaveBeenCalled();
  expect(writeHeaderRow).toHaveBeenCalledWith('s', 'SchemaOutcomes', header, deps);
  expect(appendRows).toHaveBeenCalledWith('s', 'SchemaOutcomes', [[1, 1, ...row.slice(2)]], deps);
  expect(jest.mocked(writeHeaderRow).mock.invocationCallOrder[0]).toBeLessThan(jest.mocked(appendRows).mock.invocationCallOrder[0]!);
});
