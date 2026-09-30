// 論文への質問 UI。本文と定義のみを渡し、会話・入力・開閉状態はタブ内に保持する。
import { estimateAskPaperCost, type AnchoredCitation } from '../../features/verification/askPaper';
import { buildAskPaperDocumentPrefix } from '../../features/verification/skills/askPaper';
import { t } from '../../lib/i18n';
import type { AskPaperParams } from '../services/askPaperService';
import type { AskPaperState } from '../store';
import { el } from '../ui/dom';
import type { AskPaperViewCallbacks } from './types';

// フォーカスを外した下書きも再描画で失わない。study 切替では別の入力・開閉状態を使う。
const panels = new Map<string, { input: HTMLTextAreaElement; details: HTMLDetailsElement }>();
// 本文は入力のたびに連結し直さず、文書配列・スキーマ定義の参照が変わったときだけ計算する。
let prefixLengths = new WeakMap<
  AskPaperParams['documents'],
  { fields: AskPaperParams['fields']; length: number }
>();

function documentPrefixLength(params: Pick<AskPaperParams, 'documents' | 'fields'>): number {
  const cached = prefixLengths.get(params.documents);
  if (cached?.fields === params.fields) return cached.length;
  const length = buildAskPaperDocumentPrefix(params).length;
  prefixLengths.set(params.documents, { fields: params.fields, length });
  return length;
}

/** 成功した質問の下書きを消す。再描画前に既存入力も消してフォーカス復元で戻らないようにする。 */
export function clearAskPaperQuestionDraft(spreadsheetId: string, studyId: string): void {
  const panel = panels.get(JSON.stringify([spreadsheetId, studyId]));
  if (panel !== undefined) panel.input.value = '';
}

export function disposeAskPaperPanelCache(): void {
  panels.clear();
  prefixLengths = new WeakMap();
}

export function renderAskPaperPanel(
  state: AskPaperState,
  params: Omit<AskPaperParams, 'history' | 'question'> & { studyId: string },
  callbacks: AskPaperViewCallbacks | undefined,
  onCitation: (citation: AnchoredCitation) => void,
): HTMLElement {
  const key = JSON.stringify([params.spreadsheetId, params.studyId]);
  const previous = panels.get(key);
  const details = el('details', { id: 'ask-paper', className: 'ask-paper' });
  details.open = previous?.details.open ?? false;
  const input = el('textarea', {
    id: 'ask-paper-input',
    attributes: { 'aria-label': t('askPaper.input'), rows: '3' },
  });
  input.value = previous?.input.value ?? '';
  const send = el('button', {
    id: 'ask-paper-send',
    text: t('askPaper.send'),
    attributes: { type: 'button' },
  });
  const estimate = el('p', { id: 'ask-paper-estimate' });
  function refreshEstimate(): void {
    send.disabled = state.sending || input.value.trim() === '';
    if (state.model === null) {
      estimate.textContent = t('askPaper.estimatePending');
      return;
    }
    const result = estimateAskPaperCost({
      model: state.model,
      prefixChars: documentPrefixLength(params),
      historyChars: (state.conversations[params.studyId] ?? [])
        .slice(-5)
        .reduce((total, turn) => total + turn.question.length + turn.answer.length, 0),
      questionChars: input.value.length,
    });
    estimate.textContent = t('askPaper.estimate', {
      tokens: result.tokensIn,
      cost:
        result.costUsd === null
          ? t('askPaper.costUnknown')
          : t('askPaper.cost', { cost: result.costUsd.toFixed(4) }),
    });
  }
  refreshEstimate();
  input.addEventListener('input', refreshEstimate);
  const submit = (): void => {
    if (send.disabled) return;
    callbacks?.onSend({
      studyId: params.studyId,
      documents: params.documents,
      fields: params.fields,
      question: input.value.trim(),
    });
  };
  send.addEventListener('click', submit);
  input.addEventListener('keydown', (event) => {
    if (event.isComposing || event.keyCode === 229) return;
    if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) {
      event.preventDefault();
      submit();
    }
  });
  const log = el('div', { id: 'ask-paper-log' });
  for (const turn of state.conversations[params.studyId] ?? []) {
    const answer = el('div', { className: 'ask-paper__answer' });
    if (turn.found && turn.anchoredCount === 0)
      answer.append(el('p', { className: 'ask-paper__warning', text: t('askPaper.warning') }));
    answer.append(el('p', { text: turn.found ? turn.answer : t('askPaper.notFound') }));
    for (const citation of turn.citations) {
      const text = t('askPaper.citation', {
        page: citation.anchoredPage ?? citation.page ?? '?',
        quote: citation.quote,
      });
      if (citation.highlightable) {
        const button = el('button', {
          className: 'ask-paper__citation',
          text,
          attributes: { type: 'button' },
        });
        button.addEventListener('click', () => onCitation(citation));
        answer.append(button);
      } else {
        answer.append(
          el('span', {
            className: 'ask-paper__citation--unanchored',
            text: `${text} — ${t('askPaper.unanchored')}`,
          }),
        );
      }
    }
    log.append(
      el('div', { className: 'ask-paper__turn' }, [
        el('p', { className: 'ask-paper__question', text: turn.question }),
        answer,
      ]),
    );
  }
  details.append(
    el('summary', { className: 'ask-paper__summary', text: t('askPaper.title') }),
    el('p', { className: 'ask-paper__notice', text: t('askPaper.notice') }),
    input,
    estimate,
    send,
    log,
  );
  if (state.sending)
    details.append(
      el('p', {
        id: 'ask-paper-progress',
        text: t('askPaper.progress'),
        attributes: { role: 'status' },
      }),
    );
  if (state.error !== null)
    details.append(
      el('p', { id: 'ask-paper-error', text: state.error, attributes: { role: 'alert' } }),
    );
  panels.set(key, { input, details });
  return details;
}
