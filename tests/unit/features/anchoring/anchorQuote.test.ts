// 段階的マッチングの table-driven テスト（architecture.md §4.3 / requirements.md §5-2）。
// quote / ページテキストは正規化済み前提の API のため、テストへは正規化後の文字列を渡す
import { anchorQuote, FUZZY_DISTANCE_RATIO_THRESHOLD } from '../../../../src/features/anchoring/anchorQuote';
import type { NormalizedPage } from '../../../../src/domain/anchor';

function pages(...texts: string[]): NormalizedPage[] {
  return texts.map((text, index) => ({ page: index + 1, text }));
}

describe('anchorQuote', () => {
  test('fuzzy 閾値は quote 長の 15%（requirements.md §5-2）', () => {
    expect(FUZZY_DISTANCE_RATIO_THRESHOLD).toBe(0.15);
  });

  test('空 quote は failed', () => {
    expect(anchorQuote('', pages('some text'), 1)).toEqual({
      status: 'failed',
      page: null,
      matchCount: 0,
      bestDistance: null,
      distanceRatio: null,
    });
  });

  describe('exact（ai_page ± 1 での完全一致）', () => {
    test('ai_page と同一ページの一致', () => {
      const result = anchorQuote('target quote', pages('intro', 'the target quote here'), 2);
      expect(result).toEqual({
        status: 'exact',
        page: 2,
        matchCount: 1,
        bestDistance: 0,
        distanceRatio: 0,
      });
    });

    test('ai_page ± 1 の隣接ページの一致も exact 扱い', () => {
      const result = anchorQuote('target quote', pages('intro', 'body', 'the target quote here'), 2);
      expect(result.status).toBe('exact');
      expect(result.page).toBe(3);
    });

    test('複数一致でも window 内があれば exact（matchCount は全ページ合計）', () => {
      const result = anchorQuote(
        'p = 0.54',
        pages('abstract p = 0.54', 'body p = 0.54 and p = 0.54 again', 'discussion'),
        2,
      );
      expect(result.status).toBe('exact');
      expect(result.page).toBe(2);
      expect(result.matchCount).toBe(3);
    });
  });

  describe('normalized（全ページでの完全一致）', () => {
    test('ai_page から離れたページの一致は normalized', () => {
      const result = anchorQuote('target quote', pages('intro', 'body', 'more', 'x', 'the target quote'), 1);
      expect(result).toEqual({
        status: 'normalized',
        page: 5,
        matchCount: 1,
        bestDistance: 0,
        distanceRatio: 0,
      });
    });

    test('ai_page が null なら window 判定をスキップし、最初の一致ページを返す', () => {
      const result = anchorQuote('target quote', pages('the target quote', 'x', 'the target quote'), null);
      expect(result.status).toBe('normalized');
      expect(result.page).toBe(1);
      expect(result.matchCount).toBe(2);
    });

    test('複数一致時は ai_page に最も近いページを採用する（abstract と本文の重複想定）', () => {
      const result = anchorQuote(
        'mortality was 12%',
        pages('abstract: mortality was 12%', 'methods', 'results', 'discussion: mortality was 12%'),
        9,
      );
      expect(result.status).toBe('normalized');
      expect(result.page).toBe(4);
      expect(result.matchCount).toBe(2);
    });
  });

  describe('fuzzy（編集距離 ≤ quote 長の 15%）', () => {
    test('pdf_native モードの空白脱落を回収する（スパイク実測の逸脱パターン）', () => {
      // quote "(n = 72)" vs テキスト層 "(n=72)" → 距離 2 ≤ ceil(8 × 0.15) = 2
      const result = anchorQuote('(n = 72)', pages('', 'patients (n=72) were enrolled'), 2);
      expect(result.status).toBe('fuzzy');
      expect(result.page).toBe(2);
      expect(result.bestDistance).toBe(2);
      expect(result.distanceRatio).toBeCloseTo(2 / 8);
    });

    test('2 段組の読み順ずれ・表セル由来の軽微な差異を回収する', () => {
      const result = anchorQuote(
        'mortality was 12% in group A',
        pages('results: mortality was 12 % in group A overall'),
        1,
      );
      expect(result.status).toBe('fuzzy');
      expect(result.page).toBe(1);
      expect(result.bestDistance).toBe(1);
    });

    test('閾値ちょうど（ceil(20 × 0.15) = 3）は fuzzy、超過は failed', () => {
      const quote = 'abcdefghijklmnopqrst'; // 20 文字
      const withinThreshold = anchorQuote(quote, pages('abcdefghijklmnopqXYZ and more'), 1);
      expect(withinThreshold.status).toBe('fuzzy');
      expect(withinThreshold.bestDistance).toBe(3);

      const beyondThreshold = anchorQuote(quote, pages('abcdefghijklmnopWXYZ and more'), 1);
      expect(beyondThreshold.status).toBe('failed');
      expect(beyondThreshold.bestDistance).toBe(4);
      expect(beyondThreshold.page).toBeNull();
    });

    test('同距離のページが複数あるときは ai_page に近い方を採用する', () => {
      const quote = 'abcdefghij'; // 10 文字、閾値 ceil(1.5) = 2
      const candidatePages = pages('abcdefghiX padding', 'unrelated', 'unrelated', 'abcdefghiY padding');
      const nearFourth = anchorQuote(quote, candidatePages, 4);
      expect(nearFourth.status).toBe('fuzzy');
      expect(nearFourth.page).toBe(4);

      // ai_page が null のときは先に走査したページを保持する
      const noHint = anchorQuote(quote, candidatePages, null);
      expect(noHint.status).toBe('fuzzy');
      expect(noHint.page).toBe(1);
    });

    test('空テキストのページ（no_text_layer 相当）は走査をスキップする', () => {
      // 'targett'（1 文字余分）は完全一致しないため fuzzy 段へ進み、空ページはスキップされる
      const result = anchorQuote('targett text', pages('', 'the target text here'), 1);
      expect(result.status).toBe('fuzzy');
      expect(result.page).toBe(2);
      expect(result.bestDistance).toBe(1);
    });
  });

  describe('failed', () => {
    test('どのページにも近い一致がない場合', () => {
      const result = anchorQuote('completely unrelated quote', pages('lorem ipsum dolor sit amet'), 1);
      expect(result.status).toBe('failed');
      expect(result.page).toBeNull();
      expect(result.matchCount).toBe(0);
      expect(result.bestDistance).toBeGreaterThan(0);
      expect(result.distanceRatio).toBeGreaterThan(FUZZY_DISTANCE_RATIO_THRESHOLD);
    });

    test('ページまたぎ quote は現行方式では回収できない（既知の制約）', () => {
      const result = anchorQuote('alpha beta gamma delta', pages('... alpha beta', 'gamma delta ...'), 1);
      expect(result.status).toBe('failed');
    });
  });
});
