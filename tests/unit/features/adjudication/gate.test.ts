import type { Decision } from '../../../../src/domain/decision';
import type { Evidence } from '../../../../src/domain/evidence';
import type { SchemaField } from '../../../../src/domain/schemaField';
import { verificationProgress } from '../../../../src/features/verification/progress';
import { isIndependentAnnotator, computeAnnotatorProgress, computeStudyGate, countCompletedAnnotators, countOtherCompletedAnnotators } from '../../../../src/features/adjudication/gate';

function field(overrides: Partial<SchemaField> = {}): SchemaField {
  return {
    maxQuotes: null,
    multiSelect: null,
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

test('完了人数は自分の除外を完全一致で行い、未完了を数えない', () => {
  const progress = [
    { annotator: 'me', decided: 1, total: 1, complete: true },
    { annotator: 'ME', decided: 1, total: 1, complete: true },
    { annotator: 'other', decided: 0, total: 1, complete: false },
  ];
  expect(countCompletedAnnotators(progress)).toBe(2);
  expect(countOtherCompletedAnnotators(progress, 'me')).toBe(1);
  expect(countCompletedAnnotators([])).toBe(0);
  expect(countOtherCompletedAnnotators([], 'me')).toBe(0);
});

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
    const progress = computeAnnotatorProgress('a@example.com', [field()], [decision()], null, []);
    expect(progress).toEqual({ annotator: 'a@example.com', decided: 1, total: 1, complete: true });
  });

  test('他 annotator の判定は数えない（未判定のまま）', () => {
    const progress = computeAnnotatorProgress(
      'a@example.com',
      [field()],
      [decision({ annotator: 'b@example.com' })],
      null,
      [],
    );
    expect(progress).toEqual({ annotator: 'a@example.com', decided: 0, total: 1, complete: false });
  });

  test('総セル数が 0 なら complete=false（vacuous な完了扱いを避ける）', () => {
    const progress = computeAnnotatorProgress('a@example.com', [], [], null, []);
    expect(progress).toEqual({ annotator: 'a@example.com', decided: 0, total: 0, complete: false });
  });
});

describe('computeStudyGate', () => {
  test('両者とも完了なら ready=true', () => {
    const fields = [field()];
    const decisions = [decision({ annotator: 'a@example.com' }), decision({ annotator: 'b@example.com' })];
    const gate = computeStudyGate('a@example.com', 'b@example.com', fields, decisions, null, null, []);
    expect(gate.ready).toBe(true);
    expect(gate.progressA.complete).toBe(true);
    expect(gate.progressB.complete).toBe(true);
  });

  test('片方だけ未完了なら ready=false', () => {
    const fields = [field()];
    const decisions = [decision({ annotator: 'a@example.com' })];
    const gate = computeStudyGate('a@example.com', 'b@example.com', fields, decisions, null, null, []);
    expect(gate.ready).toBe(false);
    expect(gate.progressA.complete).toBe(true);
    expect(gate.progressB.complete).toBe(false);
  });
});

test.each([
  [[], false],
  [[decision({ annotatorType: 'human_independent' })], true],
  [[decision()], false],
  [[decision({ annotatorType: 'human_independent' }), decision()], false],
] as const)('本人の判定方式から独立入力を判別する: %j', (own, expected) => {
  expect(isIndependentAnnotator(own)).toBe(expected);
});

test.each(['human_with_ai', 'human_independent'] as const)(
  '%s の進捗は検証画面と同じセル集合で数える', (annotatorType) => {
    const fields = [field(), field({ fieldId: 'f-out', entityLevel: 'outcome_result' })];
    const evidence: Evidence[] = [{
      evidenceId: 'ev', runId: 'run', studyId: 'study-1', documentId: 'doc',
      fieldId: 'f-out', entityKey: 'outcome:death|arm:1', value: '10', notReported: false,
      quote: null, page: null, confidence: null, anchorStatus: null, bboxPage: null,
      bbox: null, relocatedFrom: null, quoteTheme: null, quoteSeq: null, section: null,
    }];
    const own = [decision({ annotatorType })];
    const expected = verificationProgress(fields, annotatorType === 'human_with_ai' ? evidence : [], own, { armStructure: null });
    const progress = computeAnnotatorProgress('a@example.com', fields, own, null, evidence);
    expect(progress).toMatchObject({ decided: expected.decided, total: expected.total });
    expect(progress).toMatchObject({ decided: 1, total: annotatorType === 'human_with_ai' ? 2 : 1, complete: annotatorType === 'human_independent' });
    const gate = computeStudyGate('a@example.com', 'b@example.com', fields,
      [...own, decision({ annotator: 'b@example.com', annotatorType })], null, null, evidence);
    expect(gate.ready).toBe(annotatorType === 'human_independent');
  },
);
