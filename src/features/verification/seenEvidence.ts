import { NOT_REPORTED_TOKEN } from '../../domain/annotation';
import type { Decision } from '../../domain/decision';
import type { VerificationCell } from './cells';

/** 表示順の根拠 ID と AI の値を判定時点で保存する。 */
export function seenEvidenceOf(
  cell: Pick<VerificationCell, 'evidence' | 'quotes'>,
): Pick<Decision, 'seenEvidenceIds' | 'seenAiValue'> {
  const rows = cell.evidence === null ? cell.quotes : [cell.evidence, ...cell.quotes];
  return {
    seenEvidenceIds: [...new Set(rows.map((row) => row.evidenceId))],
    seenAiValue: cell.evidence?.notReported ? NOT_REPORTED_TOKEN : cell.evidence?.value ?? '',
  };
}
