import {
  MIN_SUBSTANTIVE_PAGE_CHARS,
  detectTextStatus,
} from '../../../../src/features/documents/detectTextStatus';

const SUBSTANTIVE = 'a'.repeat(MIN_SUBSTANTIVE_PAGE_CHARS);

describe('detectTextStatus', () => {
  test('全ページに実質テキストがあれば ok、件数を集計する', () => {
    const result = detectTextStatus([{ text: SUBSTANTIVE }, { text: `${SUBSTANTIVE}extra` }]);
    expect(result).toEqual({
      textStatus: 'ok',
      pageCount: 2,
      charCount: SUBSTANTIVE.length * 2 + 'extra'.length,
    });
  });

  test('一部ページのみ実質テキストなら partial', () => {
    expect(detectTextStatus([{ text: SUBSTANTIVE }, { text: 'p. 12' }]).textStatus).toBe(
      'partial',
    );
  });

  test('全ページ実質テキストなしなら no_text_layer（透かし・ページ番号だけは数えない）', () => {
    expect(detectTextStatus([{ text: 'p. 12' }, { text: '' }]).textStatus).toBe('no_text_layer');
  });

  test('閾値は空白除去後の文字数で判定する（境界値）', () => {
    // ちょうど閾値 = 実質テキストあり
    expect(detectTextStatus([{ text: SUBSTANTIVE }]).textStatus).toBe('ok');
    // 1 文字足りない = なし
    expect(detectTextStatus([{ text: 'a'.repeat(MIN_SUBSTANTIVE_PAGE_CHARS - 1) }]).textStatus).toBe(
      'no_text_layer',
    );
    // 空白は数えない
    const padded = `${'a'.repeat(MIN_SUBSTANTIVE_PAGE_CHARS - 1)} \n\t `;
    expect(detectTextStatus([{ text: padded }]).textStatus).toBe('no_text_layer');
  });

  test('0 ページは no_text_layer・件数 0', () => {
    expect(detectTextStatus([])).toEqual({
      textStatus: 'no_text_layer',
      pageCount: 0,
      charCount: 0,
    });
  });
});
