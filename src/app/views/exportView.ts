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
import { el } from '../ui/dom';
import type { AppState, ExportState } from '../store';
import type { ViewContext } from './types';

/** 形式選択ラジオの表示順と用途説明（requirements.md §4.4 の用途列） */
const FORMAT_OPTIONS: ReadonlyArray<{
  format: ExportFormat;
  label: string;
  description: string;
}> = [
  {
    format: 'study_wide',
    label: 'study_wide.csv',
    description: '1 行 = 1 study。Table 1 の下書き・Excel での目視確認に',
  },
  {
    format: 'results_long',
    label: 'results_long.csv',
    description: '1 行 = 1 結果セル。R でのメタ解析前処理（arm 別アウトカム・RoB）に',
  },
  {
    format: 'audit',
    label: 'audit.csv',
    description: '1 行 = 1 判定イベント + AI 根拠。監査・supplementary・抽出精度研究に',
  },
  {
    format: 'r_set',
    label: 'R セット（推奨）',
    description:
      'tab1 / ma / rob 等 7 CSV + manifest の 8 ファイル。R (readr) でそのまま読める自己記述的な解析用データセット',
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
      el('span', { className: 'export__format-label', text: option.label }),
      el('span', { className: 'export__format-description', text: option.description }),
    ]);
  });
  return el(
    'fieldset',
    { id: 'export-format', className: 'export__formats' },
    [el('legend', { text: '形式' }), ...options],
  );
}

function renderSummary(built: BuiltExport): HTMLElement {
  const item = (label: string, value: string): HTMLElement[] => [
    el('dt', { text: label }),
    el('dd', { text: value }),
  ];
  return el('dl', { id: 'export-summary', className: 'export__summary' }, [
    ...item('データ行数', String(built.rowCount)),
    ...item('対象 study 数', String(built.studyCount)),
    // results_long は未検証の概念がないため「—」（ui-states.md §3）
    ...item(
      '未検証セル数',
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
        text: `確定 annotator（consensus / 唯一の human 行）を特定できないため除外した文献: ${built.skippedStudyLabels.join('、')}`,
      }),
    );
  }
  if (built.droppedRowCount > 0) {
    notes.push(
      el('p', {
        id: 'export-dropped',
        className: 'export__exclusion',
        text: `field_id が表のデザインに見つからないため除外した行: ${built.droppedRowCount} 行`,
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
      text: `プレビュー（先頭 ${data.previewRows.length} 行 / 全 ${data.rowCount} 行）`,
    }),
    el('thead', {}, [headRow]),
    el('tbody', {}, bodyRows),
  ]);
  const parts: HTMLElement[] = [el('div', { className: 'export__preview-wrap' }, [table])];
  const rest = data.rowCount - data.previewRows.length;
  if (rest > 0) {
    // tableId が既定の 'export-preview' のときは従来どおり 'export-preview-more' になる
    parts.push(el('p', { id: `${tableId}-more`, text: `…他 ${rest} 行` }));
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
    text: '続行して生成',
    attributes: { type: 'button' },
  });
  continueButton.addEventListener('click', () => ctx.export.onConfirmGenerate());
  const cancelButton = el('button', {
    id: 'export-warning-cancel',
    text: '中止',
    attributes: { type: 'button' },
  });
  cancelButton.addEventListener('click', () => ctx.export.onCancelGenerate());
  const children: HTMLElement[] = [
    el('h3', {
      id: 'export-warning-title',
      text: `未検証の項目が ${unverifiedCount} 件あります。`,
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
    { className: 'export__methods-tabs', attributes: { role: 'group', 'aria-label': '言語' } },
    [
      renderMethodsLangTab('methods-lang-en', 'English', 'en', exportState.methodsLanguage, ctx),
      renderMethodsLangTab('methods-lang-ja', '日本語', 'ja', exportState.methodsLanguage, ctx),
    ],
  );
  const workflowGroup = el(
    'div',
    { className: 'export__methods-tabs', attributes: { role: 'group', 'aria-label': 'ワークフロー' } },
    [
      renderMethodsWorkflowTab(
        'methods-workflow-single',
        '単一レビュアー',
        'single',
        exportState.methodsWorkflow,
        ctx,
      ),
      renderMethodsWorkflowTab(
        'methods-workflow-dual',
        '二重独立',
        'dual',
        exportState.methodsWorkflow,
        ctx,
      ),
    ],
  );

  const textArea = el('textarea', {
    id: 'methods-text',
    className: 'export__methods-text',
    attributes: { readonly: 'readonly', rows: '8', 'aria-label': '論文 Methods 記載例' },
  });
  textArea.value = text;

  const copyButton = el('button', {
    id: 'methods-copy',
    text: 'コピー',
    attributes: { type: 'button' },
  });
  copyButton.addEventListener('click', () => ctx.export.onCopyMethods());

  const children: HTMLElement[] = [
    el('h3', { text: '論文 Methods 記載例' }),
    el('div', { className: 'export__methods-controls' }, [langGroup, workflowGroup]),
    textArea,
    copyButton,
  ];
  if (unresolved.length > 0) {
    children.push(
      el('p', {
        id: 'methods-unresolved-note',
        className: 'export__methods-note',
        text: '{{ }} の箇所はご自身の情報に置き換えてください',
      }),
    );
  }
  return el('section', { id: 'export-methods', className: 'export__methods' }, children);
}

/** ファイル別行数の一覧（R セットのサマリ・結果カード共通。manifest は行数の概念が無いため「—」） */
function renderRSetFileList(files: readonly RSetFile[], listId: string): HTMLElement {
  const items = files.map((file) =>
    el('li', {
      text: file.name.endsWith('.json') ? file.name : `${file.name}: ${file.rowCount} 行`,
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
    ...item('ファイル数', String(rSet.files.length)),
    ...item('データ行数', String(rSetDataRowCount(rSet))),
    ...item('未検証セル数', String(countRSetUnverifiedCells(rSet))),
    ...item('export_issues 件数', String(issuesFile.rowCount)),
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
  return [el('h3', { text: 'ma.csv プレビュー' }), ...renderPreview(data, 'export-rset-preview')];
}

/** CSV は UTF-8 BOM なし（D-6）のため、Excel でそのまま開くと文字化けしうる初心者向け案内文 */
const RSET_UTF8_NOTE =
  'CSV は UTF-8（BOM なし）で保存されます。Excel でダブルクリックで開くと日本語が文字化けすることがあります。' +
  'Excel で開く場合は「データ > テキストまたは CSV から」で文字コード UTF-8 を指定してください。' +
  'R の readr::read_csv() はそのまま読み込めます。';

function renderRSetResultCard(exportState: ExportState, ctx: ViewContext): HTMLElement {
  const result = exportState.rSetResult as NonNullable<ExportState['rSetResult']>;
  const downloadButton = el('button', {
    id: 'export-rset-download',
    text: 'ローカル保存（8 ファイル）',
    attributes: { type: 'button' },
  });
  downloadButton.addEventListener('click', () => ctx.export.onDownload());
  return el('div', { id: 'export-rset-result', className: 'export__result' }, [
    el('p', {
      text: `${result.folderName} フォルダに 8 ファイルを Drive に保存しました（ExportLog に記録済み）。`,
    }),
    el('a', {
      id: 'export-rset-result-link',
      text: 'Drive で開く',
      attributes: { href: result.folderRef, target: '_blank', rel: 'noopener' },
    }),
    renderRSetFileList(result.built.files, 'export-rset-result-files'),
    downloadButton,
    el('p', { id: 'export-rset-utf8-note', className: 'export__note', text: RSET_UTF8_NOTE }),
  ]);
}

function renderResultCard(exportState: ExportState, ctx: ViewContext): HTMLElement {
  const result = exportState.result as NonNullable<ExportState['result']>;
  const downloadButton = el('button', {
    id: 'export-download',
    text: 'ローカル保存',
    attributes: { type: 'button' },
  });
  downloadButton.addEventListener('click', () => ctx.export.onDownload());
  return el('div', { id: 'export-result', className: 'export__result' }, [
    el('p', { text: `${result.filename} を Drive に保存しました（ExportLog に記録済み）。` }),
    el('a', {
      id: 'export-result-link',
      text: 'Drive で開く',
      attributes: { href: result.fileRef, target: '_blank', rel: 'noopener' },
    }),
    downloadButton,
  ]);
}

export function renderExportView(state: AppState, ctx: ViewContext): HTMLElement {
  const children: Array<HTMLElement | string> = [
    el('h2', { text: 'エクスポート' }),
    el('p', {
      className: 'view__lead',
      text: '確定データを study_wide / results_long / audit の CSV として生成し、Drive に保存します。',
    }),
  ];
  const exportState = state.export;

  if (exportState.loadError !== null) {
    const reload = el('button', {
      id: 'export-reload',
      text: '再読み込み',
      attributes: { type: 'button' },
    });
    reload.addEventListener('click', () => ctx.export.onReload());
    children.push(
      el('p', {
        id: 'export-load-error',
        className: 'export__error',
        attributes: { role: 'alert' },
        text: `エクスポート素材を読み込めませんでした: ${exportState.loadError}`,
      }),
      reload,
    );
    return el('section', { className: 'view view--export' }, children);
  }

  if (exportState.built === null || exportState.loading) {
    children.push(el('p', { id: 'export-loading', text: 'エクスポート素材を読み込んでいます…' }));
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
          text: 'R セットで出力できるデータ行がありません。',
        }),
      );
    }
    const generateButton = el('button', {
      id: 'export-generate',
      className: 'export__generate',
      text: '8 ファイルを生成して Drive に保存',
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
          'R セットでは未検証セルは値列を空にし、ステータス列（tab1_status.csv / ma_status.csv / ' +
            'rob.csv）と export_issues.csv に明示されます。',
        ),
      );
    }
    if (exportState.generating) {
      children.push(
        el('p', { id: 'export-generating', text: '8 ファイルを生成して Drive に保存しています…' }),
      );
    }
    if (exportState.generateError !== null) {
      children.push(
        el('p', {
          id: 'export-generate-error',
          className: 'export__error',
          attributes: { role: 'alert' },
          text: `エクスポートに失敗しました: ${exportState.generateError}`,
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
        text: 'この形式で出力できるデータ行がありません。',
      }),
    );
  }
  const generateButton = el('button', {
    id: 'export-generate',
    className: 'export__generate',
    text: 'CSV を生成して Drive に保存',
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
        built.format === 'audit'
          ? 'audit.csv では未検証セルが判定列空のプレースホルダ行として明示されます。'
          : null,
      ),
    );
  }
  if (exportState.generating) {
    children.push(
      el('p', { id: 'export-generating', text: 'CSV を生成して Drive に保存しています…' }),
    );
  }
  if (exportState.generateError !== null) {
    children.push(
      el('p', {
        id: 'export-generate-error',
        className: 'export__error',
        attributes: { role: 'alert' },
        text: `エクスポートに失敗しました: ${exportState.generateError}`,
      }),
    );
  }
  if (exportState.result !== null) {
    children.push(renderResultCard(exportState, ctx));
  }
  return el('section', { className: 'view view--export' }, children);
}
