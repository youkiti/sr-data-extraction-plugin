import type { ExtractionRun, RunWarning } from '../../../../src/domain/extractionRun';
import { SHEET_HEADERS } from '../../../../src/domain/sheetsSchema';
import {
  appendExtractionRun,
  ensureRunOptionalColumns,
  extractionRunToRow,
  MAX_WARNINGS_CELL_CHARS,
  pickLatestCompletedRunByStudy,
  readCompletedRunMetas,
  readMethodsRunFacts,
  readPilotRuns,
  readRunAuditInfos,
  readRunStudyCoverage,
  readRunSchemaVersions,
  type CompletedRunStudySummary,
} from '../../../../src/features/extraction/runRepository';

/** 旧ヘッダ（field_ids 列導入前。14 列）。ensureRunOptionalColumns / readRunRows の後方互換テスト用 */
const LEGACY_RUN_HEADER = SHEET_HEADERS.ExtractionRuns.slice(0, 14);

/** 旧ヘッダ（warnings 列導入前。15 列 = 14 列 + field_ids）。issue #106 の後方互換テスト用 */
const FIELD_IDS_RUN_HEADER = SHEET_HEADERS.ExtractionRuns.slice(0, 15);

/** arm completeness 警告のフィクスチャ（issue #106） */
function makeWarning(overrides: Partial<RunWarning> = {}): RunWarning {
  return {
    kind: 'arm_completeness',
    studyId: 'study-1',
    section: null,
    expectedArmKeys: ['arm:1', 'arm:2'],
    missingItems: [{ armKey: 'arm:2', fieldId: 'f-n' }],
    ...overrides,
  };
}

function makeRun(overrides: Partial<ExtractionRun> = {}): ExtractionRun {
  return {
    runId: 'run-1',
    runType: 'full',
    schemaVersion: 2,
    studyIds: ['doc-1', 'doc-2'],
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
    fieldIds: null,
    warnings: null,
    ...overrides,
  };
}

describe('extractionRunToRow', () => {
  test('SHEET_HEADERS.ExtractionRuns の列順に対応し、study_ids はカンマ区切り。fieldIds=null は空文字（全項目。issue #80）', () => {
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
      '', // fieldIds: null → 全項目 = 空文字
      '', // warnings: null → 警告なし = 空文字（issue #106）
    ]);
  });

  test('fieldIds が配列のときはカンマ区切りで 15 列目に出力する（issue #80）', () => {
    const row = extractionRunToRow(makeRun({ fieldIds: ['f-1', 'f-2'] }));
    expect(row[14]).toBe('f-1,f-2');
  });

  test('warnings が配列のときは JSON で 16 列目に出力する（issue #106）', () => {
    const warning = makeWarning();
    const row = extractionRunToRow(makeRun({ warnings: [warning] }));
    expect(row[15]).toBe(JSON.stringify([warning]));
  });

  test('warnings が直列化上限（MAX_WARNINGS_CELL_CHARS）を超えるときは missingItems を先頭 5 件へ切り詰め、打ち切りマーカーを付ける（issue #106 レビュー対応）', () => {
    // fieldId は実運用では UUID（36 字）。800 件で直列化 ≈ 48,000 字 > 40,000 字
    const bigWarning = makeWarning({
      missingItems: Array.from({ length: 800 }, (_, i) => ({
        armKey: 'arm:2',
        fieldId: `f-${String(i).padStart(34, '0')}`,
      })),
    });
    const smallWarning = makeWarning({ studyId: 'study-2' });
    const cell = extractionRunToRow(makeRun({ warnings: [bigWarning, smallWarning] }))[15] as string;
    expect(cell.length).toBeLessThanOrEqual(MAX_WARNINGS_CELL_CHARS);
    const parsed = JSON.parse(cell) as RunWarning[];
    expect(parsed).toHaveLength(2);
    expect(parsed[0]?.missingItems).toEqual(bigWarning.missingItems.slice(0, 5));
    expect(parsed[0]?.truncated).toBe(true);
    expect(parsed[0]?.missingItemsTotal).toBe(800);
    // 5 件以下の警告は切り詰め対象外（マーカーも付かない）
    expect(parsed[1]).toEqual(smallWarning);
  });

  test('missingItems の切り詰めでも上限を超える間は末尾の警告から削る（先頭側 = 先に処理した study を優先して残す）', () => {
    // 1 警告 ≈ 150 字 × 600 件 ≈ 90,000 字。missingItems は各 1 件のため件数の削減で収める
    const warnings = Array.from({ length: 600 }, (_, i) =>
      makeWarning({ studyId: `study-${i}` }),
    );
    const cell = extractionRunToRow(makeRun({ warnings }))[15] as string;
    expect(cell.length).toBeLessThanOrEqual(MAX_WARNINGS_CELL_CHARS);
    const parsed = JSON.parse(cell) as RunWarning[];
    expect(parsed.length).toBeGreaterThan(0);
    expect(parsed.length).toBeLessThan(600);
    expect(parsed[0]?.studyId).toBe('study-0');
  });

  test('1 件でも上限を超える極端な警告はそれ以上切り詰めずに返す（完了行の追記失敗時は extractionService 側の warnings なし再試行が最終安全弁）', () => {
    const huge = makeWarning({ expectedArmKeys: ['a'.repeat(45_000)] });
    const cell = extractionRunToRow(makeRun({ warnings: [huge] }))[15] as string;
    const parsed = JSON.parse(cell) as RunWarning[];
    expect(parsed).toHaveLength(1);
    expect(cell.length).toBeGreaterThan(MAX_WARNINGS_CELL_CHARS);
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
    expect(row.slice(6)).toEqual([null, 'text_only', 'done', null, null, null, null, null, '', '']);
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

describe('readRunStudyCoverage', () => {
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

  const runRow = (runId: string, studyIds: string, status: string): string[] => [
    runId,
    'pilot',
    '1',
    studyIds,
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

  test('完了行（done / partial_failure）の study_ids の和集合を extracted に返す', async () => {
    const values = [
      [...SHEET_HEADERS.ExtractionRuns],
      runRow('run-1', 'doc-1,doc-2', 'done'),
      runRow('run-2', 'doc-2,doc-3', 'partial_failure'),
    ];
    const coverage = await readRunStudyCoverage('sheet-1', readDeps(values));
    expect([...coverage.extracted].sort()).toEqual(['doc-1', 'doc-2', 'doc-3']);
    expect(coverage.interrupted.size).toBe(0);
  });

  test('running 行のみの run（2 行プロトコルの中断）は抽出済みに数えず interrupted に返す', async () => {
    const values = [
      [...SHEET_HEADERS.ExtractionRuns],
      runRow('run-1', 'doc-1,doc-2', 'running'),
    ];
    const coverage = await readRunStudyCoverage('sheet-1', readDeps(values));
    expect(coverage.extracted.size).toBe(0);
    expect([...coverage.interrupted].sort()).toEqual(['doc-1', 'doc-2']);
  });

  test('running 行 + 完了行が揃った run は完了扱い（interrupted に出ない）', async () => {
    const values = [
      [...SHEET_HEADERS.ExtractionRuns],
      runRow('run-1', 'doc-1,doc-2', 'running'),
      runRow('run-1', 'doc-1,doc-2', 'done'),
    ];
    const coverage = await readRunStudyCoverage('sheet-1', readDeps(values));
    expect([...coverage.extracted].sort()).toEqual(['doc-1', 'doc-2']);
    expect(coverage.interrupted.size).toBe(0);
  });

  test('中断 run の文献でも、別の完了 run で抽出済みなら interrupted から除く', async () => {
    const values = [
      [...SHEET_HEADERS.ExtractionRuns],
      runRow('run-1', 'doc-1,doc-2', 'running'),
      runRow('run-2', 'doc-1', 'done'),
    ];
    const coverage = await readRunStudyCoverage('sheet-1', readDeps(values));
    expect([...coverage.extracted]).toEqual(['doc-1']);
    expect([...coverage.interrupted]).toEqual(['doc-2']);
  });

  test('run 0 件は両方空集合、study_ids 欠落行（ラグ配列）は無視する', async () => {
    const empty = await readRunStudyCoverage(
      'sheet-1',
      readDeps([[...SHEET_HEADERS.ExtractionRuns]]),
    );
    expect(empty.extracted.size).toBe(0);
    expect(empty.interrupted.size).toBe(0);
    const ragged = await readRunStudyCoverage(
      'sheet-1',
      readDeps([[...SHEET_HEADERS.ExtractionRuns], ['run-1', 'pilot', '1']]),
    );
    expect(ragged.extracted.size).toBe(0);
    expect(ragged.interrupted.size).toBe(0);
  });

  test('run_id / study_ids が null セルの完了行も安全に読む', async () => {
    const values = [
      [...SHEET_HEADERS.ExtractionRuns],
      [null, 'pilot', '1', null, 'gemini', 'gemini-test', '', 'text_only', 'done'] as unknown as string[],
    ];
    const coverage = await readRunStudyCoverage('sheet-1', readDeps(values));
    expect(coverage.extracted.size).toBe(0);
    expect(coverage.interrupted.size).toBe(0);
  });

  test('ヘッダ行なしはエラー（readRunSchemaVersions と同じ前処理）', async () => {
    await expect(readRunStudyCoverage('sheet-1', readDeps([]))).rejects.toThrow(
      'ExtractionRuns タブにヘッダ行がありません',
    );
  });

  test('latestCompletedRunByStudy: study_id ごとの直近完了 run を field_ids 込みで返す（issue #80）', async () => {
    const row = (
      o: Partial<{ runId: string; studyIds: string; startedAt: string; fieldIds: string }> = {},
    ): string[] => [
      o.runId ?? 'run-1',
      'full',
      '1',
      o.studyIds ?? 'study-1',
      'gemini',
      'gemini-test',
      '',
      'text_only',
      'done',
      o.startedAt ?? 't1',
      't2',
      '',
      '',
      '',
      o.fieldIds ?? '',
    ];
    const values = [
      [...SHEET_HEADERS.ExtractionRuns],
      row({ runId: 'run-old', studyIds: 'study-1', startedAt: 't1', fieldIds: 'f-1,f-2' }),
      row({ runId: 'run-new', studyIds: 'study-1,study-2', startedAt: 't2' }), // fieldIds 空 = 全項目
    ];
    const coverage = await readRunStudyCoverage('sheet-1', readDeps(values));
    // study-1 は新しい run-new（全項目）が勝つ。study-2 は run-new のみ
    expect(coverage.latestCompletedRunByStudy.get('study-1')).toMatchObject({
      runId: 'run-new',
      fieldIds: null,
    });
    expect(coverage.latestCompletedRunByStudy.get('study-2')).toMatchObject({
      runId: 'run-new',
      fieldIds: null,
    });
    expect(coverage.latestCompletedRunByStudy.has('study-3')).toBe(false);
  });

  test('running 行のみ（中断）は latestCompletedRunByStudy に含めない', async () => {
    const values = [
      [...SHEET_HEADERS.ExtractionRuns],
      runRow('run-1', 'study-1', 'running'),
    ];
    const coverage = await readRunStudyCoverage('sheet-1', readDeps(values));
    expect(coverage.latestCompletedRunByStudy.size).toBe(0);
  });
});

describe('pickLatestCompletedRunByStudy（issue #80: S7 バッジ注記の素材）', () => {
  function summary(overrides: Partial<CompletedRunStudySummary> = {}): CompletedRunStudySummary {
    return {
      runId: 'run-1',
      studyIds: ['study-1'],
      schemaVersion: 1,
      startedAt: 't1',
      fieldIds: null,
      ...overrides,
    };
  }

  test('started_at 昇順で比較し、最新（最大）の run を選ぶ（両方向の比較を通す）', () => {
    const a = summary({ runId: 'a', startedAt: 't1' });
    const b = summary({ runId: 'b', startedAt: 't3' });
    const c = summary({ runId: 'c', startedAt: 't2' });
    // 挿入順をシャッフルして両方の比較分岐（前が新しい / 前が古い）を通す
    const result = pickLatestCompletedRunByStudy([b, a, c]);
    expect(result.get('study-1')?.runId).toBe('b');
  });

  test('started_at が null は最古として扱う', () => {
    const withNull = summary({ runId: 'null-run', startedAt: null });
    const withDate = summary({ runId: 'dated-run', startedAt: 't1' });
    const result = pickLatestCompletedRunByStudy([withDate, withNull]);
    expect(result.get('study-1')?.runId).toBe('dated-run');
  });

  test('started_at が同値・null 同士はシート行順（安定ソート）を保ち、後方が勝つ', () => {
    const first = summary({ runId: 'first', startedAt: null });
    const second = summary({ runId: 'second', startedAt: null });
    const result = pickLatestCompletedRunByStudy([first, second]);
    expect(result.get('study-1')?.runId).toBe('second');
  });

  test('study_id ごとに独立して解決する', () => {
    const runA = summary({ runId: 'run-a', studyIds: ['study-1'], startedAt: 't2' });
    const runB = summary({ runId: 'run-b', studyIds: ['study-2'], startedAt: 't1' });
    const result = pickLatestCompletedRunByStudy([runA, runB]);
    expect(result.get('study-1')?.runId).toBe('run-a');
    expect(result.get('study-2')?.runId).toBe('run-b');
  });

  test('summaries が空なら空 Map', () => {
    expect(pickLatestCompletedRunByStudy([]).size).toBe(0);
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
      studyIds: string;
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
      fieldIds: string;
    }> = {},
  ): string[] => [
    o.runId ?? 'run-1',
    o.runType ?? 'pilot',
    o.schemaVersion ?? '1',
    o.studyIds ?? 'doc-1,doc-2',
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
    o.fieldIds ?? '',
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
        studyIds: 'd1,d2',
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
      studyIds: ['d1', 'd2'],
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
      fieldIds: null, // field_ids 空セル = 全項目（issue #80）
      warnings: null, // warnings 空セル = 警告なし（issue #106）
    });
  });

  test('field_ids 列（15 列目）をカンマ分解する。空セルは null（issue #80）', async () => {
    const values = [
      [...SHEET_HEADERS.ExtractionRuns],
      pilotRow({ fieldIds: 'f-1,f-2' }),
    ];
    const runs = await readPilotRuns('sheet-1', readDeps(values));
    expect(runs[0]?.fieldIds).toEqual(['f-1', 'f-2']);
  });

  test('warnings 列（16 列目）を JSON パースする（issue #106）', async () => {
    const warning = makeWarning();
    const values = [
      [...SHEET_HEADERS.ExtractionRuns],
      [...pilotRow(), JSON.stringify([warning])],
    ];
    const runs = await readPilotRuns('sheet-1', readDeps(values));
    expect(runs[0]?.warnings).toEqual([warning]);
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
      studyIds: [],
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
      fieldIds: null, // 列自体が欠落（旧プロジェクト相当）= 全項目（issue #80）
      warnings: null, // 列自体が欠落（旧プロジェクト相当）= 警告なし（issue #106）
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

describe('readMethodsRunFacts', () => {
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

  const row = (
    o: Partial<{
      runId: string;
      runType: string;
      schemaVersion: string;
      studyIds: string;
      provider: string;
      requestedModel: string;
      modelVersion: string;
      inputMode: string;
      status: string;
    }> = {},
  ): string[] => [
    o.runId ?? 'run-1',
    o.runType ?? 'full',
    o.schemaVersion ?? '1',
    o.studyIds ?? 'study-1,study-2',
    o.provider ?? 'gemini',
    o.requestedModel ?? 'gemini-test',
    o.modelVersion ?? 'gemini-test-001',
    o.inputMode ?? 'text_only',
    o.status ?? 'done',
  ];

  test('完了行（done / partial_failure）のみ拾い、running 行は除外する', async () => {
    const values = [
      [...SHEET_HEADERS.ExtractionRuns],
      row({ runId: 'r1', status: 'done' }),
      row({ runId: 'r2', status: 'running' }),
      row({ runId: 'r3', status: 'partial_failure' }),
    ];
    const facts = await readMethodsRunFacts('sheet-1', readDeps(values));
    expect(facts).toHaveLength(2);
  });

  test('新しい順（シート追記順の逆）で返す', async () => {
    const values = [
      [...SHEET_HEADERS.ExtractionRuns],
      row({ runId: 'r1', modelVersion: 'model-1' }),
      row({ runId: 'r2', modelVersion: 'model-2' }),
    ];
    const facts = await readMethodsRunFacts('sheet-1', readDeps(values));
    expect(facts.map((f) => f.modelVersion)).toEqual(['model-2', 'model-1']);
  });

  test('runType / provider / modelVersion / studyIds をパースする', async () => {
    const values = [
      [...SHEET_HEADERS.ExtractionRuns],
      row({
        runType: 'pilot',
        provider: 'openrouter',
        modelVersion: 'gpt-test',
        studyIds: 'study-a,study-b',
      }),
    ];
    const facts = await readMethodsRunFacts('sheet-1', readDeps(values));
    expect(facts[0]).toEqual({
      runType: 'pilot',
      provider: 'openrouter',
      modelVersion: 'gpt-test',
      studyIds: ['study-a', 'study-b'],
    });
  });

  test('model_version 空セルは null、study_ids 空セルは空配列', async () => {
    const values = [
      [...SHEET_HEADERS.ExtractionRuns],
      row({ modelVersion: '', studyIds: '' }),
    ];
    const facts = await readMethodsRunFacts('sheet-1', readDeps(values));
    expect(facts[0]).toMatchObject({ modelVersion: null, studyIds: [] });
  });

  test('status が完了扱いの行で run_type / provider が null セルでも空文字列として安全に読む', async () => {
    const sparse: (string | null)[] = ['r1', null, '1', 'study-1', null, 'model', 'v1', 'text_only', 'done'];
    const values = [[...SHEET_HEADERS.ExtractionRuns], sparse];
    const facts = await readMethodsRunFacts('sheet-1', readDeps(values));
    expect(facts[0]).toMatchObject({ runType: '', provider: '' });
  });

  test('status セル自体が null（未完了扱い）の行は除外する', async () => {
    const sparse: (string | null)[] = ['r1', 'full', '1', 'study-1', 'gemini', 'model', 'v1', 'text_only', null];
    const values = [[...SHEET_HEADERS.ExtractionRuns], sparse];
    const facts = await readMethodsRunFacts('sheet-1', readDeps(values));
    expect(facts).toHaveLength(0);
  });

  test('run 0 件は空配列、ヘッダ行なしはエラー', async () => {
    expect(
      await readMethodsRunFacts('sheet-1', readDeps([[...SHEET_HEADERS.ExtractionRuns]])),
    ).toEqual([]);
    await expect(readMethodsRunFacts('sheet-1', readDeps([]))).rejects.toThrow(
      'ExtractionRuns タブにヘッダ行がありません',
    );
  });
});

describe('readRunRows の後方互換（field_ids / warnings 列。issue #80 / #106）', () => {
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

  test('旧 14 列ヘッダ + 14 列データ行を読める（field_ids / warnings は欠落として解決される）', async () => {
    const legacyRow = [
      'run-1',
      'pilot',
      '1',
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
    const metas = await readCompletedRunMetas('sheet-1', readDeps([[...LEGACY_RUN_HEADER], legacyRow]));
    expect(metas).toEqual([
      { runId: 'run-1', schemaVersion: 1, startedAt: 't1', studyIds: ['doc-1'], fieldIds: null, warnings: null },
    ]);
  });

  test('旧 15 列ヘッダ（field_ids まで。warnings 未導入）も読める（issue #106 の後方互換）', async () => {
    const row15 = [
      'run-1',
      'pilot',
      '1',
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
      'f-1',
    ];
    const metas = await readCompletedRunMetas('sheet-1', readDeps([[...FIELD_IDS_RUN_HEADER], row15]));
    expect(metas).toEqual([
      {
        runId: 'run-1',
        schemaVersion: 1,
        startedAt: 't1',
        studyIds: ['doc-1'],
        fieldIds: ['f-1'],
        warnings: null,
      },
    ]);
  });

  test('15 列目（field_ids）が存在するのに名前が不一致なら throw', async () => {
    const badHeader = [...SHEET_HEADERS.ExtractionRuns];
    badHeader[14] = 'wrong';
    await expect(readCompletedRunMetas('sheet-1', readDeps([badHeader]))).rejects.toThrow(
      'ExtractionRuns のヘッダ 15 列目が "field_ids" ではありません（実際: "wrong"）',
    );
  });

  test('16 列目（warnings）が存在するのに名前が不一致なら throw（issue #106）', async () => {
    const badHeader = [...SHEET_HEADERS.ExtractionRuns];
    badHeader[15] = 'wrong';
    await expect(readCompletedRunMetas('sheet-1', readDeps([badHeader]))).rejects.toThrow(
      'ExtractionRuns のヘッダ 16 列目が "warnings" ではありません（実際: "wrong"）',
    );
  });

  test('15 列目より後ろまで列があるのに field_ids セル自体が空（ラグ配列の穴）なら空文字扱いで不一致 throw', async () => {
    // 16 列目（余剰列）だけ埋めて 15 列目（index 14）を穴のまま残す、壊れたヘッダ行を模す
    const raggedHeader: string[] = [...LEGACY_RUN_HEADER];
    raggedHeader[15] = 'extra_column';
    await expect(readCompletedRunMetas('sheet-1', readDeps([raggedHeader]))).rejects.toThrow(
      'ExtractionRuns のヘッダ 15 列目が "field_ids" ではありません（実際: ""）',
    );
  });
});

describe('readCompletedRunMetas（issue #80: field 単位合成ビューの素材）', () => {
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

  const row = (
    o: Partial<{
      runId: string;
      schemaVersion: string;
      status: string;
      startedAt: string;
      fieldIds: string;
      warnings: string;
    }> = {},
  ): string[] => [
    o.runId ?? 'run-1',
    'pilot',
    o.schemaVersion ?? '1',
    'doc-1',
    'gemini',
    'gemini-test',
    '',
    'text_only',
    o.status ?? 'done',
    o.startedAt ?? 't1',
    't2',
    '',
    '',
    '',
    o.fieldIds ?? '',
    o.warnings ?? '',
  ];

  test('完了行（done / partial_failure）のみ拾い、running 行は除外する', async () => {
    const values = [
      [...SHEET_HEADERS.ExtractionRuns],
      row({ runId: 'r1', status: 'done' }),
      row({ runId: 'r2', status: 'running' }),
      row({ runId: 'r3', status: 'partial_failure' }),
    ];
    const metas = await readCompletedRunMetas('sheet-1', readDeps(values));
    expect(metas.map((m) => m.runId)).toEqual(['r1', 'r3']);
  });

  test('field_ids 列をカンマ分解する。空セルは null（全項目）', async () => {
    const values = [
      [...SHEET_HEADERS.ExtractionRuns],
      row({ runId: 'r1', fieldIds: 'f-1,f-2' }),
      row({ runId: 'r2', fieldIds: '' }),
    ];
    const metas = await readCompletedRunMetas('sheet-1', readDeps(values));
    expect(metas[0]).toMatchObject({ runId: 'r1', fieldIds: ['f-1', 'f-2'] });
    expect(metas[1]).toMatchObject({ runId: 'r2', fieldIds: null });
  });

  test('warnings 列を JSON パースする。空セルは null = 警告なし（issue #106）', async () => {
    const warning = makeWarning({ section: 'outcomes' });
    const values = [
      [...SHEET_HEADERS.ExtractionRuns],
      row({ runId: 'r1', warnings: JSON.stringify([warning]) }),
      row({ runId: 'r2', warnings: '' }),
    ];
    const metas = await readCompletedRunMetas('sheet-1', readDeps(values));
    expect(metas[0]).toMatchObject({ runId: 'r1', warnings: [warning] });
    expect(metas[1]).toMatchObject({ runId: 'r2', warnings: null });
  });

  test('warnings 列の不正値（壊れた JSON / 非配列 / 未知の形の要素）は null に落として読み出しは止めない（issue #106）', async () => {
    const values = [
      [...SHEET_HEADERS.ExtractionRuns],
      row({ runId: 'r1', warnings: '{broken json' }),
      row({ runId: 'r2', warnings: '{"kind":"arm_completeness"}' }), // 配列でない
      row({ runId: 'r3', warnings: '[{"kind":"unknown"},1,null]' }), // 既知の形の要素が 0 件
      row({
        runId: 'r4',
        // 既知の形の要素だけを残す（studyId 非文字列・section 非文字列・配列欠落は捨てる）
        warnings: JSON.stringify([
          makeWarning(),
          { kind: 'arm_completeness', studyId: 1, section: null, expectedArmKeys: [], missingItems: [] },
          { kind: 'arm_completeness', studyId: 's', section: 1, expectedArmKeys: [], missingItems: [] },
          { kind: 'arm_completeness', studyId: 's', section: null, expectedArmKeys: 'x', missingItems: [] },
          { kind: 'arm_completeness', studyId: 's', section: null, expectedArmKeys: [], missingItems: 'x' },
        ]),
      }),
    ];
    const metas = await readCompletedRunMetas('sheet-1', readDeps(values));
    expect(metas[0]?.warnings).toBeNull();
    expect(metas[1]?.warnings).toBeNull();
    expect(metas[2]?.warnings).toBeNull();
    expect(metas[3]?.warnings).toEqual([makeWarning()]);
  });

  test('シート行順（= 追記順）で返す（新しい順への並べ替えはしない）', async () => {
    const values = [
      [...SHEET_HEADERS.ExtractionRuns],
      row({ runId: 'r-old', startedAt: 't1' }),
      row({ runId: 'r-new', startedAt: 't2' }),
    ];
    const metas = await readCompletedRunMetas('sheet-1', readDeps(values));
    expect(metas.map((m) => m.runId)).toEqual(['r-old', 'r-new']);
  });

  test('schema_version 非整数はエラー', async () => {
    await expect(
      readCompletedRunMetas('sheet-1', readDeps([[...SHEET_HEADERS.ExtractionRuns], row({ schemaVersion: 'x' })])),
    ).rejects.toThrow('ExtractionRuns 2 行目: schema_version "x" が整数ではありません');
  });

  test('run 0 件は空配列', async () => {
    expect(
      await readCompletedRunMetas('sheet-1', readDeps([[...SHEET_HEADERS.ExtractionRuns]])),
    ).toEqual([]);
  });

  test('status 列自体が欠落したラグ配列（空文字扱い）は完了行に数えず除外する', async () => {
    const shortRow = ['run-1', 'pilot', '1', 'doc-1', 'gemini', 'gemini-test', '', 'text_only']; // status（9 列目）が無い
    const values = [[...SHEET_HEADERS.ExtractionRuns], shortRow];
    expect(await readCompletedRunMetas('sheet-1', readDeps(values))).toEqual([]);
  });

  test('run_id が null セルの完了行は空文字 run_id として安全に読む', async () => {
    const nullRunId: (string | null)[] = [
      null,
      'pilot',
      '1',
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
      '',
    ];
    const metas = await readCompletedRunMetas('sheet-1', readDeps([[...SHEET_HEADERS.ExtractionRuns], nullRunId]));
    expect(metas).toEqual([
      { runId: '', schemaVersion: 1, startedAt: 't1', studyIds: ['doc-1'], fieldIds: null, warnings: null },
    ]);
  });

  test('study_ids 列（4 列目）をカンマ分解する。空セルは空配列（AI 抽出結果なし study 検出の素材）', async () => {
    const values = [
      [...SHEET_HEADERS.ExtractionRuns],
      row({ runId: 'r1' }), // row ヘルパは 4 列目 = 'doc-1' 固定
    ];
    const metas = await readCompletedRunMetas('sheet-1', readDeps(values));
    expect(metas[0]).toMatchObject({ runId: 'r1', studyIds: ['doc-1'] });
  });
});

describe('ensureRunOptionalColumns（issue #80 / #106: 既存プロジェクトの後方互換移行）', () => {
  /** getBatchValues（GET .../values:batchGet）と updateRow（PUT .../values/ExtractionRuns!A1）を
   *  method で出し分けるモック fetch。headerRow が undefined ならヘッダ行なし（空シート）を模す */
  function optionalColumnsDeps(headerRow: string[] | undefined): {
    fetch: jest.Mock;
    getAccessToken: jest.Mock;
  } {
    const fetch = jest.fn(async (_url: string, init?: RequestInit) => {
      const method = init?.method ?? 'GET';
      if (method === 'GET') {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            valueRanges: headerRow === undefined ? [] : [{ values: [headerRow] }],
          }),
          text: async () => '',
        } as Response;
      }
      // updateRow（ヘッダ拡張の PUT）
      return { ok: true, status: 200, json: async () => ({}), text: async () => '' } as Response;
    });
    return { fetch, getAccessToken: jest.fn().mockResolvedValue('token') };
  }

  function findPut(d: { fetch: jest.Mock }): [string, RequestInit] | undefined {
    return d.fetch.mock.calls.find(([, init]) => (init as RequestInit)?.method === 'PUT') as
      | [string, RequestInit]
      | undefined;
  }

  test('旧 14 列ヘッダはフルヘッダ（16 列）へ拡張する（PUT）', async () => {
    const d = optionalColumnsDeps([...LEGACY_RUN_HEADER]);
    await ensureRunOptionalColumns('sid', d);
    const putCall = findPut(d);
    expect(putCall).toBeDefined();
    const [url, init] = putCall as [string, RequestInit];
    expect(decodeURIComponent(url)).toContain('/sid/values/ExtractionRuns!A1');
    const body = JSON.parse(init.body as string) as { values: string[][] };
    expect(body.values).toEqual([[...SHEET_HEADERS.ExtractionRuns]]);
  });

  test('旧 15 列ヘッダ（field_ids まで。issue #80 世代）もフルヘッダ（16 列）へ拡張する（issue #106）', async () => {
    const d = optionalColumnsDeps([...FIELD_IDS_RUN_HEADER]);
    await ensureRunOptionalColumns('sid', d);
    const putCall = findPut(d);
    expect(putCall).toBeDefined();
    const body = JSON.parse((putCall as [string, RequestInit])[1].body as string) as {
      values: string[][];
    };
    expect(body.values).toEqual([[...SHEET_HEADERS.ExtractionRuns]]);
  });

  test('既にフル列数（拡張済み）なら no-op（PUT を呼ばない）', async () => {
    const d = optionalColumnsDeps([...SHEET_HEADERS.ExtractionRuns]);
    await ensureRunOptionalColumns('sid', d);
    expect(findPut(d)).toBeUndefined();
  });

  test('先頭 14 列が SHEET_HEADERS.ExtractionRuns と不一致なら throw し、PUT は呼ばない（壊れたプロジェクトへの書き込み防止）', async () => {
    const badHeader = [...LEGACY_RUN_HEADER];
    badHeader[2] = 'wrong'; // schema_version のはずが不一致
    const d = optionalColumnsDeps(badHeader);
    await expect(ensureRunOptionalColumns('sid', d)).rejects.toThrow(
      'ExtractionRuns のヘッダ 3 列目が "schema_version" ではありません',
    );
    expect(findPut(d)).toBeUndefined();
  });

  test('既存の任意列（15 列目）が field_ids 以外なら throw し、PUT は呼ばない（未知の列を上書きしない）', async () => {
    const badHeader = [...LEGACY_RUN_HEADER, 'custom_column'];
    const d = optionalColumnsDeps(badHeader);
    await expect(ensureRunOptionalColumns('sid', d)).rejects.toThrow(
      'ExtractionRuns のヘッダ 15 列目が "field_ids" ではありません（実際: "custom_column"）',
    );
    expect(findPut(d)).toBeUndefined();
  });

  test('任意列範囲のラグ配列の穴（15 列目が空のまま 16 列目だけ存在）は空文字扱いで不一致 throw する', async () => {
    const raggedHeader: string[] = [...LEGACY_RUN_HEADER];
    raggedHeader[15] = 'warnings'; // 16 列目だけ埋めて 15 列目（index 14）を穴のまま残す
    const d = optionalColumnsDeps(raggedHeader);
    await expect(ensureRunOptionalColumns('sid', d)).rejects.toThrow(
      'ExtractionRuns のヘッダ 15 列目が "field_ids" ではありません（実際: ""）',
    );
    expect(findPut(d)).toBeUndefined();
  });

  test('ヘッダ行が無い（空シート）場合も列不一致として throw する', async () => {
    const d = optionalColumnsDeps(undefined);
    await expect(ensureRunOptionalColumns('sid', d)).rejects.toThrow(
      'ExtractionRuns のヘッダ 1 列目が "run_id" ではありません',
    );
  });
});
