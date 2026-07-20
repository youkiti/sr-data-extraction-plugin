import { parseCsv } from '../../../../../src/features/export/parseCsv';
import { buildRobCsv, ROB_HEADER } from '../../../../../src/features/export/rset/buildRobCsv';
import { ENTITY_INSTANCE_DECLARATION_FIELD_ID } from '../../../../../src/features/verification/instanceDeclarations';
import { makeDecision, makeEvidence, makeField, makeResultsDataRow, makeStudy } from './testHelpers';

const rob2Fields = [
  makeField({
    fieldId: 'f-judgement',
    fieldName: 'rob2_judgement',
    entityLevel: 'rob_domain',
    dataType: 'enum',
    allowedValues: 'low|some_concerns|high',
  }),
  makeField({
    fieldId: 'f-support',
    fieldName: 'rob2_support',
    entityLevel: 'rob_domain',
    dataType: 'text',
  }),
];

describe('buildRobCsv', () => {
  test('RoB テンプレートがスキーマに無ければヘッダーのみ', () => {
    const result = buildRobCsv([makeStudy()], [], [], [], []);
    expect(result.csv).toBe(`${ROB_HEADER.join(',')}\r\n`);
    expect(result.rowCount).toBe(0);
    expect(result.issues).toEqual([]);
  });

  test('judgement / support を確定 annotator の行から解決し、verified のみ値を出す', () => {
    const studies = [makeStudy({ studyId: 'study-1' })];
    const resultsRows = [
      makeResultsDataRow({
        resultId: 'r-1',
        studyId: 'study-1',
        fieldId: 'f-judgement',
        entityKey: 'rob:d1_randomization',
        value: 'low',
      }),
      makeResultsDataRow({
        resultId: 'r-2',
        studyId: 'study-1',
        fieldId: 'f-support',
        entityKey: 'rob:d1_randomization',
        value: 'randomized via computer',
      }),
      // overall は AI Evidence のみで人間の判定 0 件 → unverified
      makeResultsDataRow({
        resultId: 'r-3',
        studyId: 'study-1',
        fieldId: 'f-judgement',
        entityKey: 'rob:overall',
        value: null,
      }),
    ];
    const evidences = [makeEvidence({ studyId: 'study-1', fieldId: 'f-judgement', entityKey: 'rob:overall' })];
    const result = buildRobCsv(studies, resultsRows, [], evidences, rob2Fields);
    const records = parseCsv(result.csv);
    const byDomain = new Map(records.slice(1).map((r) => [r[3], r]));

    const d1 = byDomain.get('d1_randomization');
    expect(d1).toEqual([
      'study-1',
      'Smith 2020',
      'rob2',
      'd1_randomization',
      'randomization process',
      '',
      '',
      'rob:d1_randomization',
      'low',
      'randomized via computer',
      'verified',
      '1',
    ]);

    const overall = byDomain.get('overall');
    expect(overall?.[8]).toBe(''); // judgement 値は unverified のため空
    expect(overall?.[10]).toBe('unverified');

    // 他ドメイン（d2〜d5）は Evidence も判定も無いため no_data で必ず出現する（幽霊セル）
    const d2 = byDomain.get('d2_deviations');
    expect(d2?.[10]).toBe('no_data');

    expect(records).toHaveLength(1 + 6); // RoB2 は 5 ドメイン + overall = 6 行

    expect(result.issues).toEqual([
      expect.objectContaining({ issueType: 'unverified_cell', entityKey: 'rob:overall' }),
    ]);
  });

  test('support 項目がスキーマから外れている場合は support 列を常に空にする', () => {
    const judgementOnly = [rob2Fields[0] as (typeof rob2Fields)[number]];
    const studies = [makeStudy({ studyId: 'study-1' })];
    const resultsRows = [
      makeResultsDataRow({
        resultId: 'r-1',
        studyId: 'study-1',
        fieldId: 'f-judgement',
        entityKey: 'rob:overall',
        value: 'high',
      }),
    ];
    const result = buildRobCsv(studies, resultsRows, [], [], judgementOnly);
    const records = parseCsv(result.csv);
    const overall = records.find((r) => r[3] === 'overall');
    expect(overall?.[9]).toBe(''); // support 列は常に空
  });

  test('確定 annotator を一意に特定できない study は issue を積んで除外する', () => {
    const studies = [makeStudy({ studyId: 'study-1' })];
    const resultsRows = [
      makeResultsDataRow({ resultId: 'r-1', studyId: 'study-1', annotator: 'a@example.com', fieldId: 'f-judgement' }),
      makeResultsDataRow({ resultId: 'r-2', studyId: 'study-1', annotator: 'b@example.com', fieldId: 'f-judgement' }),
    ];
    const result = buildRobCsv(studies, resultsRows, [], [], rob2Fields);
    expect(result.rowCount).toBe(0);
    expect(result.issues).toEqual([
      expect.objectContaining({ issueType: 'skipped_study_no_final_annotator', studyId: 'study-1' }),
    ]);
  });

  test('AI 行は確定 annotator の値解決から除外される', () => {
    const studies = [makeStudy({ studyId: 'study-1' })];
    const resultsRows = [
      makeResultsDataRow({
        resultId: 'r-ai',
        studyId: 'study-1',
        annotator: 'ai',
        annotatorType: 'ai',
        fieldId: 'f-judgement',
        entityKey: 'rob:overall',
        value: 'high',
      }),
      makeResultsDataRow({
        resultId: 'r-human',
        studyId: 'study-1',
        annotator: 'reviewer@example.com',
        annotatorType: 'human_with_ai',
        fieldId: 'f-judgement',
        entityKey: 'rob:overall',
        value: 'low',
      }),
    ];
    const result = buildRobCsv(studies, resultsRows, [], [], rob2Fields);
    const records = parseCsv(result.csv);
    const overall = records.find((r) => r[3] === 'overall');
    expect(overall?.[8]).toBe('low'); // AI 行（high）ではなく確定 human 行の値
  });

  test('annotator 文字列は一致するが annotator_type が異なる decoy 行は値解決から除外する', () => {
    // consensus.length === 1 で即確定するため、型不一致の decoy（同じ annotator 文字列）が
    // 紛れ込んでいても確定 annotator の選定自体には影響しない。buildLookup の絞り込みを検証する
    const studies = [makeStudy({ studyId: 'study-1' })];
    const resultsRows = [
      makeResultsDataRow({
        resultId: 'r-consensus',
        studyId: 'study-1',
        annotator: 'consensus',
        annotatorType: 'consensus',
        fieldId: 'f-judgement',
        entityKey: 'rob:overall',
        value: 'low',
      }),
      makeResultsDataRow({
        resultId: 'r-decoy',
        studyId: 'study-1',
        annotator: 'consensus',
        annotatorType: 'human_with_ai',
        fieldId: 'f-support',
        entityKey: 'rob:overall',
        value: 'decoy',
      }),
    ];
    const result = buildRobCsv(studies, resultsRows, [], [], rob2Fields);
    const records = parseCsv(result.csv);
    const overall = records.find((r) => r[3] === 'overall');
    expect(overall?.[8]).toBe('low'); // judgement（consensus 行）
    expect(overall?.[9]).toBe(''); // support は decoy 行のみのため未検証扱い
  });

  test('ResultsData 行が 0 件の study は issue を積まず黙って除外する', () => {
    const studies = [makeStudy({ studyId: 'study-1' })];
    const result = buildRobCsv(studies, [], [], [], rob2Fields);
    expect(result.rowCount).toBe(0);
    expect(result.issues).toEqual([]);
  });

  test('ROBINS-I のドメインも列挙できる（tool 判別）', () => {
    const robinsFields = [
      makeField({ fieldId: 'f-j', fieldName: 'robins_i_judgement', entityLevel: 'rob_domain' }),
    ];
    const studies = [makeStudy({ studyId: 'study-1' })];
    const resultsRows = [
      makeResultsDataRow({ resultId: 'r-1', studyId: 'study-1', fieldId: 'f-j', entityKey: 'rob:overall', value: 'moderate' }),
    ];
    const result = buildRobCsv(studies, resultsRows, [], [], robinsFields);
    const records = parseCsv(result.csv);
    expect(records).toHaveLength(1 + 8); // ROBINS-I は 7 ドメイン + overall = 8 行
    expect(records.find((r) => r[3] === 'overall')?.[2]).toBe('robins_i');
  });

  test('QUADAS-3 は risk-of-bias / applicability の 2 tool として列挙できる（issue #88）', () => {
    const quadas3Fields = [
      makeField({ fieldId: 'f-rob', fieldName: 'quadas3_rob_judgement', entityLevel: 'rob_domain' }),
      makeField({ fieldId: 'f-app', fieldName: 'quadas3_applicability_judgement', entityLevel: 'rob_domain' }),
    ];
    const studies = [makeStudy({ studyId: 'study-1' })];
    const resultsRows = [
      makeResultsDataRow({
        resultId: 'r-1',
        studyId: 'study-1',
        fieldId: 'f-rob',
        entityKey: 'rob:quadas3_overall',
        value: 'low',
      }),
      makeResultsDataRow({
        resultId: 'r-2',
        studyId: 'study-1',
        fieldId: 'f-app',
        entityKey: 'rob:quadas3_overall',
        value: 'high',
      }),
    ];
    const result = buildRobCsv(studies, resultsRows, [], [], quadas3Fields);
    const records = parseCsv(result.csv);
    // risk-of-bias（D1〜D4 + overall = 5 行）+ applicability（D1〜D3 + overall = 4 行）
    expect(records).toHaveLength(1 + 5 + 4);
    const robOverall = records.find((r) => r[2] === 'quadas3' && r[3] === 'quadas3_overall');
    expect(robOverall?.[8]).toBe('low');
    const applicabilityOverall = records.find(
      (r) => r[2] === 'quadas3_applicability' && r[3] === 'quadas3_overall',
    );
    expect(applicabilityOverall?.[8]).toBe('high');
  });

  test('estimate 単位のオーバーライド行を宣言分だけ出力し、outcome_id に参照先キーの正準形を充填する（issue #109）', () => {
    const studies = [makeStudy({ studyId: 'study-1' })];
    const overrideKey = 'rob:d1_randomization|outcome:mortality|arm:1';
    const resultsRows = [
      // base（d1）と estimate 別オーバーライド（d1 × mortality/arm:1）が共存する
      makeResultsDataRow({
        resultId: 'r-base-j',
        studyId: 'study-1',
        fieldId: 'f-judgement',
        entityKey: 'rob:d1_randomization',
        value: 'low',
      }),
      makeResultsDataRow({
        resultId: 'r-ov-j',
        studyId: 'study-1',
        fieldId: 'f-judgement',
        entityKey: overrideKey,
        value: 'high',
      }),
      makeResultsDataRow({
        resultId: 'r-ov-s',
        studyId: 'study-1',
        fieldId: 'f-support',
        entityKey: overrideKey,
        value: 'per-protocol only for this estimate',
      }),
      // outcome_result レベルの行はオーバーライド列挙の対象外
      makeResultsDataRow({
        resultId: 'r-out',
        studyId: 'study-1',
        fieldId: 'f-other',
        entityKey: 'outcome:mortality|arm:1',
        value: '1',
      }),
    ];
    const result = buildRobCsv(studies, resultsRows, [], [], rob2Fields);
    const records = parseCsv(result.csv);
    const d1Rows = records.filter((r) => r[3] === 'd1_randomization');
    expect(d1Rows).toHaveLength(2);
    // base 行は outcome_id 空のまま先頭
    expect(d1Rows[0]?.slice(6, 12)).toEqual(['', 'rob:d1_randomization', 'low', '', 'verified', '1']);
    // オーバーライド行は outcome_id に参照先インスタンスキー・entity_key に原文
    expect(d1Rows[1]?.slice(0, 12)).toEqual([
      'study-1',
      'Smith 2020',
      'rob2',
      'd1_randomization',
      'randomization process',
      '',
      'outcome:mortality|arm:1',
      overrideKey,
      'high',
      'per-protocol only for this estimate',
      'verified',
      '1',
    ]);
    // オーバーライドの無い他ドメインは base 1 行のまま（未評価 estimate の行は捏造しない）
    expect(records.filter((r) => r[3] === 'd2_deviations')).toHaveLength(1);
    expect(result.rowCount).toBe(6 + 1);
  });

  test('ソートは domain テンプレート順 → outcome_id 昇順（base 先頭）。宣言のみのオーバーライドも出現する', () => {
    const studies = [makeStudy({ studyId: 'study-1' })];
    const resultsRows = [
      makeResultsDataRow({
        resultId: 'r-1',
        studyId: 'study-1',
        fieldId: 'f-judgement',
        entityKey: 'rob:d1_randomization|outcome:pain',
        value: 'high',
      }),
      makeResultsDataRow({
        resultId: 'r-2',
        studyId: 'study-1',
        fieldId: 'f-judgement',
        entityKey: 'rob:d1_randomization|outcome:mortality',
        value: 'low',
      }),
      // 同一 estimate を指すセグメント順の表記揺れ 2 キーは entity_key 昇順のタイブレークで並ぶ
      makeResultsDataRow({
        resultId: 'r-3',
        studyId: 'study-1',
        fieldId: 'f-judgement',
        entityKey: 'rob:d2_deviations|outcome:pain|time:30d|arm:2',
        value: 'high',
      }),
      makeResultsDataRow({
        resultId: 'r-4',
        studyId: 'study-1',
        fieldId: 'f-judgement',
        entityKey: 'rob:d2_deviations|outcome:pain|arm:2|time:30d',
        value: 'low',
      }),
    ];
    const decisions = [
      // S8 の宣言イベントだけがあり ResultsData が無いオーバーライドも宣言分として出現する（no_data）
      makeDecision({
        studyId: 'study-1',
        fieldId: ENTITY_INSTANCE_DECLARATION_FIELD_ID,
        entityKey: 'rob:overall|outcome:mortality',
        value: 'rob:overall|outcome:mortality',
      }),
      // テンプレートに無いドメインの宣言・study レベルの判定行は出力に関与しない
      makeDecision({ studyId: 'study-1', entityKey: 'rob:unknown_domain|outcome:mortality' }),
      makeDecision({ studyId: 'study-1', entityKey: '-' }),
      // 他 study の宣言は混入しない
      makeDecision({ studyId: 'study-2', entityKey: 'rob:overall|outcome:pain' }),
    ];
    const result = buildRobCsv(studies, resultsRows, decisions, [], rob2Fields);
    const records = parseCsv(result.csv);
    expect(records.slice(1).map((r) => [r[3], r[6]])).toEqual([
      ['d1_randomization', ''],
      ['d1_randomization', 'outcome:mortality'],
      ['d1_randomization', 'outcome:pain'],
      ['d2_deviations', ''],
      ['d2_deviations', 'outcome:pain|arm:2|time:30d'],
      ['d2_deviations', 'outcome:pain|arm:2|time:30d'],
      ['d3_missing_data', ''],
      ['d4_measurement', ''],
      ['d5_reporting', ''],
      ['overall', ''],
      ['overall', 'outcome:mortality'],
    ]);
    expect(records.filter((r) => r[3] === 'd2_deviations' && r[6] !== '').map((r) => r[7])).toEqual([
      'rob:d2_deviations|outcome:pain|arm:2|time:30d',
      'rob:d2_deviations|outcome:pain|time:30d|arm:2',
    ]);
    const declaredOnly = records.find((r) => r[7] === 'rob:overall|outcome:mortality');
    expect(declaredOnly?.[10]).toBe('no_data');
  });

  test('オーバーライド行にも verification_status の規則と unverified_cell の積み上げを base と同様に適用する', () => {
    const studies = [makeStudy({ studyId: 'study-1' })];
    const overrideKey = 'rob:overall|outcome:mortality|arm:1';
    const decisions = [
      makeDecision({
        studyId: 'study-1',
        fieldId: ENTITY_INSTANCE_DECLARATION_FIELD_ID,
        entityKey: overrideKey,
        value: overrideKey,
      }),
    ];
    // 宣言済みオーバーライドに AI Evidence だけがあり人間の判定が 0 件 → unverified
    const evidences = [makeEvidence({ studyId: 'study-1', fieldId: 'f-judgement', entityKey: overrideKey })];
    const resultsRows = [
      makeResultsDataRow({
        resultId: 'r-1',
        studyId: 'study-1',
        fieldId: 'f-judgement',
        entityKey: 'rob:overall',
        value: 'low',
      }),
    ];
    const result = buildRobCsv(studies, resultsRows, decisions, evidences, rob2Fields);
    const records = parseCsv(result.csv);
    const overrideRow = records.find((r) => r[7] === overrideKey);
    expect(overrideRow?.[6]).toBe('outcome:mortality|arm:1');
    expect(overrideRow?.[8]).toBe(''); // 値列は unverified のため空（base と同じ規則）
    expect(overrideRow?.[10]).toBe('unverified');
    expect(result.issues).toEqual([
      expect.objectContaining({ issueType: 'unverified_cell', entityKey: overrideKey, fieldId: 'f-judgement' }),
    ]);
  });

  test('QUIPS のドメインも列挙できる（overall は無く 6 ドメインのみ・issue #88）', () => {
    const quipsFields = [makeField({ fieldId: 'f-j', fieldName: 'quips_judgement', entityLevel: 'rob_domain' })];
    const studies = [makeStudy({ studyId: 'study-1' })];
    const resultsRows = [
      makeResultsDataRow({
        resultId: 'r-1',
        studyId: 'study-1',
        fieldId: 'f-j',
        entityKey: 'rob:quips_d5_confounding',
        value: 'moderate',
      }),
    ];
    const result = buildRobCsv(studies, resultsRows, [], [], quipsFields);
    const records = parseCsv(result.csv);
    expect(records).toHaveLength(1 + 6); // QUIPS は 6 ドメインのみ（overall 無し）
    expect(records.find((r) => r[3] === 'quips_d5_confounding')?.[8]).toBe('moderate');
    expect(records.every((r) => r[3] !== 'overall')).toBe(true);
  });
});
