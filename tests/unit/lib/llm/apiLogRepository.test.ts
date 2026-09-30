import { isWarningOnlyLogEntry, type LlmApiLogEntry } from '../../../../src/domain/llmApiLog';
import { SHEET_HEADERS } from '../../../../src/domain/sheetsSchema';
import { appendLlmApiLog, ensureLlmApiLogColumns, logEntryToRow, readLlmApiLogEntries } from '../../../../src/lib/llm/apiLogRepository';

function makeEntry(overrides: Partial<LlmApiLogEntry> = {}): LlmApiLogEntry {
  return {
    logId: 'log-1',
    timestamp: 't1',
    provider: 'gemini',
    model: 'gemini-2.5-flash',
    purpose: 'extract_study',
    promptRef: 'https://drive/p',
    responseRef: 'https://drive/r',
    promptSummary: '[system] Extract…',
    tokensIn: 1000,
    tokensOut: 200,
    cachedTokensIn: 800,
    latencyMs: 1234,
    costEstimateUsd: 0.01,
    error: null,
    runId: null,
    studyId: null,
    section: null,
    promptVersion: null,
    thoughtsTokensOut: null,
    ...overrides,
  };
}

describe('logEntryToRow', () => {
  test('SHEET_HEADERS.LLMApiLog の列順に対応する', () => {
    expect(logEntryToRow(makeEntry({
      runId: 'run-1',
      studyId: 'study-1',
      section: 'methods',
      promptVersion: 9,
      thoughtsTokensOut: 50,
    }))).toEqual([
      'log-1',
      't1',
      'gemini',
      'gemini-2.5-flash',
      'extract_study',
      'https://drive/p',
      'https://drive/r',
      '[system] Extract…',
      1000,
      200,
      1234,
      0.01,
      null,
      // 後付け列もヘッダと同じ順で末尾に続く
      800,
      'run-1',
      'study-1',
      'methods',
      9,
      50,
    ]);
  });

  test('null 許容列は null をそのまま返す（エラー時のログ）', () => {
    const row = logEntryToRow(
      makeEntry({
        promptSummary: null,
        tokensIn: null,
        tokensOut: null,
        cachedTokensIn: null,
        latencyMs: null,
        costEstimateUsd: null,
        error: 'boom (status=503)',
      }),
    );
    expect(row.slice(7)).toEqual([
      null, null, null, null, null, 'boom (status=503)', null,
      null, null, null, null, null,
    ]);
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

describe('ensureLlmApiLogColumns', () => {
  function makeDeps(valueRanges: unknown[]) {
    const fetch = jest.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ valueRanges }),
    } as Response);
    return { fetch, getAccessToken: jest.fn().mockResolvedValue('token') };
  }

  test.each([13, 14])('旧ヘッダ %i 列を完全なヘッダへ拡張する', async (length) => {
    const deps = makeDeps([{ values: [SHEET_HEADERS.LLMApiLog.slice(0, length)] }]);
    await ensureLlmApiLogColumns('sid', deps);
    expect(deps.fetch).toHaveBeenCalledTimes(2);
    const [url, init] = deps.fetch.mock.calls[1]!;
    expect(decodeURIComponent(url as string)).toContain('/sid/values/LLMApiLog!A1');
    expect((init as RequestInit).method).toBe('PUT');
    expect(JSON.parse((init as RequestInit).body as string).values).toEqual([
      SHEET_HEADERS.LLMApiLog,
    ]);
  });

  test('完全なヘッダは繰り返し呼んでも書き換えない', async () => {
    const deps = makeDeps([{ values: [SHEET_HEADERS.LLMApiLog] }]);
    await ensureLlmApiLogColumns('sid', deps);
    await ensureLlmApiLogColumns('sid', deps);
    expect(deps.fetch).toHaveBeenCalledTimes(2);
    for (const [url] of deps.fetch.mock.calls) {
      expect(url).toContain('batchGet');
    }
  });

  test('追加列の名前は検証せず、先頭 13 列だけを検証する', async () => {
    const deps = makeDeps([
      {
        values: [[...SHEET_HEADERS.LLMApiLog.slice(0, 13), '旧追加列']],
      },
    ]);
    await ensureLlmApiLogColumns('sid', deps);
    expect(deps.fetch).toHaveBeenCalledTimes(2);
  });

  test.each([
    [], [{}], [{ values: [] }], [{ values: [['', null, '']] }],
    [{ values: [SHEET_HEADERS.LLMApiLog.slice(0, 12)] }],
    [{ values: [[...SHEET_HEADERS.LLMApiLog.slice(0, 12), '', ...Array(6).fill('')]] }],
  ].map((ranges) => ({ ranges })))(
    '欠落・空のヘッダセルは競合とみなさず補完する: %j', async ({ ranges }) => {
      const deps = makeDeps(ranges);
      await ensureLlmApiLogColumns('sid', deps);
      expect(deps.fetch).toHaveBeenCalledTimes(2);
      const [, init] = deps.fetch.mock.calls[1]!;
      expect(JSON.parse((init as RequestInit).body as string).values).toEqual([
        SHEET_HEADERS.LLMApiLog,
      ]);
    },
  );

  test('空でない先頭の列名が競合した場合だけ書き込まず拒否する', async () => {
    const deps = makeDeps([{ values: [['別の列']] }]);
    await expect(ensureLlmApiLogColumns('sid', deps)).rejects.toThrow(
      /LLMApiLog のヘッダ .*任意列の移行を中止します/,
    );
    expect(deps.fetch).toHaveBeenCalledTimes(1);
  });
});

describe('isWarningOnlyLogEntry', () => {
  test.each([
    ['', '', true],
    ['', 'response', false],
    ['prompt', '', false],
    ['prompt', 'response', false],
  ])('両参照が空の場合だけ警告専用と判定する: %j / %j', (promptRef, responseRef, expected) => {
    expect(isWarningOnlyLogEntry(makeEntry({ promptRef, responseRef }))).toBe(expected);
  });
});

describe('readLlmApiLogEntries', () => {
  function depsFor(values: unknown[][]) {
    return {
      getAccessToken: jest.fn().mockResolvedValue('token'),
      fetch: jest.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({ values }),
      } as Response),
    };
  }

  test.each([13, 14, 19])('ヘッダが %i 列でも行の列位置で全使用量と文脈を読む', async (n) => {
    const entry = makeEntry({
      runId: 'run-1',
      studyId: 'study-1',
      section: 'methods',
      promptVersion: 9,
      thoughtsTokensOut: 50,
    });
    const row = logEntryToRow(entry).map((cell) => (cell === null ? '' : String(cell)));
    const deps = depsFor([SHEET_HEADERS.LLMApiLog.slice(0, n) as string[], row]);
    expect(await readLlmApiLogEntries('sid', deps)).toEqual([entry]);
    const [url] = deps.fetch.mock.calls[0]!;
    expect(decodeURIComponent(url as string)).toContain('/sid/values/LLMApiLog');
  });

  test('空行は除外し、旧行の後付け列と空・不正な数値は null にする', async () => {
    const row = logEntryToRow(makeEntry()).slice(0, 13);
    row[7] = '';
    row[8] = '不正';
    row[9] = '';
    row[10] = 'Infinity';
    row[11] = null;
    row[12] = '';
    const entries = await readLlmApiLogEntries(
      'sid',
      depsFor([[...SHEET_HEADERS.LLMApiLog], [], ['', '', null], row]),
    );
    expect(entries).toEqual([
      makeEntry({
        promptSummary: null,
        tokensIn: null,
        tokensOut: null,
        cachedTokensIn: null,
        latencyMs: null,
        costEstimateUsd: null,
      }),
    ]);
  });

  test('未知の provider と purpose は落とさず、数値の 0 も維持する', async () => {
    const row = logEntryToRow(makeEntry());
    row[2] = 'future_provider';
    row[4] = 'future_purpose';
    row[8] = '0';
    const entries = await readLlmApiLogEntries('sid', depsFor([[...SHEET_HEADERS.LLMApiLog], row]));
    expect(entries[0]).toMatchObject({
      provider: 'future_provider',
      purpose: 'future_purpose',
      tokensIn: 0,
    });
  });

  test('欠落する必須セルは空文字、任意セルは null で保持する', async () => {
    const row = Array(19).fill(undefined);
    row[7] = '一部だけ残る';
    const entries = await readLlmApiLogEntries('sid', depsFor([[...SHEET_HEADERS.LLMApiLog], row]));
    expect(entries).toEqual([
      {
        logId: '',
        timestamp: '',
        provider: '',
        model: '',
        purpose: '',
        promptRef: '',
        responseRef: '',
        promptSummary: '一部だけ残る',
        tokensIn: null,
        tokensOut: null,
        latencyMs: null,
        costEstimateUsd: null,
        error: null,
        cachedTokensIn: null,
        runId: null,
        studyId: null,
        section: null,
        promptVersion: null,
        thoughtsTokensOut: null,
      },
    ]);
  });

  test('空のタブは空配列になる', async () => {
    expect(await readLlmApiLogEntries('sid', depsFor([]))).toEqual([]);
  });
});

test('質問用途と空の参照をシート行に維持する', () => {
  expect(
    logEntryToRow(
      makeEntry({ purpose: 'ask_paper', promptRef: '', responseRef: '', promptSummary: null }),
    ).slice(4, 8),
  ).toEqual(['ask_paper', '', '', null]);
});
