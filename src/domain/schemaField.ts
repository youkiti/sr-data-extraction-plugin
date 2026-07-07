// SchemaFields タブに対応する型（requirements.md §3.2）。1 行 = 1 抽出項目 ×（schema_version）

/** エンティティ階層（requirements.md §3.3）。rob_domain は RoB テンプレート（S5 プリセット）の入口のみ */
export type EntityLevel = 'study' | 'arm' | 'outcome_result' | 'rob_domain';

export type FieldDataType = 'text' | 'integer' | 'float' | 'boolean' | 'enum' | 'date';

export interface SchemaField {
  schemaVersion: number;
  /** 版をまたいで同一項目は同じ ID を維持（改名追跡用） */
  fieldId: string;
  /** 表示順 */
  fieldIndex: number;
  /** グルーピング（identification / methods / population / intervention / outcomes / 自由文字列） */
  section: string;
  /** CSV 列名になる snake_case 識別子（例: sample_size_total） */
  fieldName: string;
  /** 表示名（例: 総サンプルサイズ） */
  fieldLabel: string;
  entityLevel: EntityLevel;
  dataType: FieldDataType;
  /** 期待単位（例: mg/day）。単位変換はさせず「報告どおり + 単位別記」方針 */
  unit: string | null;
  /** data_type = enum 時の許容値（`|` 区切り） */
  allowedValues: string | null;
  /** 未報告時に not_reported を明示させるか */
  required: boolean;
  /** LLM への項目別抽出指示（自然言語）。スキーマ編集 UI から直接編集可能 */
  extractionInstruction: string;
  /** few-shot 用の例 */
  example: string | null;
  /** 監査用（AI ドラフト由来か） */
  aiGenerated: boolean;
  note: string | null;
}
