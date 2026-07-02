// CSV エンコード（requirements.md §4.4: UTF-8 BOM 付き・Excel 互換）

/** Excel が UTF-8 と認識するための BOM */
export const CSV_BOM = '﻿';

/** RFC 4180 準拠の引用: カンマ・引用符・改行を含むフィールドを "..."（"" エスケープ）で包む */
export function encodeCsvField(value: string): string {
  if (/[",\r\n]/.test(value)) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}

/** ヘッダー + データ行を BOM 付き CSV 文字列（CRLF 改行・末尾改行あり）へ変換する */
export function buildCsv(
  header: readonly string[],
  rows: ReadonlyArray<readonly string[]>,
): string {
  const lines = [header, ...rows].map((row) => row.map(encodeCsvField).join(','));
  return `${CSV_BOM}${lines.join('\r\n')}\r\n`;
}
