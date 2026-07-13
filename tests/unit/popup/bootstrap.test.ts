// Popup（S1）の状態仕様テスト（docs/ui-states.md §1 と 1:1 対応）
import { installChromeMock, type ChromeMock } from '../../setup/chrome-mock';
import {
  bootstrapPopup,
  createChromePopupDeps,
  type PopupDeps,
} from '../../../src/popup/bootstrap';
import { BUILD_DATE } from '../../../src/build-info';
import { CURRENT_SCHEMA_VERSION } from '../../../src/domain/project';
import { SHEET_HEADERS } from '../../../src/domain/sheetsSchema';
import {
  loadCurrentProject,
  setCurrentProject,
} from '../../../src/features/project/projectStore';
import type { GoogleApiDeps } from '../../../src/lib/google/types';
import { setUiLanguage } from '../../../src/lib/i18n';

const POPUP_TEMPLATE = `
  <main class="popup">
    <p id="popup-status">読み込み中…</p>
    <section id="popup-auth" hidden>
      <button id="login-button" type="button">Google でログイン</button>
      <p id="login-error"></p>
    </section>
    <div id="popup-projects" hidden>
      <span id="popup-email">—</span>
      <button id="logout-button" type="button">ログアウト</button>
      <section id="popup-recent-section" hidden>
        <ul id="popup-recent"></ul>
      </section>
      <form id="popup-create-form">
        <input type="text" id="popup-create-title" />
        <button type="submit">作成</button>
      </form>
      <p id="popup-create-error"></p>
      <form id="popup-open-form">
        <input type="text" id="popup-open-id" />
        <button type="submit">開く</button>
      </form>
      <p id="popup-open-error"></p>
    </div>
    <button id="open-options" type="button">設定を開く</button>
  </main>
`;

const flush = async (): Promise<void> => {
  // 長い promise チェーン（作成 → 保存 → タブを開く）を確実に消化する
  for (let i = 0; i < 5; i += 1) {
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
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

function makeDeps(over: Partial<PopupDeps> = {}): PopupDeps {
  return {
    openAppTab: jest.fn(),
    openOptions: jest.fn(),
    google: makeGoogle(),
    profile: {
      getProfileUserInfo: async () => ({ email: 'me@example.com', id: 'uid' }),
    },
    isAuthenticated: jest.fn(async () => true),
    signIn: jest.fn(async () => true),
    signOut: jest.fn(async () => undefined),
    ...over,
  };
}

function el<T extends HTMLElement>(id: string): T {
  return document.getElementById(id) as T;
}

describe('bootstrapPopup', () => {
  beforeEach(() => {
    installChromeMock();
    document.body.innerHTML = POPUP_TEMPLATE;
  });

  test('必須要素が欠けている場合は何もしない', async () => {
    document.body.innerHTML = '<p>壊れた DOM</p>';
    await expect(bootstrapPopup(document, makeDeps())).resolves.toBeUndefined();
  });

  test('アプリ名の下にビルド日を表示する', async () => {
    const buildDateEl = document.createElement('p');
    buildDateEl.id = 'popup-build-date';
    document.querySelector('.popup')?.prepend(buildDateEl);
    await bootstrapPopup(document, makeDeps({ isAuthenticated: jest.fn(async () => false) }));
    expect(el('popup-build-date').textContent).toBe(`build ${BUILD_DATE}`);
  });

  test('状態 A: 未ログインならログインセクションのみ表示', async () => {
    await bootstrapPopup(document, makeDeps({ isAuthenticated: jest.fn(async () => false) }));
    expect(el('popup-status').textContent).toBe('ログインが必要です。');
    expect(el('popup-auth').hidden).toBe(false);
    expect(el('popup-projects').hidden).toBe(true);
  });

  test('状態 C→B: ログイン成功で projects セクションへ切り替わる', async () => {
    const isAuthenticated = jest
      .fn<Promise<boolean>, []>()
      .mockResolvedValueOnce(false)
      .mockResolvedValue(true);
    const deps = makeDeps({ isAuthenticated });
    await bootstrapPopup(document, deps);
    el<HTMLButtonElement>('login-button').click();
    await flush();
    expect(deps.signIn).toHaveBeenCalledTimes(1);
    expect(el('popup-auth').hidden).toBe(true);
    expect(el('popup-projects').hidden).toBe(false);
    expect(el<HTMLButtonElement>('login-button').disabled).toBe(false);
  });

  test('状態 D: ログイン失敗でエラーメッセージ + ボタン復帰', async () => {
    const deps = makeDeps({
      isAuthenticated: jest.fn(async () => false),
      signIn: jest.fn(async () => false),
    });
    await bootstrapPopup(document, deps);
    el<HTMLButtonElement>('login-button').click();
    await flush();
    expect(el('login-error').textContent).toBe(
      'ログインに失敗しました。ブラウザに Google アカウントが追加されているか確認してください。',
    );
    expect(el<HTMLButtonElement>('login-button').disabled).toBe(false);
    expect(el('popup-auth').hidden).toBe(false);
  });

  test('状態 B-0: 最近 0 件では recent セクションを隠し、email を表示', async () => {
    await bootstrapPopup(document, makeDeps());
    expect(el('popup-status').textContent).toBe(
      '新しいプロジェクトを作成するか、スプレッドシート ID から開いてください。',
    );
    expect(el('popup-recent-section').hidden).toBe(true);
    expect(el('popup-email').textContent).toBe('me@example.com');
  });

  test('email が空なら (不明) を表示', async () => {
    const deps = makeDeps({
      profile: { getProfileUserInfo: async () => ({ email: '', id: '' }) },
    });
    await bootstrapPopup(document, deps);
    expect(el('popup-email').textContent).toBe('(不明)');
  });

  test('email 取得が throw しても (不明) を表示', async () => {
    const deps = makeDeps({
      profile: {
        getProfileUserInfo: async () => {
          throw new Error('no profile');
        },
      },
    });
    await bootstrapPopup(document, deps);
    expect(el('popup-email').textContent).toBe('(不明)');
  });

  test('状態 B-N: 最近のプロジェクトを新しい順に列挙し、クリックで選択 + メインビューを開く', async () => {
    await setCurrentProject({
      projectId: 'aaaaaaaa-1111',
      spreadsheetId: 's1',
      driveFolderId: 'f1',
      name: '肺炎 SR',
    });
    await setCurrentProject({
      projectId: 'bbbbbbbb-2222',
      spreadsheetId: 's2',
      driveFolderId: 'f2',
      name: 'ECMO SR',
    });
    const deps = makeDeps();
    await bootstrapPopup(document, deps);
    expect(el('popup-status').textContent).toBe(
      '最近のプロジェクトから選ぶか、新しく作成してください。',
    );
    expect(el('popup-recent-section').hidden).toBe(false);
    const buttons = el('popup-recent').querySelectorAll('button');
    expect(buttons).toHaveLength(2);
    expect(buttons[0]?.textContent).toBe('ECMO SR — bbbbbbbb');
    expect(buttons[1]?.textContent).toBe('肺炎 SR — aaaaaaaa');

    buttons[1]?.click();
    await flush();
    await expect(loadCurrentProject()).resolves.toMatchObject({ projectId: 'aaaaaaaa-1111' });
    expect(deps.openAppTab).toHaveBeenCalledTimes(1);
  });

  test('E-Popup-4: ログアウトで選択状態をクリアして未ログイン表示に戻る', async () => {
    await setCurrentProject({
      projectId: 'p1',
      spreadsheetId: 's1',
      driveFolderId: 'f1',
      name: 'SR',
    });
    const isAuthenticated = jest
      .fn<Promise<boolean>, []>()
      .mockResolvedValueOnce(true)
      .mockResolvedValue(false);
    let resolveSignOut: () => void = () => undefined;
    const signOut = jest.fn(
      () =>
        new Promise<void>((resolve) => {
          resolveSignOut = resolve;
        }),
    );
    const deps = makeDeps({ isAuthenticated, signOut });
    await bootstrapPopup(document, deps);
    el<HTMLButtonElement>('logout-button').click();
    // 処理中は再クリックを防ぐ
    expect(el<HTMLButtonElement>('logout-button').disabled).toBe(true);
    resolveSignOut();
    await flush();
    expect(el<HTMLButtonElement>('logout-button').disabled).toBe(false);
    expect(el('popup-auth').hidden).toBe(false);
    await expect(loadCurrentProject()).resolves.toBeNull();
  });

  test('「設定を開く」で openOptions を呼ぶ', async () => {
    const deps = makeDeps();
    await bootstrapPopup(document, deps);
    el('open-options').click();
    expect(deps.openOptions).toHaveBeenCalledTimes(1);
  });

  describe('新規作成フォーム', () => {
    test('E-Popup-1: 空タイトルはエラー表示のみでタブを開かない', async () => {
      const deps = makeDeps();
      await bootstrapPopup(document, deps);
      el<HTMLFormElement>('popup-create-form').dispatchEvent(
        new Event('submit', { cancelable: true }),
      );
      await flush();
      expect(el('popup-create-error').textContent).toBe('プロジェクトタイトルは必須です');
      expect(deps.openAppTab).not.toHaveBeenCalled();
    });

    test('作成中はボタンを無効化し、成功でメインビューを開く', async () => {
      const deps = makeDeps();
      await bootstrapPopup(document, deps);
      el<HTMLInputElement>('popup-create-title').value = '新規 SR';
      const submitBtn = document.querySelector(
        '#popup-create-form button[type="submit"]',
      ) as HTMLButtonElement;
      el<HTMLFormElement>('popup-create-form').dispatchEvent(
        new Event('submit', { cancelable: true }),
      );
      // 送信直後（同期）に作成中表示へ切り替わる
      expect(submitBtn.disabled).toBe(true);
      expect(submitBtn.textContent).toBe('作成中…');
      await flush();
      expect(submitBtn.disabled).toBe(false);
      expect(submitBtn.textContent).toBe('作成');
      expect(el<HTMLInputElement>('popup-create-title').value).toBe('');
      expect(deps.openAppTab).toHaveBeenCalledTimes(1);
      await expect(loadCurrentProject()).resolves.toMatchObject({ name: '新規 SR' });
    });
  });

  describe('スプレッドシート ID で開くフォーム', () => {
    test('検証を通ると currentProject を更新してメインビューを開く', async () => {
      const deps = makeDeps();
      await bootstrapPopup(document, deps);
      el<HTMLInputElement>('popup-open-id').value = 'SID-9';
      el<HTMLFormElement>('popup-open-form').dispatchEvent(
        new Event('submit', { cancelable: true }),
      );
      await flush();
      expect(el('popup-open-error').textContent).toBe('');
      expect(el<HTMLInputElement>('popup-open-id').value).toBe('');
      expect(deps.openAppTab).toHaveBeenCalledTimes(1);
      await expect(loadCurrentProject()).resolves.toMatchObject({ name: '既存 SR' });
    });

    test('E-Popup-2: 検証エラーはメッセージ表示のみでタブを開かない', async () => {
      // Documents / SchemaFields タブが無い別ツールのシートを想定
      const google: GoogleApiDeps = {
        getAccessToken: async () => 'tok',
        fetch: (async () => {
          const json = { sheets: [{ properties: { title: 'Meta' } }] };
          return {
            ok: true,
            status: 200,
            json: async () => json,
            text: async () => JSON.stringify(json),
          } as Response;
        }) as typeof fetch,
      };
      const deps = makeDeps({ google });
      await bootstrapPopup(document, deps);
      el<HTMLInputElement>('popup-open-id').value = 'OTHER-SID';
      el<HTMLFormElement>('popup-open-form').dispatchEvent(
        new Event('submit', { cancelable: true }),
      );
      await flush();
      expect(el('popup-open-error').textContent).toContain(
        'sr-data-extraction のプロジェクトではありません',
      );
      expect(deps.openAppTab).not.toHaveBeenCalled();
    });

    test('Error 以外の reject も文字列化して表示する', async () => {
      const google: GoogleApiDeps = {
        getAccessToken: async () => 'tok',
        // eslint-disable-next-line prefer-promise-reject-errors
        fetch: (async () => Promise.reject('boom')) as typeof fetch,
      };
      const deps = makeDeps({ google });
      await bootstrapPopup(document, deps);
      el<HTMLInputElement>('popup-open-id').value = 'SID';
      el<HTMLFormElement>('popup-open-form').dispatchEvent(
        new Event('submit', { cancelable: true }),
      );
      await flush();
      expect(el('popup-open-error').textContent).toBe('boom');
    });
  });
});

describe('createChromePopupDeps', () => {
  let chromeMock: ChromeMock;

  beforeEach(() => {
    chromeMock = installChromeMock();
  });

  test('openAppTab / openOptions とも同一タブでメインビューへ遷移する（別タブを開かない）', () => {
    const deps = createChromePopupDeps();
    deps.openAppTab();
    expect(chromeMock.tabs.update).toHaveBeenCalledWith({
      url: 'chrome-extension://test-extension-id/app/app.html',
    });
    deps.openOptions();
    // 設定はアプリ内 #/options へ同一タブ遷移（tabs.create を使わない）
    expect(chromeMock.tabs.update).toHaveBeenCalledWith({
      url: 'chrome-extension://test-extension-id/app/app.html#/options',
    });
    expect(chromeMock.tabs.create).not.toHaveBeenCalled();
  });

  test('isAuthenticated: トークン取得成功で true（interactive=false）', async () => {
    const deps = createChromePopupDeps();
    await expect(deps.isAuthenticated()).resolves.toBe(true);
    expect(chromeMock.identity.getAuthToken).toHaveBeenCalledWith(
      { interactive: false },
      expect.any(Function),
    );
  });

  test('isAuthenticated: 失敗で false', async () => {
    chromeMock.identity.getAuthToken.mockImplementation(
      (_opts: unknown, cb: (token?: string) => void) => {
        cb(undefined);
      },
    );
    const deps = createChromePopupDeps();
    await expect(deps.isAuthenticated()).resolves.toBe(false);
  });

  test('signIn: 成功で true（interactive=true）/ 失敗で false', async () => {
    const deps = createChromePopupDeps();
    await expect(deps.signIn()).resolves.toBe(true);
    expect(chromeMock.identity.getAuthToken).toHaveBeenCalledWith(
      { interactive: true },
      expect.any(Function),
    );
    chromeMock.identity.getAuthToken.mockImplementation(
      (_opts: unknown, cb: (token?: string) => void) => {
        cb(undefined);
      },
    );
    await expect(deps.signIn()).resolves.toBe(false);
  });

  test('signOut: 取得済みトークンをキャッシュから除去する', async () => {
    const deps = createChromePopupDeps();
    await deps.signOut();
    expect(chromeMock.identity.removeCachedAuthToken).toHaveBeenCalledWith(
      { token: 'mock-token' },
      expect.any(Function),
    );
  });

  test('signOut: トークンが無ければ何もしない', async () => {
    chromeMock.identity.getAuthToken.mockImplementation(
      (_opts: unknown, cb: (token?: string) => void) => {
        cb(undefined);
      },
    );
    const deps = createChromePopupDeps();
    await expect(deps.signOut()).resolves.toBeUndefined();
    expect(chromeMock.identity.removeCachedAuthToken).not.toHaveBeenCalled();
  });

  test('google.getAccessToken は interactive=true でトークンを返す', async () => {
    const deps = createChromePopupDeps();
    await expect(deps.google.getAccessToken()).resolves.toBe('mock-token');
  });
});

describe('bootstrapPopup（表示言語 en。issue #93）', () => {
  // data-i18n 系属性を持つテンプレート（popup.html の該当部分と同じ構成）
  const POPUP_TEMPLATE_I18N = `
    <main class="popup">
      <p id="popup-status" data-i18n="popup.loading">読み込み中…</p>
      <section id="popup-auth" hidden>
        <button id="login-button" type="button" data-i18n="popup.login">Google でログイン</button>
        <p id="login-error"></p>
      </section>
      <div id="popup-projects" hidden>
        <span data-i18n="popup.loggedInAs">ログイン中:</span>
        <span id="popup-email">—</span>
        <button id="logout-button" type="button" data-i18n="popup.logout">ログアウト</button>
        <section id="popup-recent-section" hidden>
          <ul id="popup-recent"></ul>
        </section>
        <form id="popup-create-form">
          <input
            type="text"
            id="popup-create-title"
            placeholder="プロジェクトタイトル"
            data-i18n-placeholder="popup.createTitleLabel"
          />
          <button type="submit" data-i18n="popup.createSubmit">作成</button>
        </form>
        <p id="popup-create-error"></p>
        <form id="popup-open-form">
          <input type="text" id="popup-open-id" />
          <button type="submit">開く</button>
        </form>
        <p id="popup-open-error"></p>
      </div>
      <button id="open-options" type="button" data-i18n="popup.openOptions">設定を開く</button>
    </main>
  `;

  beforeEach(() => {
    const chromeMock = installChromeMock();
    chromeMock.storage.local.data['settings.uiLanguage'] = 'en';
    document.body.innerHTML = POPUP_TEMPLATE_I18N;
    document.documentElement.lang = 'ja';
  });

  afterEach(() => {
    setUiLanguage('ja');
  });

  test('保存済み言語（en）で静的文言と <html lang> を解決する', async () => {
    await bootstrapPopup(document, makeDeps({ isAuthenticated: jest.fn(async () => false) }));
    expect(document.documentElement.lang).toBe('en');
    expect(el('login-button').textContent).toBe('Sign in with Google');
    expect(el('open-options').textContent).toBe('Open settings');
    expect(el<HTMLInputElement>('popup-create-title').placeholder).toBe('Project title');
    // 動的ステータスも en
    expect(el('popup-status').textContent).toBe('Sign-in required.');
  });

  test('ログイン済みステータス・失敗文言も en で表示する', async () => {
    const deps = makeDeps({
      isAuthenticated: jest.fn(async () => true),
      profile: { getProfileUserInfo: async () => ({ email: '', id: '' }) },
    });
    await bootstrapPopup(document, deps);
    expect(el('popup-status').textContent).toBe(
      'Create a new project or open one from a spreadsheet ID.',
    );
    expect(el('popup-email').textContent).toBe('(unknown)');
  });

  test('ログイン失敗の文言は en で表示する', async () => {
    const deps = makeDeps({
      isAuthenticated: jest.fn(async () => false),
      signIn: jest.fn(async () => false),
    });
    await bootstrapPopup(document, deps);
    el<HTMLButtonElement>('login-button').click();
    await flush();
    expect(el('login-error').textContent).toBe(
      'Sign-in failed. Make sure a Google account is added to your browser.',
    );
  });
});
