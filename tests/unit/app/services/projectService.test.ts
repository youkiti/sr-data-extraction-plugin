import { installChromeMock } from '../../../setup/chrome-mock';
import {
  createNewProject,
  extractSpreadsheetId,
  loadExistingProject,
} from '../../../../src/app/services/projectService';
import { CURRENT_SCHEMA_VERSION } from '../../../../src/domain/project';
import { SHEET_HEADERS } from '../../../../src/domain/sheetsSchema';
import {
  loadCurrentProject,
  loadRecentProjects,
} from '../../../../src/features/project/projectStore';
import type { GoogleApiDeps } from '../../../../src/lib/google/types';
import type { ProfileDeps } from '../../../../src/lib/google/identity';

const profile: ProfileDeps = {
  getProfileUserInfo: async () => ({ email: 'me@example.com', id: 'uid' }),
};

/** createProject / loadProjectMeta が発行する全 API に応答する寛容なスタブ */
function makeGoogle(): GoogleApiDeps {
  return {
    getAccessToken: async () => 'tok',
    fetch: (async (input: RequestInfo | URL) => {
      const url = String(input);
      let json: unknown = {};
      if (url.includes('?fields=sheets.properties.title')) {
        json = {
          sheets: ['Meta', 'Documents', 'SchemaFields'].map((title) => ({
            properties: { title },
          })),
        };
      } else if (url.endsWith('/values/Meta')) {
        json = {
          values: [
            [...SHEET_HEADERS.Meta],
            ['pid-9', '既存 SR', 'SID-9', 'FOLDER-9', CURRENT_SCHEMA_VERSION, 't', 'me'],
          ],
        };
      } else if (url === 'https://sheets.googleapis.com/v4/spreadsheets') {
        json = { spreadsheetId: 'NEW-SID', spreadsheetUrl: 'https://sheets/NEW-SID' };
      } else if (url.startsWith('https://www.googleapis.com/drive/v3/files')) {
        json = { id: 'FOLDER-NEW', webViewLink: 'https://drive/new', files: [] };
      }
      return {
        ok: true,
        status: 200,
        json: async () => json,
        text: async () => JSON.stringify(json),
      } as Response;
    }) as typeof fetch,
  };
}

describe('createNewProject', () => {
  beforeEach(() => {
    installChromeMock();
  });

  test('空タイトルは reject し、何も保存しない', async () => {
    await expect(
      createNewProject('   ', { google: makeGoogle(), profile }),
    ).rejects.toThrow('プロジェクトタイトルは必須です');
    await expect(loadCurrentProject()).resolves.toBeNull();
  });

  test('作成に成功すると currentProject / recentProjects に登録される', async () => {
    const ref = await createNewProject('  新規 SR  ', { google: makeGoogle(), profile });
    expect(ref).toMatchObject({
      spreadsheetId: 'NEW-SID',
      driveFolderId: 'FOLDER-NEW',
      name: '新規 SR',
    });
    await expect(loadCurrentProject()).resolves.toEqual(ref);
    await expect(loadRecentProjects()).resolves.toEqual([ref]);
  });

  test('メールが取得できないときは createdBy を空文字にして進む', async () => {
    const noEmail: ProfileDeps = {
      getProfileUserInfo: async () => ({ email: '', id: '' }),
    };
    const ref = await createNewProject('SR', { google: makeGoogle(), profile: noEmail });
    expect(ref.name).toBe('SR');
  });
});

describe('loadExistingProject', () => {
  beforeEach(() => {
    installChromeMock();
  });

  test('空 ID は reject する', async () => {
    await expect(
      loadExistingProject('  ', { google: makeGoogle(), profile }),
    ).rejects.toThrow('スプレッドシート ID は必須です');
  });

  test('Meta タブ検証を通れば currentProject に登録される', async () => {
    const ref = await loadExistingProject(' SID-9 ', { google: makeGoogle(), profile });
    expect(ref).toEqual({
      projectId: 'pid-9',
      spreadsheetId: 'SID-9',
      driveFolderId: 'FOLDER-9',
      name: '既存 SR',
    });
    await expect(loadCurrentProject()).resolves.toEqual(ref);
  });

  test('スプレッドシート URL を貼っても ID を抽出して開ける', async () => {
    const ref = await loadExistingProject(
      'https://docs.google.com/spreadsheets/d/SID-9/edit#gid=0',
      { google: makeGoogle(), profile },
    );
    expect(ref.spreadsheetId).toBe('SID-9');
  });
});

describe('extractSpreadsheetId', () => {
  test('スプレッドシート URL から ID を抽出する', () => {
    expect(extractSpreadsheetId('https://docs.google.com/spreadsheets/d/1AbC-_9/edit')).toBe(
      '1AbC-_9',
    );
  });

  test('/edit#gid やクエリ付き URL でも ID だけを取り出す', () => {
    expect(
      extractSpreadsheetId('https://docs.google.com/spreadsheets/d/1AbC-_9/edit#gid=123'),
    ).toBe('1AbC-_9');
    expect(
      extractSpreadsheetId('https://docs.google.com/spreadsheets/d/1AbC-_9/edit?usp=sharing'),
    ).toBe('1AbC-_9');
  });

  test('ID 直打ちは前後空白を除いてそのまま返す', () => {
    expect(extractSpreadsheetId('  1AbC-_9  ')).toBe('1AbC-_9');
  });

  test('/spreadsheets/d/ を含まない文字列はそのまま（trim のみ）返す', () => {
    expect(extractSpreadsheetId(' not-a-url ')).toBe('not-a-url');
  });
});
