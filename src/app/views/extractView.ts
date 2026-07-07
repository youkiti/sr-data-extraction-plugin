// #/extract: 一括抽出（S7 / ui-states.md §3）。
// 状態: 読み込み中 / 読み込み失敗 / 未実行（対象選択 + コスト概算 + 実行）/
// 実行確認カード / 実行中（document 単位の進捗リスト）/ 完了（done / partial_failure + 再試行）
import type { DocumentRecord } from '../../domain/document';
import type { ExtractDocRow, ExtractDocStatus } from '../../features/extraction/docProgress';
import { planRun } from '../../features/extraction/planRun';
import { el } from '../ui/dom';
import { createModelSelect } from '../ui/modelSelect';
import type { AppState } from '../store';
import type { ViewContext } from './types';

const STATUS_LABELS: Readonly<Record<ExtractDocStatus, string>> = {
  queued: '待機中',
  running: '実行中',
  done: '完了',
  failed: '失敗',
};

/** 文献の表示ラベル（filename）。study_label は Studies へ移設（v0.10）のため一覧はファイル名で表示する */
function docLabelOf(records: readonly DocumentRecord[] | null, documentId: string): string {
  return records?.find((doc) => doc.documentId === documentId)?.filename ?? documentId;
}

/**
 * 選択中の DocumentRecord 一覧（コスト概算・確認カードの素材）。
 * setup / 確認カードは読み込みガード（renderExtractView）を通った後にのみ描画されるため
 * records は非 null
 */
function selectedDocuments(state: AppState): DocumentRecord[] {
  const records = state.documents.records as readonly DocumentRecord[];
  return records.filter((doc) => state.extract.selectedDocumentIds.includes(doc.documentId));
}

function renderDocumentSelector(state: AppState, ctx: ViewContext): HTMLElement {
  // 読み込みガードを通った後のため records / extractedDocumentIds は非 null
  const records = state.documents.records as readonly DocumentRecord[];
  const extracted = new Set(state.extract.extractedDocumentIds as readonly string[]);
  const items = records.map((doc) => {
    const checkbox = el('input', {
      attributes: { type: 'checkbox', 'aria-label': `${doc.filename} を対象にする` },
    });
    checkbox.checked = state.extract.selectedDocumentIds.includes(doc.documentId);
    // MVP は text_only モード固定のため、テキスト層なしは選択不可（pdf_native は P1。※Q7）
    checkbox.disabled = doc.textStatus === 'no_text_layer';
    checkbox.addEventListener('change', () =>
      ctx.extract.onToggleDocument(doc.documentId, checkbox.checked),
    );
    const parts: Array<HTMLElement | string> = [
      checkbox,
      el('span', { className: 'extract__doc-label', text: doc.filename }),
    ];
    if (extracted.has(doc.documentId)) {
      parts.push(el('span', { className: 'extract__doc-extracted', text: '抽出済み' }));
    }
    if (doc.textStatus === 'no_text_layer') {
      parts.push(
        el('small', {
          className: 'extract__doc-note',
          text: 'テキスト層なし（pdf_native モード時のみ選択可・P1）',
        }),
      );
    }
    return el('li', { className: 'extract__doc-item' }, [
      el('label', { className: 'extract__doc-choice' }, parts),
    ]);
  });
  if (items.length === 0) {
    return el('p', {
      id: 'extract-documents-empty',
      text: 'まだ文献がありません。先に #/documents で取り込んでください。',
    });
  }
  return el('ul', { id: 'extract-documents', className: 'extract__docs' }, items);
}

function renderEstimate(state: AppState): HTMLElement {
  const fields = state.schema.currentFields;
  const selected = selectedDocuments(state);
  if (fields === null || fields.length === 0 || selected.length === 0) {
    return el('p', {
      id: 'extract-estimate',
      className: 'extract__estimate',
      text: 'コスト概算: 対象文献を選択すると表示されます',
    });
  }
  try {
    const plan = planRun({
      documents: selected,
      fields,
      model: state.extract.model === '' ? 'unknown' : state.extract.model,
      protocolContext: null,
    });
    const cost =
      plan.costEstimateUsd === null
        ? '概算不可（単価表にないモデル）'
        : `$${plan.costEstimateUsd.toFixed(4)}`;
    const lines: HTMLElement[] = [
      el('p', {
        text: `コスト概算: ${cost}（入力 ~${plan.tokensInEstimate.toLocaleString()} / 出力 ~${plan.tokensOutEstimate.toLocaleString()} トークン、${plan.batches.length} バッチ）`,
      }),
      el('p', {
        className: 'extract__estimate-note',
        text: 'プロトコル本文ぶんは概算に含まれません（実行時は加算されます）',
      }),
    ];
    for (const warning of plan.warnings) {
      lines.push(el('p', { className: 'extract__estimate-warning', text: `注意: ${warning}` }));
    }
    return el('div', { id: 'extract-estimate', className: 'extract__estimate' }, lines);
  } catch (err) {
    return el('p', {
      id: 'extract-estimate',
      className: 'extract__estimate extract__estimate--error',
      text: `コスト概算を計算できません: ${err instanceof Error ? err.message : String(err)}`,
    });
  }
}

function renderSetup(state: AppState, ctx: ViewContext): HTMLElement {
  const modelSelect = createModelSelect(document, {
    id: 'extract-model',
    ariaLabel: 'モデル名（requested_model）',
    value: state.extract.model,
    placeholderLabel: '選択してください',
    onChange: (value) => ctx.extract.onChangeModel(value),
    className: 'extract__model-input',
  });

  const runButton = el('button', {
    id: 'extract-run',
    className: 'extract__run',
    text: '一括抽出を実行',
    attributes: { type: 'button' },
  });
  runButton.disabled = state.extract.confirming || state.extract.retryingDocumentId !== null;
  runButton.addEventListener('click', () => ctx.extract.onRequestRun());

  const children: HTMLElement[] = [
    el('h3', { text: '対象文献（既定 = 未抽出の全件）' }),
    renderDocumentSelector(state, ctx),
    el('div', { className: 'extract__model' }, [
      el('label', { text: 'モデル: ', attributes: { for: 'extract-model' } }),
      modelSelect,
    ]),
    renderEstimate(state),
  ];
  if (state.extract.runError !== null) {
    children.push(
      el('p', {
        id: 'extract-run-error',
        className: 'extract__error',
        attributes: { role: 'alert' },
        text: state.extract.runError,
      }),
    );
  }
  children.push(el('div', { className: 'extract__actions' }, [runButton]));
  if (state.extract.confirming) {
    children.push(renderConfirm(state, ctx));
  }
  return el('section', { className: 'extract__setup' }, children);
}

/** 実行確認カード（ui-states.md §3: 確認を経ずに実行は始まらない） */
function renderConfirm(state: AppState, ctx: ViewContext): HTMLElement {
  const confirmButton = el('button', {
    id: 'extract-confirm-run',
    className: 'extract__confirm-run',
    text: '実行する',
    attributes: { type: 'button' },
  });
  confirmButton.addEventListener('click', () => ctx.extract.onConfirmRun());
  const cancelButton = el('button', {
    id: 'extract-confirm-cancel',
    text: 'キャンセル',
    attributes: { type: 'button' },
  });
  cancelButton.addEventListener('click', () => ctx.extract.onCancelConfirm());
  return el(
    'div',
    {
      id: 'extract-confirm',
      className: 'extract__confirm',
      attributes: { role: 'alertdialog', 'aria-labelledby': 'extract-confirm-title' },
    },
    [
      el('h4', { id: 'extract-confirm-title', text: '一括抽出を開始しますか？' }),
      el('p', {
        text: `対象 ${state.extract.selectedDocumentIds.length} 件をモデル ${state.extract.model} で抽出します。`,
      }),
      renderEstimate(state),
      el('div', { className: 'extract__confirm-actions' }, [confirmButton, cancelButton]),
    ],
  );
}

function renderDocRows(state: AppState, ctx: ViewContext, withRetry: boolean): HTMLElement {
  const items = state.extract.docRows.map((row: ExtractDocRow) => {
    const parts: Array<HTMLElement | string> = [
      el('span', {
        className: `extract__doc-status extract__doc-status--${row.status}`,
        text: STATUS_LABELS[row.status],
      }),
      el('span', {
        className: 'extract__doc-label',
        text: docLabelOf(state.documents.records, row.documentId),
      }),
    ];
    // 実行中の行には document 内のバッチ進捗を併記する（全体の中の現在位置をわかりやすく）
    if (row.status === 'running' && row.totalBatches > 0) {
      parts.push(
        el('span', {
          className: 'extract__doc-batches',
          text: `バッチ ${row.completedBatches}/${row.totalBatches}`,
        }),
      );
    }
    if (row.detail !== null) {
      parts.push(el('span', { className: 'extract__doc-detail', text: row.detail }));
    }
    if (withRetry && row.status === 'failed') {
      const retryButton = el('button', {
        className: 'extract__retry',
        text: '再試行',
        attributes: { type: 'button' },
      });
      retryButton.disabled = state.extract.retryingDocumentId !== null;
      retryButton.addEventListener('click', () => ctx.extract.onRetryDocument(row.documentId));
      parts.push(retryButton);
    }
    return el('li', { className: `extract__doc-row extract__doc-row--${row.status}` }, parts);
  });
  return el('ul', { id: 'extract-doc-list', className: 'extract__doc-list' }, items);
}

/**
 * 実行中ヘッダの文献単位サマリ + 現在処理中の文献（全体の中の現在位置）。
 * docRows が空（実行準備中）のときは何も出さない
 */
function renderRunPosition(state: AppState): HTMLElement[] {
  const rows = state.extract.docRows;
  if (rows.length === 0) {
    return [];
  }
  const doneCount = rows.filter((row) => row.status === 'done').length;
  const failedCount = rows.filter((row) => row.status === 'failed').length;
  const summaryParts = [`文献: 完了 ${doneCount}`];
  if (failedCount > 0) {
    summaryParts.push(`失敗 ${failedCount}`);
  }
  const lines = [
    el('p', {
      id: 'extract-doc-summary',
      className: 'extract__doc-summary',
      text: `${summaryParts.join(' / ')} / 全 ${rows.length} 本`,
    }),
  ];
  const runningIndex = rows.findIndex((row) => row.status === 'running');
  if (runningIndex >= 0) {
    const running = rows[runningIndex] as ExtractDocRow;
    lines.push(
      el('p', {
        id: 'extract-current-doc',
        className: 'extract__current-doc',
        text: `処理中: ${docLabelOf(state.documents.records, running.documentId)}（${runningIndex + 1} 本目・バッチ ${running.completedBatches}/${running.totalBatches}）`,
      }),
    );
  }
  return lines;
}

function renderProgress(state: AppState, ctx: ViewContext): HTMLElement {
  const { progress } = state.extract;
  const bar = el('progress', { id: 'extract-progress', className: 'extract__progress-bar' });
  let text = '実行準備中…';
  if (progress !== null) {
    bar.max = progress.totalBatches;
    bar.value = progress.completedBatches;
    const percent =
      progress.totalBatches > 0
        ? Math.floor((progress.completedBatches / progress.totalBatches) * 100)
        : 0;
    text = `${progress.completedBatches} / ${progress.totalBatches} バッチ完了（${percent}%）`;
  }
  return el('section', { className: 'extract__running', attributes: { 'aria-live': 'polite' } }, [
    el('h3', { text: '抽出を実行しています…' }),
    bar,
    el('p', { className: 'extract__progress-text', text }),
    ...renderRunPosition(state),
    renderDocRows(state, ctx, false),
  ]);
}

function renderSummary(state: AppState, ctx: ViewContext): HTMLElement {
  const failedCount = state.extract.docRows.filter((row) => row.status === 'failed').length;
  const children: HTMLElement[] = [el('h3', { text: '実行結果' })];
  if (failedCount > 0) {
    const lines: HTMLElement[] = [
      el('p', { text: `${failedCount} 件の文献で失敗しました。再試行できます` }),
    ];
    if (state.extract.rejectedCount > 0) {
      lines.push(el('p', { text: `応答要素の破棄: ${state.extract.rejectedCount} 件` }));
    }
    children.push(
      el('div', { id: 'extract-partial-failure', className: 'extract__partial-failure' }, lines),
    );
  } else {
    children.push(
      el('p', {
        id: 'extract-run-done',
        className: 'extract__run-done',
        text: '一括抽出が完了しました。',
      }),
    );
    if (state.extract.rejectedCount > 0) {
      children.push(
        el('p', {
          className: 'extract__rejected-note',
          text: `応答要素の破棄: ${state.extract.rejectedCount} 件（内訳は LLMApiLog を参照）`,
        }),
      );
    }
  }
  children.push(
    renderDocRows(state, ctx, true),
    el('p', {}, [
      el('a', {
        id: 'extract-verify-link',
        className: 'extract__verify-link',
        text: '検証へ進む',
        attributes: { href: '#/verify' },
      }),
    ]),
  );
  return el('section', { className: 'extract__summary' }, children);
}

export function renderExtractView(state: AppState, ctx: ViewContext): HTMLElement {
  const children: HTMLElement[] = [
    el('h2', { text: '一括抽出' }),
    el('p', {
      className: 'view__lead',
      text: '対象文献とモデルを選び、コスト概算を確認してから全論文の AI 抽出を実行します。',
    }),
  ];
  const { extract, documents, counts } = state;

  if (documents.loadError !== null || extract.loadError !== null) {
    const reloadButton = el('button', {
      id: 'extract-reload',
      text: '再読み込み',
      attributes: { type: 'button' },
    });
    reloadButton.addEventListener('click', () => ctx.extract.onReloadTargets());
    children.push(
      el('p', {
        id: 'extract-load-error',
        className: 'extract__error',
        attributes: { role: 'alert' },
        text: `抽出対象を読み込めませんでした: ${documents.loadError ?? extract.loadError}`,
      }),
      reloadButton,
    );
    return el('section', { className: 'view view--extract' }, children);
  }
  if (documents.records === null || documents.loading || extract.extractedDocumentIds === null || extract.loading) {
    children.push(el('p', { id: 'extract-loading', text: '抽出対象を読み込んでいます…' }));
    return el('section', { className: 'view view--extract' }, children);
  }

  if (counts.pilotRuns < 1) {
    children.push(
      el('p', {
        id: 'extract-pilot-warning',
        className: 'extract__pilot-warning',
        text: 'パイロット抽出を推奨します（スキーマの妥当性を 2〜3 本で確認してから一括抽出してください）',
      }),
    );
  }

  // 中断された run の残り文献（再抽出済みは除く）。未抽出扱いのため既定選択に含まれている
  const extractedSet = new Set(extract.extractedDocumentIds);
  const interruptedRemaining = (extract.interruptedDocumentIds ?? []).filter(
    (id) => !extractedSet.has(id),
  );
  if (interruptedRemaining.length > 0 && !extract.running) {
    children.push(
      el('p', {
        id: 'extract-interrupted-warning',
        className: 'extract__interrupted-warning',
        attributes: { role: 'status' },
        text: `前回の抽出が途中で中断されています（未完了 ${interruptedRemaining.length} 件）。未完了の文献は対象の既定選択に含まれているため、そのまま実行すると再開できます。`,
      }),
    );
  }

  if (extract.running) {
    children.push(renderProgress(state, ctx));
  } else {
    children.push(renderSetup(state, ctx));
  }
  if (extract.run !== null && !extract.running) {
    children.push(renderSummary(state, ctx));
  }
  return el('section', { className: 'view view--extract' }, children);
}
