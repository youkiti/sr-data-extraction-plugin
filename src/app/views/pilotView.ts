// #/pilot: パイロット抽出（S6 / ui-states.md §3）。
// 状態: 未実行（対象文献セレクタ + コスト概算 + 実行）/ 実行中（進捗バー）/
// 完了（結果サマリ + 埋め込み検証 UI + 「表のデザインを改訂して再パイロット」導線）。
// 検証 UI は S8 と同じ verificationPanel を埋め込む（requirements.md §4.1 S6）
import type { DocumentRecord } from '../../domain/document';
import type { ExtractionRun } from '../../domain/extractionRun';
import {
  buildExtractionCandidates,
  documentsForStudies,
  type StudySelectionItem,
} from '../../features/documents/studySelection';
import { studyLabelMap } from '../../features/documents/studyRepository';
import {
  filterFieldsBySelection,
  resolveFieldIdsForRun,
} from '../../features/extraction/fieldSelection';
import { planRun } from '../../features/extraction/planRun';
import { t, type MessageKey } from '../../lib/i18n';
import { resolveEffectiveHighAccuracyImages } from '../../lib/llm/providerFactory';
import { el } from '../ui/dom';
import { createModelSelect } from '../ui/modelSelect';
import type { AppState } from '../store';
import { renderConflictWarning } from './conflictWarning';
import { hasZeroFieldsSelected, renderFieldSelectionChecklist } from './fieldSelectionChecklist';
import { renderHighAccuracyToggle } from './highAccuracyToggle';
import type { ViewContext } from './types';
import { renderCachedVerificationPanel } from './verificationPanel';

// 表示言語に追従させるため、ラベルは描画時に t() で解決する（キー対応表のみ固定。issue #93）
const DOCUMENT_ROLE_LABEL_KEYS: Readonly<Record<DocumentRecord['documentRole'], MessageKey>> = {
  article: 'documents.roleArticle',
  registration: 'documents.roleRegistration',
  protocol: 'documents.roleProtocol',
  abstract: 'documents.roleAbstractShort',
  supplement: 'documents.roleSupplementShort',
  other: 'documents.roleOther',
};

/** 現在の documents / studies スライスから抽出候補の study 選択モデルを組む（除外文書は対象外。issue #181） */
function selectionOf(state: AppState): StudySelectionItem[] {
  const { records, studies } = state.documents;
  if (records === null || studies === null) {
    return [];
  }
  return buildExtractionCandidates(studies, records);
}

function renderStudySelector(state: AppState, ctx: ViewContext): HTMLElement {
  const { records, studies, loading, loadError } = state.documents;
  if (loadError !== null) {
    return el('p', {
      id: 'pilot-documents-error',
      className: 'pilot__error',
      text: t('pilot.documentsError', { reason: loadError }),
    });
  }
  if (records === null || studies === null || loading) {
    return el('p', { id: 'pilot-documents-loading', text: t('pilot.documentsLoading') });
  }
  const items = selectionOf(state).map((item) => {
    const studyId = item.study.studyId;
    const checkbox = el('input', {
      attributes: {
        type: 'checkbox',
        'aria-label': t('extraction.studyToggleAria', { label: item.study.studyLabel }),
      },
    });
    checkbox.checked = state.pilot.selectedStudyIds.includes(studyId);
    // pdf_native 対応（handoff-scanned-pdf-native-highlight.md §7.4 PR2）により
    // テキスト層が無い study もページ画像で抽出できるため、選択を制限しない
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
          text: t('extraction.noTextLayerNote'),
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
            text: t(DOCUMENT_ROLE_LABEL_KEYS[doc.documentRole]),
          }),
          el('span', { className: 'pilot__doc-filename', text: doc.filename }),
          ...(doc.textStatus === 'no_text_layer'
            ? [el('small', { className: 'pilot__doc-note', text: t('extraction.noTextLayerShort') })]
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
    return el('p', { id: 'pilot-documents-empty', text: t('extraction.noStudies') });
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
      text: t('extraction.estimateSelectStudies'),
    });
  }
  if (hasZeroFieldsSelected(state.pilot.selectedFieldIds, fields)) {
    return el('p', {
      id: 'pilot-estimate',
      className: 'pilot__estimate',
      text: t('extraction.estimateSelectFields'),
    });
  }
  const estimateFields = filterFieldsBySelection(
    fields,
    resolveFieldIdsForRun(state.pilot.selectedFieldIds),
  );
  try {
    const plan = planRun({
      documents: selected,
      fields: estimateFields,
      model: state.pilot.model === '' ? 'unknown' : state.pilot.model,
      protocolContext: null,
      // 実行時に実際に効く値と揃える（プロバイダ非対応時は概算にも反映しない。issue #176）
      highAccuracyImages: resolveEffectiveHighAccuracyImages(
        state.pilot.model,
        state.pilot.highAccuracyImages,
      ),
    });
    const cost =
      plan.costEstimateUsd === null
        ? t('extraction.estimateUnavailable')
        : `$${plan.costEstimateUsd.toFixed(4)}`;
    const lines: HTMLElement[] = [
      el('p', {
        text: t('extraction.estimateLine', {
          cost,
          tokensIn: plan.tokensInEstimate.toLocaleString(),
          tokensOut: plan.tokensOutEstimate.toLocaleString(),
          batches: plan.batches.length,
        }),
      }),
      el('p', {
        className: 'pilot__estimate-note',
        text: t('extraction.estimateNote'),
      }),
    ];
    for (const warning of plan.warnings) {
      lines.push(
        el('p', {
          className: 'pilot__estimate-warning',
          text: t('extraction.estimateWarning', { warning }),
        }),
      );
    }
    return el('div', { id: 'pilot-estimate', className: 'pilot__estimate' }, lines);
  } catch (err) {
    return el('p', {
      id: 'pilot-estimate',
      className: 'pilot__estimate pilot__estimate--error',
      text: t('extraction.estimateError', { reason: err instanceof Error ? err.message : String(err) }),
    });
  }
}

/** 抽出対象フィールドのチェックリスト（issue #80）。スキーマ未読込時は何も出さない */
function renderFieldSelector(state: AppState, ctx: ViewContext): HTMLElement | null {
  const fields = state.schema.currentFields;
  if (fields === null || fields.length === 0) {
    return null;
  }
  return el('div', { className: 'pilot__field-selector' }, [
    el('h4', { text: t('extraction.fieldSelectorTitle') }),
    renderFieldSelectionChecklist({
      idPrefix: 'pilot',
      fields,
      selection: state.pilot.selectedFieldIds,
      collapsedSections: state.pilot.collapsedFieldSections,
      onToggleField: (fieldId, selected) => ctx.pilot.onToggleField(fieldId, selected),
      onToggleSection: (fieldIds, selected) => ctx.pilot.onToggleFieldSection(fieldIds, selected),
      onToggleCollapse: (section) => ctx.pilot.onToggleFieldSectionCollapse(section),
    }),
  ]);
}

function renderSetup(state: AppState, ctx: ViewContext): HTMLElement {
  const modelSelect = createModelSelect(document, {
    id: 'pilot-model',
    ariaLabel: t('schema.modelAria'),
    value: state.pilot.model,
    placeholderLabel: t('schema.modelPlaceholder'),
    onChange: (value) => ctx.pilot.onChangeModel(value),
    className: 'pilot__model-input',
  });

  const fields = state.schema.currentFields ?? [];
  const runButton = el('button', {
    id: 'pilot-run',
    className: 'pilot__run',
    text: t('pilot.run'),
    attributes: { type: 'button' },
  });
  runButton.disabled = hasZeroFieldsSelected(state.pilot.selectedFieldIds, fields);
  runButton.addEventListener('click', () => ctx.pilot.onRun());

  const fieldSelector = renderFieldSelector(state, ctx);
  const children: HTMLElement[] = [
    el('h3', { text: t('pilot.newTitle') }),
    el('p', {
      className: 'pilot__setup-lead',
      text: t('pilot.setupLead'),
    }),
    el('h4', { text: t('pilot.targetTitle') }),
    renderStudySelector(state, ctx),
    ...(fieldSelector === null ? [] : [fieldSelector]),
    el('div', { className: 'pilot__model' }, [
      el('label', { text: t('extraction.modelLabel'), attributes: { for: 'pilot-model' } }),
      modelSelect,
    ]),
    renderHighAccuracyToggle({
      idPrefix: 'pilot',
      checked: state.pilot.highAccuracyImages,
      model: state.pilot.model,
      onChange: (enabled) => ctx.pilot.onToggleHighAccuracyImages(enabled),
    }),
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
  let text = t('extraction.preparing');
  if (progress !== null) {
    bar.max = progress.totalBatches;
    bar.value = progress.completedBatches;
    const percent =
      progress.totalBatches > 0
        ? Math.floor((progress.completedBatches / progress.totalBatches) * 100)
        : 0;
    const label = studyLabelOf(state, progress.studyId);
    text = t('pilot.progressText', {
      completed: progress.completedBatches,
      total: progress.totalBatches,
      percent,
      label,
      sectionSuffix: progress.section === null ? '' : ` / ${progress.section}`,
    });
  }
  return el('section', { className: 'pilot__running', attributes: { 'aria-live': 'polite' } }, [
    el('h3', { text: t('extraction.runningTitle') }),
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
        text: t('pilot.failureLine', {
          study: studyLabelOf(state, failure.studyId),
          sectionSuffix: failure.section === null ? '' : ` / ${failure.section}`,
          reason: failure.reason,
          detail: failure.detail,
        }),
      }),
    );
    if (rejectedCount > 0) {
      failureItems.push(el('li', { text: t('extraction.rejectedCount', { n: rejectedCount }) }));
    }
    // 履歴から読み込んだ run は内訳を再構成できないため、空のときは案内を出す
    if (failureItems.length === 0) {
      failureItems.push(
        el('li', { text: t('pilot.failureUnknown') }),
      );
    }
    children.push(
      el('div', { id: 'pilot-partial-failure', className: 'pilot__partial-failure' }, [
        el('p', { text: t('pilot.partialFailureLead') }),
        el('ul', {}, failureItems),
      ]),
    );
  } else {
    children.push(
      el('p', { id: 'pilot-run-done', className: 'pilot__run-done', text: t('pilot.runDone') }),
    );
  }
  // 「表のデザインを改訂して再パイロット」導線は完了後は常に可視（ui-states.md §3）
  children.push(
    el('p', {}, [
      el('a', {
        id: 'pilot-revise-schema',
        className: 'pilot__revise-link',
        text: t('pilot.reviseSchema'),
        attributes: { href: '#/schema' },
      }),
    ]),
  );
  return el('section', { className: 'pilot__summary' }, children);
}

function renderVerification(run: ExtractionRun, state: AppState, ctx: ViewContext): HTMLElement {
  const children: HTMLElement[] = [el('h3', { text: t('pilot.verifyTitle') })];

  const select = el('select', {
    id: 'pilot-verify-study',
    attributes: { 'aria-label': t('verify.studyAria') },
  });
  // run は study 単位（studyIds）。配下の全文書を連結表示するため study を選ぶ（v0.10 フェーズ 3）
  const runStudyIds = new Set(run.studyIds);
  const verifyStudies = (state.documents.studies ?? []).filter((study) =>
    runStudyIds.has(study.studyId),
  );
  for (const study of verifyStudies) {
    const option = el('option', {
      text: study.studyLabel,
      attributes: { value: study.studyId },
    });
    select.append(option);
  }
  if (state.pilot.verifyStudyId !== null) {
    select.value = state.pilot.verifyStudyId;
  }
  select.addEventListener('change', () => ctx.pilot.onSelectVerifyStudy(select.value));
  const header: HTMLElement[] = [
    el('label', { text: t('verify.studyLabel'), attributes: { for: 'pilot-verify-study' } }),
    select,
  ];
  if (state.pilot.queuedDecisions > 0) {
    header.push(
      el('span', {
        id: 'pilot-queued',
        className: 'pilot__queued',
        text: t('verify.queued', { n: state.pilot.queuedDecisions }),
      }),
    );
  }
  children.push(el('div', { className: 'pilot__verify-header' }, header));

  if (state.pilot.verifyLoading) {
    children.push(el('p', { id: 'pilot-verify-loading', text: t('verify.dataLoading') }));
  } else if (state.pilot.verifyError !== null) {
    const retry = el('button', {
      id: 'pilot-verify-retry',
      text: t('common.retry'),
      attributes: { type: 'button' },
    });
    retry.addEventListener('click', () => ctx.pilot.onRetryVerifyLoad());
    children.push(
      el('p', {
        id: 'pilot-verify-error',
        className: 'pilot__error',
        attributes: { role: 'alert' },
        text: t('pilot.verifyError', { reason: state.pilot.verifyError }),
      }),
      retry,
    );
  } else if (state.pilot.verification !== null) {
    if (state.pilot.conflictMessage !== null) {
      children.push(
        renderConflictWarning(state.pilot.conflictMessage, () => ctx.pilot.onReloadVerification()),
      );
    }
    children.push(
      renderCachedVerificationPanel({
        data: state.pilot.verification,
        onDecision: (decision) => ctx.pilot.onDecision(decision),
        onArmConfirm: (arms) => ctx.pilot.onArmConfirm(arms),
        onInstanceDeclare: (decisions) => ctx.pilot.onInstanceDeclare?.(decisions),
        onRelocateQuote: (evidence) => ctx.pilot.onRelocateQuote(evidence),
        layoutMode: state.pilot.layoutMode,
        onLayoutModeChange: (mode) => ctx.pilot.onChangeLayoutMode(mode),
      }),
    );
  }
  return el('section', { className: 'pilot__verify' }, children);
}

/** 完了 run の status を履歴・サマリで表示するラベル（表示言語に追従） */
const RUN_STATUS_LABEL_KEYS: Record<string, MessageKey> = {
  done: 'pilot.runStatusDone',
  partial_failure: 'pilot.runStatusPartialFailure',
};

/**
 * 過去のパイロット結果の履歴セクション（S6）。読み込み中 / 失敗（再読み込み）/ 一覧を出す。
 * 履歴が空・未読込のときは null を返し、初回ユーザー（過去 run なし）には出さない
 */
function renderHistory(state: AppState, ctx: ViewContext): HTMLElement | null {
  const { history, historyLoading, historyError, loadingRunId, run } = state.pilot;
  if (historyLoading) {
    return el('section', { className: 'pilot__history' }, [
      el('h3', { text: t('pilot.historyTitle') }),
      el('p', {
        id: 'pilot-history-loading',
        text: t('pilot.historyLoading'),
      }),
    ]);
  }
  if (historyError !== null) {
    const reload = el('button', {
      id: 'pilot-history-reload',
      text: t('common.reload'),
      attributes: { type: 'button' },
    });
    reload.addEventListener('click', () => ctx.pilot.onReloadHistory());
    return el('section', { className: 'pilot__history' }, [
      el('h3', { text: t('pilot.historyTitle') }),
      el('p', {
        id: 'pilot-history-error',
        className: 'pilot__error',
        attributes: { role: 'alert' },
        text: t('pilot.historyError', { reason: historyError }),
      }),
      reload,
    ]);
  }
  if (history === null || history.length === 0) {
    return null;
  }
  const items = history.map((entry) => {
    const isCurrent = run?.runId === entry.runId;
    const when = entry.finishedAt ?? entry.startedAt ?? t('pilot.whenUnknown');
    const statusKey = RUN_STATUS_LABEL_KEYS[entry.status];
    const statusLabel = statusKey === undefined ? entry.status : t(statusKey);
    const open = el(
      'button',
      { className: 'pilot__history-open', attributes: { type: 'button' } },
      [
        el('span', { className: 'pilot__history-when', text: when }),
        el('span', { className: 'pilot__history-model', text: entry.requestedModel }),
        el('span', {
          className: 'pilot__history-docs',
          text: t('pilot.historyStudies', { n: entry.studyIds.length }),
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
      parts.push(el('span', { className: 'pilot__history-current', text: t('pilot.historyCurrent') }));
    } else if (loadingRunId === entry.runId) {
      parts.push(el('span', { className: 'pilot__history-note', text: t('common.loading') }));
    }
    const item = el('li', { className: 'pilot__history-item' }, parts);
    if (isCurrent) {
      item.setAttribute('aria-current', 'true');
    }
    return item;
  });
  return el('section', { className: 'pilot__history' }, [
    el('h3', { text: t('pilot.historyTitle') }),
    el('p', {
      className: 'pilot__history-lead',
      text: t('pilot.historyLead'),
    }),
    el('ul', { id: 'pilot-history', className: 'pilot__history-list' }, items),
  ]);
}

export function renderPilotView(state: AppState, ctx: ViewContext): HTMLElement {
  const children: HTMLElement[] = [
    el('h2', { text: t('app.navPilot') }),
    el('p', {
      className: 'view__lead',
      text: t('pilot.lead'),
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
