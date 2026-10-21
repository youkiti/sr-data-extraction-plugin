// 要相談の印は値の判定・undo と独立した追記イベントとして畳み込む。
import { isConsultAction, type Decision } from '../../domain/decision';

export function consultFlagKey(cell: Pick<Decision, 'studyId' | 'fieldId' | 'entityKey' | 'annotator' | 'annotatorType'>): string {
  return JSON.stringify([cell.studyId, cell.fieldId, cell.entityKey, cell.annotator, cell.annotatorType]);
}

/** 同時刻は元の行順を保つ。解除は対応する印だけを消す。 */
export function activeConsultFlags(decisions: readonly Decision[]): Map<string, Decision> {
  const flags = new Map<string, Decision>();
  for (const decision of [...decisions].sort((a, b) => a.decidedAt.localeCompare(b.decidedAt))) {
    if (!isConsultAction(decision.action)) continue;
    const key = consultFlagKey(decision);
    if (decision.action === 'flag_consult') flags.set(key, decision);
    else flags.delete(key);
  }
  return flags;
}
