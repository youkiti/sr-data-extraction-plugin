import type { ArmStructureRow } from '../../../../src/domain/armStructure';
import {
  appendArmStructureVersion,
  armStructureToRow,
  latestArmStructure,
  readArmStructuresByDocument,
} from '../../../../src/features/verification/armStructureRepository';

const HEADER = [
  'document_id',
  'version',
  'arm_key',
  'arm_name',
  'annotator',
  'annotator_type',
  'confirmed_at',
  'note',
];

const ME = 'me@example.com';

function makeRow(overrides: Partial<ArmStructureRow> = {}): ArmStructureRow {
  return {
    documentId: 'doc-1',
    version: 1,
    armKey: 'arm:1',
    armName: '介入群',
    annotator: ME,
    annotatorType: 'human_with_ai',
    confirmedAt: 't0',
    note: null,
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
 * - values GET → ArmStructures タブの values
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
  const base = ['doc-1', '1', 'arm:1', '介入群', ME, 'human_with_ai', 't0', ''];
  for (const [index, value] of Object.entries(overrides)) {
    base[Number(index)] = value;
  }
  return base;
};

describe('armStructureToRow', () => {
  test('SHEET_HEADERS.ArmStructures の列順に対応する', () => {
    expect(armStructureToRow(makeRow())).toEqual([
      'doc-1',
      1,
      'arm:1',
      '介入群',
      ME,
      'human_with_ai',
      't0',
      null,
    ]);
  });
});

describe('readArmStructuresByDocument', () => {
  test('指定 document の行だけをパースして返す', async () => {
    const deps = makeDeps({
      titles: ['Meta', 'ArmStructures'],
      values: [HEADER, sheetRow(), sheetRow({ 0: 'doc-2' }), sheetRow({ 2: 'arm:2', 3: '対照群', 7: 'メモ' })],
    });
    const rows = await readArmStructuresByDocument('sheet-1', 'doc-1', deps);
    expect(rows).toHaveLength(2);
    expect(rows[0]).toEqual(makeRow());
    expect(rows[1]).toEqual(makeRow({ armKey: 'arm:2', armName: '対照群', note: 'メモ' }));
  });

  test('ラグ配列（末尾セル欠落）は空文字 = note null として読む', async () => {
    const short = sheetRow();
    short.length = 7; // note が欠落
    const deps = makeDeps({ titles: ['ArmStructures'], values: [HEADER, short] });
    const rows = await readArmStructuresByDocument('sheet-1', 'doc-1', deps);
    expect(rows[0]).toEqual(makeRow({ note: null }));
  });

  test('タブが無い旧プロジェクトは空配列（values GET は呼ばない）', async () => {
    const deps = makeDeps({ titles: ['Meta', 'Documents'] });
    await expect(readArmStructuresByDocument('sheet-1', 'doc-1', deps)).resolves.toEqual([]);
    expect(callsOf(deps, 'GET')).toHaveLength(1); // タブ名一覧のみ
  });

  test('ヘッダ行が無いシートはエラー', async () => {
    const deps = makeDeps({ titles: ['ArmStructures'], values: [] });
    await expect(readArmStructuresByDocument('sheet-1', 'doc-1', deps)).rejects.toThrow(
      'ArmStructures タブにヘッダ行がありません',
    );
  });

  test('ヘッダの列名が食い違うシートはエラー', async () => {
    const badHeader = [...HEADER];
    badHeader[2] = 'wrong';
    const deps = makeDeps({ titles: ['ArmStructures'], values: [badHeader] });
    await expect(readArmStructuresByDocument('sheet-1', 'doc-1', deps)).rejects.toThrow(
      'ArmStructures のヘッダ 3 列目が "arm_key" ではありません',
    );
  });

  test('version が正の整数でない行・annotator_type が不正な行はエラー', async () => {
    const badVersion = makeDeps({ titles: ['ArmStructures'], values: [HEADER, sheetRow({ 1: '0' })] });
    await expect(readArmStructuresByDocument('sheet-1', 'doc-1', badVersion)).rejects.toThrow(
      'version "0" が正の整数ではありません',
    );
    const badType = makeDeps({ titles: ['ArmStructures'], values: [HEADER, sheetRow({ 5: 'robot' })] });
    await expect(readArmStructuresByDocument('sheet-1', 'doc-1', badType)).rejects.toThrow(
      'annotator_type "robot" が不正です',
    );
  });
});

describe('latestArmStructure', () => {
  test('自分の最新 version の arm 一覧へ畳み込む（他 annotator は無視）', () => {
    const rows = [
      makeRow(),
      makeRow({ version: 2, armName: '介入群（改）' }),
      makeRow({ version: 2, armKey: 'arm:2', armName: '対照群' }),
      makeRow({ version: 9, annotator: 'other@example.com', armName: '他人' }),
    ];
    expect(latestArmStructure(rows, ME)).toEqual({
      version: 2,
      arms: [
        { armKey: 'arm:1', armName: '介入群（改）' },
        { armKey: 'arm:2', armName: '対照群' },
      ],
    });
  });

  test('自分の行が無ければ null（= 未確定）', () => {
    expect(latestArmStructure([], ME)).toBeNull();
    expect(latestArmStructure([makeRow({ annotator: 'other@example.com' })], ME)).toBeNull();
  });
});

describe('appendArmStructureVersion', () => {
  const INPUT = {
    documentId: 'doc-1',
    arms: [
      { armKey: 'arm:1', armName: '介入群' },
      { armKey: 'arm:2', armName: '対照群' },
    ],
    annotator: ME,
    annotatorType: 'human_with_ai' as const,
    confirmedAt: 't-now',
  };

  test('初回確定は version 1 で全 arm 行を追記する', async () => {
    const deps = makeDeps({ titles: ['ArmStructures'], values: [HEADER] });
    const result = await appendArmStructureVersion('sheet-1', INPUT, deps);
    expect(result).toEqual({ version: 1, arms: INPUT.arms });
    const posts = callsOf(deps, 'POST');
    expect(posts).toHaveLength(1);
    expect(posts[0]?.[0]).toContain('ArmStructures!A1:append');
    const body = JSON.parse(String(posts[0]?.[1].body)) as { values: unknown[][] };
    expect(body.values).toEqual([
      ['doc-1', 1, 'arm:1', '介入群', ME, 'human_with_ai', 't-now', ''],
      ['doc-1', 1, 'arm:2', '対照群', ME, 'human_with_ai', 't-now', ''],
    ]);
  });

  test('既存 version がある document は最大 + 1 で採番する（他 document・他 annotator は無視）', async () => {
    const deps = makeDeps({
      titles: ['ArmStructures'],
      values: [
        HEADER,
        sheetRow({ 1: '3' }),
        sheetRow({ 0: 'doc-2', 1: '9' }),
        sheetRow({ 1: '7', 4: 'other@example.com' }),
      ],
    });
    const result = await appendArmStructureVersion('sheet-1', { ...INPUT, note: '改訂' }, deps);
    expect(result.version).toBe(4);
    const body = JSON.parse(String(callsOf(deps, 'POST')[0]?.[1].body)) as { values: string[][] };
    expect(body.values[0]?.[1]).toBe(4 as unknown as string);
    expect(body.values[0]?.[7]).toBe('改訂');
  });

  test('タブが無い旧プロジェクトはタブ作成 + ヘッダ書き込みをしてから version 1 を追記する', async () => {
    const deps = makeDeps({ titles: ['Meta'] });
    const result = await appendArmStructureVersion('sheet-1', INPUT, deps);
    expect(result.version).toBe(1);
    const posts = callsOf(deps, 'POST');
    expect(posts[0]?.[0]).toContain(':batchUpdate');
    expect(JSON.parse(String(posts[0]?.[1].body))).toEqual({
      requests: [{ addSheet: { properties: { title: 'ArmStructures' } } }],
    });
    const puts = callsOf(deps, 'PUT');
    expect(puts[0]?.[0]).toContain('ArmStructures!A1');
    expect(posts[1]?.[0]).toContain(':append');
  });

  test('ヘッダ行が無い（作成直後に読めた）場合は既存 0 件として version 1 を採番する', async () => {
    const deps = makeDeps({ titles: ['ArmStructures'], values: [] });
    const result = await appendArmStructureVersion('sheet-1', INPUT, deps);
    expect(result.version).toBe(1);
  });

  test('arm 0 件の確定は拒否する', async () => {
    const deps = makeDeps({ titles: ['ArmStructures'], values: [HEADER] });
    await expect(
      appendArmStructureVersion('sheet-1', { ...INPUT, arms: [] }, deps),
    ).rejects.toThrow('少なくとも 1 つの arm が必要です');
    expect(deps.fetch).not.toHaveBeenCalled();
  });
});
