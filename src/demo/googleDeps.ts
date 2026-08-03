// デモモード用の GoogleApiDeps 差し替え（src/app/services/factories.ts の代わり）。
//
// fetch は globalThis.fetch をそのまま渡す（実体は app-entry.ts / popup-entry.ts /
// options-entry.ts が起動直後に installDemoFetchMock() で差し替え済みの想定 — 呼び出し順序の
// 契約は各エントリファイル参照）。getAccessToken は実ネットワークに出ず固定トークンを返す。
import type { GoogleApiDeps } from '../lib/google/types';
import { DEMO_TOKEN } from './constants';

export function createChromeGoogleApiDeps(): GoogleApiDeps {
  return {
    fetch: (input, init) => globalThis.fetch(input, init),
    getAccessToken: async () => DEMO_TOKEN,
  };
}
