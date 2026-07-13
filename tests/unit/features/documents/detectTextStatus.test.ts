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

  // 複写スタンプ / 走りヘッダ・フッタ（全ページに繰り返す定型行）の除外
  // 実バグ: スキャン論文 PDF の全ページ上下に載る複写スタンプがテキスト層に本物のテキストとして
  // 含まれ、閾値 30 字を超えて no_text_layer を ok に化けさせていた（07 (3).pdf で再現）
  const STAMP =
    'Reproduced with permission of the copyright owner. Further reproduction prohibited without permission.';

  test('全ページが同一の複写スタンプだけなら no_text_layer（スタンプは上下に重複してもよい）', () => {
    // 各ページ上下にスタンプ。ページ内重複は 1 ページとして数える
    const page = `${STAMP}\n${STAMP}`;
    const result = detectTextStatus([{ text: page }, { text: page }, { text: page }]);
    expect(result.textStatus).toBe('no_text_layer');
    // charCount は生テキスト長のまま（定型行はステータス判定でのみ除外）
    expect(result.charCount).toBe(page.length * 3);
  });

  test('定型ヘッダが全ページに繰り返しても本文が残れば ok（本文 PDF は影響を受けない）', () => {
    const pages = [
      { text: `${STAMP}\n${SUBSTANTIVE}1` },
      { text: `${STAMP}\n${SUBSTANTIVE}2` },
      { text: `${STAMP}\n${SUBSTANTIVE}3` },
    ];
    expect(detectTextStatus(pages).textStatus).toBe('ok');
  });

  test('一部ページがスタンプのみ・残りは本文ありなら partial', () => {
    const result = detectTextStatus([
      { text: STAMP },
      { text: STAMP },
      { text: `${STAMP}\n\n${SUBSTANTIVE}3` },
      { text: `${STAMP}\n\n${SUBSTANTIVE}4` },
    ]);
    expect(result.textStatus).toBe('partial');
  });

  test('2 ページ以下では定型行を除外しない（繰り返し判定が不安定なため生テキストで数える）', () => {
    // 同一スタンプ 2 ページ。3 ページ未満なので除外せず、スタンプ長で ok になる
    expect(detectTextStatus([{ text: STAMP }, { text: STAMP }]).textStatus).toBe('ok');
  });

  test('定型行の照合は内部空白の差を吸収する（正規化キーで一致）', () => {
    const spaced = STAMP.replace(/ /g, '  '); // 内部空白を 2 倍にしても同一スタンプ扱い
    expect(
      detectTextStatus([{ text: STAMP }, { text: spaced }, { text: STAMP }]).textStatus,
    ).toBe('no_text_layer');
  });

  // 和文 PDF（issue #95 層 1）: 閾値 30 字/頁 は和文でも妥当。和文は 1 文字の情報量が
  // 多く本文ページは閾値を大きく超える（fixture 実測: J-STAGE 和文論文 11 頁の
  // 最小ページで実質 94 字。tests/fixtures/pdf/README.md の和文 fixture）
  test('和文の本文ページは閾値 30 字を満たし ok になる', () => {
    const jaBody = '本研究では準実験デザインを用いて歯科保健教育の効果を検討した．'.repeat(2);
    expect(detectTextStatus([{ text: jaBody }]).textStatus).toBe('ok');
  });

  test('和文でも柱・ページ番号だけのページは実質テキストなしと判定する', () => {
    const jaHeader = '日健教誌 2025; 33(3)'; // 空白除去後 14 字 < 30
    const jaBody = '本研究では準実験デザインを用いて歯科保健教育の効果を検討した．';
    expect(detectTextStatus([{ text: jaBody }, { text: jaHeader }]).textStatus).toBe('partial');
  });
});
