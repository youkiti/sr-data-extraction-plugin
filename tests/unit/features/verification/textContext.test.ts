import type { Evidence } from '../../../../src/domain/evidence';
import {
  CONTEXT_CHARS,
  findQuoteContext,
  type TextContextPage,
} from '../../../../src/features/verification/textContext';

function makeEvidence(overrides: Partial<Evidence> = {}): Evidence {
  return {
    evidenceId: 'ev-1',
    runId: 'run-1',
    studyId: 'study-1',
    documentId: 'doc-1',
    fieldId: 'f-1',
    entityKey: '-',
    value: '12',
    notReported: false,
    quote: 'mortality was 12 percent',
    page: 1,
    confidence: 'high',
    anchorStatus: 'exact',
    bboxPage: null,
    bbox: null,
    ...overrides,
  };
}

function page(pageNumber: number, text: string): TextContextPage {
  return { page: pageNumber, text };
}

describe('findQuoteContext', () => {
  test('quote なしは null', () => {
    expect(findQuoteContext(makeEvidence({ quote: null }), [page(1, 'anything')])).toBeNull();
  });

  test('正規化で空になる quote（空白のみ）は null', () => {
    expect(findQuoteContext(makeEvidence({ quote: '   ' }), [page(1, 'anything')])).toBeNull();
  });

  test('全ページ探索でも一致しなければ null', () => {
    const pages = [page(1, 'nothing relevant here'), page(2, 'still nothing')];
    expect(findQuoteContext(makeEvidence(), pages)).toBeNull();
  });

  test('単一ページの exact 一致で前後文脈を切り出す', () => {
    const pages = [page(1, 'intro. mortality was 12 percent overall. conclusion.')];
    const context = findQuoteContext(makeEvidence({ page: 1 }), pages);
    expect(context).toEqual({
      page: 1,
      snippet: {
        before: 'intro. ',
        quote: 'mortality was 12 percent',
        after: ' overall. conclusion.',
      },
    });
  });

  test('ai_page に最も近い出現を既定にする（複数ページに出現）', () => {
    const pages = [
      page(1, 'in this trial mortality was 12 percent overall'),
      page(2, 'we repeat: mortality was 12 percent in both arms'),
    ];
    const context = findQuoteContext(makeEvidence({ page: 2 }), pages);
    expect(context?.page).toBe(2);
    expect(context?.snippet.quote).toBe('mortality was 12 percent');
  });

  test('ai_page が null なら先頭ページの出現を既定にする', () => {
    const pages = [
      page(1, 'in this trial mortality was 12 percent overall'),
      page(2, 'we repeat: mortality was 12 percent in both arms'),
    ];
    const context = findQuoteContext(makeEvidence({ page: null }), pages);
    expect(context?.page).toBe(1);
  });

  test('記録ページ（ai_page）に quote が無くても他ページから再特定する（anchor failed のフォールバック）', () => {
    // page 1 は無関係な本文（recorded page）。実際の quote は page 2 にしかない
    const pages = [
      page(1, 'nothing about mortality on this page'),
      page(2, 'mortality was 12 percent in the appendix'),
    ];
    const context = findQuoteContext(
      makeEvidence({ page: 1, anchorStatus: 'failed' }),
      pages,
    );
    expect(context?.page).toBe(2);
    expect(context?.snippet.quote).toBe('mortality was 12 percent');
  });

  test('normalized 相当: ハイフネーションを跨いで再特定できる', () => {
    const pages = [page(1, 'the exam-\nple text continues here')];
    const context = findQuoteContext(
      makeEvidence({ quote: 'example text', page: 1, anchorStatus: 'normalized' }),
      pages,
    );
    expect(context?.snippet.quote).toBe('exam-\nple text');
  });

  test('前後 CONTEXT_CHARS 文字に切り詰める', () => {
    const before = 'b'.repeat(CONTEXT_CHARS + 50);
    const after = 'a'.repeat(CONTEXT_CHARS + 50);
    const pages = [page(1, `${before}mortality was 12 percent${after}`)];
    const context = findQuoteContext(makeEvidence({ page: 1 }), pages);
    expect(context?.snippet.before).toHaveLength(CONTEXT_CHARS);
    expect(context?.snippet.before).toBe('b'.repeat(CONTEXT_CHARS));
    expect(context?.snippet.after).toHaveLength(CONTEXT_CHARS);
    expect(context?.snippet.after).toBe('a'.repeat(CONTEXT_CHARS));
  });

  test('ページ先頭付近では前文脈が短くなる（ページを跨いで連結しない）', () => {
    const pages = [page(1, 'mortality was 12 percent overall')];
    const context = findQuoteContext(makeEvidence({ page: 1 }), pages);
    expect(context?.snippet.before).toBe('');
    expect(context?.snippet.after).toBe(' overall');
  });

  test('ページ末尾付近では後文脈が短くなる（ページを跨いで連結しない）', () => {
    const pages = [page(1, 'overall mortality was 12 percent')];
    const context = findQuoteContext(makeEvidence({ page: 1 }), pages);
    expect(context?.snippet.before).toBe('overall ');
    expect(context?.snippet.after).toBe('');
  });
});
