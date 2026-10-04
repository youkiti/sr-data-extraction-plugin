import { SHEET_HEADERS } from '../../../../src/domain/sheetsSchema';
import { appendQuoteSetRows, ensureQuoteSetsTab, readQuoteSetRows } from '../../../../src/features/verification/quoteSetRepository';
import { buildQuoteSetResetRow } from '../../../../src/features/verification/cellQuotes';
import { addSheetTab, appendRows, getSheetTitles, getSheetValues, writeHeaderRow } from '../../../../src/lib/google/sheets';
import { quoteRow } from './quoteSetFixtures';

jest.mock('../../../../src/lib/google/sheets');
const deps = { getAccessToken: jest.fn(), fetch: jest.fn() };
const header = [...SHEET_HEADERS.QuoteSets];
const raw = ['set', 'time', 'editor', 'reviewer', 'human_with_ai', 'study', 'field', '-',
  '1', 'quote', '1', 'ev', 'ai', 'ev', '', 'doc', 'quote', '1', 'Results', 'theme', 'exact', 'run'];

beforeEach(() => {
  jest.resetAllMocks();
  jest.mocked(getSheetTitles).mockResolvedValue(['QuoteSets']);
  jest.mocked(getSheetValues).mockResolvedValue([header, raw]);
});

test('タブが無ければ読み取りは空で、作成はタブ追加からヘッダの順', async () => {
  jest.mocked(getSheetTitles).mockResolvedValue([]);
  await expect(readQuoteSetRows('sid', deps)).resolves.toEqual([]);
  expect(getSheetValues).not.toHaveBeenCalled();
  await ensureQuoteSetsTab('sid', deps);
  expect(addSheetTab).toHaveBeenCalledWith('sid', 'QuoteSets', deps);
  expect(writeHeaderRow).toHaveBeenCalledWith('sid', 'QuoteSets', header, deps);
  expect(jest.mocked(addSheetTab).mock.invocationCallOrder[0])
    .toBeLessThan(jest.mocked(writeHeaderRow).mock.invocationCallOrder[0]!);
});

test('既存タブは変更せず、空配列は API を呼ばない', async () => {
  await appendQuoteSetRows('sid', [], deps);
  expect(getSheetTitles).not.toHaveBeenCalled();
  await ensureQuoteSetsTab('sid', deps);
  expect(addSheetTab).not.toHaveBeenCalled();
  expect(writeHeaderRow).not.toHaveBeenCalled();
});

test('保存は ensure 後に全行を一度で追記し、null は空セルとして渡す', async () => {
  const row = quoteRow();
  const reset = buildQuoteSetResetRow({ setId: 'reset', savedAt: 'time', savedBy: 'editor',
    annotator: 'reviewer', annotatorType: 'human_with_ai', studyId: 'study', fieldId: 'field',
    entityKey: '-', schemaVersion: 1, baseRunId: null });
  await appendQuoteSetRows('sid', [row, reset], deps);
  expect(appendRows).toHaveBeenCalledTimes(1);
  expect(appendRows).toHaveBeenCalledWith('sid', 'QuoteSets', [
    raw.map((v, i) => [8, 10, 17].includes(i) ? Number(v) : v || null),
    ['reset', 'time', 'editor', 'reviewer', 'human_with_ai', 'study', 'field', '-',
      1, 'reset', ...Array(12).fill(null)],
  ], deps);
  expect(jest.mocked(getSheetTitles).mock.invocationCallOrder[0])
    .toBeLessThan(jest.mocked(appendRows).mock.invocationCallOrder[0]!);
});

test('追記・タブ作成の失敗を呼び出し元へ返す', async () => {
  const error = new Error('保存失敗');
  jest.mocked(appendRows).mockRejectedValueOnce(error);
  await expect(appendQuoteSetRows('sid', [quoteRow()], deps)).rejects.toBe(error);
  jest.mocked(getSheetTitles).mockResolvedValue([]);
  jest.mocked(addSheetTab).mockRejectedValueOnce(error);
  await expect(appendQuoteSetRows('sid', [quoteRow()], deps)).rejects.toBe(error);
});

test('整数と null を復元し、シート行順と追加ヘッダを許容する', async () => {
  const empty = raw.slice(0, 10);
  empty[9] = 'empty';
  jest.mocked(getSheetValues).mockResolvedValue([[...header, 'extra'], raw, empty]);
  const result = await readQuoteSetRows('sid', deps);
  expect(result[0]).toEqual(quoteRow());
  expect(result[1]).toEqual({ ...buildQuoteSetResetRow({ setId: 'set', savedAt: 'time', savedBy: 'editor',
    annotator: 'reviewer', annotatorType: 'human_with_ai', studyId: 'study', fieldId: 'field',
    entityKey: '-', schemaVersion: 1, baseRunId: null }), kind: 'empty' });
  jest.mocked(getSheetValues).mockResolvedValue([header]);
  await expect(readQuoteSetRows('sid', deps)).resolves.toEqual([]);
});

test('未知の kind・source・annotator_type・anchor_status はその行だけ読み飛ばす', async () => {
  const invalid = [9, 12, 4, 20].map((index) => {
    const row = [...raw]; row[index] = 'unknown'; return row;
  });
  jest.mocked(getSheetValues).mockResolvedValue([header, ...invalid, [], raw]);
  await expect(readQuoteSetRows('sid', deps)).resolves.toEqual([quoteRow()]);
});

test.each([undefined, [], [...header.slice(0, 21), 'wrong']])('ヘッダ欠損・不一致は throw: %s', async (value) => {
  jest.mocked(getSheetValues).mockResolvedValue(value === undefined ? [] : [value]);
  await expect(readQuoteSetRows('sid', deps)).rejects.toThrow('QuoteSets');
});

test.each([[8, ''], [8, '1.5'], [10, 'NaN'], [17, '1.2']])('整数列の不正値は throw: %s %s', async (index, value) => {
  const row = [...raw]; row[Number(index)] = String(value);
  jest.mocked(getSheetValues).mockResolvedValue([header, row]);
  await expect(readQuoteSetRows('sid', deps)).rejects.toThrow('整数ではありません');
});
