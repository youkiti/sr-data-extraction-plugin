// パイロット判定を項目別の改訂材料へまとめる純粋関数（issue #266）。
// study ごとに undo を畳み込み、対象 annotator・版の最終判定だけを使う。
// 非承認判定を材料とし、承認は件数だけ残す。予約項目は対象外。
import type { Decision } from '../../domain/decision';
import type { Evidence } from '../../domain/evidence';
import type { SchemaField } from '../../domain/schemaField';
import { deriveCellStates } from '../verification/cellState';
import { ENTITY_INSTANCE_DECLARATION_FIELD_ID } from '../verification/instanceDeclarations';

export interface PilotFeedbackField {
  fieldId: string;
  fieldName: string;
  acceptCount: number;
  entries: Array<{
    studyId: string;
    entityKey: string;
    action: 'edit' | 'reject' | 'not_reported' | 'accept';
    aiValue: string | null;
    humanValue: string | null;
    quote: string | null;
    note: string | null;
  }>;
}

export interface PilotFeedback {
  items: PilotFeedbackField[];
  decisionCount: number;
}

export interface PilotFeedbackInput {
  runStudyIds: readonly string[];
  schemaVersion: number;
  fields: readonly SchemaField[];
  evidence: readonly Evidence[];
  decisions: readonly Decision[];
  annotator: string;
}

/** study ごとに undo を畳み込み、現在の非承認判定だけを改訂の材料にする。 */
export function buildPilotFeedback(input: PilotFeedbackInput): PilotFeedback {
  const byField = new Map(
    input.fields
      .filter((field) => field.fieldId !== ENTITY_INSTANCE_DECLARATION_FIELD_ID)
      .map((field): [string, PilotFeedbackField] => [
        field.fieldId,
        {
          fieldId: field.fieldId,
          fieldName: field.fieldName,
          entries: [],
          acceptCount: 0,
        },
      ]),
  );
  const evidenceByCell = new Map(
    input.evidence.map((row) => [JSON.stringify([row.studyId, row.entityKey, row.fieldId]), row]),
  );
  for (const studyId of new Set(input.runStudyIds)) {
    const states = deriveCellStates(
      input.decisions.filter(
        (decision) =>
          decision.studyId === studyId &&
          decision.schemaVersion === input.schemaVersion &&
          decision.annotatorType === 'human_with_ai' &&
          decision.annotator === input.annotator,
      ),
    );
    for (const state of states.values()) {
      const decision = state.stack[state.stack.length - 1];
      if (decision === undefined) continue;
      const field = byField.get(decision.fieldId);
      if (field === undefined) continue;
      if (state.status === 'accept') {
        field.acceptCount += 1;
        continue;
      }
      const evidence = evidenceByCell.get(
        JSON.stringify([studyId, decision.entityKey, decision.fieldId]),
      );
      field.entries.push({
        studyId,
        entityKey: decision.entityKey,
        action: state.status as 'edit' | 'reject' | 'not_reported',
        aiValue: evidence?.value ?? null,
        humanValue: state.value,
        quote: evidence?.quote ?? null,
        note: decision.note,
      });
    }
  }
  const items = [...byField.values()].filter((field) => field.entries.length > 0);
  return { items, decisionCount: items.reduce((count, field) => count + field.entries.length, 0) };
}
