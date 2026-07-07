import type { ExportLogEntry } from '../../../../src/domain/exportLog';
import {
  appendExportLog,
  exportLogToRow,
} from '../../../../src/features/export/exportLogRepository';

function makeEntry(overrides: Partial<ExportLogEntry> = {}): ExportLogEntry {
  return {
    exportId: 'exp-1',
    format: 'study_wide',
    schemaVersion: 2,
    studyCount: 3,
    fileRef: 'https://drive.google.com/file/d/x/view',
    exportedAt: '2026-07-03T00:00:00.000Z',
    exportedBy: 'me@example.com',
    ...overrides,
  };
}

describe('exportLogToRow', () => {
  test('SHEET_HEADERS.ExportLog の列順（export_id〜exported_by）に対応する', () => {
    expect(exportLogToRow(makeEntry())).toEqual([
      'exp-1',
      'study_wide',
      2,
      3,
      'https://drive.google.com/file/d/x/view',
      '2026-07-03T00:00:00.000Z',
      'me@example.com',
    ]);
  });
});

describe('appendExportLog', () => {
  test('ExportLog タブへ 1 行追記する', async () => {
    const fetch = jest.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({}),
      text: async () => '{}',
    } as Response);
    await appendExportLog('sid', makeEntry(), {
      fetch,
      getAccessToken: jest.fn().mockResolvedValue('token'),
    });
    expect(fetch).toHaveBeenCalledTimes(1);
    const [url, init] = fetch.mock.calls[0];
    expect(decodeURIComponent(url as string)).toContain('/sid/values/ExportLog!A1:append');
    const body = JSON.parse((init as RequestInit).body as string);
    expect(body.values[0]).toEqual([
      'exp-1',
      'study_wide',
      2,
      3,
      'https://drive.google.com/file/d/x/view',
      '2026-07-03T00:00:00.000Z',
      'me@example.com',
    ]);
  });
});
