// enum 項目の許容値まわりの純ロジック（issue #254）。
// DOM 側（チップ描画・警告の 2 形態）は tests/unit/app/views/enumChoiceEditor.test.ts が担う
import { NOT_REPORTED_TOKEN, type AnnotatorType } from '../../../../src/domain/annotation';
import type { Decision } from '../../../../src/domain/decision';
import type { SchemaField } from '../../../../src/domain/schemaField';
import {
  ENUM_CHIP_MAX,
  buildEnumCandidates,
  collectOtherValues,
  isOutOfAllowedValues,
  parseAllowedValues,
} from '../../../../src/features/verification/enumOptions';

function makeField(overrides: Partial<SchemaField> = {}): SchemaField {
  return {
    schemaVersion: 1,
    fieldId: 'f-rob',
    fieldIndex: 1,
    section: 'risk_of_bias',
    fieldName: 'rob_d1_judgement',
    fieldLabel: 'D1 判定',
    entityLevel: 'rob_domain',
    dataType: 'enum',
    unit: null,
    allowedValues: 'low|some_concerns|high',
    required: true,
    extractionInstruction: 'ドメイン 1 の判定',
    example: null,
    aiGenerated: false,
    note: null,
    ...overrides,
  };
}

function makeDecision(overrides: Partial<Decision> = {}): Decision {
  return {
    decidedAt: '2026-08-11T00:00:00.000Z',
    decidedBy: 'me@example.com',
    studyId: 'study-1',
    fieldId: 'f-rob',
    entityKey: 'rob:d1',
    annotator: 'me@example.com',
    annotatorType: 'human_with_ai',
    schemaVersion: 1,
    action: 'edit',
    value: 'low risk',
    note: null,
    ...overrides,
  };
}

describe('parseAllowedValues', () => {
  test('enum + 許容値ありは `|` 区切りで分割する', () => {
    expect(parseAllowedValues(makeField())).toEqual(['low', 'some_concerns', 'high']);
  });

  test('前後の空白は落とし、重複は初出のみ残す', () => {
    const field = makeField({ allowedValues: ' low | high |low| ' });
    expect(parseAllowedValues(field)).toEqual(['low', 'high']);
  });

  test('enum 以外の data_type は null（従来の自由入力へフォールバックさせる）', () => {
    expect(parseAllowedValues(makeField({ dataType: 'text' }))).toBeNull();
  });

  test('許容値が未設定なら null', () => {
    expect(parseAllowedValues(makeField({ allowedValues: null }))).toBeNull();
  });

  test('区切り文字だけで実体が無い（旧版データ・手書きシートの防御）なら null', () => {
    expect(parseAllowedValues(makeField({ allowedValues: ' | | ' }))).toBeNull();
  });

  test('チップ列の上限は数字キー 1〜9 と同数', () => {
    expect(ENUM_CHIP_MAX).toBe(9);
  });
});

describe('isOutOfAllowedValues', () => {
  test('許容値に含まれる値は false', () => {
    expect(isOutOfAllowedValues(makeField(), 'low')).toBe(false);
  });

  test('許容値に無い値は true', () => {
    expect(isOutOfAllowedValues(makeField(), 'low risk')).toBe(true);
  });

  test('未入力（null / 空文字）は対象外', () => {
    expect(isOutOfAllowedValues(makeField(), null)).toBe(false);
    expect(isOutOfAllowedValues(makeField(), '')).toBe(false);
  });

  test('未報告トークンは対象外（enum の not_reported セル全件への誤警告を避ける）', () => {
    expect(isOutOfAllowedValues(makeField(), NOT_REPORTED_TOKEN)).toBe(false);
  });

  test('enum 以外・許容値なしの項目は常に false', () => {
    expect(isOutOfAllowedValues(makeField({ dataType: 'text' }), 'なんでも')).toBe(false);
  });
});

describe('collectOtherValues', () => {
  test('許容値外だけを初出順・重複なしで残す', () => {
    const values = collectOtherValues(makeField(), [
      'low',
      'low risk',
      'Low',
      'low risk',
      NOT_REPORTED_TOKEN,
    ]);
    expect(values).toEqual(['low risk', 'Low']);
  });

  test('enum 以外の項目は候補なし', () => {
    expect(collectOtherValues(makeField({ dataType: 'text' }), ['なんでも'])).toEqual([]);
  });
});

describe('buildEnumCandidates', () => {
  test('field_id 単位に、重複なし・初出順で集める', () => {
    const candidates = buildEnumCandidates(
      [
        makeDecision({ value: 'low risk' }),
        makeDecision({ value: 'low risk' }),
        makeDecision({ fieldId: 'f-other', value: 'その他の値' }),
        makeDecision({ value: 'Low' }),
      ],
      'me@example.com',
      'human_with_ai',
    );
    expect(candidates.get('f-rob')).toEqual(['low risk', 'Low']);
    expect(candidates.get('f-other')).toEqual(['その他の値']);
  });

  test('別 annotator（email）の判定は混ぜない', () => {
    const candidates = buildEnumCandidates(
      [makeDecision({ annotator: 'other@example.com', value: 'other value' })],
      'me@example.com',
      'human_with_ai',
    );
    expect(candidates.size).toBe(0);
  });

  test('同一 email でも annotator_type が違えば混ぜない（盲検保護。design §5.2）', () => {
    // with_ai の accept は AI 値をそのまま Decision.value に保存するため、緩く絞ると
    // AI 抽出値が独立入力モードの候補へ漏れる
    const candidates = buildEnumCandidates(
      [makeDecision({ annotatorType: 'human_with_ai', action: 'accept', value: 'AI が出した値' })],
      'me@example.com',
      'human_independent',
    );
    expect(candidates.size).toBe(0);
  });

  test('未入力（null / 空文字）・未報告トークンは候補にしない', () => {
    const candidates = buildEnumCandidates(
      [
        makeDecision({ value: null }),
        makeDecision({ value: '' }),
        makeDecision({ value: NOT_REPORTED_TOKEN }),
      ],
      'me@example.com',
      'human_with_ai',
    );
    expect(candidates.size).toBe(0);
  });

  test('consensus 行（S12 裁定）も同じ規則で集められる', () => {
    const annotatorType: AnnotatorType = 'consensus';
    const candidates = buildEnumCandidates(
      [makeDecision({ annotator: 'consensus', annotatorType, value: '第 3 の値' })],
      'consensus',
      annotatorType,
    );
    expect(candidates.get('f-rob')).toEqual(['第 3 の値']);
  });
});
