// フォーカスモード（issue #38 段階B）: 検証ユニット 1 枚のカード描画（純 render）。
// verificationForm.ts の renderVerificationForm から layoutMode='focus' のときに呼ばれる。
// タブ行・進捗バー・群構成カード・アウトカム追加フォーム・ロック中タブの案内は呼び出し側
// （renderVerificationForm）が共通描画するため、ここではユニット単位の中身だけを描く:
//   1. ユニットヘッダ（位置 + 見出し）
//   2. マトリクス（<table>。行 = フィールド、列 = ユニットの列。セルはボタンでクリックすると
//      onFocusCell）
//   3. プリセット要約行（unit.summary が非 null のときだけ）
//   4. 詳細ストリップ（フォーカス中セル 1 件。verificationCellCard.renderCell をそのまま再利用し、
//      quote・判定操作・編集入力等をコピペ複製しない）
//   5. 直近判定バー（ユニットをまたいでも直近判定セルの undo を固定表示する）
import { NOT_REPORTED_TOKEN } from '../../domain/annotation';
import type { VerificationCell } from '../../features/verification/cells';
import type { FocusUnit, FocusUnitColumn, FocusUnitRow } from '../../features/verification/focusUnits';
import type { RobAlgorithmInfo } from '../../features/verification/robAlgorithm';
import { el } from '../ui/dom';
import {
  renderCell,
  renderStatusChip,
  type CellCardHandlers,
  type CellCardModel,
  type CellHighlightInfo,
} from './verificationCellCard';

/** renderVerificationFocusCard が要求するハンドラ集合（詳細ストリップ・マトリクスの双方で使う） */
export type VerificationFocusCardHandlers = CellCardHandlers;

export interface VerificationFocusCardModel {
  /** 表示中のユニット（verificationPanel が focusedCellKey から解決する） */
  unit: FocusUnit;
  /** タブ内でのユニット位置（1 始まり） */
  unitIndex: number;
  /** タブの全ユニット数 */
  totalUnits: number;
  /** 未判定セルを含む残りユニット数（現在ユニットが未判定を含む場合も数える） */
  remainingUnits: number;
  focusedCellKey: string | null;
  /** 値入力中のセル（edit = AI 値の修正 / reject = 棄却して手入力） */
  editing: { cellKey: string; action: 'edit' | 'reject' } | null;
  highlightInfo: ReadonlyMap<string, CellHighlightInfo>;
  /** テキスト層があるとき true（false なら「本文内を検索」を出さない） */
  canSearchText: boolean;
  /** 直近判定セル（無ければ null）。ユニットをまたいで表示する固定バー用 */
  recentCell: VerificationCell | null;
  /**
   * 検証パネルの入力モード（独立二重レビュー機能。design §5.2）。省略時は 'review'。
   * 詳細ストリップ（renderCell）へそのまま渡す
   */
  mode?: 'review' | 'independent';
  /**
   * 決定論的な数値整合性チェック（issue #65）の警告。cellKey → メッセージ一覧。
   * マトリクスボタンのバッジ（renderMatrixDataCell）と詳細ストリップ（renderCell）の双方へ渡す
   */
  consistencyWarnings: ReadonlyMap<string, string[]>;
  /**
   * RoB 2 signaling question からのアルゴリズム提案（issue #61）。cellKey → 情報。
   * マトリクスボタンの不一致バッジ（renderMatrixDataCell）と詳細ストリップ（renderCell）の
   * 双方へ渡す
   */
  robAlgorithmInfo: ReadonlyMap<string, RobAlgorithmInfo>;
}

/**
 * セルの表示値（判定確定値 > AI 値 > 「—」）。renderAiSummary の表記に合わせ、
 * NOT_REPORTED_TOKEN は「未報告（NR）」に読み替える
 */
function displayValue(cell: VerificationCell): string {
  const raw = cell.state.value ?? (cell.evidence?.notReported ? NOT_REPORTED_TOKEN : cell.evidence?.value) ?? null;
  if (raw === null) {
    return '—';
  }
  if (raw === NOT_REPORTED_TOKEN) {
    return `未報告（${NOT_REPORTED_TOKEN}）`;
  }
  return raw;
}

function renderUnitHeader(model: VerificationFocusCardModel): HTMLElement {
  return el('div', { className: 'focus-card__header' }, [
    el('p', {
      id: 'verify-focus-position',
      className: 'focus-card__position',
      text: `ユニット ${model.unitIndex} / ${model.totalUnits}（残り ${model.remainingUnits}）`,
    }),
    el('h4', { className: 'focus-card__heading', text: model.unit.heading }),
  ]);
}

function renderMatrixDataCell(
  cell: VerificationCell | null,
  column: FocusUnitColumn,
  fieldLabel: string,
  model: VerificationFocusCardModel,
  handlers: VerificationFocusCardHandlers,
): HTMLElement {
  if (cell === null) {
    return el('td', { className: 'focus-card__matrix-cell focus-card__matrix-cell--empty' }, [
      el('span', { text: '—' }),
    ]);
  }
  const value = displayValue(cell);
  const warnings = model.consistencyWarnings.get(cell.cellKey) ?? [];
  const baseLabel = `${fieldLabel} × ${column.label}: ${value}`;
  const trailing: HTMLElement[] = [renderStatusChip(cell.state.status)];
  const attributes: Record<string, string> = { type: 'button', 'aria-label': baseLabel };
  const titleParts: string[] = [];
  if (warnings.length > 0) {
    // 決定論的な数値整合性チェック（issue #65）: バッジ + aria-label / title に警告文を含める
    // （判定操作は増やさない情報提示のみ）
    trailing.push(
      el('span', {
        className: 'verify__consistency-badge',
        attributes: { 'aria-hidden': 'true' },
        text: '⚠',
      }),
    );
    attributes['aria-label'] = `${baseLabel}（整合性チェック警告: ${warnings.join('。')}）`;
    titleParts.push(...warnings);
  }
  const robInfo = model.robAlgorithmInfo.get(cell.cellKey);
  if (robInfo?.mismatch === true) {
    // RoB 2 アルゴリズム提案との不一致（issue #61）: #65 と同じバッジパターンを踏襲する
    trailing.push(
      el('span', {
        className: 'verify__rob-badge',
        attributes: { 'aria-hidden': 'true' },
        text: '⚠',
      }),
    );
    const robMessage = `アルゴリズム提案 (${robInfo.suggestion}) と現在の判定 (${robInfo.currentValue}) が一致しません`;
    attributes['aria-label'] = `${attributes['aria-label']}（RoB アルゴリズム提案との不一致: ${robMessage}）`;
    titleParts.push(robMessage);
  }
  if (titleParts.length > 0) {
    attributes['title'] = titleParts.join('\n');
  }
  const button = el(
    'button',
    { className: 'focus-card__matrix-btn', attributes },
    [
      el('span', { className: 'focus-card__matrix-value', text: value }),
      el('span', { className: 'focus-card__matrix-trailing' }, trailing),
    ],
  );
  if (cell.cellKey === model.focusedCellKey) {
    button.classList.add('focus-card__matrix-btn--focused');
  }
  button.addEventListener('click', () => handlers.onFocusCell(cell.cellKey));
  return el('td', { className: 'focus-card__matrix-cell' }, [button]);
}

function renderMatrixRow(
  row: FocusUnitRow,
  columns: readonly FocusUnitColumn[],
  model: VerificationFocusCardModel,
  handlers: VerificationFocusCardHandlers,
): HTMLElement {
  const cells = row.cells.map((cell, index) =>
    renderMatrixDataCell(cell, columns[index] as FocusUnitColumn, row.field.fieldLabel, model, handlers),
  );
  return el('tr', {}, [
    el('th', { attributes: { scope: 'row' }, text: row.field.fieldLabel }),
    ...cells,
  ]);
}

function renderMatrix(
  model: VerificationFocusCardModel,
  handlers: VerificationFocusCardHandlers,
): HTMLElement {
  const headerRow = el('tr', {}, [
    el('th', { className: 'focus-card__matrix-colhead', attributes: { scope: 'col' }, text: '項目' }),
    ...model.unit.columns.map((column) =>
      el('th', { className: 'focus-card__matrix-colhead', attributes: { scope: 'col' }, text: column.label }),
    ),
  ]);
  const bodyRows = model.unit.rows.map((row) => renderMatrixRow(row, model.unit.columns, model, handlers));
  return el('table', { id: 'verify-focus-matrix', className: 'focus-card__matrix' }, [
    el('thead', {}, [headerRow]),
    el('tbody', {}, bodyRows),
  ]);
}

/** unit の行から cellKey に一致するセルを探す（フォーカス中セルの詳細表示用） */
function findUnitCell(unit: FocusUnit, cellKey: string | null): VerificationCell | null {
  if (cellKey === null) {
    return null;
  }
  for (const row of unit.rows) {
    for (const cell of row.cells) {
      if (cell !== null && cell.cellKey === cellKey) {
        return cell;
      }
    }
  }
  return null;
}

/**
 * 詳細ストリップ: フォーカス中セル 1 件を、既存のセルカード描画（verificationCellCard.renderCell）
 * をそのまま再利用して表示する。判定済みブロックの概念を持たないため expandedDecidedKey は常に null
 * （「たたむ」ボタンは出さない）
 */
function renderDetailStrip(
  model: VerificationFocusCardModel,
  handlers: VerificationFocusCardHandlers,
): HTMLElement {
  const cell = findUnitCell(model.unit, model.focusedCellKey);
  if (cell === null) {
    return el('p', {
      id: 'verify-focus-detail',
      className: 'focus-card__detail-empty',
      text: 'マトリクスからセルを選択してください',
    });
  }
  const cellCardModel: CellCardModel = {
    focusedCellKey: model.focusedCellKey,
    editing: model.editing,
    expandedDecidedKey: null,
    highlightInfo: model.highlightInfo,
    canSearchText: model.canSearchText,
    mode: model.mode,
    consistencyWarnings: model.consistencyWarnings,
    robAlgorithmInfo: model.robAlgorithmInfo,
  };
  return el('div', { id: 'verify-focus-detail', className: 'focus-card__detail' }, [
    renderCell(cell, cellCardModel, handlers),
  ]);
}

/**
 * 直近判定バー。ユニットをまたいでも直近判定セルへ z（戻す）を効かせるための固定表示
 * （requirements: 「ユニットをまたいでも直近判定セルに効く」）。直近判定が無ければ null
 */
function renderRecentBar(
  model: VerificationFocusCardModel,
  handlers: VerificationFocusCardHandlers,
): HTMLElement | null {
  const cell = model.recentCell;
  if (cell === null) {
    return null;
  }
  const undoButton = el('button', {
    className: 'focus-card__recent-undo',
    text: '戻す (z)',
    attributes: { type: 'button' },
  });
  undoButton.disabled = cell.state.stack.length === 0;
  undoButton.addEventListener('click', () => handlers.onUndo(cell.cellKey));
  return el(
    'div',
    {
      id: 'verify-focus-recent',
      className: 'focus-card__recent',
      attributes: { role: 'status', 'aria-live': 'polite' },
    },
    [
      el('span', { className: 'focus-card__recent-label-lead', text: '直近判定: ' }),
      renderStatusChip(cell.state.status),
      el('span', { className: 'focus-card__recent-label', text: cell.field.fieldLabel }),
      el('span', { className: 'focus-card__recent-value', text: `= ${displayValue(cell)}` }),
      undoButton,
    ],
  );
}

export function renderVerificationFocusCard(
  model: VerificationFocusCardModel,
  handlers: VerificationFocusCardHandlers,
): HTMLElement {
  const children: HTMLElement[] = [renderUnitHeader(model), renderMatrix(model, handlers)];
  if (model.unit.summary !== null) {
    children.push(
      el('p', { className: 'focus-card__summary', text: `要約: ${model.unit.summary}` }),
    );
  }
  children.push(renderDetailStrip(model, handlers));
  const recentBar = renderRecentBar(model, handlers);
  if (recentBar !== null) {
    children.push(recentBar);
  }
  return el('section', { id: 'verify-focus-card', className: 'focus-card' }, children);
}
