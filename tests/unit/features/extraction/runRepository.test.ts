import type { ExtractionRun } from '../../../../src/domain/extractionRun';
import {
  appendExtractionRun,
  extractionRunToRow,
} from '../../../../src/features/extraction/runRepository';

function makeRun(overrides: Partial<ExtractionRun> = {}): ExtractionRun {
  return {
    runId: 'run-1',
    runType: 'full',
    schemaVersion: 2,
    documentIds: ['doc-1', 'doc-2'],
    provider: 'gemini',
    requestedModel: 'gemini-2.5-flash',
    modelVersion: 'gemini-2.5-flash-001',
    inputMode: 'text_only',
    status: 'done',
    startedAt: 't1',
    finishedAt: 't2',
    tokensIn: 1000,
    tokensOut: 200,
    costEstimate: 0.01,
    ...overrides,
  };
}

describe('extractionRunToRow', () => {
  test('SHEET_HEADERS.ExtractionRuns の列順に対応し、document_ids はカンマ区切り', () => {
    expect(extractionRunToRow(makeRun())).toEqual([
      'run-1',
      'full',
      2,
      'doc-1,doc-2',
      'gemini',
      'gemini-2.5-flash',
      'gemini-2.5-flash-001',
      'text_only',
      'done',
      't1',
      't2',
      1000,
      200,
      0.01,
    ]);
  });

  test('null 許容列（model_version / tokens / cost 等）は null をそのまま返す', () => {
    const row = extractionRunToRow(
      makeRun({
        modelVersion: null,
        startedAt: null,
        finishedAt: null,
        tokensIn: null,
        tokensOut: null,
        costEstimate: null,
      }),
    );
    expect(row.slice(6)).toEqual([null, 'text_only', 'done', null, null, null, null, null]);
  });
});

describe('appendExtractionRun', () => {
  test('ExtractionRuns タブへ 1 行追記する', async () => {
    const fetch = jest.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({}),
      text: async () => '{}',
    } as Response);
    await appendExtractionRun('sid', makeRun(), {
      fetch,
      getAccessToken: jest.fn().mockResolvedValue('token'),
    });
    expect(fetch).toHaveBeenCalledTimes(1);
    const [url, init] = fetch.mock.calls[0];
    expect(decodeURIComponent(url as string)).toContain('/sid/values/ExtractionRuns!A1:append');
    const body = JSON.parse((init as RequestInit).body as string);
    expect(body.values[0][0]).toBe('run-1');
  });
});
