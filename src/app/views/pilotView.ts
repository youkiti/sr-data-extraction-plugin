// #/pilot: パイロット抽出（S6 / ui-states.md §3）。
// 状態: 未実行（対象文献セレクタ + コスト概算 + 実行）/ 実行中（進捗バー）/
// 完了（結果サマリ + 埋め込み検証 UI + 「スキーマを改訂して再パイロット」導線）。
// 検証 UI は S8 と同じ verificationPanel を埋め込む（requirements.md §4.1 S6）
import type { DocumentRecord } from '../../domain/document';
import type { ExtractionRun } from '../../domain/extractionRun';
import { planRun } from '../../features/extraction/planRun';
import { el } from '../ui/dom';
import { createModelSelect } from '../ui/modelSelect';
import type { AppState } from '../store';
import type { ViewContext } from './types';
import { renderCachedVerificationPanel } from './verificationPanel';

function renderDocumentSelector(state: AppState, ctx: ViewContext): HTMLElement {
  const { records, loading, loadError } = state.documents;
  if (loadError !== null) {
    return el('p', {
      id: 'pilot-documents-error',
      className: 'pilot__error',
      text: `文献一覧を読み込めませんでした: ${loadError}`,
    });
  }
  if (records === null || loading) {
    return el('p', { id: 'pilot-documents-loading', text: '文献一覧を読み込んでいます…' });
  }
  const items = records.map((doc) => {
    const checkbox = el('input', {
      attributes: { type: 'checkbox', 'aria-label': `${doc.filename} を対象にする` },
    });
    checkbox.checked = state.pilot.selectedDocumentIds.includes(doc.documentId);
    // MVP は text_only モード固定のため、テキスト層なしは選択不可（pdf_native は P1。※Q7）
    // （実行中は renderSetup 自体を描画しないので running での無効化は不要）
    checkbox.disabled = doc.textStatus === 'no_text_layer';
    checkbox.addEventListener('change', () =>
      ctx.pilot.onToggleDocument(doc.documentId, checkbox.checked),
    );
    const parts: Array<HTMLElement | string> = [
      checkbox,
      el('span', { className: 'pilot__doc-label', text: doc.studyLabel }),
      el('span', { className: 'pilot__doc-filename', text: doc.filename }),
    ];
    if (doc.textStatus === 'no_text_layer') {
      parts.push(
        el('small', {
          className: 'pilot__doc-note',
          text: 'テキスト層なし（pdf_native モード時のみ選択可・P1）',
        }),
      );
    }
    return el('li', { className: 'pilot__doc-item' }, [
      el('label', { className: 'pilot__doc-choice' }, parts),
    ]);
  });
  if (items.length === 0) {
    return el('p', { id: 'pilot-documents-empty', text: 'まだ文献がありません。先に #/documents で取り込んでください。' });
  }
  return el('ul', { id: 'pilot-documents', className: 'pilot__docs' }, items);
}

function renderEstimate(state: AppState): HTMLElement {
  const fields = state.schema.currentFields;
  const records = state.documents.records ?? [];
  const selected = records.filter((doc) =>
    state.pilot.selectedDocumentIds.includes(doc.documentId),
  );
  if (fields === null || fields.length === 0 || selected.length === 0) {
    return el('p', {
      id: 'pilot-estimate',
      className: 'pilot__estimate',
      text: 'コスト概算: 対象文献を選択すると表示されます',
    });
  }
  try {
    const plan = planRun({
      documents: selected,
      fields,
      model: state.pilot.model === '' ? 'unknown' : state.pilot.model,
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
        className: 'pilot__estimate-note',
        text: 'プロトコル本文ぶんは概算に含まれません（実行時は加算されます）',
      }),
    ];
    for (const warning of plan.warnings) {
      lines.push(el('p', { className: 'pilot__estimate-warning', text: `注意: ${warning}` }));
    }
    return el('div', { id: 'pilot-estimate', className: 'pilot__estimate' }, lines);
  } catch (err) {
    return el('p', {
      id: 'pilot-estimate',
      className: 'pilot__estimate pilot__estimate--error',
      text: `コスト概算を計算できません: ${err instanceof Error ? err.message : String(err)}`,
    });
  }
}

function renderSetup(state: AppState, ctx: ViewContext): HTMLElement {
  const modelSelect = createModelSelect(document, {
    id: 'pilot-model',
    ariaLabel: 'モデル名（requested_model）',
    value: state.pilot.model,
    placeholderLabel: '選択してください',
    onChange: (value) => ctx.pilot.onChangeModel(value),
    className: 'pilot__model-input',
  });

  const runButton = el('button', {
    id: 'pilot-run',
    className: 'pilot__run',
    text: 'パイロット抽出を実行',
    attributes: { type: 'button' },
  });
  runButton.addEventListener('click', () => ctx.pilot.onRun());

  const children: HTMLElement[] = [
    el('h3', { text: '対象文献（2〜3 本を推奨）' }),
    renderDocumentSelector(state, ctx),
    el('div', { className: 'pilot__model' }, [
      el('label', { text: 'モデル: ', attributes: { for: 'pilot-model' } }),
      modelSelect,
    ]),
    renderEstimate(state),
  ];
  if (state.pilot.runError !== null) {
    children.push(
      el('p', {
        id: 'pilot-run-error',
        className: 'pilot__error',
        attributes: { role: 'alert' },
        text: state.pilot.runError,
      }),
    );
  }
  children.push(el('div', { className: 'pilot__actions' }, [runButton]));
  return el('section', { className: 'pilot__setup' }, children);
}

function renderProgress(state: AppState): HTMLElement {
  const { progress } = state.pilot;
  const bar = el('progress', { id: 'pilot-progress', className: 'pilot__progress-bar' });
  let text = '実行準備中…';
  if (progress !== null) {
    bar.max = progress.totalBatches;
    bar.value = progress.completedBatches;
    const percent =
      progress.totalBatches > 0
        ? Math.floor((progress.completedBatches / progress.totalBatches) * 100)
        : 0;
    const label = studyLabelOf(state.documents.records, progress.documentId);
    text = `${progress.completedBatches} / ${progress.totalBatches} バッチ完了（${percent}% / 直近: ${label}${progress.section === null ? '' : ` / ${progress.section}`}）`;
  }
  return el('section', { className: 'pilot__running', attributes: { 'aria-live': 'polite' } }, [
    el('h3', { text: '抽出を実行しています…' }),
    bar,
    el('p', { className: 'pilot__progress-text', text }),
  ]);
}

function studyLabelOf(records: readonly DocumentRecord[] | null, documentId: string): string {
  return records?.find((doc) => doc.documentId === documentId)?.studyLabel ?? documentId;
}

function renderRunSummary(run: ExtractionRun, state: AppState): HTMLElement {
  const { batchFailures, rejectedCount } = state.pilot;
  const children: HTMLElement[] = [];
  if (run.status === 'partial_failure') {
    const failureItems = batchFailures.map((failure) =>
      el('li', {
        text: `${failure.documentId}${failure.section === null ? '' : ` / ${failure.section}`}: ${failure.reason}（${failure.detail}）`,
      }),
    );
    if (rejectedCount > 0) {
      failureItems.push(el('li', { text: `応答要素の破棄: ${rejectedCount} 件` }));
    }
    children.push(
      el('div', { id: 'pilot-partial-failure', className: 'pilot__partial-failure' }, [
        el('p', { text: '一部のバッチが失敗しました（成功分は検証できます）:' }),
        el('ul', {}, failureItems),
      ]),
    );
  } else {
    children.push(
      el('p', { id: 'pilot-run-done', className: 'pilot__run-done', text: '抽出が完了しました。' }),
    );
  }
  // 「スキーマを改訂して再パイロット」導線は完了後は常に可視（ui-states.md §3）
  children.push(
    el('p', {}, [
      el('a', {
        id: 'pilot-revise-schema',
        className: 'pilot__revise-link',
        text: 'スキーマを改訂して再パイロット',
        attributes: { href: '#/schema' },
      }),
    ]),
  );
  return el('section', { className: 'pilot__summary' }, children);
}

function renderVerification(run: ExtractionRun, state: AppState, ctx: ViewContext): HTMLElement {
  const children: HTMLElement[] = [el('h3', { text: '検証（S8 と同じ操作）' })];

  const select = el('select', {
    id: 'pilot-verify-doc',
    attributes: { 'aria-label': '検証する文献' },
  });
  for (const documentId of run.documentIds) {
    const option = el('option', {
      text: studyLabelOf(state.documents.records, documentId),
      attributes: { value: documentId },
    });
    select.append(option);
  }
  if (state.pilot.verifyDocumentId !== null) {
    select.value = state.pilot.verifyDocumentId;
  }
  select.addEventListener('change', () => ctx.pilot.onSelectVerifyDocument(select.value));
  const header: HTMLElement[] = [el('label', { text: '文献: ', attributes: { for: 'pilot-verify-doc' } }), select];
  if (state.pilot.queuedDecisions > 0) {
    header.push(
      el('span', {
        id: 'pilot-queued',
        className: 'pilot__queued',
        text: `オフライン: ${state.pilot.queuedDecisions} 件キュー中`,
      }),
    );
  }
  children.push(el('div', { className: 'pilot__verify-header' }, header));

  if (state.pilot.verifyLoading) {
    children.push(el('p', { id: 'pilot-verify-loading', text: '検証データを読み込んでいます…' }));
  } else if (state.pilot.verifyError !== null) {
    const retry = el('button', {
      id: 'pilot-verify-retry',
      text: '再試行',
      attributes: { type: 'button' },
    });
    retry.addEventListener('click', () => ctx.pilot.onRetryVerifyLoad());
    children.push(
      el('p', { id: 'pilot-verify-error', className: 'pilot__error', attributes: { role: 'alert' }, text: `検証データを読み込めませんでした: ${state.pilot.verifyError}` }),
      retry,
    );
  } else if (state.pilot.verification !== null) {
    children.push(
      renderCachedVerificationPanel({
        data: state.pilot.verification,
        onDecision: (decision) => ctx.pilot.onDecision(decision),
        onArmConfirm: (arms) => ctx.pilot.onArmConfirm(arms),
      }),
    );
  }
  return el('section', { className: 'pilot__verify' }, children);
}

export function renderPilotView(state: AppState, ctx: ViewContext): HTMLElement {
  const children: HTMLElement[] = [
    el('h2', { text: 'パイロット抽出' }),
    el('p', {
      className: 'view__lead',
      text: '2〜3 本の論文で AI 抽出を試行し、検証結果をもとにスキーマを改訂します。',
    }),
  ];
  if (state.pilot.running) {
    children.push(renderProgress(state));
  } else {
    children.push(renderSetup(state, ctx));
  }
  if (state.pilot.run !== null && !state.pilot.running) {
    children.push(
      renderRunSummary(state.pilot.run, state),
      renderVerification(state.pilot.run, state, ctx),
    );
  }
  return el('section', { className: 'view view--pilot' }, children);
}
