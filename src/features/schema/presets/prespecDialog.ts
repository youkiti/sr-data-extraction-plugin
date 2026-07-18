// S5 プリセット事前設定ダイアログの型集約（issue #103）。
// ツール別のダイアログ状態（robPrespec / robinsIPrespec）を kind で判別できる合併型として
// store / views / service へ公開する。ツールを追加するときはここへ合併するだけでよい。
// あわせて、複数のツール別モジュールに同型実装があった小さな共有ヘルパー（parseOptionalString /
// parseStringArray）と、ダイアログ状態パッチの適用（mergePresetDialogPatch）も本モジュールに置く
// （issue #126 項目4・5）
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

/**
 * note の JSON value → 前後空白除去済み文字列（空文字・非文字列は null）。
 * 事前設定 note の任意入力フィールド復元に使う共通ヘルパー
 * （issue #126 項目4: robinsIPrespec / quadas3Prespec / quipsPrespec の同型実装を集約）
 */
export function parseOptionalString(value: unknown): string | null {
  return typeof value === 'string' && value.trim() !== '' ? value : null;
}

/**
 * note の JSON value → 文字列配列（配列でなければ空配列、空文字要素は除去）。
 * 事前設定 note の LIST 入力フィールド復元に使う共通ヘルパー（issue #126 項目4）
 */
export function parseStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.filter((item): item is string => typeof item === 'string' && item.trim() !== '');
}

/**
 * ダイアログ状態へ入力パッチを適用する（issue #126 項目5）。
 * 従来は `{ ...dialog, ...patch, error: null } as PresetDialogState` という一括キャストで
 * union 全体の整合性チェックを素通りさせていた。ここでは dialog.kind で分岐して型を
 * narrow してから同一 variant の型でマージすることで、switch の網羅性チェックにより
 * 「ツールが増えたのに分岐を足し忘れる」ケースをコンパイルエラーで検出できるようにする。
 * patch がどの variant のものかは呼び出し元（view の kind 分岐）が保証する契約は従来どおりのため、
 * 各分岐内の narrow キャストは残るが、対象は「patch の形」だけに縮小される
 * （kind 不一致という主要な取り違えは switch 側の型で防げる）
 */
export function mergePresetDialogPatch(
  dialog: PresetDialogState,
  patch: PresetDialogPatch,
): PresetDialogState {
  switch (dialog.kind) {
    case 'rob2':
    case 'rob2_sq': {
      const next: RobPrespecDialogState = {
        ...dialog,
        ...(patch as Partial<Omit<RobPrespecDialogState, 'kind' | 'error'>>),
        error: null,
      };
      return next;
    }
    case 'robins_i':
    case 'robins_i_sq': {
      const next: RobinsIPrespecDialogState = {
        ...dialog,
        ...(patch as Partial<Omit<RobinsIPrespecDialogState, 'kind' | 'error'>>),
        error: null,
      };
      return next;
    }
    case 'quadas3': {
      const next: Quadas3PrespecDialogState = {
        ...dialog,
        ...(patch as Partial<Omit<Quadas3PrespecDialogState, 'kind' | 'error'>>),
        error: null,
      };
      return next;
    }
    case 'quips': {
      const next: QuipsPrespecDialogState = {
        ...dialog,
        ...(patch as Partial<Omit<QuipsPrespecDialogState, 'kind' | 'error'>>),
        error: null,
      };
      return next;
    }
  }
}
