// #/home: プロジェクト概要（進捗サマリ）。0 文献でも崩れないこと（ui-states.md §3）。
// カウントは起動時に Sheets から読み込む（homeService）。読み込み中 / 失敗 + 再読み込み / 通常の 3 状態。
//
// 独立二重レビュー機能（docs/design-independent-dual-review.md §7）により役割で 2 分岐する:
// - owner: 既存の進捗サマリ +「レビュアー管理」カード（一覧 / 追加 / モード変更確認 / 解除）
// - reviewer 系（reviewer_with_ai / reviewer_independent / adjudicator）: 縮退版 Home
//   （プロジェクト名 + フォルダアクセス付与ステップ + 検証への導線のみ。進捗カウントは見せない §3）
import type { ReviewerAssignment, ReviewerRole, ReviewMode } from '../../domain/reviewer';
import { el } from '../ui/dom';
import type { AppState, ReviewerFormInput } from '../store';
import type { ViewContext } from './types';

const ROLE_LABELS: Record<ReviewerRole, string> = {
  reviewer: 'レビュアー',
  adjudicator: '裁定者',
  revoked: '解除済み',
};

const MODE_LABELS: Record<ReviewMode, string> = {
  with_ai: '① AI の結果をレビュー',
  independent: '② AI 抜きでレビュー',
};

function summaryItems(label: string, value: number): HTMLElement[] {
  return [
    el('dt', { className: 'home__summary-label', text: label }),
    el('dd', { className: 'home__summary-value', text: String(value) }),
  ];
}

function renderReviewerRow(row: ReviewerAssignment, ctx: ViewContext): HTMLElement {
  const modeText = row.role === 'reviewer' && row.reviewMode !== null ? MODE_LABELS[row.reviewMode] : '–';
  const revoke = el('button', {
    className: 'reviewers__revoke',
    text: '解除',
    attributes: { type: 'button', 'aria-label': `${row.email} を解除` },
  }) as HTMLButtonElement;
  revoke.disabled = row.role === 'revoked';
  revoke.addEventListener('click', () => ctx.home.onRevokeReviewer(row.email));
  return el('tr', { className: 'reviewers__row' }, [
    el('td', { text: row.email }),
    el('td', { text: ROLE_LABELS[row.role] }),
    el('td', { text: modeText }),
    el('td', {}, [revoke]),
  ]);
}

/** モード変更確認ダイアログ（既存 reviewer のモードを変える送信時。role=alertdialog） */
function renderReviewerModeConfirm(pending: ReviewerFormInput, ctx: ViewContext): HTMLElement {
  const confirm = el('button', {
    id: 'reviewer-mode-confirm-ok',
    text: '続行して変更する',
    attributes: { type: 'button' },
  });
  confirm.addEventListener('click', () => ctx.home.onConfirmReviewerChange());
  const cancel = el('button', {
    id: 'reviewer-mode-confirm-cancel',
    text: 'キャンセル',
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
      el('h3', { id: 'reviewer-mode-confirm-title', text: 'レビューモードを変更しますか？' }),
      el('p', {
        text: `${pending.email} は既に登録済みです。モード変更（盲検の前提）は事後的に盲検を破る可能性があります。`,
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
    attributes: { type: 'email', 'aria-label': '追加するレビュアーの email' },
  }) as HTMLInputElement;
  const roleSelect = el('select', {
    id: 'reviewer-role',
    attributes: { 'aria-label': '役割（role）' },
  }) as HTMLSelectElement;
  roleSelect.append(
    el('option', { text: ROLE_LABELS.reviewer, attributes: { value: 'reviewer' } }),
    el('option', { text: ROLE_LABELS.adjudicator, attributes: { value: 'adjudicator' } }),
  );
  const modeSelect = el('select', {
    id: 'reviewer-mode',
    attributes: { 'aria-label': 'レビューモード（review_mode）' },
  }) as HTMLSelectElement;
  modeSelect.append(
    el('option', { text: MODE_LABELS.with_ai, attributes: { value: 'with_ai' } }),
    el('option', { text: MODE_LABELS.independent, attributes: { value: 'independent' } }),
  );
  // 裁定者には review_mode の意味がないため、role='adjudicator' の間は無効化する
  roleSelect.addEventListener('change', () => {
    modeSelect.disabled = roleSelect.value !== 'reviewer';
  });

  const submit = el('button', {
    id: 'reviewer-add-submit',
    text: '追加',
    attributes: { type: 'submit' },
  });
  form.append(
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
    el('h3', { text: 'レビュアー管理' }),
    el('p', {
      className: 'view__notice',
      text: 'スプレッドシートとプロジェクトフォルダの共有は Google Drive 側で行ってください。ここでは役割の登録のみを行います。',
    }),
  ];
  if (reviewers.loading) {
    children.push(el('p', { id: 'home-reviewers-loading', text: '読み込んでいます…' }));
  } else if (reviewers.loadError !== null) {
    const reload = el('button', {
      id: 'home-reviewers-reload',
      text: '再読み込み',
      attributes: { type: 'button' },
    });
    reload.addEventListener('click', () => ctx.home.onReloadReviewers());
    children.push(
      el('p', {
        id: 'home-reviewers-error',
        className: 'home__error',
        attributes: { role: 'alert' },
        text: `一覧を読み込めませんでした: ${reviewers.loadError}`,
      }),
      reload,
    );
  } else {
    const rows = reviewers.assignments ?? [];
    if (rows.length === 0) {
      children.push(el('p', { id: 'home-reviewers-empty', text: 'まだレビュアーが登録されていません。' }));
    } else {
      children.push(
        el('table', { id: 'home-reviewers-list', className: 'reviewers__table' }, [
          el('thead', {}, [
            el('tr', {}, [
              el('th', { text: 'email' }),
              el('th', { text: 'role' }),
              el('th', { text: 'review_mode' }),
              el('th', { text: '操作' }),
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
  const projectName = state.currentProject?.name ?? '未選択';
  const children: Array<HTMLElement | string> = [
    el('h2', { text: 'プロジェクト概要' }),
    el('p', { className: 'view__lead', text: `プロジェクト: ${projectName}` }),
    // プロジェクト切替: S1 プロジェクト選択ページへ同一タブで遷移する（新規タブは開かない）
    el('p', {}, [
      el('a', {
        id: 'home-switch-project',
        text: '別のプロジェクトを開く',
        attributes: { href: '../popup/popup.html' },
      }),
    ]),
  ];

  if (home.countsLoading) {
    children.push(el('p', { id: 'home-counts-loading', text: '進捗を読み込んでいます…' }));
  } else if (home.countsError !== null) {
    const reload = el('button', {
      id: 'home-counts-reload',
      text: '再読み込み',
      attributes: { type: 'button' },
    });
    reload.addEventListener('click', () => ctx.home.onReload());
    children.push(
      el('p', {
        id: 'home-counts-error',
        className: 'home__error',
        attributes: { role: 'alert' },
        text: `進捗を読み込めませんでした: ${home.countsError}`,
      }),
      reload,
    );
  } else {
    children.push(
      el('dl', { className: 'home__summary' }, [
        ...summaryItems('文献数', counts.documents),
        ...summaryItems('プロトコル版数', counts.protocolVersions),
        ...summaryItems('表のデザインの確定版数', counts.schemaVersions),
        ...summaryItems('AI 抽出済み Evidence 行数', counts.evidenceRows),
        ...summaryItems('データ行数（StudyData + ResultsData）', counts.dataRows),
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
  const projectName = state.currentProject?.name ?? '未選択';
  const children: Array<HTMLElement | string> = [
    el('h2', { text: 'プロジェクト概要' }),
    el('p', { className: 'view__lead', text: `プロジェクト: ${projectName}` }),
    el('p', {}, [
      el('a', {
        id: 'home-switch-project',
        text: '別のプロジェクトを開く',
        attributes: { href: '../popup/popup.html' },
      }),
    ]),
  ];

  if (!state.role.folderAccessGranted) {
    const grant = el('button', {
      id: 'home-grant-folder-access',
      text: 'プロジェクトフォルダへのアクセスを付与',
      attributes: { type: 'button' },
    }) as HTMLButtonElement;
    grant.disabled = state.role.folderAccessChecking;
    grant.addEventListener('click', () => ctx.home.onGrantFolderAccess());
    const stepChildren: Array<HTMLElement | string> = [
      el('p', {
        text: '検証を始める前に、プロジェクトの Drive フォルダへのアクセスを付与してください（PDF・抽出テキストを読み込むために必要です）。',
      }),
      grant,
    ];
    if (state.role.folderAccessChecking) {
      stepChildren.push(el('p', { id: 'home-folder-access-checking', text: '確認しています…' }));
    }
    if (state.role.folderAccessError !== null) {
      stepChildren.push(
        el('p', {
          id: 'home-folder-access-error',
          className: 'home__error',
          attributes: { role: 'alert' },
          text: `アクセスを確認できませんでした: ${state.role.folderAccessError}`,
        }),
      );
    }
    children.push(el('div', { id: 'home-folder-access', className: 'home__folder-access' }, stepChildren));
  } else {
    children.push(
      el('p', { id: 'home-folder-access-granted', text: 'プロジェクトフォルダへのアクセスは付与済みです。' }),
      el('p', {}, [
        el('a', { id: 'home-go-verify', text: '検証を開始する', attributes: { href: '#/verify' } }),
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
