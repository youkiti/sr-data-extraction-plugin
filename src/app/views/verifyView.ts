// #/verify: 検証（S8・中核画面 / ui-states.md §3。v0.10 フェーズ 3 = study 単位）。
// 状態: 一覧読み込み中 / 一覧読み込み失敗 / 空 / 通常（study セレクタ + 2 ペイン検証パネル）。
// study の切替は URL クエリ ?study= と同期する（セレクタ変更 → hash 書き換え → サービス層が読込）。
// ?entity=（S9 ダッシュボードのセル単位ディープリンク）は該当タブへの切替 + 先頭セルへの
// スクロール・フォーカスとしてパネルへ渡す。2 ペイン本体は #/pilot と同じ verificationPanel を使う
import { el } from '../ui/dom';
import type { AppState, VerifyTarget } from '../store';
import { renderConflictWarning } from './conflictWarning';
import type { ViewContext } from './types';
import { renderCachedVerificationPanel } from './verificationPanel';

function selectorLabel(target: VerifyTarget): string {
  const { progress } = target;
  return `${target.study.studyLabel}（判定済み ${progress.decided} / ${progress.total}）`;
}

function renderSelector(state: AppState, ctx: ViewContext, targets: readonly VerifyTarget[]): HTMLElement {
  const select = el('select', {
    id: 'verify-study',
    attributes: { 'aria-label': '検証する研究' },
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
    el('label', { text: '研究: ', attributes: { for: 'verify-study' } }),
    select,
  ];
  if (state.verify.queuedDecisions > 0) {
    children.push(
      el('span', {
        id: 'verify-queued',
        className: 'verify__queued',
        text: `オフライン: ${state.verify.queuedDecisions} 件キュー中`,
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
    el('h2', { text: '検証' }),
    el('p', {
      className: 'view__lead',
      text: independent
        ? 'PDF を確認しながら、値を入力（edit）/ not_reported で判定します（AI 抽出は行われません）。'
        : 'PDF 上の根拠ハイライトを見ながら、AI 抽出値を accept / edit / reject / not_reported で判定します。',
    }),
  ];
  const verify = state.verify;

  if (verify.loadError !== null) {
    const retry = el('button', {
      id: 'verify-retry',
      text: '再試行',
      attributes: { type: 'button' },
    });
    retry.addEventListener('click', () => ctx.verify.onRetryLoad());
    children.push(
      el('p', {
        id: 'verify-error',
        className: 'verify__error',
        attributes: { role: 'alert' },
        text: `検証対象を読み込めませんでした: ${verify.loadError}`,
      }),
      retry,
    );
    return el('section', { className: 'view view--verify' }, children);
  }

  if (verify.targets === null || verify.loading) {
    children.push(el('p', { id: 'verify-loading', text: '検証対象を読み込んでいます…' }));
    return el('section', { className: 'view view--verify' }, children);
  }

  if (verify.targets.length === 0) {
    // 独立入力モードは「確定済みスキーマが無い」「Studies が 0 件」のいずれでも一覧が空になる
    // （design §5.1）。AI 抽出の有無を前提にした案内は出さない
    children.push(
      el('p', {
        id: 'verify-empty',
        text: independent
          ? 'オーナーが表のデザイン（スキーマ）を確定するまで、独立レビューは開始できません。プロジェクトのオーナーに確認してください。'
          : 'AI 抽出済みの研究がありません。先に #/pilot または #/extract で抽出してください。',
      }),
    );
    return el('section', { className: 'view view--verify' }, children);
  }

  children.push(renderSelector(state, ctx, verify.targets));

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
    children.push(el('p', { id: 'verify-doc-loading', text: '検証データを読み込んでいます…' }));
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
        focusEntityKey: verify.deepLinkEntityKey,
        layoutMode: verify.layoutMode,
        onLayoutModeChange: (mode) => ctx.verify.onChangeLayoutMode(mode),
      }),
    );
  }
  return el('section', { className: 'view view--verify' }, children);
}
