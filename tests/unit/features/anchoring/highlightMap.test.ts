import { anchorQuote } from '../../../../src/features/anchoring/anchorQuote';
import { highlightMap } from '../../../../src/features/anchoring/highlightMap';
import { locateQuoteRange } from '../../../../src/features/anchoring/locateQuote';
import {
  normalizeText,
  normalizeTextWithMap,
  toRawRange,
} from '../../../../src/features/anchoring/normalizeText';
import type { CharRange } from '../../../../src/domain/anchor';
import type { TextLayerItem } from '../../../../src/domain/textLayer';

/**
 * テスト用の合成テキスト層を組み立てる（extract-text と同じ規則:
 * text は str の連結で、hasEOL の位置に \n を挿入）。幅は 1 文字 = 10pt の等幅
 */
function buildPage(specs: Array<{ str: string; x: number; y: number; hasEOL?: boolean }>): {
  text: string;
  items: TextLayerItem[];
} {
  let text = '';
  const items: TextLayerItem[] = specs.map((spec) => {
    const hasEOL = spec.hasEOL ?? true;
    const item: TextLayerItem = {
      charStart: text.length,
      str: spec.str,
      transform: [1, 0, 0, 1, spec.x, spec.y],
      width: spec.str.length * 10,
      height: 10,
      hasEOL,
    };
    text += spec.str + (hasEOL ? '\n' : '');
    return item;
  });
  return { text, items };
}

describe('highlightMap', () => {
  test('複数 item にまたがる範囲は item ごとの矩形になる（改行文字は矩形を持たない）', () => {
    const { items } = buildPage([
      { str: 'abcde', x: 50, y: 700 },
      { str: 'fghij', x: 50, y: 688 },
    ]);
    // text = 'abcde\nfghij\n'。範囲 [2, 8) は 'cde\nfg' をカバーする
    expect(highlightMap(items, { start: 2, end: 8 })).toEqual([
      { itemIndex: 0, x: 70, y: 700, width: 30, height: 10 },
      { itemIndex: 1, x: 50, y: 688, width: 20, height: 10 },
    ]);
  });

  test('item 内の部分一致は文字数比例で幅を按分する', () => {
    const { items } = buildPage([{ str: 'abcdef', x: 10, y: 0 }]);
    expect(highlightMap(items, { start: 2, end: 4 })).toEqual([
      { itemIndex: 0, x: 30, y: 0, width: 20, height: 10 },
    ]);
  });

  test('範囲の前後にある item は含まれない', () => {
    const { items } = buildPage([
      { str: 'ab', x: 0, y: 0 },
      { str: 'cd', x: 0, y: -12 },
      { str: 'ef', x: 0, y: -24 },
    ]);
    // text = 'ab\ncd\nef\n'。範囲 [3, 5) は 'cd' のみ
    expect(highlightMap(items, { start: 3, end: 5 })).toEqual([
      { itemIndex: 1, x: 0, y: -12, width: 20, height: 10 },
    ]);
  });

  test('空 item（改行のみ等）は矩形を持たない', () => {
    const { items } = buildPage([
      { str: '', x: 0, y: 0 },
      { str: 'abc', x: 0, y: -12 },
    ]);
    // text = '\nabc\n'。範囲 [0, 4) は空 item を跨ぐが矩形は 1 個
    expect(highlightMap(items, { start: 0, end: 4 })).toEqual([
      { itemIndex: 1, x: 0, y: -12, width: 30, height: 10 },
    ]);
  });

  test('空範囲・逆転範囲は空配列', () => {
    const { items } = buildPage([{ str: 'abc', x: 0, y: 0 }]);
    expect(highlightMap(items, { start: 1, end: 1 })).toEqual([]);
    expect(highlightMap(items, { start: 2, end: 1 })).toEqual([]);
  });
});

describe('アンカリング一気通貫（正規化 → anchorQuote → locateQuoteRange → toRawRange → highlightMap）', () => {
  test('ハイフネーション・リガチャを含む 2 行の quote がハイライト矩形 2 個になる', () => {
    const { text, items } = buildPage([
      { str: 'The eﬃcacy of exam-', x: 50, y: 700 },
      { str: 'ple therapy was high.', x: 50, y: 688 },
    ]);
    const pageMap = normalizeTextWithMap(text);
    expect(pageMap.text).toBe('The efficacy of example therapy was high.');

    const quote = normalizeText('eﬃcacy of exam-\nple therapy');
    const anchor = anchorQuote(quote, [{ page: 1, text: pageMap.text }], 1);
    expect(anchor.status).toBe('exact');

    const normRange = locateQuoteRange(quote, pageMap.text, anchor.status);
    expect(normRange).toEqual({ start: 4, end: 31 });

    const rawRange = toRawRange(pageMap, normRange as CharRange);
    const rects = highlightMap(items, rawRange as CharRange);
    const line1Length = 'The eﬃcacy of exam-'.length;
    expect(rects).toEqual([
      // 1 行目: 'eﬃcacy of exam-'（raw offset 4）から行末まで
      { itemIndex: 0, x: 50 + 4 * 10, y: 700, width: (line1Length - 4) * 10, height: 10 },
      // 2 行目: 'ple therapy' まで
      { itemIndex: 1, x: 50, y: 688, width: 'ple therapy'.length * 10, height: 10 },
    ]);
  });
});
