// Chrome 拡張ランタイムから Google API 依存（GoogleApiDeps）を組み立てる薄いファクトリ。
// popup / app / options のエントリから呼び、各 service へ注入する
import { createChromeAuthDeps, getAccessToken, type AuthDeps } from '../../lib/google/auth';
import type { GoogleApiDeps } from '../../lib/google/types';

export function createChromeGoogleApiDeps(auth?: AuthDeps): GoogleApiDeps {
  const a = auth ?? createChromeAuthDeps();
  return {
    fetch: (input, init) => globalThis.fetch(input, init),
    // interactive=true: 未同意時は Chrome の OAuth 同意 UI を開き、
    // 同意済みならキャッシュされたトークンを即返す（UI は出ない）。
    // false だと初回常に "OAuth2 not granted or revoked" になり、
    // popup / app 双方でログイン導線が成立しないため true 固定とする
    // （sr-query-builder の運用実績を踏襲）。
    getAccessToken: () => getAccessToken(a, true),
  };
}
