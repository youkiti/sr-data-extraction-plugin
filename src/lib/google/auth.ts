// sr-query-builder-plugin の lib/google/auth.ts をコピー流用（architecture.md §7-3）

/**
 * Chrome の identity API 周りの薄いラッパ。
 * chrome.identity.getAuthToken は MV3 では Promise 版も提供されているが
 * 型定義を揺らさないようコールバック版を明示的に Promise 化する。
 */

export interface AuthDeps {
  /** OAuth アクセストークンを取得（失効・未同意時は interactive=true で同意フロー起動） */
  getAuthToken: (options?: { interactive?: boolean }) => Promise<string>;
  /** 失効したトークンをキャッシュから除去 */
  removeCachedAuthToken: (token: string) => Promise<void>;
}

export function createChromeAuthDeps(): AuthDeps {
  return {
    getAuthToken: (options = {}) =>
      new Promise<string>((resolve, reject) => {
        chrome.identity.getAuthToken(options, (result) => {
          const err = chrome.runtime.lastError;
          // Chrome 115+ の型定義ではコールバックが GetAuthTokenResult({token}) を受ける。
          // 旧実装（token 文字列を直接渡す）との揺れに備えて両対応にする
          const token = typeof result === 'string' ? result : result?.token;
          if (err || !token) {
            reject(new Error(err?.message ?? 'getAuthToken returned empty token'));
            return;
          }
          resolve(token);
        });
      }),
    removeCachedAuthToken: (token) =>
      new Promise<void>((resolve) => {
        chrome.identity.removeCachedAuthToken({ token }, () => resolve());
      }),
  };
}

/**
 * トークンを取得する薄いヘルパ。呼び出し側が毎回オプションを書かずに済むようにする。
 */
export async function getAccessToken(deps: AuthDeps, interactive = false): Promise<string> {
  return deps.getAuthToken({ interactive });
}

/**
 * 401 を受けたときにキャッシュを無効化してから再取得するリトライループ用のヘルパ。
 */
export async function refreshAccessToken(
  deps: AuthDeps,
  staleToken: string
): Promise<string> {
  await deps.removeCachedAuthToken(staleToken);
  return deps.getAuthToken({ interactive: true });
}
