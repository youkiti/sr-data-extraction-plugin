/** 拡張ランタイムがある場合に manifest の版を取得する。 */
export function getToolVersion(): string | null {
  if (
    typeof chrome !== 'undefined' &&
    chrome.runtime &&
    typeof chrome.runtime.getManifest === 'function'
  ) {
    return chrome.runtime.getManifest().version;
  }
  return null;
}
