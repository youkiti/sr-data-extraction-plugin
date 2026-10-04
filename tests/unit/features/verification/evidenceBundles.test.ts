import type { Evidence } from '../../../../src/domain/evidence';
import { cellKeyOf } from '../../../../src/features/verification/cellState';
import { bundleEvidence, quoteKeyOf, cellKeyFromQuoteKey } from '../../../../src/features/verification/evidenceBundles';

const row = (overrides: Partial<Evidence> = {}): Evidence => ({
  evidenceId: 'ev', runId: 'run', studyId: 'study', documentId: 'doc',
  fieldId: 'field', entityKey: '-', value: 'themes', notReported: false,
  quote: 'quote', page: 1, confidence: 'high', anchorStatus: 'exact',
  bbox: null, bboxPage: null, relocatedFrom: null, quoteTheme: null, quoteSeq: null, section: null,
  ...overrides,
});

test('空配列・通常セルは後勝ちで引用一覧は空', () => {
  expect(bundleEvidence([]).size).toBe(0);
  const latest = row({ evidenceId: 'latest' });
  expect([...bundleEvidence([row(), latest]).values()]).toEqual([{ evidence: latest, quotes: [] }]);
});

test('テーマの無い断片も同じ run のセルへ束ね、先頭を代表にする', () => {
  const first = row({ evidenceId: 'first', quoteSeq: 1, quote: 'Age, M (SD)', value: '46.53', page: 1 });
  const second = row({ evidenceId: 'second', quoteSeq: 2, quote: '46.53 (6.31)', value: '46.53', page: 5 });
  expect([...bundleEvidence([row({ runId: 'old' }), first, second]).values()]).toEqual([
    { evidence: first, quotes: [first, second] },
  ]);
});

test('最後の行の run だけを seq ごとに後勝ちにして昇順に束ねる', () => {
  const first = row({ quoteSeq: 1, evidenceId: 'first' });
  const second = row({ quoteSeq: 2, evidenceId: 'second' });
  const items = [row({ runId: 'old', quoteSeq: 3 }), row({ quoteSeq: 1 }), second, first, row()];
  expect([...bundleEvidence(items).values()]).toEqual([{ evidence: first, quotes: [first, second] }]);
  expect([...bundleEvidence([...items, row({ runId: 'new' })]).values()][0]?.quotes).toEqual([]);
});

test('引用キーは通常セルのキーを維持し、任意文字でもセルへ復元できる', () => {
  const evidence = row({ fieldId: '["x",2]', entityKey: 'a|b\\"' });
  const cellKey = cellKeyOf(evidence.fieldId, evidence.entityKey);
  expect(quoteKeyOf(evidence)).toBe(cellKey);
  expect(cellKeyFromQuoteKey(cellKey)).toBe(cellKey);
  const first = quoteKeyOf({ ...evidence, quoteSeq: 1 });
  expect(first).not.toBe(quoteKeyOf({ ...evidence, quoteSeq: 2 }));
  expect(cellKeyFromQuoteKey(first)).toBe(cellKey);
});
