import { evidence } from './quoteSetFixtures';
import type { SchemaField } from '../../../../src/domain/schemaField';
import type { SchemaOutcome } from '../../../../src/domain/schemaOutcome';
import type { Decision } from '../../../../src/domain/decision';
import type { ResultsDataRow } from '../../../../src/domain/annotation';
import { buildTabModel } from '../../../../src/features/verification/cells';
import { buildFocusUnits, unitProgress } from '../../../../src/features/verification/focusUnits';
import { verificationProgress } from '../../../../src/features/verification/progress';
import { buildDashboard } from '../../../../src/features/verification/dashboard';
import { buildPilotMatrix } from '../../../../src/features/verification/pilotMatrix';
import { computeStudyGate } from '../../../../src/features/adjudication/gate';
import { buildAdjudicationCells } from '../../../../src/features/adjudication/cellMatch';
import type { OutcomeListContext } from '../../../../src/features/schema/outcomeListContext';

const field = { fieldId: 'field', fieldName: 'outcome_name', fieldIndex: 1, section: 'Results', entityLevel: 'outcome_result', dataType: 'text' } as SchemaField;
const outcomeList: OutcomeListContext = {
  schemaVersion: 2,
  outcomes: ['pain', 'new_outcome'].map((outcomeId) => ({ outcomeId } as SchemaOutcome)),
  currentIds: new Set(['pain', 'new_outcome']),
  everIds: new Set(['pain', 'new_outcome', 'removed']),
};
const armStructure = { version: 1, arms: [{ armKey: 'arm:1', armName: 'A' }] };
const ai = ['pain', 'removed', 'candidate'].map((id) => evidence({ entityKey: `outcome:${id}|arm:1` }));

test('進捗・ダッシュボード・フォーカス表示は同じ一覧の空セルを分母にする', () => {
  const options = { outcomeList, armStructure };
  expect(verificationProgress([field], ai, [], options).total).toBe(2);
  const model = buildTabModel('outcome_result', [field], ai, [], options);
  const units = buildFocusUnits('outcome_result', model, { armStructure });
  expect(units.flatMap((unit) => unit.columns).map((column) => column.entityKey)).toEqual(['outcome:new_outcome|arm:1', 'outcome:pain|arm:1']);
  expect(units.reduce((total, unit) => total + unitProgress(unit).total, 0)).toBe(2);
  const dashboard = buildDashboard([{ studyId: 'study', studyLabel: 'study', fields: [field], evidence: ai, ownDecisions: [], ...options }], new Map());
  expect(dashboard.rows[0]?.progress.total).toBe(2);
});

test('パイロット行列は一覧外の抽出を判定件数へ含めない', () => {
  const rows = buildPilotMatrix(['study'], [field], ai, [], outcomeList);
  expect(rows[0]?.cells[0]?.entities.map((item) => item.evidence.entityKey)).toEqual(['outcome:pain|arm:1']);
});

test('一覧へ追加した未抽出アウトカムが残る間は裁定を開始できない', () => {
  const decisions = ['A', 'B'].map((annotator) => ({
    studyId: 'study', annotator, annotatorType: 'human_with_ai', fieldId: 'field',
    entityKey: 'outcome:pain|arm:1', action: 'accept', value: 'value', decidedAt: 'time',
  } as Decision));
  const gate = computeStudyGate('A', 'B', [field], decisions, armStructure, armStructure, ai, outcomeList);
  expect(gate.progressA).toMatchObject({ decided: 1, total: 2 });
  expect(gate.ready).toBe(false);
});

test('裁定の突き合わせでは base RoB を残し、一覧外の outcome と estimate 別 RoB を除く', () => {
  const fields = [field, { ...field, fieldId: 'rob', entityLevel: 'rob_domain' } as SchemaField];
  const keys = ['outcome:pain|arm:1', 'outcome:removed|arm:1', 'rob:d', 'rob:d|outcome:pain', 'rob:d|outcome:removed'];
  const rows = keys.map((entityKey) => ({ entityKey, fieldId: entityKey.startsWith('rob:') ? 'rob' : 'field', value: 'value', schemaVersion: 1 } as ResultsDataRow));
  expect(buildAdjudicationCells(fields, null, null, rows, rows, [], [], outcomeList).map((cell) => cell.entityKey)).toEqual([
    'outcome:pain|arm:1', 'rob:d', 'rob:d|outcome:pain',
  ]);
});
