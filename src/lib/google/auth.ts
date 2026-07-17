// 認証クライアント（issue #129）。
// 認証の実体は service worker の認証ブローカー（src/background/authBroker.ts。
// launchWebAuthFlow + userinfo.email / drive.file の 2 スコープ）にあり、
// 本モジュールは各拡張ページから chrome.runtime.sendMessage で依頼する薄いラッパ。
// メッセージ型は lib/google/authMessages.ts を正典とする。
import type { AuthRequest, AuthResponse } from './authMessages';

export interface AuthClientDeps {
  /** ブローカー（SW）へメッセージを送る。応答が来ない場合は undefined */
  sendMessage: (message: AuthRequest) => Promise<AuthResponse | undefined>;
}

export function createChromeAuthClientDeps(): AuthClientDeps {
  return {
    sendMessage: (message) => chrome.runtime.sendMessage(message),
  };
}

/** ブローカー応答を検証して token を取り出す共通処理 */
function unwrapToken(response: AuthResponse | undefined): string {
  if (!response) {
    throw new Error('認証ブローカーから応答がありません（service worker 未起動の可能性）');
  }
  if (!response.ok) {
    throw new Error(response.error);
  }
  if (typeof response.token !== 'string') {
    throw new Error('認証ブローカーの応答にトークンがありません');
  }
  return response.token;
}

/**
 * OAuth アクセストークンを取得する。
 * interactive=false はサイレント取得のみ（失敗時は throw）。
 * interactive=true は必要に応じて Google の認可ウィンドウを開く。
 */
export async function getAccessToken(deps: AuthClientDeps, interactive = false): Promise<string> {
  return unwrapToken(await deps.sendMessage({ type: 'auth:get-token', interactive }));
}

/**
 * サインイン中アカウントのメールを返す。未ログイン・取得失敗時は null
 * （UI の表示可否判断に使うため throw しない）
 */
export async function getSignedInEmail(deps: AuthClientDeps): Promise<string | null> {
  let response: AuthResponse | undefined;
  try {
    response = await deps.sendMessage({ type: 'auth:get-email' });
  } catch {
    return null;
  }
  if (!response || !response.ok) {
    return null;
  }
  return response.email ?? null;
}

/** トークンを破棄して強制的に再認可する（権限エラーからの回復用） */
export async function forceReauth(deps: AuthClientDeps): Promise<string> {
  return unwrapToken(await deps.sendMessage({ type: 'auth:force-reauth' }));
}

/**
 * ログアウト。ブローカーがトークンを revoke（ベストエフォート）し、
 * セッションのトークンと保存済みメールを破棄する
 */
export async function signOut(deps: AuthClientDeps): Promise<void> {
  try {
    await deps.sendMessage({ type: 'auth:clear' });
  } catch {
    // ログアウトはベストエフォート（SW 未起動等でも UI 側の遷移は続行させる）
  }
}
