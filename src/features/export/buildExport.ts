// S10 エクスポートの形式ディスパッチ。3 形式の builder を共通の結果型（BuiltExport）へ
// 正規化し、サマリ（行数 / 対象文献数 / 未検証セル数）とプレビュー素材まで一度に作る
import type { ResultsDataRow, StudyDataRow } from '../../domain/annotation';
import type { Decision } from '../../domain/decision';
import type { StudyRecord } from '../../domain/study';
import type { Evidence } from '../../domain/evidence';
import type { ExportFormat } from '../../domain/exportLog';
import type { RunAuditInfo } from '../../domain/extractionRun';
import type { SchemaField } from '../../domain/schemaField';
import { buildAuditCsv } from './buildAuditCsv';
import { buildResultsLongCsv } from './buildResultsLongCsv';
import { buildStudyWideCsv } from './buildStudyWideCsv';
import { parseCsv } from './parseCsv';

/**
 * このモジュール（buildExport.ts）が扱う「単一 CSV を返す」従来 3 形式。
 * `r_set`（issue #60）は 8 ファイルを返す別オーケストレータ（rset/buildRSet.ts）が担当し、
 * ここでは扱わない
 */
export type ClassicExportFormat = Exclude<ExportFormat, 'r_set'>;

/** 形式選択ラジオの表示順（ui-states.md §3 `#/export`） */
export const EXPORT_FORMATS: readonly ClassicExportFormat[] = ['study_wide', 'results_long', 'audit'];

/** プレビューに出すデータ行の上限（ui-states.md §3: 先頭 10 行） */
export const PREVIEW_ROW_LIMIT = 10;

/** 3 形式の CSV 構築に必要な素材一式（exportService が Sheets から読み込む）。studies は
 * アクティブ study（Documents から 1 件以上参照）のみ・作成順で渡す（非アクティブは除外・§4.5） */
export interface ExportMaterials {
  studies: readonly StudyRecord[];
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
  format: ClassicExportFormat;
  csv: string;
  /** CSV のヘッダ列名 */
  header: string[];
  /** 先頭 PREVIEW_ROW_LIMIT 件のデータ行 */
  previewRows: string[][];
  /** ヘッダを除くデータ行数 */
  rowCount: number;
  /** CSV に行が出た study 数（ExportLog.study_count） */
  studyCount: number;
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
  format: ClassicExportFormat,
  csv: string,
  studyCount: number,
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
    studyCount,
    unverifiedCellCount,
    skippedStudyLabels,
    droppedRowCount,
  };
}

/** 除外 study_id → study_label（一覧に見つからない id は id のまま出す防御） */
export function toStudyLabels(
  studies: readonly StudyRecord[],
  studyIds: readonly string[],
): string[] {
  const labelById = new Map(studies.map((study) => [study.studyId, study.studyLabel]));
  return studyIds.map((id) => labelById.get(id) ?? id);
}

export function buildExport(format: ClassicExportFormat, materials: ExportMaterials): BuiltExport {
  const { studies, fields } = materials;
  switch (format) {
    case 'study_wide': {
      const result = buildStudyWideCsv(studies, materials.studyRows, fields);
      return finish(
        format,
        result.csv,
        result.studyCount,
        result.unverifiedCellCount,
        toStudyLabels(studies, result.skippedStudyIds),
        0,
      );
    }
    case 'results_long': {
      const result = buildResultsLongCsv(studies, materials.resultsRows, fields);
      return finish(
        format,
        result.csv,
        result.studyCount,
        null,
        toStudyLabels(studies, result.skippedStudyIds),
        result.droppedRowCount,
      );
    }
    case 'audit': {
      const result = buildAuditCsv(
        studies,
        materials.decisions,
        materials.evidences,
        materials.runs,
        fields,
      );
      return finish(format, result.csv, result.studyCount, result.undecidedCellCount, [], result.droppedRowCount);
    }
  }
}

/** 3 形式まとめて構築する（読み込み 1 回で形式切替を即時にするため） */
export function buildAllExports(
  materials: ExportMaterials,
): Record<ClassicExportFormat, BuiltExport> {
  return {
    study_wide: buildExport('study_wide', materials),
    results_long: buildExport('results_long', materials),
    audit: buildExport('audit', materials),
  };
}
