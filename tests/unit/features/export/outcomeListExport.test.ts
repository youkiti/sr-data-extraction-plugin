import type { OutcomeListContext } from '../../../../src/features/schema/outcomeListContext';
import type { DocumentRecord } from '../../../../src/domain/document';
import { buildAllExports } from '../../../../src/features/export/buildExport';
import { buildRSet, countRSetUnverifiedCells } from '../../../../src/features/export/rset/buildRSet';
import { buildMaCsv } from '../../../../src/features/export/rset/buildMaCsv';
import { bundleEvidence } from '../../../../src/features/verification/evidenceBundles';
import { parseCsv } from '../../../../src/features/export/parseCsv';
import { makeArmStructureRow, makeDecision, makeEvidence, makeField, makeResultsDataRow,
  makeStudy, makeStudyDataRow } from './rset/testHelpers';

const outcomeList: OutcomeListContext = {
  schemaVersion: 3,
  currentIds: new Set(['mortality', 'pain']),
  everIds: new Set(['mortality', 'pain', 'removed']),
  outcomes: ['mortality', 'pain'].map((outcomeId, index) => ({ schemaVersion: 3, outcomeIndex: index + 1,
    outcomeId, outcomeLabel: `共通の${outcomeId}`, description: null, typicalTimepoints: null,
    addedVia: 'schema_editor', note: null })),
};
const fields = [makeField({ fieldName: 'outcome_name', entityLevel: 'outcome_result' })];
const keys = ['outcome:mortality|arm:1|time:30d', 'outcome:removed|arm:1', 'outcome:candidate|arm:1'];
const resultsRows = keys.map((entityKey) => makeResultsDataRow({ entityKey, value: '論文の表記' }));
const evidences = keys.map((entityKey, index) => makeEvidence({ entityKey, evidenceId: `ev-${index}` }));
const decisions = keys.map((entityKey) => makeDecision({ entityKey }));
const materials = { studies: [makeStudy()], studyRows: [makeStudyDataRow()], resultsRows, evidences, decisions,
  fields, armStructureRows: [makeArmStructureRow()], documents: [], quoteSetRows: [], runs: [],
  bundlesByStudy: new Map([['study-1', bundleEvidence(evidences)]]), documentStudyIds: [], outcomeList };
const meta = { exportedAt: '2026-11-16T00:00:00Z', appVersion: 'test', reviewMode: 'single_with_ai' };

test('一覧外のキーを除き、共通表示名と時点と追加した空セルを出す', () => {
  const built = buildRSet(materials, meta);
  const ma = built.files.find((file) => file.name === 'ma.csv')!;
  const records = parseCsv(ma.content);
  expect(records.slice(1).map((row) => [row[2], row[3], row[4], row[12]])).toEqual([
    ['mortality', '共通のmortality', '30d', '論文の表記'], ['pain', '共通のpain', '', ''],
  ]);
  expect(countRSetUnverifiedCells(built)).toBe(1);
  expect(built.issues.map((issue) => issue.entityKey)).toEqual(['outcome:pain|arm:1']);
  expect(built.manifest.outcome_list_schema_version).toBe(3);
  const classic = buildAllExports({ ...materials, documents: [{ studyId: 'study-1' } as DocumentRecord] });
  for (const format of ['results_long', 'evidence_quotes'] as const) {
    expect(classic[format].csv).not.toContain('outcome:removed');
    expect(classic[format].csv).not.toContain('outcome:candidate');
  }
  expect(classic.audit.csv).toContain('outcome:removed');
  expect(classic.audit.csv).toContain('outcome:candidate');
  expect(Object.values(classic).map((item) => item.unverifiedCellCount)).toEqual([0, null, 0, 0]);
});

test('論文単位モードは省略と null で同一の出力になり、一覧の版を出さない', () => {
  const { outcomeList: omitted, ...legacy } = materials;
  expect(omitted).toBe(outcomeList);
  expect(buildRSet(legacy, meta)).toEqual(buildRSet({ ...legacy, outcomeList: null }, meta));
  expect(buildAllExports(legacy)).toEqual(buildAllExports({ ...legacy, outcomeList: null }));
  expect(buildRSet(legacy, meta).manifest).not.toHaveProperty('outcome_list_schema_version');
});

test('ResultsData が無くても study の確定者と確定群から一覧の空セルを作る', () => {
  const built = buildRSet({ ...materials, resultsRows: [], evidences: [], decisions: [] }, meta);
  expect(countRSetUnverifiedCells(built)).toBe(2);
  expect(buildMaCsv(materials.studies, [], [], [], [], fields, outcomeList).rowCount).toBe(0);
  expect(buildAllExports(materials).results_long.unverifiedCellCount).toBeNull();
});

test('従来形式の未検証件数は各形式の素材と数え方に従う', () => {
  const classic = buildAllExports({ ...materials, decisions: [], fields: [...fields,
    makeField({ fieldId: 'study-field', fieldName: 'study_field' })] });
  expect(classic.study_wide.unverifiedCellCount).toBe(1);
  expect(classic.results_long.unverifiedCellCount).toBeNull();
  expect(classic.evidence_quotes.unverifiedCellCount).toBe(1);
  expect(classic.audit.unverifiedCellCount).toBe(3);
});

test('AI のキーがあるインスタンスの根拠のない項目は no_data、一覧だけの空インスタンスは未検証にする', () => {
  const built = buildRSet({ ...materials, resultsRows: [], decisions: [], evidences: [evidences[0]!],
    fields: [...fields, makeField({ fieldId: 'f-2', fieldName: 'extra', fieldIndex: 2, entityLevel: 'outcome_result' })] }, meta);
  const status = parseCsv(built.files.find((file) => file.name === 'ma_status.csv')!.content);
  expect(status.slice(1).map((row) => row.slice(12))).toEqual([
    ['unverified', 'no_data'], ['unverified', 'unverified'],
  ]);
  expect(countRSetUnverifiedCells(built)).toBe(3);
  expect(built.issues.map((issue) => issue.detail)).toEqual([
    'ma.csv: outcome_name は AI 抽出のみで人間の判定が 0 件です',
    'ma.csv: outcome_name は人間の判定が 0 件です',
    'ma.csv: extra は人間の判定が 0 件です',
  ]);
});

test.each(['evidence', 'decision', 'result'] as const)('%s だけでもアウトカムが存在すれば空インスタンス扱いしない', (source) => {
  const entityKey = 'outcome:pain|arm:1';
  const built = buildRSet({ ...materials,
    evidences: source === 'evidence' ? [makeEvidence({ entityKey, fieldId: 'other' })] : [],
    decisions: source === 'decision' ? [makeDecision({ entityKey, fieldId: 'other' })] : [],
    resultsRows: source === 'result' ? [makeResultsDataRow({ entityKey, annotator: 'ai', annotatorType: 'ai' })] : [],
  }, meta);
  const status = parseCsv(built.files.find((file) => file.name === 'ma_status.csv')!.content);
  expect(status.find((row) => row[2] === 'pain')![12]).toBe('no_data');
  expect(built.issues.filter((issue) => issue.issueType === 'unverified_cell').map((issue) => issue.entityKey))
    .toEqual(['outcome:mortality|arm:1']);
});

test('外したアウトカムの estimate 別 RoB と不明項目の issue を出さない', () => {
  const outside = makeResultsDataRow({ entityKey: 'rob:overall|outcome:removed|arm:1', fieldId: 'unknown' });
  const built = buildRSet({ ...materials, resultsRows: [...resultsRows, outside] }, meta);
  expect(built.issues.some((issue) => issue.entityKey.includes('removed'))).toBe(false);
  expect(built.files.find((file) => file.name === 'rob.csv')!.content).not.toContain('removed');
});
