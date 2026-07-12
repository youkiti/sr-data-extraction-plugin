import { NOT_REPORTED_TOKEN } from '../../../../src/domain/annotation';
import type { Evidence } from '../../../../src/domain/evidence';
import type { FieldDataType, SchemaField } from '../../../../src/domain/schemaField';
import {
  checkGroupConsistency,
  collectConsistencyWarnings,
  type ConsistencyWarning,
} from '../../../../src/features/verification/consistencyChecks';
import type { CellGroup, TabModel, VerificationCell } from '../../../../src/features/verification/cells';
import { cellKeyOf, emptyCellState, type CellState } from '../../../../src/features/verification/cellState';

const ENTITY_KEY = 'outcome:pain|arm:1';

function makeField(fieldName: string, dataType: FieldDataType): SchemaField {
  return {
    schemaVersion: 1,
    fieldId: `f-${fieldName}`,
    fieldIndex: 1,
    section: 'outcomes',
    fieldName,
    fieldLabel: fieldName,
    entityLevel: 'outcome_result',
    dataType,
    unit: null,
    allowedValues: null,
    required: false,
    extractionInstruction: '',
    example: null,
    aiGenerated: false,
    note: null,
  };
}

function makeEvidence(fieldId: string, value: string): Evidence {
  return {
    evidenceId: `ev-${fieldId}`,
    runId: 'run-1',
    studyId: 'study-1',
    documentId: 'doc-1',
    fieldId,
    entityKey: ENTITY_KEY,
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

/**
 * 手組みの VerificationCell。aiValue は Evidence.value（null は「AI 抽出なし」）、
 * stateValue を渡すと判定確定値（cell.state.value）を AI 値より優先させる。
 * entityKey は別グループ（別 outcome インスタンス）を作るときだけ明示する
 * （cellKeyOf は fieldId × entityKey で決まるため、同一 entityKey の使い回しは cellKey 衝突を招く）
 */
function makeCell(
  fieldName: string,
  dataType: FieldDataType,
  aiValue: string | null,
  stateValue?: string | null,
  entityKey: string = ENTITY_KEY,
): VerificationCell {
  const field = makeField(fieldName, dataType);
  const evidence = aiValue === null ? null : { ...makeEvidence(field.fieldId, aiValue), entityKey };
  const state: CellState =
    stateValue === undefined ? emptyCellState() : { status: 'edit', value: stateValue, stack: [] };
  return { cellKey: cellKeyOf(field.fieldId, entityKey), field, entityKey, evidence, state };
}

function group(cells: VerificationCell[]): CellGroup {
  return { heading: 'pain', cells };
}

/** cellKey の昇順でソートした警告（順不同の比較を簡単にする） */
function sortedByCellKey(warnings: ConsistencyWarning[]): ConsistencyWarning[] {
  return [...warnings].sort((a, b) => a.cellKey.localeCompare(b.cellKey));
}

describe('checkGroupConsistency', () => {
  describe('値の解決（優先順・スキップ条件）', () => {
    test('判定確定値（state.value）が AI 抽出値より優先して評価される', () => {
      // AI 値は 5（矛盾しない）だが、人間が 20 に修正しているので 20 で評価する
      const events = makeCell('outcome_events', 'integer', '5', '20');
      const total = makeCell('outcome_total', 'integer', '12');
      const warnings = checkGroupConsistency(group([events, total]));
      expect(warnings).toHaveLength(2);
      expect(warnings.every((w) => w.message.includes('20'))).toBe(true);
    });

    test('AI 値・判定ともに値なし（null）のセルはスキップする', () => {
      const events = makeCell('outcome_events', 'integer', null);
      const total = makeCell('outcome_total', 'integer', '12');
      expect(checkGroupConsistency(group([events, total]))).toEqual([]);
    });

    test('NOT_REPORTED（NR）は値なしとして扱いスキップする', () => {
      const events = makeCell('outcome_events', 'integer', NOT_REPORTED_TOKEN);
      const total = makeCell('outcome_total', 'integer', '12');
      expect(checkGroupConsistency(group([events, total]))).toEqual([]);
    });

    test('数値としてパースできない文字列（テキスト・範囲表記）はスキップする', () => {
      const events = makeCell('outcome_events', 'integer', 'about 12');
      const total = makeCell('outcome_total', 'integer', '5');
      expect(checkGroupConsistency(group([events, total]))).toEqual([]);
    });

    test('指数表記もパース対象外としてスキップする', () => {
      const events = makeCell('outcome_events', 'integer', '1e2');
      const total = makeCell('outcome_total', 'integer', '5');
      expect(checkGroupConsistency(group([events, total]))).toEqual([]);
    });

    test('フィールド自体が group に無ければスキップする', () => {
      const total = makeCell('outcome_total', 'integer', '5');
      expect(checkGroupConsistency(group([total]))).toEqual([]);
    });
  });

  describe('B1: outcome_events ≤ outcome_total', () => {
    test('違反: events > total', () => {
      const events = makeCell('outcome_events', 'integer', '13');
      const total = makeCell('outcome_total', 'integer', '12');
      const warnings = checkGroupConsistency(group([events, total]));
      expect(warnings).toHaveLength(2);
      expect(warnings.map((w) => w.cellKey).sort()).toEqual([events.cellKey, total.cellKey].sort());
      expect(warnings.every((w) => w.message.includes('を超えています'))).toBe(true);
      // 両セルに同一メッセージが付く（1 つの違反 = 関与した全セルへ同じメッセージ）
      expect(warnings[0]?.message).toBe(warnings[1]?.message);
    });

    test('適合: events ≤ total', () => {
      const events = makeCell('outcome_events', 'integer', '10');
      const total = makeCell('outcome_total', 'integer', '12');
      expect(checkGroupConsistency(group([events, total]))).toEqual([]);
    });

    test('境界: events === total は違反ではない', () => {
      const events = makeCell('outcome_events', 'integer', '12');
      const total = makeCell('outcome_total', 'integer', '12');
      expect(checkGroupConsistency(group([events, total]))).toEqual([]);
    });

    test('整数フィールドは丸めなしの正確値で比較する（events=13 > total=12 は必ず違反）', () => {
      // dataType が float なら区間の重なりで許容されうる差でも、integer は区間幅 0 のため必ず検出する
      const events = makeCell('outcome_events', 'integer', '13');
      const total = makeCell('outcome_total', 'integer', '12');
      expect(checkGroupConsistency(group([events, total]))).toHaveLength(2);
    });
  });

  describe('B2: outcome_events ≥ 0、outcome_total ≥ 0', () => {
    test('events が負なら警告する', () => {
      const events = makeCell('outcome_events', 'integer', '-3');
      const warnings = checkGroupConsistency(group([events]));
      expect(warnings).toEqual([{ cellKey: events.cellKey, message: expect.stringContaining('負の値') }]);
    });

    test('total が負なら警告する', () => {
      const total = makeCell('outcome_total', 'integer', '-1');
      const warnings = checkGroupConsistency(group([total]));
      expect(warnings).toEqual([{ cellKey: total.cellKey, message: expect.stringContaining('負の値') }]);
    });

    test('0 以上は適合', () => {
      const events = makeCell('outcome_events', 'integer', '0');
      const total = makeCell('outcome_total', 'integer', '0');
      expect(checkGroupConsistency(group([events, total]))).toEqual([]);
    });
  });

  describe('C1: outcome_sd ≥ 0、outcome_se ≥ 0、outcome_n ≥ 0', () => {
    test('sd が負なら警告する', () => {
      const sd = makeCell('outcome_sd', 'float', '-1.2');
      expect(checkGroupConsistency(group([sd]))).toEqual([
        { cellKey: sd.cellKey, message: expect.stringContaining('負の値') },
      ]);
    });

    test('se が負なら警告する', () => {
      const se = makeCell('outcome_se', 'float', '-0.5');
      expect(checkGroupConsistency(group([se]))).toEqual([
        { cellKey: se.cellKey, message: expect.stringContaining('負の値') },
      ]);
    });

    test('n が負なら警告する', () => {
      const n = makeCell('outcome_n', 'integer', '-5');
      expect(checkGroupConsistency(group([n]))).toEqual([
        { cellKey: n.cellKey, message: expect.stringContaining('負の値') },
      ]);
    });

    test('sd/se/n が非負なら適合', () => {
      const sd = makeCell('outcome_sd', 'float', '1.1');
      const se = makeCell('outcome_se', 'float', '0.3');
      const n = makeCell('outcome_n', 'integer', '20');
      expect(checkGroupConsistency(group([sd, se, n]))).toEqual([]);
    });
  });

  describe('C2: outcome_se < outcome_sd（n が存在して n ≥ 2 のときのみ）', () => {
    test('丸め境界: sd="1.0"（区間 [0.95,1.05]）と se="1.05"（区間 [1.045,1.055]）は矛盾しない', () => {
      // lo(se)=1.045 ≤ hi(sd)=1.05 なので警告しない（丸めで説明できる見かけの矛盾）
      const sd = makeCell('outcome_sd', 'float', '1.0');
      const se = makeCell('outcome_se', 'float', '1.05');
      const n = makeCell('outcome_n', 'integer', '4');
      expect(checkGroupConsistency(group([sd, se, n]))).toEqual([]);
    });

    test('se="1.2" は区間が重ならず矛盾する', () => {
      const sd = makeCell('outcome_sd', 'float', '1.0');
      const se = makeCell('outcome_se', 'float', '1.2');
      const n = makeCell('outcome_n', 'integer', '4');
      const warnings = sortedByCellKey(checkGroupConsistency(group([sd, se, n])));
      expect(warnings.map((w) => w.cellKey)).toEqual([se.cellKey, sd.cellKey].sort());
      expect(warnings[0]?.message).toContain('標準誤差');
    });

    test('n が存在しない場合は適用しない', () => {
      const sd = makeCell('outcome_sd', 'float', '1.0');
      const se = makeCell('outcome_se', 'float', '5.0');
      expect(checkGroupConsistency(group([sd, se]))).toEqual([]);
    });

    test('n < 2 の場合は適用しない（n=1 では SE = SD の定義上そもそも比較対象外）', () => {
      const sd = makeCell('outcome_sd', 'float', '1.0');
      const se = makeCell('outcome_se', 'float', '5.0');
      const n = makeCell('outcome_n', 'integer', '1');
      expect(checkGroupConsistency(group([sd, se, n]))).toEqual([]);
    });
  });

  describe('C3: outcome_ci_lower ≤ outcome_ci_upper', () => {
    test('違反: 下限 > 上限', () => {
      const lower = makeCell('outcome_ci_lower', 'float', '5.7');
      const upper = makeCell('outcome_ci_upper', 'float', '4.7');
      expect(checkGroupConsistency(group([lower, upper]))).toHaveLength(2);
    });

    test('適合: 下限 ≤ 上限', () => {
      const lower = makeCell('outcome_ci_lower', 'float', '4.7');
      const upper = makeCell('outcome_ci_upper', 'float', '5.7');
      expect(checkGroupConsistency(group([lower, upper]))).toEqual([]);
    });
  });

  describe('C4: outcome_ci_lower ≤ outcome_mean ≤ outcome_ci_upper（3 値そろったとき）', () => {
    test('違反: mean が下限を下回る', () => {
      const lower = makeCell('outcome_ci_lower', 'float', '4.7');
      const mean = makeCell('outcome_mean', 'float', '4.0');
      const upper = makeCell('outcome_ci_upper', 'float', '5.7');
      const warnings = checkGroupConsistency(group([lower, mean, upper]));
      expect(warnings.map((w) => w.cellKey).sort()).toEqual([lower.cellKey, mean.cellKey].sort());
    });

    test('違反: mean が上限を上回る', () => {
      const lower = makeCell('outcome_ci_lower', 'float', '4.7');
      const mean = makeCell('outcome_mean', 'float', '6.0');
      const upper = makeCell('outcome_ci_upper', 'float', '5.7');
      const warnings = checkGroupConsistency(group([lower, mean, upper]));
      expect(warnings.map((w) => w.cellKey).sort()).toEqual([mean.cellKey, upper.cellKey].sort());
    });

    test('適合: 下限 ≤ mean ≤ 上限', () => {
      const lower = makeCell('outcome_ci_lower', 'float', '4.7');
      const mean = makeCell('outcome_mean', 'float', '5.2');
      const upper = makeCell('outcome_ci_upper', 'float', '5.7');
      expect(checkGroupConsistency(group([lower, mean, upper]))).toEqual([]);
    });

    test('3 値のうち 1 つでも欠けていれば適用しない（mean のみ・CI なし）', () => {
      const mean = makeCell('outcome_mean', 'float', '100');
      const upper = makeCell('outcome_ci_upper', 'float', '5.7');
      // 下限が無いため C4 は不成立（C3 も下限がないため不成立）。何も警告しない
      expect(checkGroupConsistency(group([mean, upper]))).toEqual([]);
    });
  });

  describe('C5: outcome_q1 ≤ outcome_median ≤ outcome_q3（3 値そろったとき）', () => {
    test('違反: median が q1 を下回る', () => {
      const q1 = makeCell('outcome_q1', 'float', '3.8');
      const median = makeCell('outcome_median', 'float', '3.0');
      const q3 = makeCell('outcome_q3', 'float', '6.1');
      const warnings = checkGroupConsistency(group([q1, median, q3]));
      expect(warnings.map((w) => w.cellKey).sort()).toEqual([q1.cellKey, median.cellKey].sort());
    });

    test('違反: median が q3 を上回る', () => {
      const q1 = makeCell('outcome_q1', 'float', '3.8');
      const median = makeCell('outcome_median', 'float', '7.0');
      const q3 = makeCell('outcome_q3', 'float', '6.1');
      const warnings = checkGroupConsistency(group([q1, median, q3]));
      expect(warnings.map((w) => w.cellKey).sort()).toEqual([median.cellKey, q3.cellKey].sort());
    });

    test('適合: q1 ≤ median ≤ q3', () => {
      const q1 = makeCell('outcome_q1', 'float', '3.8');
      const median = makeCell('outcome_median', 'float', '4.9');
      const q3 = makeCell('outcome_q3', 'float', '6.1');
      expect(checkGroupConsistency(group([q1, median, q3]))).toEqual([]);
    });

    test('3 値そろわなければ適用しない（q3 なし）', () => {
      const q1 = makeCell('outcome_q1', 'float', '3.8');
      const median = makeCell('outcome_median', 'float', '100');
      expect(checkGroupConsistency(group([q1, median]))).toEqual([]);
    });
  });

  describe('C6: min/max との整合性', () => {
    test('違反: min > q1', () => {
      const min = makeCell('outcome_min', 'float', '4.0');
      const q1 = makeCell('outcome_q1', 'float', '3.8');
      expect(checkGroupConsistency(group([min, q1]))).toHaveLength(2);
    });

    test('違反: q3 > max', () => {
      // 丸め許容幅（±0.05）を超える差を付けて、区間演算でも矛盾する組み合わせにする
      const q3 = makeCell('outcome_q3', 'float', '9.8');
      const max = makeCell('outcome_max', 'float', '9.4');
      expect(checkGroupConsistency(group([q3, max]))).toHaveLength(2);
    });

    test('違反: median が min〜max の範囲外（3 値そろったときだけ適用）', () => {
      const min = makeCell('outcome_min', 'float', '1.2');
      const median = makeCell('outcome_median', 'float', '20');
      const max = makeCell('outcome_max', 'float', '9.4');
      const warnings = checkGroupConsistency(group([min, median, max]));
      expect(warnings.map((w) => w.cellKey).sort()).toEqual([max.cellKey, median.cellKey].sort());
    });

    test('median のみで min/max が無ければ C6 の当該部分は適用しない', () => {
      const median = makeCell('outcome_median', 'float', '20');
      expect(checkGroupConsistency(group([median]))).toEqual([]);
    });

    test('違反: mean が min〜max の範囲外（3 値そろったときだけ適用）', () => {
      const min = makeCell('outcome_min', 'float', '1.2');
      const mean = makeCell('outcome_mean', 'float', '-5');
      const max = makeCell('outcome_max', 'float', '9.4');
      const warnings = checkGroupConsistency(group([min, mean, max]));
      expect(warnings.map((w) => w.cellKey).sort()).toEqual([mean.cellKey, min.cellKey].sort());
    });

    test('違反: min > max', () => {
      const min = makeCell('outcome_min', 'float', '10');
      const max = makeCell('outcome_max', 'float', '9.4');
      expect(checkGroupConsistency(group([min, max]))).toHaveLength(2);
    });

    test('適合: min ≤ q1、q3 ≤ max、min ≤ median ≤ max、min ≤ mean ≤ max、min ≤ max がすべて成立', () => {
      const min = makeCell('outcome_min', 'float', '1.2');
      const q1 = makeCell('outcome_q1', 'float', '3.8');
      const median = makeCell('outcome_median', 'float', '4.9');
      const q3 = makeCell('outcome_q3', 'float', '6.1');
      const max = makeCell('outcome_max', 'float', '9.4');
      const mean = makeCell('outcome_mean', 'float', '5.2');
      expect(checkGroupConsistency(group([min, q1, median, q3, max, mean]))).toEqual([]);
    });
  });

  describe('C7: 0 < outcome_ci_level < 100（正確値比較）', () => {
    test('違反: 0 以下', () => {
      const level = makeCell('outcome_ci_level', 'float', '0');
      expect(checkGroupConsistency(group([level]))).toEqual([
        { cellKey: level.cellKey, message: expect.stringContaining('0 〜 100') },
      ]);
    });

    test('違反: 100 以上', () => {
      const level = makeCell('outcome_ci_level', 'float', '100');
      expect(checkGroupConsistency(group([level]))).toHaveLength(1);
    });

    test('適合: 95', () => {
      const level = makeCell('outcome_ci_level', 'float', '95');
      expect(checkGroupConsistency(group([level]))).toEqual([]);
    });
  });
});

describe('collectConsistencyWarnings', () => {
  test('複数グループの警告を cellKey → メッセージ列へ集約する', () => {
    const otherEntityKey = 'outcome:mortality|arm:1';
    const events1 = makeCell('outcome_events', 'integer', '13');
    const total1 = makeCell('outcome_total', 'integer', '12');
    const events2 = makeCell('outcome_events', 'integer', '3', undefined, otherEntityKey);
    const total2 = makeCell('outcome_total', 'integer', '5', undefined, otherEntityKey);
    const model: TabModel = {
      groups: [group([events1, total1]), { heading: 'other', cells: [events2, total2] }],
      cells: [events1, total1, events2, total2],
    };
    const result = collectConsistencyWarnings(model);
    expect(result.size).toBe(2);
    expect(result.get(events1.cellKey)).toEqual([expect.stringContaining('を超えています')]);
    expect(result.get(total1.cellKey)).toEqual(result.get(events1.cellKey));
    expect(result.has(events2.cellKey)).toBe(false);
    expect(result.has(total2.cellKey)).toBe(false);
  });

  test('1 セルに複数の違反があれば全メッセージが並ぶ', () => {
    // events が負（B2 違反）かつ total を超過（B1 違反）の 2 重違反
    const events = makeCell('outcome_events', 'integer', '-5');
    const total = makeCell('outcome_total', 'integer', '-10');
    const model: TabModel = { groups: [group([events, total])], cells: [events, total] };
    const messages = collectConsistencyWarnings(model).get(events.cellKey);
    expect(messages).toHaveLength(2);
    expect(messages?.some((m) => m.includes('負の値'))).toBe(true);
    expect(messages?.some((m) => m.includes('を超えています'))).toBe(true);
  });

  test('違反が無ければ空の Map', () => {
    const events = makeCell('outcome_events', 'integer', '3');
    const total = makeCell('outcome_total', 'integer', '5');
    const model: TabModel = { groups: [group([events, total])], cells: [events, total] };
    expect(collectConsistencyWarnings(model)).toEqual(new Map());
  });

  test('study タブ等、outcome_* フィールドを持たないタブは自然に空になる（entity_level の絞り込み不要）', () => {
    const unrelated = makeCell('sample_size_total', 'integer', '9999999');
    const model: TabModel = {
      groups: [{ heading: 'methods', cells: [unrelated] }],
      cells: [unrelated],
    };
    expect(collectConsistencyWarnings(model)).toEqual(new Map());
  });
});
