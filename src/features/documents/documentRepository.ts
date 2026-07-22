// Documents タブ I/O（requirements.md §3.2）。
// Documents は追記型タブには含まれない（§3.1）ため、取り込み後の study_id / document_role / note の
// 編集（S3 一覧のインライン編集・グルーピング）用に document_id をキーとした行上書きも提供する
//
// excluded / exclusion_reason / exclusion_note / excluded_at 列（issue #181: 文献除外機能）は
// 既存プロジェクトに存在しないことがあるため、evidenceRepository の bbox 列・runRepository の
// field_ids / warnings 列と同じ方式で後方互換を取る:
// - 読み出し（fetchDocuments）: 先頭 15 列（旧ヘッダ）は厳格一致、16 列目以降（除外機能列）は
//   「存在すれば」名前一致を要求し「欠けていれば」旧プロジェクトとして許容する
// - 書き込み（ensureDocumentExclusionColumns）: 旧ヘッダ（15 列）のプロジェクトへは、Pass B の
//   除外書き込みより前にヘッダ行をフルヘッダへ拡張する
import type { DocumentRecord, DocumentRole, ExclusionReason, TextStatus } from '../../domain/document';
import { DOCUMENT_ROLE_ORDER, EXCLUSION_REASON_ORDER } from '../../domain/document';
import { SHEET_HEADERS } from '../../domain/sheetsSchema';
import {
  appendRows,
  batchUpdateRows,
  getBatchValues,
  getSheetValues,
  updateRow,
} from '../../lib/google/sheets';
import type { GoogleApiDeps } from '../../lib/google/types';

const DOCUMENTS_TAB = 'Documents';

const TEXT_STATUSES: readonly TextStatus[] = ['ok', 'partial', 'no_text_layer'];

/** 旧ヘッダ（除外機能列導入前）の列数。以降 excluded / exclusion_reason / exclusion_note / excluded_at の任意列が続く */
const LEGACY_COLUMN_COUNT = 15;

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

/** appendRows/updateRow が boolean を書くと Sheets 上は TRUE になるため、大文字小文字を無視して読む */
function parseBool(value: string): boolean {
  return /^true$/i.test(value);
}

/**
 * exclusion_reason セル（16 列目）をパースする。空セル・列自体の欠落（旧プロジェクト）は null
 * （= 除外理由なし）。自プロジェクトが書いた値のため未知の値は厳格に throw する
 */
function parseExclusionReason(value: string, context: string): ExclusionReason | null {
  if (value === '') {
    return null;
  }
  if ((EXCLUSION_REASON_ORDER as readonly string[]).includes(value)) {
    return value as ExclusionReason;
  }
  throw new Error(`${context}: exclusion_reason "${value}" が不正です`);
}

/** DocumentRecord → シート行。列順は SHEET_HEADERS.Documents（domain/sheetsSchema.ts）に対応 */
export function documentToRow(doc: DocumentRecord): (string | number | boolean | null)[] {
  return [
    doc.documentId,
    doc.studyId,
    doc.documentRole,
    doc.driveFileId,
    doc.sourceFileId ?? '',
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
    doc.excluded,
    doc.exclusionReason ?? '',
    doc.exclusionNote ?? '',
    doc.excludedAt ?? '',
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
  SHEET_HEADERS.Documents.slice(0, LEGACY_COLUMN_COUNT).forEach((name, i) => {
    if (cellAt(header, i) !== name) {
      throw new Error(
        `Documents のヘッダ ${i + 1} 列目が "${name}" ではありません（実際: "${cellAt(header, i)}"）`,
      );
    }
  });
  SHEET_HEADERS.Documents.slice(LEGACY_COLUMN_COUNT).forEach((name, i) => {
    const idx = LEGACY_COLUMN_COUNT + i;
    if (idx < header.length && cellAt(header, idx) !== name) {
      throw new Error(
        `Documents のヘッダ ${idx + 1} 列目が "${name}" ではありません（実際: "${cellAt(header, idx)}"）`,
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
      sourceFileId: emptyToNull(cellAt(raw, 4)),
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
      excluded: parseBool(cellAt(raw, 15)),
      exclusionReason: parseExclusionReason(cellAt(raw, 16), context),
      exclusionNote: emptyToNull(cellAt(raw, 17)),
      excludedAt: emptyToNull(cellAt(raw, 18)),
    };
    if (rowIndexById.has(doc.documentId)) {
      throw new Error(`Documents に同一 document_id の行が複数あります（${doc.documentId}）`);
    }
    rowIndexById.set(doc.documentId, i + 2);
    rows.push(doc);
  });
  return { rows, rowIndexById };
}

/**
 * Documents タブのヘッダ行を除外機能列（excluded / exclusion_reason / exclusion_note /
 * excluded_at）込みのフルヘッダへ拡張する（既存プロジェクトの後方互換移行。issue #181。
 * runRepository.ensureRunOptionalColumns と同じ方式）。
 * - 先頭 15 列（旧ヘッダ）が SHEET_HEADERS.Documents と食い違う場合は throw
 *   （想定外のタブ・壊れたプロジェクトへの書き込み事故を防ぐ）
 * - 16 列目以降に既存の列があれば名前一致を要求する（未知の列を除外機能列で上書きしない）
 * - 既にフル列数（= 拡張済み）なら no-op
 * - それ以外（旧 15 列）はヘッダ行をフルヘッダで上書きする
 *
 * Pass B の除外書き込み（除外・解除の操作）より前に毎回呼ぶ想定。
 * ヘッダ行だけを読むため getBatchValues で `Documents!1:1` のみ取得する（全行 GET は避ける）
 */
export async function ensureDocumentExclusionColumns(
  spreadsheetId: string,
  deps: GoogleApiDeps,
): Promise<void> {
  const [headerRows] = await getBatchValues(spreadsheetId, [`${DOCUMENTS_TAB}!1:1`], deps);
  const header = headerRows?.[0] ?? [];
  SHEET_HEADERS.Documents.slice(0, LEGACY_COLUMN_COUNT).forEach((name, i) => {
    if (cellAt(header, i) !== name) {
      throw new Error(
        `Documents のヘッダ ${i + 1} 列目が "${name}" ではありません（実際: "${cellAt(header, i)}"）。除外機能列の移行を中止します`,
      );
    }
  });
  SHEET_HEADERS.Documents.slice(LEGACY_COLUMN_COUNT).forEach((name, i) => {
    const idx = LEGACY_COLUMN_COUNT + i;
    if (idx < header.length && cellAt(header, idx) !== name) {
      throw new Error(
        `Documents のヘッダ ${idx + 1} 列目が "${name}" ではありません（実際: "${cellAt(header, idx)}"）。除外機能列の移行を中止します`,
      );
    }
  });
  if (header.length >= SHEET_HEADERS.Documents.length) {
    // 既に拡張済み（フル列数）。no-op
    return;
  }
  await updateRow(spreadsheetId, DOCUMENTS_TAB, 1, [...SHEET_HEADERS.Documents], deps);
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

/**
 * 複数の既存行（document_id 一致）をまとめて上書きする（1 read + values:batchUpdate 1 回。
 * tiab-review 取り込みの pmid / doi 一括転記用 issue #68）。見つからない document_id は throw。空配列は no-op
 */
export async function updateDocuments(
  spreadsheetId: string,
  docs: readonly DocumentRecord[],
  deps: GoogleApiDeps,
): Promise<void> {
  if (docs.length === 0) {
    return;
  }
  const { rowIndexById } = await fetchDocuments(spreadsheetId, deps);
  const updates = docs.map((doc) => {
    const rowIndex = rowIndexById.get(doc.documentId);
    if (rowIndex === undefined) {
      throw new Error(`Documents に document_id "${doc.documentId}" の行がありません`);
    }
    return { rowIndex, row: documentToRow(doc) };
  });
  await batchUpdateRows(spreadsheetId, DOCUMENTS_TAB, updates, deps);
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
