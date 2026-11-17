// アウトカムの一覧の版解決と、削除確認に使う集計のテスト。
import type { Decision } from '../../../../src/domain/decision';
import type { SchemaOutcome } from '../../../../src/domain/schemaOutcome';
import type { SchemaVersion } from '../../../../src/domain/schemaVersion';
import { countJudgedCellsForOutcome, isOutcomeListMode, isValidOutcomeId, isValidOutcomeAlias, suggestOutcomeId, outcomesForVersion, restorableOutcomes, slugifyOutcomeLabel, validateOutcomeRows } from '../../../../src/features/schema/schemaOutcomes';

test('一覧の id と別名は別々の規則で検証する', () => {
  for (const id of ['pain', 'a'.repeat(64)]) {
    expect(isValidOutcomeId(id)).toBe(true);
  }
  for (const id of ['', '6mwt_change', 'a'.repeat(65), 'a-b']) {
    expect(isValidOutcomeId(id)).toBe(false);
  }
  for (const alias of ['6mwt_change', 'A-b', 'a'.repeat(256)]) {
    expect(isValidOutcomeAlias(alias)).toBe(true);
  }
  for (const alias of ['', 'a|b', 'a:b', 'a b', 'a\tb', 'a'.repeat(257)]) {
    expect(isValidOutcomeAlias(alias)).toBe(false);
    expect(validateOutcomeRows([outcome({ aliases: [alias] })], { listModeBefore: false })).toHaveLength(1);
  }
  expect(validateOutcomeRows([outcome({ aliases: ['6mwt_change'] })], { listModeBefore: false })).toEqual([]);
  expect(validateOutcomeRows([outcome({ aliases: ['mortality'] })], { listModeBefore: false })).toHaveLength(1);
});

test('元のキーを正規化し、長さと衝突を考慮した id を提案する', () => {
  expect(suggestOutcomeId('6mwt_change', [])).toBe('outcome_6mwt_change');
  expect(suggestOutcomeId(' 6MWT change! ', [])).toBe('outcome_6mwt_change');
  expect(suggestOutcomeId('a___b', [])).toBe('a_b');
  expect(suggestOutcomeId('_', [])).toBe('outcome');
  expect(suggestOutcomeId('', [])).toBe('outcome');
  expect(suggestOutcomeId('pain', ['pain', 'pain_2'])).toBe('pain_3');
  expect(suggestOutcomeId('6mwt_change', ['outcome_6mwt_change'])).toBe('outcome_6mwt_change_2');
  expect(suggestOutcomeId('a'.repeat(70), [])).toBe('a'.repeat(64));
  expect(suggestOutcomeId('a'.repeat(70), ['a'.repeat(64)])).toBe('a'.repeat(62) + '_2');
});

const outcome = (patch: Partial<SchemaOutcome> = {}): SchemaOutcome => ({
  schemaVersion: 1, aliases: [], outcomeIndex: 1, outcomeId: 'mortality', outcomeLabel: '全死亡',
  description: null, typicalTimepoints: null, addedVia: 'schema_editor', note: null, ...patch,
});
const versions = [4, 3, 2, 1].map((schemaVersion) => ({ schemaVersion } as SchemaVersion));
const decision = (patch: Partial<Decision> = {}): Decision => ({
  studyId: 's1', annotator: 'a', annotatorType: 'human_with_ai', fieldId: 'f1',
  entityKey: 'outcome:mortality|arm:1', action: 'accept', value: '1', note: null,
  schemaVersion: 1, decidedAt: '2026-11-16T00:00:00Z', decidedBy: 'a', ...patch,
});

test('指定版を優先し、欠けた版だけ直近の前版の一覧を順序つきで読む', () => {
  const first = outcome();
  const second = outcome({ schemaVersion: 2, aliases: [], outcomeIndex: 2, outcomeLabel: '変更後' });
  const head = outcome({ schemaVersion: 2, aliases: [], outcomeIndex: 1, outcomeId: 'pain' });
  const all = [second, first, head];
  expect(outcomesForVersion(all, versions, 2)).toEqual({ outcomes: [head, second], sourceVersion: 2 });
  expect(outcomesForVersion(all, versions, 4)).toEqual({ outcomes: [head, second], sourceVersion: 2 });
  expect(outcomesForVersion(all, versions, 0)).toEqual({ outcomes: [], sourceVersion: null });
  expect(outcomesForVersion([], [], 1)).toEqual({ outcomes: [], sourceVersion: null });
  expect(isOutcomeListMode([])).toBe(false);
  expect(isOutcomeListMode(all)).toBe(true);
});

test('復元候補は編集中に無い id ごとの最終版の行', () => {
  const old = outcome();
  const latest = outcome({ schemaVersion: 3, outcomeLabel: '新名称', aliases: ['old_mortality'] });
  const pain = outcome({ outcomeId: 'pain' });
  expect(restorableOutcomes([latest, old, pain, latest], ['pain'])).toEqual([latest]);
});

test('別名のセルと RoB を合流し、重複と移行後の undo を読み替えと同じ規則で数える', () => {
  const decisions = [
    decision(), decision({ entityKey: 'outcome:old|arm:1' }),
    decision({ entityKey: 'rob:domain_1|outcome:old|arm:1' }),
    decision({ entityKey: 'outcome:old|arm:2' }),
    decision({ entityKey: 'outcome:mortality|arm:2', action: 'edit', decidedAt: '2026-11-17T00:00:00Z' }),
    decision({ entityKey: 'outcome:mortality|arm:2', action: 'undo', decidedAt: '2026-11-17T00:00:01Z' }),
  ];
  expect(countJudgedCellsForOutcome(decisions, 'mortality', ['old'], new Map([
    ['old', '2026-11-16T12:00:00Z'],
  ]))).toEqual({ cells: 3, studies: 1 });
});

test('表示名から id を作り、使えない名称や重複には outcome の連番を使う', () => {
  expect(slugifyOutcomeLabel(' All-cause Mortality! ', [])).toBe('all_cause_mortality');
  expect(slugifyOutcomeLabel('全死亡', ['outcome_2', 'outcome_8', 'custom'])).toBe('outcome_9');
  expect(slugifyOutcomeLabel('Pain', ['pain'])).toBe('outcome_1');
  expect(slugifyOutcomeLabel('30 days', [])).toBe('outcome_1');
});

test('id の形式・長さ・重複、名称の空欄、一覧モードの空一覧を拒否する', () => {
  expect(validateOutcomeRows([outcome()], { listModeBefore: true })).toEqual([]);
  expect(validateOutcomeRows([], { listModeBefore: false })).toEqual([]);
  expect(validateOutcomeRows([], { listModeBefore: true })[0]?.message).toBe('アウトカムの一覧は 1 件以上必要です（一覧を作った後は空にできません）');
  expect(validateOutcomeRows([
    outcome({ outcomeId: ' bad id ', outcomeLabel: '  ' }), outcome({ outcomeId: 'x'.repeat(65) }),
    outcome(), outcome({ outcomeId: ' mortality ' }),
  ], { listModeBefore: false })).toHaveLength(4);
});

test('undo・宣言・相談・別アウトカムを除き、annotator ごとにセルと論文を数える', () => {
  expect(countJudgedCellsForOutcome([
    decision(), decision({ action: 'edit' }),
    decision({ action: 'undo', decidedAt: '2026-11-16T00:00:01Z' }),
    decision({ annotator: 'b' }),
    decision({ studyId: 's2', entityKey: 'rob:domain_1|outcome:mortality|arm:1|time:30d' }),
    decision({ entityKey: 'outcome:pain' }),
    decision({ entityKey: 'rob:domain_1' }),
    decision({ entityKey: 'bad' }),
    decision({ entityKey: 'arm:1' }),
    decision({ entityKey: 'outcome:mortality|arm:2', action: 'edit' }),
    decision({ entityKey: 'outcome:mortality|arm:2', action: 'undo', decidedAt: '2026-11-16T00:00:02Z' }),
    decision({ fieldId: '__entity_instance__' }),
    decision({ action: 'flag_consult', fieldId: 'consult' }),
  ], 'mortality')).toEqual({ cells: 3, studies: 2 });
  expect(countJudgedCellsForOutcome([], 'mortality')).toEqual({ cells: 0, studies: 0 });
});
