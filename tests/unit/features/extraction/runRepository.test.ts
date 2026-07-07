import type { ExtractionRun } from '../../../../src/domain/extractionRun';
import { SHEET_HEADERS } from '../../../../src/domain/sheetsSchema';
import {
  appendExtractionRun,
  extractionRunToRow,
  readPilotRuns,
  readRunAuditInfos,
  readRunDocumentCoverage,
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

describe('readRunDocumentCoverage', () => {
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

  const runRow = (runId: string, documentIds: string, status: string): string[] => [
    runId,
    'pilot',
    '1',
    documentIds,
    'gemini',
    'gemini-test',
    '',
    'text_only',
    status,
    't1',
    't2',
    '',
    '',
    '',
  ];

  test('完了行（done / partial_failure）の document_ids の和集合を extracted に返す', async () => {
    const values = [
      [...SHEET_HEADERS.ExtractionRuns],
      runRow('run-1', 'doc-1,doc-2', 'done'),
      runRow('run-2', 'doc-2,doc-3', 'partial_failure'),
    ];
    const coverage = await readRunDocumentCoverage('sheet-1', readDeps(values));
    expect([...coverage.extracted].sort()).toEqual(['doc-1', 'doc-2', 'doc-3']);
    expect(coverage.interrupted.size).toBe(0);
  });

  test('running 行のみの run（2 行プロトコルの中断）は抽出済みに数えず interrupted に返す', async () => {
    const values = [
      [...SHEET_HEADERS.ExtractionRuns],
      runRow('run-1', 'doc-1,doc-2', 'running'),
    ];
    const coverage = await readRunDocumentCoverage('sheet-1', readDeps(values));
    expect(coverage.extracted.size).toBe(0);
    expect([...coverage.interrupted].sort()).toEqual(['doc-1', 'doc-2']);
  });

  test('running 行 + 完了行が揃った run は完了扱い（interrupted に出ない）', async () => {
    const values = [
      [...SHEET_HEADERS.ExtractionRuns],
      runRow('run-1', 'doc-1,doc-2', 'running'),
      runRow('run-1', 'doc-1,doc-2', 'done'),
    ];
    const coverage = await readRunDocumentCoverage('sheet-1', readDeps(values));
    expect([...coverage.extracted].sort()).toEqual(['doc-1', 'doc-2']);
    expect(coverage.interrupted.size).toBe(0);
  });

  test('中断 run の文献でも、別の完了 run で抽出済みなら interrupted から除く', async () => {
    const values = [
      [...SHEET_HEADERS.ExtractionRuns],
      runRow('run-1', 'doc-1,doc-2', 'running'),
      runRow('run-2', 'doc-1', 'done'),
    ];
    const coverage = await readRunDocumentCoverage('sheet-1', readDeps(values));
    expect([...coverage.extracted]).toEqual(['doc-1']);
    expect([...coverage.interrupted]).toEqual(['doc-2']);
  });

  test('run 0 件は両方空集合、document_ids 欠落行（ラグ配列）は無視する', async () => {
    const empty = await readRunDocumentCoverage(
      'sheet-1',
      readDeps([[...SHEET_HEADERS.ExtractionRuns]]),
    );
    expect(empty.extracted.size).toBe(0);
    expect(empty.interrupted.size).toBe(0);
    const ragged = await readRunDocumentCoverage(
      'sheet-1',
      readDeps([[...SHEET_HEADERS.ExtractionRuns], ['run-1', 'pilot', '1']]),
    );
    expect(ragged.extracted.size).toBe(0);
    expect(ragged.interrupted.size).toBe(0);
  });

  test('run_id / document_ids が null セルの完了行も安全に読む', async () => {
    const values = [
      [...SHEET_HEADERS.ExtractionRuns],
      [null, 'pilot', '1', null, 'gemini', 'gemini-test', '', 'text_only', 'done'] as unknown as string[],
    ];
    const coverage = await readRunDocumentCoverage('sheet-1', readDeps(values));
    expect(coverage.extracted.size).toBe(0);
    expect(coverage.interrupted.size).toBe(0);
  });

  test('ヘッダ行なしはエラー（readRunSchemaVersions と同じ前処理）', async () => {
    await expect(readRunDocumentCoverage('sheet-1', readDeps([]))).rejects.toThrow(
      'ExtractionRuns タブにヘッダ行がありません',
    );
  });
});

describe('readPilotRuns', () => {
  function readDeps(values: (string | null)[][]): { fetch: jest.Mock; getAccessToken: jest.Mock } {
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

  const pilotRow = (
    o: Partial<{
      runId: string;
      runType: string;
      schemaVersion: string;
      documentIds: string;
      provider: string;
      requestedModel: string;
      modelVersion: string;
      inputMode: string;
      status: string;
      startedAt: string;
      finishedAt: string;
      tokensIn: string;
      tokensOut: string;
      costEstimate: string;
    }> = {},
  ): string[] => [
    o.runId ?? 'run-1',
    o.runType ?? 'pilot',
    o.schemaVersion ?? '1',
    o.documentIds ?? 'doc-1,doc-2',
    o.provider ?? 'gemini',
    o.requestedModel ?? 'gemini-test',
    o.modelVersion ?? '',
    o.inputMode ?? 'text_only',
    o.status ?? 'done',
    o.startedAt ?? 't1',
    o.finishedAt ?? 't2',
    o.tokensIn ?? '',
    o.tokensOut ?? '',
    o.costEstimate ?? '',
  ];

  test('run_type=pilot の完了行のみを新しい順で返す（full / running 行は除外）', async () => {
    const values = [
      [...SHEET_HEADERS.ExtractionRuns],
      pilotRow({ runId: 'p1', status: 'done' }),
      pilotRow({ runId: 'f1', runType: 'full', status: 'done' }), // pilot 以外は除外
      pilotRow({ runId: 'p2', status: 'running' }), // 完了行がない中断 run は除外
      pilotRow({ runId: 'p2', status: 'partial_failure' }), // p2 の完了行
    ];
    const runs = await readPilotRuns('sheet-1', readDeps(values));
    expect(runs.map((run) => run.runId)).toEqual(['p2', 'p1']); // 追記順の逆 = 新しい順
    expect(runs[0]?.status).toBe('partial_failure');
  });

  test('全列を ExtractionRun へパースする（数値・null 許容列を含む）', async () => {
    const values = [
      [...SHEET_HEADERS.ExtractionRuns],
      pilotRow({
        schemaVersion: '3',
        documentIds: 'd1,d2',
        modelVersion: 'gemini-test-001',
        tokensIn: '100',
        tokensOut: '50',
        costEstimate: '0.02',
      }),
    ];
    const runs = await readPilotRuns('sheet-1', readDeps(values));
    expect(runs[0]).toEqual({
      runId: 'run-1',
      runType: 'pilot',
      schemaVersion: 3,
      documentIds: ['d1', 'd2'],
      provider: 'gemini',
      requestedModel: 'gemini-test',
      modelVersion: 'gemini-test-001',
      inputMode: 'text_only',
      status: 'done',
      startedAt: 't1',
      finishedAt: 't2',
      tokensIn: 100,
      tokensOut: 50,
      costEstimate: 0.02,
    });
  });

  test('null 許容列（model_version / started_at / finished_at / tokens / cost）の空セルは null', async () => {
    const values = [[...SHEET_HEADERS.ExtractionRuns], pilotRow({ startedAt: '', finishedAt: '' })];
    const runs = await readPilotRuns('sheet-1', readDeps(values));
    expect(runs[0]).toMatchObject({
      modelVersion: null,
      startedAt: null,
      finishedAt: null,
      tokensIn: null,
      tokensOut: null,
      costEstimate: null,
    });
  });

  test('status 以降が欠落したラグ配列は null 列として安全に読む', async () => {
    // status（9 列目）までを持つ行。started_at 以降のセルは配列から欠落
    const short = pilotRow().slice(0, 9);
    const values = [[...SHEET_HEADERS.ExtractionRuns], short];
    const runs = await readPilotRuns('sheet-1', readDeps(values));
    expect(runs[0]).toMatchObject({
      status: 'done',
      startedAt: null,
      finishedAt: null,
      tokensIn: null,
      tokensOut: null,
      costEstimate: null,
    });
  });

  test('数値列の非数値はエラー（schema_version / tokens_in / tokens_out / cost_estimate）', async () => {
    await expect(
      readPilotRuns('sheet-1', readDeps([[...SHEET_HEADERS.ExtractionRuns], pilotRow({ schemaVersion: 'x' })])),
    ).rejects.toThrow('ExtractionRuns 2 行目: schema_version "x" が整数ではありません');
    await expect(
      readPilotRuns('sheet-1', readDeps([[...SHEET_HEADERS.ExtractionRuns], pilotRow({ tokensIn: 'x' })])),
    ).rejects.toThrow('ExtractionRuns 2 行目: tokens_in "x" が整数ではありません');
    await expect(
      readPilotRuns('sheet-1', readDeps([[...SHEET_HEADERS.ExtractionRuns], pilotRow({ tokensOut: '1.5' })])),
    ).rejects.toThrow('ExtractionRuns 2 行目: tokens_out "1.5" が整数ではありません');
    await expect(
      readPilotRuns('sheet-1', readDeps([[...SHEET_HEADERS.ExtractionRuns], pilotRow({ costEstimate: 'x' })])),
    ).rejects.toThrow('ExtractionRuns 2 行目: cost_estimate "x" が数値ではありません');
  });

  test('run_type / status が null セルの行は除外する', async () => {
    const values: (string | null)[][] = [
      [...SHEET_HEADERS.ExtractionRuns],
      [null, 'pilot', '1', 'doc-1', 'gemini', 'gemini-test', '', 'text_only', 'done'], // null runId の完了 pilot → 含む
      [null, null, '1', 'doc-1'], // run_type null → 除外
      ['r', 'pilot', '1', 'doc-1', 'gemini', 'gemini-test', '', 'text_only', null], // status null → 除外
    ];
    const runs = await readPilotRuns('sheet-1', readDeps(values));
    expect(runs).toHaveLength(1);
    expect(runs[0]).toMatchObject({ runId: '', provider: 'gemini' });
  });

  test('null セルの完了 pilot 行は空文字 / null 列として安全に読む', async () => {
    const nullRow: (string | null)[] = [
      null,
      'pilot',
      '1',
      null,
      null,
      null,
      null,
      null,
      'done',
      null,
      null,
      null,
      null,
      null,
    ];
    const runs = await readPilotRuns('sheet-1', readDeps([[...SHEET_HEADERS.ExtractionRuns], nullRow]));
    expect(runs[0]).toEqual({
      runId: '',
      runType: 'pilot',
      schemaVersion: 1,
      documentIds: [],
      provider: '',
      requestedModel: '',
      modelVersion: null,
      inputMode: '',
      status: 'done',
      startedAt: null,
      finishedAt: null,
      tokensIn: null,
      tokensOut: null,
      costEstimate: null,
    });
  });

  test('schema_version が null セルの完了 pilot 行はエラー', async () => {
    const nullSv: (string | null)[] = ['r', 'pilot', null, 'doc-1', 'gemini', 'gemini-test', '', 'text_only', 'done'];
    await expect(
      readPilotRuns('sheet-1', readDeps([[...SHEET_HEADERS.ExtractionRuns], nullSv])),
    ).rejects.toThrow('ExtractionRuns 2 行目: schema_version "" が整数ではありません');
  });

  test('run 0 件は空配列、ヘッダ行なしはエラー', async () => {
    expect(await readPilotRuns('sheet-1', readDeps([[...SHEET_HEADERS.ExtractionRuns]]))).toEqual([]);
    await expect(readPilotRuns('sheet-1', readDeps([]))).rejects.toThrow(
      'ExtractionRuns タブにヘッダ行がありません',
    );
  });
});
