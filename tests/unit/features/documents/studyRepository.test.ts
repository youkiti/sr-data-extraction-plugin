import type { DocumentRecord } from '../../../../src/domain/document';
import type { StudyRecord } from '../../../../src/domain/study';
import { SHEET_HEADERS } from '../../../../src/domain/sheetsSchema';
import {
  appendStudies,
  ensureStudyReviewSetColumn,
  updateStudyReviewSets,
  readStudies,
  resolveActiveStudies,
  studyLabelMap,
  studyToRow,
  updateStudies,
  updateStudy,
} from '../../../../src/features/documents/studyRepository';

const HEADER = [...SHEET_HEADERS.Studies];

interface MockDeps {
  fetch: jest.Mock;
  getAccessToken: jest.Mock;
}

function makeDeps(values: string[][]): MockDeps {
  const fetch = jest
    .fn()
    .mockImplementation(async (_input: RequestInfo | URL, init?: RequestInit) => {
      const method = init?.method ?? 'GET';
      const json = String(_input).includes('values:batchGet')
        ? { valueRanges: [{ values: values.length === 0 ? [] : [values[0]] }] }
        : method === 'GET'
          ? { values }
          : {};
      return {
        ok: true,
        status: 200,
        json: async () => json,
        text: async () => JSON.stringify(json),
      } as Response;
    });
  return { fetch, getAccessToken: jest.fn().mockResolvedValue('token') };
}

function makeStudy(overrides: Partial<StudyRecord> = {}): StudyRecord {
  return {
    studyId: 'study-1',
    reviewSet: null,
    studyLabel: 'Smith 2020',
    registrationId: 'NCT01234567',
    createdAt: 't1',
    createdBy: 'me@example.com',
    note: null,
    ...overrides,
  };
}

const ROW = ['study-1', 'Smith 2020', 'NCT01234567', 't1', 'me@example.com', ''];

function makeDoc(overrides: Partial<DocumentRecord> = {}): DocumentRecord {
  return {
    documentId: 'doc-1',
    studyId: 'study-1',
    documentRole: 'article',
    driveFileId: 'drive-1',
    sourceFileId: 'src-1',
    filename: 'a.pdf',
    pmid: null,
    doi: null,
    textRef: null,
    textStatus: 'ok',
    pageCount: null,
    charCount: null,
    importedAt: 't1',
    importedBy: 'me@example.com',
    note: null,
    excluded: false,
    exclusionReason: null,
    exclusionNote: null,
    excludedAt: null,
    ...overrides,
  };
}

describe('studyToRow', () => {
  test('SHEET_HEADERS.Studies の列順に対応する', () => {
    const row = studyToRow(makeStudy());
    expect(row).toHaveLength(HEADER.length);
    expect(row[0]).toBe('study-1');
    expect(row[2]).toBe('NCT01234567');
    expect(row[5]).toBeNull();
  });
});

describe('readStudies', () => {
  test('全列をパースする（registration_id / note の空セルは null）', async () => {
    const deps = makeDeps([
      HEADER,
      ROW,
      ['study-2', 'Scan 1999', '', 't2', 'me@example.com', 'memo'],
    ]);
    await expect(readStudies('sid', deps)).resolves.toEqual([
      makeStudy(),
      makeStudy({
        studyId: 'study-2',
        reviewSet: null,
        studyLabel: 'Scan 1999',
        registrationId: null,
        createdAt: 't2',
        note: 'memo',
      }),
    ]);
  });

  test('末尾セルが欠落したラグ行も空セル扱いで読める', async () => {
    // created_by / note（5〜6 列目）が欠落した行
    const ragged = ROW.slice(0, 4);
    const deps = makeDeps([HEADER, ragged]);
    const [study] = await readStudies('sid', deps);
    expect(study).toMatchObject({ studyId: 'study-1', createdBy: '', note: null });
  });

  test('ヘッダ欠落 / 列名不一致 / study_id 重複は throw', async () => {
    await expect(readStudies('sid', makeDeps([]))).rejects.toThrow(
      'Studies タブにヘッダ行がありません',
    );
    await expect(readStudies('sid', makeDeps([['study_id', 'wrong']]))).rejects.toThrow(
      '2 列目が "study_label"',
    );
    await expect(readStudies('sid', makeDeps([HEADER, ROW, ROW]))).rejects.toThrow(
      '同一 study_id の行が複数あります（study-1）',
    );
  });
});

describe('appendStudies', () => {
  test('1 回の :append でまとめて追記し、空配列は no-op', async () => {
    const deps = makeDeps([HEADER]);
    await appendStudies('sid', [makeStudy(), makeStudy({ studyId: 'study-2' })], deps);
    expect(deps.fetch).toHaveBeenCalledTimes(1);
    const [url] = deps.fetch.mock.calls[0];
    expect(decodeURIComponent(url as string)).toContain('Studies!A1:append');

    const empty = makeDeps([HEADER]);
    await appendStudies('sid', [], empty);
    expect(empty.fetch).not.toHaveBeenCalled();
  });
});

describe('updateStudy', () => {
  test('study_id 一致行を行番号指定で上書きする', async () => {
    const other = [...ROW];
    other[0] = 'study-0';
    const deps = makeDeps([HEADER, other, ROW]);
    await updateStudy('sid', makeStudy({ studyLabel: 'Smith 2020 (RCT)' }), deps);
    const put = deps.fetch.mock.calls.find(
      ([, init]) => (init as RequestInit | undefined)?.method === 'PUT',
    );
    expect(decodeURIComponent(put?.[0] as string)).toContain('Studies!A3?valueInputOption=RAW');
    const body = JSON.parse((put?.[1] as RequestInit).body as string);
    expect(body.values[0][1]).toBe('Smith 2020 (RCT)');
  });

  test('該当行が無ければ throw', async () => {
    const deps = makeDeps([HEADER]);
    await expect(updateStudy('sid', makeStudy(), deps)).rejects.toThrow(
      'study_id "study-1" の行がありません',
    );
  });
});

describe('updateStudies', () => {
  test('1 read + values:batchUpdate 1 回で複数行を上書きする（issue #68）', async () => {
    const row2 = [...ROW];
    row2[0] = 'study-2';
    const deps = makeDeps([HEADER, ROW, row2]);
    await updateStudies(
      'sid',
      [makeStudy({ studyLabel: 'Smith (2020)' }), makeStudy({ studyId: 'study-2', studyLabel: 'Doe (2021)' })],
      deps,
    );
    // 1 回目 = Studies GET（行番号解決）、2 回目 = values:batchUpdate POST
    expect(deps.fetch).toHaveBeenCalledTimes(2);
    const [url, init] = deps.fetch.mock.calls[1];
    expect(url as string).toContain('/values:batchUpdate');
    const body = JSON.parse((init as RequestInit).body as string);
    expect(body.valueInputOption).toBe('RAW');
    expect(body.data.map((d: { range: string }) => d.range)).toEqual(['Studies!A2', 'Studies!A3']);
    expect(body.data[0].values[0][1]).toBe('Smith (2020)');
    expect(body.data[1].values[0][1]).toBe('Doe (2021)');
  });

  test('該当行が無ければ throw・空配列は no-op', async () => {
    const deps = makeDeps([HEADER]);
    await expect(updateStudies('sid', [makeStudy()], deps)).rejects.toThrow(
      'study_id "study-1" の行がありません',
    );

    const empty = makeDeps([HEADER]);
    await updateStudies('sid', [], empty);
    expect(empty.fetch).not.toHaveBeenCalled();
  });
});

describe('resolveActiveStudies', () => {
  test('Documents から参照される study だけを作成順で返す', () => {
    const studies = [
      makeStudy({ studyId: 'study-1' }),
      makeStudy({ studyId: 'study-2' }), // 参照 0 = 非アクティブ
      makeStudy({ studyId: 'study-3' }),
    ];
    const documents = [
      makeDoc({ documentId: 'd1', studyId: 'study-1' }),
      makeDoc({ documentId: 'd3', studyId: 'study-3' }),
    ];
    expect(resolveActiveStudies(studies, documents).map((s) => s.studyId)).toEqual([
      'study-1',
      'study-3',
    ]);
  });
});

describe('studyLabelMap', () => {
  test('study_id → study_label のマップを返す', () => {
    const map = studyLabelMap([makeStudy(), makeStudy({ studyId: 'study-2', studyLabel: 'Jones 2021' })]);
    expect(map.get('study-1')).toBe('Smith 2020');
    expect(map.get('study-2')).toBe('Jones 2021');
    expect(map.get('missing')).toBeUndefined();
  });
});


describe('担当セット列の後方互換と更新', () => {
  test('旧 6 列ヘッダは未割当、7 列ヘッダは担当セットを読み込む', async () => {
    await expect(readStudies('sid', makeDeps([HEADER.slice(0, 6), ROW]))).resolves.toEqual([
      makeStudy(),
    ]);
    await expect(readStudies('sid', makeDeps([HEADER, [...ROW, 'group-2']]))).resolves.toEqual([
      makeStudy({ reviewSet: 'group-2' }),
    ]);
    const bad = [...HEADER];
    bad[6] = 'wrong';
    await expect(readStudies('sid', makeDeps([bad, ROW]))).rejects.toThrow('7 列目が "review_set"');
  });

  test('旧ヘッダを範囲指定で読み、7 列のヘッダで上書きする', async () => {
    const deps = makeDeps([HEADER.slice(0, 6)]);
    await ensureStudyReviewSetColumn('sid', deps);
    expect(deps.fetch).toHaveBeenCalledTimes(2);
    expect(decodeURIComponent(String(deps.fetch.mock.calls[0]?.[0]))).toContain(
      '/values:batchGet?ranges=Studies!1:1',
    );
    const [url, init] = deps.fetch.mock.calls[1] as [string, RequestInit];
    expect(decodeURIComponent(url)).toContain('Studies!A1?valueInputOption=RAW');
    expect(init.method).toBe('PUT');
    expect(JSON.parse(String(init.body))).toEqual({ values: [HEADER] });
  });

  test('拡張済みなら書かず、不正ヘッダや欠落は移行を中止する', async () => {
    const deps = makeDeps([HEADER]);
    await ensureStudyReviewSetColumn('sid', deps);
    expect(deps.fetch).toHaveBeenCalledTimes(1);
    for (const header of [[], ['wrong'], [...HEADER.slice(0, 6), 'wrong']]) {
      const invalid = makeDeps([header]);
      await expect(ensureStudyReviewSetColumn('sid', invalid)).rejects.toThrow('Studies のヘッダ');
      expect(invalid.fetch).toHaveBeenCalledTimes(1);
    }
    await expect(ensureStudyReviewSetColumn('sid', makeDeps([]))).rejects.toThrow(
      'Studies のヘッダ',
    );
  });

  test('古いキャッシュのメタデータ更新は担当セット列を書かず、新規追記だけに含める', async () => {
    const study = makeStudy({ reviewSet: 'group-2' });
    expect(studyToRow(study)[6]).toBe('group-2');
    const deps = makeDeps([HEADER, [...ROW, 'group-1']]);
    await updateStudy('sid', study, deps);
    await updateStudies('sid', [study], deps);
    await appendStudies('sid', [study], deps);
    const writes = deps.fetch.mock.calls.filter(([, init]) =>
      ['POST', 'PUT'].includes((init as RequestInit).method ?? ''),
    );
    expect(writes).toHaveLength(3);
    expect(
      writes.map(([, init]) => {
        const body = JSON.parse(String((init as RequestInit).body));
        return (body.values ?? body.data[0].values)[0][6];
      }),
    ).toEqual([undefined, undefined, 'group-2']);
    expect(
      writes.slice(0, 2).map(([, init]) => {
        const body = JSON.parse(String((init as RequestInit).body));
        return (body.values ?? body.data[0].values)[0].length;
      }),
    ).toEqual([6, 6]);
  });

  test('セットを一括更新し、未割当の null と他のメタデータを保持する', async () => {
    const row2 = ['study-2', '別の研究', '', 't2', 'other@example.com', 'メモ', 'calibration'];
    const deps = makeDeps([HEADER.slice(0, 6), ROW, row2]);
    await updateStudyReviewSets(
      'sid',
      [
        { studyId: 'study-2', reviewSet: null },
        { studyId: 'study-1', reviewSet: 'group-1' },
      ],
      deps,
    );
    const writes = deps.fetch.mock.calls.filter(
      ([, init]) => (init as RequestInit).method === 'POST',
    );
    expect(writes).toHaveLength(1);
    expect(JSON.parse(String((writes[0]?.[1] as RequestInit).body))).toEqual({
      valueInputOption: 'RAW',
      data: [
        { range: 'Studies!A3', values: [[...row2.slice(0, 6), '']] },
        { range: 'Studies!A2', values: [[...ROW, 'group-1']] },
      ],
    });
  });

  test('空配列は API を呼ばず、未知の study はデータ更新をしない', async () => {
    const empty = makeDeps([]);
    await updateStudyReviewSets('sid', [], empty);
    expect(empty.fetch).not.toHaveBeenCalled();
    const missing = makeDeps([HEADER, ROW]);
    await expect(
      updateStudyReviewSets('sid', [{ studyId: 'unknown', reviewSet: 'group-1' }], missing),
    ).rejects.toThrow('study_id "unknown" の行がありません');
    expect(
      missing.fetch.mock.calls.every(([, init]) => (init as RequestInit).method === 'GET'),
    ).toBe(true);
  });
});

test.each([false, true])(
  '古い担当セットを持つ編集でも実際のシートの割当を維持する（一括=%s）',
  async (batch) => {
    const row = [...ROW, 'group-9'];
    const deps = makeDeps([HEADER, row]);
    deps.fetch.mockImplementation(async (_input: RequestInfo | URL, init?: RequestInit) => {
      if (init?.method === 'PUT' || init?.method === 'POST') {
        const body = JSON.parse(String(init.body));
        const values = (body.values ?? body.data[0].values)[0] as string[];
        values.forEach((value, index) => {
          row[index] = value;
        });
      }
      return { ok: true, json: async () => ({ values: [HEADER, row] }), text: async () => '' };
    });
    const stale = makeStudy({ studyLabel: '編集済み', reviewSet: 'group-1' });
    if (batch) await updateStudies('sid', [stale], deps);
    else await updateStudy('sid', stale, deps);
    expect((await readStudies('sid', deps))[0]).toMatchObject({
      studyLabel: '編集済み',
      reviewSet: 'group-9',
    });
  },
);
