import {
  aiCellQuotes, buildQuoteSetResetRow, buildQuoteSetRows, foldQuoteSets,
  quoteSetKeyOf, removeCellQuote, resolveCellQuotes, setCellQuoteTheme,
} from '../../../../src/features/verification/cellQuotes';
import { evidence, quoteRow } from './quoteSetFixtures';

const bundle = { evidence: evidence(), quotes: [] };
const snapshot = (rows = [quoteRow()]) => foldQuoteSets(rows).values().next().value!;

test.each([null, 'reset'] as const)('%s は AI に従う', (kind) => {
  const saved = kind === null ? null : snapshot([quoteRow({ kind })]);
  expect(resolveCellQuotes(null, saved, new Map())).toEqual({
    quotes: [], edited: false, newerAiAvailable: false, baseRunId: null,
  });
  expect(resolveCellQuotes(bundle, saved, new Map())).toEqual({
    quotes: aiCellQuotes(bundle), edited: false, newerAiAvailable: false, baseRunId: 'run',
  });
});

test.each(['empty', 'quote'] as const)('%s は AI の有無にかかわらず編集を維持する', (kind) => {
  const saved = snapshot([quoteRow({ kind })]);
  for (const ai of [null, bundle]) {
    const resolved = resolveCellQuotes(ai, saved, new Map());
    expect(resolved).toMatchObject({ edited: true, newerAiAvailable: false, baseRunId: 'run' });
    expect(resolved.quotes).toHaveLength(kind === 'empty' ? 0 : 1);
  }
  for (const baseRunId of [null, 'old']) {
    expect(resolveCellQuotes(bundle, { ...saved, baseRunId }, new Map()).newerAiAvailable).toBe(true);
  }
});

test.each([null, 'old'])('AI の引用が無ければ基準 run が %s でも新しい引用の注記を出さない', (baseRunId) => {
  const saved = snapshot([quoteRow({ baseRunId })]);
  const missing = evidence({ quote: null, notReported: true });
  expect(resolveCellQuotes({ evidence: missing, quotes: [] }, saved, new Map()).newerAiAvailable).toBe(false);
});

test('複数引用の全行が null なら新しい引用の注記を出さない', () => {
  const missing = evidence({ quote: null, notReported: true, quoteSeq: 1 });
  const quotes = [missing, evidence({ quote: null, notReported: true, quoteSeq: 2 })];
  const saved = snapshot([quoteRow({ baseRunId: 'old' })]);
  expect(resolveCellQuotes({ evidence: missing, quotes }, saved, new Map()).newerAiAvailable).toBe(false);
});

test('後勝ちは時刻によらず、同じ set の quote 行だけを連番順に採る', () => {
  const rows = [quoteRow({ setId: 'old', savedAt: 'z' }),
    quoteRow({ seq: 3, quoteId: 'third' }), quoteRow({ kind: 'empty' }),
    quoteRow({ seq: 1, quoteId: 'first' }), quoteRow({ seq: 2, quoteId: 'second' })];
  expect(snapshot(rows)).toEqual({ setId: 'set', kind: 'quote', baseRunId: 'run',
    savedAt: 'time', savedBy: 'editor', rows: [rows[3], rows[4], rows[1]] });
  expect(snapshot([...rows, quoteRow({ kind: 'reset' })]).rows).toEqual([]);
  expect(snapshot([...rows, quoteRow({ setId: 'partial', seq: 2 })]).rows).toHaveLength(1);
  expect(snapshot([quoteRow({ seq: 1 }), quoteRow({ seq: null })]).rows[0]?.seq).toBeNull();
  expect(snapshot([quoteRow({ seq: null }), quoteRow({ seq: 1 })]).rows[0]?.seq).toBeNull();
  expect(foldQuoteSets([]).size).toBe(0);
});

test('キーの各成分が違えば独立し、区切り文字にも衝突しない', () => {
  const rows = [quoteRow(), quoteRow({ studyId: 'other' }), quoteRow({ fieldId: 'other' }),
    quoteRow({ entityKey: 'other' }), quoteRow({ annotator: 'other' }),
    quoteRow({ annotatorType: 'human_independent' })];
  expect(foldQuoteSets(rows).size).toBe(6);
  expect(quoteSetKeyOf(quoteRow({ studyId: 'a,b', fieldId: 'c' })))
    .not.toBe(quoteSetKeyOf(quoteRow({ studyId: 'a', fieldId: 'b,c' })));
});

test('AI 引用は quote_seq 順で全属性を引き継ぎ、null 引用は含めない', () => {
  expect(aiCellQuotes(null)).toEqual([]);
  expect(aiCellQuotes({ evidence: evidence({ quote: null }), quotes: [] })).toEqual([]);
  expect(aiCellQuotes(bundle)[0]).toEqual({
    quoteId: 'ev', evidenceId: 'ev', source: 'ai', originAnnotator: null,
    studyId: 'study', fieldId: 'field', entityKey: '-', documentId: 'doc', quote: 'quote',
    page: 1, section: 'Results', theme: 'theme', anchorStatus: 'exact',
    bboxPage: 2, bbox: evidence().bbox, confidence: 'high',
  });
  const quotes = [evidence({ quoteSeq: 2, evidenceId: 'second' }),
    evidence({ quoteSeq: 1 }), evidence({ quoteSeq: 3, quote: null })];
  expect(aiCellQuotes({ ...bundle, quotes }).map((q) => q.quoteId)).toEqual(['ev', 'second']);
  expect(quotes[0]?.evidenceId).toBe('second');
  expect(aiCellQuotes({ ...bundle, quotes: [evidence(), evidence({ quoteSeq: 1 })] })).toHaveLength(2);
  expect(aiCellQuotes({ ...bundle, quotes: [evidence({ quoteSeq: 1 }), evidence()] })).toHaveLength(2);
});

test('保存済みの引用は欠損行を除外し、元 Evidence がある AI 引用だけ座標と色を復元する', () => {
  const rows = [quoteRow({ seq: 2, source: 'human', originAnnotator: 'reviewer-b' }),
    quoteRow({ seq: 1 }), quoteRow({ quote: null }), quoteRow({ quote: '' }),
    quoteRow({ quoteId: null }), quoteRow({ evidenceId: 'missing' }), quoteRow({ evidenceId: null }),
    quoteRow({ evidenceId: 'no-bbox' })];
  const saved = { ...snapshot(), rows };
  const result = resolveCellQuotes(null, saved, new Map([
    ['ev', evidence()], ['no-bbox', evidence({ bbox: null, bboxPage: null, confidence: null })],
  ])).quotes;
  expect(result).toHaveLength(5);
  expect(result[0]).toMatchObject({ bboxPage: 2, bbox: evidence().bbox, confidence: 'high' });
  for (const quote of result.slice(1)) expect(quote).toMatchObject({ bboxPage: null, bbox: null, confidence: null });
  expect(result[4]).toMatchObject({ source: 'human', originAnnotator: 'reviewer-b' });
  expect(rows[0]?.seq).toBe(2);
});

test('削除・テーマ編集は元の配列と引用を変更しない', () => {
  const quotes = [...aiCellQuotes(bundle), { ...aiCellQuotes(bundle)[0]!, quoteId: 'other' }];
  expect(removeCellQuote(quotes, 'ev')).toEqual([quotes[1]]);
  expect(removeCellQuote(quotes, 'missing')).toEqual(quotes);
  for (const theme of ['', '  ', null]) expect(setCellQuoteTheme(quotes, 'ev', theme)[0]?.theme).toBeNull();
  expect(setCellQuoteTheme(quotes, 'ev', ' new ')[0]?.theme).toBe('new');
  expect(setCellQuoteTheme(quotes, 'missing', 'new')).toEqual(quotes);
  expect(quotes[0]?.theme).toBe('theme');
});

test('保存行は引用を連番化し、空と reset は引用列を空にする', () => {
  const params = { setId: 'set', savedAt: 'time', savedBy: 'editor', annotator: 'reviewer',
    annotatorType: 'human_with_ai' as const, studyId: 'study', fieldId: 'field', entityKey: '-',
    schemaVersion: 1, baseRunId: 'run' };
  const quotes = aiCellQuotes(bundle);
  expect(buildQuoteSetRows({ ...params, quotes })).toEqual([quoteRow()]);
  expect(buildQuoteSetRows({ ...params, quotes: [...quotes, ...quotes] }).map((r) => r.seq)).toEqual([1, 2]);
  const reset = buildQuoteSetResetRow(params);
  expect(reset).toEqual({ ...params, kind: 'reset', seq: null, quoteId: null, source: null,
    evidenceId: null, originAnnotator: null, documentId: null, quote: null, page: null,
    section: null, theme: null, anchorStatus: null });
  expect(buildQuoteSetRows({ ...params, quotes: [] })).toEqual([{ ...reset, kind: 'empty' }]);
});
