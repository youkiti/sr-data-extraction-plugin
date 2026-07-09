import type { Decision } from '../../../../src/domain/decision';
import type { Evidence } from '../../../../src/domain/evidence';
import type { SchemaField } from '../../../../src/domain/schemaField';
import { verificationProgress } from '../../../../src/features/verification/progress';

const ME = 'me@example.com';

function makeField(overrides: Partial<SchemaField> = {}): SchemaField {
  return {
    schemaVersion: 1,
    fieldId: 'f-1',
    fieldIndex: 1,
    section: 'methods',
    fieldName: 'sample_size_total',
    fieldLabel: '総サンプルサイズ',
    entityLevel: 'study',
    dataType: 'integer',
    unit: null,
    allowedValues: null,
    required: true,
    extractionInstruction: '抽出する',
    example: null,
    aiGenerated: false,
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
    fieldId: 'f-1',
    entityKey: '-',
    value: '120',
    notReported: false,
    quote: null,
    page: null,
    confidence: null,
    anchorStatus: null,
    ...overrides,
  };
}

function makeDecision(overrides: Partial<Decision> = {}): Decision {
  return {
    decidedAt: 't1',
    decidedBy: ME,
    studyId: 'study-1',
    fieldId: 'f-1',
    entityKey: '-',
    annotator: ME,
    annotatorType: 'human_with_ai',
    schemaVersion: 1,
    action: 'accept',
    value: '120',
    note: null,
    ...overrides,
  };
}

describe('verificationProgress', () => {
  test('全 entity タブのセルを合算し、判定済み（unverified 以外）を数える', () => {
    const fields = [
      makeField(), // study
      makeField({ fieldId: 'f-2', fieldIndex: 2, fieldName: 'country' }), // study・未判定
      makeField({ fieldId: 'f-arm', fieldIndex: 3, fieldName: 'arm_n', entityLevel: 'arm' }),
    ];
    const evidence = [
      makeEvidence(),
      makeEvidence({ evidenceId: 'ev-2', fieldId: 'f-arm', entityKey: 'arm:1' }),
      makeEvidence({ evidenceId: 'ev-3', fieldId: 'f-arm', entityKey: 'arm:2' }),
    ];
    // study 1 セル判定済み + arm:1 判定済み。総セル = study 2 + arm 2
    const progress = verificationProgress(fields, evidence, [
      makeDecision(),
      makeDecision({ fieldId: 'f-arm', entityKey: 'arm:1', value: '50' }),
    ]);
    expect(progress).toEqual({
      decided: 2,
      total: 4,
      byTab: [
        { tab: 'study', decided: 1, total: 2 },
        { tab: 'arm', decided: 1, total: 2 },
      ],
    });
  });

  test('undo で未検証へ戻したセルは判定済みに数えない', () => {
    const progress = verificationProgress(
      [makeField()],
      [makeEvidence()],
      [makeDecision(), makeDecision({ decidedAt: 't2', action: 'undo', value: null })],
    );
    expect(progress).toEqual({
      decided: 0,
      total: 1,
      byTab: [{ tab: 'study', decided: 0, total: 1 }],
    });
  });

  test('項目なしスキーマは 0 / 0（byTab も空）', () => {
    expect(verificationProgress([], [], [])).toEqual({ decided: 0, total: 0, byTab: [] });
  });
});
