// ExportLog タブに対応する型（requirements.md §3.2）

/**
 * CSV エクスポートの形式（§4.4）。`r_set` は issue #60（design-r-export.md）で追加した
 * R 解析向けの複数ファイル形式（tab1 / ma / rob / data_dictionary / export_issues の
 * 5 CSV + ステータスミラー表 2 種 + export_manifest.json の計 8 ファイル）
 */
export type ExportFormat = 'study_wide' | 'results_long' | 'audit' | 'r_set';

export interface ExportLogEntry {
  exportId: string;
  format: ExportFormat;
  schemaVersion: number;
  /**
   * CSV に行が出た study 数（v0.10 で document_count から改名）。
   * r_set は既存列で表現するため tab1.csv の行数（= 確定 annotator を特定できた study 数）を使う
   */
  studyCount: number;
  /**
   * Drive に保存した CSV の URL。r_set は複数ファイルのため、既存列のみで表現する方針
   * （design-r-export.md §13）に沿って保存先サブフォルダ（`exports/rset_{timestamp}/`）の
   * webViewLink を入れる
   */
  fileRef: string;
  exportedAt: string;
  exportedBy: string;
}
