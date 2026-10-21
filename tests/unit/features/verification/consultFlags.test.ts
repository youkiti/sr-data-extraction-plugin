import type { Decision } from '../../../../src/domain/decision';
import { activeConsultFlags, consultFlagKey } from '../../../../src/features/verification/consultFlags';
import { cellKeyOf, deriveCellStates } from '../../../../src/features/verification/cellState';

const decision = (overrides: Partial<Decision> = {}): Decision => ({
  studyId: 's', fieldId: 'f', entityKey: '-', annotator: 'me', annotatorType: 'human_with_ai',
  schemaVersion: 1, decidedBy: 'me', decidedAt: 't1', action: 'accept', value: '12', note: null,
  ...overrides,
});

test('印の時刻順・同時刻の行順と、セル・study・判定者の分離', () => {
  const flag = decision({ action: 'flag_consult' });
  const other = decision({ action: 'flag_consult', annotator: 'other' });
  const later = decision({ action: 'unflag_consult', decidedAt: 't2' });
  expect(activeConsultFlags([later, flag, other])).toEqual(new Map([[consultFlagKey(other), other]]));
  expect(activeConsultFlags([flag, decision({ action: 'unflag_consult' })]).size).toBe(0);
  expect(activeConsultFlags([decision({ action: 'unflag_consult' }), flag])).toEqual(new Map([[consultFlagKey(flag), flag]]));
  const cells = [flag, decision({ ...flag, studyId: 's2' }), decision({ ...flag, fieldId: 'f2' }),
    decision({ ...flag, entityKey: 'arm:1' }), decision({ ...flag, annotatorType: 'consensus' })];
  expect(activeConsultFlags(cells).size).toBe(5);
  expect(activeConsultFlags([]).size).toBe(0);
});

test('値の変更・undo と印は独立し、印だけでは検証済みにならない', () => {
  const flag = decision({ action: 'flag_consult', decidedAt: 't2', note: '相談' });
  const rows = [decision(), flag, decision({ action: 'edit', decidedAt: 't3', value: '15' }),
    decision({ action: 'unflag_consult', decidedAt: 't4' }), decision({ action: 'undo', decidedAt: 't5' })];
  expect(deriveCellStates(rows).get(cellKeyOf('f', '-'))).toMatchObject({ status: 'accept', value: '12' });
  expect(deriveCellStates([flag]).size).toBe(0);
  expect(activeConsultFlags([decision(), flag, decision({ action: 'undo', decidedAt: 't3' })]).size).toBe(1);
});
