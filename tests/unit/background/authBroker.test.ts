// 認証ブローカー（launchWebAuthFlow + userinfo.email / drive.file）のテスト。
// 対応する仕様: issue #129（scope 検証・email 永続化・単一飛行・revoke）
import { installChromeMock, MOCK_REDIRECT_URL, type ChromeMock } from '../../setup/chrome-mock';
import {
  assertGrantedScopes,
  buildAuthUrl,
  createAuthBroker,
  createAuthMessageListener,
  createChromeWebAuthDeps,
  EMAIL_LOCAL_KEY,
  handleAuthRequest,
  OAUTH_SCOPES,
  parseTokenFromRedirect,
  TOKEN_SESSION_KEY,
  type WebAuthDeps,
} from '../../../src/background/authBroker';

const REDIRECT_URI = 'https://ext-id.chromiumapp.org/';
const SCOPE_FRAGMENT = encodeURIComponent(OAUTH_SCOPES.join(' '));

/** 2 スコープ付きの成功リダイレクト URL を組み立てる */
function redirectWith(token: string, opts: { scope?: string; expiresIn?: string } = {}): string {
  const scope = opts.scope ?? SCOPE_FRAGMENT;
  const expires = opts.expiresIn === undefined ? '&expires_in=3600' : `&expires_in=${opts.expiresIn}`;
  return `${REDIRECT_URI}#access_token=${token}${expires}&scope=${scope}`;
}

interface FakeDepsOptions {
  /** launchWebAuthFlow の応答列（呼び出し順に消費。関数なら都度評価） */
  flows?: Array<string | undefined | Error | (() => Promise<string | undefined>)>;
  userinfoEmail?: string | Error;
  userinfoStatus?: number;
  profileEmail?: string | null;
  now?: number;
}

interface FakeDeps {
  deps: WebAuthDeps;
  session: Record<string, unknown>;
  local: Record<string, unknown>;
  launched: Array<{ url: string; interactive: boolean }>;
  fetchCalls: Array<{ input: string; init?: RequestInit }>;
  warn: jest.Mock;
}

function makeDeps(options: FakeDepsOptions = {}): FakeDeps {
  const session: Record<string, unknown> = {};
  const local: Record<string, unknown> = {};
  const launched: Array<{ url: string; interactive: boolean }> = [];
  const fetchCalls: Array<{ input: string; init?: RequestInit }> = [];
  const flows = [...(options.flows ?? [])];
  const warn = jest.fn();
  const deps: WebAuthDeps = {
    launchWebAuthFlow: async (details) => {
      launched.push(details);
      const next = flows.shift();
      if (next instanceof Error) {
        throw next;
      }
      if (typeof next === 'function') {
        return next();
      }
      return next;
    },
    getRedirectURL: () => REDIRECT_URI,
    sessionGet: async (key) => session[key],
    sessionSet: async (items) => {
      Object.assign(session, items);
    },
    sessionRemove: async (key) => {
      delete session[key];
    },
    localGet: async (key) => local[key],
    localSet: async (items) => {
      Object.assign(local, items);
    },
    localRemove: async (key) => {
      delete local[key];
    },
    getProfileEmail: async () => options.profileEmail ?? null,
    fetch: async (input, init) => {
      fetchCalls.push({ input, init });
      if (input.startsWith('https://oauth2.googleapis.com/revoke')) {
        return { ok: true, status: 200, json: async () => ({}) } as Response;
      }
      if (options.userinfoEmail instanceof Error) {
        throw options.userinfoEmail;
      }
      const status = options.userinfoStatus ?? 200;
      return {
        ok: status === 200,
        status,
        json: async () => ({ email: options.userinfoEmail }),
      } as Response;
    },
    now: () => options.now ?? 1_000_000,
    clientId: 'client-1',
    warn,
  };
  return { deps, session, local, launched, fetchCalls, warn };
}

describe('buildAuthUrl', () => {
  test('必須パラメータ（2 スコープ・include_granted_scopes=false）を組み立てる', () => {
    const url = new URL(buildAuthUrl({ clientId: 'cid', getRedirectURL: () => REDIRECT_URI }));
    expect(url.origin + url.pathname).toBe('https://accounts.google.com/o/oauth2/v2/auth');
    expect(url.searchParams.get('client_id')).toBe('cid');
    expect(url.searchParams.get('response_type')).toBe('token');
    expect(url.searchParams.get('redirect_uri')).toBe(REDIRECT_URI);
    expect(url.searchParams.get('scope')).toBe(OAUTH_SCOPES.join(' '));
    expect(url.searchParams.get('include_granted_scopes')).toBe('false');
    expect(url.searchParams.get('prompt')).toBeNull();
    expect(url.searchParams.get('login_hint')).toBeNull();
  });

  test('prompt / login_hint は指定時のみ付与する', () => {
    const url = new URL(
      buildAuthUrl(
        { clientId: 'cid', getRedirectURL: () => REDIRECT_URI },
        { prompt: 'none', loginHint: 'me@example.com' },
      ),
    );
    expect(url.searchParams.get('prompt')).toBe('none');
    expect(url.searchParams.get('login_hint')).toBe('me@example.com');
  });
});

describe('parseTokenFromRedirect', () => {
  test('token / 期限 / scope を取り出す', () => {
    const parsed = parseTokenFromRedirect(redirectWith('TOK'), 500);
    expect(parsed.token).toBe('TOK');
    expect(parsed.expiresAt).toBe(500 + 3600 * 1000);
    expect(parsed.scopes).toEqual([...OAUTH_SCOPES]);
  });

  test('expires_in 欠落は既定 3600 秒', () => {
    const parsed = parseTokenFromRedirect(
      `${REDIRECT_URI}#access_token=TOK&scope=${SCOPE_FRAGMENT}`,
      0,
    );
    expect(parsed.expiresAt).toBe(3600 * 1000);
  });

  test('scope 欠落は空配列', () => {
    const parsed = parseTokenFromRedirect(`${REDIRECT_URI}#access_token=TOK`, 0);
    expect(parsed.scopes).toEqual([]);
  });

  test('token 欠落は error パラメータの内容で throw', () => {
    expect(() => parseTokenFromRedirect(`${REDIRECT_URI}#error=access_denied`, 0)).toThrow(
      'access_denied',
    );
  });

  test('token も error も無ければ no_access_token', () => {
    expect(() => parseTokenFromRedirect(`${REDIRECT_URI}#state=x`, 0)).toThrow('no_access_token');
  });
});

describe('assertGrantedScopes', () => {
  test('2 スコープ揃いは通過（警告なし）', () => {
    const warn = jest.fn();
    expect(() => assertGrantedScopes([...OAUTH_SCOPES], warn)).not.toThrow();
    expect(warn).not.toHaveBeenCalled();
  });

  test('部分同意（drive.file 欠落）は throw', () => {
    const warn = jest.fn();
    expect(() => assertGrantedScopes([OAUTH_SCOPES[0]], warn)).toThrow(/drive\.file/);
  });

  test('旧 spreadsheets スコープ混入は warn（通過はする）', () => {
    const warn = jest.fn();
    assertGrantedScopes(
      [...OAUTH_SCOPES, 'https://www.googleapis.com/auth/spreadsheets'],
      warn,
    );
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('spreadsheets'));
  });
});

describe('createAuthBroker.getAccessToken', () => {
  test('キャッシュが新鮮なら launch せず返す', async () => {
    const f = makeDeps({ now: 1000 });
    f.session[TOKEN_SESSION_KEY] = { token: 'CACHED', expiresAt: 1000 + 120_000 };
    const broker = createAuthBroker(f.deps);
    await expect(broker.getAccessToken(false)).resolves.toBe('CACHED');
    expect(f.launched).toHaveLength(0);
  });

  test('期限マージン（60 秒）内のキャッシュは使わない', async () => {
    const f = makeDeps({ now: 1000, flows: [redirectWith('NEW')], userinfoEmail: 'me@a.com' });
    f.session[TOKEN_SESSION_KEY] = { token: 'STALE', expiresAt: 1000 + 30_000 };
    const broker = createAuthBroker(f.deps);
    await expect(broker.getAccessToken(false)).resolves.toBe('NEW');
    expect(f.launched).toHaveLength(1);
  });

  test('サイレント取得: prompt=none + 保存済みメールを login_hint に使い、トークンを保存する', async () => {
    const f = makeDeps({ flows: [redirectWith('TOK')], userinfoEmail: 'me@a.com' });
    f.local[EMAIL_LOCAL_KEY] = 'stored@a.com';
    const broker = createAuthBroker(f.deps);
    await expect(broker.getAccessToken(false)).resolves.toBe('TOK');
    expect(f.launched[0]?.interactive).toBe(false);
    const url = new URL(f.launched[0]?.url ?? '');
    expect(url.searchParams.get('prompt')).toBe('none');
    expect(url.searchParams.get('login_hint')).toBe('stored@a.com');
    expect(f.session[TOKEN_SESSION_KEY]).toMatchObject({ token: 'TOK' });
    // メールが保存済みなので userinfo は呼ばない
    expect(f.fetchCalls).toHaveLength(0);
  });

  test('メール未保存なら userinfo で取得して storage.local へ永続化する', async () => {
    const f = makeDeps({ flows: [redirectWith('TOK')], userinfoEmail: 'fetched@a.com' });
    const broker = createAuthBroker(f.deps);
    await broker.getAccessToken(false);
    expect(f.local[EMAIL_LOCAL_KEY]).toBe('fetched@a.com');
    expect(f.fetchCalls[0]?.input).toBe('https://www.googleapis.com/oauth2/v3/userinfo');
    expect(f.fetchCalls[0]?.init?.headers).toEqual({ Authorization: 'Bearer TOK' });
  });

  test('userinfo 失敗（HTTP エラー）はトークンを破棄してサインイン失敗にする', async () => {
    // サイレント成功 → userinfo 失敗 → interactive 再試行 → それでも userinfo 失敗、で確定
    const f = makeDeps({
      flows: [redirectWith('TOK'), redirectWith('TOK2')],
      userinfoStatus: 500,
    });
    const broker = createAuthBroker(f.deps);
    await expect(broker.getAccessToken(true)).rejects.toThrow(/メールアドレスの取得に失敗/);
    expect(f.session[TOKEN_SESSION_KEY]).toBeUndefined();
    expect(f.launched).toHaveLength(2);
  });

  test('userinfo の email 空もサインイン失敗にする', async () => {
    const f = makeDeps({
      flows: [redirectWith('TOK'), redirectWith('TOK2')],
      userinfoEmail: '',
    });
    const broker = createAuthBroker(f.deps);
    await expect(broker.getAccessToken(true)).rejects.toThrow(/email が空/);
    expect(f.session[TOKEN_SESSION_KEY]).toBeUndefined();
  });

  test('部分同意（scope 不足）はサインイン失敗にする', async () => {
    const scopeOnlyEmail = encodeURIComponent(OAUTH_SCOPES[0]);
    const f = makeDeps({
      flows: [
        redirectWith('TOK', { scope: scopeOnlyEmail }),
        redirectWith('TOK2', { scope: scopeOnlyEmail }),
      ],
    });
    const broker = createAuthBroker(f.deps);
    await expect(broker.getAccessToken(true)).rejects.toThrow(/必要な権限が許可されていません/);
  });

  test('interactive=false でサイレント失敗なら interaction_required', async () => {
    const f = makeDeps({ flows: [new Error('interaction required by google')] });
    const broker = createAuthBroker(f.deps);
    await expect(broker.getAccessToken(false)).rejects.toThrow('interaction_required');
    expect(f.launched).toHaveLength(1);
  });

  test('interactive=true: サイレント失敗後に select_account consent で認可し直す', async () => {
    const f = makeDeps({
      flows: [new Error('silent failed'), redirectWith('TOK')],
      userinfoEmail: 'chosen@a.com',
    });
    const broker = createAuthBroker(f.deps);
    await expect(broker.getAccessToken(true)).resolves.toBe('TOK');
    expect(f.launched[1]?.interactive).toBe(true);
    const url = new URL(f.launched[1]?.url ?? '');
    expect(url.searchParams.get('prompt')).toBe('select_account consent');
    expect(f.local[EMAIL_LOCAL_KEY]).toBe('chosen@a.com');
  });

  test('初回 interactive は Chrome プロファイルのメールを login_hint シードにする', async () => {
    const f = makeDeps({
      flows: [new Error('silent failed'), redirectWith('TOK')],
      userinfoEmail: 'oauth@a.com',
      profileEmail: 'profile@a.com',
    });
    const broker = createAuthBroker(f.deps);
    await broker.getAccessToken(true);
    const url = new URL(f.launched[1]?.url ?? '');
    expect(url.searchParams.get('login_hint')).toBe('profile@a.com');
  });

  test('保存済みメールがあればシードよりそちらを優先する', async () => {
    const f = makeDeps({
      flows: [new Error('silent failed'), redirectWith('TOK')],
      userinfoEmail: 'oauth@a.com',
      profileEmail: 'profile@a.com',
    });
    f.local[EMAIL_LOCAL_KEY] = 'stored@a.com';
    const broker = createAuthBroker(f.deps);
    await broker.getAccessToken(true);
    const url = new URL(f.launched[1]?.url ?? '');
    expect(url.searchParams.get('login_hint')).toBe('stored@a.com');
  });

  test('interactive 認可では userinfo を必ず取り直す（アカウント変更に追従）', async () => {
    const f = makeDeps({
      flows: [new Error('silent failed'), redirectWith('TOK')],
      userinfoEmail: 'switched@a.com',
    });
    f.local[EMAIL_LOCAL_KEY] = 'old@a.com';
    const broker = createAuthBroker(f.deps);
    await broker.getAccessToken(true);
    expect(f.local[EMAIL_LOCAL_KEY]).toBe('switched@a.com');
  });

  test('リダイレクト URL が空（キャンセル）は auth_flow_cancelled', async () => {
    const f = makeDeps({ flows: [undefined, undefined] });
    const broker = createAuthBroker(f.deps);
    await expect(broker.getAccessToken(true)).rejects.toThrow('auth_flow_cancelled');
  });

  test('単一飛行: 同時要求は 1 回の launch に合流する', async () => {
    let release: (url: string) => void = () => undefined;
    const gate = new Promise<string>((resolve) => {
      release = resolve;
    });
    const f = makeDeps({ flows: [() => gate], userinfoEmail: 'me@a.com' });
    const broker = createAuthBroker(f.deps);
    const p1 = broker.getAccessToken(false);
    // p1 が launch まで進むのを待ってから 2 本目を発行する
    await new Promise((resolve) => setTimeout(resolve, 0));
    const p2 = broker.getAccessToken(false);
    release(redirectWith('SHARED'));
    await expect(p1).resolves.toBe('SHARED');
    await expect(p2).resolves.toBe('SHARED');
    expect(f.launched).toHaveLength(1);
  });

  test('単一飛行: 先行の失敗後、キャッシュ済みなら再試行せず返す', async () => {
    let reject: (err: Error) => void = () => undefined;
    const gate = new Promise<string>((_resolve, rej) => {
      reject = rej;
    });
    const f = makeDeps({ flows: [() => gate] });
    const broker = createAuthBroker(f.deps);
    const p1 = broker.getAccessToken(false);
    await new Promise((resolve) => setTimeout(resolve, 0));
    const p2 = broker.getAccessToken(false);
    // 先行が失敗する前に別経路でキャッシュが入ったケース
    f.session[TOKEN_SESSION_KEY] = { token: 'FILLED', expiresAt: 1_000_000 + 120_000 };
    reject(new Error('silent failed'));
    await expect(p1).rejects.toThrow('interaction_required');
    await expect(p2).resolves.toBe('FILLED');
    expect(f.launched).toHaveLength(1);
  });

  test('単一飛行: 先行のサイレント失敗に相乗りした interactive 要求は自分の条件で再試行する', async () => {
    let reject: (err: Error) => void = () => undefined;
    const gate = new Promise<string>((_resolve, rej) => {
      reject = rej;
    });
    const f = makeDeps({
      flows: [() => gate, new Error('silent failed'), redirectWith('TOK')],
      userinfoEmail: 'me@a.com',
    });
    const broker = createAuthBroker(f.deps);
    const p1 = broker.getAccessToken(false);
    await new Promise((resolve) => setTimeout(resolve, 0));
    const p2 = broker.getAccessToken(true);
    reject(new Error('silent failed'));
    await expect(p1).rejects.toThrow('interaction_required');
    await expect(p2).resolves.toBe('TOK');
    // 先行 1 回 + 相乗り側の再試行（silent + interactive）
    expect(f.launched).toHaveLength(3);
  });
});

describe('createAuthBroker.getSignedInEmail', () => {
  test('サインイン済みなら保存済みメールを返す', async () => {
    const f = makeDeps({ now: 1000 });
    f.session[TOKEN_SESSION_KEY] = { token: 'T', expiresAt: 1000 + 120_000 };
    f.local[EMAIL_LOCAL_KEY] = 'me@a.com';
    const broker = createAuthBroker(f.deps);
    await expect(broker.getSignedInEmail()).resolves.toBe('me@a.com');
  });

  test('未サインイン（サイレント失敗）は null', async () => {
    const f = makeDeps({ flows: [new Error('x')] });
    const broker = createAuthBroker(f.deps);
    await expect(broker.getSignedInEmail()).resolves.toBeNull();
  });

  test('トークンだけ残りメールが消えていたら userinfo で修復する', async () => {
    const f = makeDeps({ now: 1000, userinfoEmail: 'repaired@a.com' });
    f.session[TOKEN_SESSION_KEY] = { token: 'T', expiresAt: 1000 + 120_000 };
    const broker = createAuthBroker(f.deps);
    await expect(broker.getSignedInEmail()).resolves.toBe('repaired@a.com');
    expect(f.local[EMAIL_LOCAL_KEY]).toBe('repaired@a.com');
  });

  test('修復の userinfo も失敗したら null', async () => {
    const f = makeDeps({ now: 1000, userinfoStatus: 401 });
    f.session[TOKEN_SESSION_KEY] = { token: 'T', expiresAt: 1000 + 120_000 };
    const broker = createAuthBroker(f.deps);
    await expect(broker.getSignedInEmail()).resolves.toBeNull();
  });
});

describe('createAuthBroker.forceReauth', () => {
  test('トークンを破棄し prompt=consent + login_hint で再認可する', async () => {
    const f = makeDeps({ flows: [redirectWith('NEW')], userinfoEmail: 'me@a.com' });
    f.session[TOKEN_SESSION_KEY] = { token: 'OLD', expiresAt: 9_999_999_999 };
    f.local[EMAIL_LOCAL_KEY] = 'me@a.com';
    const broker = createAuthBroker(f.deps);
    await expect(broker.forceReauth()).resolves.toBe('NEW');
    expect(f.launched[0]?.interactive).toBe(true);
    const url = new URL(f.launched[0]?.url ?? '');
    expect(url.searchParams.get('prompt')).toBe('consent');
    expect(url.searchParams.get('login_hint')).toBe('me@a.com');
    // force なので userinfo を取り直す
    expect(f.fetchCalls.some((c) => c.input.includes('userinfo'))).toBe(true);
  });
});

describe('createAuthBroker.clearAuth', () => {
  test('revoke を呼び、トークンとメールを両方破棄する', async () => {
    const f = makeDeps({ now: 1000 });
    f.session[TOKEN_SESSION_KEY] = { token: 'T', expiresAt: 1000 + 120_000 };
    f.local[EMAIL_LOCAL_KEY] = 'me@a.com';
    const broker = createAuthBroker(f.deps);
    await broker.clearAuth();
    expect(f.fetchCalls[0]?.input).toBe('https://oauth2.googleapis.com/revoke?token=T');
    expect(f.fetchCalls[0]?.init?.method).toBe('POST');
    expect(f.session[TOKEN_SESSION_KEY]).toBeUndefined();
    expect(f.local[EMAIL_LOCAL_KEY]).toBeUndefined();
  });

  test('revoke 失敗でもローカル破棄は続行する', async () => {
    const f = makeDeps({ now: 1000 });
    f.session[TOKEN_SESSION_KEY] = { token: 'T', expiresAt: 1000 + 120_000 };
    f.local[EMAIL_LOCAL_KEY] = 'me@a.com';
    f.deps.fetch = async () => {
      throw new Error('network down');
    };
    const broker = createAuthBroker(f.deps);
    await expect(broker.clearAuth()).resolves.toBeUndefined();
    expect(f.session[TOKEN_SESSION_KEY]).toBeUndefined();
    expect(f.local[EMAIL_LOCAL_KEY]).toBeUndefined();
  });

  test('トークンが無ければ revoke を呼ばない', async () => {
    const f = makeDeps();
    const broker = createAuthBroker(f.deps);
    await broker.clearAuth();
    expect(f.fetchCalls).toHaveLength(0);
  });
});

describe('handleAuthRequest / createAuthMessageListener', () => {
  function makeBroker() {
    const broker = {
      getAccessToken: jest.fn(async (_interactive: boolean) => 'T'),
      getSignedInEmail: jest.fn(async () => 'me@a.com'),
      forceReauth: jest.fn(async () => 'NEW'),
      clearAuth: jest.fn(async () => undefined),
    };
    return { broker };
  }

  test('auth:get-token → {ok, token}', async () => {
    const { broker } = makeBroker();
    await expect(
      handleAuthRequest(broker, { type: 'auth:get-token', interactive: true }),
    ).resolves.toEqual({ ok: true, token: 'T' });
    expect(broker.getAccessToken).toHaveBeenCalledWith(true);
  });

  test('auth:get-email → {ok, email}', async () => {
    const { broker } = makeBroker();
    await expect(handleAuthRequest(broker, { type: 'auth:get-email' })).resolves.toEqual({
      ok: true,
      email: 'me@a.com',
    });
  });

  test('auth:force-reauth → {ok, token}', async () => {
    const { broker } = makeBroker();
    await expect(handleAuthRequest(broker, { type: 'auth:force-reauth' })).resolves.toEqual({
      ok: true,
      token: 'NEW',
    });
  });

  test('auth:clear → {ok}', async () => {
    const { broker } = makeBroker();
    await expect(handleAuthRequest(broker, { type: 'auth:clear' })).resolves.toEqual({ ok: true });
    expect(broker.clearAuth).toHaveBeenCalledTimes(1);
  });

  test('Error は message、Error 以外は文字列化して返す', async () => {
    const { broker } = makeBroker();
    broker.getAccessToken.mockRejectedValueOnce(new Error('interaction_required'));
    await expect(
      handleAuthRequest(broker, { type: 'auth:get-token', interactive: false }),
    ).resolves.toEqual({ ok: false, error: 'interaction_required' });
    // eslint-disable-next-line prefer-promise-reject-errors
    broker.clearAuth.mockImplementationOnce(async () => Promise.reject('boom'));
    await expect(handleAuthRequest(broker, { type: 'auth:clear' })).resolves.toEqual({
      ok: false,
      error: 'boom',
    });
  });

  test('リスナー: 認証宛てでないメッセージは false（応答しない）', () => {
    const { broker } = makeBroker();
    const listener = createAuthMessageListener(broker);
    const sendResponse = jest.fn();
    expect(listener({ source: 'sr-data-extraction-picker', kind: 'ready' }, sendResponse)).toBe(
      false,
    );
    expect(listener(null, sendResponse)).toBe(false);
    expect(listener({ type: 'auth:get-token' }, sendResponse)).toBe(false); // interactive 欠落
    expect(sendResponse).not.toHaveBeenCalled();
  });

  test('リスナー: 認証宛ては true を返し非同期で応答する', async () => {
    const { broker } = makeBroker();
    const listener = createAuthMessageListener(broker);
    const sendResponse = jest.fn();
    expect(listener({ type: 'auth:get-email' }, sendResponse)).toBe(true);
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(sendResponse).toHaveBeenCalledWith({ ok: true, email: 'me@a.com' });
  });
});

describe('createChromeWebAuthDeps', () => {
  let chromeMock: ChromeMock;

  beforeEach(() => {
    chromeMock = installChromeMock();
  });

  test('chrome.identity / storage を配線する', async () => {
    const deps = createChromeWebAuthDeps();
    await expect(
      deps.launchWebAuthFlow({ url: 'https://auth/', interactive: false }),
    ).resolves.toBe(MOCK_REDIRECT_URL);
    expect(deps.getRedirectURL()).toBe('https://test-extension-id.chromiumapp.org/');

    await deps.sessionSet({ k: 'v' });
    await expect(deps.sessionGet('k')).resolves.toBe('v');
    await deps.sessionRemove('k');
    await expect(deps.sessionGet('k')).resolves.toBeUndefined();

    await deps.localSet({ k2: 'v2' });
    await expect(deps.localGet('k2')).resolves.toBe('v2');
    await deps.localRemove('k2');
    await expect(deps.localGet('k2')).resolves.toBeUndefined();

    await expect(deps.getProfileEmail()).resolves.toBe('tester@example.com');
    expect(typeof deps.now()).toBe('number');
  });

  test('fetch は globalThis.fetch へ委譲する', async () => {
    const fetchSpy = jest.fn().mockResolvedValue({ ok: true } as Response);
    (globalThis as { fetch: unknown }).fetch = fetchSpy;
    const deps = createChromeWebAuthDeps();
    await deps.fetch('https://api/', { method: 'POST' });
    expect(fetchSpy).toHaveBeenCalledWith('https://api/', { method: 'POST' });
  });

  test('warn は console.warn へ委譲する', () => {
    const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
    const deps = createChromeWebAuthDeps();
    deps.warn('注意');
    expect(warnSpy).toHaveBeenCalledWith('注意');
    warnSpy.mockRestore();
  });

  test('clientId: DefinePlugin 未適用（jest）では空文字、グローバル定義があればその値', () => {
    expect(createChromeWebAuthDeps().clientId).toBe('');
    (globalThis as Record<string, unknown>).__WEBAUTH_CLIENT_ID__ = 'injected-id';
    try {
      expect(createChromeWebAuthDeps().clientId).toBe('injected-id');
    } finally {
      delete (globalThis as Record<string, unknown>).__WEBAUTH_CLIENT_ID__;
    }
  });

  test('chrome.storage の実引数形（キー→オブジェクト）を検証する', async () => {
    const deps = createChromeWebAuthDeps();
    await deps.sessionSet({ a: 1 });
    expect(chromeMock.storage.session.set).toHaveBeenCalledWith({ a: 1 });
    await deps.localSet({ b: 2 });
    expect(chromeMock.storage.local.set).toHaveBeenCalledWith({ b: 2 });
  });
});
