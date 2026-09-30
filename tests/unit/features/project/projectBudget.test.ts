import { META_BUDGET_COLUMNS, SHEET_HEADERS } from '../../../../src/domain/sheetsSchema';
import {
  readProjectBudget,
  saveProjectBudget,
} from '../../../../src/features/project/projectBudget';

const BASE = ['pid', '題名', 'sid', 'folder', '1.0', '作成日時', '作成者'];
const FULL_HEADER = [...SHEET_HEADERS.Meta, ...META_BUDGET_COLUMNS];

function makeDeps(values: string[][]) {
  const fetch = jest.fn().mockResolvedValue({
    ok: true,
    status: 200,
    json: async () => ({ values }),
  } as Response);
  return { fetch, getAccessToken: jest.fn().mockResolvedValue('token') };
}

const BUDGET = { budgetUsd: 12.5, updatedBy: 'owner', updatedAt: '更新日時' };

describe('readProjectBudget', () => {
  test.each([[], [SHEET_HEADERS.Meta], [SHEET_HEADERS.Meta, BASE]].map((rows) => ({ rows })))(
    '予算列・データ行がない旧プロジェクトは未設定: %j',
    async ({ rows }) => {
      expect(await readProjectBudget('sid', makeDeps(rows as string[][]))).toEqual({
        budgetUsd: null,
        updatedBy: null,
        updatedAt: null,
      });
    },
  );

  test('列順が異なっても列名で予算と監査情報を読む', async () => {
    const deps = makeDeps([
      [...SHEET_HEADERS.Meta, 'budget_updated_at', '別の列', 'budget_usd', 'budget_updated_by'],
      [...BASE, '更新日時', '変更しない', '12.5', 'owner'],
    ]);
    expect(await readProjectBudget('sid', deps)).toEqual(BUDGET);
    expect(deps.fetch).toHaveBeenCalledTimes(1);
  });

  test.each(['', '非数値', '-1', 'Infinity', 'NaN'])('不正・空の予算は未設定: %s', async (cell) => {
    expect(
      await readProjectBudget('sid', makeDeps([FULL_HEADER, [...BASE, cell, '', '']])),
    ).toEqual({
      budgetUsd: null,
      updatedBy: null,
      updatedAt: null,
    });
  });

  test.each(['0', '1.25'])('非負の有限数は予算として読める: %s', async (cell) => {
    expect(
      (await readProjectBudget('sid', makeDeps([FULL_HEADER, [...BASE, cell]]))).budgetUsd,
    ).toBe(Number(cell));
  });
});

describe('saveProjectBudget', () => {
  test.each([0, 1, 2])('不足する予算ヘッダを追加し、予算列だけを保存する: %i 列', async (n) => {
    const deps = makeDeps([[...SHEET_HEADERS.Meta, ...META_BUDGET_COLUMNS.slice(0, n)], BASE]);
    await saveProjectBudget('sid', BUDGET, deps);
    expect(deps.fetch).toHaveBeenCalledTimes(3);
    const [, headerInit] = deps.fetch.mock.calls[1]!;
    expect(JSON.parse((headerInit as RequestInit).body as string).values).toEqual([META_BUDGET_COLUMNS]);
    const [url, init] = deps.fetch.mock.calls[2]!;
    expect(decodeURIComponent(url as string)).toContain('/sid/values/Meta!H2:J2');
    expect(JSON.parse((init as RequestInit).body as string).values).toEqual([
      [12.5, 'owner', '更新日時'],
    ]);
  });

  test('予算ヘッダ追加済みなら行 2 だけを書き、後続列・行への書き込みは行わない', async () => {
    const deps = makeDeps([
      [...FULL_HEADER, '将来の列'],
      [...BASE, '10', '前の人', '前の日時', '保持する'],
      ['別の行'],
    ]);
    await saveProjectBudget('sid', BUDGET, deps);
    expect(deps.fetch).toHaveBeenCalledTimes(2);
    const [url, init] = deps.fetch.mock.calls[1]!;
    expect(decodeURIComponent(url as string)).toContain('/sid/values/Meta!H2:J2');
    const values = JSON.parse((init as RequestInit).body as string).values;
    expect(values).toEqual([[12.5, 'owner', '更新日時']]);
    expect(values[0]).toHaveLength(3);
  });

  test('解除は予算ヘッダと値を空にし、再設定でヘッダを戻す', async () => {
    const rows = [FULL_HEADER, [...BASE, '12.5', 'owner', '更新日時']];
    const deps = makeDeps(rows);
    await saveProjectBudget('sid', { ...BUDGET, budgetUsd: null }, deps);
    expect(deps.fetch).toHaveBeenCalledTimes(2);
    const [url, init] = deps.fetch.mock.calls[1]!;
    expect(decodeURIComponent(url as string)).toContain('/sid/values/Meta!H1:J2');
    expect(JSON.parse((init as RequestInit).body as string).values).toEqual([
      ['', '', ''], ['', '', ''],
    ]);
    // Sheets の GET は行末の空セルを返さない。
    rows[0] = [...SHEET_HEADERS.Meta];
    rows[1] = [...BASE];
    expect(await readProjectBudget('sid', deps)).toEqual({
      budgetUsd: null, updatedBy: null, updatedAt: null,
    });
    deps.fetch.mockClear();
    await saveProjectBudget('sid', BUDGET, deps);
    expect(deps.fetch).toHaveBeenCalledTimes(3);
    expect(decodeURIComponent(deps.fetch.mock.calls[1]![0] as string)).toContain('Meta!H1:J1');
    expect(JSON.parse((deps.fetch.mock.calls[1]![1] as RequestInit).body as string).values)
      .toEqual([META_BUDGET_COLUMNS]);
    expect(decodeURIComponent(deps.fetch.mock.calls[2]![0] as string)).toContain('Meta!H2:J2');
    expect(JSON.parse((deps.fetch.mock.calls[2]![1] as RequestInit).body as string).values)
      .toEqual([[12.5, 'owner', '更新日時']]);
  });

  test('予算ヘッダがない状態の解除は何も書き込まない', async () => {
    const deps = makeDeps([[...SHEET_HEADERS.Meta], BASE]);
    await saveProjectBudget('sid', { ...BUDGET, budgetUsd: null }, deps);
    expect(deps.fetch).toHaveBeenCalledTimes(1);
  });

  test('基本行がなくても予算ヘッダと値を消去する', async () => {
    const deps = makeDeps([FULL_HEADER]);
    await saveProjectBudget('sid', { budgetUsd: null, updatedBy: null, updatedAt: null }, deps);
    const [, init] = deps.fetch.mock.calls[1]!;
    expect(JSON.parse((init as RequestInit).body as string).values).toEqual([
      ['', '', ''], ['', '', ''],
    ]);
  });

  test('基本 7 列の同時編集を戻さず、予算 3 列だけを PUT する', async () => {
    expect(SHEET_HEADERS.Meta).toHaveLength(7);
    const original = [...BASE];
    const deps = makeDeps([FULL_HEADER, original]);
    deps.fetch.mockImplementation(async (_url: string, init: RequestInit) => {
      if (init.method === 'PUT') {
        original[1] = '別ユーザーが変更した題名';
      }
      return { ok: true, json: async () => ({ values: [FULL_HEADER, original] }) } as Response;
    });
    await saveProjectBudget('sid', BUDGET, deps);
    expect(original[1]).toBe('別ユーザーが変更した題名');
    const [url, init] = deps.fetch.mock.calls[1]!;
    expect(decodeURIComponent(url as string)).toContain('Meta!H2:J2?valueInputOption=RAW');
    expect(JSON.parse((init as RequestInit).body as string).values).toEqual([
      [12.5, 'owner', '更新日時'],
    ]);
  });

  test.each([0, -1, Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY])(
    '不正な入力予算は読み書きせず拒否する: %j',
    async (budgetUsd) => {
      const deps = makeDeps([FULL_HEADER, BASE]);
      await expect(saveProjectBudget('sid', { ...BUDGET, budgetUsd }, deps)).rejects.toThrow(
        '予算は 0 より大きい有限の数値を指定してください',
      );
      expect(deps.fetch).not.toHaveBeenCalled();
    },
  );

  test.each(
    [
      [],
      [['違う列']],
      [SHEET_HEADERS.Meta.slice(0, 6)],
      [[...SHEET_HEADERS.Meta.slice(0, 6), '違う列']],
    ].map((rows) => ({ rows })),
  )('基本ヘッダの欠落・不一致は書き込まず拒否する: %j', async ({ rows }) => {
    const deps = makeDeps(rows as string[][]);
    await expect(saveProjectBudget('sid', BUDGET, deps)).rejects.toThrow(/Meta のヘッダ/);
    expect(deps.fetch).toHaveBeenCalledTimes(1);
  });

  test('予算位置に未知の列があれば上書きせず拒否する', async () => {
    const deps = makeDeps([[...SHEET_HEADERS.Meta, '別の列'], BASE]);
    await expect(saveProjectBudget('sid', BUDGET, deps)).rejects.toThrow(/予算列の配置/);
    expect(deps.fetch).toHaveBeenCalledTimes(1);
  });
});
