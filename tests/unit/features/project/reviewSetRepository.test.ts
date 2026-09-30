// 担当セットの Sheets I/O と owner 行だけの畳み込みを検証する。
import { SHEET_HEADERS } from '../../../../src/domain/sheetsSchema';
import {
  appendReviewSetRows,
  foldReviewSets,
  readReviewSetRows,
} from '../../../../src/features/project/reviewSetRepository';
import { reviewSet } from '../review/reviewSetFixtures';

const HEADER = [...SHEET_HEADERS.ReviewSets];
function makeDeps(titles: string[], values: string[][] = []) {
  return {
    getAccessToken: jest.fn().mockResolvedValue('token'),
    fetch: jest.fn().mockImplementation(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const json = url.includes('fields=sheets.properties.title')
        ? { sheets: titles.map((title) => ({ properties: { title } })) }
        : (init?.method ?? 'GET') === 'GET'
          ? { values }
          : {};
      return {
        ok: true,
        status: 200,
        json: async () => json,
        text: async () => JSON.stringify(json),
      } as Response;
    }),
  };
}

describe('担当セットの読み込み', () => {
  test('タブがなければ空配列、ヘッダだけでも空配列', async () => {
    const missing = makeDeps(['Meta']);
    await expect(readReviewSetRows('sid', missing)).resolves.toEqual([]);
    expect(missing.fetch).toHaveBeenCalledTimes(1);
    await expect(readReviewSetRows('sid', makeDeps(['ReviewSets'], [HEADER]))).resolves.toEqual([]);
  });
  test('追記順に読み、メールをトリム・空除去・重複除去して順序を保持する', async () => {
    const deps = makeDeps(
      ['ReviewSets'],
      [
        HEADER,
        [
          'group-1',
          ' b@example.com ; ;a@example.com;b@example.com; ',
          '42',
          'owner@example.com',
          't0',
        ],
        ['calibration', '', '', 'owner@example.com', 't1'],
        [],
      ],
    );
    await expect(readReviewSetRows('sid', deps)).resolves.toEqual([
      reviewSet({ reviewerEmails: ['b@example.com', 'a@example.com'] }),
      reviewSet({ setId: 'calibration', reviewerEmails: [], seed: null, updatedAt: 't1' }),
      reviewSet({ setId: '', reviewerEmails: [], seed: null, updatedBy: '', updatedAt: '' }),
    ]);
  });
  test('ヘッダ欠落と不正ヘッダはエラー', async () => {
    await expect(readReviewSetRows('sid', makeDeps(['ReviewSets']))).rejects.toThrow(
      'ヘッダ行がありません',
    );
    await expect(readReviewSetRows('sid', makeDeps(['ReviewSets'], [['wrong']]))).rejects.toThrow(
      '1 列目が "set_id"',
    );
  });
});

describe('担当セットの追記', () => {
  test('空配列は API 呼び出しなし', async () => {
    const deps = makeDeps([]);
    await appendReviewSetRows('sid', [], deps);
    expect(deps.fetch).not.toHaveBeenCalled();
  });
  test('既存タブへ複数行を一括追記し、メールと null の seed を正規化する', async () => {
    const deps = makeDeps(['ReviewSets']);
    await appendReviewSetRows(
      'sid',
      [
        reviewSet({ reviewerEmails: [' a@example.com ', '', 'b@example.com', 'a@example.com'] }),
        reviewSet({ setId: 'calibration', reviewerEmails: [], seed: null }),
      ],
      deps,
    );
    expect(deps.fetch).toHaveBeenCalledTimes(2);
    const [url, init] = deps.fetch.mock.calls[1] as [string, RequestInit];
    expect(decodeURIComponent(url)).toContain('ReviewSets!A1:append');
    expect(JSON.parse(String(init.body)).values).toEqual([
      ['group-1', 'a@example.com;b@example.com', '42', 'owner@example.com', 't0'],
      ['calibration', '', '', 'owner@example.com', 't0'],
    ]);
  });
  test('旧プロジェクトはタブ作成・ヘッダ書き込み後に追記する', async () => {
    const deps = makeDeps(['Meta']);
    await appendReviewSetRows('sid', [reviewSet()], deps);
    expect(deps.fetch).toHaveBeenCalledTimes(4);
    const calls = deps.fetch.mock.calls as [string, RequestInit][];
    expect(calls[1]?.[0]).toContain(':batchUpdate');
    expect(JSON.parse(String(calls[1]?.[1].body))).toEqual({
      requests: [{ addSheet: { properties: { title: 'ReviewSets' } } }],
    });
    expect(decodeURIComponent(calls[2]?.[0] as string)).toContain('ReviewSets!A1');
    expect(JSON.parse(String(calls[2]?.[1].body))).toEqual({ values: [HEADER] });
    expect(decodeURIComponent(calls[3]?.[0] as string)).toContain(':append');
  });
});

describe('担当セットの畳み込み', () => {
  test('owner 以外の行を無視して数え、追記順の最終行をセット順で返す', () => {
    const rows = [
      reviewSet({ setId: 'group-10' }),
      reviewSet({ updatedAt: 't9' }),
      reviewSet({ setId: 'group-2' }),
      reviewSet({ updatedBy: 'tampered@example.com', reviewerEmails: ['改ざん'] }),
      reviewSet({ setId: 'calibration', reviewerEmails: [] }),
      reviewSet({ updatedAt: 't0', reviewerEmails: [' c@example.com ', '', 'c@example.com'] }),
      reviewSet({ setId: 'group-3', updatedBy: 'tampered@example.com' }),
    ];
    expect(foldReviewSets(rows, 'owner@example.com')).toEqual({
      sets: [
        reviewSet({ setId: 'calibration', reviewerEmails: [] }),
        reviewSet({ reviewerEmails: ['c@example.com'] }),
        reviewSet({ setId: 'group-2' }),
        reviewSet({ setId: 'group-10' }),
      ],
      ignoredCount: 2,
    });
    expect(rows[5]?.reviewerEmails).toEqual([' c@example.com ', '', 'c@example.com']);
  });
  test('有効行がなければ空配列', () => {
    expect(foldReviewSets([], 'owner@example.com')).toEqual({ sets: [], ignoredCount: 0 });
    expect(foldReviewSets([reviewSet({ updatedBy: 'other' })], 'owner@example.com')).toEqual({
      sets: [],
      ignoredCount: 1,
    });
  });
});

test('担当者の編集は分割 seed とその日時を保持し、次の分割で更新する', () => {
  const split = reviewSet({ updatedAt: 't1' });
  const edit = reviewSet({ seed: null, updatedAt: 't9', reviewerEmails: ['c@example.com'] });
  const first = foldReviewSets([split, edit], 'owner@example.com').sets;
  expect(first).toEqual([
    reviewSet({
      seed: '42',
      splitUpdatedAt: 't1',
      updatedAt: 't9',
      reviewerEmails: ['c@example.com'],
    }),
  ]);
  expect(
    foldReviewSets([...first, { ...edit, updatedAt: 't10' }], 'owner@example.com').sets[0]
      ?.splitUpdatedAt,
  ).toBe('t1');
  expect(
    foldReviewSets([...first, reviewSet({ seed: '99', updatedAt: 't11' })], 'owner@example.com')
      .sets,
  ).toEqual([reviewSet({ seed: '99', updatedAt: 't11' })]);
  expect(foldReviewSets([edit], 'owner@example.com').sets).toEqual([edit]);
});
