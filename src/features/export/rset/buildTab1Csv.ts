// tab1.csv / tab1_status.csv（issue #60 design-r-export.md §2）: 1 行 = 1 study。
// StudyData の確定 annotator 行を、study レベル全項目を field_name で横持ちして出力する
// （既存 buildStudyWideCsv.ts と同じ展開ロジック + join キー列を前置）。
// tab1_status.csv は同じ列構成のミラー表で、キー列はそのまま複製し、値列だけをステータス語彙へ置き換える
import { STUDY_ENTITY_KEY } from '../../../utils/entityKey';
import type { StudyDataRow } from '../../../domain/annotation';
import type { Evidence } from '../../../domain/evidence';
import type { StudyRecord } from '../../../domain/study';
import type { SchemaField } from '../../../domain/schemaField';
import { buildCsv } from '../csvEncode';
import { selectFinalAnnotator } from '../finalAnnotator';
import type { RSetIssue } from './issues';
import { resolveRSetStatus, resolveRSetValue } from './rsetStatus';

/** キー列（値表・ステータス表で共通） */
const TAB1_KEY_HEADER = ['study_id', 'study_label', 'registration_id', 'n_documents', 'schema_version'] as const;

export interface Tab1BuildResult {
  csv: string;
  statusCsv: string;
  header: string[];
  /** ヘッダを除く行数（value / status 共通） */
  rowCount: number;
  issues: RSetIssue[];
}

export function buildTab1Csv(
  studies: readonly StudyRecord[],
  studyRows: readonly StudyDataRow[],
  evidences: readonly Evidence[],
  documentStudyIds: readonly string[],
  fields: readonly SchemaField[],
): Tab1BuildResult {
  const studyFields = fields
    .filter((field) => field.entityLevel === 'study')
    .sort((a, b) => a.fieldIndex - b.fieldIndex);
  const header = [...TAB1_KEY_HEADER, ...studyFields.map((field) => field.fieldName)];

  const documentCountByStudy = new Map<string, number>();
  for (const studyId of documentStudyIds) {
    documentCountByStudy.set(studyId, (documentCountByStudy.get(studyId) ?? 0) + 1);
  }

  const valueRows: string[][] = [];
  const statusRows: string[][] = [];
  const issues: RSetIssue[] = [];

  for (const study of studies) {
    const rowsForStudy = studyRows.filter((row) => row.studyId === study.studyId);
    const final = selectFinalAnnotator(rowsForStudy);
    if (final === null) {
      if (rowsForStudy.length > 0) {
        issues.push({
          issueType: 'skipped_study_no_final_annotator',
          studyId: study.studyId,
          fieldId: '',
          entityKey: STUDY_ENTITY_KEY,
          detail: 'tab1.csv: StudyData の確定 annotator を一意に特定できません（human 行複数 or consensus 重複）',
        });
      }
      // 0 行（AI 抽出のみ・未検証）は「まだ検証されていない」正常状態のため issue は積まない
      continue;
    }

    const evidenceFieldIds = new Set(
      evidences
        .filter((evidence) => evidence.studyId === study.studyId && evidence.entityKey === STUDY_ENTITY_KEY)
        .map((evidence) => evidence.fieldId),
    );

    const keyValues = [
      study.studyId,
      study.studyLabel,
      study.registrationId ?? '',
      String(documentCountByStudy.get(study.studyId) ?? 0),
      String(final.schemaVersion),
    ];
    const valueLine = [...keyValues];
    const statusLine = [...keyValues];

    for (const field of studyFields) {
      const raw = final.values[field.fieldName] ?? null;
      const status = resolveRSetStatus(raw, evidenceFieldIds.has(field.fieldId));
      valueLine.push(resolveRSetValue(raw, status));
      statusLine.push(status);
      if (status === 'unverified') {
        issues.push({
          issueType: 'unverified_cell',
          studyId: study.studyId,
          fieldId: field.fieldId,
          entityKey: STUDY_ENTITY_KEY,
          detail: `tab1.csv: ${field.fieldName} は AI 抽出のみで人間の判定が 0 件です`,
        });
      }
    }
    valueRows.push(valueLine);
    statusRows.push(statusLine);
  }

  return {
    csv: buildCsv(header, valueRows),
    statusCsv: buildCsv(header, statusRows),
    header,
    rowCount: valueRows.length,
    issues,
  };
}
