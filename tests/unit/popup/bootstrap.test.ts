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
import { loadTiabHandoff } from '../../../src/features/project/tiabHandoffStore';
import { PICKER_PAGE_URL, type PickerSelection } from '../../../src/lib/google/picker';
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
      <p id="popup-account-note" hidden></p>
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
      <button id="popup-open-grant" type="button" hidden>Google で許可する</button>
      <button id="tiab-pick" type="button">tiab-review のシートを選ぶ</button>
      <form id="tiab-create-form" hidden>
        <input type="text" id="tiab-project-title" />
        <button type="submit" id="tiab-create-submit">作成して続行</button>
      </form>
      <p id="tiab-status"></p>
      <p id="tiab-error"></p>
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
    chromeProfileEmail: jest.fn(async () => 'me@example.com'),
    openSpreadsheetPicker: jest.fn(async () => 'cancelled' as const),
    openTiabSheetPicker: jest.fn(async () => null),
    sleep: jest.fn(async () => undefined),
    isAuthenticated: jest.fn(async () => true),
    signIn: jest.fn(async () => true),
    signOut: jest.fn(async () => undefined),
    ...over,
  };
}

function el<T extends HTMLElement>(id: string): T {
  return document.getElementById(id) as T;
}

const TIAB_REF_HEADER = ['ref_id', 'title', 'abstract', 'year', 'authors', 'doi', 'pmid', 'fulltext_url'];
const TIAB_DEC_HEADER = [
  'decision_id',
  'ref_id',
  'reviewer_id',
  'decision',
  'reason',
  'labels',
  'note',
  'decided_at',
  'client_version',
  'source_url',
  'screening_phase',
];

/**
 * readTiabSheet（References / Decisions の values:batchGet + Config の GET）に応答する
 * google スタブ。include 判定の文献を includeCount 件生成する。それ以外の URL
 *（createNewProject が発行する Sheets / Drive API 群）は makeGoogle() の寛容な既定応答へ
 * フォールバックする
 */
function makeTiabGoogle(options: { includeCount?: number } = {}): GoogleApiDeps {
  const base = makeGoogle();
  const references = Array.from({ length: options.includeCount ?? 2 }, (_, i) => [
    `r${i}`,
    `Title ${i}`,
    '',
    '2020',
    `Author${i}`,
    '',
    '',
    '',
  ]);
  const decisions = references.map((row) => [
    `d-${row[0]}`,
    row[0] as string,
    'reviewer@example.com',
    'include',
    '',
    '',
    '',
    't1',
    '',
    '',
    '',
  ]);
  return {
    getAccessToken: async () => 'tok',
    fetch: (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.includes('values:batchGet')) {
        const json = {
          valueRanges: [
            { values: [TIAB_REF_HEADER, ...references] },
            { values: [TIAB_DEC_HEADER, ...decisions] },
          ],
        };
        return {
          ok: true,
          status: 200,
          json: async () => json,
          text: async () => JSON.stringify(json),
        } as Response;
      }
      if (url.includes('/values/Config')) {
        const json = { values: [] };
        return {
          ok: true,
          status: 200,
          json: async () => json,
          text: async () => JSON.stringify(json),
        } as Response;
      }
      return (base.fetch as typeof fetch)(input, init);
    }) as typeof fetch,
  };
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

  test('ヘッダーのアプリ名とタブタイトルに dev サフィックスを付ける（jest は dev ビルド相当）', async () => {
    const titleEl = document.createElement('h1');
    titleEl.className = 'popup__title';
    titleEl.textContent = 'SR Data Extraction Plugin';
    document.querySelector('.popup')?.prepend(titleEl);
    document.title = 'SR Data Extraction Plugin';
    await bootstrapPopup(document, makeDeps({ isAuthenticated: jest.fn(async () => false) }));
    expect(titleEl.textContent).toBe('SR Data Extraction Plugin (dev)');
    expect(document.title).toBe('SR Data Extraction Plugin (dev)');
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

  describe('アカウント不一致表示（issue #129: launchWebAuthFlow は別アカウントを選べる）', () => {
    test('OAuth アカウントとプロファイルが一致すれば注意書きは出さない', async () => {
      await bootstrapPopup(document, makeDeps());
      expect(el('popup-account-note').hidden).toBe(true);
      expect(el('popup-account-note').textContent).toBe('');
    });

    test('不一致ならプロファイルのメール入りの注意書きを表示する', async () => {
      const deps = makeDeps({
        chromeProfileEmail: jest.fn(async () => 'profile@example.com'),
      });
      await bootstrapPopup(document, deps);
      expect(el('popup-account-note').hidden).toBe(false);
      expect(el('popup-account-note').textContent).toContain('profile@example.com');
      expect(el('popup-account-note').textContent).toContain('別のアカウント');
    });

    test('プロファイルのメールが取れない（null）場合は表示しない', async () => {
      const deps = makeDeps({ chromeProfileEmail: jest.fn(async () => null) });
      await bootstrapPopup(document, deps);
      expect(el('popup-account-note').hidden).toBe(true);
    });

    test('プロファイル取得が throw しても表示せず落ちない', async () => {
      const deps = makeDeps({
        chromeProfileEmail: jest.fn(async () => {
          throw new Error('identity unavailable');
        }),
      });
      await bootstrapPopup(document, deps);
      expect(el('popup-account-note').hidden).toBe(true);
      expect(el('popup-email').textContent).toBe('me@example.com');
    });

    test('OAuth メールが取れない場合は比較自体を行わない', async () => {
      const chromeProfileEmail = jest.fn(async () => 'profile@example.com');
      const deps = makeDeps({
        profile: { getProfileUserInfo: async () => ({ email: '', id: '' }) },
        chromeProfileEmail,
      });
      await bootstrapPopup(document, deps);
      expect(chromeProfileEmail).not.toHaveBeenCalled();
      expect(el('popup-account-note').hidden).toBe(true);
    });
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

  describe('アクセス許可が必要（issue #130。docs/ui-states.md §1）', () => {
    /** アクセス拒否状態を切り替えられる google スタブ（denied 中は全 API 404） */
    function makeDeniedGoogle(state: { denied: boolean }): GoogleApiDeps {
      const okGoogle = makeGoogle();
      return {
        getAccessToken: async () => 'tok',
        fetch: (async (input: RequestInfo | URL, init?: RequestInit) => {
          if (state.denied) {
            return {
              ok: false,
              status: 404,
              json: async () => ({}),
              text: async () => 'not found',
            } as Response;
          }
          return (okGoogle.fetch as typeof fetch)(input, init);
        }) as typeof fetch,
      };
    }

    async function submitOpen(id: string): Promise<void> {
      el<HTMLInputElement>('popup-open-id').value = id;
      el<HTMLFormElement>('popup-open-form').dispatchEvent(
        new Event('submit', { cancelable: true }),
      );
      await flush();
    }

    test('アクセス拒否で案内文 + 「Google で許可する」を表示する', async () => {
      const deps = makeDeps({ google: makeDeniedGoogle({ denied: true }) });
      await bootstrapPopup(document, deps);
      await submitOpen('SID-9');
      expect(el('popup-open-error').textContent).toContain('権限がまだありません');
      expect(el<HTMLButtonElement>('popup-open-grant').hidden).toBe(false);
      expect(deps.openAppTab).not.toHaveBeenCalled();
    });

    test('通常の検証エラーでは許可ボタンを出さない', async () => {
      const deps = makeDeps(); // makeGoogle は正常応答（既存 SR が開ける）
      await bootstrapPopup(document, deps);
      await submitOpen('SID-9');
      expect(el<HTMLButtonElement>('popup-open-grant').hidden).toBe(true);
    });

    test('granted → 開き直しに成功したらメインビューへ遷移し表示をリセットする', async () => {
      const state = { denied: true };
      const openSpreadsheetPicker = jest.fn(async () => {
        state.denied = false; // Picker の許可で以後アクセス可能になる
        return 'granted' as const;
      });
      const deps = makeDeps({ google: makeDeniedGoogle(state), openSpreadsheetPicker });
      await bootstrapPopup(document, deps);
      await submitOpen('SID-9');
      el<HTMLButtonElement>('popup-open-grant').click();
      await flush();
      expect(openSpreadsheetPicker).toHaveBeenCalledWith('SID-9');
      expect(deps.openAppTab).toHaveBeenCalledTimes(1);
      expect(el('popup-open-error').textContent).toBe('');
      expect(el<HTMLButtonElement>('popup-open-grant').hidden).toBe(true);
      expect(el<HTMLInputElement>('popup-open-id').value).toBe('');
    });

    test('処理中はボタンを無効化し「許可を待っています…」を表示、再クリックは無視する', async () => {
      let release: (r: 'cancelled') => void = () => undefined;
      const openSpreadsheetPicker = jest.fn(
        () => new Promise<'cancelled'>((resolve) => { release = resolve; }),
      );
      const deps = makeDeps({ google: makeDeniedGoogle({ denied: true }), openSpreadsheetPicker });
      await bootstrapPopup(document, deps);
      await submitOpen('SID-9');
      const grant = el<HTMLButtonElement>('popup-open-grant');
      grant.click();
      expect(grant.disabled).toBe(true);
      expect(grant.textContent).toBe('許可を待っています…');
      // disabled 中の再クリック（dispatchEvent はネイティブの disabled 抑止を通らない）
      grant.dispatchEvent(new MouseEvent('click'));
      expect(openSpreadsheetPicker).toHaveBeenCalledTimes(1);
      release('cancelled');
      await flush();
      expect(grant.disabled).toBe(false);
      expect(grant.textContent).toBe('Google で許可する');
    });

    test('granted でもアクセス拒否が続いたら 3 回で打ち切り、最終文言 + ボタン非表示（再誘導しない）', async () => {
      const openSpreadsheetPicker = jest.fn(async () => 'granted' as const);
      const sleep = jest.fn(async () => undefined);
      const deps = makeDeps({
        google: makeDeniedGoogle({ denied: true }),
        openSpreadsheetPicker,
        sleep,
      });
      await bootstrapPopup(document, deps);
      await submitOpen('SID-9');
      el<HTMLButtonElement>('popup-open-grant').click();
      await flush();
      expect(sleep).toHaveBeenCalledTimes(2);
      expect(sleep).toHaveBeenCalledWith(2_000);
      expect(el('popup-open-error').textContent).toContain('許可後もアクセスできませんでした');
      expect(el<HTMLButtonElement>('popup-open-grant').hidden).toBe(true);
      expect(deps.openAppTab).not.toHaveBeenCalled();
    });

    test('mismatch は専用文言を表示し、ボタンは残す', async () => {
      const deps = makeDeps({
        google: makeDeniedGoogle({ denied: true }),
        openSpreadsheetPicker: jest.fn(async () => 'mismatch' as const),
      });
      await bootstrapPopup(document, deps);
      await submitOpen('SID-9');
      el<HTMLButtonElement>('popup-open-grant').click();
      await flush();
      expect(el('popup-open-error').textContent).toContain('入力された ID と異なります');
      expect(el<HTMLButtonElement>('popup-open-grant').hidden).toBe(false);
    });

    test('cancelled は案内文とボタンをそのまま残す', async () => {
      const deps = makeDeps({ google: makeDeniedGoogle({ denied: true }) });
      await bootstrapPopup(document, deps);
      await submitOpen('SID-9');
      el<HTMLButtonElement>('popup-open-grant').click();
      await flush();
      expect(el('popup-open-error').textContent).toContain('権限がまだありません');
      expect(el<HTMLButtonElement>('popup-open-grant').hidden).toBe(false);
    });

    test('Picker 自体の失敗はエラーメッセージを表示する', async () => {
      const deps = makeDeps({
        google: makeDeniedGoogle({ denied: true }),
        openSpreadsheetPicker: jest.fn(async () => {
          throw new Error('Picker タブの作成に失敗しました');
        }),
      });
      await bootstrapPopup(document, deps);
      await submitOpen('SID-9');
      el<HTMLButtonElement>('popup-open-grant').click();
      await flush();
      expect(el('popup-open-error').textContent).toContain('Picker タブの作成に失敗しました');
    });

    test('granted 後にアクセス以外の検証エラーなら通常エラー表示 + ボタン非表示', async () => {
      // 許可は通ったが、開いた先が別ツールのシート（Documents / SchemaFields 欠落）だったケース
      const state = { denied: true };
      const okButWrong: GoogleApiDeps = {
        getAccessToken: async () => 'tok',
        fetch: (async () => {
          if (state.denied) {
            return {
              ok: false,
              status: 404,
              json: async () => ({}),
              text: async () => 'not found',
            } as Response;
          }
          const json = { sheets: [{ properties: { title: 'Meta' } }] };
          return {
            ok: true,
            status: 200,
            json: async () => json,
            text: async () => JSON.stringify(json),
          } as Response;
        }) as typeof fetch,
      };
      const deps = makeDeps({
        google: okButWrong,
        openSpreadsheetPicker: jest.fn(async () => {
          state.denied = false;
          return 'granted' as const;
        }),
      });
      await bootstrapPopup(document, deps);
      await submitOpen('SID-9');
      el<HTMLButtonElement>('popup-open-grant').click();
      await flush();
      expect(el('popup-open-error').textContent).toContain(
        'sr-data-extraction のプロジェクトではありません',
      );
      expect(el<HTMLButtonElement>('popup-open-grant').hidden).toBe(true);
    });

    test('フォーム再送で許可ボタンと対象 ID をリセットする', async () => {
      const state = { denied: true };
      const openSpreadsheetPicker = jest.fn(async () => 'cancelled' as const);
      const deps = makeDeps({ google: makeDeniedGoogle(state), openSpreadsheetPicker });
      await bootstrapPopup(document, deps);
      await submitOpen('SID-9');
      expect(el<HTMLButtonElement>('popup-open-grant').hidden).toBe(false);
      // 再送（成功ケース）でボタンが隠れ、以後クリックしても何も起きない
      state.denied = false;
      await submitOpen('SID-9');
      expect(el<HTMLButtonElement>('popup-open-grant').hidden).toBe(true);
      el<HTMLButtonElement>('popup-open-grant').click();
      await flush();
      expect(openSpreadsheetPicker).not.toHaveBeenCalled();
    });

    test('許可対象が未設定のままクリックしても何もしない', async () => {
      const openSpreadsheetPicker = jest.fn(async () => 'cancelled' as const);
      const deps = makeDeps({ openSpreadsheetPicker });
      await bootstrapPopup(document, deps);
      el<HTMLButtonElement>('popup-open-grant').click();
      await flush();
      expect(openSpreadsheetPicker).not.toHaveBeenCalled();
    });
  });

  describe('tiab-review から引き継いで作成（docs/ui-states.md §1 #popup-tiab-handoff）', () => {
    const SELECTION: PickerSelection = { sourceFileId: 'TIAB-SID', filename: 'tiab-review 対象' };

    test('状態 A→B→A: キャンセルで元の表示に戻る', async () => {
      const openTiabSheetPicker = jest.fn(async () => null);
      const deps = makeDeps({ openTiabSheetPicker });
      await bootstrapPopup(document, deps);
      el<HTMLButtonElement>('tiab-pick').click();
      // 状態 B（同期）: ボタン disabled + Picker 案内文
      expect(el<HTMLButtonElement>('tiab-pick').disabled).toBe(true);
      expect(el('tiab-status').textContent).toBe('Picker でシートを選んでください…');
      await flush();
      // キャンセル: 状態 A へ戻る
      expect(el<HTMLButtonElement>('tiab-pick').disabled).toBe(false);
      expect(el('tiab-status').textContent).toBe('');
      expect(el<HTMLFormElement>('tiab-create-form').hidden).toBe(true);
      expect(el('tiab-error').textContent).toBe('');
    });

    test('状態 C→D: 検証成功でフォーム表示・タイトル既定値・件数文言', async () => {
      const openTiabSheetPicker = jest.fn(async () => SELECTION);
      const deps = makeDeps({
        openTiabSheetPicker,
        google: makeTiabGoogle({ includeCount: 3 }),
      });
      await bootstrapPopup(document, deps);
      el<HTMLButtonElement>('tiab-pick').click();
      await flush();
      expect(el<HTMLFormElement>('tiab-create-form').hidden).toBe(false);
      expect(el<HTMLInputElement>('tiab-project-title').value).toBe('tiab-review 対象');
      expect(el('tiab-status').textContent).toBe(
        'include 3 件を検出しました。プロジェクト名を確認して作成してください。',
      );
      expect(el('tiab-error').textContent).toBe('');
      expect(el<HTMLButtonElement>('tiab-pick').disabled).toBe(false);
    });

    test('状態 C（検証失敗）: tiab-review のシートでない場合はエラー表示 + 状態 A へ戻る', async () => {
      const openTiabSheetPicker = jest.fn(async () => SELECTION);
      // References タブに ref_id / title 列が無い = tiab-review のシートではない
      const badGoogle: GoogleApiDeps = {
        getAccessToken: async () => 'tok',
        fetch: (async (input: RequestInfo | URL) => {
          const url = String(input);
          if (url.includes('values:batchGet')) {
            const json = { valueRanges: [{ values: [['id', 'name']] }, { values: [] }] };
            return {
              ok: true,
              status: 200,
              json: async () => json,
              text: async () => JSON.stringify(json),
            } as Response;
          }
          const json = { values: [] };
          return {
            ok: true,
            status: 200,
            json: async () => json,
            text: async () => JSON.stringify(json),
          } as Response;
        }) as typeof fetch,
      };
      const deps = makeDeps({ openTiabSheetPicker, google: badGoogle });
      await bootstrapPopup(document, deps);
      el<HTMLButtonElement>('tiab-pick').click();
      await flush();
      expect(el('tiab-error').textContent).toContain(
        'References タブに ref_id / title 列が見つかりません',
      );
      expect(el('tiab-status').textContent).toBe('');
      expect(el<HTMLFormElement>('tiab-create-form').hidden).toBe(true);
      expect(el<HTMLButtonElement>('tiab-pick').disabled).toBe(false);
    });

    test('検証済みシートが無い状態でフォームが送信されても（防御的分岐）saveTiabHandoff を呼ばず作成のみ行う', async () => {
      // 通常の UI 操作では #tiab-create-form は検証成功後にしか表示されないため到達しないが、
      // checkedSheetId 未設定時のガード（bindTiabHandoff）を直接検証する
      const deps = makeDeps({ google: makeTiabGoogle({ includeCount: 1 }) });
      await bootstrapPopup(document, deps);
      const form = el<HTMLFormElement>('tiab-create-form');
      el<HTMLInputElement>('tiab-project-title').value = '手動送信 SR';
      form.dispatchEvent(new Event('submit', { cancelable: true }));
      await flush();
      expect(el('tiab-error').textContent).toBe('');
      expect(deps.openAppTab).toHaveBeenCalledWith('#/documents');
      await expect(loadTiabHandoff()).resolves.toBeNull();
    });

    test('状態 E: 作成成功で引き継ぎ状態を保存し #/documents へ遷移する', async () => {
      const openTiabSheetPicker = jest.fn(async () => SELECTION);
      const deps = makeDeps({
        openTiabSheetPicker,
        google: makeTiabGoogle({ includeCount: 1 }),
      });
      await bootstrapPopup(document, deps);
      el<HTMLButtonElement>('tiab-pick').click();
      await flush();

      const form = el<HTMLFormElement>('tiab-create-form');
      const submit = el<HTMLButtonElement>('tiab-create-submit');
      el<HTMLInputElement>('tiab-project-title').value = 'tiab 引き継ぎ SR';
      form.dispatchEvent(new Event('submit', { cancelable: true }));
      // 送信直後（同期）に作成中表示へ切り替わる
      expect(submit.disabled).toBe(true);
      expect(submit.textContent).toBe('作成中…');
      await flush();
      expect(submit.disabled).toBe(false);
      expect(submit.textContent).toBe('作成して続行');
      expect(el('tiab-error').textContent).toBe('');
      expect(deps.openAppTab).toHaveBeenCalledWith('#/documents');
      await expect(loadCurrentProject()).resolves.toMatchObject({ name: 'tiab 引き継ぎ SR' });
      const projectId = (await loadCurrentProject())?.projectId;
      await expect(loadTiabHandoff()).resolves.toEqual({
        projectId,
        tiabSheetId: 'TIAB-SID',
      });
    });

    test('状態 E（失敗）: 作成失敗でエラー表示・ボタン復帰・プロジェクトは作られない', async () => {
      const openTiabSheetPicker = jest.fn(async () => SELECTION);
      const google: GoogleApiDeps = {
        getAccessToken: async () => 'tok',
        // eslint-disable-next-line prefer-promise-reject-errors
        fetch: (async () => Promise.reject('boom')) as typeof fetch,
      };
      // Picker deps だけ差し替え、readTiabSheet 自体はスタブ化せず createNewProject 側で失敗させる。
      // readTiabSheet も同じ google.fetch を使うため、まず正常系で検証を通してから失敗させたいが、
      // fetch が常に失敗する google では検証自体も失敗するため、検証専用の google と作成専用の
      // google を切り替えるスタブにする
      let phase: 'checking' | 'creating' = 'checking';
      const okGoogle = makeTiabGoogle({ includeCount: 1 });
      const switching: GoogleApiDeps = {
        getAccessToken: async () => 'tok',
        fetch: (async (input: RequestInfo | URL, init?: RequestInit) => {
          if (phase === 'creating') {
            return (google.fetch as typeof fetch)(input, init);
          }
          return (okGoogle.fetch as typeof fetch)(input, init);
        }) as typeof fetch,
      };
      const deps = makeDeps({ openTiabSheetPicker, google: switching });
      await bootstrapPopup(document, deps);
      el<HTMLButtonElement>('tiab-pick').click();
      await flush();
      expect(el<HTMLFormElement>('tiab-create-form').hidden).toBe(false);

      phase = 'creating';
      const form = el<HTMLFormElement>('tiab-create-form');
      const submit = el<HTMLButtonElement>('tiab-create-submit');
      el<HTMLInputElement>('tiab-project-title').value = 'tiab 引き継ぎ SR';
      form.dispatchEvent(new Event('submit', { cancelable: true }));
      await flush();
      expect(el('tiab-error').textContent).toBe('boom');
      expect(submit.disabled).toBe(false);
      expect(submit.textContent).toBe('作成して続行');
      expect(deps.openAppTab).not.toHaveBeenCalled();
      await expect(loadTiabHandoff()).resolves.toBeNull();
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

  test('openAppTab は hash 指定で該当ルートへ直接遷移する（tiab-review 引き継ぎ作成後）', () => {
    const deps = createChromePopupDeps();
    deps.openAppTab('#/documents');
    expect(chromeMock.tabs.update).toHaveBeenCalledWith({
      url: 'chrome-extension://test-extension-id/app/app.html#/documents',
    });
  });

  test('isAuthenticated: サイレント取得成功で true（interactive=false でブローカーへ依頼）', async () => {
    const deps = createChromePopupDeps();
    await expect(deps.isAuthenticated()).resolves.toBe(true);
    expect(chromeMock.runtime.sendMessage).toHaveBeenCalledWith({
      type: 'auth:get-token',
      interactive: false,
    });
  });

  test('isAuthenticated: 失敗で false', async () => {
    chromeMock.runtime.sendMessage.mockResolvedValue({ ok: false, error: 'interaction_required' });
    const deps = createChromePopupDeps();
    await expect(deps.isAuthenticated()).resolves.toBe(false);
  });

  test('signIn: 成功で true（interactive=true）/ 失敗で false', async () => {
    const deps = createChromePopupDeps();
    await expect(deps.signIn()).resolves.toBe(true);
    expect(chromeMock.runtime.sendMessage).toHaveBeenCalledWith({
      type: 'auth:get-token',
      interactive: true,
    });
    chromeMock.runtime.sendMessage.mockResolvedValue({ ok: false, error: 'auth_flow_cancelled' });
    await expect(deps.signIn()).resolves.toBe(false);
  });

  test('signOut: ブローカーへ auth:clear を依頼する', async () => {
    const deps = createChromePopupDeps();
    await expect(deps.signOut()).resolves.toBeUndefined();
    expect(chromeMock.runtime.sendMessage).toHaveBeenCalledWith({ type: 'auth:clear' });
  });

  test('google.getAccessToken は interactive=true でトークンを返す', async () => {
    const deps = createChromePopupDeps();
    await expect(deps.google.getAccessToken()).resolves.toBe('mock-token');
  });

  test('profile は OAuth アカウントのメール、chromeProfileEmail はプロファイルのメールを返す', async () => {
    const deps = createChromePopupDeps();
    await expect(deps.profile.getProfileUserInfo()).resolves.toEqual({
      email: 'tester@example.com',
      id: '',
    });
    await expect(deps.chromeProfileEmail()).resolves.toBe('tester@example.com');
    expect(chromeMock.runtime.sendMessage).toHaveBeenCalledWith({ type: 'auth:get-email' });
    expect(chromeMock.identity.getProfileUserInfo).toHaveBeenCalled();
  });

  test('openSpreadsheetPicker は Picker タブ（view=spreadsheet）を開き、結果を返す（配線確認）', async () => {
    chromeMock.tabs.create.mockResolvedValueOnce({ id: 42 });
    const deps = createChromePopupDeps();
    const promise = deps.openSpreadsheetPicker('SID-1');
    await flush();
    const url = (chromeMock.tabs.create.mock.calls[0]?.[0] as { url: string }).url;
    expect(url).toContain(`${PICKER_PAGE_URL}#`);
    expect(url).toContain('view=spreadsheet');
    expect(url).toContain('file_id=SID-1');
    // 実生成された nonce をタブ URL から拾ってキャンセルを送る
    const nonce = new URLSearchParams(url.split('#')[1] ?? '').get('nonce');
    const wrapped = chromeMock.runtime.onMessageExternal.addListener.mock.calls[0]?.[0] as (
      message: unknown,
      sender: { tab?: { id?: number }; url?: string },
      sendResponse: (response: unknown) => void,
    ) => void;
    wrapped(
      { source: 'sr-data-extraction-picker', kind: 'cancelled', nonce },
      { tab: { id: 42 }, url: `${PICKER_PAGE_URL}#x` },
      jest.fn(),
    );
    await expect(promise).resolves.toBe('cancelled');
  });

  test('openTiabSheetPicker は Picker タブ（view=spreadsheet・file_id 制限なし）を開き、選択を返す（配線確認）', async () => {
    chromeMock.tabs.create.mockResolvedValueOnce({ id: 43 });
    const deps = createChromePopupDeps();
    const promise = deps.openTiabSheetPicker();
    await flush();
    const url = (chromeMock.tabs.create.mock.calls[0]?.[0] as { url: string }).url;
    expect(url).toContain(`${PICKER_PAGE_URL}#`);
    expect(url).toContain('view=spreadsheet');
    expect(url).not.toContain('file_id=');
    const nonce = new URLSearchParams(url.split('#')[1] ?? '').get('nonce');
    const wrapped = chromeMock.runtime.onMessageExternal.addListener.mock.calls[0]?.[0] as (
      message: unknown,
      sender: { tab?: { id?: number }; url?: string },
      sendResponse: (response: unknown) => void,
    ) => void;
    wrapped(
      {
        source: 'sr-data-extraction-picker',
        kind: 'picked',
        nonce,
        files: [{ id: 'TIAB-SID', name: 'tiab シート' }],
      },
      { tab: { id: 43 }, url: `${PICKER_PAGE_URL}#x` },
      jest.fn(),
    );
    await expect(promise).resolves.toEqual({ sourceFileId: 'TIAB-SID', filename: 'tiab シート' });
  });

  test('sleep は resolve する', async () => {
    const deps = createChromePopupDeps();
    await expect(deps.sleep(0)).resolves.toBeUndefined();
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
        <p id="popup-account-note" hidden></p>
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
        <button id="popup-open-grant" type="button" hidden data-i18n="popup.openGrant">
          Google で許可する
        </button>
        <button id="tiab-pick" type="button" data-i18n="popup.tiabPick">
          tiab-review のシートを選ぶ
        </button>
        <form id="tiab-create-form" hidden>
          <input type="text" id="tiab-project-title" />
          <button type="submit" id="tiab-create-submit" data-i18n="popup.tiabCreateSubmit">
            作成して続行
          </button>
        </form>
        <p id="tiab-status"></p>
        <p id="tiab-error"></p>
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
