// S5 プリセット事前設定ダイアログの型集約（issue #103）。
// ツール別のダイアログ状態（robPrespec / robinsIPrespec）を kind で判別できる合併型として
// store / views / service へ公開する。ツールを追加するときはここへ合併するだけでよい
import type { Quadas3PrespecDialogState } from './quadas3Prespec';
import type { QuipsPrespecDialogState } from './quipsPrespec';
import type { RobPrespecDialogState } from './robPrespec';
import type { RobinsIPrespecDialogState } from './robinsIPrespec';

/** 全ツールのダイアログ状態の合併型（kind で判別する） */
export type PresetDialogState =
  | RobPrespecDialogState
  | RobinsIPrespecDialogState
  | Quadas3PrespecDialogState
  | QuipsPrespecDialogState;

/** 入力更新パッチ（kind / error はユーザー操作で更新しない）。
 * どの variant の patch かは view（renderPresetDialog の kind 分岐）が保証する */
export type PresetDialogPatch =
  | Partial<Omit<RobPrespecDialogState, 'kind' | 'error'>>
  | Partial<Omit<RobinsIPrespecDialogState, 'kind' | 'error'>>
  | Partial<Omit<Quadas3PrespecDialogState, 'kind' | 'error'>>
  | Partial<Omit<QuipsPrespecDialogState, 'kind' | 'error'>>;
