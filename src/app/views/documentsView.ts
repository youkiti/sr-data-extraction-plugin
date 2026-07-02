// #/documents: 文献取り込み（S3 / ui-states.md §3）。
// 著作権の注意書きは常時表示（requirements.md §1.5。チェック UI は設けない）。
// 状態: 読み込み中 / 読み込み失敗 / 空 / 取り込み中（進捗行）/ 一覧 N 件（text_status バッジ +
// study_label インライン編集）。データは AppState.documents（documentsService が更新）から描く
import type { DocumentRecord, TextStatus } from '../../domain/document';
import { el } from '../ui/dom';
import type { AppState, ImportRow, ImportRowStatus } from '../store';
import type { ViewContext } from './types';

const IMPORT_ROW_LABELS: Record<ImportRowStatus, string> = {
  queued: '待機中',
  copy: 'コピー中…',
  extract: 'テキスト抽出中…',
  done: '完了',
  failed: '失敗',
};

const TEXT_STATUS_NOTES: Partial<Record<TextStatus, string>> = {
  no_text_layer: 'pdf_native 抽出のみ・ハイライト不可',
};

function renderProgress(rows: ImportRow[]): HTMLElement {
  const items = rows.map((row) => {
    const statusText =
      row.status === 'failed' && row.detail !== null
        ? `${IMPORT_ROW_LABELS.failed}（${row.detail}）`
        : IMPORT_ROW_LABELS[row.status];
    return el('li', { className: 'documents__progress-row' }, [
      el('span', { className: 'documents__progress-filename', text: row.filename }),
      el('span', {
        className: `documents__progress-status documents__progress-status--${row.status}`,
        text: statusText,
      }),
    ]);
  });
  return el('div', { className: 'documents__progress' }, [
    el('h3', { text: '取り込み進捗' }),
    el('ul', { id: 'documents-progress', className: 'documents__progress-list' }, items),
  ]);
}

function renderStatusBadge(status: TextStatus): HTMLElement {
  const badge = el('span', {
    className: `documents__badge documents__badge--${status}`,
    text: status,
  });
  const note = TEXT_STATUS_NOTES[status];
  if (note === undefined) {
    return badge;
  }
  return el('span', {}, [badge, el('small', { className: 'documents__badge-note', text: note })]);
}

function renderRow(doc: DocumentRecord, ctx: ViewContext): HTMLElement {
  const labelInput = el('input', {
    className: 'documents__label-input',
    attributes: {
      type: 'text',
      value: doc.studyLabel,
      'aria-label': `${doc.filename} の study_label`,
    },
  });
  labelInput.value = doc.studyLabel;
  // change はフォーカス喪失時に発火する。Enter でも blur させて確定を 1 経路にする
  labelInput.addEventListener('change', () => {
    ctx.documents.onSaveStudyLabel(doc.documentId, labelInput.value);
  });
  labelInput.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') {
      labelInput.blur();
    }
  });
  return el('tr', {}, [
    el('td', {}, [labelInput]),
    el('td', { text: doc.filename }),
    el('td', {}, [renderStatusBadge(doc.textStatus)]),
    el('td', { text: doc.pageCount === null ? '–' : String(doc.pageCount) }),
    el('td', { text: doc.importedAt }),
  ]);
}

function renderList(state: AppState, ctx: ViewContext): HTMLElement {
  const { records, loading, loadError } = state.documents;
  if (loadError !== null) {
    return el('p', {
      id: 'documents-load-error',
      className: 'documents__error',
      text: `一覧を読み込めませんでした: ${loadError}`,
    });
  }
  if (records === null || loading) {
    return el('p', { id: 'documents-loading', text: '一覧を読み込んでいます…' });
  }
  if (records.length === 0) {
    return el('p', {
      id: 'documents-empty',
      text: 'まだ文献がありません。「Drive から PDF を取り込む」から採用論文の PDF を選択してください。',
    });
  }
  const header = el('tr', {}, [
    el('th', { text: 'study_label' }),
    el('th', { text: 'ファイル名' }),
    el('th', { text: 'テキスト層' }),
    el('th', { text: 'ページ数' }),
    el('th', { text: '取り込み日時' }),
  ]);
  return el('table', { id: 'documents-table', className: 'documents__table' }, [
    el('thead', {}, [header]),
    el('tbody', {}, records.map((doc) => renderRow(doc, ctx))),
  ]);
}

export function renderDocumentsView(state: AppState, ctx: ViewContext): HTMLElement {
  const { importing, importRows } = state.documents;
  const hasProject = state.currentProject !== null;

  const importButton = el('button', {
    id: 'documents-import',
    className: 'documents__import',
    text: 'Drive から PDF を取り込む',
    attributes: { type: 'button' },
  });
  importButton.disabled = importing || !hasProject;
  importButton.addEventListener('click', () => ctx.documents.onImport());

  const reloadButton = el('button', {
    id: 'documents-reload',
    text: '一覧を再読み込み',
    attributes: { type: 'button' },
  });
  reloadButton.disabled = importing || !hasProject;
  reloadButton.addEventListener('click', () => ctx.documents.onReload());

  const children: HTMLElement[] = [
    el('h2', { text: '文献取り込み' }),
    el('p', {
      className: 'view__notice',
      text: '著作権フリー / 利用許諾済みの PDF のみ取り込んでください。取り込んだ PDF が外部へ送信されるのは LLM API への抽出リクエストのみです。',
    }),
    el('p', {
      className: 'view__lead',
      text: 'Google Drive Picker で採用論文の PDF を選択し、プロジェクトフォルダへコピーしてテキスト層を抽出します。',
    }),
    el('div', { className: 'documents__actions' }, [importButton, reloadButton]),
  ];
  if (importRows.length > 0) {
    children.push(renderProgress(importRows));
  }
  if (hasProject) {
    children.push(renderList(state, ctx));
  }
  return el('section', { className: 'view view--documents' }, children);
}
