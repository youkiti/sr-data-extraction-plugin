// #/extract: 一括抽出（S7 / ui-states.md §3・v0.10 study / document）。
// 状態: 読み込み中 / 読み込み失敗 / 未実行（対象 study 選択 + コスト概算 + 実行）/
// 実行確認カード / 実行中（study 単位の進捗リスト）/ 完了（done / partial_failure + 再試行）
import type { DocumentRecord } from '../../domain/document';
import type { RunWarning } from '../../domain/extractionRun';
import {
  buildStudySelection,
  documentsForStudies,
  type StudySelectionItem,
} from '../../features/documents/studySelection';
import type { StudyRecord } from '../../domain/study';
import { studyLabelMap } from '../../features/documents/studyRepository';
import {
  filterFieldsBySelection,
  resolveFieldIdsForRun,
} from '../../features/extraction/fieldSelection';
import type { ExtractStudyRow, ExtractStudyStatus } from '../../features/extraction/studyProgress';
import { planRun } from '../../features/extraction/planRun';
import { t, type MessageKey } from '../../lib/i18n';
import { resolveEffectiveHighAccuracyImages } from '../../lib/llm/providerFactory';
import { el } from '../ui/dom';
import { createModelSelect } from '../ui/modelSelect';
import type { AppState } from '../store';
import {
  fieldSelectionSummaryText,
  hasZeroFieldsSelected,
  renderFieldSelectionChecklist,
} from './fieldSelectionChecklist';
import { renderHighAccuracyToggle } from './highAccuracyToggle';
import type { ViewContext } from './types';

// 表示言語に追従させるため、ラベルは描画時に t() で解決する（キー対応表のみ固定。issue #93）
const STATUS_LABEL_KEYS: Readonly<Record<ExtractStudyStatus, MessageKey>> = {
  queued: 'extract.statusQueued',
  running: 'extract.statusRunning',
  done: 'extract.statusDone',
  failed: 'extract.statusFailed',
};

const DOCUMENT_ROLE_LABEL_KEYS: Readonly<Record<DocumentRecord['documentRole'], MessageKey>> = {
  article: 'documents.roleArticle',
  registration: 'documents.roleRegistration',
  protocol: 'documents.roleProtocol',
  abstract: 'documents.roleAbstractShort',
  supplement: 'documents.roleSupplementShort',
  other: 'documents.roleOther',
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
      attributes: {
        type: 'checkbox',
        'aria-label': t('extraction.studyToggleAria', { label: item.study.studyLabel }),
      },
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
      // サブセット run（fieldIds ≠ null）が直近なら「直近 run は n/m 項目」を添える（issue #80）
      const badge = state.extract.fieldSubsetBadges[studyId];
      const text =
        badge === undefined
          ? t('extract.extracted')
          : t('extract.extractedSubset', { selected: badge.selected, total: badge.total });
      head.push(el('span', { className: 'extract__doc-extracted', text }));
    }
    if (!item.hasTextLayer) {
      head.push(
        el('small', {
          className: 'extract__doc-note',
          text: t('extraction.noTextLayerNote'),
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
            text: t(DOCUMENT_ROLE_LABEL_KEYS[doc.documentRole]),
          }),
          el('span', { className: 'extract__doc-filename', text: doc.filename }),
          ...(doc.textStatus === 'no_text_layer'
            ? [el('small', { className: 'extract__doc-note', text: t('extraction.noTextLayerShort') })]
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
      text: t('extraction.noStudies'),
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
      text: t('extraction.estimateSelectStudies'),
    });
  }
  if (hasZeroFieldsSelected(state.extract.selectedFieldIds, fields)) {
    return el('p', {
      id: 'extract-estimate',
      className: 'extract__estimate',
      text: t('extraction.estimateSelectFields'),
    });
  }
  const estimateFields = filterFieldsBySelection(
    fields,
    resolveFieldIdsForRun(state.extract.selectedFieldIds),
  );
  try {
    const plan = planRun({
      documents: selected,
      fields: estimateFields,
      model: state.extract.model === '' ? 'unknown' : state.extract.model,
      protocolContext: null,
      // 実行時に実際に効く値と揃える（プロバイダ非対応時は概算にも反映しない。issue #176）
      highAccuracyImages: resolveEffectiveHighAccuracyImages(
        state.extract.model,
        state.extract.highAccuracyImages,
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
        className: 'extract__estimate-note',
        text: t('extraction.estimateNote'),
      }),
    ];
    for (const warning of plan.warnings) {
      lines.push(
        el('p', {
          className: 'extract__estimate-warning',
          text: t('extraction.estimateWarning', { warning }),
        }),
      );
    }
    return el('div', { id: 'extract-estimate', className: 'extract__estimate' }, lines);
  } catch (err) {
    return el('p', {
      id: 'extract-estimate',
      className: 'extract__estimate extract__estimate--error',
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
  return el('div', { className: 'extract__field-selector' }, [
    el('h3', { text: t('extraction.fieldSelectorTitle') }),
    renderFieldSelectionChecklist({
      idPrefix: 'extract',
      fields,
      selection: state.extract.selectedFieldIds,
      collapsedSections: state.extract.collapsedFieldSections,
      onToggleField: (fieldId, selected) => ctx.extract.onToggleField(fieldId, selected),
      onToggleSection: (fieldIds, selected) => ctx.extract.onToggleFieldSection(fieldIds, selected),
      onToggleCollapse: (section) => ctx.extract.onToggleFieldSectionCollapse(section),
    }),
  ]);
}

function renderSetup(state: AppState, ctx: ViewContext): HTMLElement {
  const modelSelect = createModelSelect(document, {
    id: 'extract-model',
    ariaLabel: t('schema.modelAria'),
    value: state.extract.model,
    placeholderLabel: t('schema.modelPlaceholder'),
    onChange: (value) => ctx.extract.onChangeModel(value),
    className: 'extract__model-input',
  });

  const fields = state.schema.currentFields ?? [];
  const runButton = el('button', {
    id: 'extract-run',
    className: 'extract__run',
    text: t('extract.run'),
    attributes: { type: 'button' },
  });
  runButton.disabled =
    state.extract.confirming ||
    state.extract.retryingStudyId !== null ||
    hasZeroFieldsSelected(state.extract.selectedFieldIds, fields);
  runButton.addEventListener('click', () => ctx.extract.onRequestRun());

  const fieldSelector = renderFieldSelector(state, ctx);
  const children: HTMLElement[] = [
    el('h3', { text: t('extract.targetTitle') }),
    renderStudySelector(state, ctx),
    ...(fieldSelector === null ? [] : [fieldSelector]),
    el('div', { className: 'extract__model' }, [
      el('label', { text: t('extraction.modelLabel'), attributes: { for: 'extract-model' } }),
      modelSelect,
    ]),
    renderHighAccuracyToggle({
      idPrefix: 'extract',
      checked: state.extract.highAccuracyImages,
      model: state.extract.model,
      onChange: (enabled) => ctx.extract.onToggleHighAccuracyImages(enabled),
    }),
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
    text: t('extract.confirmRun'),
    attributes: { type: 'button' },
  });
  confirmButton.addEventListener('click', () => ctx.extract.onConfirmRun());
  const cancelButton = el('button', {
    id: 'extract-confirm-cancel',
    text: t('common.cancel'),
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
      el('h4', { id: 'extract-confirm-title', text: t('extract.confirmTitle') }),
      el('p', {
        text: t('extract.confirmBody', {
          count: state.extract.selectedStudyIds.length,
          model: state.extract.model,
        }),
      }),
      el('p', {
        id: 'extract-confirm-fields',
        text: t('fieldSelection.summary', {
          summary: fieldSelectionSummaryText(
            state.extract.selectedFieldIds,
            state.schema.currentFields ?? [],
          ),
        }),
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
        text: t(STATUS_LABEL_KEYS[row.status]),
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
          text: t('extract.batchProgress', {
            completed: row.completedBatches,
            total: row.totalBatches,
          }),
        }),
      );
    }
    if (row.detail !== null) {
      parts.push(el('span', { className: 'extract__doc-detail', text: row.detail }));
    }
    if (withRetry && row.status === 'failed') {
      const retryButton = el('button', {
        className: 'extract__retry',
        text: t('common.retry'),
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
  const lines = [
    el('p', {
      id: 'extract-doc-summary',
      className: 'extract__doc-summary',
      text: t('extract.positionSummary', {
        done: doneCount,
        failedSuffix: failedCount > 0 ? t('extract.positionFailed', { n: failedCount }) : '',
        total: rows.length,
      }),
    }),
  ];
  const runningIndex = rows.findIndex((row) => row.status === 'running');
  if (runningIndex >= 0) {
    const running = rows[runningIndex] as ExtractStudyRow;
    lines.push(
      el('p', {
        id: 'extract-current-doc',
        className: 'extract__current-doc',
        text: t('extract.currentDoc', {
          label: studyLabelOf(state, running.studyId),
          index: runningIndex + 1,
          completed: running.completedBatches,
          total: running.totalBatches,
        }),
      }),
    );
  }
  return lines;
}

function renderProgress(state: AppState, ctx: ViewContext): HTMLElement {
  const { progress } = state.extract;
  const bar = el('progress', { id: 'extract-progress', className: 'extract__progress-bar' });
  let text = t('extraction.preparing');
  if (progress !== null) {
    bar.max = progress.totalBatches;
    bar.value = progress.completedBatches;
    const percent =
      progress.totalBatches > 0
        ? Math.floor((progress.completedBatches / progress.totalBatches) * 100)
        : 0;
    text = t('extract.progressText', {
      completed: progress.completedBatches,
      total: progress.totalBatches,
      percent,
    });
  }
  return el('section', { className: 'extract__running', attributes: { 'aria-live': 'polite' } }, [
    el('h3', { text: t('extraction.runningTitle') }),
    bar,
    el('p', { className: 'extract__progress-text', text }),
    ...renderRunPosition(state),
    renderStudyRows(state, ctx, false),
  ]);
}

/**
 * arm completeness 警告 1 件の表示行（issue #106）。study_label + section + 欠落一覧。
 * 項目名は現行スキーマの field_id → field_name で解決する（見つからなければ id のまま）
 */
function armWarningLineOf(state: AppState, warning: RunWarning): string {
  const fieldNameById = new Map(
    (state.schema.currentFields ?? []).map((field) => [field.fieldId, field.fieldName]),
  );
  const scope =
    warning.section === null ? '' : t('extract.armWarningScope', { section: warning.section });
  const missing = warning.missingItems
    .map((item) => `${item.armKey} × ${fieldNameById.get(item.fieldId) ?? item.fieldId}`)
    .join('、');
  return t('extract.armWarningLine', {
    study: studyLabelOf(state, warning.studyId),
    scope,
    missing,
  });
}

/**
 * arm completeness 警告バナー（issue #106・#extract-arm-warnings）。
 * warning のみ（run の status には影響しない）ため、done / partial_failure の両方で出す
 */
function renderArmWarnings(state: AppState): HTMLElement | null {
  const warnings = state.extract.armWarnings;
  if (warnings.length === 0) {
    return null;
  }
  return el(
    'div',
    {
      id: 'extract-arm-warnings',
      className: 'extract__arm-warnings',
      attributes: { role: 'status' },
    },
    [
      el('p', {
        text: t('extract.armWarningsLead', { n: warnings.length }),
      }),
      el(
        'ul',
        {},
        warnings.map((warning) => el('li', { text: armWarningLineOf(state, warning) })),
      ),
    ],
  );
}

function renderSummary(state: AppState, ctx: ViewContext): HTMLElement {
  const failedCount = state.extract.studyRows.filter((row) => row.status === 'failed').length;
  const children: HTMLElement[] = [el('h3', { text: t('extract.resultTitle') })];
  if (failedCount > 0) {
    const lines: HTMLElement[] = [
      el('p', { text: t('extract.failedSummary', { n: failedCount }) }),
    ];
    if (state.extract.rejectedCount > 0) {
      lines.push(el('p', { text: t('extraction.rejectedCount', { n: state.extract.rejectedCount }) }));
    }
    children.push(
      el('div', { id: 'extract-partial-failure', className: 'extract__partial-failure' }, lines),
    );
  } else {
    children.push(
      el('p', {
        id: 'extract-run-done',
        className: 'extract__run-done',
        text: t('extract.runDone'),
      }),
    );
    if (state.extract.rejectedCount > 0) {
      children.push(
        el('p', {
          className: 'extract__rejected-note',
          text: t('extract.rejectedNote', { n: state.extract.rejectedCount }),
        }),
      );
    }
  }
  const armWarnings = renderArmWarnings(state);
  if (armWarnings !== null) {
    children.push(armWarnings);
  }
  children.push(
    renderStudyRows(state, ctx, true),
    el('p', {}, [
      el('a', {
        id: 'extract-verify-link',
        className: 'extract__verify-link',
        text: t('extract.goVerify'),
        attributes: { href: '#/verify' },
      }),
    ]),
  );
  return el('section', { className: 'extract__summary' }, children);
}

export function renderExtractView(state: AppState, ctx: ViewContext): HTMLElement {
  const children: HTMLElement[] = [
    el('h2', { text: t('app.navExtract') }),
    el('p', {
      className: 'view__lead',
      text: t('extract.lead'),
    }),
  ];
  const { extract, documents, counts } = state;

  if (documents.loadError !== null || extract.loadError !== null) {
    const reloadButton = el('button', {
      id: 'extract-reload',
      text: t('common.reload'),
      attributes: { type: 'button' },
    });
    reloadButton.addEventListener('click', () => ctx.extract.onReloadTargets());
    children.push(
      el('p', {
        id: 'extract-load-error',
        className: 'extract__error',
        attributes: { role: 'alert' },
        // このガードは documents.loadError / extract.loadError のいずれかが非 null のときだけ通る
        text: t('extract.loadError', { reason: String(documents.loadError ?? extract.loadError) }),
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
    children.push(el('p', { id: 'extract-loading', text: t('extract.loading') }));
    return el('section', { className: 'view view--extract' }, children);
  }

  if (counts.pilotRuns < 1) {
    children.push(
      el('p', {
        id: 'extract-pilot-warning',
        className: 'extract__pilot-warning',
        text: t('extract.pilotWarning'),
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
        text: t('extract.interruptedWarning', { n: interruptedRemaining.length }),
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
