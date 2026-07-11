import type { Decision } from '../../../../src/domain/decision';
import type { SchemaField } from '../../../../src/domain/schemaField';
import { computeAnnotatorProgress, computeStudyGate } from '../../../../src/features/adjudication/gate';

function field(overrides: Partial<SchemaField> = {}): SchemaField {
  return {
    schemaVersion: 1,
    fieldId: 'f-1',
    fieldIndex: 1,
    section: 'results',
    fieldName: 'mortality',
    fieldLabel: '死亡率',
    entityLevel: 'study',
    dataType: 'text',
    unit: null,
    allowedValues: null,
    required: false,
    extractionInstruction: '',
    example: null,
    aiGenerated: false,
    note: null,
    ...overrides,
  };
}

function decision(overrides: Partial<Decision> = {}): Decision {
  return {
    decidedAt: 't0',
    decidedBy: 'a@example.com',
    studyId: 'study-1',
    fieldId: 'f-1',
    entityKey: '-',
    annotator: 'a@example.com',
    annotatorType: 'human_with_ai',
    schemaVersion: 1,
    action: 'accept',
    value: '10',
    note: null,
    ...overrides,
  };
}

describe('computeAnnotatorProgress', () => {
  test('全セル判定済みなら complete=true', () => {
    const progress = computeAnnotatorProgress('a@example.com', [field()], [decision()], null);
    expect(progress).toEqual({ annotator: 'a@example.com', decided: 1, total: 1, complete: true });
  });

  test('他 annotator の判定は数えない（未判定のまま）', () => {
    const progress = computeAnnotatorProgress(
      'a@example.com',
      [field()],
      [decision({ annotator: 'b@example.com' })],
      null,
    );
    expect(progress).toEqual({ annotator: 'a@example.com', decided: 0, total: 1, complete: false });
  });

  test('総セル数が 0 なら complete=false（vacuous な完了扱いを避ける）', () => {
    const progress = computeAnnotatorProgress('a@example.com', [], [], null);
    expect(progress).toEqual({ annotator: 'a@example.com', decided: 0, total: 0, complete: false });
  });
});

describe('computeStudyGate', () => {
  test('両者とも完了なら ready=true', () => {
    const fields = [field()];
    const decisions = [decision({ annotator: 'a@example.com' }), decision({ annotator: 'b@example.com' })];
    const gate = computeStudyGate('a@example.com', 'b@example.com', fields, decisions, null, null);
    expect(gate.ready).toBe(true);
    expect(gate.progressA.complete).toBe(true);
    expect(gate.progressB.complete).toBe(true);
  });

  test('片方だけ未完了なら ready=false', () => {
    const fields = [field()];
    const decisions = [decision({ annotator: 'a@example.com' })];
    const gate = computeStudyGate('a@example.com', 'b@example.com', fields, decisions, null, null);
    expect(gate.ready).toBe(false);
    expect(gate.progressA.complete).toBe(true);
    expect(gate.progressB.complete).toBe(false);
  });
});
