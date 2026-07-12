// CSV エンコード（requirements.md §4.4）。
// 既存 3 形式（study_wide / results_long / audit）は Excel との相性を優先し UTF-8 BOM 付きで
// 出力する一方、R セット（issue #60 design-r-export.md D-6）は R の readr::read_csv() 等との
// 相性を優先し BOM を付けない。そのため `buildCsv` 自体は BOM を付けない共通実装とし、
// BOM が必要な既存 3 形式は呼び出し側（buildStudyWideCsv.ts / buildResultsLongCsv.ts /
// buildAuditCsv.ts）が個別に CSV_BOM を前置する（PR-B で導入。design-r-export.md §13 参照）

/** Excel が UTF-8 と認識するための BOM。既存 3 形式の builder が個別に前置する（R セットは付けない） */
export const CSV_BOM = '﻿';

/** RFC 4180 準拠の引用: カンマ・引用符・改行を含むフィールドを "..."（"" エスケープ）で包む */
export function encodeCsvField(value: string): string {
  if (/[",\r\n]/.test(value)) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}

/** ヘッダー + データ行を BOM なしの CSV 文字列（CRLF 改行・末尾改行あり）へ変換する */
export function buildCsv(
  header: readonly string[],
  rows: ReadonlyArray<readonly string[]>,
): string {
  const lines = [header, ...rows].map((row) => row.map(encodeCsvField).join(','));
  return `${lines.join('\r\n')}\r\n`;
}
