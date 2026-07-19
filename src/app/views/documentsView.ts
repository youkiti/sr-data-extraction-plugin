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
import { t, type MessageKey } from '../../lib/i18n';
import { activeStudyGroups, visibleMergeCandidates } from '../services/documentsService';
import { el } from '../ui/dom';
import type {
  AppState,
  ImportRow,
  ImportRowStatus,
  MergeDialogState,
  TiabHandoffState,
  TiabImportState,
} from '../store';
import type { ViewContext } from './types';

// 表示言語に追従させるため、ラベルは描画時に t() で解決する（キー対応表のみ固定。issue #93）
const IMPORT_ROW_LABEL_KEYS: Record<ImportRowStatus, MessageKey> = {
  queued: 'documents.importStatusQueued',
  copy: 'documents.importStatusCopy',
  extract: 'documents.importStatusExtract',
  done: 'documents.importStatusDone',
  failed: 'documents.importStatusFailed',
  skipped: 'documents.importStatusSkipped',
};

/** include 抽出に使った相の表示名（ui-states.md §3） */
const TIAB_PHASE_LABEL_KEYS: Record<TiabScreeningPhase, MessageKey> = {
  fulltext: 'documents.tiabPhaseFulltext',
  tiab: 'documents.tiabPhaseTiab',
};

/** プレビュー行の状態バッジ文言 */
const TIAB_STATUS_LABEL_KEYS: Record<TiabPlanItemStatus, MessageKey> = {
  update: 'documents.tiabStatusUpdate',
  already: 'documents.tiabStatusAlready',
  unmatched: 'documents.tiabStatusUnmatched',
};

const TEXT_STATUS_NOTE_KEYS: Partial<Record<TextStatus, MessageKey>> = {
  no_text_layer: 'documents.textStatusNoteNoTextLayer',
};

const ROLE_LABEL_KEYS: Record<DocumentRole, MessageKey> = {
  article: 'documents.roleArticle',
  registration: 'documents.roleRegistration',
  protocol: 'documents.roleProtocol',
  abstract: 'documents.roleAbstract',
  supplement: 'documents.roleSupplement',
  other: 'documents.roleOther',
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
    text: t('documents.localImport'),
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
    el('p', { className: 'documents__dropzone-prompt', text: t('documents.dropPrompt') }),
    el('p', { className: 'documents__dropzone-or', text: t('documents.dropOr') }),
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
        ? `${t(IMPORT_ROW_LABEL_KEYS[row.status])}（${row.detail}）`
        : t(IMPORT_ROW_LABEL_KEYS[row.status]);
    return el('li', { className: 'documents__progress-row' }, [
      el('span', { className: 'documents__progress-filename', text: row.filename }),
      el('span', {
        className: `documents__progress-status documents__progress-status--${row.status}`,
        text: statusText,
      }),
    ]);
  });
  return el('div', { className: 'documents__progress' }, [
    el('h3', { text: t('documents.progressTitle') }),
    el('ul', { id: 'documents-progress', className: 'documents__progress-list' }, items),
  ]);
}

function renderStatusBadge(status: TextStatus): HTMLElement {
  const badge = el('span', {
    className: `documents__badge documents__badge--${status}`,
    text: status,
  });
  const noteKey = TEXT_STATUS_NOTE_KEYS[status];
  if (noteKey === undefined) {
    return badge;
  }
  return el('span', {}, [
    badge,
    el('small', { className: 'documents__badge-note', text: t(noteKey) }),
  ]);
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
    attributes: { 'aria-label': t('documents.roleSelectAria', { filename: doc.filename }) },
  }) as HTMLSelectElement;
  for (const role of DOCUMENT_ROLE_ORDER) {
    select.append(
      el('option', { text: t(ROLE_LABEL_KEYS[role]), attributes: { value: role } }),
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
    attributes: {
      type: 'checkbox',
      'aria-label': t('documents.mergeTargetAria', { label: study.studyLabel }),
    },
  }) as HTMLInputElement;
  checkbox.checked = state.documents.selectedStudyIds.includes(study.studyId);
  checkbox.addEventListener('change', () =>
    ctx.documents.onToggleStudySelection(study.studyId, checkbox.checked),
  );

  const labelInput = inlineInput(
    study.studyLabel,
    t('documents.studyLabelAria', { label: study.studyLabel }),
    'documents__label-input',
    (value) => ctx.documents.onSaveStudyLabel(study.studyId, value),
  );
  const regInput = inlineInput(
    study.registrationId ?? '',
    t('documents.registrationIdAria', { label: study.studyLabel }),
    'documents__registration-input',
    (value) => ctx.documents.onSaveRegistrationId(study.studyId, value),
  );

  const docsTable = el('table', { className: 'documents__docs-table' }, [
    el('thead', {}, [
      el('tr', {}, [
        el('th', { text: t('documents.headRole') }),
        el('th', { text: t('documents.headFilename') }),
        el('th', { text: t('documents.headTextStatus') }),
        el('th', { text: t('documents.headPages') }),
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
          el('span', { text: t('documents.mergeTarget') }),
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
      text: t('documents.tiabSummary', {
        include: plan.includeCount,
        phase: t(TIAB_PHASE_LABEL_KEYS[plan.phase]),
        total: plan.totalReferences,
        update: counts.update,
        already: counts.already,
        unmatched: counts.unmatched,
      }),
    }),
  ];
  if (plan.items.length === 0) {
    children.push(
      el('p', {
        id: 'tiab-plan-empty',
        text: t('documents.tiabPlanEmpty'),
      }),
    );
    return children;
  }
  const table = el('table', { id: 'tiab-plan', className: 'documents__tiab-table' }, [
    el('thead', {}, [
      el('tr', {}, [
        el('th', { text: t('documents.tiabHeadReference') }),
        el('th', { text: t('documents.tiabHeadLabel') }),
        el('th', { text: t('documents.tiabHeadMatched') }),
        el('th', { text: t('documents.tiabHeadStatus') }),
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
              text: t(TIAB_STATUS_LABEL_KEYS[item.status]),
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
    text: tiab.applying ? t('documents.tiabApplying') : t('documents.tiabApply'),
    attributes: { type: 'button' },
  });
  apply.disabled =
    tiab.applying || (plan.studyUpdates.length === 0 && plan.documentUpdates.length === 0);
  apply.addEventListener('click', () => ctx.documents.onTiabApply());
  children.push(el('div', { className: 'documents__tiab-actions' }, [apply]));
  return children;
}

/**
 * tiab-review 引き継ぎパネル（S1 #popup-tiab-handoff からの継続。ui-states.md §3）。
 * chrome.storage.local の tiabHandoff が現在のプロジェクトを指すときだけ、tiab カード導線の
 * 上に表示する（documentsService.loadDocuments が一覧読込時に同期する）。
 * 「include の PDF をまとめて取り込む」で fulltext 列挙 → Picker → 取り込み → 自動プレビューの
 * 一連を実行し、「この案内を閉じる」で storage の引き継ぎ状態を破棄してパネルを消す
 */
function renderTiabHandoffPanel(handoff: TiabHandoffState, state: AppState, ctx: ViewContext): HTMLElement {
  const importButton = el('button', {
    id: 'tiab-handoff-import',
    text: t('documents.tiabHandoffImport'),
    attributes: { type: 'button' },
  }) as HTMLButtonElement;
  // runTiabHandoffImport のガード（取り込み中・tiab カードの読込 / 反映中は no-op）と
  // 揃える — ガードだけだと「押せるのに何も起きない」ボタンになる
  importButton.disabled =
    handoff.running ||
    state.documents.importing ||
    state.documents.tiabImport.loading ||
    state.documents.tiabImport.applying;
  importButton.addEventListener('click', () => ctx.documents.onTiabHandoffImport());

  const dismissButton = el('button', {
    id: 'tiab-handoff-dismiss',
    text: t('documents.tiabHandoffDismiss'),
    attributes: { type: 'button' },
  }) as HTMLButtonElement;
  dismissButton.disabled = handoff.running;
  dismissButton.addEventListener('click', () => ctx.documents.onTiabHandoffDismiss());

  const children: HTMLElement[] = [
    el('h3', { text: t('documents.tiabHandoffTitle') }),
    el('p', { className: 'view__lead', text: t('documents.tiabHandoffLead') }),
    el('div', { className: 'documents__tiab-actions' }, [importButton, dismissButton]),
  ];
  if (handoff.running) {
    children.push(
      el('p', {
        id: 'tiab-handoff-running',
        attributes: { role: 'status' },
        text: t('documents.tiabHandoffRunning'),
      }),
    );
  }
  if (handoff.error !== null) {
    children.push(
      el('p', {
        id: 'tiab-handoff-error',
        className: 'documents__error',
        attributes: { role: 'alert' },
        text: handoff.error,
      }),
    );
  }
  return el('section', { id: 'documents-tiab-handoff', className: 'documents__tiab' }, children);
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
      text: t('documents.tiabOpen'),
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
      'aria-label': t('documents.tiabSheetAria'),
      placeholder: t('documents.tiabSheetPlaceholder'),
    },
  }) as HTMLInputElement;
  input.value = tiab.sheetInput;

  const preview = el('button', {
    id: 'tiab-preview',
    text: t('documents.tiabPreview'),
    attributes: { type: 'button' },
  });
  preview.disabled = busy;
  preview.addEventListener('click', () => ctx.documents.onTiabPreview(input.value));

  const close = el('button', {
    id: 'tiab-close',
    text: t('documents.tiabClose'),
    attributes: { type: 'button' },
  });
  close.disabled = busy;
  close.addEventListener('click', () => ctx.documents.onTiabClose());

  const children: HTMLElement[] = [
    el('h3', { text: t('documents.tiabOpen') }),
    el('p', {
      className: 'view__lead',
      text: t('documents.tiabLead'),
    }),
    el('div', { className: 'documents__tiab-form' }, [input, preview, close]),
  ];
  if (tiab.loading) {
    children.push(el('p', { id: 'tiab-loading', text: t('documents.tiabLoading') }));
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
    // drive.file 未許可（403/404）からの Picker 許可導線（issue #142。#app-role-grant と同じトンマナ）
    if (tiab.accessDenied) {
      const grant = el('button', {
        id: 'tiab-grant-access',
        text: t('app.roleAccessGrant'),
        attributes: { type: 'button' },
      }) as HTMLButtonElement;
      grant.addEventListener('click', () => {
        // Picker タブが開いている間の二重起動を防ぐ（完了時は store パッチで作り直される）
        grant.disabled = true;
        ctx.documents.onTiabGrantAccess();
      });
      children.push(grant);
    }
  }
  if (tiab.plan !== null) {
    children.push(...renderTiabPlan(tiab.plan, tiab, ctx));
  }
  if (tiab.result !== null) {
    const suffix =
      tiab.result.unmatched > 0
        ? t('documents.tiabResultUnmatched', { n: tiab.result.unmatched })
        : '';
    children.push(
      el('p', {
        id: 'tiab-result',
        className: 'documents__tiab-result',
        attributes: { role: 'status' },
        text: t('documents.tiabResult', {
          studies: tiab.result.studiesUpdated,
          documents: tiab.result.documentsUpdated,
          unmatchedSuffix: suffix,
        }),
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
      text: t('documents.merge'),
    });
    mergeButton.addEventListener('click', () =>
      ctx.documents.onOpenMergeCandidate(candidate.studyIds),
    );
    const ignoreButton = el('button', {
      className: 'documents__candidate-ignore',
      attributes: { type: 'button' },
      text: t('documents.candidateIgnore'),
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
          text: t('documents.candidateBody', {
            registrationId: candidate.registrationId,
            count: candidate.studyIds.length,
          }),
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
    attributes: { type: 'text', 'aria-label': t('documents.mergeLabelLabel') },
  }) as HTMLInputElement;
  labelInput.value = dialog.label;
  labelInput.addEventListener('input', () => ctx.documents.onUpdateMergeLabel(labelInput.value));

  const regInput = el('input', {
    id: 'merge-registration',
    attributes: { type: 'text', 'aria-label': t('documents.mergeRegistrationLabel') },
  }) as HTMLInputElement;
  regInput.value = dialog.registrationId;
  regInput.addEventListener('input', () =>
    ctx.documents.onUpdateMergeRegistration(regInput.value),
  );

  const children: HTMLElement[] = [
    el('h3', { id: 'merge-dialog-title', text: t('documents.mergeDialogTitle') }),
    el('p', { text: t('documents.mergeDialogBody', { count: dialog.studyIds.length }) }),
    el('label', {}, [el('span', { text: `${t('documents.mergeLabelLabel')}: ` }), labelInput]),
    el('label', {}, [el('span', { text: `${t('documents.mergeRegistrationLabel')}: ` }), regInput]),
  ];
  if (dialog.hasExtractedData) {
    children.push(
      el('p', {
        id: 'merge-warning',
        className: 'documents__merge-warning',
        attributes: { role: 'alert' },
        text: t('documents.mergeWarning'),
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
    text: t('documents.merge'),
  });
  confirm.addEventListener('click', () => ctx.documents.onConfirmMerge());
  const cancel = el('button', {
    id: 'merge-cancel',
    attributes: { type: 'button' },
    text: t('common.cancel'),
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
      text: t('documents.loadError', { reason: loadError }),
    });
  }
  if (records === null || studies === null || loading) {
    return el('p', { id: 'documents-loading', text: t('documents.loading') });
  }
  const groups = activeStudyGroups(studies, records);
  if (groups.length === 0) {
    return el('p', {
      id: 'documents-empty',
      text: t('documents.empty'),
    });
  }
  const mergeButton = el('button', {
    id: 'documents-merge',
    className: 'documents__merge-open',
    text: t('documents.mergeOpen'),
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
    text: t('documents.importDrive'),
    attributes: { type: 'button' },
  });
  importButton.disabled = disabled;
  importButton.addEventListener('click', () => ctx.documents.onImport());

  const reloadButton = el('button', {
    id: 'documents-reload',
    className: 'documents__reload',
    text: t('common.reloadList'),
    attributes: { type: 'button' },
  });
  reloadButton.disabled = disabled;
  reloadButton.addEventListener('click', () => ctx.documents.onReload());

  const children: HTMLElement[] = [
    el('h2', { text: t('documents.title') }),
    el('p', {
      className: 'view__notice',
      text: t('documents.notice'),
    }),
    el('p', {
      className: 'view__lead',
      text: t('documents.lead'),
    }),
    el('div', { className: 'documents__actions' }, [importButton, reloadButton]),
    renderDropzone(ctx, disabled),
  ];
  if (importRows.length > 0) {
    children.push(renderProgress(importRows));
  }
  if (hasProject) {
    if (state.documents.tiabHandoff !== null) {
      children.push(renderTiabHandoffPanel(state.documents.tiabHandoff, state, ctx));
    }
    children.push(renderTiabCard(state, ctx));
    children.push(...renderCandidateBanners(state, ctx));
    if (mergeDialog !== null) {
      children.push(renderMergeDialog(mergeDialog, state, ctx));
    }
    children.push(renderList(state, ctx));
  }
  return el('section', { className: 'view view--documents' }, children);
}
