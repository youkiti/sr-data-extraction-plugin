// #/documents: 文献取り込み・グルーピング（S3 / ui-states.md §3 / requirements.md §4.5）。
// PDF の外部送信先（LLM API のみ）の注意書きは常時表示（requirements.md §1.5）。
// v0.10: study 単位のグループ表示（配下文書に role バッジ + text_status）、study_label /
// registration_id / role のインライン編集、統合候補バナー、統合ダイアログ（§4.5）。
// ローカル取り込み（D&D + ファイル選択ダイアログ）を Drive Picker に加えて提供する。
// 状態: 読み込み中 / 失敗 / 空 / 取り込み中（進捗行）/ 一覧（試験ごとのグループ）
import {
  DOCUMENT_ROLE_ORDER,
  type DocumentRecord,
  type DocumentRole,
  type TextStatus,
} from '../../domain/document';
import type { StudyRecord } from '../../domain/study';
import type {
  TiabImportPlan,
  TiabPlanItemStatus,
  TiabScreeningPhase,
} from '../../features/documents/tiabReview';
import { activeStudyGroups, visibleMergeCandidates } from '../services/documentsService';
import { el } from '../ui/dom';
import type { AppState, ImportRow, ImportRowStatus, MergeDialogState, TiabImportState } from '../store';
import type { ViewContext } from './types';

const IMPORT_ROW_LABELS: Record<ImportRowStatus, string> = {
  queued: '待機中',
  copy: 'コピー中…',
  extract: 'テキスト抽出中…',
  done: '完了',
  failed: '失敗',
  skipped: 'スキップ',
};

/** include 抽出に使った相の表示名（ui-states.md §3） */
const TIAB_PHASE_LABELS: Record<TiabScreeningPhase, string> = {
  fulltext: '全文スクリーニング',
  tiab: 'タイトル・抄録スクリーニング',
};

/** プレビュー行の状態バッジ文言 */
const TIAB_STATUS_LABELS: Record<TiabPlanItemStatus, string> = {
  update: '反映',
  already: '適用済み',
  unmatched: 'PDF 未取り込み',
};

const TEXT_STATUS_NOTES: Partial<Record<TextStatus, string>> = {
  no_text_layer: 'pdf_native 抽出・ハイライトは AI 推定（bbox）',
};

const ROLE_LABELS: Record<DocumentRole, string> = {
  article: '本論文',
  registration: '試験登録',
  protocol: 'プロトコル',
  abstract: '学会抄録',
  supplement: '付録・補遺',
  other: 'その他',
};

/** ローカル選択ボタン + 隠しファイル入力（ボタン click で input を open）。ドロップゾーン内に置く */
function renderLocalImportControls(
  ctx: ViewContext,
  disabled: boolean,
): { button: HTMLButtonElement; input: HTMLInputElement } {
  const input = el('input', {
    id: 'documents-file-input',
    className: 'documents__file-input',
    attributes: { type: 'file', accept: 'application/pdf', multiple: 'true' },
  }) as HTMLInputElement;
  input.hidden = true;
  input.addEventListener('change', () => {
    const files = Array.from(input.files ?? []);
    input.value = ''; // 同じファイルを連続選択できるようリセット
    if (files.length > 0) {
      ctx.documents.onImportFiles(files);
    }
  });

  const button = el('button', {
    id: 'documents-local-import',
    className: 'documents__local-import',
    text: '💻 PC からファイルを選択',
    attributes: { type: 'button' },
  });
  button.disabled = disabled;
  button.addEventListener('click', () => input.click());

  return { button, input };
}

/**
 * ローカル PDF のドロップゾーン（D&D）。標準的なアップロード UI として、案内文 +「または」+
 * 「PC からファイルを選択」ボタン + 隠し input を内側に集約する（ボタン click と D&D は干渉しない）。
 * ハイライト（dragover/dragenter で付与、dragleave / drop で解除）は次回 render でリセットされる
 * transient DOM 状態で、view の純粋 render 原則は崩さない。
 * disabled 中は preventDefault のみ行いドロップを無視する（importing || !hasProject）
 */
function renderDropzone(ctx: ViewContext, disabled: boolean): HTMLElement {
  const { button, input } = renderLocalImportControls(ctx, disabled);
  const zone = el('div', { id: 'documents-dropzone', className: 'documents__dropzone' }, [
    el('p', { className: 'documents__dropzone-prompt', text: 'PDF をここにドラッグ&ドロップ' }),
    el('p', { className: 'documents__dropzone-or', text: 'または' }),
    button,
    input,
  ]);
  if (disabled) {
    zone.classList.add('documents__dropzone--disabled');
  }
  const highlight = (): void => {
    if (!disabled) {
      zone.classList.add('documents__dropzone--dragover');
    }
  };
  const unhighlight = (): void => {
    zone.classList.remove('documents__dropzone--dragover');
  };
  zone.addEventListener('dragover', (event) => {
    event.preventDefault();
    highlight();
  });
  zone.addEventListener('dragenter', (event) => {
    event.preventDefault();
    highlight();
  });
  zone.addEventListener('dragleave', () => {
    unhighlight();
  });
  zone.addEventListener('drop', (event) => {
    event.preventDefault();
    unhighlight();
    if (disabled) {
      return;
    }
    const files = Array.from(event.dataTransfer?.files ?? []);
    if (files.length > 0) {
      ctx.documents.onImportFiles(files);
    }
  });
  return zone;
}

function renderProgress(rows: ImportRow[]): HTMLElement {
  const items = rows.map((row) => {
    // detail は failed（失敗段階 + 理由）と skipped（重複スキップの理由。issue #102）で非 null
    const statusText =
      row.detail !== null
        ? `${IMPORT_ROW_LABELS[row.status]}（${row.detail}）`
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

/** テキスト入力のインライン編集（Enter / blur で確定を 1 経路にする） */
function inlineInput(
  value: string,
  ariaLabel: string,
  className: string,
  onCommit: (value: string) => void,
): HTMLInputElement {
  const input = el('input', {
    className,
    attributes: { type: 'text', 'aria-label': ariaLabel },
  }) as HTMLInputElement;
  input.value = value;
  input.addEventListener('change', () => onCommit(input.value));
  input.addEventListener('keydown', (event) => {
    if ((event as KeyboardEvent).key === 'Enter') {
      input.blur();
    }
  });
  return input;
}

function renderRoleSelect(doc: DocumentRecord, ctx: ViewContext): HTMLSelectElement {
  const select = el('select', {
    className: 'documents__role-select',
    attributes: { 'aria-label': `${doc.filename} の document_role` },
  }) as HTMLSelectElement;
  for (const role of DOCUMENT_ROLE_ORDER) {
    select.append(
      el('option', { text: ROLE_LABELS[role], attributes: { value: role } }),
    );
  }
  select.value = doc.documentRole;
  select.addEventListener('change', () => {
    ctx.documents.onSaveDocumentRole(doc.documentId, select.value as DocumentRole);
  });
  return select;
}

function renderDocumentRow(doc: DocumentRecord, ctx: ViewContext): HTMLElement {
  return el('tr', { className: 'documents__doc-row' }, [
    el('td', {}, [renderRoleSelect(doc, ctx)]),
    el('td', { className: 'documents__doc-filename', text: doc.filename }),
    el('td', {}, [renderStatusBadge(doc.textStatus)]),
    el('td', { text: doc.pageCount === null ? '–' : String(doc.pageCount) }),
  ]);
}

function renderStudyGroup(
  study: StudyRecord,
  documents: DocumentRecord[],
  state: AppState,
  ctx: ViewContext,
): HTMLElement {
  const checkbox = el('input', {
    className: 'documents__study-check',
    attributes: { type: 'checkbox', 'aria-label': `${study.studyLabel} を統合対象にする` },
  }) as HTMLInputElement;
  checkbox.checked = state.documents.selectedStudyIds.includes(study.studyId);
  checkbox.addEventListener('change', () =>
    ctx.documents.onToggleStudySelection(study.studyId, checkbox.checked),
  );

  const labelInput = inlineInput(
    study.studyLabel,
    `${study.studyLabel} の study_label`,
    'documents__label-input',
    (value) => ctx.documents.onSaveStudyLabel(study.studyId, value),
  );
  const regInput = inlineInput(
    study.registrationId ?? '',
    `${study.studyLabel} の registration_id`,
    'documents__registration-input',
    (value) => ctx.documents.onSaveRegistrationId(study.studyId, value),
  );

  const docsTable = el('table', { className: 'documents__docs-table' }, [
    el('thead', {}, [
      el('tr', {}, [
        el('th', { text: 'ロール' }),
        el('th', { text: 'ファイル名' }),
        el('th', { text: 'テキスト層' }),
        el('th', { text: 'ページ数' }),
      ]),
    ]),
    el('tbody', {}, documents.map((doc) => renderDocumentRow(doc, ctx))),
  ]);

  return el(
    'div',
    { className: 'documents__study-group', attributes: { 'data-study-id': study.studyId } },
    [
      el('div', { className: 'documents__study-head' }, [
        el('label', { className: 'documents__study-select' }, [
          checkbox,
          el('span', { text: '統合対象' }),
        ]),
        el('label', { className: 'documents__study-field' }, [
          el('span', { text: 'study_label: ' }),
          labelInput,
        ]),
        el('label', { className: 'documents__study-field' }, [
          el('span', { text: 'registration_id: ' }),
          regInput,
        ]),
      ]),
      docsTable,
    ],
  );
}

/** tiab プレビューの一覧テーブル + サマリ + 実行ボタン（ui-states.md §3「同・プレビュー」） */
function renderTiabPlan(plan: TiabImportPlan, tiab: TiabImportState, ctx: ViewContext): HTMLElement[] {
  const counts: Record<TiabPlanItemStatus, number> = { update: 0, already: 0, unmatched: 0 };
  for (const item of plan.items) {
    counts[item.status] += 1;
  }
  const children: HTMLElement[] = [
    el('p', {
      id: 'tiab-summary',
      className: 'documents__tiab-summary',
      text:
        `最終判定 include ${plan.includeCount} 件（${TIAB_PHASE_LABELS[plan.phase]}の判定・全 ${plan.totalReferences} 件中）: ` +
        `反映 ${counts.update} 件 / 適用済み ${counts.already} 件 / PDF 未取り込み ${counts.unmatched} 件`,
    }),
  ];
  if (plan.items.length === 0) {
    children.push(
      el('p', {
        id: 'tiab-plan-empty',
        text: 'include の文献が見つかりませんでした。tiab-review 側の判定状況を確認してください。',
      }),
    );
    return children;
  }
  const table = el('table', { id: 'tiab-plan', className: 'documents__tiab-table' }, [
    el('thead', {}, [
      el('tr', {}, [
        el('th', { text: '文献' }),
        el('th', { text: '生成 study_label' }),
        el('th', { text: '突き合わせた PDF' }),
        el('th', { text: '状態' }),
      ]),
    ]),
    el(
      'tbody',
      {},
      plan.items.map((item) =>
        el('tr', { className: 'documents__tiab-row' }, [
          el('td', { className: 'documents__tiab-title', text: item.title }),
          el('td', { text: item.studyLabel }),
          el('td', {
            text: item.matchedFilenames.length === 0 ? '—' : item.matchedFilenames.join(', '),
          }),
          el('td', {}, [
            el('span', {
              className: `documents__tiab-status documents__tiab-status--${item.status}`,
              text: TIAB_STATUS_LABELS[item.status],
            }),
          ]),
        ]),
      ),
    ),
  ]);
  children.push(el('div', { className: 'documents__tiab-table-wrap' }, [table]));

  const apply = el('button', {
    id: 'tiab-apply',
    className: 'documents__tiab-apply',
    text: tiab.applying ? '反映しています…' : '取り込みを実行',
    attributes: { type: 'button' },
  });
  apply.disabled =
    tiab.applying || (plan.studyUpdates.length === 0 && plan.documentUpdates.length === 0);
  apply.addEventListener('click', () => ctx.documents.onTiabApply());
  children.push(el('div', { className: 'documents__tiab-actions' }, [apply]));
  return children;
}

/**
 * tiab-review 採用リスト取り込みカード（issue #68・requirements.md §4.5 / ※Q2）。
 * 閉: 導線ボタンのみ。開: URL / ID 入力 + プレビュー（include 抽出 + 突き合わせ結果）+ 実行
 */
function renderTiabCard(state: AppState, ctx: ViewContext): HTMLElement {
  const tiab = state.documents.tiabImport;
  if (!tiab.open) {
    const open = el('button', {
      id: 'documents-tiab-open',
      className: 'documents__tiab-open',
      text: 'tiab-review から採用リストを読み込む',
      attributes: { type: 'button' },
    });
    open.disabled = state.documents.importing;
    open.addEventListener('click', () => ctx.documents.onTiabOpen());
    return el('div', { className: 'documents__tiab' }, [open]);
  }

  const busy = tiab.loading || tiab.applying;

  const input = el('input', {
    id: 'tiab-sheet-input',
    className: 'documents__tiab-input',
    attributes: {
      type: 'text',
      'aria-label': 'tiab-review のスプレッドシート URL または ID',
      placeholder: 'https://docs.google.com/spreadsheets/d/… または ID',
    },
  }) as HTMLInputElement;
  input.value = tiab.sheetInput;

  const preview = el('button', {
    id: 'tiab-preview',
    text: '読み込んでプレビュー',
    attributes: { type: 'button' },
  });
  preview.disabled = busy;
  preview.addEventListener('click', () => ctx.documents.onTiabPreview(input.value));

  const close = el('button', {
    id: 'tiab-close',
    text: '閉じる',
    attributes: { type: 'button' },
  });
  close.disabled = busy;
  close.addEventListener('click', () => ctx.documents.onTiabClose());

  const children: HTMLElement[] = [
    el('h3', { text: 'tiab-review から採用リストを読み込む' }),
    el('p', {
      className: 'view__lead',
      text:
        'tiab-review のスプレッドシートを直読みし、最終判定 include の文献から study_label（著者 (year)）と ' +
        'DOI / PMID を反映します。fulltext フォルダから取り込んだ PDF と突き合わせるため、先に PDF を取り込んでください。',
    }),
    el('div', { className: 'documents__tiab-form' }, [input, preview, close]),
  ];
  if (tiab.loading) {
    children.push(el('p', { id: 'tiab-loading', text: 'tiab-review のシートを読み込んでいます…' }));
  }
  if (tiab.error !== null) {
    children.push(
      el('p', {
        id: 'tiab-error',
        className: 'documents__error',
        attributes: { role: 'alert' },
        text: tiab.error,
      }),
    );
  }
  if (tiab.plan !== null) {
    children.push(...renderTiabPlan(tiab.plan, tiab, ctx));
  }
  if (tiab.result !== null) {
    const suffix = tiab.result.unmatched > 0 ? `（PDF 未取り込み ${tiab.result.unmatched} 件）` : '';
    children.push(
      el('p', {
        id: 'tiab-result',
        className: 'documents__tiab-result',
        attributes: { role: 'status' },
        text:
          `study_label ${tiab.result.studiesUpdated} 件を更新し、` +
          `DOI / PMID を ${tiab.result.documentsUpdated} 文書に転記しました${suffix}`,
      }),
    );
  }
  return el('section', { id: 'documents-tiab', className: 'documents__tiab' }, children);
}

/** 統合候補バナー（registration_id 一致のアクティブ study が複数。§4.5） */
function renderCandidateBanners(state: AppState, ctx: ViewContext): HTMLElement[] {
  return visibleMergeCandidates(state.documents).map((candidate) => {
    const mergeButton = el('button', {
      className: 'documents__candidate-merge',
      attributes: { type: 'button' },
      text: '統合する',
    });
    mergeButton.addEventListener('click', () =>
      ctx.documents.onOpenMergeCandidate(candidate.studyIds),
    );
    const ignoreButton = el('button', {
      className: 'documents__candidate-ignore',
      attributes: { type: 'button' },
      text: '無視',
    });
    ignoreButton.addEventListener('click', () =>
      ctx.documents.onIgnoreCandidate(candidate.studyIds),
    );
    return el(
      'div',
      {
        className: 'documents__candidate',
        attributes: { role: 'note', 'data-registration': candidate.registrationId },
      },
      [
        el('p', {
          text: `同じ登録番号「${candidate.registrationId}」の試験が ${candidate.studyIds.length} 件あります。同一試験の可能性があります。`,
        }),
        el('div', { className: 'documents__candidate-actions' }, [mergeButton, ignoreButton]),
      ],
    );
  });
}

/** 統合確認ダイアログ（role=alertdialog。§4.5） */
function renderMergeDialog(dialog: MergeDialogState, state: AppState, ctx: ViewContext): HTMLElement {
  const labelInput = el('input', {
    id: 'merge-label',
    attributes: { type: 'text', 'aria-label': '統合後の study_label' },
  }) as HTMLInputElement;
  labelInput.value = dialog.label;
  labelInput.addEventListener('input', () => ctx.documents.onUpdateMergeLabel(labelInput.value));

  const regInput = el('input', {
    id: 'merge-registration',
    attributes: { type: 'text', 'aria-label': '統合後の registration_id' },
  }) as HTMLInputElement;
  regInput.value = dialog.registrationId;
  regInput.addEventListener('input', () =>
    ctx.documents.onUpdateMergeRegistration(regInput.value),
  );

  const children: HTMLElement[] = [
    el('h3', { id: 'merge-dialog-title', text: '試験を統合しますか？' }),
    el('p', { text: `${dialog.studyIds.length} 件の試験を 1 つにまとめます。` }),
    el('label', {}, [el('span', { text: '統合後の study_label: ' }), labelInput]),
    el('label', {}, [el('span', { text: '統合後の registration_id: ' }), regInput]),
  ];
  if (dialog.hasExtractedData) {
    children.push(
      el('p', {
        id: 'merge-warning',
        className: 'documents__merge-warning',
        attributes: { role: 'alert' },
        text: '統合後この試験は未抽出に戻ります（過去の判定履歴は Decisions に残ります）。再抽出が必要です。',
      }),
    );
  }
  if (state.documents.mergeError !== null) {
    children.push(
      el('p', { className: 'documents__error', attributes: { role: 'alert' }, text: state.documents.mergeError }),
    );
  }
  const confirm = el('button', {
    id: 'merge-confirm',
    attributes: { type: 'button' },
    text: '統合する',
  });
  confirm.addEventListener('click', () => ctx.documents.onConfirmMerge());
  const cancel = el('button', {
    id: 'merge-cancel',
    attributes: { type: 'button' },
    text: 'キャンセル',
  });
  cancel.addEventListener('click', () => ctx.documents.onCancelMerge());
  if (state.documents.merging) {
    confirm.disabled = true;
    cancel.disabled = true;
  }
  children.push(el('div', { className: 'documents__merge-actions' }, [confirm, cancel]));
  return el(
    'div',
    {
      id: 'merge-dialog',
      className: 'documents__merge-dialog',
      attributes: { role: 'alertdialog', 'aria-labelledby': 'merge-dialog-title' },
    },
    children,
  );
}

function renderList(state: AppState, ctx: ViewContext): HTMLElement {
  const { records, studies, loading, loadError } = state.documents;
  if (loadError !== null) {
    return el('p', {
      id: 'documents-load-error',
      className: 'documents__error',
      text: `一覧を読み込めませんでした: ${loadError}`,
    });
  }
  if (records === null || studies === null || loading) {
    return el('p', { id: 'documents-loading', text: '一覧を読み込んでいます…' });
  }
  const groups = activeStudyGroups(studies, records);
  if (groups.length === 0) {
    return el('p', {
      id: 'documents-empty',
      text: 'まだ文献がありません。上の「Drive から PDF / フォルダを選択」、またはこの PC からのドラッグ&ドロップ / ファイル選択で採用論文の PDF を取り込んでください。',
    });
  }
  const mergeButton = el('button', {
    id: 'documents-merge',
    className: 'documents__merge-open',
    text: '選択した試験を統合',
    attributes: { type: 'button' },
  });
  mergeButton.disabled = state.documents.selectedStudyIds.length < 2;
  mergeButton.addEventListener('click', () => ctx.documents.onOpenMerge());

  return el('div', { id: 'documents-list', className: 'documents__list' }, [
    el('div', { className: 'documents__list-actions' }, [mergeButton]),
    ...groups.map((group) => renderStudyGroup(group.study, group.documents, state, ctx)),
  ]);
}

export function renderDocumentsView(state: AppState, ctx: ViewContext): HTMLElement {
  const { importing, importRows, mergeDialog } = state.documents;
  const hasProject = state.currentProject !== null;

  const disabled = importing || !hasProject;

  const importButton = el('button', {
    id: 'documents-import',
    className: 'documents__import',
    text: 'Drive から PDF / フォルダを選択',
    attributes: { type: 'button' },
  });
  importButton.disabled = disabled;
  importButton.addEventListener('click', () => ctx.documents.onImport());

  const reloadButton = el('button', {
    id: 'documents-reload',
    className: 'documents__reload',
    text: '一覧を再読み込み',
    attributes: { type: 'button' },
  });
  reloadButton.disabled = disabled;
  reloadButton.addEventListener('click', () => ctx.documents.onReload());

  const children: HTMLElement[] = [
    el('h2', { text: '文献取り込み・グルーピング' }),
    el('p', {
      className: 'view__notice',
      text: '取り込んだ PDF が外部へ送信されるのは LLM API への抽出リクエストのみです。',
    }),
    el('p', {
      className: 'view__lead',
      text: '採用論文の PDF を取り込みます。Drive から選択するか、この PC から PDF をドラッグ&ドロップ / ファイル選択できます。フォルダを選ぶと直下の PDF をまとめて取り込み、同一試験の複数文書は取り込み後に「統合」でまとめられます。',
    }),
    el('div', { className: 'documents__actions' }, [importButton, reloadButton]),
    renderDropzone(ctx, disabled),
  ];
  if (importRows.length > 0) {
    children.push(renderProgress(importRows));
  }
  if (hasProject) {
    children.push(renderTiabCard(state, ctx));
    children.push(...renderCandidateBanners(state, ctx));
    if (mergeDialog !== null) {
      children.push(renderMergeDialog(mergeDialog, state, ctx));
    }
    children.push(renderList(state, ctx));
  }
  return el('section', { className: 'view view--documents' }, children);
}
