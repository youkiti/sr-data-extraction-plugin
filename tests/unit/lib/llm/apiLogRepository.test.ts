import type { LlmApiLogEntry } from '../../../../src/domain/llmApiLog';
import { appendLlmApiLog, logEntryToRow } from '../../../../src/lib/llm/apiLogRepository';

function makeEntry(overrides: Partial<LlmApiLogEntry> = {}): LlmApiLogEntry {
  return {
    logId: 'log-1',
    timestamp: 't1',
    provider: 'gemini',
    model: 'gemini-2.5-flash',
    purpose: 'extract_document',
    promptRef: 'https://drive/p',
    responseRef: 'https://drive/r',
    promptSummary: '[system] Extract…',
    tokensIn: 1000,
    tokensOut: 200,
    latencyMs: 1234,
    costEstimateUsd: 0.01,
    error: null,
    ...overrides,
  };
}

describe('logEntryToRow', () => {
  test('SHEET_HEADERS.LLMApiLog の列順に対応する', () => {
    expect(logEntryToRow(makeEntry())).toEqual([
      'log-1',
      't1',
      'gemini',
      'gemini-2.5-flash',
      'extract_document',
      'https://drive/p',
      'https://drive/r',
      '[system] Extract…',
      1000,
      200,
      1234,
      0.01,
      null,
    ]);
  });

  test('null 許容列は null をそのまま返す（エラー時のログ）', () => {
    const row = logEntryToRow(
      makeEntry({
        promptSummary: null,
        tokensIn: null,
        tokensOut: null,
        latencyMs: null,
        costEstimateUsd: null,
        error: 'boom (status=503)',
      }),
    );
    expect(row.slice(7)).toEqual([null, null, null, null, null, 'boom (status=503)']);
  });
});

describe('appendLlmApiLog', () => {
  test('LLMApiLog タブへ 1 行追記する', async () => {
    const fetch = jest.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({}),
      text: async () => '{}',
    } as Response);
    await appendLlmApiLog('sid', makeEntry(), {
      fetch,
      getAccessToken: jest.fn().mockResolvedValue('token'),
    });
    expect(fetch).toHaveBeenCalledTimes(1);
    const [url, init] = fetch.mock.calls[0];
    expect(decodeURIComponent(url as string)).toContain('/sid/values/LLMApiLog!A1:append');
    const body = JSON.parse((init as RequestInit).body as string);
    expect(body.values[0][0]).toBe('log-1');
  });
});
