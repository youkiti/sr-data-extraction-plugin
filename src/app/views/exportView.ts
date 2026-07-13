// #/export: エクスポート（S10 / ui-states.md §3）。
// 状態: 読み込み中 / 読み込み失敗 / 通常（形式選択 + サマリ + プレビュー + 生成ボタン
// + 論文 Methods 記載例カード）+ 未検証セル警告ダイアログ / 生成中 / 生成失敗 / 生成完了カード。
// R セット（issue #60・design-r-export.md）は 8 ファイルを一括生成する第 4 の形式で、
// サマリ・プレビュー・結果カードは従来 3 形式と別レンダリング（renderRSet* 系）を使う
import type { ExportFormat } from '../../domain/exportLog';
import type { BuiltExport } from '../../features/export/buildExport';
import { PREVIEW_ROW_LIMIT } from '../../features/export/buildExport';
import {
  buildMethodsText,
  type MethodsLanguage,
  type MethodsWorkflow,
} from '../../features/export/methodsBoilerplate';
import { parseCsv } from '../../features/export/parseCsv';
import type { BuiltRSet, RSetFile } from '../../features/export/rset/buildRSet';
import { countRSetUnverifiedCells, rSetDataRowCount } from '../../features/export/rset/buildRSet';
import { t, type MessageKey } from '../../lib/i18n';
import { el } from '../ui/dom';
import type { AppState, ExportState } from '../store';
import type { ViewContext } from './types';

/** 形式選択ラジオの表示順と用途説明（requirements.md §4.4 の用途列。ラベルは描画時に解決） */
const FORMAT_OPTIONS: ReadonlyArray<{
  format: ExportFormat;
  /** ファイル名はコード用語のため翻訳せず、R セットだけ辞書キーで解決する */
  label: string | null;
  labelKey: MessageKey | null;
  descriptionKey: MessageKey;
}> = [
  {
    format: 'study_wide',
    label: 'study_wide.csv',
    labelKey: null,
    descriptionKey: 'export.formatStudyWideDesc',
  },
  {
    format: 'results_long',
    label: 'results_long.csv',
    labelKey: null,
    descriptionKey: 'export.formatResultsLongDesc',
  },
  {
    format: 'audit',
    label: 'audit.csv',
    labelKey: null,
    descriptionKey: 'export.formatAuditDesc',
  },
  {
    format: 'r_set',
    label: null,
    labelKey: 'export.formatRSetLabel',
    descriptionKey: 'export.formatRSetDesc',
  },
];

function renderFormatSelector(exportState: ExportState, ctx: ViewContext): HTMLElement {
  const options = FORMAT_OPTIONS.map((option) => {
    const input = el('input', {
      attributes: { type: 'radio', name: 'export-format', value: option.format },
    });
    input.checked = exportState.format === option.format;
    input.disabled = exportState.generating;
    input.addEventListener('change', () => ctx.export.onSelectFormat(option.format));
    return el('label', { className: 'export__format-option' }, [
      input,
      el('span', {
        className: 'export__format-label',
        text: option.labelKey === null ? (option.label as string) : t(option.labelKey),
      }),
      el('span', { className: 'export__format-description', text: t(option.descriptionKey) }),
    ]);
  });
  return el(
    'fieldset',
    { id: 'export-format', className: 'export__formats' },
    [el('legend', { text: t('export.formatLegend') }), ...options],
  );
}

function renderSummary(built: BuiltExport): HTMLElement {
  const item = (label: string, value: string): HTMLElement[] => [
    el('dt', { text: label }),
    el('dd', { text: value }),
  ];
  return el('dl', { id: 'export-summary', className: 'export__summary' }, [
    ...item(t('export.summaryRows'), String(built.rowCount)),
    ...item(t('export.summaryStudies'), String(built.studyCount)),
    // results_long は未検証の概念がないため「—」（ui-states.md §3）
    ...item(
      t('export.summaryUnverified'),
      built.unverifiedCellCount === null ? '—' : String(built.unverifiedCellCount),
    ),
  ]);
}

function renderExclusionNotes(built: BuiltExport): HTMLElement[] {
  const notes: HTMLElement[] = [];
  if (built.skippedStudyLabels.length > 0) {
    notes.push(
      el('p', {
        id: 'export-skipped',
        className: 'export__exclusion',
        text: t('export.skippedNote', { labels: built.skippedStudyLabels.join('、') }),
      }),
    );
  }
  if (built.droppedRowCount > 0) {
    notes.push(
      el('p', {
        id: 'export-dropped',
        className: 'export__exclusion',
        text: t('export.droppedNote', { n: built.droppedRowCount }),
      }),
    );
  }
  return notes;
}

/** プレビューテーブルの入力（BuiltExport / R セットの 1 ファイル分の CSV パース結果、どちらも満たす形） */
interface PreviewData {
  header: string[];
  previewRows: string[][];
  rowCount: number;
}

function renderPreview(data: PreviewData, tableId = 'export-preview'): HTMLElement[] {
  const headRow = el(
    'tr',
    {},
    data.header.map((name) => el('th', { text: name, attributes: { scope: 'col' } })),
  );
  const bodyRows = data.previewRows.map((row) =>
    el('tr', {}, row.map((value) => el('td', { text: value }))),
  );
  const table = el('table', { id: tableId, className: 'export__preview' }, [
    el('caption', {
      className: 'export__preview-caption',
      text: t('export.previewCaption', { shown: data.previewRows.length, total: data.rowCount }),
    }),
    el('thead', {}, [headRow]),
    el('tbody', {}, bodyRows),
  ]);
  const parts: HTMLElement[] = [el('div', { className: 'export__preview-wrap' }, [table])];
  const rest = data.rowCount - data.previewRows.length;
  if (rest > 0) {
    // tableId が既定の 'export-preview' のときは従来どおり 'export-preview-more' になる
    parts.push(el('p', { id: `${tableId}-more`, text: t('export.previewMore', { n: rest }) }));
  }
  return parts;
}

/** 未検証セル残存の警告ダイアログ（従来 3 形式 / R セット共通。n と補足注記だけが違う） */
function renderWarningDialog(
  ctx: ViewContext,
  unverifiedCount: number,
  extraNote: string | null,
): HTMLElement {
  const continueButton = el('button', {
    id: 'export-warning-continue',
    text: t('export.warningContinue'),
    attributes: { type: 'button' },
  });
  continueButton.addEventListener('click', () => ctx.export.onConfirmGenerate());
  const cancelButton = el('button', {
    id: 'export-warning-cancel',
    text: t('export.warningCancel'),
    attributes: { type: 'button' },
  });
  cancelButton.addEventListener('click', () => ctx.export.onCancelGenerate());
  const children: HTMLElement[] = [
    el('h3', {
      id: 'export-warning-title',
      text: t('export.warningTitle', { n: unverifiedCount }),
    }),
    el('p', {
      className: 'export__warning-note',
      text: t('export.warningSubsetNote'),
    }),
  ];
  if (extraNote !== null) {
    children.push(el('p', { text: extraNote }));
  }
  children.push(el('div', { className: 'export__confirm-actions' }, [continueButton, cancelButton]));
  return el(
    'div',
    {
      id: 'export-warning',
      className: 'export__confirm',
      attributes: { role: 'alertdialog', 'aria-labelledby': 'export-warning-title' },
    },
    children,
  );
}

/** 言語タブ 1 個（English / 日本語） */
function renderMethodsLangTab(
  id: string,
  label: string,
  language: MethodsLanguage,
  current: MethodsLanguage,
  ctx: ViewContext,
): HTMLButtonElement {
  const button = el('button', {
    id,
    className: 'export__methods-tab',
    text: label,
    attributes: { type: 'button', 'aria-pressed': String(language === current) },
  }) as HTMLButtonElement;
  button.addEventListener('click', () => ctx.export.onChangeMethodsLanguage(language));
  return button;
}

/** ワークフロートグル 1 個（単一レビュアー / 二重独立） */
function renderMethodsWorkflowTab(
  id: string,
  label: string,
  workflow: MethodsWorkflow,
  current: MethodsWorkflow,
  ctx: ViewContext,
): HTMLButtonElement {
  const button = el('button', {
    id,
    className: 'export__methods-tab',
    text: label,
    attributes: { type: 'button', 'aria-pressed': String(workflow === current) },
  }) as HTMLButtonElement;
  button.addEventListener('click', () => ctx.export.onChangeMethodsWorkflow(workflow));
  return button;
}

/**
 * 論文 Methods 記載例カード（S10。docs/methods-boilerplate.md §4、issue #67）。
 * methodsFacts が未読込（loadExportData がまだ実行されていない防御）なら描画しない
 */
function renderMethodsCard(exportState: ExportState, ctx: ViewContext): HTMLElement | null {
  const facts = exportState.methodsFacts;
  if (facts === null) {
    return null;
  }
  const { text, unresolved } = buildMethodsText(
    exportState.methodsLanguage,
    exportState.methodsWorkflow,
    facts,
  );

  const langGroup = el(
    'div',
    { className: 'export__methods-tabs', attributes: { role: 'group', 'aria-label': t('export.methodsLangAria') } },
    [
      renderMethodsLangTab('methods-lang-en', 'English', 'en', exportState.methodsLanguage, ctx),
      renderMethodsLangTab('methods-lang-ja', '日本語', 'ja', exportState.methodsLanguage, ctx),
    ],
  );
  const workflowGroup = el(
    'div',
    { className: 'export__methods-tabs', attributes: { role: 'group', 'aria-label': t('export.methodsWorkflowAria') } },
    [
      renderMethodsWorkflowTab(
        'methods-workflow-single',
        t('export.methodsWorkflowSingle'),
        'single',
        exportState.methodsWorkflow,
        ctx,
      ),
      renderMethodsWorkflowTab(
        'methods-workflow-dual',
        t('export.methodsWorkflowDual'),
        'dual',
        exportState.methodsWorkflow,
        ctx,
      ),
    ],
  );

  const textArea = el('textarea', {
    id: 'methods-text',
    className: 'export__methods-text',
    attributes: { readonly: 'readonly', rows: '8', 'aria-label': t('export.methodsTitle') },
  });
  textArea.value = text;

  const copyButton = el('button', {
    id: 'methods-copy',
    text: t('export.methodsCopy'),
    attributes: { type: 'button' },
  });
  copyButton.addEventListener('click', () => ctx.export.onCopyMethods());

  const children: HTMLElement[] = [
    el('h3', { text: t('export.methodsTitle') }),
    el('div', { className: 'export__methods-controls' }, [langGroup, workflowGroup]),
    textArea,
    copyButton,
  ];
  if (unresolved.length > 0) {
    children.push(
      el('p', {
        id: 'methods-unresolved-note',
        className: 'export__methods-note',
        text: t('export.methodsUnresolvedNote'),
      }),
    );
  }
  return el('section', { id: 'export-methods', className: 'export__methods' }, children);
}

/** ファイル別行数の一覧（R セットのサマリ・結果カード共通。manifest は行数の概念が無いため「—」） */
function renderRSetFileList(files: readonly RSetFile[], listId: string): HTMLElement {
  const items = files.map((file) =>
    el('li', {
      text: file.name.endsWith('.json')
        ? file.name
        : t('export.rsetFileRow', { name: file.name, rows: file.rowCount }),
    }),
  );
  return el('ul', { id: listId, className: 'export__rset-files' }, items);
}

/** R セットのサマリ（issue #60。ファイル一覧 + データ行数 + 未検証セル数 + export_issues 件数） */
function renderRSetSummary(rSet: BuiltRSet): HTMLElement {
  const item = (label: string, value: string): HTMLElement[] => [
    el('dt', { text: label }),
    el('dd', { text: value }),
  ];
  const issuesFile = rSet.files.find((file) => file.name === 'export_issues.csv') as RSetFile;
  const summary = el('dl', { id: 'export-rset-summary', className: 'export__summary' }, [
    ...item(t('export.summaryFiles'), String(rSet.files.length)),
    ...item(t('export.summaryRows'), String(rSetDataRowCount(rSet))),
    ...item(t('export.summaryUnverified'), String(countRSetUnverifiedCells(rSet))),
    ...item(t('export.summaryIssues'), String(issuesFile.rowCount)),
  ]);
  return el('div', { className: 'export__rset-summary-wrap' }, [
    summary,
    renderRSetFileList(rSet.files, 'export-rset-files'),
  ]);
}

/** R セットのプレビュー: ma.csv のヘッダ + 先頭 10 行（8 ファイルのうち最も参照頻度が高い解析単位表） */
function renderRSetPreview(rSet: BuiltRSet): HTMLElement[] {
  const maFile = rSet.files.find((file) => file.name === 'ma.csv') as RSetFile;
  const records = parseCsv(maFile.content);
  const data: PreviewData = {
    header: records[0] as string[], // buildCsv は常にヘッダ行を先頭に出す
    previewRows: records.slice(1, 1 + PREVIEW_ROW_LIMIT),
    rowCount: maFile.rowCount,
  };
  return [el('h3', { text: t('export.rsetPreviewTitle') }), ...renderPreview(data, 'export-rset-preview')];
}

// CSV は UTF-8 BOM なし（D-6）のため、Excel でそのまま開くと文字化けしうる初心者向け案内文
// （export.rsetUtf8Note。表示言語に追従させるため描画時に t() で解決する）

function renderRSetResultCard(exportState: ExportState, ctx: ViewContext): HTMLElement {
  const result = exportState.rSetResult as NonNullable<ExportState['rSetResult']>;
  const downloadButton = el('button', {
    id: 'export-rset-download',
    text: t('export.rsetDownload'),
    attributes: { type: 'button' },
  });
  downloadButton.addEventListener('click', () => ctx.export.onDownload());
  return el('div', { id: 'export-rset-result', className: 'export__result' }, [
    el('p', {
      text: t('export.rsetSaved', { folder: result.folderName }),
    }),
    el('a', {
      id: 'export-rset-result-link',
      text: t('export.openInDrive'),
      attributes: { href: result.folderRef, target: '_blank', rel: 'noopener' },
    }),
    renderRSetFileList(result.built.files, 'export-rset-result-files'),
    downloadButton,
    el('p', { id: 'export-rset-utf8-note', className: 'export__note', text: t('export.rsetUtf8Note') }),
  ]);
}

function renderResultCard(exportState: ExportState, ctx: ViewContext): HTMLElement {
  const result = exportState.result as NonNullable<ExportState['result']>;
  const downloadButton = el('button', {
    id: 'export-download',
    text: t('export.download'),
    attributes: { type: 'button' },
  });
  downloadButton.addEventListener('click', () => ctx.export.onDownload());
  return el('div', { id: 'export-result', className: 'export__result' }, [
    el('p', { text: t('export.saved', { filename: result.filename }) }),
    el('a', {
      id: 'export-result-link',
      text: t('export.openInDrive'),
      attributes: { href: result.fileRef, target: '_blank', rel: 'noopener' },
    }),
    downloadButton,
  ]);
}

export function renderExportView(state: AppState, ctx: ViewContext): HTMLElement {
  const children: Array<HTMLElement | string> = [
    el('h2', { text: t('app.navExport') }),
    el('p', {
      className: 'view__lead',
      text: t('export.lead'),
    }),
  ];
  const exportState = state.export;

  if (exportState.loadError !== null) {
    const reload = el('button', {
      id: 'export-reload',
      text: t('common.reload'),
      attributes: { type: 'button' },
    });
    reload.addEventListener('click', () => ctx.export.onReload());
    children.push(
      el('p', {
        id: 'export-load-error',
        className: 'export__error',
        attributes: { role: 'alert' },
        text: t('export.loadError', { reason: exportState.loadError }),
      }),
      reload,
    );
    return el('section', { className: 'view view--export' }, children);
  }

  if (exportState.built === null || exportState.loading) {
    children.push(el('p', { id: 'export-loading', text: t('export.loading') }));
    return el('section', { className: 'view view--export' }, children);
  }

  children.push(renderFormatSelector(exportState, ctx));
  const methodsCard = renderMethodsCard(exportState, ctx);
  if (methodsCard !== null) {
    children.push(methodsCard);
  }

  if (exportState.format === 'r_set') {
    // rSet は built と同じ patchExport 呼び出しで常に同時に設定されるため、built !== null な
    // ここでは必ず非 null（NonNullable キャストは renderResultCard と同じ既存パターンに揃える）
    const rSet = exportState.rSet as NonNullable<ExportState['rSet']>;
    children.push(renderRSetSummary(rSet));
    children.push(...renderRSetPreview(rSet));

    const dataRowCount = rSetDataRowCount(rSet);
    if (dataRowCount === 0) {
      children.push(
        el('p', {
          className: 'export__empty-note',
          text: t('export.emptyRSet'),
        }),
      );
    }
    const generateButton = el('button', {
      id: 'export-generate',
      className: 'export__generate',
      text: t('export.generateRSet'),
      attributes: { type: 'button' },
    });
    generateButton.disabled = exportState.generating || dataRowCount === 0;
    generateButton.addEventListener('click', () => ctx.export.onGenerate());
    children.push(generateButton);

    if (exportState.confirmingWarning) {
      children.push(
        renderWarningDialog(
          ctx,
          countRSetUnverifiedCells(rSet),
          t('export.warningRSetNote'),
        ),
      );
    }
    if (exportState.generating) {
      children.push(
        el('p', { id: 'export-generating', text: t('export.generatingRSet') }),
      );
    }
    if (exportState.generateError !== null) {
      children.push(
        el('p', {
          id: 'export-generate-error',
          className: 'export__error',
          attributes: { role: 'alert' },
          text: t('export.generateError', { reason: exportState.generateError }),
        }),
      );
    }
    if (exportState.rSetResult !== null) {
      children.push(renderRSetResultCard(exportState, ctx));
    }
    return el('section', { className: 'view view--export' }, children);
  }

  const built = exportState.built[exportState.format];
  children.push(renderSummary(built));
  children.push(...renderExclusionNotes(built));
  children.push(...renderPreview(built));

  if (built.rowCount === 0) {
    children.push(
      el('p', {
        className: 'export__empty-note',
        text: t('export.empty'),
      }),
    );
  }
  const generateButton = el('button', {
    id: 'export-generate',
    className: 'export__generate',
    text: t('export.generate'),
    attributes: { type: 'button' },
  });
  generateButton.disabled = exportState.generating || built.rowCount === 0;
  generateButton.addEventListener('click', () => ctx.export.onGenerate());
  children.push(generateButton);

  if (exportState.confirmingWarning) {
    children.push(
      renderWarningDialog(
        ctx,
        built.unverifiedCellCount ?? 0,
        built.format === 'audit' ? t('export.warningAuditNote') : null,
      ),
    );
  }
  if (exportState.generating) {
    children.push(
      el('p', { id: 'export-generating', text: t('export.generating') }),
    );
  }
  if (exportState.generateError !== null) {
    children.push(
      el('p', {
        id: 'export-generate-error',
        className: 'export__error',
        attributes: { role: 'alert' },
        text: t('export.generateError', { reason: exportState.generateError }),
      }),
    );
  }
  if (exportState.result !== null) {
    children.push(renderResultCard(exportState, ctx));
  }
  return el('section', { className: 'view view--export' }, children);
}
