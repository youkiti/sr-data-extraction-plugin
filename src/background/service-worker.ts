// MV3 service worker。エントリは起動フックのみ（実処理は bootstrap.ts）
import { createChromeBackgroundDeps, handleActionClick } from './bootstrap';

chrome.runtime.onInstalled.addListener(() => {
  console.log('sr-data-extraction-plugin: installed');
});

// manifest に default_popup を持たないため、アイコンクリックはここへ届く
chrome.action.onClicked.addListener(() => {
  void handleActionClick(createChromeBackgroundDeps());
});
