// Google Sheets の 15 タブ定義（requirements.md §3.2 v0.10 + 独立二重レビュー機能の Reviewers タブ）。
// 実 I/O は lib/google/sheets.ts 側で行う。
// Meta / Protocol / LLMApiLog は sr-query-builder のスキーマを流用（ProtocolBlocks は持たない）。
// v0.10 で study / document を分離: Studies を新設し、データ行のキーを document_id → study_id へ改名。
// Evidence だけは quote の出所を特定するため document_id を保持したまま study_id を併記する。
// Reviewers は独立二重レビュー機能（docs/design-independent-dual-review.md §2.1）でロール割り当てを
// 追記する置き場。旧プロジェクトにはタブが無いため、書き込み時に自動作成する（reviewerRepository.ts）

export const SHEET_TABS = [
  'Meta',
  'Protocol',
  'Studies',
  'Documents',
  'SchemaVersions',
  'SchemaFields',
  'ExtractionRuns',
  'StudyData',
  'ResultsData',
  'ArmStructures',
  'Evidence',
  'Decisions',
  'LLMApiLog',
  'ExportLog',
  'Reviewers',
] as const;

export type SheetTabName = (typeof SHEET_TABS)[number];

/**
 * StudyData（wide）の固定列。この後ろにスキーマの entity_level = study 項目の
 * field_name 列を動的に追加する（追加のみ。削除・改名はしない。改名は field_id で追跡）
 */
export const STUDY_DATA_FIXED_HEADERS = [
  'study_id',
  'annotator',
  'annotator_type',
  'schema_version',
  'run_id',
  'updated_at',
] as const;

/**
 * 各タブのヘッダー行（列名）定義。スプレッドシート初期化時にここから書き込む。
 * StudyData は固定列のみ（値列は buildStudyDataHeader で動的生成）。
 */
export const SHEET_HEADERS: Record<SheetTabName, readonly string[]> = {
  Meta: [
    'project_id',
    'project_title',
    'spreadsheet_id',
    'drive_folder_id',
    'schema_version',
    'created_at',
    'created_by',
  ],
  Protocol: [
    'version',
    'framework_type',
    'research_question',
    'inclusion_criteria',
    'exclusion_criteria',
    'study_design',
    'block_count',
    'combination_expression',
    'source_type',
    'source_filename',
    'raw_text_ref',
    'raw_text_preview',
    'raw_text_inline',
    'created_at',
    'created_by',
  ],
  Studies: [
    'study_id',
    'study_label',
    'registration_id',
    'created_at',
    'created_by',
    'note',
  ],
  Documents: [
    'document_id',
    'study_id',
    'document_role',
    'drive_file_id',
    'source_file_id',
    'filename',
    'pmid',
    'doi',
    'text_ref',
    'text_status',
    'page_count',
    'char_count',
    'imported_at',
    'imported_by',
    'note',
  ],
  SchemaVersions: [
    'schema_version',
    'parent_version',
    'protocol_version',
    'created_by_type',
    'created_at',
    'created_by',
    'note',
  ],
  SchemaFields: [
    'schema_version',
    'field_id',
    'field_index',
    'section',
    'field_name',
    'field_label',
    'entity_level',
    'data_type',
    'unit',
    'allowed_values',
    'required',
    'extraction_instruction',
    'example',
    'ai_generated',
    'note',
  ],
  ExtractionRuns: [
    'run_id',
    'run_type',
    'schema_version',
    'study_ids',
    'provider',
    'requested_model',
    'model_version',
    'input_mode',
    'status',
    'started_at',
    'finished_at',
    'tokens_in',
    'tokens_out',
    'cost_estimate',
  ],
  StudyData: STUDY_DATA_FIXED_HEADERS,
  ResultsData: [
    'result_id',
    'study_id',
    'field_id',
    'annotator',
    'annotator_type',
    'schema_version',
    'entity_key',
    'run_id',
    'value',
    'not_reported',
    'updated_at',
  ],
  ArmStructures: [
    'study_id',
    'version',
    'arm_key',
    'arm_name',
    'annotator',
    'annotator_type',
    'confirmed_at',
    'note',
  ],
  Evidence: [
    'evidence_id',
    'run_id',
    'study_id',
    'field_id',
    'document_id',
    'entity_key',
    'value',
    'not_reported',
    'quote',
    'page',
    'confidence',
    'anchor_status',
  ],
  Decisions: [
    'decided_at',
    'decided_by',
    'study_id',
    'field_id',
    'entity_key',
    'annotator',
    'annotator_type',
    'schema_version',
    'action',
    'value',
    'note',
  ],
  LLMApiLog: [
    'log_id',
    'timestamp',
    'provider',
    'model',
    'purpose',
    'prompt_ref',
    'response_ref',
    'prompt_summary',
    'tokens_in',
    'tokens_out',
    'latency_ms',
    'cost_estimate_usd',
    'error',
  ],
  ExportLog: [
    'export_id',
    'format',
    'schema_version',
    'study_count',
    'file_ref',
    'exported_at',
    'exported_by',
  ],
  Reviewers: ['email', 'role', 'review_mode', 'assigned_by', 'assigned_at'],
};

/**
 * StudyData の実ヘッダー行を生成する（固定列 + study レベル項目の field_name 列）。
 * 固定列との衝突・field_name の重複はスキーマ不整合としてエラーにする
 */
export function buildStudyDataHeader(fieldNames: readonly string[]): string[] {
  const seen = new Set<string>(STUDY_DATA_FIXED_HEADERS);
  const header: string[] = [...STUDY_DATA_FIXED_HEADERS];
  for (const name of fieldNames) {
    if (seen.has(name)) {
      throw new Error(`StudyData の列名が重複しています: "${name}"`);
    }
    seen.add(name);
    header.push(name);
  }
  return header;
}
