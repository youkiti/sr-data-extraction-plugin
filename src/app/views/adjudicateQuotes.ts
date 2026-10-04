import { quotesForCell } from './adjudicateQuoteData';
// 裁定セルの引用一覧。採用と削除は値の裁定コールバックから独立させる。
import type { CellQuote } from '../../domain/quoteSet';
import { sameAdjudicateQuote, quoteCitation } from '../../features/adjudication/cellQuotes';
import type { AdjudicationCell } from '../../features/adjudication/cellMatch';
import { t } from '../../lib/i18n';
import type { AdjudicateWorking } from '../store';
import { el } from '../ui/dom';
import { getAdjudicateQuoteTarget, setAdjudicateQuoteTarget, showAdjudicateCitation } from './adjudicatePdfPane';
import type { AdjudicateViewCallbacks } from './types';

function quoteContent(quote: CellQuote): HTMLElement[] {
  const nodes: HTMLElement[] = [];
  if (quote.source === 'human') nodes.push(el('span', { text: t('verify.quoteSourceHuman') }));
  if (quote.theme !== null) nodes.push(el('span', { text: quote.theme }));
  nodes.push(el('blockquote', { text: quote.quote }));
  if (quote.page !== null) nodes.push(el('span', { text: String(quote.page) }));
  if (quote.section !== null) nodes.push(el('span', { text: quote.section }));
  return nodes;
}

export function renderAdjudicateQuotes(cell: AdjudicationCell, working: AdjudicateWorking,
  locked: boolean, callbacks: AdjudicateViewCallbacks): HTMLElement | null {
  const resolved = quotesForCell(working, cell);
  if (resolved.candidates.length === 0 && !resolved.consensus.edited) return null;
  const disabled = locked || working.quoteSaving.includes(cell.cellKey);
  const remove = (quote: CellQuote): void => callbacks.onConsensusQuotesChange(cell.cellKey,
    resolved.consensus.quotes.filter((chosen) => !sameAdjudicateQuote(chosen, quote)));
  const candidates = resolved.candidates.map((candidate) => {
    const { quote } = candidate;
    const checkbox = el('input', { className: 'adjudicate__quote-adopt',
      attributes: { type: 'checkbox', 'aria-label': t('adjudicate.quoteAdoptAria') } });
    checkbox.checked = candidate.adopted;
    checkbox.disabled = disabled;
    checkbox.addEventListener('change', () => {
      if (checkbox.checked) callbacks.onConsensusQuotesChange(cell.cellKey, [
        ...resolved.consensus.quotes, { ...quote, entityKey: cell.entityKey, originAnnotator: candidate.originAnnotator },
      ]);
      else remove(quote);
    });
    const nodes: HTMLElement[] = [
      el('span', { className: 'adjudicate__quote-owner',
        text: candidate.owner === 'both' ? t('adjudicate.quoteOwnerBoth') : candidate.owner }),
      ...quoteContent(quote), checkbox,
    ];
    if (quote.anchorStatus !== null && quote.anchorStatus !== 'failed') {
      const jump = el('button', { className: 'adjudicate__quote-jump', text: t('adjudicate.quoteJump'),
        attributes: { type: 'button' } });
      jump.addEventListener('click', () => showAdjudicateCitation(working, quoteCitation(quote)));
      nodes.push(jump);
    }
    return el('li', { className: 'adjudicate__quote' }, nodes);
  });
  const children: HTMLElement[] = [
    el('h5', { text: t('adjudicate.quotesHeading') }),
    el('p', { className: 'adjudicate__quotes-status', text: resolved.consensus.edited
      ? t('adjudicate.quotesChosen', { n: resolved.consensus.quotes.length }) : t('adjudicate.quotesNotChosen') }),
    el('ul', {}, candidates),
  ];
  if (resolved.added.length > 0) children.push(
    el('h5', { text: t('adjudicate.quotesAddedByAdjudicator') }),
    el('ul', {}, resolved.added.map((quote) => {
      const button = el('button', { className: 'adjudicate__quote-remove', text: t('verify.quoteRemove'),
        attributes: { type: 'button' } });
      button.disabled = disabled;
      button.addEventListener('click', () => remove(quote));
      return el('li', { className: 'adjudicate__quote' }, [...quoteContent(quote), button]);
    })),
  );
  const target = el('button', { className: 'adjudicate__quote-add-target', text: t('adjudicate.quoteAddTarget'),
    attributes: { type: 'button', 'aria-label': t('adjudicate.quoteAddTargetAria'),
      'aria-pressed': String(getAdjudicateQuoteTarget(working) === cell.cellKey) } });
  target.disabled = disabled;
  target.addEventListener('click', () => {
    const next = getAdjudicateQuoteTarget(working) === cell.cellKey ? null : cell.cellKey;
    setAdjudicateQuoteTarget(working, next);
    target.closest('table')!.querySelectorAll('.adjudicate__quote-add-target')
      .forEach((button) => button.setAttribute('aria-pressed', String(button === target && next !== null)));
  });
  children.push(target);
  if (working.quoteErrors.includes(cell.cellKey)) children.push(el('p', {
    className: 'adjudicate__quote-error', text: t('verify.quoteSaveError'), attributes: { role: 'alert' },
  }));
  return el('div', { className: 'adjudicate__quotes' }, children);
}
