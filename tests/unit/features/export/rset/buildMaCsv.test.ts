import { NOT_REPORTED_TOKEN } from '../../../../../src/domain/annotation';
import { parseCsv } from '../../../../../src/features/export/parseCsv';
import { buildMaCsv } from '../../../../../src/features/export/rset/buildMaCsv';
import { ENTITY_INSTANCE_DECLARATION_FIELD_ID } from '../../../../../src/features/verification/instanceDeclarations';
import {
  makeArmStructureRow,
  makeEvidence,
  makeField,
  makeResultsDataRow,
  makeStudy,
} from './testHelpers';

const continuousFields = [
  makeField({ fieldId: 'f-mean', fieldName: 'outcome_mean', entityLevel: 'outcome_result', dataType: 'float' }),
  makeField({ fieldId: 'f-sd', fieldName: 'outcome_sd', entityLevel: 'outcome_result', dataType: 'float' }),
  makeField({ fieldId: 'f-n', fieldName: 'outcome_n', entityLevel: 'outcome_result', dataType: 'integer' }),
];
const binaryFields = [
  makeField({ fieldId: 'f-events', fieldName: 'outcome_events', entityLevel: 'outcome_result', dataType: 'integer' }),
  makeField({ fieldId: 'f-total', fieldName: 'outcome_total', entityLevel: 'outcome_result', dataType: 'integer' }),
];

function row(overrides: Parameters<typeof makeResultsDataRow>[0]) {
  return makeResultsDataRow(overrides);
}

describe('buildMaCsv', () => {
  test('study が無ければヘッダーのみ', () => {
    const result = buildMaCsv([], [], [], [], [], []);
    expect(result.csv).toBe(`${result.header.join(',')}\r\n`);
    expect(result.statusCsv).toBe(`${result.header.join(',')}\r\n`);
    expect(result.rowCount).toBe(0);
  });

  test('ResultsData が 0 件の study は issue を積まず黙って除外する', () => {
    const result = buildMaCsv([makeStudy()], [], [], [], [], continuousFields);
    expect(result.rowCount).toBe(0);
    expect(result.issues).toEqual([]);
  });

  test('確定 annotator を一意に特定できない study は issue を積んで除外する', () => {
    const resultsRows = [
      row({ resultId: 'r-1', annotator: 'a@example.com' }),
      row({ resultId: 'r-2', annotator: 'b@example.com' }),
    ];
    const result = buildMaCsv([makeStudy()], resultsRows, [], [], [], continuousFields);
    expect(result.rowCount).toBe(0);
    expect(result.issues).toEqual([
      expect.objectContaining({ issueType: 'skipped_study_no_final_annotator' }),
    ]);
  });

  test('AI 行（annotator=ai）は確定 human 行とは別扱いで、値の解決からは除外される', () => {
    const studies = [makeStudy({ studyId: 'study-1' })];
    const resultsRows = [
      row({ resultId: 'r-ai', entityKey: 'outcome:pain|arm:1', fieldId: 'f-mean', annotator: 'ai', annotatorType: 'ai', value: '999' }),
      row({ resultId: 'r-human', entityKey: 'outcome:pain|arm:1', fieldId: 'f-mean', annotator: 'reviewer@example.com', annotatorType: 'human_with_ai', value: '1' }),
    ];
    const result = buildMaCsv(studies, resultsRows, [], [], [], continuousFields);
    const records = parseCsv(result.csv);
    expect(records[1]?.[12]).toBe('1'); // ai 行の 999 ではなく確定 human 行の値が採用される
  });

  test('annotator 文字列が一致しても annotator_type が異なる行は確定 annotator の対象から除外する', () => {
    // 'consensus' という annotator 文字列を持つが type が異なる行が混在しても、
    // buildLookup は (annotator, annotator_type) の完全一致だけを採用する
    const studies = [makeStudy({ studyId: 'study-1' })];
    const resultsRows = [
      row({
        resultId: 'r-consensus',
        entityKey: 'outcome:pain|arm:1',
        fieldId: 'f-mean',
        annotator: 'consensus',
        annotatorType: 'consensus',
        value: '5',
      }),
      row({
        resultId: 'r-decoy',
        entityKey: 'outcome:pain|arm:1',
        fieldId: 'f-sd',
        annotator: 'consensus',
        annotatorType: 'human_with_ai',
        value: '999',
      }),
    ];
    const result = buildMaCsv(studies, resultsRows, [], [], [], continuousFields);
    const records = parseCsv(result.csv);
    expect(records[1]?.[12]).toBe('5'); // f-mean（consensus 行）
    expect(records[1]?.[13]).toBe(''); // f-sd（annotator_type 不一致の decoy 行は採用しない → 未検証扱い）
  });

  test('arm 単位 long: verified / not_reported / unverified / no_data を横持ちし、値表は verified のみ実値を出す', () => {
    const studies = [makeStudy({ studyId: 'study-1' })];
    const armStructureRows = [
      makeArmStructureRow({ armKey: 'arm:1', armName: '介入群' }),
      makeArmStructureRow({ armKey: 'arm:2', armName: '対照群' }),
    ];
    const entityKey1 = 'outcome:mortality|arm:1|time:30d';
    const entityKey2 = 'outcome:mortality|arm:2|time:30d';
    const resultsRows = [
      row({ resultId: 'r-1', entityKey: entityKey1, fieldId: 'f-mean', value: '5.2' }),
      row({ resultId: 'r-2', entityKey: entityKey1, fieldId: 'f-sd', value: NOT_REPORTED_TOKEN, notReported: true }),
      // f-n は AI Evidence があるが人間の判定 0 件 → unverified
      row({ resultId: 'r-3', entityKey: entityKey2, fieldId: 'f-mean', value: '6.1' }),
    ];
    const evidences = [makeEvidence({ studyId: 'study-1', fieldId: 'f-n', entityKey: entityKey1 })];
    const result = buildMaCsv(studies, resultsRows, [], evidences, armStructureRows, continuousFields);
    const records = parseCsv(result.csv);
    const statusRecords = parseCsv(result.statusCsv);

    expect(records[0]).toEqual([
      'study_id',
      'study_label',
      'outcome_id',
      'outcome_label',
      'timepoint',
      'timepoint_value',
      'timepoint_unit',
      'arm_id',
      'arm_label',
      'rob_tool',
      'rob_overall_judgement',
      'schema_version',
      'outcome_mean',
      'outcome_sd',
      'outcome_n',
    ]);
    // arm:1 行
    expect(records[1]).toEqual([
      'study-1',
      'Smith 2020',
      'mortality',
      '',
      '30d',
      '30',
      'd',
      '1',
      '介入群',
      '',
      '',
      '1',
      '5.2',
      '',
      '',
    ]);
    expect(statusRecords[1]).toEqual([
      'study-1',
      'Smith 2020',
      'mortality',
      '',
      '30d',
      '30',
      'd',
      '1',
      '介入群',
      '',
      '', // rob_overall_judgement: RoB プリセット未挿入のため空文字（下記 rob テストで挿入時の挙動を確認）
      '1',
      'verified',
      'not_reported',
      'unverified',
    ]);
    // arm:2 行
    expect(records[2]?.slice(7, 9)).toEqual(['2', '対照群']);
    expect(records[2]?.[12]).toBe('6.1');

    const unverifiedIssue = result.issues.find(
      (issue) => issue.issueType === 'unverified_cell' && issue.fieldId === 'f-n',
    );
    expect(unverifiedIssue).toMatchObject({ entityKey: entityKey1 });
  });

  test('rob_tool / rob_overall_judgement は RoB プリセット未挿入時は常に空文字（ステータス語彙を出さない）', () => {
    const studies = [makeStudy({ studyId: 'study-1' })];
    const resultsRows = [row({ entityKey: 'outcome:mortality|arm:1', fieldId: 'f-mean', value: '1' })];
    const result = buildMaCsv(studies, resultsRows, [], [], [], continuousFields);
    const statusRecords = parseCsv(result.statusCsv);
    expect(statusRecords[1]?.[9]).toBe(''); // rob_tool（キー列。ステータス表でも echo）
    expect(statusRecords[1]?.[10]).toBe(''); // rob_overall_judgement 未挿入時は空文字
  });

  test('rob_overall_judgement は study の rob:overall 判定を複製し、全 outcome 行へ同じ値を出す', () => {
    const robFields = [
      makeField({ fieldId: 'f-judgement', fieldName: 'rob2_judgement', entityLevel: 'rob_domain' }),
    ];
    const studies = [makeStudy({ studyId: 'study-1' })];
    const resultsRows = [
      row({ resultId: 'r-outcome', entityKey: 'outcome:mortality|arm:1', fieldId: 'f-mean', value: '1' }),
      row({ resultId: 'r-rob', entityKey: 'rob:overall', fieldId: 'f-judgement', value: 'low' }),
    ];
    const result = buildMaCsv(studies, resultsRows, [], [], [], [...continuousFields, ...robFields]);
    const records = parseCsv(result.csv);
    expect(records[1]?.[9]).toBe('rob2');
    expect(records[1]?.[10]).toBe('low');
  });

  test('rob2_support が rob2_judgement より先にスキーマへ並んでいても judgement 項目を正しく解決する', () => {
    // fields.find の探索順で rob_domain レベルだが fieldName 不一致（support）を
    // 先に評価させ、judgement 項目の探索がその後も継続することを確認する
    const robFieldsSupportFirst = [
      makeField({ fieldId: 'f-support', fieldName: 'rob2_support', entityLevel: 'rob_domain' }),
      makeField({ fieldId: 'f-judgement', fieldName: 'rob2_judgement', entityLevel: 'rob_domain' }),
    ];
    const studies = [makeStudy({ studyId: 'study-1' })];
    const resultsRows = [
      row({ resultId: 'r-outcome', entityKey: 'outcome:mortality|arm:1', fieldId: 'f-mean', value: '1' }),
      row({ resultId: 'r-rob', entityKey: 'rob:overall', fieldId: 'f-judgement', value: 'high' }),
    ];
    const result = buildMaCsv(
      studies,
      resultsRows,
      [],
      [],
      [],
      [...continuousFields, ...robFieldsSupportFirst],
    );
    const records = parseCsv(result.csv);
    expect(records[1]?.[10]).toBe('high');
  });

  test('rob_overall_judgement が AI Evidence のみ（人間の判定 0 件）のときは unverified の issue を積む', () => {
    const robFields = [
      makeField({ fieldId: 'f-judgement', fieldName: 'rob2_judgement', entityLevel: 'rob_domain' }),
    ];
    const studies = [makeStudy({ studyId: 'study-1' })];
    const resultsRows = [row({ resultId: 'r-outcome', entityKey: 'outcome:mortality|arm:1', fieldId: 'f-mean', value: '1' })];
    const evidences = [makeEvidence({ studyId: 'study-1', fieldId: 'f-judgement', entityKey: 'rob:overall' })];
    const result = buildMaCsv(studies, resultsRows, [], evidences, [], [...continuousFields, ...robFields]);
    const statusRecords = parseCsv(result.statusCsv);
    expect(statusRecords[1]?.[10]).toBe('unverified');
    expect(result.issues).toContainEqual(
      expect.objectContaining({ issueType: 'unverified_cell', entityKey: 'rob:overall', fieldId: 'f-judgement' }),
    );
  });

  test('outcome_label は outcome_name フィールドの verified 値のみ採用する（無ければ空）', () => {
    const nameField = makeField({ fieldId: 'f-name', fieldName: 'outcome_name', entityLevel: 'outcome_result' });
    const studies = [makeStudy({ studyId: 'study-1' })];
    const resultsRows = [
      row({ resultId: 'r-1', entityKey: 'outcome:mortality|arm:1', fieldId: 'f-mean', value: '1' }),
      row({ resultId: 'r-2', entityKey: 'outcome:mortality|arm:1', fieldId: 'f-name', value: '全死亡' }),
    ];
    const result = buildMaCsv(studies, resultsRows, [], [], [], [...continuousFields, nameField]);
    const records = parseCsv(result.csv);
    expect(records[1]?.[3]).toBe('全死亡');
  });

  test('not_applicable: 二値専用項目にのみ実データがあるインスタンスでは連続専用項目が not_applicable', () => {
    const studies = [makeStudy({ studyId: 'study-1' })];
    const resultsRows = [
      row({ resultId: 'r-1', entityKey: 'outcome:mortality|arm:1', fieldId: 'f-events', value: '3' }),
      row({ resultId: 'r-2', entityKey: 'outcome:mortality|arm:1', fieldId: 'f-total', value: '30' }),
    ];
    const result = buildMaCsv(studies, resultsRows, [], [], [], [...continuousFields, ...binaryFields]);
    const statusRecords = parseCsv(result.statusCsv);
    // outcome_mean / outcome_sd / outcome_n は not_applicable（連続専用・対岸の二値に実データあり）
    expect(statusRecords[1]?.slice(-5)).toEqual(['not_applicable', 'not_applicable', 'not_applicable', 'verified', 'verified']);
  });

  test('not_applicable: 連続専用項目にのみ実データがあるインスタンスでは二値専用項目が not_applicable', () => {
    const studies = [makeStudy({ studyId: 'study-1' })];
    const resultsRows = [row({ resultId: 'r-1', entityKey: 'outcome:mortality|arm:1', fieldId: 'f-mean', value: '5' })];
    const result = buildMaCsv(studies, resultsRows, [], [], [], [...continuousFields, ...binaryFields]);
    const statusRecords = parseCsv(result.statusCsv);
    expect(statusRecords[1]?.slice(-2)).toEqual(['not_applicable', 'not_applicable']);
  });

  test('どちらのプリセットにも実データが無いインスタンスは no_data のまま', () => {
    const studies = [makeStudy({ studyId: 'study-1' })];
    const decisions = [
      {
        decidedAt: 't',
        decidedBy: 'a@example.com',
        studyId: 'study-1',
        fieldId: ENTITY_INSTANCE_DECLARATION_FIELD_ID,
        entityKey: 'outcome:mortality|arm:1',
        annotator: 'reviewer@example.com',
        annotatorType: 'human_with_ai' as const,
        schemaVersion: 1,
        action: 'edit' as const,
        value: 'outcome:mortality|arm:1',
        note: null,
      },
    ];
    // インスタンス自体は宣言されているが、どの項目にも一切データが無い
    const resultsRows = [row({ resultId: 'r-other', studyId: 'study-1', entityKey: 'outcome:other|arm:1', fieldId: 'f-mean', value: '1' })];
    const result = buildMaCsv(studies, resultsRows, decisions, [], [], [...continuousFields, ...binaryFields]);
    const statusRecords = parseCsv(result.statusCsv);
    const target = statusRecords.find((r) => r[2] === 'mortality');
    expect(target?.slice(-5)).toEqual(['no_data', 'no_data', 'no_data', 'no_data', 'no_data']);
  });

  test('arm セグメントの無い項目は arm 列空欄の行として出す', () => {
    const studies = [makeStudy({ studyId: 'study-1' })];
    const resultsRows = [row({ entityKey: 'outcome:overall_effect', fieldId: 'f-mean', value: '0.8' })];
    const result = buildMaCsv(studies, resultsRows, [], [], [], continuousFields);
    const records = parseCsv(result.csv);
    expect(records[1]?.slice(2, 9)).toEqual(['overall_effect', '', '', '', '', '', '']);
  });

  test('timepoint が規約外の自由記述でも timepoint 列に原文を保持し、value/unit は空にする', () => {
    const studies = [makeStudy({ studyId: 'study-1' })];
    const resultsRows = [row({ entityKey: 'outcome:mortality|arm:1|time:baseline', fieldId: 'f-mean', value: '1' })];
    const result = buildMaCsv(studies, resultsRows, [], [], [], continuousFields);
    const records = parseCsv(result.csv);
    expect(records[1]?.slice(4, 7)).toEqual(['baseline', '', '']);
  });

  test('ソート順: study 内は outcome → timepoint → arm の決定的順序（3 群 + 複数 timepoint）', () => {
    const studies = [makeStudy({ studyId: 'study-1' })];
    const armStructureRows = [
      makeArmStructureRow({ armKey: 'arm:1', armName: 'A群' }),
      makeArmStructureRow({ armKey: 'arm:2', armName: 'B群' }),
      makeArmStructureRow({ armKey: 'arm:3', armName: 'C群' }),
    ];
    const resultsRows = [
      row({ resultId: 'r-1', entityKey: 'outcome:pain|arm:3|time:90d', fieldId: 'f-mean', value: '1' }),
      row({ resultId: 'r-2', entityKey: 'outcome:pain|arm:1|time:90d', fieldId: 'f-mean', value: '2' }),
      row({ resultId: 'r-3', entityKey: 'outcome:pain|arm:2|time:90d', fieldId: 'f-mean', value: '3' }),
      row({ resultId: 'r-4', entityKey: 'outcome:mortality|arm:1|time:30d', fieldId: 'f-mean', value: '4' }),
      row({ resultId: 'r-5', entityKey: 'outcome:pain|arm:1|time:30d', fieldId: 'f-mean', value: '5' }),
    ];
    const result = buildMaCsv(studies, resultsRows, [], [], armStructureRows, continuousFields);
    const records = parseCsv(result.csv);
    const order = records.slice(1).map((r) => [r[2], r[4], r[7]]);
    expect(order).toEqual([
      ['mortality', '30d', '1'],
      ['pain', '30d', '1'],
      ['pain', '90d', '1'],
      ['pain', '90d', '2'],
      ['pain', '90d', '3'],
    ]);
  });

  test('ArmStructures が無い（群未確定）とき、同順位の arm 同士は arm_id の文字列比較で決定的に並ぶ', () => {
    const studies = [makeStudy({ studyId: 'study-1' })];
    const resultsRows = [
      row({ resultId: 'r-1', entityKey: 'outcome:pain|arm:5', fieldId: 'f-mean', value: '1' }),
      row({ resultId: 'r-2', entityKey: 'outcome:pain|arm:2', fieldId: 'f-mean', value: '2' }),
    ];
    // armStructureRows を渡さない（群未確定）ため両 arm とも armRank が同値（MAX_SAFE_INTEGER）でタイになる
    const result = buildMaCsv(studies, resultsRows, [], [], [], continuousFields);
    const records = parseCsv(result.csv);
    expect(records.slice(1).map((r) => r[7])).toEqual(['2', '5']);
  });

  test('ArmStructures に無い arm は末尾へ、arm_label は解決できず空になる', () => {
    const studies = [makeStudy({ studyId: 'study-1' })];
    const armStructureRows = [makeArmStructureRow({ armKey: 'arm:1', armName: 'A群' })];
    const resultsRows = [
      row({ resultId: 'r-1', entityKey: 'outcome:pain|arm:9', fieldId: 'f-mean', value: '1' }),
      row({ resultId: 'r-2', entityKey: 'outcome:pain|arm:1', fieldId: 'f-mean', value: '2' }),
    ];
    const result = buildMaCsv(studies, resultsRows, [], [], armStructureRows, continuousFields);
    const records = parseCsv(result.csv);
    expect(records.slice(1).map((r) => [r[7], r[8]])).toEqual([
      ['1', 'A群'],
      ['9', ''],
    ]);
  });

  test('schema_version はそのインスタンスに実在する ResultsData の最大値。データが無ければ空', () => {
    const studies = [makeStudy({ studyId: 'study-1' })];
    const decisions = [
      {
        decidedAt: 't',
        decidedBy: 'a@example.com',
        studyId: 'study-1',
        fieldId: ENTITY_INSTANCE_DECLARATION_FIELD_ID,
        entityKey: 'outcome:ghost|arm:1',
        annotator: 'reviewer@example.com',
        annotatorType: 'human_with_ai' as const,
        schemaVersion: 1,
        action: 'edit' as const,
        value: 'outcome:ghost|arm:1',
        note: null,
      },
    ];
    const resultsRows = [
      row({ resultId: 'r-1', entityKey: 'outcome:mortality|arm:1', fieldId: 'f-mean', schemaVersion: 2, value: '1' }),
      row({ resultId: 'r-2', entityKey: 'outcome:mortality|arm:1', fieldId: 'f-sd', schemaVersion: 3, value: '2' }),
    ];
    const result = buildMaCsv(studies, resultsRows, decisions, [], [], continuousFields);
    const records = parseCsv(result.csv);
    const mortality = records.find((r) => r[2] === 'mortality');
    const ghost = records.find((r) => r[2] === 'ghost');
    expect(mortality?.[11]).toBe('3'); // 最大値
    expect(ghost?.[11]).toBe(''); // データが無いためインスタンスはあっても schema_version は空
  });
});
