// S10 エクスポートの形式ディスパッチ。3 形式の builder を共通の結果型（BuiltExport）へ
// 正規化し、サマリ（行数 / 対象文献数 / 未検証セル数）とプレビュー素材まで一度に作る
import type { ResultsDataRow, StudyDataRow } from '../../domain/annotation';
import type { Decision } from '../../domain/decision';
import type { DocumentRecord } from '../../domain/document';
import type { Evidence } from '../../domain/evidence';
import type { ExportFormat } from '../../domain/exportLog';
import type { RunAuditInfo } from '../../domain/extractionRun';
import type { SchemaField } from '../../domain/schemaField';
import { buildAuditCsv } from './buildAuditCsv';
import { buildResultsLongCsv } from './buildResultsLongCsv';
import { buildStudyWideCsv } from './buildStudyWideCsv';
import { parseCsv } from './parseCsv';

/** 形式選択ラジオの表示順（ui-states.md §3 `#/export`） */
export const EXPORT_FORMATS: readonly ExportFormat[] = ['study_wide', 'results_long', 'audit'];

/** プレビューに出すデータ行の上限（ui-states.md §3: 先頭 10 行） */
export const PREVIEW_ROW_LIMIT = 10;

/** 3 形式の CSV 構築に必要な素材一式（exportService が Sheets から読み込む） */
export interface ExportMaterials {
  documents: readonly DocumentRecord[];
  studyRows: readonly StudyDataRow[];
  resultsRows: readonly ResultsDataRow[];
  decisions: readonly Decision[];
  evidences: readonly Evidence[];
  runs: readonly RunAuditInfo[];
  /** 最新確定版の全項目 */
  fields: readonly SchemaField[];
}

/** 1 形式ぶんの構築結果（サマリ・警告ダイアログ・プレビュー・ExportLog の素材） */
export interface BuiltExport {
  format: ExportFormat;
  csv: string;
  /** CSV のヘッダ列名 */
  header: string[];
  /** 先頭 PREVIEW_ROW_LIMIT 件のデータ行 */
  previewRows: string[][];
  /** ヘッダを除くデータ行数 */
  rowCount: number;
  /** CSV に行が出た文献数（ExportLog.document_count） */
  documentCount: number;
  /**
   * 警告ダイアログの n（requirements.md §4.4「未検証の項目が n 件あります」）。
   * study_wide = 確定 annotator 行の空セル数 / audit = 判定 0 件セルのプレースホルダ行数 /
   * results_long = 未検証の概念がないため null（警告なし）
   */
  unverifiedCellCount: number | null;
  /** 確定 annotator を特定できず除外した文献の study_label（0 件なら警告非表示） */
  skippedStudyLabels: string[];
  /** field_id が SchemaFields に見つからず除外した行数（0 件なら警告非表示） */
  droppedRowCount: number;
}

/** builder 固有の結果を BuiltExport へ正規化する共通仕上げ */
function finish(
  format: ExportFormat,
  csv: string,
  documentCount: number,
  unverifiedCellCount: number | null,
  skippedStudyLabels: string[],
  droppedRowCount: number,
): BuiltExport {
  const records = parseCsv(csv);
  const dataRows = records.slice(1);
  return {
    format,
    csv,
    header: records[0] as string[], // buildCsv は常にヘッダ行を先頭に出す
    previewRows: dataRows.slice(0, PREVIEW_ROW_LIMIT),
    rowCount: dataRows.length,
    documentCount,
    unverifiedCellCount,
    skippedStudyLabels,
    droppedRowCount,
  };
}

/** 除外 document_id → study_label（一覧に見つからない id は id のまま出す防御） */
export function toStudyLabels(
  documents: readonly DocumentRecord[],
  documentIds: readonly string[],
): string[] {
  const labelById = new Map(documents.map((doc) => [doc.documentId, doc.studyLabel]));
  return documentIds.map((id) => labelById.get(id) ?? id);
}

export function buildExport(format: ExportFormat, materials: ExportMaterials): BuiltExport {
  const { documents, fields } = materials;
  switch (format) {
    case 'study_wide': {
      const result = buildStudyWideCsv(documents, materials.studyRows, fields);
      return finish(
        format,
        result.csv,
        result.documentCount,
        result.unverifiedCellCount,
        toStudyLabels(documents, result.skippedDocumentIds),
        0,
      );
    }
    case 'results_long': {
      const result = buildResultsLongCsv(documents, materials.resultsRows, fields);
      return finish(
        format,
        result.csv,
        result.documentCount,
        null,
        toStudyLabels(documents, result.skippedDocumentIds),
        result.droppedRowCount,
      );
    }
    case 'audit': {
      const result = buildAuditCsv(
        documents,
        materials.decisions,
        materials.evidences,
        materials.runs,
        fields,
      );
      return finish(format, result.csv, result.documentCount, result.undecidedCellCount, [], result.droppedRowCount);
    }
  }
}

/** 3 形式まとめて構築する（読み込み 1 回で形式切替を即時にするため） */
export function buildAllExports(materials: ExportMaterials): Record<ExportFormat, BuiltExport> {
  return {
    study_wide: buildExport('study_wide', materials),
    results_long: buildExport('results_long', materials),
    audit: buildExport('audit', materials),
  };
}
