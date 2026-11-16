import { renderOutcomeCandidates, renderOutcomeSchemaNotice } from '../../../../src/app/views/outcomeListNotice';
import type { Evidence } from '../../../../src/domain/evidence';

test('owner のリンクと共同研究者への案内を出し分ける', () => {
  expect(renderOutcomeSchemaNotice('verify', true).getAttribute('href')).toBe('#/schema?outcomes');
  expect(renderOutcomeSchemaNotice('adjudicate', false).id).toBe('adjudicate-outcome-schema-hint');
});

test('候補の引用だけをクリックでき、パイロットには追加の案内を出さない', () => {
  const onQuote = jest.fn();
  const evidence = [{ quote: null }, { quote: '' }, { quote: '引用' }] as Evidence[];
  const candidates = [{ id: 'candidate', name: null, evidence }];
  const section = renderOutcomeCandidates('verify', candidates, onQuote, false);
  expect(section.querySelectorAll('button')).toHaveLength(1);
  section.querySelector('button')!.click();
  expect(onQuote).toHaveBeenCalledWith(evidence[2]);
  expect(section.querySelector('#verify-candidate-outcome-schema-hint')).not.toBeNull();
  expect(renderOutcomeCandidates('verify', candidates, onQuote, true, true).querySelector('a')).toBeNull();
});
