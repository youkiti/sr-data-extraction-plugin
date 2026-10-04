// 担当セットの純粋関数を検証するための study・スキーマ・判定の素材。
import type { StudyRecord } from '../../../../src/domain/study';
import type { ReviewSetRow } from '../../../../src/domain/reviewSet';
import type { SchemaField } from '../../../../src/domain/schemaField';
import type { Decision } from '../../../../src/domain/decision';

export function study(overrides: Partial<StudyRecord> = {}): StudyRecord {
  return {
    studyId: 's1',
    studyLabel: '研究1',
    registrationId: null,
    createdAt: 't0',
    createdBy: 'owner@example.com',
    note: null,
    reviewSet: null,
    ...overrides,
  };
}

export function reviewSet(overrides: Partial<ReviewSetRow> = {}): ReviewSetRow {
  return {
    setId: 'group-1',
    reviewerEmails: ['a@example.com', 'b@example.com'],
    seed: '42',
    studyIds: ['s1'],
    updatedBy: 'owner@example.com',
    updatedAt: 't0',
    ...overrides,
  };
}

export function field(overrides: Partial<SchemaField> = {}): SchemaField {
  return {
    schemaVersion: 1,
    fieldId: 'f1',
    fieldIndex: 1,
    section: 'population',
    fieldName: 'country',
    fieldLabel: '国',
    entityLevel: 'study',
    dataType: 'text',
    unit: null,
    allowedValues: null,
    required: false,
    extractionInstruction: '',
    example: null,
    aiGenerated: false,
    note: null,
    maxQuotes: null,
    multiSelect: null,
    ...overrides,
  };
}

export function decision(overrides: Partial<Decision> = {}): Decision {
  return {
    decidedAt: 't0',
    decidedBy: 'a@example.com',
    studyId: 's1',
    fieldId: 'f1',
    entityKey: '-',
    annotator: 'a@example.com',
    annotatorType: 'human_with_ai',
    schemaVersion: 1,
    action: 'accept',
    value: '日本',
    note: null,
    ...overrides,
  };
}
