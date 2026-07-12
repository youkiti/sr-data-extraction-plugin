import { NOT_REPORTED_TOKEN } from '../../../../src/domain/annotation';
import type { Evidence } from '../../../../src/domain/evidence';
import type { SchemaField } from '../../../../src/domain/schemaField';
import { buildAiAnnotationRows } from '../../../../src/features/extraction/aiAnnotationRows';

function makeField(overrides: Partial<SchemaField> = {}): SchemaField {
  return {
    schemaVersion: 2,
    fieldId: 'f-study',
    fieldIndex: 1,
    section: 'population',
    fieldName: 'sample_size_total',
    fieldLabel: '総サンプルサイズ',
    entityLevel: 'study',
    dataType: 'integer',
    unit: null,
    allowedValues: null,
    required: true,
    extractionInstruction: '総サンプルサイズを抽出する',
    example: null,
    aiGenerated: true,
    note: null,
    ...overrides,
  };
}

function makeEvidence(overrides: Partial<Evidence> = {}): Evidence {
  return {
    evidenceId: 'ev-1',
    runId: 'run-1',
    studyId: 'study-1',
    documentId: 'doc-1',
    fieldId: 'f-study',
    entityKey: '-',
    value: '120',
    notReported: false,
    quote: 'q',
    page: 1,
    confidence: 'high',
    anchorStatus: 'exact',
    bboxPage: null,
    bbox: null,
    relocatedFrom: null,
    ...overrides,
  };
}

const PARAMS = { runId: 'run-1', schemaVersion: 2, updatedAt: '2026-07-02T00:00:00Z' };

const FIELDS: SchemaField[] = [
  makeField(),
  makeField({ fieldId: 'f-country', fieldName: 'country' }),
  makeField({ fieldId: 'f-arm-n', fieldName: 'arm_n', entityLevel: 'arm' }),
  makeField({ fieldId: 'f-events', fieldName: 'events', entityLevel: 'outcome_result' }),
];

describe('buildAiAnnotationRows', () => {
  test('study レベルは study ごとに 1 行の StudyDataRow（wide）へまとめる', () => {
    const { studyRows, resultsRows } = buildAiAnnotationRows(
      [
        makeEvidence(),
        makeEvidence({ evidenceId: 'ev-2', fieldId: 'f-country', value: 'Japan' }),
        makeEvidence({ evidenceId: 'ev-3', studyId: 'study-2', documentId: 'doc-2', value: '80' }),
      ],
      FIELDS,
      PARAMS,
    );
    expect(resultsRows).toEqual([]);
    expect(studyRows).toEqual([
      {
        studyId: 'study-1',
        annotator: 'ai',
        annotatorType: 'ai',
        schemaVersion: 2,
        runId: 'run-1',
        updatedAt: '2026-07-02T00:00:00Z',
        values: { sample_size_total: '120', country: 'Japan' },
      },
      {
        studyId: 'study-2',
        annotator: 'ai',
        annotatorType: 'ai',
        schemaVersion: 2,
        runId: 'run-1',
        updatedAt: '2026-07-02T00:00:00Z',
        values: { sample_size_total: '80' },
      },
    ]);
  });

  test('not_reported=true は NR トークン、値なし（null）は空セル（null）', () => {
    const { studyRows } = buildAiAnnotationRows(
      [
        makeEvidence({ value: null, notReported: true }),
        makeEvidence({ evidenceId: 'ev-2', fieldId: 'f-country', value: null }),
      ],
      FIELDS,
      PARAMS,
    );
    expect(studyRows[0]?.values).toEqual({
      sample_size_total: NOT_REPORTED_TOKEN,
      country: null,
    });
  });

  test('arm / outcome_result レベルは ResultsData 行（long・result_id なし）になる', () => {
    const { studyRows, resultsRows } = buildAiAnnotationRows(
      [
        makeEvidence({ fieldId: 'f-arm-n', entityKey: 'arm:1', value: '60' }),
        makeEvidence({
          evidenceId: 'ev-2',
          fieldId: 'f-events',
          entityKey: 'outcome:mortality|arm:1|time:30d',
          value: '5',
          notReported: false,
        }),
      ],
      FIELDS,
      PARAMS,
    );
    expect(studyRows).toEqual([]);
    expect(resultsRows).toEqual([
      {
        studyId: 'study-1',
        fieldId: 'f-arm-n',
        annotator: 'ai',
        annotatorType: 'ai',
        schemaVersion: 2,
        entityKey: 'arm:1',
        runId: 'run-1',
        value: '60',
        notReported: false,
        updatedAt: '2026-07-02T00:00:00Z',
      },
      {
        studyId: 'study-1',
        fieldId: 'f-events',
        annotator: 'ai',
        annotatorType: 'ai',
        schemaVersion: 2,
        entityKey: 'outcome:mortality|arm:1|time:30d',
        runId: 'run-1',
        value: '5',
        notReported: false,
        updatedAt: '2026-07-02T00:00:00Z',
      },
    ]);
  });

  test('同一セルへの複数 Evidence は後勝ち（study / results とも）', () => {
    const { studyRows, resultsRows } = buildAiAnnotationRows(
      [
        makeEvidence({ value: '120' }),
        makeEvidence({ evidenceId: 'ev-2', value: '150' }),
        makeEvidence({ evidenceId: 'ev-3', fieldId: 'f-arm-n', entityKey: 'arm:1', value: '60' }),
        makeEvidence({ evidenceId: 'ev-4', fieldId: 'f-arm-n', entityKey: 'arm:1', value: '61' }),
      ],
      FIELDS,
      PARAMS,
    );
    expect(studyRows[0]?.values).toEqual({ sample_size_total: '150' });
    expect(resultsRows).toHaveLength(1);
    expect(resultsRows[0]?.value).toBe('61');
  });

  test('fields に無い field_id が混ざっていれば throw（呼び出し契約違反）', () => {
    expect(() =>
      buildAiAnnotationRows([makeEvidence({ fieldId: 'f-unknown' })], FIELDS, PARAMS),
    ).toThrow('f-unknown');
  });

  test('Evidence が空なら両方とも空配列', () => {
    expect(buildAiAnnotationRows([], FIELDS, PARAMS)).toEqual({
      studyRows: [],
      resultsRows: [],
    });
  });
});
