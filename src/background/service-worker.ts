// MV3 service worker。スケルトン段階はインストールフックのみ
// （オフラインキューの再送タイマー等はオフライン同期の実装時に追加する）
chrome.runtime.onInstalled.addListener(() => {
  console.log('sr-data-extraction-plugin: installed');
});
