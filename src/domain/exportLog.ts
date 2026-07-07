// ExportLog タブに対応する型（requirements.md §3.2）

/** CSV エクスポートの 3 形式（§4.4） */
export type ExportFormat = 'study_wide' | 'results_long' | 'audit';

export interface ExportLogEntry {
  exportId: string;
  format: ExportFormat;
  schemaVersion: number;
  /** CSV に行が出た study 数（v0.10 で document_count から改名） */
  studyCount: number;
  /** Drive に保存した CSV の URL */
  fileRef: string;
  exportedAt: string;
  exportedBy: string;
}
