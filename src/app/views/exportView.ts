// #/export: エクスポート（S10 / ui-states.md §3）。
// 状態: 読み込み中 / 読み込み失敗 / 通常（形式選択 + サマリ + プレビュー + 生成ボタン）
// + 未検証セル警告ダイアログ / 生成中 / 生成失敗 / 生成完了カード
import type { ExportFormat } from '../../domain/exportLog';
import type { BuiltExport } from '../../features/export/buildExport';
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

function renderPreview(built: BuiltExport): HTMLElement[] {
  const headRow = el(
    'tr',
    {},
    built.header.map((name) => el('th', { text: name, attributes: { scope: 'col' } })),
  );
  const bodyRows = built.previewRows.map((row) =>
    el('tr', {}, row.map((value) => el('td', { text: value }))),
  );
  const table = el('table', { id: 'export-preview', className: 'export__preview' }, [
    el('caption', {
      className: 'export__preview-caption',
      text: `プレビュー（先頭 ${built.previewRows.length} 行 / 全 ${built.rowCount} 行）`,
    }),
    el('thead', {}, [headRow]),
    el('tbody', {}, bodyRows),
  ]);
  const parts: HTMLElement[] = [el('div', { className: 'export__preview-wrap' }, [table])];
  const rest = built.rowCount - built.previewRows.length;
  if (rest > 0) {
    parts.push(el('p', { id: 'export-preview-more', text: `…他 ${rest} 行` }));
  }
  return parts;
}

function renderWarningDialog(ctx: ViewContext, built: BuiltExport): HTMLElement {
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
      text: `未検証の項目が ${built.unverifiedCellCount ?? 0} 件あります。`,
    }),
  ];
  if (built.format === 'audit') {
    children.push(
      el('p', {
        text: 'audit.csv では未検証セルが判定列空のプレースホルダ行として明示されます。',
      }),
    );
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

  const built = exportState.built[exportState.format];
  children.push(renderFormatSelector(exportState, ctx), renderSummary(built));
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
    children.push(renderWarningDialog(ctx, built));
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
