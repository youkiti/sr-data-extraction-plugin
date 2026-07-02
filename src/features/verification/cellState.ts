// 判定履歴（Decisions）の畳み込みによるセル現在状態の導出。
// セル = document × field_id × entity_key ×（自分の）annotator。
// - 非 undo の判定はスタックへ積み、undo は 1 件取り消す（tiab-review の「直近履歴を
//   戻る」を項目単位に読み替えた仕様。ui-flow.md §3）
// - スタックが空 = 未検証（human 行は空セルから開始する。requirements.md §4.2）
import type { Decision, DecisionAction } from '../../domain/decision';

/** 未検証を含むセル状態のステータス（判定チップの表示値） */
export type CellStatus = 'unverified' | Exclude<DecisionAction, 'undo'>;

export interface CellState {
  status: CellStatus;
  /** 現在の annotator 行の値（NOT_REPORTED_TOKEN を含む。未検証は null = 空セル） */
  value: string | null;
  /** undo で戻せる判定のスタック（末尾 = 最新の有効判定） */
  stack: Decision[];
}

/** セルの同定キー。値に任意文字が使えるため区切り文字ではなく JSON 配列でキー化する */
export function cellKeyOf(fieldId: string, entityKey: string): string {
  return JSON.stringify([fieldId, entityKey]);
}

export function emptyCellState(): CellState {
  return { status: 'unverified', value: null, stack: [] };
}

function stateOfStack(stack: Decision[]): CellState {
  const top = stack[stack.length - 1];
  if (top === undefined) {
    return { status: 'unverified', value: null, stack };
  }
  // 非 undo のみ積むため top.action は 'undo' にならない
  return { status: top.action as CellStatus, value: top.value, stack };
}

/**
 * 判定履歴からセルごとの現在状態を導出する。
 * decided_at 昇順で畳み込む（読み出しはシート行順のため、ここでソートを保証する）
 */
export function deriveCellStates(decisions: readonly Decision[]): Map<string, CellState> {
  const sorted = decisions
    .slice()
    .sort((a, b) => a.decidedAt.localeCompare(b.decidedAt));
  const stacks = new Map<string, Decision[]>();
  for (const decision of sorted) {
    const key = cellKeyOf(decision.fieldId, decision.entityKey);
    const stack = stacks.get(key) ?? [];
    if (decision.action === 'undo') {
      stack.pop();
    } else {
      stack.push(decision);
    }
    stacks.set(key, stack);
  }
  const states = new Map<string, CellState>();
  for (const [key, stack] of stacks) {
    states.set(key, stateOfStack(stack));
  }
  return states;
}

/**
 * undo 判定行に書く「操作後の値」= 1 件取り消した後にセルへ残る値。
 * スタックが 1 件以下なら未検証（空セル = null）へ戻る
 */
export function undoRevertValue(state: CellState): string | null {
  const previous = state.stack[state.stack.length - 2];
  return previous === undefined ? null : previous.value;
}
