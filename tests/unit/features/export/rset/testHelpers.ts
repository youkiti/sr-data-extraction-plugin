// R セット builder 群（issue #60）のテスト共通フィクスチャ工場。
// buildAuditCsv.test.ts の study()/field()/evidence()/decision() 相当を rset 用に揃える
import type { ResultsDataRow, StudyDataRow } from '../../../../../src/domain/annotation';
import type { ArmStructureRow } from '../../../../../src/domain/armStructure';
import type { Decision } from '../../../../../src/domain/decision';
import type { Evidence } from '../../../../../src/domain/evidence';
import type { SchemaField } from '../../../../../src/domain/schemaField';
import type { StudyRecord } from '../../../../../src/domain/study';

export function makeStudy(overrides: Partial<StudyRecord> = {}): StudyRecord {
  return {
    studyId: 'study-1',
    studyLabel: 'Smith 2020',
    registrationId: null,
    createdAt: '2026-07-01T00:00:00Z',
    createdBy: 'owner@example.com',
    note: null,
    ...overrides,
  };
}

export function makeField(overrides: Partial<SchemaField> = {}): SchemaField {
  return {
    schemaVersion: 1,
    fieldId: 'f-1',
    fieldIndex: 1,
    section: 'methods',
    fieldName: 'field_1',
    fieldLabel: 'フィールド 1',
    entityLevel: 'study',
    dataType: 'text',
    unit: null,
    allowedValues: null,
    required: true,
    extractionInstruction: '抽出指示',
    example: null,
    aiGenerated: false,
    note: null,
    ...overrides,
  };
}

export function makeStudyDataRow(overrides: Partial<StudyDataRow> = {}): StudyDataRow {
  return {
    studyId: 'study-1',
    annotator: 'reviewer@example.com',
    annotatorType: 'human_with_ai',
    schemaVersion: 1,
    runId: null,
    updatedAt: '2026-07-01T01:00:00Z',
    values: {},
    ...overrides,
  };
}

export function makeResultsDataRow(overrides: Partial<ResultsDataRow> = {}): ResultsDataRow {
  return {
    resultId: 'r-1',
    studyId: 'study-1',
    fieldId: 'f-1',
    annotator: 'reviewer@example.com',
    annotatorType: 'human_with_ai',
    schemaVersion: 1,
    entityKey: 'outcome:mortality|arm:1',
    runId: null,
    value: '12',
    notReported: false,
    updatedAt: '2026-07-01T01:00:00Z',
    ...overrides,
  };
}

export function makeEvidence(overrides: Partial<Evidence> = {}): Evidence {
  return {
    evidenceId: 'ev-1',
    runId: 'run-1',
    studyId: 'study-1',
    documentId: 'doc-1',
    fieldId: 'f-1',
    entityKey: '-',
    value: '12',
    notReported: false,
    quote: 'quote text',
    page: 1,
    confidence: 'high',
    anchorStatus: 'exact',
    bboxPage: null,
    bbox: null,
    relocatedFrom: null,
    ...overrides,
  };
}

export function makeDecision(overrides: Partial<Decision> = {}): Decision {
  return {
    decidedAt: '2026-07-01T02:00:00Z',
    decidedBy: 'reviewer@example.com',
    studyId: 'study-1',
    fieldId: 'f-1',
    entityKey: '-',
    annotator: 'reviewer@example.com',
    annotatorType: 'human_with_ai',
    schemaVersion: 1,
    action: 'accept',
    value: '12',
    note: null,
    ...overrides,
  };
}

export function makeArmStructureRow(overrides: Partial<ArmStructureRow> = {}): ArmStructureRow {
  return {
    studyId: 'study-1',
    version: 1,
    armKey: 'arm:1',
    armName: '介入群',
    annotator: 'reviewer@example.com',
    annotatorType: 'human_with_ai',
    confirmedAt: '2026-07-01T00:30:00Z',
    note: null,
    ...overrides,
  };
}
