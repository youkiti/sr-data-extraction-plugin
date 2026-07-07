import type { StudyDataRow } from '../../../../src/domain/annotation';
import type { NewResultsDataRow } from '../../../../src/features/extraction/aiAnnotationRows';
import {
  readResultsDataRows,
  readStudyDataSheet,
  upsertResultsDataRows,
  upsertStudyDataRows,
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

function makeStudyRow(overrides: Partial<StudyDataRow> = {}): StudyDataRow {
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

function makeResultsRow(overrides: Partial<NewResultsDataRow> = {}): NewResultsDataRow {
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
