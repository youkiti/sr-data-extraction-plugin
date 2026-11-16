import type { OutcomeListContext } from '../../../../src/features/schema/outcomeListContext';
import { canonicalOutcomeEntityKey, buildOutcomeListContext, isEntityKeyInOutcomeList, isOutcomeListCandidateId } from '../../../../src/features/schema/outcomeListContext';
import { applyOutcomeAliases } from '../../../../src/features/schema/applyOutcomeAliases';
import { buildOutcomeMigrationRows, migrationContext, migrationOutcomes } from '../../../../src/features/schema/outcomeMigration';
import { validateOutcomeRows } from '../../../../src/features/schema/schemaOutcomes';
import { buildTabModel } from '../../../../src/features/verification/cells';
import { makeDecision, makeEvidence, makeField, makeResultsDataRow } from '../export/rset/testHelpers';

const context: OutcomeListContext = { schemaVersion: 1, outcomes: [], currentIds: new Set(['pain', 'old']), everIds: new Set(['pain', 'old']), aliasToId: new Map([['old', 'pain'], ['other', 'pain']]) };
const key = 'outcome:pain|arm:1';
const alias = 'outcome:old|arm:1';

test('別名なしでは入力配列の参照を保つ', () => {
  const input = { evidence: [makeEvidence()], decisions: [], resultsRows: [] };
  expect(applyOutcomeAliases(input, null)).toEqual({ ...input, collisionCount: 0 });
  expect(applyOutcomeAliases(input, { ...context, aliasToId: new Map() }).evidence).toBe(input.evidence);
});

test('アウトカムと estimate 別 RoB だけを読み替え、別名を一覧外の候補にしない', () => {
  expect(canonicalOutcomeEntityKey(alias, context)).toBe(key);
  expect(canonicalOutcomeEntityKey('rob:d|outcome:old|time:30d', context)).toBe('rob:d|outcome:pain|time:30d');
  expect(canonicalOutcomeEntityKey('rob:d', context)).toBe('rob:d');
  expect(canonicalOutcomeEntityKey('-', context)).toBe('-');
  expect(canonicalOutcomeEntityKey(key, null)).toBe(key);
  const rows = migrationContext([{ id: 'pain', label: '痛み', selected: true, target: null, studies: 1, judgedCells: 0 },
    { id: 'old', label: '旧名', selected: true, target: 'pain', studies: 1, judgedCells: 0 }]).outcomes;
  const built = buildOutcomeListContext(rows, [], 0)!;
  expect(isEntityKeyInOutcomeList(alias, built)).toBe(true);
  expect(isOutcomeListCandidateId('old', built)).toBe(false);
});

test.each([[false, false, key], [true, false, key], [false, true, alias], [true, true, key]] as const)(
  '元の id の判定 %s・別名の判定 %s で勝者を選ぶ', (originalJudged, aliasJudged, winner) => {
    const decisions = [makeDecision({ entityKey: key, action: originalJudged ? 'edit' : 'undo', value: '元' }),
      makeDecision({ entityKey: alias, action: aliasJudged ? 'edit' : 'undo', value: '別名' })];
    const resultsRows = [makeResultsDataRow({ entityKey: key, value: '元' }), makeResultsDataRow({ entityKey: alias, value: '別名' })];
    const input = { decisions, resultsRows, evidence: [makeEvidence({ entityKey: alias }), makeEvidence({ entityKey: key })] };
    const result = applyOutcomeAliases(input, context);
    expect(result.resultsRows).toEqual([{ ...resultsRows[winner === key ? 0 : 1]!, entityKey: key }]);
    expect(result.decisions).toEqual([{ ...decisions[winner === key ? 0 : 1]!, entityKey: key }]);
    expect(result.evidence).toEqual([input.evidence[1]]);
    expect(result.collisionCount).toBe(1);
    expect(input.decisions[1]!.entityKey).toBe(alias);
  },
);

test('annotator ごとに勝者が異なり、片側だけの項目と研究は合流する', () => {
  const decisions = [makeDecision({ entityKey: alias, annotator: 'A', value: '別名' }),
    makeDecision({ entityKey: key, annotator: 'A', action: 'undo' }),
    makeDecision({ entityKey: alias, annotator: 'B', action: 'undo' }), makeDecision({ entityKey: key, annotator: 'B', value: '元' })];
  const rows = decisions.map((row) => makeResultsDataRow({ entityKey: row.entityKey, annotator: row.annotator, value: row.value }));
  const result = applyOutcomeAliases({ decisions, resultsRows: rows, evidence: [makeEvidence({ entityKey: alias, fieldId: 'extra' }),
    makeEvidence({ entityKey: key, studyId: 'second' })] }, context);
  expect(result.decisions.map((row) => [row.annotator, row.value])).toEqual([['A', '別名'], ['B', '元']]);
  expect(result.resultsRows).toHaveLength(2);
  expect(result.evidence.map((row) => row.entityKey)).toEqual([key, key]);
  expect(result.collisionCount).toBe(1);
});

test('AI の現在値は人の勝者と独立し、元の id の根拠が無ければ別名の根拠を使う', () => {
  const rows = [makeResultsDataRow({ entityKey: alias, annotator: 'ai', annotatorType: 'ai', value: '別名' }),
    makeResultsDataRow({ entityKey: key, annotator: 'ai', annotatorType: 'ai', value: '元' })];
  const result = applyOutcomeAliases({ resultsRows: rows, evidence: [makeEvidence({ entityKey: alias })] }, context);
  expect(result.resultsRows).toEqual([rows[1]]);
  expect(result.evidence[0]!.entityKey).toBe(key);
  expect(applyOutcomeAliases({}, context)).toEqual({ collisionCount: 0 });
  const human = [makeResultsDataRow({ entityKey: alias }), makeResultsDataRow({ entityKey: key })];
  expect(applyOutcomeAliases({ resultsRows: human }, context).resultsRows).toEqual([human[1]]);
});

test('複数別名の順序に依存せず勝者を選び、宣言を衝突数に入れない', () => {
  const evidence = [makeEvidence({ entityKey: 'outcome:other|arm:1' }), makeEvidence({ entityKey: alias })];
  expect(applyOutcomeAliases({ evidence }, context).evidence).toEqual(applyOutcomeAliases({ evidence: [...evidence].reverse() }, context).evidence);
  expect(applyOutcomeAliases({ decisions: [makeDecision({ entityKey: alias, fieldId: '__entity_instance__' }),
    makeDecision({ entityKey: key, fieldId: '__entity_instance__' })] }, context).collisionCount).toBe(0);
});

test('検証モデルのセルは一覧のキーで判定できる', () => {
  const field = makeField({ entityLevel: 'outcome_result' });
  const model = buildTabModel('outcome_result', [field], [makeEvidence({ entityKey: alias })], [], { outcomeList: context });
  expect(model.cells[0]!.entityKey).toBe(key);
});

test('移行候補は宣言も含み、最多の名前・研究数・判定済みセル数を表示する', () => {
  const evidence = [makeEvidence({ entityKey: alias, value: '痛み' }), makeEvidence({ entityKey: alias, value: '痛み', studyId: 'second' }),
    makeEvidence({ entityKey: alias, value: '別表記' }), makeEvidence({ entityKey: '-', value: '対象外' }), makeEvidence({ entityKey: alias, value: null })];
  const decisions = [makeDecision({ entityKey: key, fieldId: '__entity_instance__' }), makeDecision({ entityKey: alias })];
  const rows = buildOutcomeMigrationRows(evidence, decisions, [makeField({ fieldName: 'outcome_name' })]);
  expect(rows.map((row) => [row.id, row.label, row.studies, row.judgedCells])).toEqual([['old', '痛み', 2, 1], ['pain', 'pain', 1, 0]]);
  rows[0]!.target = 'pain';
  expect(migrationOutcomes(rows)).toEqual([expect.objectContaining({ outcomeId: 'pain', aliases: ['old'], addedVia: 'migration' })]);
  expect(validateOutcomeRows([{ ...migrationOutcomes(rows)[0]!, aliases: ['pain', 'bad id', 'same', 'same'] }], { listModeBefore: false })).toHaveLength(3);
});
