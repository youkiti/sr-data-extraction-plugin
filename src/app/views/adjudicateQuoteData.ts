// 裁定セルの引用解決に必要な根拠と群対応を組み立てる。
import { resolveAdjudicateQuotes } from '../../features/adjudication/cellQuotes';
import type { AdjudicationCell } from '../../features/adjudication/cellMatch';
import type { AdjudicateWorking } from '../store';

/** 現在の群対応とセルごとの判定者型を引用解決へ渡す。 */
export function quotesForCell(working: AdjudicateWorking, cell: AdjudicationCell) {
  return resolveAdjudicateQuotes({ ...working, evidence: working.quoteAiEvidence,
    ...working.quoteTypesForCell?.(cell.field.fieldId, cell.entityKey, working.quoteArmRemap()),
    studyId: working.study.studyId, fieldId: cell.field.fieldId, entityKey: cell.entityKey,
    armKeyRemap: working.quoteArmRemap() });
}
