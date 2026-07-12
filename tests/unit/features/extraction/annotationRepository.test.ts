import {
  AnnotationConflictError,
  readResultsDataRows,
  readStudyDataSheet,
  upsertResultsDataRows,
  upsertStudyDataRows,
  type ResultsDataUpsertRow,
  type StudyDataUpsertRow,
} from '../../../../src/features/extraction/annotationRepository';

const STUDY_HEADER = [
  'study_id',
  'annotator',
  'annotator_type',
  'schema_version',
  'run_id',
  'updated_at',
];

const RESULTS_HEADER = [
  'result_id',
  'study_id',
  'field_id',
  'annotator',
  'annotator_type',
  'schema_version',
  'entity_key',
  'run_id',
  'value',
  'not_reported',
  'updated_at',
];

interface MockDeps {
  fetch: jest.Mock;
  getAccessToken: jest.Mock;
}

/** 最初の GET（getSheetValues）に values を返し、以降の書き込みは記録だけする */
function makeDeps(values: string[][]): MockDeps {
  const fetch = jest.fn().mockImplementation(async (input: RequestInfo | URL, init?: RequestInit) => {
    const method = init?.method ?? 'GET';
    const json = method === 'GET' ? { values } : {};
    return {
      ok: true,
      status: 200,
      json: async () => json,
      text: async () => JSON.stringify(json),
    } as Response;
  });
  return { fetch, getAccessToken: jest.fn().mockResolvedValue('token') };
}

function callsOf(deps: MockDeps, method: string): [string, RequestInit][] {
  return deps.fetch.mock.calls
    .filter(([, init]) => ((init as RequestInit | undefined)?.method ?? 'GET') === method)
    .map(([url, init]) => [decodeURIComponent(String(url)), init as RequestInit]);
}

function makeStudyRow(overrides: Partial<StudyDataUpsertRow> = {}): StudyDataUpsertRow {
  return {
    studyId: 'doc-1',
    annotator: 'ai',
    annotatorType: 'ai',
    schemaVersion: 2,
    runId: 'run-1',
    updatedAt: 't2',
    values: { sample_size_total: '120' },
    ...overrides,
  };
}

function makeResultsRow(overrides: Partial<ResultsDataUpsertRow> = {}): ResultsDataUpsertRow {
  return {
    studyId: 'doc-1',
    fieldId: 'f-arm-n',
    annotator: 'ai',
    annotatorType: 'ai',
    schemaVersion: 2,
    entityKey: 'arm:1',
    runId: 'run-1',
    value: '60',
    notReported: false,
    updatedAt: 't2',
    ...overrides,
  };
}

describe('readStudyDataSheet', () => {
  test('固定列 + 動的値列をパースする（空セルは null、末尾欠落セルも空扱い）', async () => {
    const deps = makeDeps([
      [...STUDY_HEADER, 'sample_size_total', 'country'],
      ['doc-1', 'ai', 'ai', '2', 'run-1', 't1', '120', 'Japan'],
      // human 行: run_id 空、値セルはラグ配列で欠落
      ['doc-1', 'a@example.com', 'human_with_ai', '2', '', 't1'],
    ]);
    const sheet = await readStudyDataSheet('sid', deps);
    expect(sheet.fieldNames).toEqual(['sample_size_total', 'country']);
    expect(sheet.rows).toEqual([
      {
        studyId: 'doc-1',
        annotator: 'ai',
        annotatorType: 'ai',
        schemaVersion: 2,
        runId: 'run-1',
        updatedAt: 't1',
        values: { sample_size_total: '120', country: 'Japan' },
      },
      {
        studyId: 'doc-1',
        annotator: 'a@example.com',
        annotatorType: 'human_with_ai',
        schemaVersion: 2,
        runId: null,
        updatedAt: 't1',
        values: { sample_size_total: null, country: null },
      },
    ]);
  });

  test('ヘッダ行が無ければ throw', async () => {
    await expect(readStudyDataSheet('sid', makeDeps([]))).rejects.toThrow(
      'StudyData タブにヘッダ行がありません',
    );
  });

  test('固定列の並びが崩れていれば throw', async () => {
    const deps = makeDeps([['study_id', 'annotator_type', 'annotator']]);
    await expect(readStudyDataSheet('sid', deps)).rejects.toThrow('2 列目が "annotator"');
  });

  test('annotator_type が不正なら行番号付きで throw', async () => {
    const deps = makeDeps([STUDY_HEADER, ['doc-1', 'ai', 'robot', '2', '', 't1']]);
    await expect(readStudyDataSheet('sid', deps)).rejects.toThrow(
      'StudyData 2 行目: annotator_type "robot" が不正です',
    );
  });

  test('schema_version が整数でなければ throw', async () => {
    const deps = makeDeps([STUDY_HEADER, ['doc-1', 'ai', 'ai', 'x', '', 't1']]);
    await expect(readStudyDataSheet('sid', deps)).rejects.toThrow(
      'schema_version "x" が整数ではありません',
    );
  });
});

describe('upsertStudyDataRows', () => {
  test('既存行（study_id × annotator 一致）は行番号を特定して上書きする', async () => {
    const deps = makeDeps([
      [...STUDY_HEADER, 'sample_size_total'],
      ['doc-0', 'ai', 'ai', '1', 'run-0', 't0', '10'],
      ['doc-1', 'ai', 'ai', '1', 'run-0', 't0', '99'],
    ]);
    await upsertStudyDataRows('sid', [makeStudyRow()], deps);
    const puts = callsOf(deps, 'PUT');
    expect(puts).toHaveLength(1);
    expect(puts[0]?.[0]).toContain('StudyData!A3?valueInputOption=RAW'); // 3 行目 = doc-1 の行
    const body = JSON.parse(puts[0]?.[1].body as string);
    expect(body.values).toEqual([['doc-1', 'ai', 'ai', 2, 'run-1', 't2', '120']]);
    expect(callsOf(deps, 'POST')).toHaveLength(0);
  });

  test('既存行が無ければ追記し、複数の新規行は 1 回の :append にまとめる', async () => {
    const deps = makeDeps([[...STUDY_HEADER, 'sample_size_total']]);
    await upsertStudyDataRows(
      'sid',
      [makeStudyRow(), makeStudyRow({ studyId: 'doc-2', values: {} })],
      deps,
    );
    const posts = callsOf(deps, 'POST');
    expect(posts).toHaveLength(1);
    expect(posts[0]?.[0]).toContain('StudyData!A1:append');
    const body = JSON.parse(posts[0]?.[1].body as string);
    expect(body.values).toEqual([
      ['doc-1', 'ai', 'ai', 2, 'run-1', 't2', '120'],
      ['doc-2', 'ai', 'ai', 2, 'run-1', 't2', ''], // values に無い列は空セル
    ]);
  });

  test('maxRowsPerAppend 指定時は指定行数ごとに :append を分割する（行順は入力順を保持。issue #69）', async () => {
    const deps = makeDeps([[...STUDY_HEADER, 'sample_size_total']]);
    const rows = Array.from({ length: 5 }, (_, i) =>
      makeStudyRow({ studyId: `doc-${i}`, values: { sample_size_total: String(i) } }),
    );
    await upsertStudyDataRows('sid', rows, deps, { maxRowsPerAppend: 2 });
    const posts = callsOf(deps, 'POST');
    expect(posts).toHaveLength(3); // 2 行 + 2 行 + 1 行
    const bodies = posts.map(([, init]) => JSON.parse(init.body as string).values);
    expect(bodies).toEqual([
      [
        ['doc-0', 'ai', 'ai', 2, 'run-1', 't2', '0'],
        ['doc-1', 'ai', 'ai', 2, 'run-1', 't2', '1'],
      ],
      [
        ['doc-2', 'ai', 'ai', 2, 'run-1', 't2', '2'],
        ['doc-3', 'ai', 'ai', 2, 'run-1', 't2', '3'],
      ],
      [['doc-4', 'ai', 'ai', 2, 'run-1', 't2', '4']],
    ]);
  });

  test('ヘッダに無い field_name はヘッダ末尾へ追加してから書き込む（追加のみ）', async () => {
    const deps = makeDeps([[...STUDY_HEADER, 'sample_size_total']]);
    await upsertStudyDataRows(
      'sid',
      [makeStudyRow({ values: { country: 'Japan', sample_size_total: '120' } })],
      deps,
    );
    const puts = callsOf(deps, 'PUT');
    expect(puts).toHaveLength(1); // writeHeaderRow
    expect(puts[0]?.[0]).toContain('StudyData!A1?valueInputOption=RAW');
    const headerBody = JSON.parse(puts[0]?.[1].body as string);
    expect(headerBody.values).toEqual([[...STUDY_HEADER, 'sample_size_total', 'country']]);
    const posts = callsOf(deps, 'POST');
    const body = JSON.parse(posts[0]?.[1].body as string);
    expect(body.values).toEqual([['doc-1', 'ai', 'ai', 2, 'run-1', 't2', '120', 'Japan']]);
  });

  test('シート側に同一キーの重複行があれば throw（バリデーション違反）', async () => {
    const deps = makeDeps([
      STUDY_HEADER,
      ['doc-1', 'ai', 'ai', '1', '', 't0'],
      ['doc-1', 'ai', 'ai', '1', '', 't0'],
    ]);
    await expect(upsertStudyDataRows('sid', [makeStudyRow()], deps)).rejects.toThrow(
      'StudyData に同一キーの行が複数あります',
    );
  });

  test('入力側に同一キーの行が複数あれば throw（呼び出し契約違反）', async () => {
    const deps = makeDeps([STUDY_HEADER]);
    await expect(
      upsertStudyDataRows('sid', [makeStudyRow(), makeStudyRow()], deps),
    ).rejects.toThrow('upsertStudyDataRows の入力に同一キーの行が複数あります');
  });

  test('空配列は no-op（読み込みすら行わない）', async () => {
    const deps = makeDeps([STUDY_HEADER]);
    await upsertStudyDataRows('sid', [], deps);
    expect(deps.fetch).not.toHaveBeenCalled();
  });
});

describe('upsertStudyDataRows: 楽観ロック（issue #64）', () => {
  test('expectedUpdatedAt=null で行が既に存在すれば conflict（部分書き込みなし）', async () => {
    const deps = makeDeps([STUDY_HEADER, ['doc-1', 'ai', 'ai', '1', '', 't0']]);
    await expect(
      upsertStudyDataRows('sid', [makeStudyRow({ expectedUpdatedAt: null })], deps),
    ).rejects.toThrow(AnnotationConflictError);
    expect(callsOf(deps, 'PUT')).toHaveLength(0);
    expect(callsOf(deps, 'POST')).toHaveLength(0);
  });

  test('expectedUpdatedAt=文字列で行が無ければ conflict', async () => {
    const deps = makeDeps([STUDY_HEADER]);
    await expect(
      upsertStudyDataRows('sid', [makeStudyRow({ expectedUpdatedAt: 't0' })], deps),
    ).rejects.toThrow(AnnotationConflictError);
    expect(callsOf(deps, 'PUT')).toHaveLength(0);
    expect(callsOf(deps, 'POST')).toHaveLength(0);
  });

  test('updatedAt が期待値と不一致なら conflict', async () => {
    const deps = makeDeps([STUDY_HEADER, ['doc-1', 'ai', 'ai', '1', '', 't0']]);
    await expect(
      upsertStudyDataRows('sid', [makeStudyRow({ expectedUpdatedAt: 't-old' })], deps),
    ).rejects.toThrow(AnnotationConflictError);
  });

  test('updatedAt が期待値と一致すれば保存成功する', async () => {
    const deps = makeDeps([
      [...STUDY_HEADER, 'sample_size_total'],
      ['doc-1', 'ai', 'ai', '1', '', 't0', '10'],
    ]);
    await upsertStudyDataRows('sid', [makeStudyRow({ expectedUpdatedAt: 't0' })], deps);
    expect(callsOf(deps, 'PUT')).toHaveLength(1);
  });

  test('expectedUpdatedAt=undefined はチェックなし（従来挙動。ai 転記・consensus・キュー再送）', async () => {
    const deps = makeDeps([
      [...STUDY_HEADER, 'sample_size_total'],
      ['doc-1', 'ai', 'ai', '1', '', 't-anything', '10'],
    ]);
    await upsertStudyDataRows('sid', [makeStudyRow()], deps); // expectedUpdatedAt 省略
    expect(callsOf(deps, 'PUT')).toHaveLength(1);
  });

  test('複数行入力の 2 行目が競合すると PUT / POST が 1 件も飛ばない（ヘッダ追加を要する新規列があっても）', async () => {
    const deps = makeDeps([
      STUDY_HEADER, // sample_size_total 列はまだ無い（本来ならヘッダ追加が必要）
      ['doc-1', 'ai', 'ai', '1', '', 't0'],
      ['doc-2', 'ai', 'ai', '1', '', 't0'],
    ]);
    await expect(
      upsertStudyDataRows(
        'sid',
        [
          makeStudyRow({ studyId: 'doc-1', expectedUpdatedAt: 't0' }), // 一致
          makeStudyRow({ studyId: 'doc-2', expectedUpdatedAt: 't-old' }), // 不一致 → conflict
        ],
        deps,
      ),
    ).rejects.toThrow(AnnotationConflictError);
    expect(callsOf(deps, 'PUT')).toHaveLength(0);
    expect(callsOf(deps, 'POST')).toHaveLength(0);
  });

  test('エラーオブジェクトのフィールド内容（StudyData。entity_key / field_id は null）', async () => {
    const deps = makeDeps([STUDY_HEADER, ['doc-1', 'ai', 'ai', '1', '', 't0']]);
    let caught: unknown;
    try {
      await upsertStudyDataRows('sid', [makeStudyRow({ expectedUpdatedAt: 't-old' })], deps);
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(AnnotationConflictError);
    const conflict = caught as AnnotationConflictError;
    expect(conflict.tab).toBe('StudyData');
    expect(conflict.studyId).toBe('doc-1');
    expect(conflict.annotator).toBe('ai');
    expect(conflict.entityKey).toBeNull();
    expect(conflict.fieldId).toBeNull();
    expect(conflict.expectedUpdatedAt).toBe('t-old');
    expect(conflict.actualUpdatedAt).toBe('t0');
  });

  test('expectedUpdatedAt を渡してもシート行へは書き込まれない', async () => {
    const deps = makeDeps([[...STUDY_HEADER, 'sample_size_total']]);
    await upsertStudyDataRows('sid', [makeStudyRow({ expectedUpdatedAt: null })], deps);
    const posts = callsOf(deps, 'POST');
    const body = JSON.parse(posts[0]?.[1].body as string);
    expect(body.values).toEqual([['doc-1', 'ai', 'ai', 2, 'run-1', 't2', '120']]);
  });
});

describe('readResultsDataRows', () => {
  test('全列をパースする（not_reported は TRUE / true とも真）', async () => {
    const deps = makeDeps([
      RESULTS_HEADER,
      ['r-1', 'doc-1', 'f-arm-n', 'ai', 'ai', '2', 'arm:1', 'run-1', '60', 'TRUE', 't1'],
      ['r-2', 'doc-1', 'f-arm-n', 'a@example.com', 'human_with_ai', '2', 'arm:2', '', '', 'false', 't1'],
    ]);
    await expect(readResultsDataRows('sid', deps)).resolves.toEqual([
      {
        resultId: 'r-1',
        studyId: 'doc-1',
        fieldId: 'f-arm-n',
        annotator: 'ai',
        annotatorType: 'ai',
        schemaVersion: 2,
        entityKey: 'arm:1',
        runId: 'run-1',
        value: '60',
        notReported: true,
        updatedAt: 't1',
      },
      {
        resultId: 'r-2',
        studyId: 'doc-1',
        fieldId: 'f-arm-n',
        annotator: 'a@example.com',
        annotatorType: 'human_with_ai',
        schemaVersion: 2,
        entityKey: 'arm:2',
        runId: null,
        value: null,
        notReported: false,
        updatedAt: 't1',
      },
    ]);
  });

  test('ヘッダ行が無い / 列名が違う場合は throw', async () => {
    await expect(readResultsDataRows('sid', makeDeps([]))).rejects.toThrow(
      'ResultsData タブにヘッダ行がありません',
    );
    const bad = makeDeps([['result_id', 'field_id']]);
    await expect(readResultsDataRows('sid', bad)).rejects.toThrow('2 列目が "study_id"');
  });
});

describe('upsertResultsDataRows', () => {
  test('既存行は result_id を保持したまま上書きする', async () => {
    const deps = makeDeps([
      RESULTS_HEADER,
      ['r-9', 'doc-1', 'f-arm-n', 'ai', 'ai', '1', 'arm:1', 'run-0', '59', 'false', 't0'],
    ]);
    await upsertResultsDataRows('sid', [makeResultsRow()], deps, { newUuid: () => 'r-new' });
    const puts = callsOf(deps, 'PUT');
    expect(puts).toHaveLength(1);
    expect(puts[0]?.[0]).toContain('ResultsData!A2?valueInputOption=RAW');
    const body = JSON.parse(puts[0]?.[1].body as string);
    expect(body.values).toEqual([
      ['r-9', 'doc-1', 'f-arm-n', 'ai', 'ai', 2, 'arm:1', 'run-1', '60', false, 't2'],
    ]);
    expect(callsOf(deps, 'POST')).toHaveLength(0);
  });

  test('新規行は result_id を採番して 1 回の :append にまとめる', async () => {
    const uuids = ['r-a', 'r-b'];
    const deps = makeDeps([RESULTS_HEADER]);
    await upsertResultsDataRows(
      'sid',
      [makeResultsRow(), makeResultsRow({ entityKey: 'arm:2', value: null, notReported: true })],
      deps,
      { newUuid: () => uuids.shift() as string },
    );
    const posts = callsOf(deps, 'POST');
    expect(posts).toHaveLength(1);
    const body = JSON.parse(posts[0]?.[1].body as string);
    expect(body.values).toEqual([
      ['r-a', 'doc-1', 'f-arm-n', 'ai', 'ai', 2, 'arm:1', 'run-1', '60', false, 't2'],
      ['r-b', 'doc-1', 'f-arm-n', 'ai', 'ai', 2, 'arm:2', 'run-1', '', true, 't2'],
    ]);
  });

  test('maxRowsPerAppend 指定時は指定行数ごとに :append を分割する（result_id 採番順も入力順。issue #69）', async () => {
    const deps = makeDeps([RESULTS_HEADER]);
    const uuids = ['r-0', 'r-1', 'r-2', 'r-3', 'r-4'];
    const rows = Array.from({ length: 5 }, (_, i) => makeResultsRow({ entityKey: `arm:${i}` }));
    await upsertResultsDataRows('sid', rows, deps, {
      newUuid: () => uuids.shift() as string,
      maxRowsPerAppend: 2,
    });
    const posts = callsOf(deps, 'POST');
    expect(posts).toHaveLength(3); // 2 行 + 2 行 + 1 行
    const bodies = posts.map(([, init]) => JSON.parse(init.body as string).values as unknown[][]);
    // result_id（0 列目）・entity_key（6 列目）とも入力順どおりに分割されている
    expect(bodies.map((rows) => rows.map((r) => [r[0], r[6]]))).toEqual([
      [
        ['r-0', 'arm:0'],
        ['r-1', 'arm:1'],
      ],
      [
        ['r-2', 'arm:2'],
        ['r-3', 'arm:3'],
      ],
      [['r-4', 'arm:4']],
    ]);
  });

  test('maxRowsPerAppend 省略時は既定 500 行ごとに分割する（issue #69）', async () => {
    const deps = makeDeps([RESULTS_HEADER]);
    const rows = Array.from({ length: 1250 }, (_, i) => makeResultsRow({ entityKey: `arm:${i}` }));
    await upsertResultsDataRows('sid', rows, deps);
    const posts = callsOf(deps, 'POST');
    const counts = posts.map(([, init]) => (JSON.parse(init.body as string).values as unknown[]).length);
    expect(counts).toEqual([500, 500, 250]);
  });

  test('40,000 行相当の一括抽出でも 1 回の :append が既定上限を超えない（issue #69 の受け入れ条件）', async () => {
    const deps = makeDeps([RESULTS_HEADER]);
    const rows = Array.from({ length: 40000 }, (_, i) => makeResultsRow({ entityKey: `arm:${i}` }));
    await upsertResultsDataRows('sid', rows, deps);
    const posts = callsOf(deps, 'POST');
    expect(posts).toHaveLength(80); // 40,000 / 500
    for (const [, init] of posts) {
      const values = JSON.parse(init.body as string).values as unknown[];
      expect(values.length).toBeLessThanOrEqual(500);
    }
  }, 15000);

  test('maxRowsPerAppend の丸め: 0 以下は 1 行ずつ、小数は floor する', async () => {
    const rows = Array.from({ length: 3 }, (_, i) => makeResultsRow({ entityKey: `arm:${i}` }));

    const zeroDeps = makeDeps([RESULTS_HEADER]);
    await upsertResultsDataRows('sid', rows, zeroDeps, { maxRowsPerAppend: 0 });
    expect(callsOf(zeroDeps, 'POST')).toHaveLength(3); // 1 行ずつ

    const floatDeps = makeDeps([RESULTS_HEADER]);
    await upsertResultsDataRows('sid', rows, floatDeps, { maxRowsPerAppend: 2.9 });
    const posts = callsOf(floatDeps, 'POST');
    const counts = posts.map(([, init]) => (JSON.parse(init.body as string).values as unknown[]).length);
    expect(counts).toEqual([2, 1]); // floor(2.9) = 2 行ずつ
  });

  test('helpers 省略時は既定の UUID 発番を使う', async () => {
    const deps = makeDeps([RESULTS_HEADER]);
    await upsertResultsDataRows('sid', [makeResultsRow()], deps);
    const posts = callsOf(deps, 'POST');
    const body = JSON.parse(posts[0]?.[1].body as string);
    // UUID v4 形式で採番されている
    expect(body.values[0][0]).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-/);
  });

  test('シート側の重複キーは throw、入力側の重複キーも throw', async () => {
    const dup = makeDeps([
      RESULTS_HEADER,
      ['r-1', 'doc-1', 'f-arm-n', 'ai', 'ai', '1', 'arm:1', '', '1', 'false', 't0'],
      ['r-2', 'doc-1', 'f-arm-n', 'ai', 'ai', '1', 'arm:1', '', '2', 'false', 't0'],
    ]);
    await expect(upsertResultsDataRows('sid', [makeResultsRow()], dup)).rejects.toThrow(
      'ResultsData に同一キーの行が複数あります',
    );
    const deps = makeDeps([RESULTS_HEADER]);
    await expect(
      upsertResultsDataRows('sid', [makeResultsRow(), makeResultsRow()], deps),
    ).rejects.toThrow('upsertResultsDataRows の入力に同一キーの行が複数あります');
  });

  test('空配列は no-op（読み込みすら行わない）', async () => {
    const deps = makeDeps([RESULTS_HEADER]);
    await upsertResultsDataRows('sid', [], deps);
    expect(deps.fetch).not.toHaveBeenCalled();
  });
});

describe('upsertResultsDataRows: 楽観ロック（issue #64）', () => {
  const EXISTING_ROW = ['r-9', 'doc-1', 'f-arm-n', 'ai', 'ai', '1', 'arm:1', '', '59', 'false', 't0'];

  test('expectedUpdatedAt=null で行が既に存在すれば conflict（部分書き込みなし）', async () => {
    const deps = makeDeps([RESULTS_HEADER, EXISTING_ROW]);
    await expect(
      upsertResultsDataRows('sid', [makeResultsRow({ expectedUpdatedAt: null })], deps),
    ).rejects.toThrow(AnnotationConflictError);
    expect(callsOf(deps, 'PUT')).toHaveLength(0);
    expect(callsOf(deps, 'POST')).toHaveLength(0);
  });

  test('expectedUpdatedAt=文字列で行が無ければ conflict', async () => {
    const deps = makeDeps([RESULTS_HEADER]);
    await expect(
      upsertResultsDataRows('sid', [makeResultsRow({ expectedUpdatedAt: 't0' })], deps),
    ).rejects.toThrow(AnnotationConflictError);
    expect(callsOf(deps, 'PUT')).toHaveLength(0);
    expect(callsOf(deps, 'POST')).toHaveLength(0);
  });

  test('updatedAt が期待値と不一致なら conflict', async () => {
    const deps = makeDeps([RESULTS_HEADER, EXISTING_ROW]);
    await expect(
      upsertResultsDataRows('sid', [makeResultsRow({ expectedUpdatedAt: 't-old' })], deps),
    ).rejects.toThrow(AnnotationConflictError);
  });

  test('updatedAt が期待値と一致すれば保存成功する（result_id は保持）', async () => {
    const deps = makeDeps([RESULTS_HEADER, EXISTING_ROW]);
    await upsertResultsDataRows('sid', [makeResultsRow({ expectedUpdatedAt: 't0' })], deps, {
      newUuid: () => 'r-new',
    });
    const puts = callsOf(deps, 'PUT');
    expect(puts).toHaveLength(1);
    const body = JSON.parse(puts[0]?.[1].body as string);
    expect(body.values[0][0]).toBe('r-9'); // result_id は既存を保持（新規採番は使わない）
  });

  test('expectedUpdatedAt=undefined はチェックなし（従来挙動。ai 転記・consensus・キュー再送）', async () => {
    const deps = makeDeps([
      RESULTS_HEADER,
      ['r-9', 'doc-1', 'f-arm-n', 'ai', 'ai', '1', 'arm:1', '', '59', 'false', 't-anything'],
    ]);
    await upsertResultsDataRows('sid', [makeResultsRow()], deps); // expectedUpdatedAt 省略
    expect(callsOf(deps, 'PUT')).toHaveLength(1);
  });

  test('複数行入力の 2 行目が競合すると PUT / POST が 1 件も飛ばない（部分書き込みなし）', async () => {
    const deps = makeDeps([RESULTS_HEADER, EXISTING_ROW]);
    await expect(
      upsertResultsDataRows(
        'sid',
        [
          makeResultsRow({ entityKey: 'arm:1', expectedUpdatedAt: 't0' }), // 一致
          makeResultsRow({ entityKey: 'arm:2', expectedUpdatedAt: 't-old' }), // 行なしなのに文字列期待 → conflict
        ],
        deps,
      ),
    ).rejects.toThrow(AnnotationConflictError);
    expect(callsOf(deps, 'PUT')).toHaveLength(0);
    expect(callsOf(deps, 'POST')).toHaveLength(0);
  });

  test('エラーオブジェクトのフィールド内容（ResultsData。entity_key / field_id を持つ）', async () => {
    const deps = makeDeps([RESULTS_HEADER]);
    let caught: unknown;
    try {
      await upsertResultsDataRows('sid', [makeResultsRow({ expectedUpdatedAt: 't-old' })], deps);
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(AnnotationConflictError);
    const conflict = caught as AnnotationConflictError;
    expect(conflict.tab).toBe('ResultsData');
    expect(conflict.studyId).toBe('doc-1');
    expect(conflict.annotator).toBe('ai');
    expect(conflict.entityKey).toBe('arm:1');
    expect(conflict.fieldId).toBe('f-arm-n');
    expect(conflict.expectedUpdatedAt).toBe('t-old');
    expect(conflict.actualUpdatedAt).toBeNull();
  });

  test('expectedUpdatedAt を渡してもシート行へは書き込まれない', async () => {
    const deps = makeDeps([RESULTS_HEADER]);
    await upsertResultsDataRows('sid', [makeResultsRow({ expectedUpdatedAt: null })], deps, {
      newUuid: () => 'r-new',
    });
    const posts = callsOf(deps, 'POST');
    const body = JSON.parse(posts[0]?.[1].body as string);
    expect(body.values).toEqual([
      ['r-new', 'doc-1', 'f-arm-n', 'ai', 'ai', 2, 'arm:1', 'run-1', '60', false, 't2'],
    ]);
  });
});
