import {
  addSheetTab,
  appendRow,
  appendRows,
  createSpreadsheet,
  getBatchValues,
  getSheetTitles,
  getSheetValues,
  updateRow,
  writeHeaderRow,
} from '../../../../src/lib/google/sheets';

function okJson(body: unknown): Response {
  return {
    ok: true,
    status: 200,
    json: async () => body,
    text: async () => JSON.stringify(body),
  } as Response;
}

function deps(body: unknown = {}): { fetch: jest.Mock; getAccessToken: jest.Mock } {
  return {
    fetch: jest.fn().mockResolvedValue(okJson(body)),
    getAccessToken: jest.fn().mockResolvedValue('token'),
  };
}

describe('createSpreadsheet', () => {
  test('POST /v4/spreadsheets にタブ指定付きで作成リクエスト', async () => {
    const d = deps({ spreadsheetId: 'sid', spreadsheetUrl: 'https://sheets.google/x' });
    const result = await createSpreadsheet('My project', ['Meta', 'Documents'], d);
    expect(result).toEqual({
      spreadsheetId: 'sid',
      spreadsheetUrl: 'https://sheets.google/x',
    });
    const [url, init] = d.fetch.mock.calls[0];
    expect(url).toBe('https://sheets.googleapis.com/v4/spreadsheets');
    expect((init as RequestInit).method).toBe('POST');
    const body = JSON.parse((init as RequestInit).body as string);
    expect(body.properties.title).toBe('My project');
    expect(body.sheets).toEqual([
      { properties: { title: 'Meta' } },
      { properties: { title: 'Documents' } },
    ]);
  });
});

describe('getSheetTitles', () => {
  test('sheets.properties.title の一覧を返す', async () => {
    const d = deps({
      sheets: [
        { properties: { title: 'Meta' } },
        { properties: { title: 'Documents' } },
        { properties: { title: 'SchemaFields' } },
      ],
    });
    await expect(getSheetTitles('sid', d)).resolves.toEqual([
      'Meta',
      'Documents',
      'SchemaFields',
    ]);
    const [url] = d.fetch.mock.calls[0];
    expect(url).toContain('/sid?fields=sheets.properties.title');
  });

  test('sheets が未定義なら []、properties / title 欠落は除外', async () => {
    await expect(getSheetTitles('sid', deps({}))).resolves.toEqual([]);
    const d = deps({ sheets: [{}, { properties: {} }, { properties: { title: 'Meta' } }] });
    await expect(getSheetTitles('sid', d)).resolves.toEqual(['Meta']);
  });
});

describe('addSheetTab', () => {
  test('POST :batchUpdate の addSheet でタブを追加する', async () => {
    const d = deps();
    await addSheetTab('sid', 'ArmStructures', d);
    const [url, init] = d.fetch.mock.calls[0];
    expect(url).toContain('/sid:batchUpdate');
    expect((init as RequestInit).method).toBe('POST');
    const body = JSON.parse((init as RequestInit).body as string);
    expect(body).toEqual({
      requests: [{ addSheet: { properties: { title: 'ArmStructures' } } }],
    });
  });
});

describe('writeHeaderRow', () => {
  test('PUT /values/{range}?valueInputOption=RAW でヘッダを書き込む', async () => {
    const d = deps();
    await writeHeaderRow('sid', 'Meta', ['project_id', 'title'], d);
    const [url, init] = d.fetch.mock.calls[0];
    expect(url).toContain('/sid/values/Meta!A1?valueInputOption=RAW');
    expect((init as RequestInit).method).toBe('PUT');
    const body = JSON.parse((init as RequestInit).body as string);
    expect(body.values).toEqual([['project_id', 'title']]);
  });
});

describe('appendRow', () => {
  test('POST :append で 1 行追加、null は空文字に変換', async () => {
    const d = deps();
    await appendRow('sid', 'Documents', ['a', 1, true, null], d);
    const [url, init] = d.fetch.mock.calls[0];
    expect(url).toContain(':append?valueInputOption=RAW');
    const body = JSON.parse((init as RequestInit).body as string);
    expect(body.values).toEqual([['a', 1, true, '']]);
  });
});

describe('updateRow', () => {
  test('PUT /values/{tab}!A{n}?valueInputOption=RAW で行を上書き、null は空文字に変換', async () => {
    const d = deps();
    await updateRow('sid', 'StudyData', 3, ['x', null, true], d);
    const [url, init] = d.fetch.mock.calls[0];
    expect(url).toContain('/sid/values/');
    // range は起点セル StudyData!A3 のみ指定し、values の幅ぶん右へ展開する
    // （StudyData の動的値列は Z 列 = 26 列を超えうるため終端列は固定しない）
    expect(decodeURIComponent(url as string)).toContain('StudyData!A3?valueInputOption=RAW');
    expect((init as RequestInit).method).toBe('PUT');
    const body = JSON.parse((init as RequestInit).body as string);
    expect(body.values).toEqual([['x', '', true]]);
  });
});

describe('appendRows', () => {
  test('POST :append で複数行を一括追加、null は空文字に変換', async () => {
    const d = deps();
    await appendRows(
      'sid',
      'Evidence',
      [
        ['a', 1, null],
        ['b', 2, true],
      ],
      d
    );
    expect(d.fetch).toHaveBeenCalledTimes(1);
    const [url, init] = d.fetch.mock.calls[0];
    expect(url).toContain(':append?valueInputOption=RAW');
    const body = JSON.parse((init as RequestInit).body as string);
    expect(body.values).toEqual([
      ['a', 1, ''],
      ['b', 2, true],
    ]);
  });

  test('空配列は no-op（API を呼ばない）', async () => {
    const d = deps();
    await appendRows('sid', 'Evidence', [], d);
    expect(d.fetch).not.toHaveBeenCalled();
  });
});

describe('getSheetValues', () => {
  test('values が返ってくればそのまま返す（range はタブ名のみ = 全列全行）', async () => {
    const d = deps({ values: [['a', 'b'], ['c', 'd']] });
    await expect(getSheetValues('sid', 'Documents', d)).resolves.toEqual([
      ['a', 'b'],
      ['c', 'd'],
    ]);
    const [url] = d.fetch.mock.calls[0];
    expect(url).toContain('/sid/values/Documents');
    expect(decodeURIComponent(url as string)).not.toContain('Documents!');
  });

  test('values が未定義なら [] を返す', async () => {
    const d = deps({});
    await expect(getSheetValues('sid', 'Documents', d)).resolves.toEqual([]);
  });
});

describe('getBatchValues', () => {
  test('values:batchGet に ranges をクエリで並べ、範囲順の values を返す', async () => {
    const d = deps({
      valueRanges: [{ values: [['doc-1'], ['doc-2']] }, { values: [['1']] }],
    });
    await expect(getBatchValues('sid', ['Documents!A2:A', 'Protocol!A2:A'], d)).resolves.toEqual([
      [['doc-1'], ['doc-2']],
      [['1']],
    ]);
    const [url] = d.fetch.mock.calls[0];
    expect(decodeURIComponent(url as string)).toContain(
      '/sid/values:batchGet?ranges=Documents!A2:A&ranges=Protocol!A2:A',
    );
  });

  test('空範囲（values 省略）・valueRanges 未定義は [] で埋めて範囲数を保つ', async () => {
    const d = deps({ valueRanges: [{}] });
    await expect(getBatchValues('sid', ['Documents!A2:A', 'Evidence!A2:A'], d)).resolves.toEqual([
      [],
      [],
    ]);
    await expect(getBatchValues('sid', ['Documents!A2:A'], deps({}))).resolves.toEqual([[]]);
  });
});
