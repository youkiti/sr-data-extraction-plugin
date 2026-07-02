// ExportLog タブに対応する型（requirements.md §3.2）

/** CSV エクスポートの 3 形式（§4.4） */
export type ExportFormat = 'study_wide' | 'results_long' | 'audit';

export interface ExportLogEntry {
  exportId: string;
  format: ExportFormat;
  schemaVersion: number;
  documentCount: number;
  /** Drive に保存した CSV の URL */
  fileRef: string;
  exportedAt: string;
  exportedBy: string;
}
