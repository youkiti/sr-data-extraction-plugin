import { createProject } from '../../../../src/features/project/createProject';
import { CURRENT_SCHEMA_VERSION } from '../../../../src/domain/project';
import { SHEET_TABS } from '../../../../src/domain/sheetsSchema';
import type { GoogleApiDeps } from '../../../../src/lib/google/types';

/**
 * fetch を URL パターンで振り分ける Google API スタブ。
 * 呼び出し履歴（URL / body）をテストから検査できるようにする。
 */
function makeGoogleStub(): { deps: GoogleApiDeps; calls: { url: string; body?: string }[] } {
  const calls: { url: string; body?: string }[] = [];
  let folderSeq = 0;
  const deps: GoogleApiDeps = {
    getAccessToken: async () => 'tok',
    fetch: (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      calls.push({ url, body: init?.body as string | undefined });
      let json: unknown = {};
      if (url.startsWith('https://www.googleapis.com/drive/v3/files?fields=')) {
        folderSeq += 1;
        json = { id: `folder-${folderSeq}`, webViewLink: `https://drive/f${folderSeq}` };
      } else if (url === 'https://sheets.googleapis.com/v4/spreadsheets') {
        json = { spreadsheetId: 'SID', spreadsheetUrl: 'https://sheets/SID' };
      }
      return {
        ok: true,
        status: 200,
        json: async () => json,
        text: async () => JSON.stringify(json),
      } as Response;
    }) as typeof fetch,
  };
  return { deps, calls };
}

const helpers = {
  ensureRootFolder: async () => 'ROOT',
  newUuid: () => '12345678-abcd-4000-8000-000000000000',
  now: () => '2026-07-02T00:00:00.000Z',
};

describe('createProject', () => {
  test('Drive フォルダ 4 種 + 13 タブのスプレッドシート + Meta 行を生成する', async () => {
    const { deps, calls } = makeGoogleStub();
    const result = await createProject(
      { projectTitle: '肺炎 SR', createdBy: 'me@example.com' },
      deps,
      helpers,
    );

    // トップフォルダ名は {title}_{uuid 先頭 8 文字}、親は ensureRootFolder の結果
    const folderCalls = calls.filter((c) =>
      c.url.startsWith('https://www.googleapis.com/drive/v3/files?fields='),
    );
    const folderBodies = folderCalls.map((c) => JSON.parse(c.body ?? '{}'));
    expect(folderBodies[0]).toMatchObject({ name: '肺炎 SR_12345678', parents: ['ROOT'] });
    expect(folderBodies.map((b) => b.name)).toEqual([
      '肺炎 SR_12345678',
      'documents',
      'extracted_texts',
      'raw_protocols',
      'logs',
      'llm',
    ]);
    // documents〜logs はトップフォルダ直下、llm は logs 配下
    expect(folderBodies[1].parents).toEqual(['folder-1']);
    expect(folderBodies[4].parents).toEqual(['folder-1']);
    expect(folderBodies[5].parents).toEqual(['folder-5']);

    // スプレッドシートは 13 タブで初期化
    const createSheet = calls.find((c) => c.url === 'https://sheets.googleapis.com/v4/spreadsheets');
    const sheetBody = JSON.parse(createSheet?.body ?? '{}');
    expect(sheetBody.properties.title).toBe('肺炎 SR');
    expect(sheetBody.sheets.map((s: { properties: { title: string } }) => s.properties.title)).toEqual(
      [...SHEET_TABS],
    );

    // 13 タブすべてにヘッダ行を書き込む（:append は追記なので除外）
    const headerCalls = calls.filter(
      (c) => c.url.includes('?valueInputOption=RAW') && !c.url.includes(':append'),
    );
    expect(headerCalls).toHaveLength(SHEET_TABS.length);

    // スプレッドシートをプロジェクトフォルダ配下へ移動（addParents に トップフォルダ ID）
    const moveCall = calls.find((c) => c.url.includes('addParents='));
    expect(moveCall?.url).toContain('/drive/v3/files/SID?');
    expect(decodeURIComponent(moveCall?.url ?? '')).toContain('addParents=folder-1');

    // Meta タブへ 1 行追記
    const appendCall = calls.find((c) => c.url.includes(':append'));
    expect(appendCall?.url).toContain('/values/Meta!A1:append');
    const appendBody = JSON.parse(appendCall?.body ?? '{}');
    expect(appendBody.values).toEqual([
      [
        '12345678-abcd-4000-8000-000000000000',
        '肺炎 SR',
        'SID',
        'folder-1',
        CURRENT_SCHEMA_VERSION,
        '2026-07-02T00:00:00.000Z',
        'me@example.com',
      ],
    ]);

    expect(result.meta).toEqual({
      projectId: '12345678-abcd-4000-8000-000000000000',
      projectTitle: '肺炎 SR',
      spreadsheetId: 'SID',
      driveFolderId: 'folder-1',
      schemaVersion: CURRENT_SCHEMA_VERSION,
      createdAt: '2026-07-02T00:00:00.000Z',
      createdBy: 'me@example.com',
    });
    expect(result.subfolders).toEqual({
      documents: { id: 'folder-2', webViewLink: 'https://drive/f2' },
      extractedTexts: { id: 'folder-3', webViewLink: 'https://drive/f3' },
      rawProtocols: { id: 'folder-4', webViewLink: 'https://drive/f4' },
      logsLlm: { id: 'folder-6', webViewLink: 'https://drive/f6' },
    });
  });

  test('helpers 未指定でも既定実装（ルートフォルダ検索 + UUID + 現在時刻）で動く', async () => {
    const { deps, calls } = makeGoogleStub();
    const result = await createProject(
      { projectTitle: 'P', createdBy: '' },
      deps,
    );
    // 既定の ensureRootFolder は My Drive 直下を検索する GET を発行する
    const searchCall = calls[0];
    expect(decodeURIComponent(searchCall?.url ?? '')).toContain("name='SR Data Extraction'");
    // ルートフォルダの新規作成はアイコン色付き
    const rootCreate = calls.find((c) => {
      if (!c.body) return false;
      return (JSON.parse(c.body) as { name?: string }).name === 'SR Data Extraction';
    });
    expect(JSON.parse(rootCreate?.body ?? '{}').folderColorRgb).toBe('#e9318f');
    // 既定の newUuid / now が使われる（形式のみ検証）
    expect(result.meta.projectId).toMatch(/^[0-9a-f-]{36}$/);
    expect(result.meta.createdAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });
});
