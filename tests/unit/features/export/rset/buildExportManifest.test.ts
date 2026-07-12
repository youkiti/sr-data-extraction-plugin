import {
  buildExportManifest,
  EXPORT_FORMAT_VERSION,
  FINAL_ANNOTATOR_RULE_DESCRIPTION,
  manifestToJson,
} from '../../../../../src/features/export/rset/buildExportManifest';
import type { RSetIssue } from '../../../../../src/features/export/rset/issues';

describe('buildExportManifest', () => {
  test('issue が無ければ issues_summary は空オブジェクト', () => {
    const manifest = buildExportManifest({
      schemaVersion: 3,
      exportedAt: '2026-07-12T09:00:00Z',
      appVersion: '0.2.0',
      reviewMode: 'single_with_ai',
      files: { 'tab1.csv': { rows: 2 } },
      issues: [],
    });
    expect(manifest).toEqual({
      export_format_version: EXPORT_FORMAT_VERSION,
      schema_version: 3,
      exported_at: '2026-07-12T09:00:00Z',
      app_version: '0.2.0',
      review_mode: 'single_with_ai',
      final_annotator_rule: FINAL_ANNOTATOR_RULE_DESCRIPTION,
      files: { 'tab1.csv': { rows: 2 } },
      issues_summary: {},
    });
  });

  test('issue_type ごとに件数を集計する', () => {
    const issues: RSetIssue[] = [
      { issueType: 'unverified_cell', studyId: 's1', fieldId: 'f1', entityKey: '-', detail: 'a' },
      { issueType: 'unverified_cell', studyId: 's1', fieldId: 'f2', entityKey: '-', detail: 'b' },
      { issueType: 'duplicate_key', studyId: 's1', fieldId: '', entityKey: '', detail: 'c' },
    ];
    const manifest = buildExportManifest({
      schemaVersion: 1,
      exportedAt: '2026-07-12T09:00:00Z',
      appVersion: '0.2.0',
      reviewMode: 'dual_independent',
      files: {},
      issues,
    });
    expect(manifest.issues_summary).toEqual({ unverified_cell: 2, duplicate_key: 1 });
  });
});

describe('manifestToJson', () => {
  test('末尾改行つきの整形 JSON を返す', () => {
    const manifest = buildExportManifest({
      schemaVersion: 1,
      exportedAt: '2026-07-12T09:00:00Z',
      appVersion: '0.2.0',
      reviewMode: 'single_with_ai',
      files: {},
      issues: [],
    });
    const json = manifestToJson(manifest);
    expect(json.endsWith('\n')).toBe(true);
    expect(JSON.parse(json)).toEqual(manifest);
  });
});
