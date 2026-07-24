// #/verify: 検証（S8・中核画面 / ui-states.md §3。v0.10 フェーズ 3 = study 単位）。
// 状態: 一覧読み込み中 / 一覧読み込み失敗 / 空 / 通常（study セレクタ + 2 ペイン検証パネル）。
// study の切替は URL クエリ ?study= と同期する（セレクタ変更 → hash 書き換え → サービス層が読込）。
// ?entity=（S9 ダッシュボードのセル単位ディープリンク）は該当タブへの切替 + 先頭セルへの
// スクロール・フォーカスとしてパネルへ渡す。2 ペイン本体は #/pilot と同じ verificationPanel を使う
import { t } from '../../lib/i18n';
import { el } from '../ui/dom';
import type { AppState, VerifyTarget } from '../store';
import { renderConflictWarning } from './conflictWarning';
import type { ViewContext } from './types';
import { renderCachedVerificationPanel } from './verificationPanel';

function selectorLabel(target: VerifyTarget): string {
  const { progress } = target;
  const key =
    target.aiExtractionStatus === 'no_result' ? 'verify.selectorOptionNoResult' : 'verify.selectorOption';
  return t(key, {
    label: target.study.studyLabel,
    decided: progress.decided,
    total: progress.total,
  });
}

/**
 * AI 抽出結果なしバナー（完了 run の対象だったが Evidence が 1 行も生成されなかった study）。
 * 手入力で記録できる旨に加え、rob_domain タブが入力できない制限を正直に明記する
 * （features/verification/cells.ts の entityInstances は rob_domain のインスタンスを
 * Evidence と Decisions からのみ導出するため、両方 0 件だとタブが空になる）
 */
function renderNoAiResultBanner(): HTMLElement {
  return el(
    'div',
    {
      id: 'verify-no-ai-result',
      className: 'verify__no-ai-result',
      attributes: { role: 'status' },
    },
    [
      el('p', { text: t('verify.noAiResultLead') }),
      el('p', { text: t('verify.noAiResultRobLimit') }),
    ],
  );
}

/**
 * 選択中 study の arm completeness 警告バナー（issue #106・`#verify-arm-completeness-warning`）。
 * 直近 run（ExtractionRuns.warnings）由来。項目名は表示 run のスキーマ項目ラベルで解決する。
 * 警告が無ければ null（独立入力モードは armWarnings が常に空のため自動的に出ない）
 */
function renderArmCompletenessWarning(target: VerifyTarget): HTMLElement | null {
  if (target.armWarnings.length === 0) {
    return null;
  }
  const labelById = new Map(target.fields.map((field) => [field.fieldId, field.fieldLabel]));
  const items = target.armWarnings.map((warning) => {
    const scope =
      warning.section === null ? '' : t('extract.armWarningScope', { section: warning.section });
    const missing = warning.missingItems
      .map((item) => `${item.armKey} × ${labelById.get(item.fieldId) ?? item.fieldId}`)
      .join('、');
    // シート保存時にサイズ上限で切り詰められた警告は残件数を添える（runRepository.warningsToCell）
    const omitted =
      warning.truncated === true && warning.missingItemsTotal !== undefined
        ? t('verify.armWarnOmitted', { n: warning.missingItemsTotal - warning.missingItems.length })
        : '';
    return el('li', { text: t('verify.armWarnItem', { scope, missing, omitted }) });
  });
  return el(
    'div',
    {
      id: 'verify-arm-completeness-warning',
      className: 'verify__arm-completeness-warning',
      attributes: { role: 'status' },
    },
    [
      el('p', {
        text: t('verify.armWarnLead'),
      }),
      el('ul', {}, items),
    ],
  );
}

function renderSelector(state: AppState, ctx: ViewContext, targets: readonly VerifyTarget[]): HTMLElement {
  const select = el('select', {
    id: 'verify-study',
    attributes: { 'aria-label': t('verify.studyAria') },
  });
  for (const target of targets) {
    select.append(
      el('option', {
        text: selectorLabel(target),
        attributes: { value: target.study.studyId },
      }),
    );
  }
  if (state.verify.selectedStudyId !== null) {
    select.value = state.verify.selectedStudyId;
  }
  select.addEventListener('change', () => ctx.verify.onSelectStudy(select.value));

  const children: HTMLElement[] = [
    el('label', { text: t('verify.studyLabel'), attributes: { for: 'verify-study' } }),
    select,
  ];
  if (state.verify.queuedDecisions > 0) {
    children.push(
      el('span', {
        id: 'verify-queued',
        className: 'verify__queued',
        text: t('verify.queued', { n: state.verify.queuedDecisions }),
      }),
    );
  }
  return el('div', { className: 'verify__doc-header' }, children);
}

export function renderVerifyView(state: AppState, ctx: ViewContext): HTMLElement {
  // 独立入力モード（reviewer_independent。design §5）は AI 抽出を一切見せない盲検レビューのため、
  // 冒頭の説明文・空状態メッセージを AI 抽出前提の文言から入れ替える
  const independent = state.role.role === 'reviewer_independent';
  const children: HTMLElement[] = [
    el('h2', { text: t('app.navVerify') }),
    el('p', {
      className: 'view__lead',
      text: independent ? t('verify.leadIndependent') : t('verify.lead'),
    }),
  ];
  const verify = state.verify;

  if (verify.loadError !== null) {
    const retry = el('button', {
      id: 'verify-retry',
      text: t('common.retry'),
      attributes: { type: 'button' },
    });
    retry.addEventListener('click', () => ctx.verify.onRetryLoad());
    children.push(
      el('p', {
        id: 'verify-error',
        className: 'verify__error',
        attributes: { role: 'alert' },
        text: t('verify.loadError', { reason: verify.loadError }),
      }),
      retry,
    );
    return el('section', { className: 'view view--verify' }, children);
  }

  if (verify.targets === null || verify.loading) {
    children.push(el('p', { id: 'verify-loading', text: t('verify.loading') }));
    return el('section', { className: 'view view--verify' }, children);
  }

  if (verify.targets.length === 0) {
    // 独立入力モードは「確定済みスキーマが無い」「Studies が 0 件」のいずれでも一覧が空になる
    // （design §5.1）。AI 抽出の有無を前提にした案内は出さない
    children.push(
      el('p', {
        id: 'verify-empty',
        text: independent ? t('verify.emptyIndependent') : t('verify.empty'),
      }),
    );
    return el('section', { className: 'view view--verify' }, children);
  }

  children.push(renderSelector(state, ctx, verify.targets));

  // 選択中 study の AI 抽出結果なしバナー・arm 欠落警告（issue #106）。
  // セレクタ直下 = パネル読み込み中でも見える
  const selectedTarget = verify.targets.find(
    (target) => target.study.studyId === verify.selectedStudyId,
  );
  if (selectedTarget !== undefined) {
    if (selectedTarget.aiExtractionStatus === 'no_result') {
      children.push(renderNoAiResultBanner());
    }
    const armWarning = renderArmCompletenessWarning(selectedTarget);
    if (armWarning !== null) {
      children.push(armWarning);
    }
  }

  if (verify.verifyError !== null) {
    children.push(
      el('p', {
        id: 'verify-error',
        className: 'verify__error',
        attributes: { role: 'alert' },
        text: verify.verifyError,
      }),
    );
  }
  if (verify.verifyLoading) {
    children.push(el('p', { id: 'verify-doc-loading', text: t('verify.dataLoading') }));
  } else if (verify.verification !== null) {
    children.push(
      // 見出し階層を h2 → h3 → h4（パネル内の群構成・グループ見出し）とつなぐ
      el('h3', {
        className: 'verify__doc-title',
        text: verify.verification.study.studyLabel,
      }),
    );
    if (verify.conflictMessage !== null) {
      children.push(
        renderConflictWarning(verify.conflictMessage, () => ctx.verify.onReloadVerification()),
      );
    }
    children.push(
      renderCachedVerificationPanel({
        data: verify.verification,
        onDecision: (decision) => ctx.verify.onDecision(decision),
        onArmConfirm: (arms) => ctx.verify.onArmConfirm(arms),
        onInstanceDeclare: (decisions) => ctx.verify.onInstanceDeclare?.(decisions),
        onRelocateQuote: (evidence) => ctx.verify.onRelocateQuote(evidence),
        focusEntityKey: verify.deepLinkEntityKey,
        layoutMode: verify.layoutMode,
        onLayoutModeChange: (mode) => ctx.verify.onChangeLayoutMode(mode),
      }),
    );
  }
  return el('section', { className: 'view view--verify' }, children);
}
