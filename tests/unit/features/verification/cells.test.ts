import type { Decision } from '../../../../src/domain/decision';
import type { Evidence } from '../../../../src/domain/evidence';
import type { SchemaField } from '../../../../src/domain/schemaField';
import {
  availableTabs,
  buildTabModel,
  entityInstances,
  entityKeyLabel,
} from '../../../../src/features/verification/cells';
import { cellKeyOf } from '../../../../src/features/verification/cellState';

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
    extractionInstruction: '総 N を抽出',
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
    documentId: 'doc-1',
    fieldId: 'f-1',
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

function makeDecision(overrides: Partial<Decision> = {}): Decision {
  return {
    decidedAt: 't1',
    decidedBy: 'me@example.com',
    documentId: 'doc-1',
    fieldId: 'f-1',
    entityKey: '-',
    annotator: 'me@example.com',
    annotatorType: 'human_with_ai',
    schemaVersion: 1,
    action: 'accept',
    value: '120',
    note: null,
    ...overrides,
  };
}

describe('availableTabs', () => {
  test('スキーマに存在する entity_level を表示順（study → arm → outcome → rob）で返す', () => {
    const fields = [
      makeField({ fieldId: 'f-o', entityLevel: 'outcome_result' }),
      makeField({ fieldId: 'f-s', entityLevel: 'study' }),
      makeField({ fieldId: 'f-a', entityLevel: 'arm' }),
    ];
    expect(availableTabs(fields)).toEqual(['study', 'arm', 'outcome_result']);
  });

  test('存在しないレベルのタブは出さない', () => {
    expect(availableTabs([makeField()])).toEqual(['study']);
  });
});

describe('entityKeyLabel', () => {
  test.each([
    ['-', 'Study'],
    ['arm:1', '群 1'],
    ['outcome:mortality', 'mortality'],
    ['outcome:mortality|arm:1', 'mortality / 群 1'],
    ['outcome:mortality|time:30d', 'mortality / 30d'],
    ['outcome:mortality|arm:2|time:30d', 'mortality / 群 2 / 30d'],
    ['rob:domain_1', 'RoB: domain_1'],
    ['broken key', 'broken key'],
  ])('%s → %s', (key, label) => {
    expect(entityKeyLabel(key)).toBe(label);
  });
});

describe('entityInstances', () => {
  test('Evidence と Decisions の双方から該当レベルの entity_key を集めて昇順で返す', () => {
    const evidence = [
      makeEvidence({ entityKey: 'arm:2' }),
      makeEvidence({ entityKey: 'outcome:death' }),
    ];
    const decisions = [makeDecision({ entityKey: 'arm:1' }), makeDecision({ entityKey: '-' })];
    expect(entityInstances('arm', evidence, decisions)).toEqual(['arm:1', 'arm:2']);
  });
});

describe('buildTabModel', () => {
  test('study タブは section ごとにグループ化する（fieldIndex 順・初出順）', () => {
    const fields = [
      makeField({ fieldId: 'f-2', fieldIndex: 2, section: 'results', fieldName: 'n_events' }),
      makeField({ fieldId: 'f-1', fieldIndex: 1, section: 'methods' }),
      makeField({ fieldId: 'f-3', fieldIndex: 3, section: 'results', fieldName: 'n_total' }),
      makeField({ fieldId: 'f-a', fieldIndex: 4, entityLevel: 'arm' }),
    ];
    const model = buildTabModel('study', fields, [], []);
    expect(model.groups.map((g) => g.heading)).toEqual(['methods', 'results']);
    expect(model.groups[1]?.cells.map((c) => c.field.fieldId)).toEqual(['f-2', 'f-3']);
    expect(model.cells).toHaveLength(3);
  });

  test('セルへ Evidence と判定状態を対応付ける（同一セルの Evidence は後勝ち）', () => {
    const fields = [makeField()];
    const evidence = [makeEvidence({ evidenceId: 'ev-old' }), makeEvidence({ evidenceId: 'ev-new' })];
    const decisions = [makeDecision()];
    const model = buildTabModel('study', fields, evidence, decisions);
    const cell = model.cells[0];
    expect(cell?.cellKey).toBe(cellKeyOf('f-1', '-'));
    expect(cell?.evidence?.evidenceId).toBe('ev-new');
    expect(cell?.state).toMatchObject({ status: 'accept', value: '120' });
  });

  test('判定が無いセルは未検証（空セル）から始まる', () => {
    const model = buildTabModel('study', [makeField()], [], []);
    expect(model.cells[0]?.state).toEqual({ status: 'unverified', value: null, stack: [] });
  });

  test('arm タブは entity インスタンスごとのグループ × arm 項目のセルを作る', () => {
    const fields = [
      makeField(),
      makeField({ fieldId: 'f-a', fieldIndex: 2, entityLevel: 'arm', fieldName: 'arm_n' }),
    ];
    const evidence = [
      makeEvidence({ fieldId: 'f-a', entityKey: 'arm:1' }),
      makeEvidence({ fieldId: 'f-a', entityKey: 'arm:2' }),
    ];
    const model = buildTabModel('arm', fields, evidence, []);
    expect(model.groups.map((g) => g.heading)).toEqual(['群 1', '群 2']);
    expect(model.cells.map((c) => c.cellKey)).toEqual([
      cellKeyOf('f-a', 'arm:1'),
      cellKeyOf('f-a', 'arm:2'),
    ]);
  });

  test('インスタンスが無いタブは空モデルになる', () => {
    const fields = [makeField({ fieldId: 'f-a', entityLevel: 'arm' })];
    const model = buildTabModel('arm', fields, [], []);
    expect(model.groups).toEqual([]);
    expect(model.cells).toEqual([]);
  });
});
