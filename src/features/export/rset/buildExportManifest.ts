// export_manifest.json（issue #60 design-r-export.md §2 要望 7）: R セットのメタデータ。
// 純関数として設計する（`exported_at` は呼び出し側から引数で受け取り、ここで Date.now() 等を
// 呼ばない。既存の他 builder 群と同じ「純粋・注入可能」な設計方針に揃える）
import type { RSetIssue, RSetIssueType } from './issues';

/** この契約自体のバージョン。列の追加 = マイナー、意味変更 / 削除 = メジャーで運用する */
export const EXPORT_FORMAT_VERSION = '1.0';

/** 確定 annotator の選定規則（finalAnnotator.ts の規約をそのまま記述。規則自体は変更しない） */
export const FINAL_ANNOTATOR_RULE_DESCRIPTION = 'consensus が 1 件ならそれ、なければ唯一の human 行';

export interface RSetManifestFileEntry {
  rows: number;
}

export interface BuildExportManifestInput {
  schemaVersion: number;
  /** ISO 8601。呼び出し側（exportService 等）が Date.now() 相当を解決してから渡す */
  exportedAt: string;
  appVersion: string;
  /** レビュー体制の説明（例: 'single_with_ai' / 'dual_independent'）。文言は呼び出し側が決める */
  reviewMode: string;
  files: Record<string, RSetManifestFileEntry>;
  issues: readonly RSetIssue[];
}

export interface RSetManifest {
  export_format_version: string;
  schema_version: number;
  exported_at: string;
  app_version: string;
  review_mode: string;
  final_annotator_rule: string;
  files: Record<string, RSetManifestFileEntry>;
  issues_summary: Partial<Record<RSetIssueType, number>>;
}

export function buildExportManifest(input: BuildExportManifestInput): RSetManifest {
  const issuesSummary: Partial<Record<RSetIssueType, number>> = {};
  for (const issue of input.issues) {
    issuesSummary[issue.issueType] = (issuesSummary[issue.issueType] ?? 0) + 1;
  }
  return {
    export_format_version: EXPORT_FORMAT_VERSION,
    schema_version: input.schemaVersion,
    exported_at: input.exportedAt,
    app_version: input.appVersion,
    review_mode: input.reviewMode,
    final_annotator_rule: FINAL_ANNOTATOR_RULE_DESCRIPTION,
    files: input.files,
    issues_summary: issuesSummary,
  };
}

/** JSON テキスト化（インデント 2。人間が Drive 上で直接開いても読める体裁にする） */
export function manifestToJson(manifest: RSetManifest): string {
  return `${JSON.stringify(manifest, null, 2)}\n`;
}
