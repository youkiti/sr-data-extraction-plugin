// 拡張 ID の発見用（Playwright が serviceWorker イベントから ID を取る）。処理は持たない。
chrome.action.onClicked.addListener(() => {
  void chrome.tabs.create({ url: chrome.runtime.getURL('app.html') });
});
