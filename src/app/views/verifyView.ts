// #/verify: 検証（S8・中核画面 / ui-states.md §3）。
// 状態: 一覧読み込み中 / 一覧読み込み失敗 / 空 / 通常（document セレクタ + 2 ペイン検証パネル）。
// 文献の切替は URL クエリ ?doc= と同期する（セレクタ変更 → hash 書き換え → サービス層が読込。
// ?entity= は S9 ダッシュボード実装時に追加 — ui-flow.md §3 の注記参照）。
// 2 ペイン本体は #/pilot と同じ verificationPanel を使う
import { el } from '../ui/dom';
import type { AppState, VerifyTarget } from '../store';
import type { ViewContext } from './types';
import { renderCachedVerificationPanel } from './verificationPanel';

function selectorLabel(target: VerifyTarget): string {
  const { progress } = target;
  return `${target.document.studyLabel}（判定済み ${progress.decided} / ${progress.total}）`;
}

function renderSelector(state: AppState, ctx: ViewContext, targets: readonly VerifyTarget[]): HTMLElement {
  const select = el('select', {
    id: 'verify-doc',
    attributes: { 'aria-label': '検証する文献' },
  });
  for (const target of targets) {
    select.append(
      el('option', {
        text: selectorLabel(target),
        attributes: { value: target.document.documentId },
      }),
    );
  }
  if (state.verify.selectedDocumentId !== null) {
    select.value = state.verify.selectedDocumentId;
  }
  select.addEventListener('change', () => ctx.verify.onSelectDocument(select.value));

  const children: HTMLElement[] = [
    el('label', { text: '文献: ', attributes: { for: 'verify-doc' } }),
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
  const children: HTMLElement[] = [
    el('h2', { text: '検証' }),
    el('p', {
      className: 'view__lead',
      text: 'PDF 上の根拠ハイライトを見ながら、AI 抽出値を accept / edit / reject / not_reported で判定します。',
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
    // ガード（Evidence ≥ 1 行）通過後に消えた場合の防御（別端末での作業直後など）
    children.push(
      el('p', {
        id: 'verify-empty',
        text: 'AI 抽出済みの文献がありません。先に #/pilot または #/extract で抽出してください。',
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
        text: verify.verification.document.studyLabel,
      }),
      renderCachedVerificationPanel({
        data: verify.verification,
        onDecision: (decision) => ctx.verify.onDecision(decision),
        onArmConfirm: (arms) => ctx.verify.onArmConfirm(arms),
      }),
    );
  }
  return el('section', { className: 'view view--verify' }, children);
}
