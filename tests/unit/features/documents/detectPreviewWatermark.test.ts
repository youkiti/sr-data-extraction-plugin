import { detectPreviewWatermark } from '../../../../src/features/documents/detectPreviewWatermark';

const pages = (texts: string[]): { text: string }[] => texts.map((text) => ({ text }));

test('24ページすべての末尾に透かしがある実例', () => {
  expect(detectPreviewWatermark(pages(Array(24).fill('本文\nPREVIEW')))).toBe(true);
});

test.each([
  [[], false],
  [['', ' \n\t'], false],
  [['本文\nPREVIEW'], false],
  [['PREVIEW', '本文'], false],
  [['PREVIEW', 'PREVIEW', '', '', ''], false],
  [['PREVIEW', 'PREVIEW', '', ''], true],
  [['本文\n結論', '本文に preview という語\n結論'], false],
  [['PREVIEW\n結論', 'PREVIEW\n本文'], false],
  [['本文\r\n preView \r\n\t\r\n', '本文\r PREVIEW \r'], true],
  [['本文\nSAMPLE', '本文\nsample'], true],
  [['本文\nexcerpt', '本文\nEXCERPT'], true],
  [['本文\nPREVIEW ONLY', '本文\nSAMPLES'], false],
] as [string[], boolean][])('末尾行・割合・表記を判定する: %j', (texts, expected) => {
  expect(detectPreviewWatermark(pages(texts))).toBe(expected);
});
