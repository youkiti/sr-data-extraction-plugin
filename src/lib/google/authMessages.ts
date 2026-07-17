// 認証メッセージプロトコル（issue #129）。
// 認証の実体は service worker の認証ブローカー（src/background/authBroker.ts）にあり、
// 各拡張ページ（popup / app / options）は chrome.runtime.sendMessage で依頼する。
// ページ直呼びだと launchWebAuthFlow の単一飛行ガードがタブ間で効かず
// 認可ウィンドウが多重に開き得るため、SW に一元化する。
// 型はクライアント（lib/google/auth.ts）とブローカーの双方から参照する。

/** ブローカーへの依頼メッセージ */
export type AuthRequest =
  | { type: 'auth:get-token'; interactive: boolean }
  | { type: 'auth:get-email' }
  | { type: 'auth:force-reauth' }
  | { type: 'auth:clear' };

/** ブローカーからの応答。失敗はエラーメッセージ文字列で返す（Error は構造化クローン不可） */
export type AuthResponse =
  | { ok: true; token?: string; email?: string | null }
  | { ok: false; error: string };

/** onMessage は拡張内の全メッセージを受けるため、認証宛てかを堅く判定する */
export function isAuthRequest(message: unknown): message is AuthRequest {
  if (typeof message !== 'object' || message === null) {
    return false;
  }
  const record = message as Record<string, unknown>;
  if (record.type === 'auth:get-token') {
    return typeof record.interactive === 'boolean';
  }
  return (
    record.type === 'auth:get-email' ||
    record.type === 'auth:force-reauth' ||
    record.type === 'auth:clear'
  );
}
