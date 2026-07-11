import type { ReviewerAssignment } from '../../../../src/domain/reviewer';
import {
  appendReviewerAssignment,
  foldReviewerAssignments,
  latestReviewerAssignment,
  readReviewerAssignments,
  reviewerAssignmentToRow,
} from '../../../../src/features/project/reviewerRepository';

const HEADER = ['email', 'role', 'review_mode', 'assigned_by', 'assigned_at'];

function makeRow(overrides: Partial<ReviewerAssignment> = {}): ReviewerAssignment {
  return {
    email: 'r1@example.com',
    role: 'reviewer',
    reviewMode: 'with_ai',
    assignedBy: 'owner@example.com',
    assignedAt: 't0',
    ...overrides,
  };
}

interface MockDeps {
  fetch: jest.Mock;
  getAccessToken: jest.Mock;
}

/**
 * URL でルーティングする Sheets API スタブ:
 * - `?fields=sheets.properties.title` → タブ名一覧
 * - values GET → Reviewers タブの values
 * - POST / PUT → 記録のみ
 */
function makeDeps(options: { titles: string[]; values?: string[][] }): MockDeps {
  const fetch = jest
    .fn()
    .mockImplementation(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const method = init?.method ?? 'GET';
      let json: unknown = {};
      if (url.includes('fields=sheets.properties.title')) {
        json = { sheets: options.titles.map((title) => ({ properties: { title } })) };
      } else if (method === 'GET') {
        json = { values: options.values ?? [] };
      }
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

const sheetRow = (overrides: Record<number, string> = {}): string[] => {
  const base = ['r1@example.com', 'reviewer', 'with_ai', 'owner@example.com', 't0'];
  for (const [index, value] of Object.entries(overrides)) {
    base[Number(index)] = value;
  }
  return base;
};

describe('reviewerAssignmentToRow', () => {
  test('SHEET_HEADERS.Reviewers の列順に対応する', () => {
    expect(reviewerAssignmentToRow(makeRow())).toEqual([
      'r1@example.com',
      'reviewer',
      'with_ai',
      'owner@example.com',
      't0',
    ]);
  });

  test('review_mode が null（adjudicator / revoked）は空文字にする', () => {
    expect(reviewerAssignmentToRow(makeRow({ role: 'adjudicator', reviewMode: null }))).toEqual([
      'r1@example.com',
      'adjudicator',
      '',
      'owner@example.com',
      't0',
    ]);
  });
});

describe('readReviewerAssignments', () => {
  test('全行をパースして返す（追記順）', async () => {
    const deps = makeDeps({
      titles: ['Meta', 'Reviewers'],
      values: [
        HEADER,
        sheetRow(),
        sheetRow({ 0: 'r2@example.com', 1: 'adjudicator', 2: '' }),
      ],
    });
    const rows = await readReviewerAssignments('sheet-1', deps);
    expect(rows).toEqual([
      makeRow(),
      makeRow({ email: 'r2@example.com', role: 'adjudicator', reviewMode: null }),
    ]);
  });

  test('ラグ配列（末尾セル欠落）は空文字として読む', async () => {
    const short = sheetRow();
    short.length = 4; // assigned_at が欠落
    const deps = makeDeps({ titles: ['Reviewers'], values: [HEADER, short] });
    const rows = await readReviewerAssignments('sheet-1', deps);
    expect(rows[0]).toEqual(makeRow({ assignedAt: '' }));
  });

  test('タブが無い旧プロジェクトは空配列（values GET は呼ばない）', async () => {
    const deps = makeDeps({ titles: ['Meta', 'Documents'] });
    await expect(readReviewerAssignments('sheet-1', deps)).resolves.toEqual([]);
    expect(callsOf(deps, 'GET')).toHaveLength(1); // タブ名一覧のみ
  });

  test('ヘッダ行が無いシートはエラー', async () => {
    const deps = makeDeps({ titles: ['Reviewers'], values: [] });
    await expect(readReviewerAssignments('sheet-1', deps)).rejects.toThrow(
      'Reviewers タブにヘッダ行がありません',
    );
  });

  test('ヘッダの列名が食い違うシートはエラー', async () => {
    const badHeader = [...HEADER];
    badHeader[1] = 'wrong';
    const deps = makeDeps({ titles: ['Reviewers'], values: [badHeader] });
    await expect(readReviewerAssignments('sheet-1', deps)).rejects.toThrow(
      'Reviewers のヘッダ 2 列目が "role" ではありません',
    );
  });

  test('role が不正な行はエラー', async () => {
    const deps = makeDeps({ titles: ['Reviewers'], values: [HEADER, sheetRow({ 1: 'robot' })] });
    await expect(readReviewerAssignments('sheet-1', deps)).rejects.toThrow(
      'role "robot" が不正です',
    );
  });

  test('review_mode が不正な行はエラー', async () => {
    const deps = makeDeps({ titles: ['Reviewers'], values: [HEADER, sheetRow({ 2: 'robot' })] });
    await expect(readReviewerAssignments('sheet-1', deps)).rejects.toThrow(
      'review_mode "robot" が不正です',
    );
  });
});

describe('appendReviewerAssignment', () => {
  const INPUT = {
    email: 'r1@example.com',
    role: 'reviewer' as const,
    reviewMode: 'with_ai' as const,
    assignedBy: 'owner@example.com',
    assignedAt: 't-now',
  };

  test('既存タブへ 1 行追記する', async () => {
    const deps = makeDeps({ titles: ['Reviewers'], values: [HEADER] });
    await appendReviewerAssignment('sheet-1', INPUT, deps);
    const posts = callsOf(deps, 'POST');
    expect(posts).toHaveLength(1);
    expect(posts[0]?.[0]).toContain('Reviewers!A1:append');
    const body = JSON.parse(String(posts[0]?.[1].body)) as { values: unknown[][] };
    expect(body.values).toEqual([['r1@example.com', 'reviewer', 'with_ai', 'owner@example.com', 't-now']]);
  });

  test('タブが無い旧プロジェクトはタブ作成 + ヘッダ書き込みをしてから追記する', async () => {
    const deps = makeDeps({ titles: ['Meta'] });
    await appendReviewerAssignment('sheet-1', INPUT, deps);
    const posts = callsOf(deps, 'POST');
    expect(posts[0]?.[0]).toContain(':batchUpdate');
    expect(JSON.parse(String(posts[0]?.[1].body))).toEqual({
      requests: [{ addSheet: { properties: { title: 'Reviewers' } } }],
    });
    const puts = callsOf(deps, 'PUT');
    expect(puts[0]?.[0]).toContain('Reviewers!A1');
    expect(posts[1]?.[0]).toContain(':append');
  });

  test('role="adjudicator" / "revoked" は review_mode=null を空文字で追記する', async () => {
    const deps = makeDeps({ titles: ['Reviewers'], values: [HEADER] });
    await appendReviewerAssignment(
      'sheet-1',
      { ...INPUT, role: 'revoked', reviewMode: null },
      deps,
    );
    const body = JSON.parse(String(callsOf(deps, 'POST')[0]?.[1].body)) as { values: string[][] };
    expect(body.values[0]?.[2]).toBe('');
  });
});

describe('latestReviewerAssignment', () => {
  test('email ごとに最後の行（追記順で最新）を返す', () => {
    const rows = [
      makeRow(),
      makeRow({ reviewMode: 'independent' }),
      makeRow({ email: 'other@example.com', role: 'adjudicator', reviewMode: null }),
    ];
    expect(latestReviewerAssignment(rows, 'r1@example.com')).toEqual(
      makeRow({ reviewMode: 'independent' }),
    );
  });

  test('見つからなければ null', () => {
    expect(latestReviewerAssignment([], 'r1@example.com')).toBeNull();
    expect(latestReviewerAssignment([makeRow({ email: 'other@example.com' })], 'r1@example.com')).toBeNull();
  });
});

describe('foldReviewerAssignments', () => {
  test('email ごとに最新行へ畳み込み、初出順を保つ', () => {
    const rows = [
      makeRow({ email: 'a@example.com', assignedAt: 't0' }),
      makeRow({ email: 'b@example.com', assignedAt: 't1' }),
      makeRow({ email: 'a@example.com', role: 'revoked', reviewMode: null, assignedAt: 't2' }),
    ];
    expect(foldReviewerAssignments(rows)).toEqual([
      makeRow({ email: 'a@example.com', role: 'revoked', reviewMode: null, assignedAt: 't2' }),
      makeRow({ email: 'b@example.com', assignedAt: 't1' }),
    ]);
  });

  test('空配列は空配列', () => {
    expect(foldReviewerAssignments([])).toEqual([]);
  });
});
