// R セット（issue #60）のオーケストレータ。tab1 / ma / rob / dictionary / issues / manifest の
// 8 ファイルを 1 回の呼び出しでまとめて構築する純関数。Drive への保存・ExportLog 追記は
// PR-B（S10 UI 配線）のスコープで、ここでは CSV / JSON のテキストを返すところまでに留める
import type { ResultsDataRow, StudyDataRow } from '../../../domain/annotation';
import type { ArmStructureRow } from '../../../domain/armStructure';
import type { Decision } from '../../../domain/decision';
import type { Evidence } from '../../../domain/evidence';
import type { SchemaField } from '../../../domain/schemaField';
import type { StudyRecord } from '../../../domain/study';
import { buildDataDictionaryCsv } from './buildDataDictionaryCsv';
import { buildExportIssuesCsv } from './buildExportIssuesCsv';
import { buildExportManifest, manifestToJson, type RSetManifest } from './buildExportManifest';
import { buildMaCsv } from './buildMaCsv';
import { buildRobCsv } from './buildRobCsv';
import { buildTab1Csv } from './buildTab1Csv';
import {
  collectResultsDataDroppedFieldIssues,
  collectResultsDataDuplicateKeyIssues,
  collectStudyDataDroppedFieldIssues,
  collectStudyDataDuplicateKeyIssues,
  type RSetIssue,
} from './issues';

/** R セット構築に必要な素材一式。buildExport.ts の ExportMaterials を拡張した形（studies は
 * アクティブ study のみ・作成順で渡す。既存 3 形式と同じ前提を踏襲する） */
export interface RSetMaterials {
  studies: readonly StudyRecord[];
  studyRows: readonly StudyDataRow[];
  resultsRows: readonly ResultsDataRow[];
  decisions: readonly Decision[];
  evidences: readonly Evidence[];
  armStructureRows: readonly ArmStructureRow[];
  /** Documents 1 件 = 1 要素（studyId のみ）。tab1.csv の n_documents 集計に使う */
  documentStudyIds: readonly string[];
  /** 最新確定版の全項目 */
  fields: readonly SchemaField[];
}

/** manifest に注入するメタデータ（純関数のため呼び出し側が解決してから渡す） */
export interface RSetManifestMeta {
  exportedAt: string;
  appVersion: string;
  reviewMode: string;
}

export interface RSetFile {
  name: string;
  content: string;
  rowCount: number;
}

export interface BuiltRSet {
  files: RSetFile[];
  issues: RSetIssue[];
  manifest: RSetManifest;
}

/** schema_version は fields から解決する（空配列のときは 0 = 未確定スキーマとして manifest に記録） */
function resolveSchemaVersion(fields: readonly SchemaField[]): number {
  return fields.reduce((max, field) => Math.max(max, field.schemaVersion), 0);
}

export function buildRSet(materials: RSetMaterials, meta: RSetManifestMeta): BuiltRSet {
  const { studies, studyRows, resultsRows, decisions, evidences, armStructureRows, documentStudyIds, fields } =
    materials;

  const tab1 = buildTab1Csv(studies, studyRows, evidences, documentStudyIds, fields);
  const ma = buildMaCsv(studies, resultsRows, decisions, evidences, armStructureRows, fields);
  const rob = buildRobCsv(studies, resultsRows, evidences, fields);
  const dictionary = buildDataDictionaryCsv(fields);

  // 黙示的除外の横断チェック（duplicate_key / dropped_unknown_field）はファイルをまたいで
  // 二重計上しないよう、ここで一度だけ実行する（issues.ts のコメント参照）
  const crossCuttingIssues: RSetIssue[] = [
    ...collectStudyDataDuplicateKeyIssues(studyRows),
    ...collectResultsDataDuplicateKeyIssues(resultsRows),
    ...collectStudyDataDroppedFieldIssues(studyRows, fields),
    ...collectResultsDataDroppedFieldIssues(resultsRows, fields),
  ];

  const allIssues: RSetIssue[] = [...crossCuttingIssues, ...tab1.issues, ...ma.issues, ...rob.issues];
  const issuesCsv = buildExportIssuesCsv(allIssues);

  const files: RSetFile[] = [
    { name: 'tab1.csv', content: tab1.csv, rowCount: tab1.rowCount },
    { name: 'tab1_status.csv', content: tab1.statusCsv, rowCount: tab1.rowCount },
    { name: 'ma.csv', content: ma.csv, rowCount: ma.rowCount },
    { name: 'ma_status.csv', content: ma.statusCsv, rowCount: ma.rowCount },
    { name: 'rob.csv', content: rob.csv, rowCount: rob.rowCount },
    { name: 'data_dictionary.csv', content: dictionary.csv, rowCount: dictionary.rowCount },
    { name: 'export_issues.csv', content: issuesCsv.csv, rowCount: issuesCsv.rowCount },
  ];

  const manifest = buildExportManifest({
    schemaVersion: resolveSchemaVersion(fields),
    exportedAt: meta.exportedAt,
    appVersion: meta.appVersion,
    reviewMode: meta.reviewMode,
    files: Object.fromEntries(files.map((file) => [file.name, { rows: file.rowCount }])),
    issues: allIssues,
  });

  files.push({ name: 'export_manifest.json', content: manifestToJson(manifest), rowCount: 0 });

  return { files, issues: allIssues, manifest };
}

/** データ行を持つ CSV（tab1 / ma / rob。dictionary / issues / manifest は常に出力されるため対象外） */
const DATA_FILE_NAMES = new Set(['tab1.csv', 'ma.csv', 'rob.csv']);

/**
 * 「生成できるデータ行があるか」の判定材料（S10 の生成ボタン無効化ゲート。
 * 既存 3 形式の `BuiltExport.rowCount === 0` ゲートに相当する R セット版）
 */
export function rSetDataRowCount(built: BuiltRSet): number {
  return built.files
    .filter((file) => DATA_FILE_NAMES.has(file.name))
    .reduce((sum, file) => sum + file.rowCount, 0);
}

/** 未検証セル残存の警告ダイアログの n（export_issues.csv の unverified_cell 件数） */
export function countRSetUnverifiedCells(built: BuiltRSet): number {
  return built.issues.filter((issue) => issue.issueType === 'unverified_cell').length;
}
