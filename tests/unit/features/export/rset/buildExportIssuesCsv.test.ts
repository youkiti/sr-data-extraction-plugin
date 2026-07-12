import { CSV_BOM } from '../../../../../src/features/export/csvEncode';
import { buildExportIssuesCsv } from '../../../../../src/features/export/rset/buildExportIssuesCsv';
import { EXPORT_ISSUES_HEADER } from '../../../../../src/features/export/rset/issues';

describe('buildExportIssuesCsv', () => {
  test('issue が無ければヘッダーのみ', () => {
    const result = buildExportIssuesCsv([]);
    expect(result.csv).toBe(`${CSV_BOM}${EXPORT_ISSUES_HEADER.join(',')}\r\n`);
    expect(result.rowCount).toBe(0);
  });

  test('issue を行として出力する', () => {
    const result = buildExportIssuesCsv([
      {
        issueType: 'skipped_study_no_final_annotator',
        studyId: 's1',
        fieldId: '',
        entityKey: '',
        detail: '確定 annotator を特定できません',
      },
    ]);
    expect(result.rowCount).toBe(1);
    expect(result.csv).toContain('skipped_study_no_final_annotator,s1,,,確定 annotator を特定できません');
  });
});
