import {
  AnnotationConflictError,
  ensureStudyDataColumns,
  readResultsDataRows,
  readStudyDataSheet,
  upsertResultsDataRows,
  upsertStudyDataRows,
  type ResultsDataUpsertRow,
  type StudyDataUpsertRow,
} from '../../../../src/features/extraction/annotationRepository';
import {
  configureApiErrorLog,
  flushApiErrorLogQueue,
} from '../../../../src/lib/diagnostics/apiErrorLog';
import { GoogleApiError } from '../../../../src/lib/google/types';
import { installChromeMock } from '../../../setup/chrome-mock';

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

/** 新規行の追記（values:append）呼び出しのみ。既存行更新の batchUpdate も POST のため URL で分ける */
function appendCallsOf(deps: MockDeps): [string, RequestInit][] {
  return callsOf(deps, 'POST').filter(([url]) => url.includes(':append'));
}

/** 既存行更新（values:batchUpdate。issue #185）呼び出しのみ */
function batchUpdateCallsOf(deps: MockDeps): [string, RequestInit][] {
  return callsOf(deps, 'POST').filter(([url]) => url.includes('values:batchUpdate'));
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

  test('重複を畳んで winner 行だけを返し、残った行の順序はシート行順を保つ', async () => {
    const deps = makeDeps([
      [...STUDY_HEADER, 'sample_size_total'],
      ['doc-0', 'ai', 'ai', '1', '', 't1', '1'],
      ['doc-1', 'ai', 'ai', '1', '', 't0', '2'], // 敗者
      ['doc-1', 'ai', 'ai', '1', '', 't1', '3'], // winner
      ['doc-2', 'ai', 'ai', '1', '', 't1', '4'],
    ]);
    const sheet = await readStudyDataSheet('sid', deps);
    expect(sheet.rows.map((r) => [r.studyId, r.updatedAt, r.values.sample_size_total])).toEqual([
      ['doc-0', 't1', '1'],
      ['doc-1', 't1', '3'], // winner のみ（敗者の t0 行は現れない）
      ['doc-2', 't1', '4'],
    ]);
  });
});

describe('upsertStudyDataRows', () => {
  test('既存行（study_id × annotator 一致）は行番号を特定して batchUpdate で上書きする（issue #185）', async () => {
    const deps = makeDeps([
      [...STUDY_HEADER, 'sample_size_total'],
      ['doc-0', 'ai', 'ai', '1', 'run-0', 't0', '10'],
      ['doc-1', 'ai', 'ai', '1', 'run-0', 't0', '99'],
    ]);
    await upsertStudyDataRows('sid', [makeStudyRow()], deps);
    const updates = batchUpdateCallsOf(deps);
    expect(updates).toHaveLength(1);
    const body = JSON.parse(updates[0]?.[1].body as string);
    expect(body.data).toEqual([
      { range: 'StudyData!A3', values: [['doc-1', 'ai', 'ai', 2, 'run-1', 't2', '120']] }, // 3 行目 = doc-1 の行
    ]);
    expect(callsOf(deps, 'PUT')).toHaveLength(0); // per-row PUT は使わない
    expect(appendCallsOf(deps)).toHaveLength(0);
  });

  test('既存行が無ければ追記し、複数の新規行は 1 回の :append にまとめる', async () => {
    const deps = makeDeps([[...STUDY_HEADER, 'sample_size_total']]);
    await upsertStudyDataRows(
      'sid',
      [makeStudyRow(), makeStudyRow({ studyId: 'doc-2', values: {} })],
      deps,
    );
    const posts = appendCallsOf(deps);
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
    const posts = appendCallsOf(deps);
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
    const posts = appendCallsOf(deps);
    const body = JSON.parse(posts[0]?.[1].body as string);
    expect(body.values).toEqual([['doc-1', 'ai', 'ai', 2, 'run-1', 't2', '120', 'Japan']]);
  });

  test('シート側に同一キーの重複行（3 行）があれば updated_at 最新の行（winner）だけを batchUpdate し、敗者行には書き込まない', async () => {
    const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
    const deps = makeDeps([
      STUDY_HEADER,
      ['doc-1', 'ai', 'ai', '1', '', 't1'], // 2 行目: 中間の updated_at（暫定 winner）
      ['doc-1', 'ai', 'ai', '1', '', 't0'], // 3 行目: 2 行目より古い → winner は変わらない
      ['doc-1', 'ai', 'ai', '1', '', 't9'], // 4 行目: 最も新しい → winner
    ]);
    await upsertStudyDataRows('sid', [makeStudyRow()], deps); // makeStudyRow の updatedAt は 't2'（書き込む新しい値）
    const updates = batchUpdateCallsOf(deps);
    expect(updates).toHaveLength(1);
    const body = JSON.parse(updates[0]?.[1].body as string);
    expect(body.data).toEqual([
      { range: 'StudyData!A4', values: [['doc-1', 'ai', 'ai', 2, 'run-1', 't2', '120']] }, // winner の 4 行目のみ更新
    ]);
    expect(appendCallsOf(deps)).toHaveLength(0);
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('StudyData'));
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('study_id=doc-1, annotator=ai'));
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('2, 3'));
    warnSpy.mockRestore();
  });

  test('シート側の重複で updated_at が同着なら、シート上でより下の行が winner になる', async () => {
    const deps = makeDeps([
      STUDY_HEADER,
      ['doc-1', 'ai', 'ai', '1', '', 't0'], // 2 行目: 同着だが上の行 → 敗者
      ['doc-1', 'ai', 'ai', '1', '', 't0'], // 3 行目: 同着で下の行 → winner
    ]);
    await upsertStudyDataRows('sid', [makeStudyRow()], deps);
    const updates = batchUpdateCallsOf(deps);
    expect(updates).toHaveLength(1);
    const body = JSON.parse(updates[0]?.[1].body as string);
    expect(body.data[0].range).toBe('StudyData!A3'); // 3 行目（下の行）が winner
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
    expect(batchUpdateCallsOf(deps)).toHaveLength(1);
  });

  test('expectedUpdatedAt=undefined はチェックなし（従来挙動。ai 転記・consensus・キュー再送）', async () => {
    const deps = makeDeps([
      [...STUDY_HEADER, 'sample_size_total'],
      ['doc-1', 'ai', 'ai', '1', '', 't-anything', '10'],
    ]);
    await upsertStudyDataRows('sid', [makeStudyRow()], deps); // expectedUpdatedAt 省略
    expect(batchUpdateCallsOf(deps)).toHaveLength(1);
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
    const posts = appendCallsOf(deps);
    const body = JSON.parse(posts[0]?.[1].body as string);
    expect(body.values).toEqual([['doc-1', 'ai', 'ai', 2, 'run-1', 't2', '120']]);
  });
});

describe('ensureStudyDataColumns', () => {
  /** getBatchValues（GET .../values:batchGet）と writeHeaderRow（PUT .../values/StudyData!A1）を
   *  method で出し分けるモック fetch。headerRow が undefined ならヘッダ行なし（空シート）を模す。
   *  evidenceRepository.test.ts の ensureEvidenceBboxColumns テストと同じ出し分け方式 */
  function columnsDeps(headerRow: string[] | undefined): MockDeps {
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
      return { ok: true, status: 200, json: async () => ({}), text: async () => '' } as Response;
    });
    return { fetch, getAccessToken: jest.fn().mockResolvedValue('token') };
  }

  function putCallOf(deps: MockDeps): [string, RequestInit] | undefined {
    return deps.fetch.mock.calls.find(
      ([, init]) => (init as RequestInit | undefined)?.method === 'PUT',
    ) as [string, RequestInit] | undefined;
  }

  test('空配列は no-op（読み込みすら行わない）', async () => {
    const deps = columnsDeps([...STUDY_HEADER]);
    await ensureStudyDataColumns('sid', [], deps);
    expect(deps.fetch).not.toHaveBeenCalled();
  });

  test('ヘッダ行だけを batchGet で読む（StudyData!1:1 のみ要求。getSheetValues の全行 GET は使わない）', async () => {
    const deps = columnsDeps([...STUDY_HEADER, 'sample_size_total']);
    await ensureStudyDataColumns('sid', ['country'], deps);
    const getCall = deps.fetch.mock.calls.find(
      ([, init]) => ((init as RequestInit | undefined)?.method ?? 'GET') === 'GET',
    );
    expect(getCall).toBeDefined();
    const [url] = getCall as [string, RequestInit];
    expect(decodeURIComponent(String(url))).toContain('values:batchGet');
    expect(decodeURIComponent(String(url))).toContain('ranges=StudyData!1:1');
  });

  test('不足列が無ければ書き込み API を呼ばない', async () => {
    const deps = columnsDeps([...STUDY_HEADER, 'sample_size_total', 'country']);
    await ensureStudyDataColumns('sid', ['country', 'sample_size_total'], deps);
    expect(putCallOf(deps)).toBeUndefined();
  });

  test('不足分だけを末尾へ追加し、既存の並び順を保つ', async () => {
    const deps = columnsDeps([...STUDY_HEADER, 'sample_size_total', 'country']);
    await ensureStudyDataColumns('sid', ['country', 'design', 'sample_size_total'], deps);
    const putCall = putCallOf(deps);
    expect(putCall).toBeDefined();
    const [url, init] = putCall as [string, RequestInit];
    expect(decodeURIComponent(url)).toContain('StudyData!A1');
    const body = JSON.parse(init.body as string) as { values: string[][] };
    expect(body.values).toEqual([[...STUDY_HEADER, 'sample_size_total', 'country', 'design']]);
  });

  test('固定ヘッダの並びが崩れていれば throw し、PUT は呼ばない', async () => {
    const deps = columnsDeps(['study_id', 'annotator_type', 'annotator']);
    await expect(ensureStudyDataColumns('sid', ['country'], deps)).rejects.toThrow(
      'StudyData のヘッダ 2 列目が "annotator" ではありません',
    );
    expect(putCallOf(deps)).toBeUndefined();
  });

  test('ヘッダ行が無ければ throw', async () => {
    const deps = columnsDeps(undefined);
    await expect(ensureStudyDataColumns('sid', ['country'], deps)).rejects.toThrow(
      'StudyData タブにヘッダ行がありません',
    );
  });

  test('固定列と衝突する field_name は throw（buildStudyDataHeader の検証。既存列を上書きしない）', async () => {
    const deps = columnsDeps([...STUDY_HEADER]);
    await expect(ensureStudyDataColumns('sid', ['annotator'], deps)).rejects.toThrow(
      'StudyData の列名が重複しています: "annotator"',
    );
    expect(putCallOf(deps)).toBeUndefined();
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

  test('重複を畳んで winner 行（result_id も winner のもの）だけを返し、残った行の順序はシート行順を保つ', async () => {
    const deps = makeDeps([
      RESULTS_HEADER,
      ['r-1', 'doc-1', 'f-arm-n', 'ai', 'ai', '1', 'arm:1', '', '1', 'false', 't0'], // 敗者
      ['r-2', 'doc-1', 'f-arm-n', 'ai', 'ai', '1', 'arm:1', '', '2', 'false', 't1'], // winner
      ['r-3', 'doc-1', 'f-arm-n', 'ai', 'ai', '1', 'arm:2', '', '3', 'false', 't1'],
    ]);
    const rows = await readResultsDataRows('sid', deps);
    expect(rows.map((r) => [r.resultId, r.entityKey, r.value])).toEqual([
      ['r-2', 'arm:1', '2'], // winner の result_id・値を保持
      ['r-3', 'arm:2', '3'],
    ]);
  });
});

describe('upsertResultsDataRows', () => {
  test('既存行は result_id を保持したまま batchUpdate で上書きする（issue #185）', async () => {
    const deps = makeDeps([
      RESULTS_HEADER,
      ['r-9', 'doc-1', 'f-arm-n', 'ai', 'ai', '1', 'arm:1', 'run-0', '59', 'false', 't0'],
    ]);
    await upsertResultsDataRows('sid', [makeResultsRow()], deps, { newUuid: () => 'r-new' });
    const updates = batchUpdateCallsOf(deps);
    expect(updates).toHaveLength(1);
    const body = JSON.parse(updates[0]?.[1].body as string);
    expect(body.data).toEqual([
      {
        range: 'ResultsData!A2',
        values: [['r-9', 'doc-1', 'f-arm-n', 'ai', 'ai', 2, 'arm:1', 'run-1', '60', false, 't2']],
      },
    ]);
    expect(callsOf(deps, 'PUT')).toHaveLength(0); // per-row PUT は使わない
    expect(appendCallsOf(deps)).toHaveLength(0);
  });

  test('既存行更新も maxRowsPerAppend 行ごとの batchUpdate に分割し、追記より先に発行する（issue #185）', async () => {
    // 既存 5 行（arm:0〜arm:4）+ 新規 1 行（arm:5）を maxRowsPerAppend=2 で upsert する
    const existing = Array.from({ length: 5 }, (_, i) => [
      `r-${i}`, 'doc-1', 'f-arm-n', 'ai', 'ai', '1', `arm:${i}`, 'run-0', '0', 'false', 't0',
    ]);
    const deps = makeDeps([RESULTS_HEADER, ...existing]);
    const rows = Array.from({ length: 6 }, (_, i) => makeResultsRow({ entityKey: `arm:${i}` }));
    await upsertResultsDataRows('sid', rows, deps, {
      newUuid: () => 'r-new',
      maxRowsPerAppend: 2,
    });
    const updates = batchUpdateCallsOf(deps);
    expect(updates).toHaveLength(3); // 2 行 + 2 行 + 1 行
    const ranges = updates.map(([, init]) =>
      (JSON.parse(init.body as string).data as { range: string }[]).map((d) => d.range),
    );
    expect(ranges).toEqual([
      ['ResultsData!A2', 'ResultsData!A3'],
      ['ResultsData!A4', 'ResultsData!A5'],
      ['ResultsData!A6'],
    ]);
    // 新規行（arm:5）は追記され、更新（batchUpdate）の後に発行される
    const posts = callsOf(deps, 'POST');
    expect(posts[posts.length - 1]?.[0]).toContain(':append');
    const appendBody = JSON.parse(posts[posts.length - 1]?.[1].body as string);
    expect(appendBody.values).toEqual([
      ['r-new', 'doc-1', 'f-arm-n', 'ai', 'ai', 2, 'arm:5', 'run-1', '60', false, 't2'],
    ]);
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
    const posts = appendCallsOf(deps);
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
    const posts = appendCallsOf(deps);
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
    const posts = appendCallsOf(deps);
    const counts = posts.map(([, init]) => (JSON.parse(init.body as string).values as unknown[]).length);
    expect(counts).toEqual([500, 500, 250]);
  });

  test('40,000 行相当の一括抽出でも 1 回の :append が既定上限を超えない（issue #69 の受け入れ条件）', async () => {
    const deps = makeDeps([RESULTS_HEADER]);
    const rows = Array.from({ length: 40000 }, (_, i) => makeResultsRow({ entityKey: `arm:${i}` }));
    await upsertResultsDataRows('sid', rows, deps);
    const posts = appendCallsOf(deps);
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
    expect(appendCallsOf(zeroDeps)).toHaveLength(3); // 1 行ずつ

    const floatDeps = makeDeps([RESULTS_HEADER]);
    await upsertResultsDataRows('sid', rows, floatDeps, { maxRowsPerAppend: 2.9 });
    const posts = appendCallsOf(floatDeps);
    const counts = posts.map(([, init]) => (JSON.parse(init.body as string).values as unknown[]).length);
    expect(counts).toEqual([2, 1]); // floor(2.9) = 2 行ずつ
  });

  test('helpers 省略時は既定の UUID 発番を使う', async () => {
    const deps = makeDeps([RESULTS_HEADER]);
    await upsertResultsDataRows('sid', [makeResultsRow()], deps);
    const posts = appendCallsOf(deps);
    const body = JSON.parse(posts[0]?.[1].body as string);
    // UUID v4 形式で採番されている
    expect(body.values[0][0]).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-/);
  });

  test('シート側に同一キーの重複行があれば updated_at 最新の行（winner）だけを result_id を保持して batchUpdate する', async () => {
    const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
    const dup = makeDeps([
      RESULTS_HEADER,
      ['r-1', 'doc-1', 'f-arm-n', 'ai', 'ai', '1', 'arm:1', '', '1', 'false', 't0'], // 敗者
      ['r-2', 'doc-1', 'f-arm-n', 'ai', 'ai', '1', 'arm:1', '', '2', 'false', 't1'], // winner
    ]);
    await upsertResultsDataRows('sid', [makeResultsRow()], dup, { newUuid: () => 'r-new' });
    const updates = batchUpdateCallsOf(dup);
    expect(updates).toHaveLength(1);
    const body = JSON.parse(updates[0]?.[1].body as string);
    expect(body.data).toEqual([
      {
        range: 'ResultsData!A3', // winner（r-2）の 3 行目のみ更新
        values: [['r-2', 'doc-1', 'f-arm-n', 'ai', 'ai', 2, 'arm:1', 'run-1', '60', false, 't2']],
      },
    ]);
    expect(appendCallsOf(dup)).toHaveLength(0);
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('ResultsData'));
    warnSpy.mockRestore();
  });

  test('入力側に同一キーの行が複数あれば throw（呼び出し契約違反）', async () => {
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
    const updates = batchUpdateCallsOf(deps);
    expect(updates).toHaveLength(1);
    const body = JSON.parse(updates[0]?.[1].body as string);
    expect(body.data[0].values[0][0]).toBe('r-9'); // result_id は既存を保持（新規採番は使わない）
  });

  test('expectedUpdatedAt=undefined はチェックなし（従来挙動。ai 転記・consensus・キュー再送）', async () => {
    const deps = makeDeps([
      RESULTS_HEADER,
      ['r-9', 'doc-1', 'f-arm-n', 'ai', 'ai', '1', 'arm:1', '', '59', 'false', 't-anything'],
    ]);
    await upsertResultsDataRows('sid', [makeResultsRow()], deps); // expectedUpdatedAt 省略
    expect(batchUpdateCallsOf(deps)).toHaveLength(1);
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
    const posts = appendCallsOf(deps);
    const body = JSON.parse(posts[0]?.[1].body as string);
    expect(body.values).toEqual([
      ['r-new', 'doc-1', 'f-arm-n', 'ai', 'ai', 2, 'arm:1', 'run-1', '60', false, 't2'],
    ]);
  });
});

describe('upsertStudyDataRows / upsertResultsDataRows: ApiErrorLog 連携（issue #249）', () => {
  beforeEach(() => {
    installChromeMock();
    configureApiErrorLog(null);
  });

  afterEach(() => {
    configureApiErrorLog(null);
  });

  test('Google API の書き込み失敗は context=annotation_upsert として ApiErrorLog へ記録される', async () => {
    const fetch = jest.fn().mockImplementation(async (input: RequestInfo | URL, init?: RequestInit) => {
      const method = init?.method ?? 'GET';
      if (method === 'GET') {
        return {
          ok: true,
          status: 200,
          json: async () => ({ values: [STUDY_HEADER] }),
          text: async () => '',
        } as Response;
      }
      // 既存行が無いので直接 append へ進む。その POST を失敗させる
      return { ok: false, status: 500, json: async () => ({}), text: async () => 'server down' } as Response;
    });
    const deps = { fetch, getAccessToken: jest.fn().mockResolvedValue('token') };

    await expect(upsertStudyDataRows('sid', [makeStudyRow()], deps)).rejects.toThrow(GoogleApiError);
    // recordApiErrorLog は fire-and-forget（内部の chrome.storage.local 書き込みを待たない）ため、
    // マクロタスク境界を 1 回挟んでキュー投入の完了を待つ（apiErrorLog.test.ts と同じ手法）
    await new Promise((resolve) => setTimeout(resolve, 0));

    // ApiErrorLog へ書き込むための（別の）deps を設定してフラッシュし、記録されたことを確認する
    const logDeps = makeDeps([]);
    configureApiErrorLog({
      spreadsheetId: 'sid',
      loggedBy: 'me@example.com',
      appVersion: '1.0.0',
      google: logDeps,
    });
    const result = await flushApiErrorLogQueue();
    expect(result.flushedCount).toBe(1);
    const appendCall = appendCallsOf(logDeps).find(([url]) => url.includes('ApiErrorLog'));
    expect(appendCall).toBeDefined();
    const body = JSON.parse(String(appendCall?.[1].body)) as { values: unknown[][] };
    expect(body.values[0]?.[3]).toBe('annotation_upsert'); // context
    expect(body.values[0]?.[7]).toBe('doc-1'); // study_id
  });

  test('AnnotationConflictError（楽観ロック競合）は ApiErrorLog へ記録されない', async () => {
    const deps = makeDeps([STUDY_HEADER, ['doc-1', 'ai', 'ai', '1', '', 't0']]);
    configureApiErrorLog({
      spreadsheetId: 'sid',
      loggedBy: 'me@example.com',
      appVersion: '1.0.0',
      google: deps,
    });
    await expect(
      upsertStudyDataRows('sid', [makeStudyRow({ expectedUpdatedAt: null })], deps),
    ).rejects.toThrow(AnnotationConflictError);

    const result = await flushApiErrorLogQueue();
    expect(result).toEqual({ flushedCount: 0, remainingCount: 0 });
    expect(appendCallsOf(deps).some(([url]) => url.includes('ApiErrorLog'))).toBe(false);
  });
});
