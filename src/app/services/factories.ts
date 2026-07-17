// Chrome 拡張ランタイムから Google API 依存（GoogleApiDeps）を組み立てる薄いファクトリ。
// popup / app / options のエントリから呼び、各 service へ注入する
import {
  createChromeAuthClientDeps,
  getAccessToken,
  type AuthClientDeps,
} from '../../lib/google/auth';
import type { GoogleApiDeps } from '../../lib/google/types';

export function createChromeGoogleApiDeps(auth?: AuthClientDeps): GoogleApiDeps {
  const client = auth ?? createChromeAuthClientDeps();
  return {
    fetch: (input, init) => globalThis.fetch(input, init),
    // interactive=true: 同意済みならブローカーのキャッシュ / サイレント再取得で
    // 即トークンが返り（UI は出ない）、未同意時のみ Google の認可ウィンドウを開く。
    // false だと初回常に失敗し popup / app 双方でログイン導線が成立しないため
    // true 固定とする（getAuthToken 時代からの運用を踏襲）
    getAccessToken: () => getAccessToken(client, true),
  };
}
