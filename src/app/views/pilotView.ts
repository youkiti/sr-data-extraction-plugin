// #/pilot: パイロット抽出（S6 / ui-states.md §3）。
// 状態: 未実行（対象文献セレクタ + コスト概算 + 実行）/ 実行中（進捗バー）/
// 完了（結果サマリ + 埋め込み検証 UI + 「スキーマを改訂して再パイロット」導線）。
// 検証 UI は S8 と同じ verificationPanel を埋め込む（requirements.md §4.1 S6）
import type { DocumentRecord } from '../../domain/document';
import type { ExtractionRun } from '../../domain/extractionRun';
import {
  buildStudySelection,
  documentsForStudies,
  type StudySelectionItem,
} from '../../features/documents/studySelection';
import { studyLabelMap } from '../../features/documents/studyRepository';
import { planRun } from '../../features/extraction/planRun';
import { el } from '../ui/dom';
import { createModelSelect } from '../ui/modelSelect';
import type { AppState } from '../store';
import type { ViewContext } from './types';
import { renderCachedVerificationPanel } from './verificationPanel';

const DOCUMENT_ROLE_LABELS: Readonly<Record<DocumentRecord['documentRole'], string>> = {
  article: '本論文',
  registration: '試験登録',
  protocol: 'プロトコル',
  abstract: '抄録',
  supplement: '付録',
  other: 'その他',
};

/** 現在の documents / studies スライスから study 選択モデルを組む */
function selectionOf(state: AppState): StudySelectionItem[] {
  const { records, studies } = state.documents;
  if (records === null || studies === null) {
    return [];
  }
  return buildStudySelection(studies, records);
}

function renderStudySelector(state: AppState, ctx: ViewContext): HTMLElement {
  const { records, studies, loading, loadError } = state.documents;
  if (loadError !== null) {
    return el('p', {
      id: 'pilot-documents-error',
      className: 'pilot__error',
      text: `文献一覧を読み込めませんでした: ${loadError}`,
    });
  }
  if (records === null || studies === null || loading) {
    return el('p', { id: 'pilot-documents-loading', text: '文献一覧を読み込んでいます…' });
  }
  const items = selectionOf(state).map((item) => {
    const studyId = item.study.studyId;
    const checkbox = el('input', {
      attributes: { type: 'checkbox', 'aria-label': `${item.study.studyLabel} を対象にする` },
    });
    checkbox.checked = state.pilot.selectedStudyIds.includes(studyId);
    // MVP は text_only モード固定のため、テキスト層のある文書が無い study は選択不可（※Q7）
    checkbox.disabled = !item.hasTextLayer;
    checkbox.addEventListener('change', () =>
      ctx.pilot.onToggleStudy(studyId, checkbox.checked),
    );
    const head: Array<HTMLElement | string> = [
      checkbox,
      el('span', { className: 'pilot__doc-label', text: item.study.studyLabel }),
    ];
    if (!item.hasTextLayer) {
      head.push(
        el('small', {
          className: 'pilot__doc-note',
          text: 'テキスト層のある文書がありません（pdf_native モード時のみ選択可・P1）',
        }),
      );
    }
    const docList = el(
      'ul',
      { className: 'pilot__study-docs' },
      item.documents.map((doc) =>
        el('li', { className: 'pilot__study-doc' }, [
          el('span', {
            className: 'pilot__doc-role',
            text: DOCUMENT_ROLE_LABELS[doc.documentRole],
          }),
          el('span', { className: 'pilot__doc-filename', text: doc.filename }),
          ...(doc.textStatus === 'no_text_layer'
            ? [el('small', { className: 'pilot__doc-note', text: 'テキスト層なし' })]
            : []),
        ]),
      ),
    );
    return el('li', { className: 'pilot__doc-item' }, [
      el('label', { className: 'pilot__doc-choice' }, head),
      docList,
    ]);
  });
  if (items.length === 0) {
    return el('p', { id: 'pilot-documents-empty', text: 'まだ試験がありません。先に #/documents で取り込んでください。' });
  }
  return el('ul', { id: 'pilot-documents', className: 'pilot__docs' }, items);
}

function renderEstimate(state: AppState): HTMLElement {
  const fields = state.schema.currentFields;
  const selected = documentsForStudies(selectionOf(state), state.pilot.selectedStudyIds);
  if (fields === null || fields.length === 0 || selected.length === 0) {
    return el('p', {
      id: 'pilot-estimate',
      className: 'pilot__estimate',
      text: 'コスト概算: 対象 study を選択すると表示されます',
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
    el('h3', { text: '新規パイロット' }),
    el('p', {
      className: 'pilot__setup-lead',
      text: '新しく 2〜3 本の論文でパイロット抽出を実行します。',
    }),
    el('h4', { text: '対象試験（2〜3 件を推奨）' }),
    renderStudySelector(state, ctx),
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
    const label = studyLabelOf(state, progress.studyId);
    text = `${progress.completedBatches} / ${progress.totalBatches} バッチ完了（${percent}% / 直近: ${label}${progress.section === null ? '' : ` / ${progress.section}`}）`;
  }
  return el('section', { className: 'pilot__running', attributes: { 'aria-live': 'polite' } }, [
    el('h3', { text: '抽出を実行しています…' }),
    bar,
    el('p', { className: 'pilot__progress-text', text }),
  ]);
}

/** study の表示ラベル（study_label）。見つからなければ study_id */
function studyLabelOf(state: AppState, studyId: string): string {
  return studyLabelMap(state.documents.studies ?? []).get(studyId) ?? studyId;
}

function renderRunSummary(run: ExtractionRun, state: AppState): HTMLElement {
  const { batchFailures, rejectedCount } = state.pilot;
  const children: HTMLElement[] = [];
  if (run.status === 'partial_failure') {
    const failureItems = batchFailures.map((failure) =>
      el('li', {
        text: `${studyLabelOf(state, failure.studyId)}${failure.section === null ? '' : ` / ${failure.section}`}: ${failure.reason}（${failure.detail}）`,
      }),
    );
    if (rejectedCount > 0) {
      failureItems.push(el('li', { text: `応答要素の破棄: ${rejectedCount} 件` }));
    }
    // 履歴から読み込んだ run は内訳を再構成できないため、空のときは案内を出す
    if (failureItems.length === 0) {
      failureItems.push(
        el('li', { text: '失敗の内訳は保存されていません（履歴から読み込んだ実行）。' }),
      );
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
  // run は study 単位（studyIds）。フェーズ 1 は 1 study = 1 文書なので study_id から文献を引く
  const runStudyIds = new Set(run.studyIds);
  const verifyDocs = (state.documents.records ?? []).filter((doc) => runStudyIds.has(doc.studyId));
  for (const doc of verifyDocs) {
    const option = el('option', {
      text: doc.filename,
      attributes: { value: doc.documentId },
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
        onInstanceDeclare: (decisions) => ctx.pilot.onInstanceDeclare?.(decisions),
      }),
    );
  }
  return el('section', { className: 'pilot__verify' }, children);
}

/** 完了 run の status を履歴・サマリで日本語表示するラベル */
const RUN_STATUS_LABEL: Record<string, string> = {
  done: '完了',
  partial_failure: '一部失敗',
};

/**
 * 過去のパイロット結果の履歴セクション（S6）。読み込み中 / 失敗（再読み込み）/ 一覧を出す。
 * 履歴が空・未読込のときは null を返し、初回ユーザー（過去 run なし）には出さない
 */
function renderHistory(state: AppState, ctx: ViewContext): HTMLElement | null {
  const { history, historyLoading, historyError, loadingRunId, run } = state.pilot;
  if (historyLoading) {
    return el('section', { className: 'pilot__history' }, [
      el('h3', { text: '過去のパイロット結果' }),
      el('p', {
        id: 'pilot-history-loading',
        text: '過去のパイロット結果を読み込んでいます…',
      }),
    ]);
  }
  if (historyError !== null) {
    const reload = el('button', {
      id: 'pilot-history-reload',
      text: '再読み込み',
      attributes: { type: 'button' },
    });
    reload.addEventListener('click', () => ctx.pilot.onReloadHistory());
    return el('section', { className: 'pilot__history' }, [
      el('h3', { text: '過去のパイロット結果' }),
      el('p', {
        id: 'pilot-history-error',
        className: 'pilot__error',
        attributes: { role: 'alert' },
        text: `過去のパイロット結果を読み込めませんでした: ${historyError}`,
      }),
      reload,
    ]);
  }
  if (history === null || history.length === 0) {
    return null;
  }
  const items = history.map((entry) => {
    const isCurrent = run?.runId === entry.runId;
    const when = entry.finishedAt ?? entry.startedAt ?? '(日時不明)';
    const statusLabel = RUN_STATUS_LABEL[entry.status] ?? entry.status;
    const open = el(
      'button',
      { className: 'pilot__history-open', attributes: { type: 'button' } },
      [
        el('span', { className: 'pilot__history-when', text: when }),
        el('span', { className: 'pilot__history-model', text: entry.requestedModel }),
        el('span', {
          className: 'pilot__history-docs',
          text: `${entry.studyIds.length} 試験`,
        }),
        el('span', {
          className: `pilot__history-status pilot__history-status--${entry.status}`,
          text: statusLabel,
        }),
      ],
    );
    // 読み込み中はすべて無効化（二重起動防止）。表示中の run は選び直せない
    open.disabled = loadingRunId !== null || isCurrent;
    open.addEventListener('click', () => ctx.pilot.onSelectRun(entry.runId));
    const parts: HTMLElement[] = [open];
    if (isCurrent) {
      parts.push(el('span', { className: 'pilot__history-current', text: '表示中' }));
    } else if (loadingRunId === entry.runId) {
      parts.push(el('span', { className: 'pilot__history-note', text: '読み込み中…' }));
    }
    const item = el('li', { className: 'pilot__history-item' }, parts);
    if (isCurrent) {
      item.setAttribute('aria-current', 'true');
    }
    return item;
  });
  return el('section', { className: 'pilot__history' }, [
    el('h3', { text: '過去のパイロット結果' }),
    el('p', {
      className: 'pilot__history-lead',
      text: '過去の結果を読み込んで検証を続けられます。新しく試すときは下の「新規パイロット」から実行してください。',
    }),
    el('ul', { id: 'pilot-history', className: 'pilot__history-list' }, items),
  ]);
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
    return el('section', { className: 'view view--pilot' }, children);
  }
  const history = renderHistory(state, ctx);
  if (history !== null) {
    children.push(history);
  }
  // 読み込み済みの結果（履歴の自動 / 手動読込 or 実行直後）を履歴の直下に出す
  if (state.pilot.run !== null) {
    children.push(
      renderRunSummary(state.pilot.run, state),
      renderVerification(state.pilot.run, state, ctx),
    );
  }
  // 新規実行フォームは常に末尾に置く（「新規に実行もできる」）
  children.push(renderSetup(state, ctx));
  return el('section', { className: 'view view--pilot' }, children);
}
