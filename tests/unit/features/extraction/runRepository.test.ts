import type { ExtractionRun } from '../../../../src/domain/extractionRun';
import { SHEET_HEADERS } from '../../../../src/domain/sheetsSchema';
import {
  appendExtractionRun,
  extractionRunToRow,
  readExtractedDocumentIds,
  readRunAuditInfos,
  readRunSchemaVersions,
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

describe('readRunSchemaVersions', () => {
  function readDeps(values: string[][]): { fetch: jest.Mock; getAccessToken: jest.Mock } {
    return {
      fetch: jest.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({ values }),
        text: async () => '',
      } as Response),
      getAccessToken: jest.fn().mockResolvedValue('token'),
    };
  }

  const runRow = (runId: string, version: string): string[] => [
    runId,
    'pilot',
    version,
    'doc-1',
    'gemini',
    'gemini-test',
    '',
    'text_only',
    'done',
    't1',
    't2',
    '',
    '',
    '',
  ];

  test('run_id → schema_version のマップを返す', async () => {
    const values = [[...SHEET_HEADERS.ExtractionRuns], runRow('run-1', '1'), runRow('run-2', '3')];
    const map = await readRunSchemaVersions('sheet-1', readDeps(values));
    expect(map.get('run-1')).toBe(1);
    expect(map.get('run-2')).toBe(3);
    expect(map.size).toBe(2);
  });

  test('ヘッダ行なし・列名不一致・schema_version 非整数はエラー', async () => {
    await expect(readRunSchemaVersions('sheet-1', readDeps([]))).rejects.toThrow(
      'ExtractionRuns タブにヘッダ行がありません',
    );
    const badHeader = [...SHEET_HEADERS.ExtractionRuns];
    badHeader[2] = 'wrong';
    await expect(readRunSchemaVersions('sheet-1', readDeps([badHeader]))).rejects.toThrow(
      'ExtractionRuns のヘッダ 3 列目が "schema_version" ではありません',
    );
    await expect(
      readRunSchemaVersions(
        'sheet-1',
        readDeps([[...SHEET_HEADERS.ExtractionRuns], runRow('run-1', 'v1')]),
      ),
    ).rejects.toThrow('ExtractionRuns 2 行目: schema_version "v1" が整数ではありません');
  });

  test('ヘッダのラグ配列（列の欠落）は空文字として不一致エラー', async () => {
    const shortHeader = [...SHEET_HEADERS.ExtractionRuns].slice(0, 2);
    await expect(readRunSchemaVersions('sheet-1', readDeps([shortHeader]))).rejects.toThrow(
      'ExtractionRuns のヘッダ 3 列目が "schema_version" ではありません（実際: ""）',
    );
  });

  test('データ行のラグ配列（schema_version 欠落）はエラー', async () => {
    await expect(
      readRunSchemaVersions('sheet-1', readDeps([[...SHEET_HEADERS.ExtractionRuns], []])),
    ).rejects.toThrow('ExtractionRuns 2 行目: schema_version "" が整数ではありません');
  });
});

describe('readRunAuditInfos', () => {
  function readDeps(values: string[][]): { fetch: jest.Mock; getAccessToken: jest.Mock } {
    return {
      fetch: jest.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({ values }),
        text: async () => '',
      } as Response),
      getAccessToken: jest.fn().mockResolvedValue('token'),
    };
  }

  const runRow = (runId: string, version: string, startedAt: string): string[] => [
    runId,
    'pilot',
    version,
    'doc-1',
    'gemini',
    'gemini-test',
    '',
    'text_only',
    'done',
    startedAt,
    't2',
    '',
    '',
    '',
  ];

  test('run_id / schema_version / started_at の最小情報を全行ぶん返す', async () => {
    const values = [
      [...SHEET_HEADERS.ExtractionRuns],
      runRow('run-1', '1', 't1'),
      runRow('run-2', '3', ''),
    ];
    expect(await readRunAuditInfos('sheet-1', readDeps(values))).toEqual([
      { runId: 'run-1', schemaVersion: 1, startedAt: 't1' },
      { runId: 'run-2', schemaVersion: 3, startedAt: null }, // 空セルは null（最古扱い）
    ]);
  });

  test('run_id が null・started_at 欠落のラグ配列は空文字 / null として読む', async () => {
    const values = [
      [...SHEET_HEADERS.ExtractionRuns],
      [null as unknown as string, 'pilot', '2'],
    ];
    expect(await readRunAuditInfos('sheet-1', readDeps(values))).toEqual([
      { runId: '', schemaVersion: 2, startedAt: null },
    ]);
  });

  test('schema_version 非整数・空セル・列ごと欠落はエラー（readRunSchemaVersions と同じ規約）', async () => {
    await expect(
      readRunAuditInfos(
        'sheet-1',
        readDeps([[...SHEET_HEADERS.ExtractionRuns], runRow('run-1', 'v1', 't1')]),
      ),
    ).rejects.toThrow('ExtractionRuns 2 行目: schema_version "v1" が整数ではありません');
    await expect(
      readRunAuditInfos(
        'sheet-1',
        readDeps([[...SHEET_HEADERS.ExtractionRuns], runRow('run-1', '', 't1')]),
      ),
    ).rejects.toThrow('ExtractionRuns 2 行目: schema_version "" が整数ではありません');
    await expect(
      readRunAuditInfos('sheet-1', readDeps([[...SHEET_HEADERS.ExtractionRuns], ['run-x']])),
    ).rejects.toThrow('ExtractionRuns 2 行目: schema_version "" が整数ではありません');
  });
});

describe('readExtractedDocumentIds', () => {
  function readDeps(values: string[][]): { fetch: jest.Mock; getAccessToken: jest.Mock } {
    return {
      fetch: jest.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({ values }),
        text: async () => '',
      } as Response),
      getAccessToken: jest.fn().mockResolvedValue('token'),
    };
  }

  const runRow = (documentIds: string): string[] => [
    'run-1',
    'pilot',
    '1',
    documentIds,
    'gemini',
    'gemini-test',
    '',
    'text_only',
    'done',
    't1',
    't2',
    '',
    '',
    '',
  ];

  test('全 run の document_ids（カンマ区切り）の和集合を返す', async () => {
    const values = [
      [...SHEET_HEADERS.ExtractionRuns],
      runRow('doc-1,doc-2'),
      runRow('doc-2,doc-3'),
    ];
    const ids = await readExtractedDocumentIds('sheet-1', readDeps(values));
    expect([...ids].sort()).toEqual(['doc-1', 'doc-2', 'doc-3']);
  });

  test('run 0 件は空集合、document_ids 欠落行（ラグ配列）は無視する', async () => {
    expect((await readExtractedDocumentIds('sheet-1', readDeps([[...SHEET_HEADERS.ExtractionRuns]]))).size).toBe(0);
    const ids = await readExtractedDocumentIds(
      'sheet-1',
      readDeps([[...SHEET_HEADERS.ExtractionRuns], ['run-1', 'pilot', '1']]),
    );
    expect(ids.size).toBe(0);
  });

  test('ヘッダ行なしはエラー（readRunSchemaVersions と同じ前処理）', async () => {
    await expect(readExtractedDocumentIds('sheet-1', readDeps([]))).rejects.toThrow(
      'ExtractionRuns タブにヘッダ行がありません',
    );
  });
});
