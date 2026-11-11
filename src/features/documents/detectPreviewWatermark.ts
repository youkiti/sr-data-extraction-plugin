/** ページ末尾に繰り返されるプレビュー版の透かしを検出する。 */
export function detectPreviewWatermark(pages: readonly { text: string }[]): boolean {
  const matched = pages.filter(({ text }) => {
    const lines = text.split(/\r\n|\r|\n/).map((line) => line.trim()).filter((line) => line !== '');
    return /^(PREVIEW|SAMPLE|EXCERPT)$/i.test(lines[lines.length - 1] ?? '');
  }).length;
  return matched >= 2 && matched * 2 >= pages.length;
}
