import type { DocumentRecord } from '../../../../src/domain/document';
import type { StudyRecord } from '../../../../src/domain/study';
import { SHEET_HEADERS } from '../../../../src/domain/sheetsSchema';
import {
  appendStudies,
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

function makeStudy(overrides: Partial<StudyRecord> = {}): StudyRecord {
  return {
    studyId: 'study-1',
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
