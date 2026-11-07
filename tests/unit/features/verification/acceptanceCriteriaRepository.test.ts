import { SHEET_HEADERS } from '../../../../src/domain/sheetsSchema';
import { confirmCriteria, criteriaToRow, emptyCriteriaDraft } from '../../../../src/features/verification/acceptanceCriteria';
import { appendAcceptanceCriteria, readAcceptanceCriteria } from '../../../../src/features/verification/acceptanceCriteriaRepository';
import { addSheetTab, appendRows, getSheetTitles, getSheetValues, writeHeaderRow } from '../../../../src/lib/google/sheets';
import type { GoogleApiDeps } from '../../../../src/lib/google/types';
jest.mock('../../../../src/lib/google/sheets');
const deps = {} as GoogleApiDeps;
const value = confirmCriteria({ ...emptyCriteriaDraft(), min_accuracy: '90' }, [], 'owner@example.com', '2026-11-07T00:00:00Z', 0);

test('旧プロジェクトは空、存在するタブはヘッダを検証して読み込む', async () => {
  jest.mocked(getSheetTitles).mockResolvedValue([]);
  await expect(readAcceptanceCriteria('s', deps)).resolves.toEqual({ versions: [], ignoredCount: 0 });
  jest.mocked(getSheetTitles).mockResolvedValue(['AcceptanceCriteria']);
  for (const values of [[], [['bad']]]) {
    jest.mocked(getSheetValues).mockResolvedValue(values);
    await expect(readAcceptanceCriteria('s', deps)).rejects.toThrow('header');
  }
  jest.mocked(getSheetValues).mockResolvedValue([[...SHEET_HEADERS.AcceptanceCriteria], criteriaToRow(value), []]);
  await expect(readAcceptanceCriteria('s', deps)).resolves.toEqual({ versions: [value], ignoredCount: 1 });
});

test('タブが無ければ作成して追記し、既存なら追記だけ行う', async () => {
  jest.mocked(getSheetTitles).mockResolvedValue([]);
  await appendAcceptanceCriteria('s', value, deps);
  expect(addSheetTab).toHaveBeenCalledWith('s', 'AcceptanceCriteria', deps);
  expect(writeHeaderRow).toHaveBeenCalledWith('s', 'AcceptanceCriteria', SHEET_HEADERS.AcceptanceCriteria, deps);
  expect(appendRows).toHaveBeenCalledWith('s', 'AcceptanceCriteria', [criteriaToRow(value)], deps);
  jest.mocked(addSheetTab).mockClear();
  jest.mocked(writeHeaderRow).mockClear();
  jest.mocked(getSheetTitles).mockResolvedValue(['AcceptanceCriteria']);
  await appendAcceptanceCriteria('s', { ...value, version: 2 }, deps);
  expect(addSheetTab).not.toHaveBeenCalled();
  expect(writeHeaderRow).not.toHaveBeenCalled();
});
