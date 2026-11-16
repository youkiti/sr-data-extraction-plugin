import type { Evidence } from '../../domain/evidence';
import type { OutcomeListCandidate } from '../../features/schema/outcomeListContext';
import { t } from '../../lib/i18n';
import { el } from '../ui/dom';

/** 一覧を直す導線、または owner への相談の案内を作る。 */
export function renderOutcomeSchemaNotice(prefix: string, canEditSchema: boolean): HTMLElement {
  return canEditSchema
    ? el('a', { id: `${prefix}-outcome-schema-link`, text: t('verify.outcomeSchemaLink'), attributes: { href: '#/schema?outcomes' } })
    : el('p', { id: `${prefix}-outcome-schema-hint`, text: t('verify.outcomeSchemaHint') });
}

/** 一覧外の候補をセル欄外へ出し、引用の選択を既存の PDF 表示へ渡す。 */
export function renderOutcomeCandidates(
  prefix: string,
  candidates: readonly OutcomeListCandidate[],
  onQuote: (evidence: Evidence) => void,
  canEditSchema: boolean,
  pilot = false,
): HTMLElement {
  const section = el('section', { id: `${prefix}-outcome-candidates`, className: 'outcome-candidates' }, [
    el('h4', { text: t('verify.outcomeCandidates') }),
    el('p', { text: t('verify.outcomeCandidatesLead') }),
  ]);
  for (const candidate of candidates) {
    const row = el('div', { className: 'outcome-candidates__row' }, [
      el('strong', { text: candidate.id }),
      el('span', { text: candidate.name ?? '' }),
    ]);
    for (const evidence of candidate.evidence) {
      if (evidence.quote === null || evidence.quote === '') {
        continue;
      }
      const quote = el('button', { text: evidence.quote, attributes: { type: 'button' } });
      quote.addEventListener('click', () => onQuote(evidence));
      row.append(quote);
    }
    section.append(row);
  }
  if (!pilot) {
    const notice = renderOutcomeSchemaNotice(`${prefix}-candidate`, canEditSchema);
    section.append(notice);
  }
  return section;
}
