// Evidence タブ I/O（requirements.md §3.1: 追記のみ・上書き禁止）。
// executeRun の appendEvidence 依存として注入され、バッチ単位でまとめて追記する
import type { Evidence } from '../../domain/evidence';
import { appendRows } from '../../lib/google/sheets';
import type { GoogleApiDeps } from '../../lib/google/types';

const EVIDENCE_TAB = 'Evidence';

/** Evidence → シート行。列順は SHEET_HEADERS.Evidence（domain/sheetsSchema.ts）に対応 */
export function evidenceToRow(evidence: Evidence): (string | number | boolean | null)[] {
  return [
    evidence.evidenceId,
    evidence.runId,
    evidence.documentId,
    evidence.fieldId,
    evidence.entityKey,
    evidence.value,
    evidence.notReported,
    evidence.quote,
    evidence.page,
    evidence.confidence,
    evidence.anchorStatus,
  ];
}

/**
 * Evidence をまとめて追記する（1 バッチ = 1 API 呼び出し）。空配列は no-op。
 * 追記のみで更新 API は提供しない（追記型タブ。変更が必要な場合は新しい run を作る）
 */
export async function appendEvidenceRows(
  spreadsheetId: string,
  evidence: readonly Evidence[],
  deps: GoogleApiDeps,
): Promise<void> {
  await appendRows(spreadsheetId, EVIDENCE_TAB, evidence.map(evidenceToRow), deps);
}
