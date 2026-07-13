// arm completeness チェック（issue #106）の単体テスト
// - detectArmCompletenessWarning: 応答内の自己整合 + ArmStructures 確定 arm との突合で
//   (arm × arm レベル field) の欠落を検出する。検出は warning のみ（status に影響しない設計は
//   executeRun.test.ts 側で検証）
// - confirmedArmKeysByStudy: ArmStructures の全行 → study ごとの確定 arm キー一覧への畳み込み
// - describeArmCompletenessWarning: LLMApiLog / UI 用の人間可読文
import type { ArmStructureRow } from '../../../../src/domain/armStructure';
import type { ArmCompletenessRunWarning } from '../../../../src/domain/extractionRun';
import type { SchemaField } from '../../../../src/domain/schemaField';
import {
  confirmedArmKeysByStudy,
  describeArmCompletenessWarning,
  detectArmCompletenessWarning,
} from '../../../../src/features/extraction/armCompleteness';
import type { ValidatedAiItem } from '../../../../src/features/extraction/validateAiOutput';

function makeField(
  overrides: Pick<SchemaField, 'fieldId' | 'fieldName'> & Partial<SchemaField>,
): SchemaField {
  return {
    schemaVersion: 1,
    fieldIndex: 0,
    section: 'population',
    fieldLabel: overrides.fieldName,
    entityLevel: 'arm',
    dataType: 'text',
    unit: null,
    allowedValues: null,
    required: true,
    extractionInstruction: '',
    example: null,
    aiGenerated: true,
    note: null,
    ...overrides,
  };
}

const ARM_N = makeField({ fieldId: 'f_n', fieldName: 'sample_size' });
const ARM_NAME = makeField({ fieldId: 'f_name', fieldName: 'arm_name' });
const STUDY_DESIGN = makeField({
  fieldId: 'f_design',
  fieldName: 'study_design',
  entityLevel: 'study',
});
const OUTCOME_EVENTS = makeField({
  fieldId: 'f_events',
  fieldName: 'events',
  entityLevel: 'outcome_result',
  section: 'outcomes',
});

function makeItem(overrides: Pick<ValidatedAiItem, 'fieldId' | 'entityKey'>): ValidatedAiItem {
  return {
    value: 'v',
    notReported: false,
    quote: null,
    page: null,
    documentIndex: 1,
    confidence: null,
    forcedLowReasons: [],
    box: null,
    ...overrides,
  };
}

describe('detectArmCompletenessWarning', () => {
  test('応答に arm:2 が現れるのに arm:2 の arm レベル項目が欠けていれば warning を返す（自己整合基準）', () => {
    const warning = detectArmCompletenessWarning({
      studyId: 'study-1',
      section: null,
      fields: [STUDY_DESIGN, ARM_N, ARM_NAME],
      items: [
        makeItem({ fieldId: 'f_design', entityKey: '-' }),
        makeItem({ fieldId: 'f_n', entityKey: 'arm:1' }),
        makeItem({ fieldId: 'f_name', entityKey: 'arm:1' }),
        makeItem({ fieldId: 'f_n', entityKey: 'arm:2' }), // arm:2 は f_name が欠落
      ],
    });
    expect(warning).toEqual({
      kind: 'arm_completeness',
      studyId: 'study-1',
      section: null,
      expectedArmKeys: ['arm:1', 'arm:2'],
      missingItems: [{ armKey: 'arm:2', fieldId: 'f_name' }],
    });
  });

  test('outcome_result の |arm:n| セグメントにだけ現れる arm も期待集合に数える（arm 丸ごと欠落の検出）', () => {
    const warning = detectArmCompletenessWarning({
      studyId: 'study-1',
      section: null,
      fields: [ARM_N, OUTCOME_EVENTS],
      items: [
        makeItem({ fieldId: 'f_n', entityKey: 'arm:1' }),
        // arm:2 は outcome にだけ現れ、arm レベル項目が丸ごと無い
        makeItem({ fieldId: 'f_events', entityKey: 'outcome:mortality|arm:2|time:30d' }),
        // arm セグメントの無い outcome は期待集合に寄与しない
        makeItem({ fieldId: 'f_events', entityKey: 'outcome:mortality' }),
      ],
    });
    expect(warning?.expectedArmKeys).toEqual(['arm:1', 'arm:2']);
    expect(warning?.missingItems).toEqual([{ armKey: 'arm:2', fieldId: 'f_n' }]);
  });

  test('全 arm × 全 arm レベル項目が揃っていれば null（not_reported の返却も「返却」に数える）', () => {
    const notReported = {
      ...makeItem({ fieldId: 'f_name', entityKey: 'arm:2' }),
      value: null,
      notReported: true,
    };
    const warning = detectArmCompletenessWarning({
      studyId: 'study-1',
      section: null,
      fields: [ARM_N, ARM_NAME],
      items: [
        makeItem({ fieldId: 'f_n', entityKey: 'arm:1' }),
        makeItem({ fieldId: 'f_name', entityKey: 'arm:1' }),
        makeItem({ fieldId: 'f_n', entityKey: 'arm:2' }),
        notReported,
      ],
    });
    expect(warning).toBeNull();
  });

  test('バッチに arm レベル項目が無ければチェック対象外（null）', () => {
    const warning = detectArmCompletenessWarning({
      studyId: 'study-1',
      section: 'design',
      fields: [STUDY_DESIGN],
      items: [makeItem({ fieldId: 'f_design', entityKey: '-' })],
    });
    expect(warning).toBeNull();
  });

  test('応答にも確定群構成にも arm のシグナルが無ければチェック不能として null（過検出を避ける）', () => {
    const warning = detectArmCompletenessWarning({
      studyId: 'study-1',
      section: null,
      fields: [ARM_N],
      items: [makeItem({ fieldId: 'f_design', entityKey: '-' })],
      confirmedArmKeys: null,
    });
    expect(warning).toBeNull();
  });

  test('ArmStructures 確定済みの arm は応答に現れなくても期待集合に数える（確定 arm との突合）', () => {
    const warning = detectArmCompletenessWarning({
      studyId: 'study-1',
      section: 'population',
      fields: [ARM_N],
      items: [makeItem({ fieldId: 'f_n', entityKey: 'arm:1' })],
      confirmedArmKeys: ['arm:1', 'arm:2', 'arm:3'],
    });
    expect(warning).toEqual({
      kind: 'arm_completeness',
      studyId: 'study-1',
      section: 'population',
      expectedArmKeys: ['arm:1', 'arm:2', 'arm:3'],
      missingItems: [
        { armKey: 'arm:2', fieldId: 'f_n' },
        { armKey: 'arm:3', fieldId: 'f_n' },
      ],
    });
  });

  test('rob_domain の entity_key と形式不正の entity_key は無視する（防御的分岐）', () => {
    const warning = detectArmCompletenessWarning({
      studyId: 'study-1',
      section: null,
      fields: [ARM_N],
      items: [
        makeItem({ fieldId: 'f_rob', entityKey: 'rob:domain_1' }),
        makeItem({ fieldId: 'f_broken', entityKey: '' }), // parseEntityKey が null を返す
        makeItem({ fieldId: 'f_n', entityKey: 'arm:1' }),
      ],
    });
    expect(warning).toBeNull(); // arm:1 × f_n は揃っている
  });

  test('arm レベルの entity_key でもバッチ外の field_id は返却済みに数えない（防御的分岐）', () => {
    const warning = detectArmCompletenessWarning({
      studyId: 'study-1',
      section: null,
      fields: [ARM_N],
      // f_other はこのバッチの arm レベル項目ではないため、arm:1 × f_n は欠落のまま
      items: [makeItem({ fieldId: 'f_other', entityKey: 'arm:1' })],
    });
    expect(warning?.missingItems).toEqual([{ armKey: 'arm:1', fieldId: 'f_n' }]);
  });
});

describe('confirmedArmKeysByStudy', () => {
  function makeRow(overrides: Partial<ArmStructureRow> = {}): ArmStructureRow {
    return {
      studyId: 'study-1',
      version: 1,
      armKey: 'arm:1',
      armName: '介入群',
      annotator: 'a@example.com',
      annotatorType: 'human_with_ai',
      confirmedAt: '2026-07-01T00:00:00Z',
      note: null,
      ...overrides,
    };
  }

  test('空配列は空 Map', () => {
    expect(confirmedArmKeysByStudy([]).size).toBe(0);
  });

  test('annotator の最新 version の arm キー一覧を study ごとに返す', () => {
    const rows = [
      makeRow({ version: 1, armKey: 'arm:1' }),
      makeRow({ version: 1, armKey: 'arm:2' }),
      // 改訂で 3 群に増えた（version 2 が最新）
      makeRow({ version: 2, armKey: 'arm:1', confirmedAt: '2026-07-02T00:00:00Z' }),
      makeRow({ version: 2, armKey: 'arm:2', confirmedAt: '2026-07-02T00:00:00Z' }),
      makeRow({ version: 2, armKey: 'arm:3', confirmedAt: '2026-07-02T00:00:00Z' }),
      makeRow({ studyId: 'study-2', armKey: 'arm:1' }),
    ];
    const map = confirmedArmKeysByStudy(rows);
    expect(map.get('study-1')).toEqual(['arm:1', 'arm:2', 'arm:3']);
    expect(map.get('study-2')).toEqual(['arm:1']);
  });

  test('複数 annotator が確定済みなら confirmed_at が最も新しい annotator の構成を採用する', () => {
    const rows = [
      makeRow({ annotator: 'a@example.com', armKey: 'arm:1', confirmedAt: '2026-07-01T00:00:00Z' }),
      makeRow({ annotator: 'a@example.com', armKey: 'arm:2', confirmedAt: '2026-07-01T00:00:00Z' }),
      // 裁定後の consensus 確定（より新しい）は 3 群
      makeRow({
        annotator: 'consensus',
        annotatorType: 'consensus',
        armKey: 'arm:1',
        confirmedAt: '2026-07-03T00:00:00Z',
      }),
      makeRow({
        annotator: 'consensus',
        annotatorType: 'consensus',
        armKey: 'arm:2',
        confirmedAt: '2026-07-03T00:00:00Z',
      }),
      makeRow({
        annotator: 'consensus',
        annotatorType: 'consensus',
        armKey: 'arm:3',
        confirmedAt: '2026-07-03T00:00:00Z',
      }),
      // より古い第 3 の annotator は採用されない
      makeRow({ annotator: 'b@example.com', armKey: 'arm:1', confirmedAt: '2026-06-30T00:00:00Z' }),
    ];
    expect(confirmedArmKeysByStudy(rows).get('study-1')).toEqual(['arm:1', 'arm:2', 'arm:3']);
  });
});

describe('describeArmCompletenessWarning', () => {
  const warning: ArmCompletenessRunWarning = {
    kind: 'arm_completeness',
    studyId: 'study-1',
    section: null,
    expectedArmKeys: ['arm:1', 'arm:2'],
    missingItems: [
      { armKey: 'arm:2', fieldId: 'f_n' },
      { armKey: 'arm:2', fieldId: 'f_unknown' },
    ],
  };

  test('field_id を項目名へ解決した人間可読文を返す（未知の field_id は id のまま）', () => {
    const text = describeArmCompletenessWarning(warning, new Map([['f_n', 'sample_size']]));
    expect(text).toBe(
      'study study-1: 群 arm:1, arm:2 に対して arm レベル項目の欠落があります: ' +
        'arm:2 × sample_size、arm:2 × f_unknown（群の見落としの可能性。正当な未報告の可能性もあるため warning 扱い）',
    );
  });

  test('fieldNameById 省略時は field_id のまま、section があれば scope を付ける', () => {
    const text = describeArmCompletenessWarning({ ...warning, section: 'population' });
    expect(text).toContain('study study-1（section: population）:');
    expect(text).toContain('arm:2 × f_n');
  });
});
