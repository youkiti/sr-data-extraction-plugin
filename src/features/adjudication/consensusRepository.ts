// consensus セルの書き込みをまとめて Sheets へ反映する（docs/design-independent-dual-review.md §6.5）。
// StudyData（既存 consensus 行へのマージ upsert）/ ResultsData（セル単位 upsert）→ Decisions の
// batch 追記の順で行う。同一呼び出しの再実行は upsert が同じ更新キーへ収束し、Decisions の
// 重複追記も cellState の畳み込み（decided_at 昇順で最新が勝つ）で吸収されるため、
// 途中失敗後の再実行は安全（冪等）
import { NOT_REPORTED_TOKEN } from '../../domain/annotation';
import type { Decision } from '../../domain/decision';
import {
  readStudyDataSheet,
  upsertResultsDataRows,
  upsertStudyDataRows,
} from '../extraction/annotationRepository';
import type { GoogleApiDeps } from '../../lib/google/types';
import { appendDecisionRows } from '../verification/decisionRepository';
import { toConsensusDecision, type ConsensusCellWrite, type ConsensusWriteParams } from './consensusWrites';

/**
 * consensus セルの書き込み一式を適用する。空配列は no-op。
 * study レベルの書き込みは既存の consensus StudyData 行（あれば）へマージしてから 1 回で upsert する
 * （StudyData の upsert は values を丸ごと置き換えるため、既存の他フィールド値を保持する必要がある）
 */
export async function applyConsensusWrites(
  spreadsheetId: string,
  writes: readonly ConsensusCellWrite[],
  params: ConsensusWriteParams,
  deps: GoogleApiDeps,
): Promise<void> {
  if (writes.length === 0) {
    return;
  }
  const studyWrites = writes.filter((write) => write.field.entityLevel === 'study');
  if (studyWrites.length > 0) {
    const sheet = await readStudyDataSheet(spreadsheetId, deps);
    const existing = sheet.rows.find(
      (row) => row.studyId === params.studyId && row.annotator === 'consensus',
    );
    const values: Record<string, string | null> = { ...(existing?.values ?? {}) };
    for (const write of studyWrites) {
      values[write.field.fieldName] = write.value;
    }
    await upsertStudyDataRows(
      spreadsheetId,
      [
        {
          studyId: params.studyId,
          annotator: 'consensus',
          annotatorType: 'consensus',
          schemaVersion: params.schemaVersion,
          runId: null,
          updatedAt: params.decidedAt,
          values,
        },
      ],
      deps,
    );
  }

  const resultWrites = writes.filter((write) => write.field.entityLevel !== 'study');
  if (resultWrites.length > 0) {
    await upsertResultsDataRows(
      spreadsheetId,
      resultWrites.map((write) => {
        const notReported = write.value === NOT_REPORTED_TOKEN;
        return {
          studyId: params.studyId,
          fieldId: write.field.fieldId,
          annotator: 'consensus',
          annotatorType: 'consensus',
          schemaVersion: params.schemaVersion,
          entityKey: write.entityKey,
          runId: null,
          value: notReported ? null : write.value,
          notReported,
          updatedAt: params.decidedAt,
        };
      }),
      deps,
    );
  }

  const decisions: Decision[] = writes.map((write) => toConsensusDecision(write, params));
  await appendDecisionRows(spreadsheetId, decisions, deps);
}
