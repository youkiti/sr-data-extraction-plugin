// export_issues.csv の行型と、黙示的除外を防ぐための横断チェック（issue #60 要望 6）。
// 「確定 annotator を特定できない study」「未知 field_id」「重複キー」は各 builder が
// 個別に検出するとファイルをまたいで二重計上されるため、study_wide の元データである
// StudyData / ResultsData 全体を対象にオーケストレータ（buildRSet.ts）から一度だけ呼び出す。
// 「判定 0 件セル」は各表（tab1 / ma / rob）が自分の列構成に応じて個別に積む
import type { ResultsDataRow, StudyDataRow } from '../../../domain/annotation';
import type { SchemaField } from '../../../domain/schemaField';

export type RSetIssueType =
  | 'skipped_study_no_final_annotator'
  | 'dropped_unknown_field'
  | 'duplicate_key'
  | 'unverified_cell';

export interface RSetIssue {
  issueType: RSetIssueType;
  studyId: string;
  fieldId: string;
  entityKey: string;
  detail: string;
}

export const EXPORT_ISSUES_HEADER = ['issue_type', 'study_id', 'field_id', 'entity_key', 'detail'] as const;

/** 複合キーの区切り。NUL は annotator（email）・entity_key 等の値に現れない（buildAuditCsv.ts と同じ規約） */
const SEP = String.fromCharCode(0);

/** StudyData の重複キー（study_id × annotator × annotator_type）を検出する（requirements.md §3.2 違反） */
export function collectStudyDataDuplicateKeyIssues(rows: readonly StudyDataRow[]): RSetIssue[] {
  const counts = new Map<string, { row: StudyDataRow; count: number }>();
  for (const row of rows) {
    const key = `${row.studyId}${SEP}${row.annotator}${SEP}${row.annotatorType}`;
    const existing = counts.get(key);
    if (existing === undefined) {
      counts.set(key, { row, count: 1 });
    } else {
      existing.count++;
    }
  }
  const issues: RSetIssue[] = [];
  for (const { row, count } of counts.values()) {
    if (count > 1) {
      issues.push({
        issueType: 'duplicate_key',
        studyId: row.studyId,
        fieldId: '',
        entityKey: '',
        detail: `StudyData に annotator=${row.annotator}（${row.annotatorType}）の行が ${count} 件重複しています`,
      });
    }
  }
  return issues;
}

/** ResultsData の重複キー（study_id × annotator × annotator_type × entity_key × field_id）を検出する */
export function collectResultsDataDuplicateKeyIssues(rows: readonly ResultsDataRow[]): RSetIssue[] {
  const counts = new Map<string, { row: ResultsDataRow; count: number }>();
  for (const row of rows) {
    const key = `${row.studyId}${SEP}${row.annotator}${SEP}${row.annotatorType}${SEP}${row.entityKey}${SEP}${row.fieldId}`;
    const existing = counts.get(key);
    if (existing === undefined) {
      counts.set(key, { row, count: 1 });
    } else {
      existing.count++;
    }
  }
  const issues: RSetIssue[] = [];
  for (const { row, count } of counts.values()) {
    if (count > 1) {
      issues.push({
        issueType: 'duplicate_key',
        studyId: row.studyId,
        fieldId: row.fieldId,
        entityKey: row.entityKey,
        detail: `ResultsData に annotator=${row.annotator}（${row.annotatorType}）の行が ${count} 件重複しています`,
      });
    }
  }
  return issues;
}

/**
 * StudyData の値列キー（field_name）が現行スキーマの study レベル項目に見つからないものを検出する。
 * 旧スキーマ版で書かれた列が改名 / 削除された場合に該当（tab1.csv からは黙って落ちるため明示する）
 */
export function collectStudyDataDroppedFieldIssues(
  rows: readonly StudyDataRow[],
  fields: readonly SchemaField[],
): RSetIssue[] {
  const knownNames = new Set(fields.filter((f) => f.entityLevel === 'study').map((f) => f.fieldName));
  const seen = new Set<string>();
  const issues: RSetIssue[] = [];
  for (const row of rows) {
    for (const name of Object.keys(row.values)) {
      if (knownNames.has(name)) {
        continue;
      }
      const key = `${row.studyId}${SEP}${name}`;
      if (seen.has(key)) {
        continue;
      }
      seen.add(key);
      issues.push({
        issueType: 'dropped_unknown_field',
        studyId: row.studyId,
        fieldId: '',
        entityKey: '-',
        detail: `StudyData の値列 "${name}" が現行スキーマの study レベル項目に見つかりません（tab1.csv には出力されません）`,
      });
    }
  }
  return issues;
}

/** ResultsData の field_id が現行 SchemaFields に見つからないものを検出する（ma.csv / rob.csv から黙って落ちる分） */
export function collectResultsDataDroppedFieldIssues(
  rows: readonly ResultsDataRow[],
  fields: readonly SchemaField[],
): RSetIssue[] {
  const knownFieldIds = new Set(fields.map((f) => f.fieldId));
  const seen = new Set<string>();
  const issues: RSetIssue[] = [];
  for (const row of rows) {
    if (knownFieldIds.has(row.fieldId)) {
      continue;
    }
    const key = `${row.studyId}${SEP}${row.entityKey}${SEP}${row.fieldId}`;
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    issues.push({
      issueType: 'dropped_unknown_field',
      studyId: row.studyId,
      fieldId: row.fieldId,
      entityKey: row.entityKey,
      detail: 'ResultsData の field_id が現行 SchemaFields に見つかりません（ma.csv / rob.csv には出力されません）',
    });
  }
  return issues;
}
