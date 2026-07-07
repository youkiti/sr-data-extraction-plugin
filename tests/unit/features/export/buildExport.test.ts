import type { ResultsDataRow, StudyDataRow } from '../../../../src/domain/annotation';
import type { Decision } from '../../../../src/domain/decision';
import type { StudyRecord } from '../../../../src/domain/study';
import type { Evidence } from '../../../../src/domain/evidence';
import type { SchemaField } from '../../../../src/domain/schemaField';
import {
  buildAllExports,
  buildExport,
  toStudyLabels,
  PREVIEW_ROW_LIMIT,
  type ExportMaterials,
} from '../../../../src/features/export/buildExport';

function makeStudy(overrides: Partial<StudyRecord> = {}): StudyRecord {
  return {
    studyId: 'doc-1',
    studyLabel: 'Smith 2020',
    registrationId: null,
    createdAt: 't0',
    createdBy: 'me@example.com',
    note: null,
    ...overrides,
  };
}

function makeField(overrides: Partial<SchemaField> = {}): SchemaField {
  return {
    schemaVersion: 2,
    fieldId: 'f-total',
    fieldIndex: 1,
    section: 'methods',
    fieldName: 'sample_size_total',
    fieldLabel: '総サンプルサイズ',
    entityLevel: 'study',
    dataType: 'integer',
    unit: null,
    allowedValues: null,
    required: true,
    extractionInstruction: '総 N を抽出',
    example: null,
    aiGenerated: false,
    note: null,
    ...overrides,
  };
}

function makeStudyRow(overrides: Partial<StudyDataRow> = {}): StudyDataRow {
  return {
    studyId: 'doc-1',
    annotator: 'me@example.com',
    annotatorType: 'human_with_ai',
    schemaVersion: 2,
    runId: null,
    updatedAt: 't1',
    values: { sample_size_total: '120' },
    ...overrides,
  };
}

function makeResultsRow(overrides: Partial<ResultsDataRow> = {}): ResultsDataRow {
  return {
    resultId: 'r-1',
    studyId: 'doc-1',
    fieldId: 'f-events',
    annotator: 'me@example.com',
    annotatorType: 'human_with_ai',
    schemaVersion: 2,
    entityKey: 'arm:1',
    runId: null,
    value: '12',
    notReported: false,
    updatedAt: 't1',
    ...overrides,
  };
}

function makeDecision(overrides: Partial<Decision> = {}): Decision {
  return {
    decidedAt: 't2',
    decidedBy: 'me@example.com',
    studyId: 'doc-1',
    fieldId: 'f-total',
    entityKey: '-',
    annotator: 'me@example.com',
    annotatorType: 'human_with_ai',
    schemaVersion: 2,
    action: 'accept',
    value: '120',
    note: null,
    ...overrides,
  };
}

function makeEvidence(overrides: Partial<Evidence> = {}): Evidence {
  return {
    evidenceId: 'ev-1',
    runId: 'run-1',
    studyId: 'doc-1',
    documentId: 'doc-1',
    fieldId: 'f-total',
    entityKey: '-',
    value: '120',
    notReported: false,
    quote: 'a total of 120',
    page: 1,
    confidence: 'high',
    anchorStatus: 'exact',
    ...overrides,
  };
}

function makeMaterials(overrides: Partial<ExportMaterials> = {}): ExportMaterials {
  return {
    studies: [makeStudy()],
    studyRows: [makeStudyRow()],
    resultsRows: [
      makeResultsRow(),
      makeResultsRow({ resultId: 'r-2', entityKey: 'arm:2', value: '8' }),
    ],
    decisions: [makeDecision()],
    evidences: [makeEvidence(), makeEvidence({ evidenceId: 'ev-2', fieldId: 'f-events', entityKey: 'arm:1' })],
    runs: [{ runId: 'run-1', schemaVersion: 2, startedAt: 't1' }],
    fields: [
      makeField(),
      makeField({
        fieldId: 'f-events',
        fieldIndex: 2,
        section: 'outcomes',
        fieldName: 'events',
        entityLevel: 'outcome_result',
        unit: '件',
      }),
    ],
    ...overrides,
  };
}

describe('buildExport', () => {
  test('study_wide: ヘッダ / プレビュー行 / 行数 / 試験数 / 未検証 0 を返す', () => {
    const built = buildExport('study_wide', makeMaterials());
    expect(built.format).toBe('study_wide');
    expect(built.header).toEqual(['study_label', 'sample_size_total']);
    expect(built.previewRows).toEqual([['Smith 2020', '120']]);
    expect(built.rowCount).toBe(1);
    expect(built.studyCount).toBe(1);
    expect(built.unverifiedCellCount).toBe(0);
    expect(built.skippedStudyLabels).toEqual([]);
    expect(built.droppedRowCount).toBe(0);
  });

  test('study_wide: 空セルは未検証として数え、確定行のない試験は study_label で列挙する', () => {
    const built = buildExport(
      'study_wide',
      makeMaterials({
        studies: [makeStudy(), makeStudy({ studyId: 'doc-2', studyLabel: 'Tanaka 2021' })],
        studyRows: [makeStudyRow({ values: { sample_size_total: null } })],
      }),
    );
    expect(built.unverifiedCellCount).toBe(1);
    expect(built.skippedStudyLabels).toEqual(['Tanaka 2021']);
  });

  test('results_long: 未検証は概念なし（null）で、field_id 不整合は droppedRowCount に出る', () => {
    const built = buildExport(
      'results_long',
      makeMaterials({
        resultsRows: [makeResultsRow(), makeResultsRow({ resultId: 'r-x', fieldId: 'f-unknown' })],
      }),
    );
    expect(built.header[0]).toBe('study_label');
    expect(built.rowCount).toBe(1);
    expect(built.studyCount).toBe(1);
    expect(built.unverifiedCellCount).toBeNull();
    expect(built.droppedRowCount).toBe(1);
  });

  test('audit: 判定 0 件セルのプレースホルダ数を未検証として返す', () => {
    const built = buildExport('audit', makeMaterials());
    // f-total は判定あり、f-events（ev-2）は判定 0 件 → プレースホルダ 1 行
    expect(built.rowCount).toBe(2);
    expect(built.studyCount).toBe(1);
    expect(built.unverifiedCellCount).toBe(1);
    expect(built.skippedStudyLabels).toEqual([]);
  });

  test('プレビューは先頭 10 行に制限し、超過ぶんは rowCount との差で分かる', () => {
    const resultsRows = Array.from({ length: PREVIEW_ROW_LIMIT + 3 }, (_, i) =>
      makeResultsRow({ resultId: `r-${i}`, entityKey: `arm:${i + 1}` }),
    );
    const built = buildExport('results_long', makeMaterials({ resultsRows }));
    expect(built.rowCount).toBe(PREVIEW_ROW_LIMIT + 3);
    expect(built.previewRows).toHaveLength(PREVIEW_ROW_LIMIT);
  });
});

describe('buildAllExports', () => {
  test('3 形式をまとめて構築する', () => {
    const all = buildAllExports(makeMaterials());
    expect(all.study_wide.format).toBe('study_wide');
    expect(all.results_long.format).toBe('results_long');
    expect(all.audit.format).toBe('audit');
  });
});

describe('toStudyLabels', () => {
  test('study_id を study_label へ解決し、一覧にない id は id のまま返す', () => {
    expect(toStudyLabels([makeStudy()], ['doc-1', 'doc-ghost'])).toEqual([
      'Smith 2020',
      'doc-ghost',
    ]);
  });
});
