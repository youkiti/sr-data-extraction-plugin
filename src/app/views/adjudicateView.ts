// `#/adjudicate`: 裁定（S12。docs/design-independent-dual-review.md §6・§9 PR3）。
// owner / adjudicator のみ到達可能（guards.ts）。状態: 読み込み中 / 失敗 / study 一覧
// （ゲート付き。両者の完了状況のみ表示し値・判定内訳は見せない）/ 裁定中（群構成突き合わせ →
// セル一覧）。
//
// PDF 参照ペインは PDF 表示 + ページ送り / ズーム / テキスト検索のみの簡略版
// （app/views/adjudicatePdfPane.ts）。Evidence ハイライトの再特定は行わない —
// 裁定は盲検解除後の工程で、根拠探しは「本文を検索」で足りると判断し実装コストを抑えた
// （設計指示 §9「実装が重い場合は v1 として PDF 表示 + テキスト検索だけでも可」に基づく簡略化。
// 完了報告に明記する）
import type { AdjudicationCell } from '../../features/adjudication/cellMatch';
import { entityKeyLabel } from '../../features/verification/cells';
import { deriveCellStates, emptyCellState, type CellState } from '../../features/verification/cellState';
import { STUDY_ENTITY_KEY } from '../../utils/entityKey';
import type { AdjudicateStudyRow, AdjudicateWorking, AppState } from '../store';
import { el } from '../ui/dom';
import { renderAdjudicatePdfPane } from './adjudicatePdfPane';
import type { ViewContext } from './types';

type ChipStatus = 'match' | 'mismatch' | 'accept' | 'edit' | 'reject' | 'not_reported' | 'skipped';

const CHIP_LABELS: Record<ChipStatus, string> = {
  match: '一致',
  mismatch: '不一致',
  accept: '裁定済み（採用）',
  edit: '裁定済み（編集）',
  reject: '裁定済み（棄却）',
  not_reported: '裁定済み（未報告）',
  skipped: 'スキップ',
};

function displayValue(value: string | null): string {
  return value === null ? '（未入力）' : value;
}

function chipStatus(cell: AdjudicationCell, consensusState: CellState, skipped: boolean): ChipStatus {
  if (skipped) {
    return 'skipped';
  }
  if (consensusState.status !== 'unverified') {
    return consensusState.status;
  }
  return cell.matches ? 'match' : 'mismatch';
}

// ---------------------------------------------------------------------------
// study 一覧（ゲート付き）
// ---------------------------------------------------------------------------

function renderListRow(row: AdjudicateStudyRow, ctx: ViewContext): HTMLElement {
  const cells: HTMLElement[] = [el('td', { className: 'adjudicate__list-label', text: row.study.studyLabel })];

  if (row.pair.kind === 'waiting') {
    cells.push(
      el('td', { text: '両者の検証完了待ちです' }),
      el('td', {}),
    );
    return el('tr', { className: 'adjudicate__list-row adjudicate__list-row--dimmed' }, cells);
  }
  if (row.pair.kind === 'ambiguous') {
    cells.push(
      el('td', { text: '対象 annotator を特定できません' }),
      el('td', {}),
    );
    return el('tr', { className: 'adjudicate__list-row adjudicate__list-row--dimmed' }, cells);
  }

  const { gate } = row;
  const statusText =
    gate === null
      ? ''
      : `A（${row.pair.annotatorA}）: ${gate.progressA.decided}/${gate.progressA.total}・B（${row.pair.annotatorB}）: ${gate.progressB.decided}/${gate.progressB.total}`;
  cells.push(el('td', { text: statusText }));

  if (gate !== null && gate.ready) {
    const open = el('button', {
      className: 'adjudicate__open-button',
      text: '裁定を開始',
      attributes: { type: 'button' },
    });
    open.addEventListener('click', () => ctx.adjudicate.onSelectStudy(row.study.studyId));
    cells.push(el('td', {}, [open]));
    return el('tr', { className: 'adjudicate__list-row', attributes: { 'data-study-id': row.study.studyId } }, cells);
  }
  cells.push(el('td', {}));
  return el('tr', { className: 'adjudicate__list-row adjudicate__list-row--dimmed' }, cells);
}

function renderList(rows: readonly AdjudicateStudyRow[], ctx: ViewContext): HTMLElement {
  if (rows.length === 0) {
    return el('p', {
      id: 'adjudicate-empty',
      text: '裁定対象となる研究がありません。#/documents で文献を取り込み、2 名のレビュアーによる検証が完了すると一覧に表示されます。',
    });
  }
  return el('table', { id: 'adjudicate-list', className: 'adjudicate__list' }, [
    el('thead', {}, [
      el('tr', {}, [
        el('th', { text: '研究' }),
        el('th', { text: '状況' }),
        el('th', { text: '' }),
      ]),
    ]),
    el('tbody', {}, rows.map((row) => renderListRow(row, ctx))),
  ]);
}

// ---------------------------------------------------------------------------
// 裁定中: 群構成の突き合わせ
// ---------------------------------------------------------------------------

function renderArmList(label: string, arms: readonly { armName: string }[]): HTMLElement {
  return el('div', { className: 'adjudicate__arm-list' }, [
    el('h5', { text: label }),
    el('ol', {}, arms.map((arm) => el('li', { text: arm.armName }))),
  ]);
}

function renderArmDraftEditor(working: AdjudicateWorking, ctx: ViewContext): HTMLElement {
  const rows = working.armDraft.map((row, index) => {
    const input = el('input', {
      className: 'adjudicate__arm-draft-input',
      attributes: { type: 'text', 'aria-label': `群 ${index + 1} の名称` },
    }) as HTMLInputElement;
    input.value = row.armName;
    input.addEventListener('change', () => ctx.adjudicate.onArmDraftChange(index, input.value));
    const remove = el('button', {
      className: 'adjudicate__arm-draft-remove',
      text: '削除',
      attributes: { type: 'button', 'aria-label': `群 ${index + 1} を削除` },
    });
    remove.addEventListener('click', () => ctx.adjudicate.onArmDraftRemove(index));
    return el('div', { className: 'adjudicate__arm-draft-row' }, [input, remove]);
  });
  const add = el('button', {
    id: 'adjudicate-arm-add',
    text: '群を追加',
    attributes: { type: 'button' },
  });
  add.addEventListener('click', () => ctx.adjudicate.onArmDraftAdd());
  const confirm = el('button', {
    id: 'adjudicate-arm-confirm',
    text: '確定',
    attributes: { type: 'button' },
  });
  confirm.addEventListener('click', () => ctx.adjudicate.onConfirmArms(working.armDraft));
  return el('div', { className: 'adjudicate__arm-draft' }, [...rows, add, confirm]);
}

function renderArmCard(working: AdjudicateWorking, ctx: ViewContext): HTMLElement {
  if (working.consensusArmStructure !== null) {
    return el('section', { id: 'adjudicate-arm-card', className: 'adjudicate__arm-card' }, [
      el('h4', { text: '群構成（確定済み）' }),
      el(
        'ul',
        { className: 'adjudicate__arm-confirmed' },
        working.consensusArmStructure.arms.map((arm) => el('li', { text: arm.armName })),
      ),
    ]);
  }
  const children: HTMLElement[] = [
    el('h4', { text: '群構成の突き合わせ' }),
    el('div', { className: 'adjudicate__arm-compare' }, [
      renderArmList('A', working.armsA),
      renderArmList('B', working.armsB),
    ]),
  ];
  if (working.armsMatched) {
    children.push(
      el('p', { className: 'adjudicate__arm-match-note', text: '本数・名称が一致しています。' }),
    );
    const adopt = el('button', {
      id: 'adjudicate-arm-adopt',
      text: 'このまま採用',
      attributes: { type: 'button' },
    });
    adopt.addEventListener('click', () => ctx.adjudicate.onConfirmArms(working.armDraft));
    children.push(adopt);
  } else {
    children.push(
      el('p', {
        className: 'adjudicate__arm-mismatch-note',
        attributes: { role: 'alert' },
        text: '本数または名称が一致しません。consensus の群構成を編集して確定してください。',
      }),
      renderArmDraftEditor(working, ctx),
    );
  }
  return el('section', { id: 'adjudicate-arm-card', className: 'adjudicate__arm-card' }, children);
}

// ---------------------------------------------------------------------------
// 裁定中: セル一覧
// ---------------------------------------------------------------------------

function renderCellRow(
  cell: AdjudicationCell,
  working: AdjudicateWorking,
  consensusStates: Map<string, CellState>,
  armLocked: boolean,
  ctx: ViewContext,
): HTMLElement {
  const consensusState = consensusStates.get(cell.cellKey) ?? emptyCellState();
  const skipped = working.skippedCellKeys.includes(cell.cellKey);
  const status = chipStatus(cell, consensusState, skipped);
  const heading = cell.entityKey === STUDY_ENTITY_KEY ? cell.field.section : entityKeyLabel(cell.entityKey);

  const fieldChildren: Array<HTMLElement | string> = [
    el('span', { className: 'adjudicate__cell-label', text: cell.field.fieldLabel }),
  ];
  if (cell.schemaVersionMismatch) {
    fieldChildren.push(
      el('span', {
        className: 'adjudicate__badge adjudicate__badge--schema-mismatch',
        text: 'schema_version 不一致',
      }),
    );
  }

  const row: HTMLElement[] = [
    el('td', { text: heading }),
    el('td', {}, fieldChildren),
    el('td', { text: displayValue(cell.valueA) }),
    el('td', { text: displayValue(cell.valueB) }),
    el(
      'td',
      {},
      [el('span', { className: `adjudicate__chip adjudicate__chip--${status}`, text: CHIP_LABELS[status] })],
    ),
  ];

  const isLocked =
    armLocked && (cell.field.entityLevel === 'arm' || cell.field.entityLevel === 'outcome_result');
  const actionsCell = el('td', { className: 'adjudicate__cell-actions' });
  if (isLocked) {
    actionsCell.append(el('span', { className: 'adjudicate__locked-note', text: '群構成の確定が必要です' }));
  } else if (consensusState.status !== 'unverified') {
    const undo = el('button', {
      className: 'adjudicate__action adjudicate__action--undo',
      text: '取り消し',
      attributes: { type: 'button', 'aria-label': `${cell.field.fieldLabel} の裁定を取り消し` },
    });
    undo.addEventListener('click', () => ctx.adjudicate.onUndo(cell.cellKey));
    actionsCell.append(
      el('span', { className: 'adjudicate__current-value', text: `確定値: ${displayValue(consensusState.value)}` }),
      undo,
    );
  } else if (skipped) {
    const unskip = el('button', {
      className: 'adjudicate__action adjudicate__action--unskip',
      text: 'スキップを取り消す',
      attributes: { type: 'button' },
    });
    unskip.addEventListener('click', () => ctx.adjudicate.onUnskip(cell.cellKey));
    actionsCell.append(unskip);
  } else {
    const chooseA = el('button', {
      className: 'adjudicate__action adjudicate__action--choose-a',
      text: 'A を採用',
      attributes: { type: 'button', 'aria-label': `${cell.field.fieldLabel}: A を採用` },
    });
    chooseA.addEventListener('click', () => ctx.adjudicate.onChooseA(cell.cellKey));
    const chooseB = el('button', {
      className: 'adjudicate__action adjudicate__action--choose-b',
      text: 'B を採用',
      attributes: { type: 'button', 'aria-label': `${cell.field.fieldLabel}: B を採用` },
    });
    chooseB.addEventListener('click', () => ctx.adjudicate.onChooseB(cell.cellKey));
    const customInput = el('input', {
      className: 'adjudicate__custom-input',
      attributes: { type: 'text', 'aria-label': `${cell.field.fieldLabel}: 第 3 の値` },
    }) as HTMLInputElement;
    const customConfirm = el('button', {
      className: 'adjudicate__action adjudicate__action--custom',
      text: '入力して確定',
      attributes: { type: 'button' },
    });
    customConfirm.addEventListener('click', () => ctx.adjudicate.onCustomValue(cell.cellKey, customInput.value));
    const notReported = el('button', {
      className: 'adjudicate__action adjudicate__action--not-reported',
      text: '未報告',
      attributes: { type: 'button' },
    });
    notReported.addEventListener('click', () => ctx.adjudicate.onNotReported(cell.cellKey));
    const skip = el('button', {
      className: 'adjudicate__action adjudicate__action--skip',
      text: 'スキップ',
      attributes: { type: 'button' },
    });
    skip.addEventListener('click', () => ctx.adjudicate.onSkip(cell.cellKey));
    actionsCell.append(chooseA, chooseB, customInput, customConfirm, notReported, skip);
  }
  row.push(actionsCell);
  return el('tr', { className: `adjudicate__cell-row adjudicate__cell-row--${status}` }, row);
}

function renderCellSection(state: AppState, ctx: ViewContext, working: AdjudicateWorking): HTMLElement {
  const consensusStates = deriveCellStates(working.consensusDecisions);
  const mismatchOnly = state.adjudicate.mismatchOnlyFilter;
  const armLocked = working.needsArmConfirmation && working.consensusArmStructure === null;
  const matchCount = working.cells.filter((cell) => cell.matches).length;
  const mismatchCount = working.cells.length - matchCount;

  const filterCheckbox = el('input', {
    id: 'adjudicate-filter-mismatch',
    attributes: { type: 'checkbox' },
  }) as HTMLInputElement;
  filterCheckbox.checked = mismatchOnly;
  filterCheckbox.addEventListener('change', () => ctx.adjudicate.onToggleMismatchOnly(filterCheckbox.checked));

  const bulkAccept = el('button', {
    id: 'adjudicate-accept-all',
    text: '一致セルを一括採用',
    attributes: { type: 'button' },
  });
  bulkAccept.addEventListener('click', () => ctx.adjudicate.onAcceptAllMatches());

  const visibleCells = mismatchOnly ? working.cells.filter((cell) => !cell.matches) : working.cells;

  const body =
    visibleCells.length === 0
      ? el('p', { id: 'adjudicate-cells-empty', text: '表示するセルがありません。' })
      : el('table', { id: 'adjudicate-cells', className: 'adjudicate__cells' }, [
          el('thead', {}, [
            el('tr', {}, [
              el('th', { text: '区分' }),
              el('th', { text: '項目' }),
              el('th', { text: 'A' }),
              el('th', { text: 'B' }),
              el('th', { text: '状態' }),
              el('th', { text: '裁定' }),
            ]),
          ]),
          el(
            'tbody',
            {},
            visibleCells.map((cell) => renderCellRow(cell, working, consensusStates, armLocked, ctx)),
          ),
        ]);

  return el('div', { className: 'adjudicate__panes' }, [
    el('div', { className: 'adjudicate__pane--pdf' }, [renderAdjudicatePdfPane(working)]),
    el('div', { className: 'adjudicate__pane--cells' }, [
      el('div', { className: 'adjudicate__cells-toolbar' }, [
        el('label', { className: 'adjudicate__filter-label' }, [
          filterCheckbox,
          ' 不一致のみ表示',
        ]),
        bulkAccept,
      ]),
      el('p', { id: 'adjudicate-summary', text: `一致 ${matchCount} 件 / 不一致 ${mismatchCount} 件` }),
      body,
    ]),
  ]);
}

function renderWorking(state: AppState, ctx: ViewContext, working: AdjudicateWorking): HTMLElement {
  const back = el('button', { id: 'adjudicate-back', text: '一覧に戻る', attributes: { type: 'button' } });
  back.addEventListener('click', () => ctx.adjudicate.onBackToList());

  const children: HTMLElement[] = [
    el('div', { className: 'adjudicate__working-header' }, [
      el('h3', { text: working.study.studyLabel }),
      back,
    ]),
  ];
  if (working.needsArmConfirmation) {
    children.push(renderArmCard(working, ctx));
  }
  children.push(renderCellSection(state, ctx, working));
  return el('div', { id: 'adjudicate-working', className: 'adjudicate__working' }, children);
}

// ---------------------------------------------------------------------------

export function renderAdjudicateView(state: AppState, ctx: ViewContext): HTMLElement {
  const { adjudicate } = state;
  const children: HTMLElement[] = [
    el('h2', { text: '裁定' }),
    el('p', {
      className: 'view__lead',
      text: 'ヒトの不一致をレビューし、consensus 行として確定します（一致セルは一括採用できます）。',
    }),
  ];

  if (adjudicate.loadError !== null) {
    const retry = el('button', { id: 'adjudicate-retry', text: '再試行', attributes: { type: 'button' } });
    retry.addEventListener('click', () => ctx.adjudicate.onRetryLoad());
    children.push(
      el('p', {
        id: 'adjudicate-error',
        className: 'adjudicate__error',
        attributes: { role: 'alert' },
        text: `裁定対象を読み込めませんでした: ${adjudicate.loadError}`,
      }),
      retry,
    );
    return el('section', { className: 'view view--adjudicate' }, children);
  }

  if (adjudicate.rows === null || adjudicate.loading) {
    children.push(el('p', { id: 'adjudicate-loading', text: '裁定対象を読み込んでいます…' }));
    return el('section', { className: 'view view--adjudicate' }, children);
  }

  if (adjudicate.working !== null) {
    children.push(renderWorking(state, ctx, adjudicate.working));
    return el('section', { className: 'view view--adjudicate' }, children);
  }

  if (adjudicate.workingLoading) {
    children.push(el('p', { id: 'adjudicate-working-loading', text: '裁定データを読み込んでいます…' }));
    return el('section', { className: 'view view--adjudicate' }, children);
  }

  if (adjudicate.workingError !== null) {
    children.push(
      el('p', {
        id: 'adjudicate-working-error',
        className: 'adjudicate__error',
        attributes: { role: 'alert' },
        text: adjudicate.workingError,
      }),
    );
  }

  children.push(renderList(adjudicate.rows, ctx));
  return el('section', { className: 'view view--adjudicate' }, children);
}
