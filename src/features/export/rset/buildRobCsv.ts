// rob.csv（issue #60 design-r-export.md §2）: 1 行 = study × RoB ドメイン。robvis 互換出力の派生元。
// RoB ドメインは AI ドラフト非対応（テンプレート挿入が唯一の入口）のため、インスタンス列挙は
// Evidence / Decisions からのデータ駆動ではなく、テンプレート定義（ROB2_DOMAINS / ROBINS_I_DOMAINS）
// からの直接列挙にする。これにより AI が抽出できていないドメインも no_data 行として必ず出現する
import type { ResultsDataRow } from '../../../domain/annotation';
import type { Evidence } from '../../../domain/evidence';
import type { SchemaField } from '../../../domain/schemaField';
import type { StudyRecord } from '../../../domain/study';
import { makeRobDomainEntityKey } from '../../../utils/entityKey';
import { distinctAnnotators } from './annotatorPool';
import { buildCsv } from '../csvEncode';
import { selectFinalAnnotator } from '../finalAnnotator';
import type { RSetIssue } from './issues';
import { activeRobToolFieldSets } from './robFields';
import { resolveRSetStatus, resolveRSetValue, resultsRowRawValue } from './rsetStatus';

export const ROB_HEADER = [
  'study_id',
  'study_label',
  'tool',
  'domain_id',
  'domain_label',
  'sq_id',
  'outcome_id',
  'entity_key',
  'judgement',
  'support',
  'verification_status',
  'schema_version',
] as const;

export interface RobBuildResult {
  csv: string;
  rowCount: number;
  issues: RSetIssue[];
}

/** 複合キーの区切り。NUL は entity_key・field_id 等の値に現れない（buildAuditCsv.ts と同じ規約） */
const SEP = String.fromCharCode(0);

function cellKey(entityKey: string, fieldId: string): string {
  return `${entityKey}${SEP}${fieldId}`;
}

export function buildRobCsv(
  studies: readonly StudyRecord[],
  resultsRows: readonly ResultsDataRow[],
  evidences: readonly Evidence[],
  fields: readonly SchemaField[],
): RobBuildResult {
  const toolSets = activeRobToolFieldSets(fields);
  const rows: string[][] = [];
  const issues: RSetIssue[] = [];

  if (toolSets.length === 0) {
    return { csv: buildCsv(ROB_HEADER, rows), rowCount: 0, issues };
  }

  for (const study of studies) {
    const studyResultsRows = resultsRows.filter((row) => row.studyId === study.studyId);
    if (studyResultsRows.length === 0) {
      continue; // rob 行がない study は正常（results_long と同じ扱い）
    }
    const final = selectFinalAnnotator(distinctAnnotators(studyResultsRows));
    if (final === null) {
      issues.push({
        issueType: 'skipped_study_no_final_annotator',
        studyId: study.studyId,
        fieldId: '',
        entityKey: '',
        detail: 'rob.csv: ResultsData の確定 annotator を一意に特定できません（human 行複数 or consensus 重複）',
      });
      continue;
    }

    const studyEvidence = evidences.filter((evidence) => evidence.studyId === study.studyId);
    const index = new Map<string, ResultsDataRow>();
    for (const row of studyResultsRows) {
      if (row.annotator === final.annotator && row.annotatorType === final.annotatorType) {
        index.set(cellKey(row.entityKey, row.fieldId), row);
      }
    }
    const evidenceKeys = new Set(studyEvidence.map((evidence) => cellKey(evidence.entityKey, evidence.fieldId)));

    for (const toolSet of toolSets) {
      const judgementField = fields.find(
        (field) => field.entityLevel === 'rob_domain' && field.fieldName === toolSet.judgementFieldName,
      );
      /* istanbul ignore if -- toolSets は activeRobToolFieldSets が judgement 項目の存在で
         絞り込んだ後の集合のため実行時に到達しない防御 */
      if (judgementField === undefined) {
        continue;
      }
      const supportField = fields.find(
        (field) => field.entityLevel === 'rob_domain' && field.fieldName === toolSet.supportFieldName,
      );

      for (const domain of toolSet.domains) {
        const entityKey = makeRobDomainEntityKey(domain.id);

        const judgementRow = index.get(cellKey(entityKey, judgementField.fieldId));
        const judgementRaw = resultsRowRawValue(judgementRow);
        const judgementHasEvidence = evidenceKeys.has(cellKey(entityKey, judgementField.fieldId));
        const status = resolveRSetStatus(judgementRaw, judgementHasEvidence);
        const judgementValue = resolveRSetValue(judgementRaw, status);

        let supportValue = '';
        if (supportField !== undefined) {
          const supportRow = index.get(cellKey(entityKey, supportField.fieldId));
          const supportRaw = resultsRowRawValue(supportRow);
          const supportHasEvidence = evidenceKeys.has(cellKey(entityKey, supportField.fieldId));
          const supportStatus = resolveRSetStatus(supportRaw, supportHasEvidence);
          supportValue = resolveRSetValue(supportRaw, supportStatus);
        }

        const schemaVersion = judgementRow?.schemaVersion ?? null;

        rows.push([
          study.studyId,
          study.studyLabel,
          toolSet.tool,
          domain.id,
          domain.label,
          '', // sq_id（signaling question。#61 実装後）
          '', // outcome_id（result-level RoB。v1 は常に空）
          entityKey,
          judgementValue,
          supportValue,
          status,
          schemaVersion === null ? '' : String(schemaVersion),
        ]);

        if (status === 'unverified') {
          issues.push({
            issueType: 'unverified_cell',
            studyId: study.studyId,
            fieldId: judgementField.fieldId,
            entityKey,
            detail: `rob.csv: ${toolSet.judgementFieldName} は AI 抽出のみで人間の判定が 0 件です`,
          });
        }
      }
    }
  }

  return { csv: buildCsv(ROB_HEADER, rows), rowCount: rows.length, issues };
}
