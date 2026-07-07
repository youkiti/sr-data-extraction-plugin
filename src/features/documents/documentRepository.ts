// Documents タブ I/O（requirements.md §3.2）。
// Documents は追記型タブには含まれない（§3.1）ため、取り込み後の study_id / document_role / note の
// 編集（S3 一覧のインライン編集・グルーピング）用に document_id をキーとした行上書きも提供する
import type { DocumentRecord, DocumentRole, TextStatus } from '../../domain/document';
import { DOCUMENT_ROLE_ORDER } from '../../domain/document';
import { SHEET_HEADERS } from '../../domain/sheetsSchema';
import { appendRows, getSheetValues, updateRow } from '../../lib/google/sheets';
import type { GoogleApiDeps } from '../../lib/google/types';

const DOCUMENTS_TAB = 'Documents';

const TEXT_STATUSES: readonly TextStatus[] = ['ok', 'partial', 'no_text_layer'];

function cellAt(row: readonly string[], index: number): string {
  return row[index] ?? '';
}

function emptyToNull(value: string): string | null {
  return value === '' ? null : value;
}

function parseTextStatus(value: string, context: string): TextStatus {
  if ((TEXT_STATUSES as readonly string[]).includes(value)) {
    return value as TextStatus;
  }
  throw new Error(`${context}: text_status "${value}" が不正です`);
}

function parseDocumentRole(value: string, context: string): DocumentRole {
  if ((DOCUMENT_ROLE_ORDER as readonly string[]).includes(value)) {
    return value as DocumentRole;
  }
  throw new Error(`${context}: document_role "${value}" が不正です`);
}

function parseNullableInt(value: string, label: string, context: string): number | null {
  if (value === '') {
    return null;
  }
  const parsed = Number(value);
  if (!Number.isInteger(parsed)) {
    throw new Error(`${context}: ${label} "${value}" が整数ではありません`);
  }
  return parsed;
}

/** DocumentRecord → シート行。列順は SHEET_HEADERS.Documents（domain/sheetsSchema.ts）に対応 */
export function documentToRow(doc: DocumentRecord): (string | number | null)[] {
  return [
    doc.documentId,
    doc.studyId,
    doc.documentRole,
    doc.driveFileId,
    doc.sourceFileId,
    doc.filename,
    doc.pmid,
    doc.doi,
    doc.textRef,
    doc.textStatus,
    doc.pageCount,
    doc.charCount,
    doc.importedAt,
    doc.importedBy,
    doc.note,
  ];
}

interface DocumentsSnapshot {
  rows: DocumentRecord[];
  /** document_id → シート行番号（1 始まり） */
  rowIndexById: Map<string, number>;
}

async function fetchDocuments(
  spreadsheetId: string,
  deps: GoogleApiDeps,
): Promise<DocumentsSnapshot> {
  const values = await getSheetValues(spreadsheetId, DOCUMENTS_TAB, deps);
  const header = values[0];
  if (header === undefined) {
    throw new Error('Documents タブにヘッダ行がありません（プロジェクト初期化が不完全です）');
  }
  SHEET_HEADERS.Documents.forEach((name, i) => {
    if (cellAt(header, i) !== name) {
      throw new Error(
        `Documents のヘッダ ${i + 1} 列目が "${name}" ではありません（実際: "${cellAt(header, i)}"）`,
      );
    }
  });

  const rows: DocumentRecord[] = [];
  const rowIndexById = new Map<string, number>();
  values.slice(1).forEach((raw, i) => {
    const context = `Documents ${i + 2} 行目`;
    const doc: DocumentRecord = {
      documentId: cellAt(raw, 0),
      studyId: cellAt(raw, 1),
      documentRole: parseDocumentRole(cellAt(raw, 2), context),
      driveFileId: cellAt(raw, 3),
      sourceFileId: cellAt(raw, 4),
      filename: cellAt(raw, 5),
      pmid: emptyToNull(cellAt(raw, 6)),
      doi: emptyToNull(cellAt(raw, 7)),
      textRef: emptyToNull(cellAt(raw, 8)),
      textStatus: parseTextStatus(cellAt(raw, 9), context),
      pageCount: parseNullableInt(cellAt(raw, 10), 'page_count', context),
      charCount: parseNullableInt(cellAt(raw, 11), 'char_count', context),
      importedAt: cellAt(raw, 12),
      importedBy: cellAt(raw, 13),
      note: emptyToNull(cellAt(raw, 14)),
    };
    if (rowIndexById.has(doc.documentId)) {
      throw new Error(`Documents に同一 document_id の行が複数あります（${doc.documentId}）`);
    }
    rowIndexById.set(doc.documentId, i + 2);
    rows.push(doc);
  });
  return { rows, rowIndexById };
}

/** Documents タブの全行を取り込み順（シート行順）で読み込む */
export async function readDocuments(
  spreadsheetId: string,
  deps: GoogleApiDeps,
): Promise<DocumentRecord[]> {
  return (await fetchDocuments(spreadsheetId, deps)).rows;
}

/** 取り込んだ文献をまとめて追記する（1 API 呼び出し）。空配列は no-op */
export async function appendDocuments(
  spreadsheetId: string,
  docs: readonly DocumentRecord[],
  deps: GoogleApiDeps,
): Promise<void> {
  await appendRows(spreadsheetId, DOCUMENTS_TAB, docs.map(documentToRow), deps);
}

/** 既存行（document_id 一致）を丸ごと上書きする。見つからなければ throw */
export async function updateDocument(
  spreadsheetId: string,
  doc: DocumentRecord,
  deps: GoogleApiDeps,
): Promise<void> {
  const { rowIndexById } = await fetchDocuments(spreadsheetId, deps);
  const rowIndex = rowIndexById.get(doc.documentId);
  if (rowIndex === undefined) {
    throw new Error(`Documents に document_id "${doc.documentId}" の行がありません`);
  }
  await updateRow(spreadsheetId, DOCUMENTS_TAB, rowIndex, documentToRow(doc), deps);
}
