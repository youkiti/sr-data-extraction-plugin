import {
  addSheetTab,
  appendRow,
  appendRows,
  batchUpdateRows,
  createSpreadsheet,
  getBatchValues,
  getSheetTitles,
  getSheetValues,
  isSheetsAccessDenied,
  SheetsAccessDeniedError,
  SheetsPartialAppendError,
  updateRow,
  writeHeaderRow,
} from '../../../../src/lib/google/sheets';
import { GoogleApiError } from '../../../../src/lib/google/types';

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

describe('SheetsPartialAppendError（issue #247）', () => {
  test('tab / requestedRows / updatedRows を保持し、メッセージに要求行数と実行数を含める', () => {
    const err = new SheetsPartialAppendError('Evidence', 69, 1);
    expect(err.name).toBe('SheetsPartialAppendError');
    expect(err.tab).toBe('Evidence');
    expect(err.requestedRows).toBe(69);
    expect(err.updatedRows).toBe(1);
    expect(err.message).toContain('要求 69 行');
    expect(err.message).toContain('1 行');
  });
});

describe('appendRows のレスポンス検証（issue #247: 部分書き込みの検知）', () => {
  test('updates.updatedRows が送信行数と一致すれば解決する', async () => {
    const d = deps({ updates: { updatedRange: 'Evidence!A2:Z3', updatedRows: 2 } });
    await expect(
      appendRows('sid', 'Evidence', [['a'], ['b']], d),
    ).resolves.toBeUndefined();
  });

  test('updates.updatedRows が送信行数より少なければ SheetsPartialAppendError を投げる（issue #247 の再現ケース: Evidence 69 行のうち 1 行しか書けない）', async () => {
    const rows = Array.from({ length: 69 }, (_, i) => [`row-${i}`]);
    const d = deps({ updates: { updatedRange: 'Evidence!A70:A70', updatedRows: 1 } });
    const err = await appendRows('sid', 'Evidence', rows, d).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(SheetsPartialAppendError);
    const partialErr = err as SheetsPartialAppendError;
    expect(partialErr.name).toBe('SheetsPartialAppendError');
    expect(partialErr.tab).toBe('Evidence');
    expect(partialErr.requestedRows).toBe(69);
    expect(partialErr.updatedRows).toBe(1);
    expect(partialErr.message).toContain('要求 69 行');
    expect(partialErr.message).toContain('1 行');
  });

  test('updates.updatedRows が無く updates.updatedRange から算出できる場合: 一致すれば解決する', async () => {
    // Evidence!A70:Z138 は 138-70+1 = 69 行
    const rows = Array.from({ length: 69 }, (_, i) => [`row-${i}`]);
    const d = deps({ updates: { updatedRange: 'Evidence!A70:Z138' } });
    await expect(appendRows('sid', 'Evidence', rows, d)).resolves.toBeUndefined();
  });

  test('updates.updatedRows が無く updates.updatedRange から算出できる場合: 不一致なら throw する', async () => {
    // Evidence!A70:Z70 は 1 行のみ
    const rows = Array.from({ length: 69 }, (_, i) => [`row-${i}`]);
    const d = deps({ updates: { updatedRange: 'Evidence!A70:Z70' } });
    const err = await appendRows('sid', 'Evidence', rows, d).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(SheetsPartialAppendError);
    expect((err as SheetsPartialAppendError).updatedRows).toBe(1);
  });

  test('updates が無い（既存テストのスタブ形状）場合は検証をスキップし、成功として返す', async () => {
    const d = deps({});
    await expect(appendRows('sid', 'Evidence', [['a']], d)).resolves.toBeUndefined();
  });

  test('レスポンス本文が JSON でない場合も検証をスキップし、成功として返す', async () => {
    const d: { fetch: jest.Mock; getAccessToken: jest.Mock } = {
      fetch: jest.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => {
          throw new Error('not json');
        },
        text: async () => 'not json',
      } as unknown as Response),
      getAccessToken: jest.fn().mockResolvedValue('token'),
    };
    await expect(appendRows('sid', 'Evidence', [['a']], d)).resolves.toBeUndefined();
  });

  test('updates はあるが updatedRows / updatedRange のどちらも無い場合は判別不能として検証をスキップする', async () => {
    const d = deps({ updates: {} });
    await expect(appendRows('sid', 'Evidence', [['a']], d)).resolves.toBeUndefined();
  });

  test('updates 自体が null の場合も判別不能として検証をスキップする', async () => {
    const d = deps({ updates: null });
    await expect(appendRows('sid', 'Evidence', [['a']], d)).resolves.toBeUndefined();
  });

  test('レスポンス本文がオブジェクトでない（プリミティブ）場合も検証をスキップする', async () => {
    const d = deps(42);
    await expect(appendRows('sid', 'Evidence', [['a']], d)).resolves.toBeUndefined();
  });

  test('updatedRange にタブ名（!）が含まれない形式でも算出できる', async () => {
    const rows = [['a'], ['b']];
    const d = deps({ updates: { updatedRange: 'A2:A3' } });
    await expect(appendRows('sid', 'Evidence', rows, d)).resolves.toBeUndefined();
  });

  test('updatedRange が想定形式に一致しない場合は判別不能として検証をスキップする', async () => {
    const d = deps({ updates: { updatedRange: 'Evidence!weird' } });
    await expect(appendRows('sid', 'Evidence', [['a']], d)).resolves.toBeUndefined();
  });

  test('updatedRange の終端行が始端行より小さい場合は判別不能として検証をスキップする', async () => {
    const d = deps({ updates: { updatedRange: 'Evidence!A10:A5' } });
    await expect(appendRows('sid', 'Evidence', [['a']], d)).resolves.toBeUndefined();
  });

  test('updatedRows が数値だが有限でない（NaN 等）場合は updatedRange へフォールバックする', async () => {
    const rows = [['a'], ['b']];
    const d = deps({
      updates: { updatedRows: Number.NaN, updatedRange: 'Evidence!A2:A3' },
    });
    await expect(appendRows('sid', 'Evidence', rows, d)).resolves.toBeUndefined();
  });
});

describe('batchUpdateRows', () => {
  test('POST /values:batchUpdate で複数行をまとめて上書き、null は空文字に変換', async () => {
    const d = deps();
    await batchUpdateRows(
      'sid',
      'Studies',
      [
        { rowIndex: 2, row: ['study-1', 'Smith (2020)', null] },
        { rowIndex: 5, row: ['study-2', 'Doe (2021)', 'NCT1'] },
      ],
      d
    );
    expect(d.fetch).toHaveBeenCalledTimes(1);
    const [url, init] = d.fetch.mock.calls[0];
    expect(url).toContain('/sid/values:batchUpdate');
    expect((init as RequestInit).method).toBe('POST');
    const body = JSON.parse((init as RequestInit).body as string);
    expect(body.valueInputOption).toBe('RAW');
    expect(body.data).toEqual([
      { range: 'Studies!A2', values: [['study-1', 'Smith (2020)', '']] },
      { range: 'Studies!A5', values: [['study-2', 'Doe (2021)', 'NCT1']] },
    ]);
  });

  test('空配列は no-op（API を呼ばない）', async () => {
    const d = deps();
    await batchUpdateRows('sid', 'Studies', [], d);
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

describe('SheetsAccessDeniedError / isSheetsAccessDenied（issue #130）', () => {
  const make = (status: number, body: string): GoogleApiError =>
    new GoogleApiError(`Google API failed: HTTP ${status}`, status, 'https://sheets/x', body);

  test('SheetsAccessDeniedError は spreadsheetId / status を保持する', () => {
    const err = new SheetsAccessDeniedError('SID-1', 404);
    expect(err.name).toBe('SheetsAccessDeniedError');
    expect(err.spreadsheetId).toBe('SID-1');
    expect(err.status).toBe(404);
    expect(err.message).toContain('権限がまだありません');
  });

  test('404 は本文に関わらず常にアクセス拒否扱い', () => {
    expect(isSheetsAccessDenied(make(404, ''))).toBe(true);
    expect(isSheetsAccessDenied(make(404, 'not json'))).toBe(true);
  });

  test('403 は error.status = PERMISSION_DENIED のときアクセス拒否扱い', () => {
    const body = JSON.stringify({ error: { status: 'PERMISSION_DENIED' } });
    expect(isSheetsAccessDenied(make(403, body))).toBe(true);
  });

  test('403 は errors[].reason が forbidden / insufficientPermissions でもアクセス拒否扱い', () => {
    const forbidden = JSON.stringify({ error: { errors: [{ reason: 'forbidden' }] } });
    const insufficient = JSON.stringify({
      error: { errors: [{ reason: 'insufficientPermissions' }] },
    });
    expect(isSheetsAccessDenied(make(403, forbidden))).toBe(true);
    expect(isSheetsAccessDenied(make(403, insufficient))).toBe(true);
  });

  test('403 でも権限系以外（API 無効化・クォータ等）は対象外', () => {
    const disabled = JSON.stringify({
      error: { status: 'FAILED_PRECONDITION', errors: [{ reason: 'accessNotConfigured' }] },
    });
    expect(isSheetsAccessDenied(make(403, disabled))).toBe(false);
    // reason が非文字列・errors 欠落でも落ちずに false
    expect(isSheetsAccessDenied(make(403, JSON.stringify({ error: { errors: [{ reason: 1 }] } })))).toBe(false);
    expect(isSheetsAccessDenied(make(403, JSON.stringify({ error: {} })))).toBe(false);
    expect(isSheetsAccessDenied(make(403, JSON.stringify({})))).toBe(false);
  });

  test('403 で本文が JSON でない場合は保守的に対象外', () => {
    expect(isSheetsAccessDenied(make(403, 'plain text'))).toBe(false);
  });

  test('403 / 404 以外のステータス・GoogleApiError 以外は対象外', () => {
    expect(isSheetsAccessDenied(make(500, ''))).toBe(false);
    expect(isSheetsAccessDenied(new Error('x'))).toBe(false);
    expect(isSheetsAccessDenied(null)).toBe(false);
  });
});
