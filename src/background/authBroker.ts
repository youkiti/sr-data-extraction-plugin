// service worker の認証ブローカー（issue #129。参照実装: tiab-review-plugin の auth-flow.ts）。
//
// chrome.identity.launchWebAuthFlow による OAuth（implicit フロー、response_type=token）実装。
// getAuthToken は Chrome プロファイルのアカウントに固定されるため、認可時に任意の
// Google アカウントを選べる launchWebAuthFlow へ移行した（要求スコープは
// userinfo.email + drive.file の 2 本のみ。spreadsheets は要求しない）。
//
// - トークン: chrome.storage.session（ディスク非永続・ブラウザ終了で消去）
// - メール: chrome.storage.local（永続。login_hint によるサイレント再認証と
//   annotator / created_by の記録に使うため、ブラウザ再起動をまたいで保持する）
// - 不変条件: トークンが取得できたとき、メールは必ず保存済み
//   （userinfo 取得に失敗したらサインイン自体を失敗させ、created_by / annotator の
//   空文字保存を防ぐ）
// - 認可応答のフラグメント scope を必ず検証し、2 スコープが揃わない部分同意は失敗扱い
import { isAuthRequest, type AuthRequest, type AuthResponse } from '../lib/google/authMessages';
import { getChromeProfileEmail } from '../lib/google/identity';

// webpack DefinePlugin によりビルド時に文字列リテラルへ置換されるグローバル定数
declare const __WEBAUTH_CLIENT_ID__: string;

/** このアプリが要求する OAuth スコープ（requirements.md §2.1） */
export const OAUTH_SCOPES = [
  'https://www.googleapis.com/auth/userinfo.email',
  'https://www.googleapis.com/auth/drive.file',
] as const;

/** 移行期間中に混入を検知して警告する旧スコープ（要求はしない） */
const LEGACY_SPREADSHEETS_SCOPE = 'https://www.googleapis.com/auth/spreadsheets';

const AUTH_ENDPOINT = 'https://accounts.google.com/o/oauth2/v2/auth';
const USERINFO_ENDPOINT = 'https://www.googleapis.com/oauth2/v3/userinfo';
const REVOKE_ENDPOINT = 'https://oauth2.googleapis.com/revoke';

export const TOKEN_SESSION_KEY = 'sr-data-extraction:oauth-token';
export const EMAIL_LOCAL_KEY = 'sr-data-extraction:oauth-email';

/** 期限切れ間際のトークンを返さないためのマージン */
const EXPIRY_MARGIN_MS = 60_000;

interface CachedToken {
  token: string;
  /** epoch ms */
  expiresAt: number;
}

type AuthPrompt = 'none' | 'consent' | 'select_account consent';

export interface WebAuthDeps {
  launchWebAuthFlow: (details: { url: string; interactive: boolean }) => Promise<string | undefined>;
  getRedirectURL: () => string;
  sessionGet: (key: string) => Promise<unknown>;
  sessionSet: (items: Record<string, unknown>) => Promise<void>;
  sessionRemove: (key: string) => Promise<void>;
  localGet: (key: string) => Promise<unknown>;
  localSet: (items: Record<string, unknown>) => Promise<void>;
  localRemove: (key: string) => Promise<void>;
  /**
   * Chrome プロファイルのメール（identity.email 権限）。保存済みメールが無い
   * 初回 interactive 認可の login_hint シードにのみ使う（正は常に OAuth 応答側）
   */
  getProfileEmail: () => Promise<string | null>;
  fetch: (input: string, init?: RequestInit) => Promise<Response>;
  now: () => number;
  clientId: string;
  /** 旧スコープ混入などの警告出力（トークン値は渡さない。原則 5） */
  warn: (message: string) => void;
}

/** Chrome ランタイムから WebAuthDeps を組み立てる（service worker エントリ用） */
export function createChromeWebAuthDeps(): WebAuthDeps {
  return {
    launchWebAuthFlow: (details) => chrome.identity.launchWebAuthFlow(details),
    getRedirectURL: () => chrome.identity.getRedirectURL(),
    sessionGet: async (key) => (await chrome.storage.session.get(key))[key],
    sessionSet: (items) => chrome.storage.session.set(items),
    sessionRemove: (key) => chrome.storage.session.remove(key),
    localGet: async (key) => (await chrome.storage.local.get(key))[key],
    localSet: (items) => chrome.storage.local.set(items),
    localRemove: (key) => chrome.storage.local.remove(key),
    getProfileEmail: () => getChromeProfileEmail(),
    fetch: (input, init) => globalThis.fetch(input, init),
    now: () => Date.now(),
    // jest（DefinePlugin 非適用）では未定義になるため typeof でガードする
    clientId: typeof __WEBAUTH_CLIENT_ID__ === 'undefined' ? '' : __WEBAUTH_CLIENT_ID__,
    warn: (message) => console.warn(message),
  };
}

/** 認可 URL を組み立てる。prompt / login_hint は指定時のみ付与する */
export function buildAuthUrl(
  deps: Pick<WebAuthDeps, 'clientId' | 'getRedirectURL'>,
  opts: { prompt?: AuthPrompt; loginHint?: string } = {},
): string {
  const params = new URLSearchParams({
    client_id: deps.clientId,
    response_type: 'token',
    redirect_uri: deps.getRedirectURL(),
    scope: OAUTH_SCOPES.join(' '),
    // 過去に付与した spreadsheets スコープを新トークンへ引き継がせない（移行の要）
    include_granted_scopes: 'false',
  });
  if (opts.prompt) {
    params.set('prompt', opts.prompt);
  }
  if (opts.loginHint) {
    params.set('login_hint', opts.loginHint);
  }
  return `${AUTH_ENDPOINT}?${params.toString()}`;
}

/**
 * リダイレクト URL のハッシュフラグメントから access_token と付与スコープを取り出す
 * （implicit フロー特有。scope は部分同意の検証に使う）
 */
export function parseTokenFromRedirect(
  redirectUrl: string,
  now: number,
): { token: string; expiresAt: number; scopes: string[] } {
  const params = new URLSearchParams(new URL(redirectUrl).hash.replace(/^#/, ''));
  const token = params.get('access_token');
  if (!token) {
    throw new Error(params.get('error') ?? 'no_access_token');
  }
  const expiresIn = Number(params.get('expires_in') ?? '3600');
  const scopes = (params.get('scope') ?? '').split(/\s+/).filter((s) => s.length > 0);
  return { token, expiresAt: now + expiresIn * 1000, scopes };
}

/**
 * 付与スコープの検証。Google の同意画面は権限ごとの部分同意を許すため、
 * 要求 2 スコープが揃わない応答はサインイン失敗として扱う
 */
export function assertGrantedScopes(scopes: string[], warn: WebAuthDeps['warn']): void {
  const missing = OAUTH_SCOPES.filter((scope) => !scopes.includes(scope));
  if (missing.length > 0) {
    throw new Error(`必要な権限が許可されていません: ${missing.join(' ')}`);
  }
  if (scopes.includes(LEGACY_SPREADSHEETS_SCOPE)) {
    // include_granted_scopes=false でも混入した場合の検知（移行期間の監視用）
    warn('認可応答に旧 spreadsheets スコープが含まれています（include_granted_scopes 設定を確認）');
  }
}

export interface AuthBroker {
  getAccessToken: (interactive: boolean) => Promise<string>;
  getSignedInEmail: () => Promise<string | null>;
  forceReauth: () => Promise<string>;
  clearAuth: () => Promise<void>;
}

export function createAuthBroker(deps: WebAuthDeps): AuthBroker {
  // 同時に複数の launchWebAuthFlow を走らせないための単一飛行ガード。
  // ブローカーは SW の単一コンテキストに 1 つなので、全タブの要求がここで合流する
  let inflight: Promise<string> | null = null;

  const readCachedToken = async (): Promise<CachedToken | undefined> =>
    (await deps.sessionGet(TOKEN_SESSION_KEY)) as CachedToken | undefined;

  const readEmail = async (): Promise<string | undefined> =>
    (await deps.localGet(EMAIL_LOCAL_KEY)) as string | undefined;

  const isFresh = (cached: CachedToken | undefined): cached is CachedToken =>
    cached !== undefined && deps.now() < cached.expiresAt - EXPIRY_MARGIN_MS;

  const fetchUserinfoEmail = async (token: string): Promise<string> => {
    const response = await deps.fetch(USERINFO_ENDPOINT, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!response.ok) {
      throw new Error(`メールアドレスの取得に失敗しました（HTTP ${response.status}）`);
    }
    const info = (await response.json()) as { email?: unknown };
    if (typeof info.email !== 'string' || info.email === '') {
      throw new Error('メールアドレスの取得に失敗しました（email が空）');
    }
    return info.email;
  };

  const launch = async (
    interactive: boolean,
    prompt: AuthPrompt,
    loginHint?: string,
  ): Promise<string> => {
    const redirectUrl = await deps.launchWebAuthFlow({
      url: buildAuthUrl(deps, { prompt, loginHint }),
      interactive,
    });
    if (!redirectUrl) {
      throw new Error('auth_flow_cancelled');
    }
    const parsed = parseTokenFromRedirect(redirectUrl, deps.now());
    assertGrantedScopes(parsed.scopes, deps.warn);
    await deps.sessionSet({
      [TOKEN_SESSION_KEY]: { token: parsed.token, expiresAt: parsed.expiresAt },
    });
    return parsed.token;
  };

  /**
   * 不変条件の担保: トークン取得後、メールが確定するまでサインイン完了にしない。
   * userinfo 失敗時は取得済みトークンも破棄して失敗を伝播する
   */
  const ensureEmail = async (token: string, force: boolean): Promise<void> => {
    if (!force && (await readEmail())) {
      return;
    }
    try {
      const email = await fetchUserinfoEmail(token);
      await deps.localSet({ [EMAIL_LOCAL_KEY]: email });
    } catch (err) {
      await deps.sessionRemove(TOKEN_SESSION_KEY);
      throw err;
    }
  };

  const acquire = async (interactive: boolean): Promise<string> => {
    const loginHint = await readEmail();
    try {
      // 複数 Google セッション環境で prompt=none が interaction_required にならないよう
      // login_hint で対象アカウントを明示する
      const token = await launch(false, 'none', loginHint);
      await ensureEmail(token, false);
      return token;
    } catch {
      if (!interactive) {
        throw new Error('interaction_required');
      }
      // 保存済みメールが無い初回のみ Chrome プロファイルのメールをシードにする
      // （既存ユーザーの annotator / created_by はプロファイルのメールで記録されているため、
      //   同一アカウントを事前選択させる。強制ではなく、正は常に OAuth 応答側）。
      // select_account に consent を併記するのは、OAuth クライアント変更で再同意が必要な
      // 既存ユーザーが同意未済のままブロック画面へ落ちるのを防ぐため（tiab の実機知見）
      const seed = loginHint ?? (await deps.getProfileEmail()) ?? undefined;
      const token = await launch(true, 'select_account consent', seed);
      // アカウントが変わった可能性があるため必ず取り直す
      await ensureEmail(token, true);
      return token;
    }
  };

  const getAccessToken = async (interactive: boolean): Promise<string> => {
    const cached = await readCachedToken();
    if (isFresh(cached)) {
      return cached.token;
    }
    if (inflight) {
      try {
        return await inflight;
      } catch {
        // 先行フローの失敗は自分の条件で再試行する（サイレント試行の失敗に
        // 相乗りした interactive な呼び出しをここで潰さない）
      }
      const refreshed = await readCachedToken();
      if (isFresh(refreshed)) {
        return refreshed.token;
      }
    }
    inflight = acquire(interactive);
    try {
      return await inflight;
    } finally {
      inflight = null;
    }
  };

  const getSignedInEmail = async (): Promise<string | null> => {
    let token: string;
    try {
      token = await getAccessToken(false);
    } catch {
      return null;
    }
    const email = await readEmail();
    if (email) {
      return email;
    }
    // セッションのトークンだけ残ってメールが消えた場合（storage.local の手動削除等）の修復
    try {
      const fetched = await fetchUserinfoEmail(token);
      await deps.localSet({ [EMAIL_LOCAL_KEY]: fetched });
      return fetched;
    } catch {
      return null;
    }
  };

  const forceReauth = async (): Promise<string> => {
    await deps.sessionRemove(TOKEN_SESSION_KEY);
    // 同じアカウントで再同意させるため login_hint を付ける
    const loginHint = await readEmail();
    const token = await launch(true, 'consent', loginHint);
    await ensureEmail(token, true);
    return token;
  };

  const clearAuth = async (): Promise<void> => {
    const cached = await readCachedToken();
    if (cached) {
      try {
        await deps.fetch(`${REVOKE_ENDPOINT}?token=${encodeURIComponent(cached.token)}`, {
          method: 'POST',
        });
      } catch {
        // revoke はベストエフォート。失敗してもローカルの破棄は継続する
      }
    }
    await deps.sessionRemove(TOKEN_SESSION_KEY);
    await deps.localRemove(EMAIL_LOCAL_KEY);
  };

  return { getAccessToken, getSignedInEmail, forceReauth, clearAuth };
}

/** 1 件の認証依頼を処理して応答オブジェクトに変換する */
export async function handleAuthRequest(
  broker: AuthBroker,
  request: AuthRequest,
): Promise<AuthResponse> {
  try {
    switch (request.type) {
      case 'auth:get-token':
        return { ok: true, token: await broker.getAccessToken(request.interactive) };
      case 'auth:get-email':
        return { ok: true, email: await broker.getSignedInEmail() };
      case 'auth:force-reauth':
        return { ok: true, token: await broker.forceReauth() };
      case 'auth:clear':
        await broker.clearAuth();
        return { ok: true };
    }
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

/**
 * chrome.runtime.onMessage 用のリスナーを作る。認証宛てでないメッセージは無視し、
 * 認証宛てなら true を返して非同期の sendResponse を予約する（MV3 の作法）
 */
export function createAuthMessageListener(
  broker: AuthBroker,
): (message: unknown, sendResponse: (response: AuthResponse) => void) => boolean {
  return (message, sendResponse) => {
    if (!isAuthRequest(message)) {
      return false;
    }
    void handleAuthRequest(broker, message).then(sendResponse);
    return true;
  };
}
