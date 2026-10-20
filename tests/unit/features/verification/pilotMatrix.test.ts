import { buildPilotMatrix, comparePilotRows, previousPilotDecisions, sortPilotMatrix } from '../../../../src/features/verification/pilotMatrix';
import { makeDecision, makeEvidence, makeField, makeRun } from './pilotMatrixFixtures';

// 外れと割合の分母は判定済みだけで数える（issue #381）。未判定（未判定のアンカリング失敗を含む）は
// 未判定の論文に数え、外れの候補（miss）としては残す
test.each([
  ['accept', [makeEvidence({ anchorStatus: 'failed' })], [makeDecision()], 0, 1],
  ['edit', [makeEvidence()], [makeDecision({ action: 'edit' })], 1, 1],
  ['reject', [makeEvidence()], [makeDecision({ action: 'reject' })], 1, 1],
  ['nrAccepted', [makeEvidence({ notReported: true })], [makeDecision({ action: 'not_reported' })], 0, 1],
  ['nrMiss', [makeEvidence()], [makeDecision({ action: 'not_reported' })], 1, 1],
  ['nr', [makeEvidence({ notReported: true, anchorStatus: 'failed' })], [], 0, 0],
  ['failed', [makeEvidence({ anchorStatus: 'failed' })], [], 0, 0],
  ['unverified', [makeEvidence()], [], 0, 0],
  ['empty', [], [makeDecision({ action: 'edit' })], 0, 0],
] as const)('%s の状態と集計', (status, evidence, decisions, misses, judgedStudies) => {
  const row = buildPilotMatrix(['study-1'], [makeField()], evidence, decisions)[0]!;
  expect(row.cells[0]!.status).toBe(status);
  expect(row.misses).toBe(misses);
  expect(row.missedStudies).toBe(misses);
  expect(row.extractedStudies).toBe(status === 'empty' ? 0 : 1);
  expect(row.judgedStudies).toBe(judgedStudies);
  expect(row.pendingStudies).toBe(row.extractedStudies - judgedStudies);
  expect(row.cells[0]!.entities[0]?.miss ?? false).toBe(misses === 1 || status === 'failed');
});

test('undo は最新判定を取り消し、残った判定または未判定へ戻す', () => {
  const decisions = [makeDecision({ action: 'reject', decidedAt: '1' }), makeDecision({ action: 'edit', decidedAt: '2' }), makeDecision({ action: 'undo', decidedAt: '3' })];
  expect(buildPilotMatrix(['study-1'], [makeField()], [makeEvidence()], decisions)[0]!.cells[0]!.status).toBe('reject');
  decisions.push(makeDecision({ action: 'undo', decidedAt: '4' }));
  expect(buildPilotMatrix(['study-1'], [makeField()], [makeEvidence()], decisions)[0]!.cells[0]!.status).toBe('unverified');
});

test('複数引用は全引用失敗だけを外れの候補とし、entity は重複計上しない', () => {
  const evidence = [makeEvidence({ quoteSeq: 1, anchorStatus: 'failed' }), makeEvidence({ quoteSeq: 2, anchorStatus: 'exact' })];
  const build = () => buildPilotMatrix(['study-1'], [makeField({ maxQuotes: 2 })], evidence, [])[0]!;
  expect(build().cells[0]!.status).toBe('unverified');
  evidence[1]!.anchorStatus = 'failed';
  expect(build().cells[0]!.status).toBe('failed');
  expect(build().cells[0]!.entities[0]!.miss).toBe(true);
  // 未判定のため外れの数・分母には入れない
  expect([build().misses, build().judgedStudies, build().pendingStudies]).toEqual([0, 0, 1]);
  expect(build().cells[0]!.entities).toHaveLength(1);
});

test('断片のセルも entity と抽出文献を重複計上しない', () => {
  const evidence = [
    makeEvidence({ quoteSeq: 1, quote: 'Age, M (SD)', value: '46.53' }),
    makeEvidence({ quoteSeq: 2, quote: '46.53 (6.31)', value: '46.53', page: 5, anchorStatus: 'fuzzy' }),
  ];
  const row = buildPilotMatrix(['study-1'], [makeField({ maxQuotes: null })], evidence, [])[0]!;
  expect(row.cells[0]!.entities).toHaveLength(1);
  expect(row.cells[0]!.status).toBe('unverified');
  expect(row.extractedStudies).toBe(1);
  expect(row.misses).toBe(0);
});

test.each(['arm', 'outcome_result', 'rob_domain'] as const)('%s の複数 entity と論文分母を区別する', (entityLevel) => {
  const evidence = Array.from({ length: 5 }, (_, i) => makeEvidence({ entityKey: `entity-${i}` }));
  const decisions = [0, 1].map((i) => makeDecision({ entityKey: `entity-${i}`, action: 'edit' }));
  evidence.push(makeEvidence({ studyId: 'study-2' }));
  const row = buildPilotMatrix(['study-1', 'study-2', 'study-3'], [makeField({ entityLevel })], evidence, decisions)[0]!;
  expect(row.cells[0]!.misses).toBe(2);
  expect(row.cells[0]!.entities).toHaveLength(5);
  expect([row.cells[0]!.judged, row.cells[0]!.pending]).toEqual([2, 3]);
  // study-1 は外れがあるため分母に入る。study-2 は未判定だけのため未判定の論文に数える
  expect([row.misses, row.missedStudies, row.judgedStudies, row.pendingStudies, row.extractedStudies])
    .toEqual([2, 1, 1, 1, 2]);
});

test('外れのない entity は全部判定したときだけ分母に入る', () => {
  const evidence = [makeEvidence({ entityKey: 'arm:1' }), makeEvidence({ entityKey: 'arm:2' })];
  const one = [makeDecision({ entityKey: 'arm:1' })];
  const build = (decisions: typeof one) =>
    buildPilotMatrix(['study-1'], [makeField({ entityLevel: 'arm' })], evidence, decisions)[0]!;
  expect([build(one).judgedStudies, build(one).pendingStudies]).toEqual([0, 1]);
  const both = [...one, makeDecision({ entityKey: 'arm:2' })];
  expect([build(both).judgedStudies, build(both).pendingStudies]).toEqual([1, 0]);
});

test('割合 → 外れ数 → fieldIndex でソートし、入力を変えない', () => {
  const base = buildPilotMatrix(['study-1'], [makeField()], [makeEvidence()], [makeDecision()])[0]!;
  const row = (index: number, missedStudies: number, judgedStudies: number, misses: number) => ({ ...base, field: makeField({ fieldIndex: index }), missedStudies, judgedStudies, misses });
  const rows = [row(5, 0, 0, 0), row(3, 1, 2, 2), row(2, 1, 2, 3), row(1, 1, 2, 3), row(4, 1, 1, 1)];
  expect(sortPilotMatrix(rows).map((item) => item.field.fieldIndex)).toEqual([4, 1, 2, 3, 5]);
  expect(rows[0]!.field.fieldIndex).toBe(5);
  expect(sortPilotMatrix([row(2, 0, 0, 0), row(1, 0, 0, 0)]).map((item) => item.field.fieldIndex)).toEqual([1, 2]);
});

test('比較は割合と判定の有無で区別する', () => {
  const row = buildPilotMatrix(['study-1'], [makeField()], [makeEvidence()], [makeDecision()])[0]!;
  expect(comparePilotRows(row)).toBe('unavailable');
  expect(comparePilotRows(row, { ...row, judgedStudies: 0 })).toBe('unavailable');
  expect(comparePilotRows({ ...row, judgedStudies: 0 }, row)).toBe('unavailable');
  expect(comparePilotRows(row, row)).toBe('unchanged');
  expect(comparePilotRows(row, { ...row, missedStudies: 1 })).toBe('improved');
  expect(comparePilotRows({ ...row, missedStudies: 1 }, row)).toBe('worsened');
  expect(buildPilotMatrix([], [], [], [])).toEqual([]);
});

test('同じ版・study の再実行後の判定を前回へ混ぜない', () => {
  const old = makeDecision({ action: 'edit', decidedAt: 't1' });
  const now = makeDecision({ action: 'accept', decidedAt: 't3' });
  const current = makeRun({ startedAt: 't2' });
  const previous = makeRun({ runId: 'previous', startedAt: 't0' });
  const before = previousPilotDecisions(current, previous, [old, now, makeDecision({ schemaVersion: 2 })]);
  expect(before).toEqual([old]);
  const row = (decisions: typeof before) => buildPilotMatrix(['study-1'], [makeField()], [makeEvidence()], decisions)[0]!;
  expect(comparePilotRows(row([old, now]), row(before))).toBe('improved');
  expect(previousPilotDecisions({ ...current, startedAt: null }, previous, [old])).toEqual([]);
  expect(previousPilotDecisions({ ...current, schemaVersion: 2 }, previous, [old, now])).toEqual([old, now]);
  expect(previousPilotDecisions({ ...current, studyIds: ['other'] }, previous, [old, now])).toEqual([old, now]);
});
