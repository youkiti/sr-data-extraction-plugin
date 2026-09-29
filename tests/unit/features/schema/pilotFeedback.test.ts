import type { SchemaField } from '../../../../src/domain/schemaField';
import type { Decision } from '../../../../src/domain/decision';
import type { Evidence } from '../../../../src/domain/evidence';
import { buildPilotFeedback } from '../../../../src/features/schema/pilotFeedback';

function makeField(overrides: Partial<SchemaField> = {}): SchemaField {
  return {
    schemaVersion: 1,
    fieldId: 'f-1',
    fieldIndex: 1,
    section: 'methods',
    fieldName: 'study_design',
    fieldLabel: '研究デザイン',
    entityLevel: 'study',
    dataType: 'text',
    unit: null,
    allowedValues: null,
    required: true,
    extractionInstruction: 'Report the design.',
    example: null,
    aiGenerated: true,
    note: null,
    ...overrides,
  };
}

function decision(overrides: Partial<Decision> = {}): Decision {
  return {
    studyId: 's1',
    fieldId: 'f-1',
    entityKey: '-',
    action: 'edit',
    value: '修正値',
    note: '単位を確認',
    annotator: 'me',
    decidedBy: 'me',
    annotatorType: 'human_with_ai',
    schemaVersion: 1,
    decidedAt: '01',
    ...overrides,
  };
}
function evidence(overrides: Partial<Evidence> = {}): Evidence {
  return {
    evidenceId: 'e',
    runId: 'r',
    studyId: 's1',
    fieldId: 'f-1',
    entityKey: '-',
    documentId: 'd',
    value: 'AI値',
    quote: '引用',
    notReported: false,
    page: null,
    confidence: null,
    anchorStatus: null,
    bbox: null,
    bboxPage: null,
    relocatedFrom: null,
    ...overrides,
  };
}
const base = {
  runStudyIds: ['s1', 's2', 's1'],
  schemaVersion: 1,
  annotator: 'me',
  fields: [makeField()],
  evidence: [],
  decisions: [],
};

test('study とエンティティごとに最後の判定を undo 込みで採用し、承認は件数だけ残す', () => {
  const result = buildPilotFeedback({
    ...base,
    evidence: [evidence({ value: '古い値' }), evidence()],
    decisions: [
      decision({ decidedAt: '03', action: 'undo' }),
      decision(),
      decision({ decidedAt: '02', action: 'reject', note: '取り消すメモ' }),
      decision({ studyId: 's2', action: 'accept' }),
      decision({ entityKey: 'arm:1', action: 'not_reported', value: null, note: null }),
      decision({ entityKey: 'arm:2', action: 'reject', value: null }),
      decision({ entityKey: 'arm:3', action: 'undo' }),
    ],
  });
  expect(result.decisionCount).toBe(3);
  expect(result.items).toEqual([
    {
      fieldId: 'f-1',
      fieldName: 'study_design',
      acceptCount: 1,
      entries: [
        {
          studyId: 's1',
          entityKey: '-',
          action: 'edit',
          aiValue: 'AI値',
          humanValue: '修正値',
          quote: '引用',
          note: '単位を確認',
        },
        {
          studyId: 's1',
          entityKey: 'arm:1',
          action: 'not_reported',
          aiValue: null,
          humanValue: null,
          quote: null,
          note: null,
        },
        {
          studyId: 's1',
          entityKey: 'arm:2',
          action: 'reject',
          aiValue: null,
          humanValue: null,
          quote: null,
          note: '単位を確認',
        },
      ],
    },
  ]);
});

test('承認のみ・取消済み・予約項目・未知項目・対象外の判定を除外する', () => {
  expect(
    buildPilotFeedback({
      ...base,
      fields: [...base.fields, makeField({ fieldId: '__entity_instance__' })],
      decisions: [
        decision({ action: 'accept' }),
        decision({ studyId: 's3' }),
        decision({ schemaVersion: 2 }),
        decision({ annotator: 'other' }),
        decision({ annotatorType: 'human_independent' }),
        decision({ fieldId: '__entity_instance__' }),
        decision({ fieldId: 'unknown' }),
        decision({ studyId: 's2' }),
        decision({ studyId: 's2', action: 'undo', decidedAt: '02' }),
      ],
    }),
  ).toEqual({ items: [], decisionCount: 0 });
  expect(buildPilotFeedback(base)).toEqual({ items: [], decisionCount: 0 });
});
