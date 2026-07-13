// #/home: プロジェクト概要（進捗サマリ）。0 文献でも崩れないこと（ui-states.md §3）。
// カウントは起動時に Sheets から読み込む（homeService）。読み込み中 / 失敗 + 再読み込み / 通常の 3 状態。
//
// 独立二重レビュー機能（docs/design-independent-dual-review.md §7）により役割で 2 分岐する:
// - owner: 既存の進捗サマリ +「レビュアー管理」カード（一覧 / 追加 / モード変更確認 / 解除）
// - reviewer 系（reviewer_with_ai / reviewer_independent / adjudicator）: 縮退版 Home
//   （プロジェクト名 + フォルダアクセス付与ステップ + 検証への導線のみ。進捗カウントは見せない §3）
import type { ReviewerAssignment, ReviewerRole, ReviewMode } from '../../domain/reviewer';
import { t, type MessageKey } from '../../lib/i18n';
import { el, svgIcon } from '../ui/dom';
import type { AppState, ReviewerFormInput } from '../store';
import type { ViewContext } from './types';

// 表示言語に追従させるため、ラベルは描画時に t() で解決する（キー対応表のみ固定。issue #93）
const ROLE_LABEL_KEYS: Record<ReviewerRole, MessageKey> = {
  reviewer: 'home.roleReviewer',
  adjudicator: 'home.roleAdjudicator',
  revoked: 'home.roleRevoked',
};

const MODE_LABEL_KEYS: Record<ReviewMode, MessageKey> = {
  with_ai: 'home.modeWithAi',
  independent: 'home.modeIndependent',
};

function summaryItems(label: string, value: number): HTMLElement[] {
  return [
    el('dt', { className: 'home__summary-label', text: label }),
    el('dd', { className: 'home__summary-value', text: String(value) }),
  ];
}

// feather 風アイコン（path のみ）。svgIcon で SVG 化する
const COPY_ICON = [
  'M9 11a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2h-9a2 2 0 0 1-2-2z',
  'M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1',
];
const TRASH_ICON = [
  'M3 6h18',
  'M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2',
  'M10 11v6',
  'M14 11v6',
];

function renderReviewerRow(row: ReviewerAssignment, ctx: ViewContext): HTMLElement {
  const modeText =
    row.role === 'reviewer' && row.reviewMode !== null ? t(MODE_LABEL_KEYS[row.reviewMode]) : '–';
  // ごみ箱アイコン = 登録解除（削除）
  const revoke = el('button', {
    className: 'reviewers__revoke reviewers__icon-button',
    attributes: {
      type: 'button',
      'aria-label': t('home.revokeAria', { email: row.email }),
      title: t('home.revokeTitle'),
    },
  }) as HTMLButtonElement;
  revoke.append(svgIcon(TRASH_ICON));
  revoke.disabled = row.role === 'revoked';
  revoke.addEventListener('click', () => ctx.home.onRevokeReviewer(row.email));
  // コピーアイコン = レビュー依頼文をクリップボードへ（操作の右側）
  const copyInvite = el('button', {
    className: 'reviewers__invite reviewers__icon-button',
    attributes: {
      type: 'button',
      'aria-label': t('home.copyInviteAria', { email: row.email }),
      title: t('home.copyInviteTitle'),
    },
  }) as HTMLButtonElement;
  copyInvite.append(svgIcon(COPY_ICON));
  copyInvite.disabled = row.role === 'revoked';
  copyInvite.addEventListener('click', () => ctx.home.onCopyInvite(row.email));
  return el('tr', { className: 'reviewers__row' }, [
    el('td', { text: row.email }),
    el('td', { text: t(ROLE_LABEL_KEYS[row.role]) }),
    el('td', { text: modeText }),
    el('td', { className: 'reviewers__actions' }, [revoke, copyInvite]),
  ]);
}

/** モード変更確認ダイアログ（既存 reviewer のモードを変える送信時。role=alertdialog） */
function renderReviewerModeConfirm(pending: ReviewerFormInput, ctx: ViewContext): HTMLElement {
  const confirm = el('button', {
    id: 'reviewer-mode-confirm-ok',
    text: t('home.modeConfirmOk'),
    attributes: { type: 'button' },
  });
  confirm.addEventListener('click', () => ctx.home.onConfirmReviewerChange());
  const cancel = el('button', {
    id: 'reviewer-mode-confirm-cancel',
    text: t('common.cancel'),
    attributes: { type: 'button' },
  });
  cancel.addEventListener('click', () => ctx.home.onCancelReviewerChange());
  return el(
    'div',
    {
      id: 'reviewer-mode-confirm',
      className: 'reviewers__confirm',
      attributes: { role: 'alertdialog', 'aria-labelledby': 'reviewer-mode-confirm-title' },
    },
    [
      el('h3', { id: 'reviewer-mode-confirm-title', text: t('home.modeConfirmTitle') }),
      el('p', {
        text: t('home.modeConfirmBody', { email: pending.email }),
      }),
      el('div', { className: 'reviewers__confirm-actions' }, [confirm, cancel]),
    ],
  );
}

/** レビュアー追加フォーム（uncontrolled。送信時に値をまとめて onAddReviewer へ渡す） */
function renderReviewerForm(ctx: ViewContext): HTMLFormElement {
  const form = el('form', { id: 'reviewer-add-form', className: 'reviewers__form' }) as HTMLFormElement;
  const emailInput = el('input', {
    id: 'reviewer-email',
    attributes: { type: 'email', 'aria-label': t('home.addReviewerEmailAria') },
  }) as HTMLInputElement;
  const roleSelect = el('select', {
    id: 'reviewer-role',
    attributes: { 'aria-label': t('home.addReviewerRoleAria') },
  }) as HTMLSelectElement;
  roleSelect.append(
    el('option', { text: t(ROLE_LABEL_KEYS.reviewer), attributes: { value: 'reviewer' } }),
    el('option', { text: t(ROLE_LABEL_KEYS.adjudicator), attributes: { value: 'adjudicator' } }),
  );
  const modeSelect = el('select', {
    id: 'reviewer-mode',
    attributes: { 'aria-label': t('home.addReviewerModeAria') },
  }) as HTMLSelectElement;
  modeSelect.append(
    el('option', { text: t(MODE_LABEL_KEYS.with_ai), attributes: { value: 'with_ai' } }),
    el('option', { text: t(MODE_LABEL_KEYS.independent), attributes: { value: 'independent' } }),
  );
  // 裁定者には review_mode の意味がないため、role='adjudicator' の間は無効化する
  roleSelect.addEventListener('change', () => {
    modeSelect.disabled = roleSelect.value !== 'reviewer';
  });

  const submit = el('button', {
    id: 'reviewer-add-submit',
    text: t('home.addSubmit'),
    attributes: { type: 'submit' },
  });
  form.append(
    // email / role / review_mode はシートの列名（コード用語）のため翻訳しない
    el('label', { className: 'reviewers__form-field' }, [el('span', { text: 'email' }), emailInput]),
    el('label', { className: 'reviewers__form-field' }, [el('span', { text: 'role' }), roleSelect]),
    el('label', { className: 'reviewers__form-field' }, [el('span', { text: 'review_mode' }), modeSelect]),
    submit,
  );
  form.addEventListener('submit', (event) => {
    event.preventDefault();
    ctx.home.onAddReviewer({
      email: emailInput.value,
      role: roleSelect.value as 'reviewer' | 'adjudicator',
      reviewMode: modeSelect.value as ReviewMode,
    });
  });
  return form;
}

/** owner 専用の「レビュアー管理」カード（§7.1・§8.1）。一覧 + 追加フォーム + モード変更確認 + 解除 */
function renderReviewerAdminCard(state: AppState, ctx: ViewContext): HTMLElement {
  const { reviewers } = state;
  const children: Array<HTMLElement | string> = [
    el('h3', { text: t('home.reviewersTitle') }),
    el('p', {
      className: 'view__notice',
      text: t('home.reviewersNotice'),
    }),
  ];
  if (reviewers.loading) {
    children.push(el('p', { id: 'home-reviewers-loading', text: t('home.reviewersLoading') }));
  } else if (reviewers.loadError !== null) {
    const reload = el('button', {
      id: 'home-reviewers-reload',
      text: t('common.reload'),
      attributes: { type: 'button' },
    });
    reload.addEventListener('click', () => ctx.home.onReloadReviewers());
    children.push(
      el('p', {
        id: 'home-reviewers-error',
        className: 'home__error',
        attributes: { role: 'alert' },
        text: t('home.reviewersError', { reason: reviewers.loadError }),
      }),
      reload,
    );
  } else {
    const rows = reviewers.assignments ?? [];
    if (rows.length === 0) {
      children.push(el('p', { id: 'home-reviewers-empty', text: t('home.reviewersEmpty') }));
    } else {
      children.push(
        el('table', { id: 'home-reviewers-list', className: 'reviewers__table' }, [
          el('thead', {}, [
            el('tr', {}, [
              el('th', { text: 'email' }),
              el('th', { text: 'role' }),
              el('th', { text: 'review_mode' }),
              el('th', { text: t('home.reviewersActions') }),
            ]),
          ]),
          el('tbody', {}, rows.map((row) => renderReviewerRow(row, ctx))),
        ]),
      );
    }
  }
  if (reviewers.saveError !== null) {
    children.push(
      el('p', {
        id: 'home-reviewers-save-error',
        className: 'home__error',
        attributes: { role: 'alert' },
        text: reviewers.saveError,
      }),
    );
  }
  children.push(renderReviewerForm(ctx));
  if (reviewers.confirmingChange !== null) {
    children.push(renderReviewerModeConfirm(reviewers.confirmingChange, ctx));
  }
  return el('section', { id: 'home-reviewers', className: 'home__reviewers' }, children);
}

/** owner 用の Home（既存の進捗サマリ + レビュアー管理カード） */
function renderOwnerHome(state: AppState, ctx: ViewContext): HTMLElement {
  const { counts, home } = state;
  const projectName = state.currentProject?.name ?? t('home.projectNone');
  const children: Array<HTMLElement | string> = [
    el('h2', { text: t('home.title') }),
    el('p', { className: 'view__lead', text: t('app.statusProject', { name: projectName }) }),
    // プロジェクト切替: S1 プロジェクト選択ページへ同一タブで遷移する（新規タブは開かない）
    el('p', {}, [
      el('a', {
        id: 'home-switch-project',
        text: t('app.switchProject'),
        attributes: { href: '../popup/popup.html' },
      }),
    ]),
  ];

  if (home.countsLoading) {
    children.push(el('p', { id: 'home-counts-loading', text: t('home.countsLoading') }));
  } else if (home.countsError !== null) {
    const reload = el('button', {
      id: 'home-counts-reload',
      text: t('common.reload'),
      attributes: { type: 'button' },
    });
    reload.addEventListener('click', () => ctx.home.onReload());
    children.push(
      el('p', {
        id: 'home-counts-error',
        className: 'home__error',
        attributes: { role: 'alert' },
        text: t('home.countsError', { reason: home.countsError }),
      }),
      reload,
    );
  } else {
    children.push(
      el('dl', { className: 'home__summary' }, [
        ...summaryItems(t('home.summaryDocuments'), counts.documents),
        ...summaryItems(t('home.summaryProtocolVersions'), counts.protocolVersions),
        ...summaryItems(t('home.summarySchemaVersions'), counts.schemaVersions),
        ...summaryItems(t('home.summaryEvidenceRows'), counts.evidenceRows),
        ...summaryItems(t('home.summaryDataRows'), counts.dataRows),
      ]),
    );
  }

  if (state.currentProject !== null) {
    children.push(renderReviewerAdminCard(state, ctx));
  }

  return el('section', { className: 'view view--home' }, children);
}

/** reviewer 系ロール用の縮退版 Home（§3・§7.2）。進捗カウントは見せない */
function renderReviewerHome(state: AppState, ctx: ViewContext): HTMLElement {
  const projectName = state.currentProject?.name ?? t('home.projectNone');
  const children: Array<HTMLElement | string> = [
    el('h2', { text: t('home.title') }),
    el('p', { className: 'view__lead', text: t('app.statusProject', { name: projectName }) }),
    el('p', {}, [
      el('a', {
        id: 'home-switch-project',
        text: t('app.switchProject'),
        attributes: { href: '../popup/popup.html' },
      }),
    ]),
  ];

  if (!state.role.folderAccessGranted) {
    const grant = el('button', {
      id: 'home-grant-folder-access',
      text: t('home.grantFolderAccess'),
      attributes: { type: 'button' },
    }) as HTMLButtonElement;
    grant.disabled = state.role.folderAccessChecking;
    grant.addEventListener('click', () => ctx.home.onGrantFolderAccess());
    const stepChildren: Array<HTMLElement | string> = [
      el('p', {
        text: t('home.folderAccessLead'),
      }),
      grant,
    ];
    if (state.role.folderAccessChecking) {
      stepChildren.push(el('p', { id: 'home-folder-access-checking', text: t('home.folderAccessChecking') }));
    }
    if (state.role.folderAccessError !== null) {
      stepChildren.push(
        el('p', {
          id: 'home-folder-access-error',
          className: 'home__error',
          attributes: { role: 'alert' },
          text: t('home.folderAccessError', { reason: state.role.folderAccessError }),
        }),
      );
    }
    children.push(el('div', { id: 'home-folder-access', className: 'home__folder-access' }, stepChildren));
  } else {
    children.push(
      el('p', { id: 'home-folder-access-granted', text: t('home.folderAccessGranted') }),
      el('p', {}, [
        el('a', { id: 'home-go-verify', text: t('home.goVerify'), attributes: { href: '#/verify' } }),
      ]),
    );
  }

  return el('section', { className: 'view view--home view--home-reviewer' }, children);
}

export function renderHomeView(state: AppState, ctx: ViewContext): HTMLElement {
  const role = state.role.role ?? 'owner';
  if (role !== 'owner') {
    return renderReviewerHome(state, ctx);
  }
  return renderOwnerHome(state, ctx);
}
