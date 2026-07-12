import { NOT_REPORTED_TOKEN } from '../../../../src/domain/annotation';
import type { Evidence } from '../../../../src/domain/evidence';
import type { FieldDataType, SchemaField } from '../../../../src/domain/schemaField';
import type { CellGroup, TabModel, VerificationCell } from '../../../../src/features/verification/cells';
import { cellKeyOf, emptyCellState, type CellState } from '../../../../src/features/verification/cellState';
import {
  collectRobAlgorithmInfo,
  judgeDomain1Randomization,
  judgeDomain2Deviations,
  judgeDomain3Missing,
  judgeDomain4Measurement,
  judgeDomain5Selection,
  judgeOverallRob2,
  type Rob2SqAnswer,
} from '../../../../src/features/verification/robAlgorithm';

describe('judgeDomain1Randomization（SQ 1.1〜1.3）', () => {
  test.each([
    ['q1_1 が未回答', null, 'y', 'n'] as const,
    ['q1_2 が未回答', 'y', null, 'n'] as const,
    ['q1_3 が未回答', 'y', 'y', null] as const,
  ])('%s なら null（回答不足）', (_label, q1, q2, q3) => {
    expect(judgeDomain1Randomization(q1, q2, q3)).toBeNull();
  });

  test('1.2 = n/pn（隠蔽なし）は high', () => {
    expect(judgeDomain1Randomization('y', 'n', 'n')).toBe('high');
    expect(judgeDomain1Randomization('y', 'pn', 'n')).toBe('high');
  });

  test('1.2 = ni・1.3 = y/py は high', () => {
    expect(judgeDomain1Randomization('y', 'ni', 'y')).toBe('high');
  });

  test('1.2 = ni・1.3 = n または ni は some_concerns', () => {
    expect(judgeDomain1Randomization('y', 'ni', 'n')).toBe('some_concerns');
    expect(judgeDomain1Randomization('y', 'ni', 'ni')).toBe('some_concerns');
  });

  test('1.2 = ni・1.3 = na は null（無条件設問での想定外入力）', () => {
    expect(judgeDomain1Randomization('y', 'ni', 'na')).toBeNull();
  });

  test('1.2 = y・1.1 = n/pn は some_concerns', () => {
    expect(judgeDomain1Randomization('n', 'y', 'n')).toBe('some_concerns');
    expect(judgeDomain1Randomization('pn', 'y', 'n')).toBe('some_concerns');
  });

  test('1.2 = y・1.1 = y/py/ni・1.3 = n/pn/ni は low', () => {
    expect(judgeDomain1Randomization('y', 'y', 'n')).toBe('low');
    expect(judgeDomain1Randomization('py', 'y', 'pn')).toBe('low');
    expect(judgeDomain1Randomization('ni', 'y', 'ni')).toBe('low');
  });

  test('1.2 = y・1.1 = y/py/ni・1.3 = y/py は some_concerns', () => {
    expect(judgeDomain1Randomization('y', 'y', 'y')).toBe('some_concerns');
  });

  test('1.2 = y・1.1 = y・1.3 = na は null', () => {
    expect(judgeDomain1Randomization('y', 'y', 'na')).toBeNull();
  });

  test('1.2 = y・1.1 = na は null', () => {
    expect(judgeDomain1Randomization('na', 'y', 'n')).toBeNull();
  });

  test('1.2 = na は null', () => {
    expect(judgeDomain1Randomization('y', 'na', 'n')).toBeNull();
  });
});

describe('judgeDomain2Deviations（SQ 2.1〜2.7・effect of assignment 版）', () => {
  const FULL: readonly Rob2SqAnswer[] = ['n', 'n', 'n', 'n', 'n', 'y', 'n'];

  test.each([0, 1, 2, 3, 4, 5, 6])('SQ %i 番目が未回答なら null（回答不足）', (index) => {
    const args = [...FULL] as [
      Rob2SqAnswer | null,
      Rob2SqAnswer | null,
      Rob2SqAnswer | null,
      Rob2SqAnswer | null,
      Rob2SqAnswer | null,
      Rob2SqAnswer | null,
      Rob2SqAnswer | null,
    ];
    args[index] = null;
    expect(judgeDomain2Deviations(...args)).toBeNull();
  });

  test('2.1・2.2 が両方 n/pn（意識なし）+ 2.6 = y は low（part1・part2 とも low）', () => {
    expect(judgeDomain2Deviations('n', 'n', 'y', 'n', 'n', 'y', 'n')).toBe('low');
  });

  test('2.1 = y（片方だけ意識あり）・2.3 = n は low（part1）、2.6 = n・2.7 = n は some_concerns（part2）→ 全体 some_concerns', () => {
    expect(judgeDomain2Deviations('y', 'n', 'n', 'n', 'n', 'n', 'n')).toBe('some_concerns');
  });

  test('2.3 = ni は part1 = some_concerns', () => {
    // part2 は low（2.6 = y）にして part1 の効果だけを見る
    expect(judgeDomain2Deviations('y', 'y', 'ni', 'n', 'n', 'y', 'n')).toBe('some_concerns');
  });

  test('2.3 = y・2.4 = n（逸脱は結果に影響せず）は part1 = some_concerns', () => {
    expect(judgeDomain2Deviations('y', 'y', 'y', 'n', 'n', 'y', 'n')).toBe('some_concerns');
  });

  test('2.3 = y・2.4 = y・2.5 = y（逸脱は群間で均衡）は part1 = some_concerns', () => {
    expect(judgeDomain2Deviations('y', 'y', 'y', 'y', 'y', 'y', 'n')).toBe('some_concerns');
  });

  test('2.3 = y・2.4 = y・2.5 = n（逸脱は群間で不均衡）は part1 = high → 全体 high', () => {
    expect(judgeDomain2Deviations('y', 'y', 'y', 'y', 'n', 'y', 'n')).toBe('high');
  });

  test('2.6 = n・2.7 = y（対処なし解析の影響あり）は part2 = high → 全体 high（part1 は low で確認）', () => {
    expect(judgeDomain2Deviations('n', 'n', 'y', 'n', 'n', 'n', 'y')).toBe('high');
  });

  test('part1 = high・part2 = low の組み合わせも high（OR の左辺）', () => {
    expect(judgeDomain2Deviations('y', 'y', 'y', 'y', 'n', 'y', 'n')).toBe('high');
  });
});

describe('judgeDomain3Missing（SQ 3.1〜3.4）', () => {
  test.each([
    ['3.1 が未回答', null, 'n', 'n', 'n'] as const,
    ['3.2 が未回答', 'n', null, 'n', 'n'] as const,
    ['3.3 が未回答', 'n', 'n', null, 'n'] as const,
    ['3.4 が未回答', 'n', 'n', 'n', null] as const,
  ])('%s なら null（回答不足）', (_label, q1, q2, q3, q4) => {
    expect(judgeDomain3Missing(q1, q2, q3, q4)).toBeNull();
  });

  test('3.1 = y/py（ほぼ全例でデータあり）は low', () => {
    expect(judgeDomain3Missing('y', 'n', 'n', 'n')).toBe('low');
  });

  test('3.1 = n・3.2 = y（欠測があってもバイアスの証拠なし）は low', () => {
    expect(judgeDomain3Missing('n', 'y', 'n', 'n')).toBe('low');
  });

  test('3.1 = n・3.2 = n・3.3 = n（真値に依存しない）は low', () => {
    expect(judgeDomain3Missing('n', 'n', 'n', 'n')).toBe('low');
  });

  test('3.1 = n・3.2 = n・3.3 = y・3.4 = n は some_concerns', () => {
    expect(judgeDomain3Missing('n', 'n', 'y', 'n')).toBe('some_concerns');
  });

  test('3.1 = n・3.2 = n・3.3 = y・3.4 = y は high', () => {
    expect(judgeDomain3Missing('n', 'n', 'y', 'y')).toBe('high');
  });
});

describe('judgeDomain4Measurement（SQ 4.1〜4.5）', () => {
  test.each([
    ['4.1 が未回答', null, 'n', 'n', 'n', 'n'] as const,
    ['4.2 が未回答', 'n', null, 'n', 'n', 'n'] as const,
    ['4.3 が未回答', 'n', 'n', null, 'n', 'n'] as const,
    ['4.4 が未回答', 'n', 'n', 'n', null, 'n'] as const,
    ['4.5 が未回答', 'n', 'n', 'n', 'n', null] as const,
  ])('%s なら null（回答不足）', (_label, q1, q2, q3, q4, q5) => {
    expect(judgeDomain4Measurement(q1, q2, q3, q4, q5)).toBeNull();
  });

  test('4.1 = y（測定方法が不適切）は high', () => {
    expect(judgeDomain4Measurement('y', 'n', 'n', 'n', 'n')).toBe('high');
  });

  test('4.2 = y（群間で測定が異なりうる）は high', () => {
    expect(judgeDomain4Measurement('n', 'y', 'n', 'n', 'n')).toBe('high');
  });

  test('4.2 = n・4.3 = n（評価者は非盲検化を意識せず）は low', () => {
    expect(judgeDomain4Measurement('n', 'n', 'n', 'n', 'n')).toBe('low');
  });

  test('4.2 = n・4.3 = y・4.4 = n は low', () => {
    expect(judgeDomain4Measurement('n', 'n', 'y', 'n', 'n')).toBe('low');
  });

  test('4.2 = n・4.3 = y・4.4 = y・4.5 = n は some_concerns', () => {
    expect(judgeDomain4Measurement('n', 'n', 'y', 'y', 'n')).toBe('some_concerns');
  });

  test('4.2 = n・4.3 = y・4.4 = y・4.5 = y は high', () => {
    expect(judgeDomain4Measurement('n', 'n', 'y', 'y', 'y')).toBe('high');
  });

  test('4.2 = ni・4.3 = n は some_concerns', () => {
    expect(judgeDomain4Measurement('n', 'ni', 'n', 'n', 'n')).toBe('some_concerns');
  });

  test('4.2 = ni・4.3 = y・4.4 = n は some_concerns', () => {
    expect(judgeDomain4Measurement('n', 'ni', 'y', 'n', 'n')).toBe('some_concerns');
  });

  test('4.2 = ni・4.3 = y・4.4 = y・4.5 = n は some_concerns', () => {
    expect(judgeDomain4Measurement('n', 'ni', 'y', 'y', 'n')).toBe('some_concerns');
  });

  test('4.2 = ni・4.3 = y・4.4 = y・4.5 = y は high', () => {
    expect(judgeDomain4Measurement('n', 'ni', 'y', 'y', 'y')).toBe('high');
  });
});

describe('judgeDomain5Selection（SQ 5.1〜5.3）', () => {
  test.each([
    ['5.1 が未回答', null, 'n', 'n'] as const,
    ['5.2 が未回答', 'n', null, 'n'] as const,
    ['5.3 が未回答', 'n', 'n', null] as const,
  ])('%s なら null（回答不足）', (_label, q1, q2, q3) => {
    expect(judgeDomain5Selection(q1, q2, q3)).toBeNull();
  });

  test('5.2 = y（複数アウトカム測定から選択された疑い）は high', () => {
    expect(judgeDomain5Selection('n', 'y', 'n')).toBe('high');
  });

  test('5.3 = y（複数解析から選択された疑い）は high', () => {
    expect(judgeDomain5Selection('n', 'n', 'y')).toBe('high');
  });

  test('5.2・5.3 とも n・5.1 = y（事前解析計画に沿う）は low', () => {
    expect(judgeDomain5Selection('y', 'n', 'n')).toBe('low');
  });

  test('5.2・5.3 とも n・5.1 = n は some_concerns', () => {
    expect(judgeDomain5Selection('n', 'n', 'n')).toBe('some_concerns');
  });

  test('5.2 = ni（high でも両方 n でもない）は some_concerns', () => {
    expect(judgeDomain5Selection('y', 'ni', 'n')).toBe('some_concerns');
  });
});

describe('judgeOverallRob2（worst-domain 規則）', () => {
  test('空配列は null', () => {
    expect(judgeOverallRob2([])).toBeNull();
  });

  test('いずれかのドメインが null（未解決）なら null', () => {
    expect(judgeOverallRob2(['low', null, 'high'])).toBeNull();
  });

  test('全ドメイン low なら low', () => {
    expect(judgeOverallRob2(['low', 'low', 'low'])).toBe('low');
  });

  test('high を含まず some_concerns を含むなら some_concerns', () => {
    expect(judgeOverallRob2(['low', 'some_concerns', 'low'])).toBe('some_concerns');
  });

  test('いずれか high を含むなら high（順序に依らず最悪値を採用）', () => {
    expect(judgeOverallRob2(['low', 'high', 'some_concerns'])).toBe('high');
  });
});

// --- collectRobAlgorithmInfo（UI 配線用の集約） ------------------------------

function makeField(overrides: Partial<SchemaField> = {}): SchemaField {
  return {
    schemaVersion: 1,
    fieldId: 'f-rob2-judgement',
    fieldIndex: 1,
    section: 'risk_of_bias_rob2',
    fieldName: 'rob2_judgement',
    fieldLabel: 'RoB 2 判定（ドメイン別）',
    entityLevel: 'rob_domain',
    dataType: 'enum' as FieldDataType,
    unit: null,
    allowedValues: 'low|some_concerns|high',
    required: true,
    extractionInstruction: '',
    example: null,
    aiGenerated: false,
    note: null,
    ...overrides,
  };
}

function makeEvidence(fieldId: string, entityKey: string, value: string | null): Evidence | null {
  if (value === null) {
    return null;
  }
  return {
    evidenceId: `ev-${fieldId}-${entityKey}`,
    runId: 'run-1',
    studyId: 'study-1',
    documentId: 'doc-1',
    fieldId,
    entityKey,
    value,
    notReported: value === NOT_REPORTED_TOKEN,
    quote: null,
    page: null,
    confidence: 'high',
    anchorStatus: null,
    bboxPage: null,
    bbox: null,
    relocatedFrom: null,
  };
}

/** SQ / judgement セル 1 件を組み立てる。aiValue = Evidence.value、stateValue = 判定確定値 */
function makeSqCell(
  fieldName: string,
  entityKey: string,
  aiValue: string | null,
  options: { stateValue?: string | null; status?: CellState['status']; fieldOverrides?: Partial<SchemaField> } = {},
): VerificationCell {
  const field = makeField({
    fieldId: `f-${fieldName}`,
    fieldName,
    dataType: fieldName.endsWith('_judgement') ? 'enum' : 'enum',
    allowedValues: fieldName.endsWith('_judgement') ? 'low|some_concerns|high' : 'y|py|pn|n|ni|na',
    ...options.fieldOverrides,
  });
  const state: CellState =
    options.stateValue === undefined
      ? emptyCellState()
      : { status: options.status ?? 'edit', value: options.stateValue, stack: [] };
  return {
    cellKey: cellKeyOf(field.fieldId, entityKey),
    field,
    entityKey,
    evidence: makeEvidence(field.fieldId, entityKey, aiValue),
    state,
  };
}

function group(cells: VerificationCell[], heading = 'domain'): CellGroup {
  return { heading, cells };
}

/** D1 の 3 SQ 全問 + judgement セルを持つグループ（回答は低リスクになる組み合わせ = low） */
function makeD1Group(overrides: { sqValues?: [string, string, string]; judgementAi?: string | null } = {}): CellGroup {
  const entityKey = 'rob:d1_randomization';
  const [a, b, c] = overrides.sqValues ?? ['y', 'y', 'n'];
  return group([
    makeSqCell('rob2_sq1_1', entityKey, a),
    makeSqCell('rob2_sq1_2', entityKey, b),
    makeSqCell('rob2_sq1_3', entityKey, c),
    makeSqCell('rob2_judgement', entityKey, overrides.judgementAi ?? 'low'),
  ]);
}

describe('collectRobAlgorithmInfo', () => {
  test('SQ 回答が揃ったドメインは提案を算出する（現在値と一致すれば mismatch なし）', () => {
    const model: TabModel = { groups: [makeD1Group()], cells: [] };
    const result = collectRobAlgorithmInfo(model);
    const info = result.get(cellKeyOf('f-rob2_judgement', 'rob:d1_randomization'));
    expect(info).toEqual({
      cellKey: cellKeyOf('f-rob2_judgement', 'rob:d1_randomization'),
      suggestion: 'low',
      currentValue: 'low',
      mismatch: false,
      aiUnconfirmed: true, // AI 値があり判定は未検証（emptyCellState）
    });
  });

  test('提案と現在値が食い違えば mismatch = true', () => {
    const d1 = makeD1Group({ judgementAi: 'high' }); // SQ は low の組み合わせのまま
    const model: TabModel = { groups: [d1], cells: [] };
    const result = collectRobAlgorithmInfo(model);
    const info = result.get(cellKeyOf('f-rob2_judgement', 'rob:d1_randomization'));
    expect(info?.suggestion).toBe('low');
    expect(info?.currentValue).toBe('high');
    expect(info?.mismatch).toBe(true);
  });

  test('判定確定値（state.value）は AI 値より優先して現在値に採用される（#65 と同じ優先規則）', () => {
    const entityKey = 'rob:d1_randomization';
    const cells = [
      makeSqCell('rob2_sq1_1', entityKey, 'y'),
      makeSqCell('rob2_sq1_2', entityKey, 'y'),
      makeSqCell('rob2_sq1_3', entityKey, 'n'),
      makeSqCell('rob2_judgement', entityKey, 'high', { stateValue: 'low', status: 'edit' }),
    ];
    const model: TabModel = { groups: [group(cells)], cells: [] };
    const info = collectRobAlgorithmInfo(model).get(cellKeyOf('f-rob2_judgement', entityKey));
    expect(info?.currentValue).toBe('low'); // AI は high だが人間の確定値 low を採用
    expect(info?.mismatch).toBe(false); // 提案 low と確定値 low は一致
    expect(info?.aiUnconfirmed).toBe(false); // 判定済み（status='edit'）のため未確認ではない
  });

  test('SQ が一部未回答（field 自体が group に無い）なら提案なし（null）', () => {
    const entityKey = 'rob:d1_randomization';
    const cells = [
      makeSqCell('rob2_sq1_1', entityKey, 'y'),
      // rob2_sq1_2 は挿入されていない（部分プリセット等）
      makeSqCell('rob2_sq1_3', entityKey, 'n'),
      makeSqCell('rob2_judgement', entityKey, 'low'),
    ];
    const model: TabModel = { groups: [group(cells)], cells: [] };
    const info = collectRobAlgorithmInfo(model).get(cellKeyOf('f-rob2_judgement', entityKey));
    expect(info?.suggestion).toBeNull();
    expect(info?.mismatch).toBe(false);
  });

  test('SQ フィールドは存在するが値が無い（AI 値・確定値とも null）場合も提案なし（null）', () => {
    const entityKey = 'rob:d1_randomization';
    const cells = [
      makeSqCell('rob2_sq1_1', entityKey, 'y'),
      makeSqCell('rob2_sq1_2', entityKey, null), // フィールドは存在するが値なし
      makeSqCell('rob2_sq1_3', entityKey, 'n'),
      makeSqCell('rob2_judgement', entityKey, 'low'),
    ];
    const model: TabModel = { groups: [group(cells)], cells: [] };
    const info = collectRobAlgorithmInfo(model).get(cellKeyOf('f-rob2_judgement', entityKey));
    expect(info?.suggestion).toBeNull();
  });

  test('SQ フィールドの値が y/py/pn/n/ni/na のいずれでもない自由記述（誤入力）は未回答として扱う', () => {
    const entityKey = 'rob:d1_randomization';
    const cells = [
      makeSqCell('rob2_sq1_1', entityKey, 'yes, probably'), // 許容コード外
      makeSqCell('rob2_sq1_2', entityKey, 'y'),
      makeSqCell('rob2_sq1_3', entityKey, 'n'),
      makeSqCell('rob2_judgement', entityKey, 'low'),
    ];
    const model: TabModel = { groups: [group(cells)], cells: [] };
    const info = collectRobAlgorithmInfo(model).get(cellKeyOf('f-rob2_judgement', entityKey));
    expect(info?.suggestion).toBeNull();
  });

  test('AI 値が無い（手入力のみ）セルは aiUnconfirmed = false', () => {
    const entityKey = 'rob:d1_randomization';
    const cells = [
      makeSqCell('rob2_sq1_1', entityKey, 'y'),
      makeSqCell('rob2_sq1_2', entityKey, 'y'),
      makeSqCell('rob2_sq1_3', entityKey, 'n'),
      makeSqCell('rob2_judgement', entityKey, null),
    ];
    const model: TabModel = { groups: [group(cells)], cells: [] };
    const info = collectRobAlgorithmInfo(model).get(cellKeyOf('f-rob2_judgement', entityKey));
    expect(info?.aiUnconfirmed).toBe(false);
    expect(info?.currentValue).toBeNull();
  });

  test('人間が判定済み（status !== unverified）なら aiUnconfirmed = false', () => {
    const entityKey = 'rob:d1_randomization';
    const cells = [
      makeSqCell('rob2_sq1_1', entityKey, 'y'),
      makeSqCell('rob2_sq1_2', entityKey, 'y'),
      makeSqCell('rob2_sq1_3', entityKey, 'n'),
      makeSqCell('rob2_judgement', entityKey, 'low', { stateValue: 'low', status: 'accept' }),
    ];
    const model: TabModel = { groups: [group(cells)], cells: [] };
    const info = collectRobAlgorithmInfo(model).get(cellKeyOf('f-rob2_judgement', entityKey));
    expect(info?.aiUnconfirmed).toBe(false);
  });

  test('現在値が enum として解釈できない文字列（自由記述の誤入力）は currentValue = null', () => {
    const entityKey = 'rob:d1_randomization';
    const cells = [
      makeSqCell('rob2_sq1_1', entityKey, 'y'),
      makeSqCell('rob2_sq1_2', entityKey, 'y'),
      makeSqCell('rob2_sq1_3', entityKey, 'n'),
      makeSqCell('rob2_judgement', entityKey, 'not a valid judgement'),
    ];
    const model: TabModel = { groups: [group(cells)], cells: [] };
    const info = collectRobAlgorithmInfo(model).get(cellKeyOf('f-rob2_judgement', entityKey));
    expect(info?.currentValue).toBeNull();
    expect(info?.mismatch).toBe(false); // currentValue が無いので不一致判定はしない
  });

  test('NOT_REPORTED（NR）の判定確定値は「値なし」として扱う', () => {
    const entityKey = 'rob:d1_randomization';
    const cells = [
      makeSqCell('rob2_sq1_1', entityKey, 'y'),
      makeSqCell('rob2_sq1_2', entityKey, 'y'),
      makeSqCell('rob2_sq1_3', entityKey, 'n'),
      makeSqCell('rob2_judgement', entityKey, 'low', { stateValue: NOT_REPORTED_TOKEN, status: 'not_reported' }),
    ];
    const model: TabModel = { groups: [group(cells)], cells: [] };
    const info = collectRobAlgorithmInfo(model).get(cellKeyOf('f-rob2_judgement', entityKey));
    expect(info?.currentValue).toBeNull();
  });

  test('overall は他 5 ドメインの現在判定値から提案を算出する（全ドメイン揃えば low）', () => {
    const entityKey = 'rob:overall';
    const groups: CellGroup[] = [
      makeD1Group({ sqValues: ['y', 'y', 'n'], judgementAi: 'low' }), // low
      group([makeSqCell('rob2_judgement', 'rob:d2_deviations', 'low', { stateValue: 'low', status: 'accept' })]),
      group([makeSqCell('rob2_judgement', 'rob:d3_missing_data', 'low', { stateValue: 'low', status: 'accept' })]),
      group([makeSqCell('rob2_judgement', 'rob:d4_measurement', 'low', { stateValue: 'low', status: 'accept' })]),
      group([makeSqCell('rob2_judgement', 'rob:d5_reporting', 'low', { stateValue: 'low', status: 'accept' })]),
      group([makeSqCell('rob2_judgement', entityKey, 'low')]),
    ];
    const model: TabModel = { groups, cells: [] };
    const info = collectRobAlgorithmInfo(model).get(cellKeyOf('f-rob2_judgement', entityKey));
    expect(info?.suggestion).toBe('low');
  });

  test('overall はいずれか 1 ドメインでも欠けていれば提案なし', () => {
    const entityKey = 'rob:overall';
    const groups: CellGroup[] = [
      makeD1Group({ sqValues: ['y', 'y', 'n'], judgementAi: 'low' }),
      group([makeSqCell('rob2_judgement', 'rob:d2_deviations', 'low', { stateValue: 'low', status: 'accept' })]),
      // d3・d4・d5 は未挿入
      group([makeSqCell('rob2_judgement', entityKey, 'low')]),
    ];
    const model: TabModel = { groups, cells: [] };
    const info = collectRobAlgorithmInfo(model).get(cellKeyOf('f-rob2_judgement', entityKey));
    expect(info?.suggestion).toBeNull();
  });

  test('overall はいずれか 1 ドメインの現在値が未解決（null）でも提案なし', () => {
    const entityKey = 'rob:overall';
    const groups: CellGroup[] = [
      makeD1Group({ sqValues: ['y', 'y', 'n'], judgementAi: 'low' }),
      group([makeSqCell('rob2_judgement', 'rob:d2_deviations', null)]), // AI 値も確定値もなし
      group([makeSqCell('rob2_judgement', 'rob:d3_missing_data', 'low', { stateValue: 'low', status: 'accept' })]),
      group([makeSqCell('rob2_judgement', 'rob:d4_measurement', 'low', { stateValue: 'low', status: 'accept' })]),
      group([makeSqCell('rob2_judgement', 'rob:d5_reporting', 'low', { stateValue: 'low', status: 'accept' })]),
      group([makeSqCell('rob2_judgement', entityKey, 'low')]),
    ];
    const model: TabModel = { groups, cells: [] };
    const info = collectRobAlgorithmInfo(model).get(cellKeyOf('f-rob2_judgement', entityKey));
    expect(info?.suggestion).toBeNull();
  });

  test('overall が robins_i_judgement（rob2_judgement 以外）のときは suggestion 計算をスキップし null', () => {
    const entityKey = 'rob:overall';
    const cells = [
      makeSqCell('robins_i_judgement', entityKey, 'moderate', {
        fieldOverrides: {
          fieldId: 'f-robins-i-overall',
          allowedValues: 'low|moderate|serious|critical|no_information',
        },
      }),
    ];
    const model: TabModel = { groups: [group(cells)], cells: [] };
    const info = collectRobAlgorithmInfo(model).get(cellKeyOf('f-robins-i-overall', entityKey));
    expect(info?.suggestion).toBeNull();
  });

  test('ROBINS-I 等 SQ を持たないドメイン（robins_i_judgement）は suggestion が常に null で aiUnconfirmed だけ有効', () => {
    const entityKey = 'rob:d1_confounding';
    const cells = [
      makeSqCell('robins_i_judgement', entityKey, 'moderate', {
        fieldOverrides: {
          fieldId: 'f-robins-i-judgement',
          allowedValues: 'low|moderate|serious|critical|no_information',
        },
      }),
    ];
    const model: TabModel = { groups: [group(cells)], cells: [] };
    const info = collectRobAlgorithmInfo(model).get(cellKeyOf('f-robins-i-judgement', entityKey));
    expect(info?.suggestion).toBeNull();
    expect(info?.aiUnconfirmed).toBe(true);
  });

  test('rob2 軽量版・SQ 完全版が混在する group（field_name が同じ rob2_judgement のみ）でも通常どおり動く', () => {
    // 実運用では field_name 衝突がエディタ確定前に検出されるため通常発生しないが、
    // group 内を漏れなく走査する実装であることの防御的確認
    const model: TabModel = { groups: [makeD1Group()], cells: [] };
    expect(collectRobAlgorithmInfo(model).size).toBe(1);
  });

  test('rob_domain 以外のタブ（study 等）は自然に空になる', () => {
    const cell = makeSqCell('sample_size_total', '-', '100', {
      fieldOverrides: { fieldId: 'f-n', entityLevel: 'study', dataType: 'integer', allowedValues: null },
    });
    const model: TabModel = { groups: [group([cell])], cells: [] };
    expect(collectRobAlgorithmInfo(model)).toEqual(new Map());
  });

  test('entity_key が形式不正な group は無視する（防御）', () => {
    const cell = makeSqCell('rob2_judgement', 'bogus', 'low');
    const model: TabModel = { groups: [group([cell])], cells: [] };
    expect(collectRobAlgorithmInfo(model)).toEqual(new Map());
  });

  test('cells が空の group は無視する（防御）', () => {
    const model: TabModel = { groups: [{ heading: 'empty', cells: [] }], cells: [] };
    expect(collectRobAlgorithmInfo(model)).toEqual(new Map());
  });

  test('judgement 系フィールドを持たない rob_domain group は無視する', () => {
    const entityKey = 'rob:d1_randomization';
    const cell = makeSqCell('rob2_sq1_1', entityKey, 'y');
    const model: TabModel = { groups: [group([cell])], cells: [] };
    expect(collectRobAlgorithmInfo(model)).toEqual(new Map());
  });
});
