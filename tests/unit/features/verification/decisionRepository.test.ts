import type { Decision } from '../../../../src/domain/decision';
import {
  appendDecisionRows,
  decisionToRow,
  readAllDecisions,
  readDecisionsByStudy,
} from '../../../../src/features/verification/decisionRepository';

const DECISIONS_HEADER = [
  'decided_at',
  'decided_by',
  'study_id',
  'field_id',
  'entity_key',
  'annotator',
  'annotator_type',
  'schema_version',
  'action',
  'value',
  'note',
];

function makeDecision(overrides: Partial<Decision> = {}): Decision {
  return {
    decidedAt: '2026-07-02T10:00:00Z',
    decidedBy: 'me@example.com',
    studyId: 'doc-1',
    fieldId: 'f-1',
    entityKey: '-',
    annotator: 'me@example.com',
    annotatorType: 'human_with_ai',
    schemaVersion: 2,
    action: 'accept',
    value: '120',
    note: null,
    ...overrides,
  };
}

interface MockDeps {
  fetch: jest.Mock;
  getAccessToken: jest.Mock;
}

/** GET（getSheetValues）に values を返し、書き込みは記録だけする */
function makeDeps(values: string[][] = []): MockDeps {
  const fetch = jest.fn().mockImplementation(async (_input: RequestInfo | URL, init?: RequestInit) => {
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

function postCalls(deps: MockDeps): [string, RequestInit][] {
  return deps.fetch.mock.calls
    .filter(([, init]) => ((init as RequestInit | undefined)?.method ?? 'GET') === 'POST')
    .map(([url, init]) => [decodeURIComponent(String(url)), init as RequestInit]);
}

describe('decisionToRow', () => {
  test('SHEET_HEADERS.Decisions の列順に対応する', () => {
    expect(decisionToRow(makeDecision())).toEqual([
      '2026-07-02T10:00:00Z',
      'me@example.com',
      'doc-1',
      'f-1',
      '-',
      'me@example.com',
      'human_with_ai',
      2,
      'accept',
      '120',
      null,
    ]);
  });

  test('null 許容列（value / note）は null をそのまま返す', () => {
    const row = decisionToRow(makeDecision({ action: 'undo', value: null, note: null }));
    expect(row[8]).toBe('undo');
    expect(row[9]).toBeNull();
    expect(row[10]).toBeNull();
  });
});

describe('appendDecisionRows', () => {
  test('Decisions タブへ append する', async () => {
    const deps = makeDeps();
    await appendDecisionRows('sheet-1', [makeDecision()], deps);
    const posts = postCalls(deps);
    expect(posts).toHaveLength(1);
    expect(posts[0]?.[0]).toContain('Decisions');
    expect(posts[0]?.[0]).toContain(':append');
    const body = JSON.parse(String(posts[0]?.[1].body)) as { values: unknown[][] };
    // appendRows は null を空セル（''）へ変換して送る
    expect(body.values).toEqual([decisionToRow(makeDecision()).map((value) => value ?? '')]);
  });
});

describe('readDecisionsByStudy', () => {
  const row = (overrides: Record<number, string> = {}): string[] => {
    const base = [
      '2026-07-02T10:00:00Z',
      'me@example.com',
      'doc-1',
      'f-1',
      '-',
      'me@example.com',
      'human_with_ai',
      '2',
      'accept',
      '120',
      'メモ',
    ];
    for (const [index, value] of Object.entries(overrides)) {
      base[Number(index)] = value;
    }
    return base;
  };

  test('指定 study の行だけをパースして返す', async () => {
    const deps = makeDeps([
      DECISIONS_HEADER,
      row(),
      row({ 2: 'doc-2' }),
      row({ 8: 'undo', 9: '', 10: '' }),
    ]);
    const decisions = await readDecisionsByStudy('sheet-1', 'doc-1', deps);
    expect(decisions).toHaveLength(2);
    expect(decisions[0]).toEqual(makeDecision({ note: 'メモ' }));
    expect(decisions[1]).toMatchObject({ action: 'undo', value: null, note: null });
  });

  test('ヘッダ行が無いシートはエラー', async () => {
    await expect(readDecisionsByStudy('sheet-1', 'doc-1', makeDeps([]))).rejects.toThrow(
      'Decisions タブにヘッダ行がありません',
    );
  });

  test('ヘッダの列名が食い違うシートはエラー', async () => {
    const badHeader = [...DECISIONS_HEADER];
    badHeader[3] = 'wrong';
    await expect(
      readDecisionsByStudy('sheet-1', 'doc-1', makeDeps([badHeader])),
    ).rejects.toThrow('Decisions のヘッダ 4 列目が "field_id" ではありません');
  });

  test('action が不正な行はエラー', async () => {
    const deps = makeDeps([DECISIONS_HEADER, row({ 8: 'approve' })]);
    await expect(readDecisionsByStudy('sheet-1', 'doc-1', deps)).rejects.toThrow(
      'Decisions 2 行目: action "approve" が不正です',
    );
  });

  test('annotator_type が不正な行はエラー', async () => {
    const deps = makeDeps([DECISIONS_HEADER, row({ 6: 'robot' })]);
    await expect(readDecisionsByStudy('sheet-1', 'doc-1', deps)).rejects.toThrow(
      'annotator_type "robot" が不正です',
    );
  });

  test('schema_version が整数でない行はエラー', async () => {
    const deps = makeDeps([DECISIONS_HEADER, row({ 7: 'v2' })]);
    await expect(readDecisionsByStudy('sheet-1', 'doc-1', deps)).rejects.toThrow(
      'schema_version "v2" が整数ではありません',
    );
  });

  test('ラグ配列（末尾セル欠落）は空文字 = null として読む', async () => {
    const short = row();
    short.length = 9; // value / note が欠落
    const deps = makeDeps([DECISIONS_HEADER, short]);
    const decisions = await readDecisionsByStudy('sheet-1', 'doc-1', deps);
    expect(decisions[0]).toMatchObject({ value: null, note: null });
  });

  test('readAllDecisions は study で絞らず全行を返す（S8 の進捗チップ素材）', async () => {
    const deps = makeDeps([DECISIONS_HEADER, row(), row({ 2: 'doc-2' })]);
    const decisions = await readAllDecisions('sheet-1', deps);
    expect(decisions.map((decision) => decision.studyId)).toEqual(['doc-1', 'doc-2']);
  });
});
