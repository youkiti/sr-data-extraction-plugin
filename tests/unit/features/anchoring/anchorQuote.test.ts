// 段階的マッチングの table-driven テスト（architecture.md §4.3 / requirements.md §5-2）。
// quote / ページテキストは正規化済み前提の API のため、テストへは正規化後の文字列を渡す
// （和文の統合ケースのみ normalizeText を通して正規化との連携を検証する）
import { anchorQuote, FUZZY_DISTANCE_RATIO_THRESHOLD } from '../../../../src/features/anchoring/anchorQuote';
import { normalizeText } from '../../../../src/features/anchoring/normalizeText';
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

  // 和文（issue #95 層 1）: 正規化 → 段階的マッチングの連携を実際の和文パターンで検証する
  describe('和文（正規化との統合）', () => {
    test('行折り返し（hasEOL 由来の改行）を含む和文ページに、改行なしの quote が exact で当たる', () => {
      // テキスト層は行末ごとに改行が入る（和文は行折り返しに空白を持たない）が、
      // LLM の verbatim quote は折り返しなしの連続文字列で返る
      const pageText = '本研究ではよりバイア\nスに対処可能なデザインを用い，効果を検\n討した．';
      const quote = '本研究ではよりバイアスに対処可能なデザインを用い，効果を検討した．';
      const result = anchorQuote(
        normalizeText(quote),
        [{ page: 1, text: normalizeText(pageText) }],
        1,
      );
      expect(result.status).toBe('exact');
      expect(result.page).toBe(1);
    });

    test('波ダッシュ（U+301C）と全角チルダ（U+FF5E）の揺れを正規化が吸収して exact になる', () => {
      const pageText = '対象は生後 1〜2 歳の幼児とした'; // テキスト層: JIS 由来の波ダッシュ
      const quote = '生後1～2歳の幼児'; // LLM 出力: CP932 由来の全角チルダ
      const result = anchorQuote(
        normalizeText(quote),
        [{ page: 1, text: normalizeText(pageText) }],
        1,
      );
      expect(result.status).toBe('exact');
    });

    test('和文の fuzzy: 連続文字列でも文字単位の編集距離で回収される（15% 閾値）', () => {
      // quote 13 文字・1 文字置換（保健 → 保険）→ 距離 1 ≤ ceil(13 × 0.15) = 2
      const page = normalizeText('主要評価項目は子に対する歯科保健行動得点とした');
      const result = anchorQuote(
        normalizeText('子に対する歯科保険行動得点'),
        [{ page: 1, text: page }],
        1,
      );
      expect(result.status).toBe('fuzzy');
      expect(result.bestDistance).toBe(1);
    });
  });
});
