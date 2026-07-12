import { NOT_REPORTED_TOKEN } from '../../../../src/domain/annotation';
import type { Evidence } from '../../../../src/domain/evidence';
import type { FieldDataType, SchemaField } from '../../../../src/domain/schemaField';
import { ROBINS_I_DOMAINS, ROBINS_I_SQ_FIELD_NAMES } from '../../../../src/features/schema/presets/robTemplates';
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
  judgeOverallRobinsI,
  judgeRobinsIDomain1Confounding,
  judgeRobinsIDomain2Selection,
  judgeRobinsIDomain3Classification,
  judgeRobinsIDomain4Deviations,
  judgeRobinsIDomain5Missing,
  judgeRobinsIDomain6Measurement,
  judgeRobinsIDomain7Reporting,
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

// --- ROBINS-I（issue #61 PR2 = issue #87） -----------------------------------

describe('judgeRobinsIDomain1Confounding（SQ 1.1〜1.8）', () => {
  test('1.1 が未回答なら null', () => {
    expect(judgeRobinsIDomain1Confounding(null, 'y', 'n', 'y', 'y', 'n', null, null)).toBeNull();
  });

  test('1.1 = n/pn（交絡の可能性なし）は low', () => {
    expect(judgeRobinsIDomain1Confounding('n', null, null, null, null, null, null, null)).toBe('low');
    expect(judgeRobinsIDomain1Confounding('pn', null, null, null, null, null, null, null)).toBe('low');
  });

  test('1.1 が ni/na（原典上あり得ない想定外入力）は null', () => {
    expect(judgeRobinsIDomain1Confounding('ni', null, null, null, null, null, null, null)).toBeNull();
    expect(judgeRobinsIDomain1Confounding('na', null, null, null, null, null, null, null)).toBeNull();
  });

  test('1.1 = y・1.2 が未回答なら null', () => {
    expect(judgeRobinsIDomain1Confounding('y', null, null, null, null, null, null, null)).toBeNull();
  });

  test('1.2 = n/pn（ベースライン経路）→ 1.4/1.5 で判定', () => {
    expect(judgeRobinsIDomain1Confounding('y', 'n', null, 'y', 'y', 'n', null, null)).toBe('moderate');
    expect(judgeRobinsIDomain1Confounding('y', 'pn', null, 'y', 'y', 'n', null, null)).toBe('moderate');
  });

  test('1.2 = y・1.3 が未回答なら null', () => {
    expect(judgeRobinsIDomain1Confounding('y', 'y', null, null, null, null, null, null)).toBeNull();
  });

  test('1.2 = y・1.3 = n/pn（ベースライン経路）→ 1.4/1.5 で判定', () => {
    expect(judgeRobinsIDomain1Confounding('y', 'y', 'n', 'y', 'y', 'n', null, null)).toBe('moderate');
  });

  test('1.2 = y・1.3 = y/py（時間依存経路）→ 1.7/1.8 で判定', () => {
    expect(judgeRobinsIDomain1Confounding('y', 'y', 'y', null, null, null, 'y', 'y')).toBe('moderate');
  });

  test('1.2 = y・1.3 が ni/na（経路判定不能）は null', () => {
    expect(judgeRobinsIDomain1Confounding('y', 'y', 'ni', null, null, null, null, null)).toBeNull();
    expect(judgeRobinsIDomain1Confounding('y', 'y', 'na', null, null, null, null, null)).toBeNull();
  });

  test('1.2 が ni/na（経路判定不能）は null', () => {
    expect(judgeRobinsIDomain1Confounding('y', 'ni', null, null, null, null, null, null)).toBeNull();
    expect(judgeRobinsIDomain1Confounding('y', 'na', null, null, null, null, null, null)).toBeNull();
  });

  test('ベースライン経路: 1.4 が未回答なら null', () => {
    expect(judgeRobinsIDomain1Confounding('y', 'n', null, null, null, null, null, null)).toBeNull();
  });

  test('ベースライン経路: 1.4 = n/pn/ni は serious', () => {
    expect(judgeRobinsIDomain1Confounding('y', 'n', null, 'n', null, null, null, null)).toBe('serious');
    expect(judgeRobinsIDomain1Confounding('y', 'n', null, 'pn', null, null, null, null)).toBe('serious');
    expect(judgeRobinsIDomain1Confounding('y', 'n', null, 'ni', null, null, null, null)).toBe('serious');
  });

  test('ベースライン経路: 1.4 = na（想定外）は null', () => {
    expect(judgeRobinsIDomain1Confounding('y', 'n', null, 'na', null, null, null, null)).toBeNull();
  });

  test('ベースライン経路: 1.4 = y・1.5 が未回答なら null', () => {
    expect(judgeRobinsIDomain1Confounding('y', 'n', null, 'y', null, null, null, null)).toBeNull();
  });

  test('ベースライン経路: 1.4 = y・1.5 = n/pn/ni は serious', () => {
    expect(judgeRobinsIDomain1Confounding('y', 'n', null, 'y', 'n', null, null, null)).toBe('serious');
    expect(judgeRobinsIDomain1Confounding('y', 'n', null, 'y', 'pn', null, null, null)).toBe('serious');
    expect(judgeRobinsIDomain1Confounding('y', 'n', null, 'y', 'ni', null, null, null)).toBe('serious');
  });

  test('ベースライン経路: 1.4 = y・1.5 = y/py は moderate', () => {
    expect(judgeRobinsIDomain1Confounding('y', 'n', null, 'y', 'y', null, null, null)).toBe('moderate');
    expect(judgeRobinsIDomain1Confounding('y', 'n', null, 'y', 'py', null, null, null)).toBe('moderate');
  });

  test('ベースライン経路: 1.4 = y・1.5 = na（想定外）は null', () => {
    expect(judgeRobinsIDomain1Confounding('y', 'n', null, 'y', 'na', null, null, null)).toBeNull();
  });

  test('1.6（post-intervention 変数への不適切調整）は判定に使わない（値を変えても結果は同じ）', () => {
    expect(judgeRobinsIDomain1Confounding('y', 'n', null, 'y', 'y', 'y', null, null)).toBe('moderate');
    expect(judgeRobinsIDomain1Confounding('y', 'n', null, 'y', 'y', 'n', null, null)).toBe('moderate');
  });

  test('時間依存経路: 1.7 が未回答なら null', () => {
    expect(judgeRobinsIDomain1Confounding('y', 'y', 'y', null, null, null, null, null)).toBeNull();
  });

  test('時間依存経路: 1.7 = n/pn/ni は serious', () => {
    expect(judgeRobinsIDomain1Confounding('y', 'y', 'y', null, null, null, 'n', null)).toBe('serious');
    expect(judgeRobinsIDomain1Confounding('y', 'y', 'y', null, null, null, 'pn', null)).toBe('serious');
    expect(judgeRobinsIDomain1Confounding('y', 'y', 'y', null, null, null, 'ni', null)).toBe('serious');
  });

  test('時間依存経路: 1.7 = na（想定外）は null', () => {
    expect(judgeRobinsIDomain1Confounding('y', 'y', 'y', null, null, null, 'na', null)).toBeNull();
  });

  test('時間依存経路: 1.7 = y・1.8 が未回答なら null', () => {
    expect(judgeRobinsIDomain1Confounding('y', 'y', 'y', null, null, null, 'y', null)).toBeNull();
  });

  test('時間依存経路: 1.7 = y・1.8 = n/pn/ni は serious', () => {
    expect(judgeRobinsIDomain1Confounding('y', 'y', 'y', null, null, null, 'y', 'n')).toBe('serious');
    expect(judgeRobinsIDomain1Confounding('y', 'y', 'y', null, null, null, 'y', 'pn')).toBe('serious');
    expect(judgeRobinsIDomain1Confounding('y', 'y', 'y', null, null, null, 'y', 'ni')).toBe('serious');
  });

  test('時間依存経路: 1.7 = y・1.8 = y/py は moderate', () => {
    expect(judgeRobinsIDomain1Confounding('y', 'y', 'y', null, null, null, 'y', 'y')).toBe('moderate');
    expect(judgeRobinsIDomain1Confounding('y', 'y', 'y', null, null, null, 'y', 'py')).toBe('moderate');
  });

  test('時間依存経路: 1.7 = y・1.8 = na（想定外）は null', () => {
    expect(judgeRobinsIDomain1Confounding('y', 'y', 'y', null, null, null, 'y', 'na')).toBeNull();
  });
});

describe('judgeRobinsIDomain2Selection（SQ 2.1〜2.5）', () => {
  test('2.1 が未回答なら null', () => {
    expect(judgeRobinsIDomain2Selection(null, null, null, 'y', null)).toBeNull();
  });

  test('2.4 が未回答なら null', () => {
    expect(judgeRobinsIDomain2Selection('n', null, null, null, null)).toBeNull();
  });

  test('2.1 = n/pn・2.4 = y/py は low（特性起因の懸念なし・ラグなし）', () => {
    expect(judgeRobinsIDomain2Selection('n', null, null, 'y', null)).toBe('low');
    expect(judgeRobinsIDomain2Selection('pn', null, null, 'py', null)).toBe('low');
  });

  test('2.1 = y・2.2 が未回答なら null', () => {
    expect(judgeRobinsIDomain2Selection('y', null, null, 'y', null)).toBeNull();
  });

  test('2.1 = y・2.2 = y・2.3 が未回答なら null', () => {
    expect(judgeRobinsIDomain2Selection('y', 'y', null, 'y', null)).toBeNull();
  });

  test('2.2 と 2.3 が両方 y/py（特性起因の懸念あり）+ 2.4 = n（ラグもあり）+ 2.5 = y は moderate', () => {
    expect(judgeRobinsIDomain2Selection('y', 'y', 'y', 'n', 'y')).toBe('moderate');
  });

  test('2.2 か 2.3 の少なくとも一方が n/pn（懸念なし）は low', () => {
    expect(judgeRobinsIDomain2Selection('y', 'n', 'y', 'y', null)).toBe('low');
    expect(judgeRobinsIDomain2Selection('y', 'y', 'n', 'y', null)).toBe('low');
  });

  test('2.2・2.3 とも ni（判定不能）は null', () => {
    expect(judgeRobinsIDomain2Selection('y', 'ni', 'ni', 'y', null)).toBeNull();
  });

  test('2.1 が ni/na は null', () => {
    expect(judgeRobinsIDomain2Selection('ni', null, null, 'y', null)).toBeNull();
    expect(judgeRobinsIDomain2Selection('na', null, null, 'y', null)).toBeNull();
  });

  test('2.4 が ni/na は null', () => {
    expect(judgeRobinsIDomain2Selection('n', null, null, 'ni', null)).toBeNull();
    expect(judgeRobinsIDomain2Selection('n', null, null, 'na', null)).toBeNull();
  });

  test('いずれかの懸念があり・2.5 が未回答なら null', () => {
    expect(judgeRobinsIDomain2Selection('n', null, null, 'n', null)).toBeNull();
  });

  test('いずれかの懸念があり・2.5 = y/py（補正あり）は moderate', () => {
    expect(judgeRobinsIDomain2Selection('n', null, null, 'n', 'y')).toBe('moderate');
    expect(judgeRobinsIDomain2Selection('n', null, null, 'n', 'py')).toBe('moderate');
  });

  test('いずれかの懸念があり・2.5 = n/pn/ni（補正なし）は Serious/Critical の程度判断を要するため null', () => {
    expect(judgeRobinsIDomain2Selection('n', null, null, 'n', 'n')).toBeNull();
    expect(judgeRobinsIDomain2Selection('n', null, null, 'n', 'pn')).toBeNull();
    expect(judgeRobinsIDomain2Selection('n', null, null, 'n', 'ni')).toBeNull();
  });
});

describe('judgeRobinsIDomain3Classification（SQ 3.1〜3.3）', () => {
  test('3.1 が未回答なら null', () => {
    expect(judgeRobinsIDomain3Classification(null, null, null)).toBeNull();
  });

  test('3.1 = n/pn（定義不明瞭）は serious', () => {
    expect(judgeRobinsIDomain3Classification('n', null, null)).toBe('serious');
    expect(judgeRobinsIDomain3Classification('pn', null, null)).toBe('serious');
  });

  test('3.1 が ni/na は null', () => {
    expect(judgeRobinsIDomain3Classification('ni', null, null)).toBeNull();
    expect(judgeRobinsIDomain3Classification('na', null, null)).toBeNull();
  });

  test('3.1 = y・3.2 が未回答なら null', () => {
    expect(judgeRobinsIDomain3Classification('y', null, null)).toBeNull();
  });

  test('3.1 = y・3.2 = y/py（介入時点で収集された情報のみ）は low', () => {
    expect(judgeRobinsIDomain3Classification('y', 'y', null)).toBe('low');
    expect(judgeRobinsIDomain3Classification('py', 'py', null)).toBe('low');
  });

  test('3.1 = y・3.2 が ni/na は null', () => {
    expect(judgeRobinsIDomain3Classification('y', 'ni', null)).toBeNull();
    expect(judgeRobinsIDomain3Classification('y', 'na', null)).toBeNull();
  });

  test('3.1 = y・3.2 = n/pn・3.3 が未回答なら null', () => {
    expect(judgeRobinsIDomain3Classification('y', 'n', null)).toBeNull();
  });

  test('3.1 = y・3.2 = n/pn・3.3 = n/pn（結果の知識に影響されていない）は moderate', () => {
    expect(judgeRobinsIDomain3Classification('y', 'n', 'n')).toBe('moderate');
    expect(judgeRobinsIDomain3Classification('y', 'pn', 'pn')).toBe('moderate');
  });

  test('3.1 = y・3.2 = n/pn・3.3 = y/py（結果の知識に影響された可能性）は serious', () => {
    expect(judgeRobinsIDomain3Classification('y', 'n', 'y')).toBe('serious');
    expect(judgeRobinsIDomain3Classification('y', 'n', 'py')).toBe('serious');
  });

  test('3.1 = y・3.2 = n/pn・3.3 が ni/na は null', () => {
    expect(judgeRobinsIDomain3Classification('y', 'n', 'ni')).toBeNull();
    expect(judgeRobinsIDomain3Classification('y', 'n', 'na')).toBeNull();
  });
});

describe('judgeRobinsIDomain4Deviations（SQ 4.1〜4.6）', () => {
  // assignment path（4.1〜4.2）だけを見るため adhering path（4.3〜4.6）は na で無効化する
  test('4.1 が未回答なら null（両経路とも無回答）', () => {
    expect(judgeRobinsIDomain4Deviations(null, null, 'na', 'na', 'na', null)).toBeNull();
  });

  test('4.1 = n/pn（通常診療の範囲内の逸脱のみ）は low', () => {
    expect(judgeRobinsIDomain4Deviations('n', null, 'na', 'na', 'na', null)).toBe('low');
    expect(judgeRobinsIDomain4Deviations('pn', null, 'na', 'na', 'na', null)).toBe('low');
  });

  test('4.1 が ni/na は null（想定外）', () => {
    expect(judgeRobinsIDomain4Deviations('ni', null, 'na', 'na', 'na', null)).toBeNull();
    expect(judgeRobinsIDomain4Deviations('na', null, 'na', 'na', 'na', null)).toBeNull();
  });

  test('4.1 = y・4.2 が未回答なら null', () => {
    expect(judgeRobinsIDomain4Deviations('y', null, 'na', 'na', 'na', null)).toBeNull();
  });

  test('4.1 = y・4.2 = y/py（不均衡かつ結果に影響）は serious', () => {
    expect(judgeRobinsIDomain4Deviations('y', 'y', 'na', 'na', 'na', null)).toBe('serious');
    expect(judgeRobinsIDomain4Deviations('y', 'py', 'na', 'na', 'na', null)).toBe('serious');
  });

  test('4.1 = y・4.2 = n/pn（複合条件が不成立）は low', () => {
    expect(judgeRobinsIDomain4Deviations('y', 'n', 'na', 'na', 'na', null)).toBe('low');
    expect(judgeRobinsIDomain4Deviations('y', 'pn', 'na', 'na', 'na', null)).toBe('low');
  });

  test('4.1 = y・4.2 が ni/na は null', () => {
    expect(judgeRobinsIDomain4Deviations('y', 'ni', 'na', 'na', 'na', null)).toBeNull();
    expect(judgeRobinsIDomain4Deviations('y', 'na', 'na', 'na', 'na', null)).toBeNull();
  });

  // adhering path（4.3〜4.6）だけを見るため assignment path（4.1〜4.2）は na で無効化する
  test('4.3〜4.5 のいずれかが未回答なら null（両経路とも無回答）', () => {
    expect(judgeRobinsIDomain4Deviations('na', null, null, 'y', 'y', null)).toBeNull();
    expect(judgeRobinsIDomain4Deviations('na', null, 'y', null, 'y', null)).toBeNull();
    expect(judgeRobinsIDomain4Deviations('na', null, 'y', 'y', null, null)).toBeNull();
  });

  test('4.3〜4.5 が全て y/py（併用療法均衡・実施と遵守に問題なし）は low', () => {
    expect(judgeRobinsIDomain4Deviations('na', null, 'y', 'y', 'y', null)).toBe('low');
    expect(judgeRobinsIDomain4Deviations('na', null, 'py', 'py', 'py', null)).toBe('low');
  });

  test('4.3〜4.5 に明確な n/pn が無く ni が混在（程度判断が必要）は null', () => {
    expect(judgeRobinsIDomain4Deviations('na', null, 'y', 'ni', 'y', null)).toBeNull();
  });

  test('4.3〜4.5 のいずれかが n/pn・4.6 が未回答なら null', () => {
    expect(judgeRobinsIDomain4Deviations('na', null, 'n', 'y', 'y', null)).toBeNull();
    expect(judgeRobinsIDomain4Deviations('na', null, 'y', 'n', 'y', null)).toBeNull();
    expect(judgeRobinsIDomain4Deviations('na', null, 'y', 'y', 'n', null)).toBeNull();
  });

  test('4.3〜4.5 のいずれかが n/pn・4.6 = y/py（適切な解析で補正）は moderate', () => {
    expect(judgeRobinsIDomain4Deviations('na', null, 'n', 'y', 'y', 'y')).toBe('moderate');
  });

  test('4.3〜4.5 のいずれかが n/pn・4.6 = n/pn（補正なし）は serious', () => {
    expect(judgeRobinsIDomain4Deviations('na', null, 'n', 'y', 'y', 'n')).toBe('serious');
  });

  test('4.3〜4.5 のいずれかが n/pn・4.6 が ni/na は null', () => {
    expect(judgeRobinsIDomain4Deviations('na', null, 'n', 'y', 'y', 'ni')).toBeNull();
    expect(judgeRobinsIDomain4Deviations('na', null, 'n', 'y', 'y', 'na')).toBeNull();
  });

  test('両経路とも実回答がある場合は悪い方（serious > moderate > low）を安全側に採用する', () => {
    // assignment = serious（4.1=y,4.2=y）、adhering = low（4.3〜4.5=y）→ 全体 serious
    expect(judgeRobinsIDomain4Deviations('y', 'y', 'y', 'y', 'y', null)).toBe('serious');
    // assignment = low（4.1=n）、adhering = serious（4.3=n,4.6=n）→ 全体 serious
    expect(judgeRobinsIDomain4Deviations('n', null, 'n', 'y', 'y', 'n')).toBe('serious');
    // 両方 low → low
    expect(judgeRobinsIDomain4Deviations('n', null, 'y', 'y', 'y', null)).toBe('low');
  });
});

describe('judgeRobinsIDomain5Missing（SQ 5.1〜5.5）', () => {
  test.each([
    ['5.1 が未回答', null, 'y', 'n'] as const,
    ['5.2 が未回答', 'y', null, 'n'] as const,
    ['5.3 が未回答', 'y', 'n', null] as const,
  ])('%s なら null（回答不足）', (_label, q1, q2, q3) => {
    expect(judgeRobinsIDomain5Missing(q1, q2, q3, null, null)).toBeNull();
  });

  test('5.1 = n（ほぼ全例でデータなし・トリガー成立）+ 5.4/5.5 が未回答なら null', () => {
    expect(judgeRobinsIDomain5Missing('n', 'n', 'n', null, null)).toBeNull();
  });

  test('5.2 = y（介入状況の欠測で除外・トリガー成立）+ 5.4 = y は low', () => {
    expect(judgeRobinsIDomain5Missing('y', 'y', 'n', 'y', 'n')).toBe('low');
  });

  test('5.3 = y（他変数の欠測で除外・トリガー成立）+ 5.5 = y は low', () => {
    expect(judgeRobinsIDomain5Missing('y', 'n', 'y', 'n', 'y')).toBe('low');
  });

  test('5.1 = y・5.2/5.3 とも n（トリガー不成立）は low', () => {
    expect(judgeRobinsIDomain5Missing('y', 'n', 'n', null, null)).toBe('low');
  });

  test('トリガー成立とも不成立とも確定できない（ni 混在）は null', () => {
    expect(judgeRobinsIDomain5Missing('ni', 'n', 'n', null, null)).toBeNull();
    expect(judgeRobinsIDomain5Missing('y', 'ni', 'n', null, null)).toBeNull();
  });

  test('トリガー成立・5.4 か 5.5 が未回答なら null', () => {
    expect(judgeRobinsIDomain5Missing('n', 'n', 'n', null, 'y')).toBeNull();
    expect(judgeRobinsIDomain5Missing('n', 'n', 'n', 'y', null)).toBeNull();
  });

  test('トリガー成立・5.4 = y（群間で同程度）は low', () => {
    expect(judgeRobinsIDomain5Missing('n', 'n', 'n', 'y', 'n')).toBe('low');
  });

  test('トリガー成立・5.5 = y（解析で頑健性を確認）は low', () => {
    expect(judgeRobinsIDomain5Missing('n', 'n', 'n', 'n', 'y')).toBe('low');
  });

  test('トリガー成立・5.4/5.5 とも n/pn/ni は Moderate/Serious/Critical の程度判断を要するため null', () => {
    expect(judgeRobinsIDomain5Missing('n', 'n', 'n', 'n', 'n')).toBeNull();
    expect(judgeRobinsIDomain5Missing('n', 'n', 'n', 'pn', 'pn')).toBeNull();
    expect(judgeRobinsIDomain5Missing('n', 'n', 'n', 'ni', 'ni')).toBeNull();
  });
});

describe('judgeRobinsIDomain6Measurement（SQ 6.1〜6.4）', () => {
  test.each([
    ['6.1 が未回答', null, 'n', 'y', 'n'] as const,
    ['6.2 が未回答', 'n', null, 'y', 'n'] as const,
    ['6.3 が未回答', 'n', 'n', null, 'n'] as const,
    ['6.4 が未回答', 'n', 'n', 'y', null] as const,
  ])('%s なら null（回答不足）', (_label, q1, q2, q3, q4) => {
    expect(judgeRobinsIDomain6Measurement(q1, q2, q3, q4)).toBeNull();
  });

  test('6.3 = n/pn（評価方法が群間で比較不能）は serious', () => {
    expect(judgeRobinsIDomain6Measurement('n', 'n', 'n', 'n')).toBe('serious');
    expect(judgeRobinsIDomain6Measurement('n', 'n', 'pn', 'n')).toBe('serious');
  });

  test('6.3 が ni（判定不能）は null', () => {
    expect(judgeRobinsIDomain6Measurement('n', 'n', 'ni', 'n')).toBeNull();
  });

  test('6.3 = y・6.4 = y/py（測定誤差が介入状況と関連）は serious', () => {
    expect(judgeRobinsIDomain6Measurement('n', 'n', 'y', 'y')).toBe('serious');
    expect(judgeRobinsIDomain6Measurement('n', 'n', 'y', 'py')).toBe('serious');
  });

  test('6.3 = y・6.4 が ni（判定不能）は null', () => {
    expect(judgeRobinsIDomain6Measurement('n', 'n', 'y', 'ni')).toBeNull();
  });

  test('6.3 = y・6.4 = n/pn・6.1 と 6.2 が両方 y/py（主観的指標かつ評価者が非盲検）は serious', () => {
    expect(judgeRobinsIDomain6Measurement('y', 'y', 'y', 'n')).toBe('serious');
  });

  test('6.1 か 6.2 が ni（判定不能）は null', () => {
    expect(judgeRobinsIDomain6Measurement('ni', 'y', 'y', 'n')).toBeNull();
    expect(judgeRobinsIDomain6Measurement('y', 'ni', 'y', 'n')).toBeNull();
  });

  test('6.3 = y・6.4 = n/pn・6.1 か 6.2 の少なくとも一方が n/pn は low', () => {
    expect(judgeRobinsIDomain6Measurement('n', 'y', 'y', 'n')).toBe('low');
    expect(judgeRobinsIDomain6Measurement('y', 'n', 'y', 'n')).toBe('low');
    expect(judgeRobinsIDomain6Measurement('n', 'n', 'y', 'n')).toBe('low');
  });
});

describe('judgeRobinsIDomain7Reporting（SQ 7.1〜7.3）', () => {
  test.each([
    ['7.1 が未回答', null, 'n', 'n'] as const,
    ['7.2 が未回答', 'n', null, 'n'] as const,
    ['7.3 が未回答', 'n', 'n', null] as const,
  ])('%s なら null（回答不足）', (_label, q1, q2, q3) => {
    expect(judgeRobinsIDomain7Reporting(q1, q2, q3)).toBeNull();
  });

  test('7.1 = y/py（複数測定から選択の疑い）は serious', () => {
    expect(judgeRobinsIDomain7Reporting('y', 'n', 'n')).toBe('serious');
    expect(judgeRobinsIDomain7Reporting('py', 'n', 'n')).toBe('serious');
  });

  test('7.2 = y/py（複数解析から選択の疑い）は serious', () => {
    expect(judgeRobinsIDomain7Reporting('n', 'y', 'n')).toBe('serious');
  });

  test('7.3 = y/py（部分集団から選択の疑い）は serious', () => {
    expect(judgeRobinsIDomain7Reporting('n', 'n', 'y')).toBe('serious');
  });

  test('いずれかが ni（判定不能）は null', () => {
    expect(judgeRobinsIDomain7Reporting('ni', 'n', 'n')).toBeNull();
    expect(judgeRobinsIDomain7Reporting('n', 'ni', 'n')).toBeNull();
    expect(judgeRobinsIDomain7Reporting('n', 'n', 'ni')).toBeNull();
  });

  test('全問 n/pn（選択的報告の証拠なし）は moderate（Low は事前登録プロトコルの追加情報を要するため提案しない）', () => {
    expect(judgeRobinsIDomain7Reporting('n', 'n', 'n')).toBe('moderate');
    expect(judgeRobinsIDomain7Reporting('pn', 'pn', 'pn')).toBe('moderate');
  });
});

describe('judgeOverallRobinsI（Table 2）', () => {
  test('空配列は null', () => {
    expect(judgeOverallRobinsI([])).toBeNull();
  });

  test('いずれかのドメインが null（未解決）なら null', () => {
    expect(judgeOverallRobinsI(['low', null, 'moderate'])).toBeNull();
  });

  test('全ドメイン low なら low', () => {
    expect(judgeOverallRobinsI(['low', 'low', 'low'])).toBe('low');
  });

  test('serious/critical/no_information を含まず moderate を含むなら moderate', () => {
    expect(judgeOverallRobinsI(['low', 'moderate', 'low'])).toBe('moderate');
  });

  test('serious を含み critical を含まないなら serious', () => {
    expect(judgeOverallRobinsI(['low', 'serious', 'moderate'])).toBe('serious');
  });

  test('critical を含むなら critical（serious があっても優先）', () => {
    expect(judgeOverallRobinsI(['serious', 'critical', 'low'])).toBe('critical');
  });

  test('serious/critical は無いが no_information を含むなら no_information', () => {
    expect(judgeOverallRobinsI(['low', 'no_information', 'moderate'])).toBe('no_information');
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

  test('overall が robins_i_judgement のときも judgeOverallRobinsI で算出するが、各ドメインの現在値が 1 つも無いため提案なし', () => {
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

  test('SQ セルが 1 つも無い robins_i_judgement は判定関数が全項目 null を受け取り suggestion は常に null（aiUnconfirmed だけ有効）', () => {
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

  describe('ROBINS-I 拡張（issue #61 PR2 = issue #87）', () => {
    /** ドメイン id の全 SQ に同じ値を割り当てたグループ + judgement セルを組み立てる */
    function makeRobinsIDomainGroup(
      domainId: string,
      sqValues: readonly (string | null)[],
      judgementAi: string | null = null,
    ): CellGroup {
      const entityKey = `rob:${domainId}`;
      const fieldNames = ROBINS_I_SQ_FIELD_NAMES[domainId] ?? [];
      const cells = fieldNames.map((fieldName, index) => makeSqCell(fieldName, entityKey, sqValues[index] ?? null));
      cells.push(makeSqCell('robins_i_judgement', entityKey, judgementAi));
      return group(cells);
    }

    test('D1（confounding・SQ 8 問）: 1.1 = n の組み合わせで low を提案する', () => {
      const domainGroup = makeRobinsIDomainGroup(
        'd1_confounding',
        ['n', 'na', 'na', 'na', 'na', 'na', 'na', 'na'],
        'low',
      );
      const model: TabModel = { groups: [domainGroup], cells: [] };
      const info = collectRobAlgorithmInfo(model).get(cellKeyOf('f-robins_i_judgement', 'rob:d1_confounding'));
      expect(info?.suggestion).toBe('low');
    });

    test('D2（selection・SQ 5 問）: 2.1 = n・2.4 = y の組み合わせで low を提案する', () => {
      const domainGroup = makeRobinsIDomainGroup('d2_selection', ['n', 'na', 'na', 'y', 'na'], 'low');
      const model: TabModel = { groups: [domainGroup], cells: [] };
      const info = collectRobAlgorithmInfo(model).get(cellKeyOf('f-robins_i_judgement', 'rob:d2_selection'));
      expect(info?.suggestion).toBe('low');
    });

    test('D3（classification・SQ 3 問）: 3.1 = n の組み合わせで serious を提案する', () => {
      const domainGroup = makeRobinsIDomainGroup('d3_classification', ['n', 'na', 'na'], 'serious');
      const model: TabModel = { groups: [domainGroup], cells: [] };
      const info = collectRobAlgorithmInfo(model).get(cellKeyOf('f-robins_i_judgement', 'rob:d3_classification'));
      expect(info?.suggestion).toBe('serious');
    });

    test('D4（deviations・SQ 6 問）: 4.1 = n の組み合わせで low を提案する', () => {
      const domainGroup = makeRobinsIDomainGroup('d4_deviations', ['n', 'na', 'na', 'na', 'na', 'na'], 'low');
      const model: TabModel = { groups: [domainGroup], cells: [] };
      const info = collectRobAlgorithmInfo(model).get(cellKeyOf('f-robins_i_judgement', 'rob:d4_deviations'));
      expect(info?.suggestion).toBe('low');
    });

    test('D5（missing_data・SQ 5 問）: 5.1 = y・5.2/5.3 = n の組み合わせで low を提案する', () => {
      const domainGroup = makeRobinsIDomainGroup('d5_missing_data', ['y', 'n', 'n', null, null], 'low');
      const model: TabModel = { groups: [domainGroup], cells: [] };
      const info = collectRobAlgorithmInfo(model).get(cellKeyOf('f-robins_i_judgement', 'rob:d5_missing_data'));
      expect(info?.suggestion).toBe('low');
    });

    test('D6（measurement・SQ 4 問）: 6.3 = n の組み合わせで serious を提案する', () => {
      const domainGroup = makeRobinsIDomainGroup('d6_measurement', ['na', 'na', 'n', 'na'], 'serious');
      const model: TabModel = { groups: [domainGroup], cells: [] };
      const info = collectRobAlgorithmInfo(model).get(cellKeyOf('f-robins_i_judgement', 'rob:d6_measurement'));
      expect(info?.suggestion).toBe('serious');
    });

    test('D7（reporting・SQ 3 問）: 7.1 = y の組み合わせで serious を提案する', () => {
      const domainGroup = makeRobinsIDomainGroup('d7_reporting', ['y', 'na', 'na'], 'serious');
      const model: TabModel = { groups: [domainGroup], cells: [] };
      const info = collectRobAlgorithmInfo(model).get(cellKeyOf('f-robins_i_judgement', 'rob:d7_reporting'));
      expect(info?.suggestion).toBe('serious');
    });

    test('提案と現在値が食い違えば mismatch = true（D3: 3.1 = n → serious の提案に対し現在値 low）', () => {
      const entityKey = 'rob:d3_classification';
      const cells = [
        makeSqCell('robins_i_sq3_1', entityKey, 'n'),
        makeSqCell('robins_i_judgement', entityKey, 'low'),
      ];
      const model: TabModel = { groups: [group(cells)], cells: [] };
      const info = collectRobAlgorithmInfo(model).get(cellKeyOf('f-robins_i_judgement', entityKey));
      expect(info?.suggestion).toBe('serious');
      expect(info?.currentValue).toBe('low');
      expect(info?.mismatch).toBe(true);
    });

    test('overall は ROBINS-I の 7 ドメインの現在判定値から提案を算出する（全ドメイン揃えば low）', () => {
      const domainIds = ROBINS_I_DOMAINS.filter((domain) => domain.id !== 'overall').map((domain) => domain.id);
      const entityKey = 'rob:overall';
      const groups: CellGroup[] = domainIds.map((id) =>
        group([
          makeSqCell('robins_i_judgement', `rob:${id}`, 'low', { stateValue: 'low', status: 'accept' }),
        ]),
      );
      groups.push(group([makeSqCell('robins_i_judgement', entityKey, 'low')]));
      const model: TabModel = { groups, cells: [] };
      const info = collectRobAlgorithmInfo(model).get(cellKeyOf('f-robins_i_judgement', entityKey));
      expect(info?.suggestion).toBe('low');
    });

    test('overall はいずれか 1 ドメインでも欠けていれば提案なし', () => {
      const domainIds = ROBINS_I_DOMAINS.filter((domain) => domain.id !== 'overall').map((domain) => domain.id);
      const entityKey = 'rob:overall';
      const groups: CellGroup[] = domainIds
        .slice(0, -1) // 最後の 1 ドメインを未挿入にする
        .map((id) =>
          group([makeSqCell('robins_i_judgement', `rob:${id}`, 'low', { stateValue: 'low', status: 'accept' })]),
        );
      groups.push(group([makeSqCell('robins_i_judgement', entityKey, 'low')]));
      const model: TabModel = { groups, cells: [] };
      const info = collectRobAlgorithmInfo(model).get(cellKeyOf('f-robins_i_judgement', entityKey));
      expect(info?.suggestion).toBeNull();
    });

    test('RoB 2 と ROBINS-I が同一スキーマに混在しても、それぞれ独立に提案を算出する（ドメイン id の名前空間が重ならないため）', () => {
      const rob2Group = makeD1Group({ sqValues: ['y', 'y', 'n'], judgementAi: 'low' }); // rob2 d1_randomization
      const robinsIGroup = makeRobinsIDomainGroup('d1_confounding', ['n', 'na', 'na', 'na', 'na', 'na', 'na', 'na']);
      const model: TabModel = { groups: [rob2Group, robinsIGroup], cells: [] };
      const result = collectRobAlgorithmInfo(model);
      expect(result.get(cellKeyOf('f-rob2_judgement', 'rob:d1_randomization'))?.suggestion).toBe('low');
      expect(result.get(cellKeyOf('f-robins_i_judgement', 'rob:d1_confounding'))?.suggestion).toBe('low');
    });

    test('DOMAIN_ALGORITHMS に無いドメイン id（カスタムツール想定）は algorithm が未定義のため suggestion は null', () => {
      const entityKey = 'rob:custom_tool_d1';
      const cells = [
        makeSqCell('robins_i_judgement', entityKey, 'moderate'),
      ];
      const model: TabModel = { groups: [group(cells)], cells: [] };
      const info = collectRobAlgorithmInfo(model).get(cellKeyOf('f-robins_i_judgement', entityKey));
      expect(info?.suggestion).toBeNull();
    });

    test('rob2_judgement / robins_i_judgement のいずれでもない judgement フィールド（カスタムツール想定）は提案を計算せず domainCurrentValues にも積まれない', () => {
      // D1（confounding）の SQ 一式を揃えて algorithm 自体は suggestion=='low' を計算できる状況でも、
      // 判定フィールドが custom_tool_judgement だと isPrimaryJudgement=false のため suggestion は使われない
      const entityKey = 'rob:d1_confounding';
      const fieldNames = ROBINS_I_SQ_FIELD_NAMES['d1_confounding'] ?? [];
      const sqCells = fieldNames.map((fieldName, index) =>
        makeSqCell(fieldName, entityKey, ['n', 'na', 'na', 'na', 'na', 'na', 'na', 'na'][index] ?? null),
      );
      const cells = [...sqCells, makeSqCell('custom_tool_judgement', entityKey, 'moderate')];
      const model: TabModel = { groups: [group(cells)], cells: [] };
      const info = collectRobAlgorithmInfo(model).get(cellKeyOf('f-custom_tool_judgement', entityKey));
      expect(info?.suggestion).toBeNull();
      expect(info?.currentValue).toBe('moderate');
    });

    test('overall の judgement フィールドが rob2_judgement / robins_i_judgement のいずれでもない場合も suggestion は null', () => {
      const entityKey = 'rob:overall';
      const cells = [makeSqCell('custom_tool_judgement', entityKey, 'moderate')];
      const model: TabModel = { groups: [group(cells)], cells: [] };
      const info = collectRobAlgorithmInfo(model).get(cellKeyOf('f-custom_tool_judgement', entityKey));
      expect(info?.suggestion).toBeNull();
    });
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
