import { parseCsv } from '../../../../../src/features/export/parseCsv';
import { buildRobCsv, ROB_HEADER } from '../../../../../src/features/export/rset/buildRobCsv';
import { makeEvidence, makeField, makeResultsDataRow, makeStudy } from './testHelpers';

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
    const result = buildRobCsv([makeStudy()], [], [], []);
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
    const result = buildRobCsv(studies, resultsRows, evidences, rob2Fields);
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
    const result = buildRobCsv(studies, resultsRows, [], judgementOnly);
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
    const result = buildRobCsv(studies, resultsRows, [], rob2Fields);
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
    const result = buildRobCsv(studies, resultsRows, [], rob2Fields);
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
    const result = buildRobCsv(studies, resultsRows, [], rob2Fields);
    const records = parseCsv(result.csv);
    const overall = records.find((r) => r[3] === 'overall');
    expect(overall?.[8]).toBe('low'); // judgement（consensus 行）
    expect(overall?.[9]).toBe(''); // support は decoy 行のみのため未検証扱い
  });

  test('ResultsData 行が 0 件の study は issue を積まず黙って除外する', () => {
    const studies = [makeStudy({ studyId: 'study-1' })];
    const result = buildRobCsv(studies, [], [], rob2Fields);
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
    const result = buildRobCsv(studies, resultsRows, [], robinsFields);
    const records = parseCsv(result.csv);
    expect(records).toHaveLength(1 + 8); // ROBINS-I は 7 ドメイン + overall = 8 行
    expect(records.find((r) => r[3] === 'overall')?.[2]).toBe('robins_i');
  });
});
