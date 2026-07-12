// export_issues.csv（issue #60 design-r-export.md §2 要望 6）: 1 行 = 1 除外/警告イベント。
// 黙示的なデータ除外（確定 annotator 不明 / 未知 field_id / 重複キー / 未検証セル）を
// 常に明示行として出す。エクスポート自体はブロックしない（警告 + 明示行の方針）
import { buildCsv } from '../csvEncode';
import { EXPORT_ISSUES_HEADER, type RSetIssue } from './issues';

export interface ExportIssuesBuildResult {
  csv: string;
  rowCount: number;
}

export function buildExportIssuesCsv(issues: readonly RSetIssue[]): ExportIssuesBuildResult {
  const rows = issues.map((issue) => [issue.issueType, issue.studyId, issue.fieldId, issue.entityKey, issue.detail]);
  return { csv: buildCsv(EXPORT_ISSUES_HEADER, rows), rowCount: rows.length };
}
