import { resolveAdjudicateQuotes, sameAdjudicateQuote, quoteCitation } from '../../../../src/features/adjudication/cellQuotes';
import { buildQuoteSetRows } from '../../../../src/features/verification/cellQuotes';
import type { CellQuote } from '../../../../src/domain/quoteSet';
import type { Evidence } from '../../../../src/domain/evidence';

const quote: CellQuote = { quoteId: 'q', evidenceId: 'q', studyId: 's', fieldId: 'f', entityKey: '-',
  source: 'ai', originAnnotator: null, documentId: 'd', quote: 'Some text', page: 1, section: null,
  theme: null, anchorStatus: 'exact', bboxPage: null, bbox: null, confidence: 'high' };
const evidence: Evidence = { evidenceId: 'q', runId: 'run', studyId: 's', fieldId: 'f', entityKey: '-',
  documentId: 'd', quote: 'Some text', page: 1, section: null, quoteSeq: null, quoteTheme: null,
  anchorStatus: 'exact', bboxPage: null, bbox: null, confidence: 'high', value: 'v',
  notReported: false, relocatedFrom: null };
const input: Parameters<typeof resolveAdjudicateQuotes>[0] = {
  studyId: 's', fieldId: 'f', entityKey: '-', annotatorA: 'a', annotatorB: 'b',
  annotatorTypeA: 'human_with_ai', annotatorTypeB: 'human_independent', quoteSetRows: [],
  evidence: [evidence], quoteEvidence: [evidence], armKeyRemap: new Map(),
};
function rows(annotator: string, quotes: CellQuote[], entityKey = '-') {
  return buildQuoteSetRows({ setId: annotator, savedAt: 'now', savedBy: annotator, annotator,
    annotatorType: annotator === 'consensus' ? 'consensus' : annotator === 'a' ? 'human_with_ai' : 'human_independent',
    studyId: 's', fieldId: 'f', entityKey, schemaVersion: 1, baseRunId: null, quotes });
}

test('未編集 with_ai だけが AI 引用を持ち、未選択 consensus は空', () => {
  const result = resolveAdjudicateQuotes(input);
  expect(result.quotesA).toEqual([quote]);
  expect(result.quotesB).toEqual([]);
  expect(result.consensus.edited).toBe(false);
  expect(result.consensus.quotes).toEqual([]);
  expect(result.candidates).toEqual([{ quote, owner: 'A', originAnnotator: 'a', adopted: false }]);
});
test('引用のないセルと独立抽出では AI を補わない', () => {
  expect(resolveAdjudicateQuotes({ ...input, evidence: [] }).candidates).toEqual([]);
  expect(resolveAdjudicateQuotes({ ...input, annotatorTypeA: 'human_independent' }).candidates).toEqual([]);
});
test('両者の同じ AI は一行へまとめて A を出所にする', () => {
  const result = resolveAdjudicateQuotes({ ...input, annotatorTypeB: 'human_with_ai' });
  expect(result.candidates).toEqual([{ quote, owner: 'both', originAnnotator: 'a', adopted: false }]);
});
test('同一文書の正規化テキストでもまとめ、別文書の同文は別候補', () => {
  const changed = { ...quote, quoteId: 'other', quote: 'Some  text', source: 'human' as const };
  const result = resolveAdjudicateQuotes({ ...input, quoteSetRows: [
    ...rows('b', [changed, { ...changed, quoteId: 'different', documentId: 'd2' }]),
    ...rows('consensus', [changed]),
  ] });
  expect(result.candidates.map((candidate) => [candidate.owner, candidate.adopted])).toEqual([
    ['both', true], ['B', false],
  ]);
  expect(sameAdjudicateQuote(quote, { ...quote, quoteId: 'x', quote: 'different text' })).toBe(false);
});
test('A の編集を採用し B は AI のまま、A を全削除しても復活しない', () => {
  const changed = { ...quote, quoteId: 'human', source: 'human' as const, quote: 'Correction' };
  const result = resolveAdjudicateQuotes({ ...input, annotatorTypeB: 'human_with_ai', quoteSetRows: rows('a', [changed]) });
  expect(result.quotesA[0]?.quote).toBe('Correction');
  expect(result.quotesB).toEqual([quote]);
  expect(result.candidates.map((candidate) => candidate.owner)).toEqual(['A', 'B']);
  expect(resolveAdjudicateQuotes({ ...input, quoteSetRows: rows('a', []) }).quotesA).toEqual([]);
});
test('B の群キーを正準セルに対応させ、全 run から座標と確信度を復元する', () => {
  const result = resolveAdjudicateQuotes({ ...input, entityKey: 'arm:1', evidence: [],
    armKeyRemap: new Map([['arm:2', 'arm:1']]),
    quoteSetRows: rows('b', [quote], 'arm:2'),
  });
  expect(result.quotesB[0]).toMatchObject({ entityKey: 'arm:1', confidence: 'high' });
  expect(result.candidates[0]).toMatchObject({ owner: 'B', originAnnotator: 'b' });
});
test('裁定者の独自引用と、明示的な空の最終一覧を区別する', () => {
  const own = { ...quote, quoteId: 'own', quote: 'Own text', source: 'human' as const };
  const result = resolveAdjudicateQuotes({ ...input, quoteSetRows: rows('consensus', [own]) });
  expect(result.added[0]).toMatchObject({ quoteId: 'own', source: 'human' });
  expect(result.consensus.edited).toBe(true);
  expect(resolveAdjudicateQuotes({ ...input, quoteSetRows: rows('consensus', []) }).consensus)
    .toMatchObject({ edited: true, quotes: [] });
});
test('片側の一覧内でも同じ引用を重複表示しない', () => {
  expect(resolveAdjudicateQuotes({ ...input, quoteSetRows: rows('a', [quote, quote]) }).candidates).toHaveLength(1);
});

test('照合情報を一時ハイライト用に変換する', () => {
  expect(quoteCitation(quote)).toMatchObject({ highlightable: true, anchorStatus: 'exact' });
  expect(quoteCitation({ ...quote, anchorStatus: null })).toMatchObject({ highlightable: false, anchorStatus: 'failed' });
  expect(quoteCitation({ ...quote, anchorStatus: 'failed' }).highlightable).toBe(false);
});


test.each([false, true])('未編集 B の AI 引用を群対応で読み替える（恒等: %s）', (identity) => {
  const evidenceA = { ...evidence, entityKey: 'arm:1', evidenceId: 'a-ai', quote: 'A source' };
  const evidenceB = { ...evidence, entityKey: 'arm:2', evidenceId: 'b-ai', quote: 'B source' };
  const result = resolveAdjudicateQuotes({ ...input, entityKey: 'arm:1', annotatorTypeB: 'human_with_ai',
    evidence: [evidenceA, evidenceB], quoteEvidence: [evidenceA, evidenceB],
    armKeyRemap: new Map(identity ? [['arm:1', 'arm:1'], ['arm:2', 'arm:2']]
      : [['arm:2', 'arm:1'], ['arm:1', 'arm:2']]),
  });
  expect(result.quotesA[0]).toMatchObject({ quote: 'A source', entityKey: 'arm:1' });
  expect(result.quotesB[0]).toMatchObject({ quote: identity ? 'A source' : 'B source', entityKey: 'arm:1' });
  expect(result.candidates.map((candidate) => candidate.owner)).toEqual(identity ? ['both'] : ['A', 'B']);
});
