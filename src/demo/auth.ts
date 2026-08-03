// デモモード用の認証クライアント差し替え（src/lib/google/auth.ts の代わり。webpack.config.js の
// NormalModuleReplacementPlugin で --env demo ビルド時のみ差し替わる）。
//
// 実物は service worker の認証ブローカー（src/background/authBroker.ts）へ
// chrome.runtime.sendMessage する薄いラッパだが、デモでは実 OAuth を一切行わず
// サインイン済み固定として振る舞う。AuthClientDeps は実物と同じ形（sendMessage を持つ
// オブジェクト）を維持しつつ、実際には使わない（呼ばれても固定トークンを返す）。
import { DEMO_TOKEN, DEMO_USER_EMAIL } from './constants';

/** 実物と同じ形を維持する（呼び出し側の型注釈・DI との互換性のため）。デモでは未使用 */
export interface AuthClientDeps {
  sendMessage: (message: unknown) => Promise<unknown>;
}

export function createChromeAuthClientDeps(): AuthClientDeps {
  return {
    sendMessage: async () => {
      console.warn('[demo] authBroker への sendMessage はデモでは発生しない想定です（呼び出しは無視されます）');
      return undefined;
    },
  };
}

/** OAuth アクセストークンを取得する。デモでは常に固定トークンを即返す（実ネットワークなし） */
export async function getAccessToken(_deps?: AuthClientDeps, _interactive = false): Promise<string> {
  return DEMO_TOKEN;
}

/** サインイン中アカウントのメール。デモでは常にデモ用アドレスを返す */
export async function getSignedInEmail(_deps?: AuthClientDeps): Promise<string | null> {
  return DEMO_USER_EMAIL;
}

/** 強制再認可。デモでは認可エラー自体が起きないため固定トークンを返すだけ */
export async function forceReauth(_deps?: AuthClientDeps): Promise<string> {
  return DEMO_TOKEN;
}

/** ログアウト。デモではセッション状態を変えない（no-op） */
export async function signOut(_deps?: AuthClientDeps): Promise<void> {
  console.warn('[demo] signOut はデモでは no-op です');
}
