// #/protocol: プロトコル入力（S4 / ui-states.md §3）。
// sr-query-builder の protocol 画面 UI を移植。本拡張は extract-protocol skill を持たないため
// 送信 = 即保存（新 version 追記）であり、承認前ドラフトの復元モードは存在しない。
// 状態: プロジェクト未選択 / 読み込み中 / 読み込み失敗 / 新規フォーム / 読み取り専用（版切替）/
// 再入力フォーム。データは AppState.protocol（protocolService が更新）から描く
import type { Protocol, ProtocolSourceType } from '../../domain/protocol';
import type { ProtocolSubmitInput } from '../../features/protocol/submitInput';
import { el } from '../ui/dom';
import type { AppState, ProtocolState } from '../store';
import type { ViewContext } from './types';

const SOURCE_TYPE_LABELS: Record<ProtocolSourceType, string> = {
  manual: '手入力',
  markdown: 'Markdown',
  docx: 'Word（.docx）',
};

/** アップロード対応拡張子（sr-query-builder と同一） */
const FILE_ACCEPT = '.md,.markdown,.docx';

/**
 * フォームの入力内容を送信形式へ整える。検証エラーは throw し、呼び出し側が
 * エラー領域へ表示する。File はそのまま渡さず遅延読み込みのラッパへ包む
 */
function collectFormInput(
  mode: 'manual' | 'file',
  textarea: HTMLTextAreaElement,
  fileInput: HTMLInputElement,
): ProtocolSubmitInput {
  if (mode === 'manual') {
    if (textarea.value.trim() === '') {
      // LLM 抽出を挟まないため空本文は保存させない（保存 = #/schema ガード解除のため）
      throw new Error('本文を入力してください');
    }
    return { sourceType: 'manual', inlineText: textarea.value };
  }
  const file = fileInput.files?.[0] ?? null;
  if (!file) {
    throw new Error('プロトコルファイルを選択してください');
  }
  if (/\.(md|markdown)$/i.test(file.name)) {
    return { sourceType: 'markdown', file: { name: file.name, text: () => file.text() } };
  }
  if (/\.docx$/i.test(file.name)) {
    return { sourceType: 'docx', file: { name: file.name, arrayBuffer: () => file.arrayBuffer() } };
  }
  throw new Error('対応形式は .md / .markdown / .docx です');
}

function renderForm(protocol: ProtocolState, ctx: ViewContext, hasVersions: boolean): HTMLElement {
  const manualRadio = el('input', {
    attributes: { type: 'radio', name: 'protocol-source', value: 'manual' },
  });
  manualRadio.checked = true;
  const fileRadio = el('input', {
    attributes: { type: 'radio', name: 'protocol-source', value: 'file' },
  });

  const textarea = el('textarea', {
    id: 'protocol-inline',
    className: 'protocol__textarea',
    attributes: { rows: '14' },
  });
  textarea.value = protocol.draftText;
  const manualSection = el('div', { id: 'protocol-manual-section', className: 'protocol__section' }, [
    el('label', { className: 'protocol__field' }, [
      el('span', { text: '本文' }),
      textarea,
    ]),
  ]);

  const fileInput = el('input', {
    id: 'protocol-file',
    attributes: { type: 'file', accept: FILE_ACCEPT },
  });
  const fileSection = el('div', { id: 'protocol-file-section', className: 'protocol__section' }, [
    el('label', { className: 'protocol__field' }, [
      el('span', { text: 'プロトコルファイル（.md / .markdown / .docx）' }),
      fileInput,
    ]),
  ]);
  fileSection.hidden = true;

  const syncMode = (): void => {
    manualSection.hidden = !manualRadio.checked;
    fileSection.hidden = manualRadio.checked;
  };
  manualRadio.addEventListener('change', syncMode);
  fileRadio.addEventListener('change', syncMode);

  const errorBox = el('p', {
    id: 'protocol-error',
    className: 'protocol__error',
    text: protocol.saveError ?? '',
    attributes: { 'aria-live': 'polite' },
  });

  const submitButton = el('button', {
    id: 'protocol-submit',
    className: 'protocol__submit',
    text: hasVersions ? '新しい版として保存' : '保存する',
    attributes: { type: 'submit' },
  });
  submitButton.disabled = protocol.saving;

  const actions: HTMLElement[] = [submitButton];
  if (hasVersions) {
    const cancelButton = el('button', {
      id: 'protocol-cancel',
      className: 'protocol__cancel',
      text: 'キャンセル',
      attributes: { type: 'button' },
    });
    cancelButton.disabled = protocol.saving;
    cancelButton.addEventListener('click', () => ctx.protocol.onCancelEdit());
    actions.push(cancelButton);
  }

  const children: HTMLElement[] = [
    el('fieldset', { className: 'protocol__source' }, [
      el('legend', { text: '入力方法' }),
      el('label', { className: 'protocol__source-option' }, [manualRadio, '手入力']),
      el('label', { className: 'protocol__source-option' }, [
        fileRadio,
        'ファイル（.md / .docx）',
      ]),
    ]),
    manualSection,
    fileSection,
    errorBox,
  ];
  if (protocol.saving) {
    children.push(
      el('p', {
        id: 'protocol-status',
        className: 'protocol__status',
        text: '保存中…（Drive / Sheets へ書き込んでいます）',
        attributes: { role: 'status' },
      }),
    );
  }
  children.push(el('div', { className: 'protocol__actions' }, actions));

  const form = el('form', { id: 'protocol-form', className: 'protocol__form' }, children);
  form.addEventListener('submit', (event) => {
    event.preventDefault();
    errorBox.textContent = '';
    let input: ProtocolSubmitInput;
    try {
      input = collectFormInput(manualRadio.checked ? 'manual' : 'file', textarea, fileInput);
    } catch (err) {
      // collectFormInput は必ず Error を投げる（検証エラーのみ）
      errorBox.textContent = (err as Error).message;
      return;
    }
    ctx.protocol.onSubmit(input);
  });
  return form;
}

function summaryRow(term: string, detail: HTMLElement | string): HTMLElement[] {
  const dd = el('dd', {});
  dd.append(detail);
  return [el('dt', { text: term }), dd];
}

function renderReadOnly(
  latest: Protocol,
  records: Protocol[],
  protocol: ProtocolState,
  ctx: ViewContext,
): HTMLElement {
  const displayed =
    records.find((record) => record.version === protocol.selectedVersion) ?? latest;

  const children: HTMLElement[] = [];
  if (records.length > 1) {
    const select = el('select', {
      id: 'protocol-version-select',
      className: 'protocol__version-select',
    });
    for (const record of records) {
      const option = el('option', {
        text: `v${record.version}（${record.createdAt}）`,
        attributes: { value: String(record.version) },
      });
      option.selected = record.version === displayed.version;
      select.append(option);
    }
    select.addEventListener('change', () => {
      ctx.protocol.onSelectVersion(Number(select.value));
    });
    children.push(
      el('label', { className: 'protocol__versions' }, [el('span', { text: 'バージョン' }), select]),
    );
  }
  if (displayed.version !== latest.version) {
    children.push(
      el('p', {
        id: 'protocol-old-note',
        className: 'protocol__old-note',
        text: `古い版を表示しています（最新: v${latest.version}）`,
      }),
    );
  }

  const sourceLabel =
    displayed.sourceFilename === null
      ? SOURCE_TYPE_LABELS[displayed.sourceType]
      : `${SOURCE_TYPE_LABELS[displayed.sourceType]}（${displayed.sourceFilename}）`;
  const sourceLink =
    displayed.rawTextRef === null
      ? '—'
      : el('a', {
          text: 'Drive で開く',
          attributes: { href: displayed.rawTextRef, target: '_blank', rel: 'noreferrer' },
        });
  children.push(
    el('dl', { id: 'protocol-summary', className: 'protocol__summary' }, [
      ...summaryRow('版', `v${displayed.version}`),
      ...summaryRow('入力形式', sourceLabel),
      ...summaryRow('本文', displayed.rawTextInline ?? displayed.rawTextPreview ?? '—'),
      ...summaryRow('元ファイル', sourceLink),
      ...summaryRow('作成日時', displayed.createdAt),
      ...summaryRow('作成者', displayed.createdBy),
    ]),
  );

  const editButton = el('button', {
    id: 'protocol-edit',
    className: 'protocol__edit',
    text: '新しい版を入力',
    attributes: { type: 'button' },
  });
  editButton.addEventListener('click', () => ctx.protocol.onStartEdit());
  const reloadButton = el('button', {
    id: 'protocol-reload',
    text: '一覧を再読み込み',
    attributes: { type: 'button' },
  });
  reloadButton.addEventListener('click', () => ctx.protocol.onReload());
  children.push(el('div', { className: 'protocol__actions' }, [editButton, reloadButton]));

  return el('div', { id: 'protocol-readonly', className: 'protocol__readonly' }, children);
}

function renderBody(state: AppState, ctx: ViewContext): HTMLElement {
  const { records, loading, loadError, editing } = state.protocol;
  if (loadError !== null) {
    const reloadButton = el('button', {
      id: 'protocol-reload',
      text: '一覧を再読み込み',
      attributes: { type: 'button' },
    });
    reloadButton.addEventListener('click', () => ctx.protocol.onReload());
    return el('div', {}, [
      el('p', {
        id: 'protocol-load-error',
        className: 'protocol__error',
        text: `プロトコルを読み込めませんでした: ${loadError}`,
      }),
      el('div', { className: 'protocol__actions' }, [reloadButton]),
    ]);
  }
  if (records === null || loading) {
    return el('p', { id: 'protocol-loading', text: 'プロトコルを読み込んでいます…' });
  }
  const latest = records[0];
  if (latest === undefined || editing) {
    return renderForm(state.protocol, ctx, latest !== undefined);
  }
  return renderReadOnly(latest, records, state.protocol, ctx);
}

export function renderProtocolView(state: AppState, ctx: ViewContext): HTMLElement {
  const children: HTMLElement[] = [el('h2', { text: 'プロトコル入力' })];
  if (state.currentProject === null) {
    children.push(
      el('p', {
        id: 'protocol-no-project',
        className: 'view__notice',
        text: '先にプロジェクトを選択してください（Popup から作成 / 選択できます）。',
      }),
    );
  } else {
    children.push(
      el('p', {
        className: 'view__lead',
        text: '研究プロトコル（RQ・組入 / 除外基準など）を登録します。手入力または .md / .docx ファイルを取り込み、表のデザイン（AI ドラフト）が本文を参照します。保存は常に新しい版として追記され、過去の版は保持されます。',
      }),
      renderBody(state, ctx),
    );
  }
  return el('section', { className: 'view view--protocol' }, children);
}
