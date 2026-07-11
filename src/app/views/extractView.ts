// #/extract: 一括抽出（S7 / ui-states.md §3・v0.10 study / document）。
// 状態: 読み込み中 / 読み込み失敗 / 未実行（対象 study 選択 + コスト概算 + 実行）/
// 実行確認カード / 実行中（study 単位の進捗リスト）/ 完了（done / partial_failure + 再試行）
import type { DocumentRecord } from '../../domain/document';
import {
  buildStudySelection,
  documentsForStudies,
  type StudySelectionItem,
} from '../../features/documents/studySelection';
import type { StudyRecord } from '../../domain/study';
import { studyLabelMap } from '../../features/documents/studyRepository';
import type { ExtractStudyRow, ExtractStudyStatus } from '../../features/extraction/studyProgress';
import { planRun } from '../../features/extraction/planRun';
import { el } from '../ui/dom';
import { createModelSelect } from '../ui/modelSelect';
import type { AppState } from '../store';
import type { ViewContext } from './types';

const STATUS_LABELS: Readonly<Record<ExtractStudyStatus, string>> = {
  queued: '待機中',
  running: '実行中',
  done: '完了',
  failed: '失敗',
};

const DOCUMENT_ROLE_LABELS: Readonly<Record<DocumentRecord['documentRole'], string>> = {
  article: '本論文',
  registration: '試験登録',
  protocol: 'プロトコル',
  abstract: '抄録',
  supplement: '付録',
  other: 'その他',
};

/**
 * 現在の documents / studies スライスから study 選択モデルを組む。
 * setup / 確認カードは読み込みガード（renderExtractView）を通った後にのみ描画されるため非 null
 */
function selectionOf(state: AppState): StudySelectionItem[] {
  // renderExtractView の読み込みガードを通った後のため records / studies は非 null
  const records = state.documents.records as readonly DocumentRecord[];
  const studies = state.documents.studies as readonly StudyRecord[];
  return buildStudySelection(studies, records);
}

/** study の表示ラベル（study_label）。見つからなければ study_id */
function studyLabelOf(state: AppState, studyId: string): string {
  const studies = state.documents.studies as readonly StudyRecord[];
  return studyLabelMap(studies).get(studyId) ?? studyId;
}

/** 選択中 study の配下文書一覧（コスト概算・確認カードの素材） */
function selectedDocuments(state: AppState): DocumentRecord[] {
  return documentsForStudies(selectionOf(state), state.extract.selectedStudyIds);
}

function renderStudySelector(state: AppState, ctx: ViewContext): HTMLElement {
  // 読み込みガードを通った後のため records / extractedStudyIds は非 null
  const extracted = new Set(state.extract.extractedStudyIds as readonly string[]);
  const selection = selectionOf(state);
  const items = selection.map((item) => {
    const studyId = item.study.studyId;
    const checkbox = el('input', {
      attributes: { type: 'checkbox', 'aria-label': `${item.study.studyLabel} を対象にする` },
    });
    checkbox.checked = state.extract.selectedStudyIds.includes(studyId);
    // pdf_native 対応（handoff-scanned-pdf-native-highlight.md §7.4 PR2）により
    // テキスト層が無い study もページ画像で抽出できるため、選択を制限しない
    checkbox.addEventListener('change', () => ctx.extract.onToggleStudy(studyId, checkbox.checked));
    const head: Array<HTMLElement | string> = [
      checkbox,
      el('span', { className: 'extract__study-label', text: item.study.studyLabel }),
    ];
    if (extracted.has(studyId)) {
      head.push(el('span', { className: 'extract__doc-extracted', text: '抽出済み' }));
    }
    if (!item.hasTextLayer) {
      head.push(
        el('small', {
          className: 'extract__doc-note',
          text: 'テキスト層なし: ページ画像を LLM へ送信して抽出します（ハイライトなし・コスト増）',
        }),
      );
    }
    // 配下文書（role バッジ + ファイル名 + text_status なし）を副次リストで見せる
    const docList = el(
      'ul',
      { className: 'extract__study-docs' },
      item.documents.map((doc) =>
        el('li', { className: 'extract__study-doc' }, [
          el('span', {
            className: 'extract__doc-role',
            text: DOCUMENT_ROLE_LABELS[doc.documentRole],
          }),
          el('span', { className: 'extract__doc-filename', text: doc.filename }),
          ...(doc.textStatus === 'no_text_layer'
            ? [el('small', { className: 'extract__doc-note', text: 'テキスト層なし' })]
            : []),
        ]),
      ),
    );
    return el('li', { className: 'extract__study-item' }, [
      el('label', { className: 'extract__study-choice' }, head),
      docList,
    ]);
  });
  if (items.length === 0) {
    return el('p', {
      id: 'extract-documents-empty',
      text: 'まだ試験がありません。先に #/documents で取り込んでください。',
    });
  }
  return el('ul', { id: 'extract-studies', className: 'extract__studies' }, items);
}

function renderEstimate(state: AppState): HTMLElement {
  const fields = state.schema.currentFields;
  const selected = selectedDocuments(state);
  if (fields === null || fields.length === 0 || selected.length === 0) {
    return el('p', {
      id: 'extract-estimate',
      className: 'extract__estimate',
      text: 'コスト概算: 対象 study を選択すると表示されます',
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
  runButton.disabled = state.extract.confirming || state.extract.retryingStudyId !== null;
  runButton.addEventListener('click', () => ctx.extract.onRequestRun());

  const children: HTMLElement[] = [
    el('h3', { text: '対象試験（既定 = 未抽出の全件）' }),
    renderStudySelector(state, ctx),
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
        text: `対象 ${state.extract.selectedStudyIds.length} 試験をモデル ${state.extract.model} で抽出します。`,
      }),
      renderEstimate(state),
      el('div', { className: 'extract__confirm-actions' }, [confirmButton, cancelButton]),
    ],
  );
}

function renderStudyRows(state: AppState, ctx: ViewContext, withRetry: boolean): HTMLElement {
  const items = state.extract.studyRows.map((row: ExtractStudyRow) => {
    const parts: Array<HTMLElement | string> = [
      el('span', {
        className: `extract__doc-status extract__doc-status--${row.status}`,
        text: STATUS_LABELS[row.status],
      }),
      el('span', {
        className: 'extract__study-label',
        text: studyLabelOf(state, row.studyId),
      }),
    ];
    // 実行中の行には study 内のバッチ進捗を併記する（全体の中の現在位置をわかりやすく）
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
      retryButton.disabled = state.extract.retryingStudyId !== null;
      retryButton.addEventListener('click', () => ctx.extract.onRetryStudy(row.studyId));
      parts.push(retryButton);
    }
    return el('li', { className: `extract__doc-row extract__doc-row--${row.status}` }, parts);
  });
  return el('ul', { id: 'extract-study-list', className: 'extract__doc-list' }, items);
}

/**
 * 実行中ヘッダの study 単位サマリ + 現在処理中の study（全体の中の現在位置）。
 * studyRows が空（実行準備中）のときは何も出さない
 */
function renderRunPosition(state: AppState): HTMLElement[] {
  const rows = state.extract.studyRows;
  if (rows.length === 0) {
    return [];
  }
  const doneCount = rows.filter((row) => row.status === 'done').length;
  const failedCount = rows.filter((row) => row.status === 'failed').length;
  const summaryParts = [`試験: 完了 ${doneCount}`];
  if (failedCount > 0) {
    summaryParts.push(`失敗 ${failedCount}`);
  }
  const lines = [
    el('p', {
      id: 'extract-doc-summary',
      className: 'extract__doc-summary',
      text: `${summaryParts.join(' / ')} / 全 ${rows.length} 件`,
    }),
  ];
  const runningIndex = rows.findIndex((row) => row.status === 'running');
  if (runningIndex >= 0) {
    const running = rows[runningIndex] as ExtractStudyRow;
    lines.push(
      el('p', {
        id: 'extract-current-doc',
        className: 'extract__current-doc',
        text: `処理中: ${studyLabelOf(state, running.studyId)}（${runningIndex + 1} 件目・バッチ ${running.completedBatches}/${running.totalBatches}）`,
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
    renderStudyRows(state, ctx, false),
  ]);
}

function renderSummary(state: AppState, ctx: ViewContext): HTMLElement {
  const failedCount = state.extract.studyRows.filter((row) => row.status === 'failed').length;
  const children: HTMLElement[] = [el('h3', { text: '実行結果' })];
  if (failedCount > 0) {
    const lines: HTMLElement[] = [
      el('p', { text: `${failedCount} 件の試験で失敗しました。再試行できます` }),
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
    renderStudyRows(state, ctx, true),
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
      text: '対象試験とモデルを選び、コスト概算を確認してから全試験の AI 抽出を実行します。',
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
  if (
    documents.records === null ||
    documents.studies === null ||
    documents.loading ||
    extract.extractedStudyIds === null ||
    extract.loading
  ) {
    children.push(el('p', { id: 'extract-loading', text: '抽出対象を読み込んでいます…' }));
    return el('section', { className: 'view view--extract' }, children);
  }

  if (counts.pilotRuns < 1) {
    children.push(
      el('p', {
        id: 'extract-pilot-warning',
        className: 'extract__pilot-warning',
        text: 'パイロット抽出を推奨します（表のデザインの妥当性を 2〜3 本で確認してから一括抽出してください）',
      }),
    );
  }

  // 中断された run の残り study（再抽出済みは除く）。未抽出扱いのため既定選択に含まれている
  const extractedSet = new Set(extract.extractedStudyIds);
  const interruptedRemaining = (extract.interruptedStudyIds ?? []).filter(
    (id) => !extractedSet.has(id),
  );
  if (interruptedRemaining.length > 0 && !extract.running) {
    children.push(
      el('p', {
        id: 'extract-interrupted-warning',
        className: 'extract__interrupted-warning',
        attributes: { role: 'status' },
        text: `前回の抽出が途中で中断されています（未完了 ${interruptedRemaining.length} 件）。未完了の試験は対象の既定選択に含まれているため、そのまま実行すると再開できます。`,
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
