// S5 スキーマエディタの行型。SchemaFields タブの 1 行に対応するが、
// schema_version / field_index は「版として確定」時に採番するためここでは持たない
import type { EntityLevel, FieldDataType } from '../../domain/schemaField';

export interface SchemaEditorRow {
  /** 既存版から引き継いだ項目は同じ ID を維持（改名追跡。requirements.md §3.2）。新規行は null → 確定時に採番 */
  fieldId: string | null;
  section: string;
  fieldName: string;
  fieldLabel: string;
  entityLevel: EntityLevel;
  dataType: FieldDataType;
  unit: string | null;
  allowedValues: string | null;
  required: boolean;
  extractionInstruction: string;
  example: string | null;
  /** 監査用（AI ドラフト由来の行か。人間が値を書き換えても維持する） */
  aiGenerated: boolean;
  note: string | null;
}
