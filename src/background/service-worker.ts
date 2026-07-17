// MV3 service worker。エントリは起動フックのみ（実処理は bootstrap.ts / authBroker.ts）
import {
  createAuthBroker,
  createAuthMessageListener,
  createChromeWebAuthDeps,
} from './authBroker';
import { createChromeBackgroundDeps, handleActionClick } from './bootstrap';

chrome.runtime.onInstalled.addListener(() => {
  console.log('sr-data-extraction-plugin: installed');
});

// manifest に default_popup を持たないため、アイコンクリックはここへ届く
chrome.action.onClicked.addListener(() => {
  void handleActionClick(createChromeBackgroundDeps());
});

// 認証ブローカー（issue #129）: 各ページからの認証依頼を SW で一元処理する。
// MV3 の作法どおりリスナーは起動時に同期登録する（単一飛行ガードは SW 内で共有）
const authListener = createAuthMessageListener(createAuthBroker(createChromeWebAuthDeps()));
chrome.runtime.onMessage.addListener((message, _sender, sendResponse) =>
  authListener(message, sendResponse),
);
