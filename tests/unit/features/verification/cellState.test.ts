import type { Decision } from '../../../../src/domain/decision';
import {
  cellKeyOf,
  deriveCellStates,
  emptyCellState,
  undoRevertValue,
} from '../../../../src/features/verification/cellState';

function makeDecision(overrides: Partial<Decision> = {}): Decision {
  return {
    decidedAt: '2026-07-02T10:00:00Z',
    decidedBy: 'me@example.com',
    studyId: 'study-1',
    fieldId: 'f-1',
    entityKey: '-',
    annotator: 'me@example.com',
    annotatorType: 'human_with_ai',
    schemaVersion: 1,
    action: 'accept',
    value: '120',
    note: null,
    ...overrides,
  };
}

describe('cellKeyOf', () => {
  test('fieldId と entityKey を JSON 配列でキー化する（区切り文字の衝突なし）', () => {
    expect(cellKeyOf('f-1', 'arm:1')).toBe('["f-1","arm:1"]');
  });
});

describe('emptyCellState', () => {
  test('未検証（空セル）を返す', () => {
    expect(emptyCellState()).toEqual({ status: 'unverified', value: null, stack: [] });
  });
});

describe('deriveCellStates', () => {
  test('最後の判定がセルの現在状態になる', () => {
    const states = deriveCellStates([
      makeDecision({ decidedAt: 't1', action: 'accept', value: '120' }),
      makeDecision({ decidedAt: 't2', action: 'edit', value: '150' }),
    ]);
    const state = states.get(cellKeyOf('f-1', '-'));
    expect(state).toMatchObject({ status: 'edit', value: '150' });
    expect(state?.stack).toHaveLength(2);
  });

  test('decided_at 昇順に畳み込む（入力順に依存しない）', () => {
    const states = deriveCellStates([
      makeDecision({ decidedAt: 't2', action: 'edit', value: '150' }),
      makeDecision({ decidedAt: 't1', action: 'accept', value: '120' }),
    ]);
    expect(states.get(cellKeyOf('f-1', '-'))).toMatchObject({ status: 'edit', value: '150' });
  });

  test('undo は直前の判定を 1 件取り消す', () => {
    const states = deriveCellStates([
      makeDecision({ decidedAt: 't1', action: 'accept', value: '120' }),
      makeDecision({ decidedAt: 't2', action: 'edit', value: '150' }),
      makeDecision({ decidedAt: 't3', action: 'undo', value: '120' }),
    ]);
    expect(states.get(cellKeyOf('f-1', '-'))).toMatchObject({ status: 'accept', value: '120' });
  });

  test('全判定を undo すると未検証（空セル）へ戻る', () => {
    const states = deriveCellStates([
      makeDecision({ decidedAt: 't1', action: 'not_reported', value: 'NR' }),
      makeDecision({ decidedAt: 't2', action: 'undo', value: null }),
    ]);
    expect(states.get(cellKeyOf('f-1', '-'))).toEqual({
      status: 'unverified',
      value: null,
      stack: [],
    });
  });

  test('セル（fieldId × entityKey）ごとに独立して畳み込む', () => {
    const states = deriveCellStates([
      makeDecision({ decidedAt: 't1', fieldId: 'f-1', action: 'accept', value: '120' }),
      makeDecision({ decidedAt: 't2', fieldId: 'f-2', entityKey: 'arm:1', action: 'reject', value: null }),
    ]);
    expect(states.get(cellKeyOf('f-1', '-'))).toMatchObject({ status: 'accept' });
    expect(states.get(cellKeyOf('f-2', 'arm:1'))).toMatchObject({ status: 'reject', value: null });
  });
});

describe('undoRevertValue', () => {
  test('判定が 2 件以上あれば 1 つ前の値へ戻る', () => {
    const states = deriveCellStates([
      makeDecision({ decidedAt: 't1', action: 'accept', value: '120' }),
      makeDecision({ decidedAt: 't2', action: 'edit', value: '150' }),
    ]);
    const state = states.get(cellKeyOf('f-1', '-'));
    expect(state && undoRevertValue(state)).toBe('120');
  });

  test('判定が 1 件だけなら未検証（null = 空セル）へ戻る', () => {
    const states = deriveCellStates([makeDecision({ decidedAt: 't1' })]);
    const state = states.get(cellKeyOf('f-1', '-'));
    expect(state && undoRevertValue(state)).toBeNull();
  });
});
