import type { AnnotatorType, ResultsDataRow, StudyDataRow } from '../../../../src/domain/annotation';
import type { SchemaField } from '../../../../src/domain/schemaField';
import type { StudyRecord } from '../../../../src/domain/study';
import { buildEvidenceQuotesCsv, EVIDENCE_QUOTES_HEADER } from '../../../../src/features/export/buildEvidenceQuotesCsv';
import { bundleEvidence } from '../../../../src/features/verification/evidenceBundles';
import { evidence, quoteRow } from '../verification/quoteSetFixtures';

type Input = Parameters<typeof buildEvidenceQuotesCsv>[0];
const study = (studyId = 'study'): StudyRecord => ({ studyId, studyLabel: studyId,
  registrationId: null, createdAt: 'time', createdBy: 'editor', note: null, reviewSet: null });
const field = (fieldId = 'field', fieldIndex = 1): SchemaField => ({
  fieldId, fieldIndex, fieldName: fieldId, fieldLabel: fieldId, schemaVersion: 1,
  entityLevel: 'study', dataType: 'text', section: 'main', unit: null, allowedValues: null,
  required: false, extractionInstruction: '', example: null, aiGenerated: false, note: null,
  maxQuotes: null, multiSelect: null,
});
const human = (annotatorType: AnnotatorType = 'human_with_ai', annotator = 'reviewer'): StudyDataRow => ({
  studyId: 'study', annotator, annotatorType, schemaVersion: 1, runId: null, updatedAt: 'time', values: {},
});
const result = (overrides: Partial<ResultsDataRow> = {}): ResultsDataRow => ({
  ...human(), resultId: 'result', fieldId: 'field', entityKey: '-', value: 'value', notReported: false,
  ...overrides,
});
const input = (overrides: Partial<Input> = {}): Input => ({
  studies: [study()], fields: [field()], bundlesByStudy: new Map([['study', bundleEvidence([evidence()])]]),
  quoteSetRows: [], evidences: [evidence()], documents: [], studyDataRows: [], resultsDataRows: [], ...overrides,
});
const lines = (params: Input): string[][] => buildEvidenceQuotesCsv(params).csv.trimEnd().split('\r\n').slice(1).map((line) => line.split(','));

test('BOM・ヘッダ・引用の各列を出力する', () => {
  const output = buildEvidenceQuotesCsv(input());
  expect(output).toEqual({
    csv: '\uFEFF' + EVIDENCE_QUOTES_HEADER.join(',') + '\r\n' +
      'study,study,field,field,-,ai,ai,ai,,theme,quote,1,Results,doc,,exact,FALSE\r\n',
    rowCount: 1, studyCount: 1,
  });
});

test.each([
  ['未確定', [], [], ['FALSE']],
  ['人の引用', [human()], [quoteRow()], ['FALSE', 'TRUE']],
  ['全削除', [human()], [quoteRow({ kind: 'empty' })], ['FALSE']],
  ['未編集', [human()], [], ['TRUE']],
  ['AI に戻す', [human()], [quoteRow({ kind: 'reset' })], ['TRUE']],
  ['独立で未編集', [human('human_independent')], [], ['FALSE']],
  ['独立で reset', [human('human_independent')], [quoteRow({ kind: 'reset', annotatorType: 'human_independent' })], ['FALSE']],
  ['独立で引用あり', [human('human_independent')], [quoteRow({ annotatorType: 'human_independent' })], ['FALSE', 'TRUE']],
  ['裁定', [human('consensus', 'consensus')], [quoteRow(), quoteRow({ annotator: 'consensus', annotatorType: 'consensus' })], ['FALSE', 'TRUE', 'FALSE']],
  ['裁定で未編集', [human('consensus', 'consensus')], [], ['FALSE']],
] as const)('%s の is_final', (_name, studyDataRows, quoteSetRows, expected) => {
  expect(lines(input({ studyDataRows, quoteSetRows })).map((row) => row[16])).toEqual(expected);
});

test('同名の別 annotator_type と別の人の引用を最終扱いにしない', () => {
  const quoteSetRows = [quoteRow(), quoteRow({ annotatorType: 'human_independent' }), quoteRow({ annotator: 'other' })];
  const rows = lines(input({ studyDataRows: [human()], quoteSetRows }));
  expect(rows.filter((row) => row[16] === 'TRUE').map((row) => [row[5], row[6]]))
    .toEqual([['reviewer', 'human_with_ai']]);
});

test('study の引用は ResultsData で代用せず StudyData だけで確定する', () => {
  const resultsDataRows = [result(), result({ fieldId: 'second' }), result({ annotator: 'ai', annotatorType: 'ai' }),
    result({ studyId: 'inactive', annotator: 'other' })];
  expect(lines(input({ resultsDataRows }))[0]?.[16]).toBe('FALSE');
  expect(lines(input({ resultsDataRows, studyDataRows: [human('ai', 'ai')] }))[0]?.[16]).toBe('FALSE');
  expect(lines(input({ resultsDataRows, studyDataRows: [human(), { ...human(), studyId: 'inactive' }] }))[0]?.[16]).toBe('TRUE');
});

test('引用の上書きと empty はセルごとで、reset は人の行を出さない', () => {
  const evidences = [evidence(), evidence({ entityKey: 'arm:1' }), evidence({ fieldId: 'second' })];
  const rows = lines(input({
    fields: [field(), field('second', 2)], bundlesByStudy: new Map([['study', bundleEvidence(evidences)]]),
    studyDataRows: [human()], quoteSetRows: [quoteRow(), quoteRow({ setId: 'new', kind: 'empty' }),
      quoteRow({ fieldId: 'second', kind: 'reset' })],
  }));
  expect(rows.map((row) => [row[3], row[4], row[16]]))
    .toEqual([['field', '-', 'FALSE'], ['second', '-', 'TRUE'], ['field', 'arm:1', 'TRUE']]);
});

test('study 入力順・entity・field_index・AI 優先の annotator・引用順で並ぶ', () => {
  const evidences = [evidence({ fieldId: 'second' }), evidence({ entityKey: 'z' }),
    evidence({ quoteSeq: 2, evidenceId: 'two', quote: 'two' }),
    evidence({ quoteSeq: 1, evidenceId: 'one', quote: 'one' }), evidence({ fieldId: 'unknown' })];
  const quoteSetRows = [quoteRow({ annotator: 'z' }), quoteRow({ annotator: 'a', seq: 2, quote: 'a2' }),
    quoteRow({ annotator: 'a', seq: 1, quote: 'a1' }), quoteRow({ annotator: '0-first' }),
    quoteRow({ studyId: 'inactive' }), quoteRow({ fieldId: 'unknown' }),
    quoteRow({ studyId: 'before', source: 'human', evidenceId: null, documentId: null, quote: 'human',
      page: null, section: null, theme: null, anchorStatus: null, originAnnotator: 'original' })];
  const params = input({ studies: [study('before'), study(), study('empty')], fields: [field('second', 2), field()],
    bundlesByStudy: new Map([['study', bundleEvidence(evidences)]]), quoteSetRows });
  const output = buildEvidenceQuotesCsv(params);
  expect(output.studyCount).toBe(2);
  expect(output.rowCount).toBe(9);
  const rows = lines(params);
  expect(rows.map((row) => [row[1], row[4], row[3], row[5], row[10]])).toEqual([
    ['before', '-', 'field', 'reviewer', 'human'],
    ['study', '-', 'field', 'ai', 'one'], ['study', '-', 'field', 'ai', 'two'],
    ['study', '-', 'field', '0-first', 'quote'], ['study', '-', 'field', 'a', 'a1'],
    ['study', '-', 'field', 'a', 'a2'], ['study', '-', 'field', 'z', 'quote'],
    ['study', '-', 'second', 'ai', 'quote'], ['study', 'z', 'field', 'ai', 'quote'],
  ]);
  expect(rows[0]?.slice(7, 17)).toEqual(['human', 'original', '', 'human', '', '', '', '', '', 'FALSE']);
});

test('文書名と CSV の特殊文字を保持し、対象が無ければヘッダだけ', () => {
  const doc = { documentId: 'doc', filename: 'paper.pdf' } as Input['documents'][number];
  const params = input({ documents: [doc], quoteSetRows: [quoteRow({ quote: 'a,"b"\nc' })] });
  expect(buildEvidenceQuotesCsv(params).csv).toContain('"a,""b""\nc",1,Results,doc,paper.pdf,exact,FALSE');
  expect(buildEvidenceQuotesCsv(input({ studies: [] }))).toEqual({
    csv: '\uFEFF' + EVIDENCE_QUOTES_HEADER.join(',') + '\r\n', rowCount: 0, studyCount: 0,
  });
});


test.each(['arm', 'outcome_result', 'rob_domain'] as const)('AI の StudyData と人の ResultsData を階層ごとに選ぶ: %s', (entityLevel) => {
  const evidences = [evidence(), evidence({ fieldId: 'result', entityKey: 'arm:1' })];
  const params = input({ fields: [field(), { ...field('result', 2), entityLevel }],
    bundlesByStudy: new Map([['study', bundleEvidence(evidences)]]),
    studyDataRows: [human('ai', 'ai')],
    resultsDataRows: [result(), result({ fieldId: 'result' }), result({ studyId: 'other', annotator: 'other' })],
  });
  expect(lines(params).map((row) => [row[3], row[16]])).toEqual([['field', 'FALSE'], ['result', 'TRUE']]);
  expect(lines({ ...params, resultsDataRows: [] }).map((row) => row[16])).toEqual(['FALSE', 'FALSE']);
});

test('study は人の引用、arm は ResultsData の consensus の引用を採用する', () => {
  const evidences = [evidence(), evidence({ fieldId: 'arm', entityKey: 'arm:1' })];
  const quoteSetRows = [quoteRow(), quoteRow({ fieldId: 'arm', entityKey: 'arm:1' }),
    quoteRow({ fieldId: 'arm', entityKey: 'arm:1', annotator: 'consensus', annotatorType: 'consensus' })];
  const rows = lines(input({ fields: [field(), { ...field('arm', 2), entityLevel: 'arm' }],
    bundlesByStudy: new Map([['study', bundleEvidence(evidences)]]), quoteSetRows,
    studyDataRows: [human()], resultsDataRows: [result(), result({ annotator: 'consensus', annotatorType: 'consensus' }),
      result({ fieldId: 'other', annotator: 'consensus', annotatorType: 'consensus' })],
  }));
  expect(rows.map((row) => [row[3], row[5], row[16]])).toEqual([
    ['field', 'ai', 'FALSE'], ['field', 'reviewer', 'TRUE'],
    ['arm', 'ai', 'FALSE'], ['arm', 'consensus', 'TRUE'], ['arm', 'reviewer', 'FALSE'],
  ]);
});
