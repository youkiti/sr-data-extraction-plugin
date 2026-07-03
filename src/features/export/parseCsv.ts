// CSV の最小パーサ（RFC 4180: "" エスケープ・引用内のカンマ / 改行に対応）。
// S10 のプレビュー表示と行数集計のために buildCsv の出力を読み戻す内部利用が前提
import { CSV_BOM } from './csvEncode';

/** BOM 付き CSV 文字列をレコード配列（先頭 = ヘッダ行）へ戻す。末尾改行は空レコードにしない */
export function parseCsv(csv: string): string[][] {
  const text = csv.startsWith(CSV_BOM) ? csv.slice(CSV_BOM.length) : csv;
  const records: string[][] = [];
  let record: string[] = [];
  let field = '';
  let inQuotes = false;
  let started = false; // 現在のレコードに 1 文字でも入力があったか（末尾改行の空レコード抑止）
  const endField = (): void => {
    record.push(field);
    field = '';
  };
  const endRecord = (): void => {
    endField();
    records.push(record);
    record = [];
    started = false;
  };
  let i = 0;
  while (i < text.length) {
    const ch = text[i] as string;
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"'; // "" は引用内の 1 個の引用符
          i += 2;
          continue;
        }
        inQuotes = false;
        i++;
        continue;
      }
      field += ch;
      i++;
      continue;
    }
    if (ch === '"') {
      inQuotes = true;
      started = true;
      i++;
      continue;
    }
    if (ch === ',') {
      endField();
      started = true;
      i++;
      continue;
    }
    if (ch === '\r' && text[i + 1] === '\n') {
      endRecord();
      i += 2;
      continue;
    }
    if (ch === '\n') {
      endRecord();
      i++;
      continue;
    }
    field += ch;
    started = true;
    i++;
  }
  if (started || field !== '' || record.length > 0) {
    endRecord();
  }
  return records;
}
