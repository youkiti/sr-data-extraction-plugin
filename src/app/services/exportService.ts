// #/export（S10）のサービス層。
// 素材の読み込み（Documents / StudyData / ResultsData / Evidence / Decisions /
// ExtractionRuns / 最新版 SchemaFields → 3 形式の CSV をメモリ上で構築）と、
// 生成（未検証セル警告 → Drive `exports/` へ保存 → ExportLog 追記）を担う。
// あわせて論文 Methods 記載例カード（docs/methods-boilerplate.md, issue #67）の実績値組み立てと
// クリップボードコピーも担う
import type { LlmProviderId } from '../../domain/llmApiLog';
import type { DocumentRecord } from '../../domain/document';
import type { ExportFormat, ExportLogEntry } from '../../domain/exportLog';
import { readDocuments } from '../../features/documents/documentRepository';
import { readStudies, resolveActiveStudies } from '../../features/documents/studyRepository';
import { readResultsDataRows, readStudyDataSheet } from '../../features/extraction/annotationRepository';
import { readEvidenceRows } from '../../features/extraction/evidenceRepository';
import { readMethodsRunFacts, readRunAuditInfos } from '../../features/extraction/runRepository';
import type { MethodsRunFact } from '../../features/extraction/runRepository';
import { buildAllExports, type ClassicExportFormat } from '../../features/export/buildExport';
import { appendExportLog } from '../../features/export/exportLogRepository';
import {
  buildMethodsText,
  type MethodsFacts,
  type MethodsLanguage,
  type MethodsWorkflow,
} from '../../features/export/methodsBoilerplate';
import {
  buildRSet,
  countRSetUnverifiedCells,
  rSetDataRowCount,
  type RSetFile,
  type RSetManifestMeta,
  type RSetMaterials,
} from '../../features/export/rset/buildRSet';
import { deriveReviewMode } from '../../features/export/rset/reviewMode';
import { listSchemaVersions, getSchemaFieldsByVersion } from '../../features/schema/schemaRepository';
import { readAllDecisions } from '../../features/verification/decisionRepository';
import { readAllArmStructures } from '../../features/verification/armStructureRepository';
import { ensureChildFolder, uploadTextFile } from '../../lib/google/drive';
import { getCurrentUserEmail, type ProfileDeps } from '../../lib/google/identity';
import type { GoogleApiDeps } from '../../lib/google/types';
import { nowIso8601 } from '../../utils/iso8601';
import { generateUuid } from '../../utils/uuid';
import { downloadTextFile } from '../ui/download';
import { showToast } from '../ui/toast';
import { t } from '../../lib/i18n';
import type { ExportState, Store } from '../store';

/** Drive のプロジェクトフォルダ直下・`exports/` 配下に作る R セット保存先サブフォルダの接頭辞 */
export const RSET_FOLDER_PREFIX = 'rset_';

/** Drive のプロジェクトフォルダ直下に作る CSV 保存先フォルダ名 */
export const EXPORTS_FOLDER_NAME = 'exports';

export interface ExportServiceDeps {
  google: GoogleApiDeps;
  profile: ProfileDeps;
  /** テストで固定するための seam。未指定は crypto.randomUUID */
  newUuid?: () => string;
  /** テストで固定するための seam。未指定は現在時刻の ISO 8601 */
  now?: () => string;
  /**
   * Methods 文案カードの {{tool_version}} 実績値（拡張のバージョン）。
   * 既定は chrome.runtime.getManifest().version（jest / E2E の一部環境には chrome が無いため
   * ガードして null へフォールバックする）
   */
  getToolVersion?: () => string | null;
  /** クリップボードへの書き込み。既定は navigator.clipboard.writeText。テストは fake を注入する */
  writeClipboard?: (text: string) => Promise<void>;
}

function toMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/**
 * 既定の tool_version 取得実装。chrome 拡張ランタイム上でのみ値を返し、
 * それ以外（jest / 一部 E2E 環境）では null（{{tool_version}} は未反映のまま残る）
 */
function defaultGetToolVersion(): string | null {
  if (
    typeof chrome !== 'undefined' &&
    chrome.runtime &&
    typeof chrome.runtime.getManifest === 'function'
  ) {
    return chrome.runtime.getManifest().version;
  }
  return null;
}

/** 配列の重複除去（出現順を維持） */
function dedupe<T>(items: readonly T[]): T[] {
  const seen = new Set<T>();
  const result: T[] = [];
  for (const item of items) {
    if (!seen.has(item)) {
      seen.add(item);
      result.push(item);
    }
  }
  return result;
}

/** provider の表示名変換（docs/methods-boilerplate.md §3: gemini → Gemini 等） */
function providerDisplayName(provider: LlmProviderId): string {
  if (provider === 'openrouter') {
    return 'OpenRouter';
  }
  if (provider === 'openai_compatible') {
    return 'OpenAI-compatible';
  }
  return 'Gemini';
}

/**
 * ExtractionRuns の完了行実績 + Documents から Methods 文案カードの MethodsFacts を組み立てる
 * （§3 プレースホルダ一覧: model_id / provider は run_type=full、n_pilot は run_type=pilot の
 * 対象 study 数、n_scanned は Documents.text_status の集計）
 */
function buildMethodsFacts(
  documents: readonly DocumentRecord[],
  runFacts: readonly MethodsRunFact[],
  toolVersion: string | null,
): MethodsFacts {
  const fullFacts = runFacts.filter((fact) => fact.runType === 'full');
  const modelIds = dedupe(
    fullFacts
      .map((fact) => fact.modelVersion)
      .filter((modelVersion): modelVersion is string => modelVersion !== null && modelVersion !== ''),
  );
  const providerIds = dedupe(
    fullFacts
      .map((fact) => fact.provider)
      .filter((provider): provider is LlmProviderId => provider !== ('' as LlmProviderId)),
  );
  const pilotStudyIds = new Set<string>();
  for (const fact of runFacts) {
    if (fact.runType !== 'pilot') {
      continue;
    }
    for (const studyId of fact.studyIds) {
      pilotStudyIds.add(studyId);
    }
  }
  const scannedDocumentCount = documents.filter(
    (document) => document.textStatus === 'no_text_layer',
  ).length;
  return {
    toolVersion,
    modelIds,
    providers: providerIds.map(providerDisplayName),
    pilotStudyCount: pilotStudyIds.size,
    scannedDocumentCount,
  };
}

/** export スライスだけを差し替える setState ヘルパ（他スライスは維持） */
function patchExport(store: Store, patch: Partial<ExportState>): void {
  store.setState({ export: { ...store.getState().export, ...patch } });
}

/** ISO 8601 → ファイル名用タイムスタンプ（`YYYYMMDD-HHMMSS`。UTC のまま桁だけ落とす） */
export function timestampForFilename(iso: string): string {
  return iso.slice(0, 19).replace(/-/g, '').replace(/:/g, '').replace('T', '-');
}

/**
 * エクスポート素材を読み込み、3 形式の CSV を構築する
 * （初回表示時。読込済みなら no-op、force で強制再取得）
 */
export async function loadExportData(
  store: Store,
  deps: ExportServiceDeps,
  options: { force?: boolean } = {},
): Promise<void> {
  const state = store.getState();
  const project = state.currentProject;
  if (!project || state.export.loading) {
    return;
  }
  if (state.export.built !== null && options.force !== true) {
    return;
  }
  patchExport(store, { loading: true, loadError: null });
  try {
    const spreadsheetId = project.spreadsheetId;
    const [
      documents,
      allStudies,
      studySheet,
      resultsRows,
      evidences,
      decisions,
      armStructureRows,
      runs,
      versions,
      methodsRunFacts,
    ] = await Promise.all([
      readDocuments(spreadsheetId, deps.google),
      readStudies(spreadsheetId, deps.google),
      readStudyDataSheet(spreadsheetId, deps.google),
      readResultsDataRows(spreadsheetId, deps.google),
      readEvidenceRows(spreadsheetId, deps.google),
      readAllDecisions(spreadsheetId, deps.google),
      readAllArmStructures(spreadsheetId, deps.google),
      readRunAuditInfos(spreadsheetId, deps.google),
      listSchemaVersions(spreadsheetId, deps.google),
      readMethodsRunFacts(spreadsheetId, deps.google),
    ]);
    const latest = versions[0]; // listSchemaVersions は降順
    if (latest === undefined) {
      // ガード（dataRows ≥ 1）を満たす以上、通常は起きない防御
      throw new Error(t('export.svcNoSchema'));
    }
    const fields = await getSchemaFieldsByVersion(spreadsheetId, latest.schemaVersion, deps.google);
    // エクスポートはアクティブ study（Documents から参照される study）のみ・作成順（§4.5）
    const studies = resolveActiveStudies(allStudies, documents);
    const built = buildAllExports({
      studies,
      studyRows: studySheet.rows,
      resultsRows,
      decisions,
      evidences,
      runs,
      fields,
    });
    const toolVersion = (deps.getToolVersion ?? defaultGetToolVersion)();
    const methodsFacts = buildMethodsFacts(documents, methodsRunFacts, toolVersion);

    // R セット（issue #60）。素材は generateExport が正確な exported_at で再構築できるよう保持し、
    // ここでの構築結果はサマリ・プレビュー表示専用（rSetMaterials 参照。design-r-export.md §13）
    const rSetMaterials: RSetMaterials = {
      studies,
      studyRows: studySheet.rows,
      resultsRows,
      decisions,
      evidences,
      armStructureRows,
      documentStudyIds: documents.map((document) => document.studyId),
      fields,
    };
    const rSetMeta: RSetManifestMeta = {
      exportedAt: (deps.now ?? nowIso8601)(),
      appVersion: toolVersion ?? '',
      reviewMode: deriveReviewMode(studySheet.rows, resultsRows),
    };
    const rSet = buildRSet(rSetMaterials, rSetMeta);

    patchExport(store, {
      loading: false,
      built,
      rSetMaterials,
      rSet,
      schemaVersion: latest.schemaVersion,
      methodsFacts,
    });
  } catch (err) {
    patchExport(store, { loading: false, loadError: toMessage(err) });
  }
}

/** 形式選択ラジオの切替（生成中はラジオを無効化しているが、防御として no-op にする） */
export function selectExportFormat(store: Store, format: ExportFormat): void {
  if (store.getState().export.generating) {
    return;
  }
  patchExport(store, { format });
}

/** CSV を生成して Drive `exports/` へ保存し、ExportLog に 1 行追記する（従来 3 形式） */
async function generateClassicExport(store: Store, deps: ExportServiceDeps): Promise<void> {
  const state = store.getState();
  const project = state.currentProject;
  const built = state.export.built;
  const schemaVersion = state.export.schemaVersion;
  if (!project || built === null || schemaVersion === null) {
    return;
  }
  // 呼び出し元の generateExport（dispatcher）が format !== 'r_set' のときだけこの関数を呼ぶため、
  // ここでは常に ClassicExportFormat（built のキー）として扱ってよい
  const target = built[state.export.format as ClassicExportFormat];
  patchExport(store, { generating: true, generateError: null, result: null, rSetResult: null });
  try {
    const folder = await ensureChildFolder(EXPORTS_FOLDER_NAME, project.driveFolderId, deps.google);
    const exportedAt = (deps.now ?? nowIso8601)();
    const filename = `${target.format}_${timestampForFilename(exportedAt)}.csv`;
    const file = await uploadTextFile(
      { name: filename, content: target.csv, parentId: folder.id, mimeType: 'text/csv' },
      deps.google,
    );
    const email = await getCurrentUserEmail(deps.profile);
    const entry: ExportLogEntry = {
      exportId: (deps.newUuid ?? generateUuid)(),
      format: target.format,
      schemaVersion,
      studyCount: target.studyCount,
      fileRef: file.webViewLink,
      exportedAt,
      exportedBy: email ?? '',
    };
    await appendExportLog(project.spreadsheetId, entry, deps.google);
    patchExport(store, {
      generating: false,
      result: {
        format: target.format,
        filename,
        fileRef: file.webViewLink,
        rowCount: target.rowCount,
        exportedAt,
        csv: target.csv,
      },
    });
  } catch (err) {
    patchExport(store, { generating: false, generateError: toMessage(err) });
  }
}

/**
 * R セット（issue #60）を生成して Drive `exports/rset_{YYYYMMDD-HHMMSS}/` へ 8 ファイル保存し、
 * ExportLog に 1 行追記する。export_manifest.json の exported_at / app_version / review_mode は
 * ここで解決してから rSetMaterials を再構築する（読込時の rSet はプレビュー専用で、
 * 実際に保存する内容は生成時点の正確な時刻で作り直す。design-r-export.md §13）
 */
async function generateRSetExport(store: Store, deps: ExportServiceDeps): Promise<void> {
  const state = store.getState();
  const project = state.currentProject;
  const materials = state.export.rSetMaterials;
  const schemaVersion = state.export.schemaVersion;
  if (!project || materials === null || schemaVersion === null) {
    return;
  }
  patchExport(store, { generating: true, generateError: null, result: null, rSetResult: null });
  try {
    const exportedAt = (deps.now ?? nowIso8601)();
    const appVersion = (deps.getToolVersion ?? defaultGetToolVersion)() ?? '';
    const reviewMode = deriveReviewMode(materials.studyRows, materials.resultsRows);
    const built = buildRSet(materials, { exportedAt, appVersion, reviewMode });

    const exportsFolder = await ensureChildFolder(EXPORTS_FOLDER_NAME, project.driveFolderId, deps.google);
    const folderName = `${RSET_FOLDER_PREFIX}${timestampForFilename(exportedAt)}`;
    const folder = await ensureChildFolder(folderName, exportsFolder.id, deps.google);
    for (const file of built.files) {
      await uploadTextFile(
        {
          name: file.name,
          content: file.content,
          parentId: folder.id,
          mimeType: file.name.endsWith('.json') ? 'application/json' : 'text/csv',
        },
        deps.google,
      );
    }

    const email = await getCurrentUserEmail(deps.profile);
    // ExportLog は既存列のみで表現する（design-r-export.md §13）: file_ref は 8 ファイルの
    // 保存先サブフォルダの webViewLink、study_count は tab1.csv の行数（確定 annotator を
    // 特定できた study 数。tab1.csv は study 単位 1 行の表のため既存形式の study_count と同じ意味になる。
    // buildRSet は必ず tab1.csv を含む配列を返すため as キャストで扱う）
    const tab1RowCount = (built.files.find((file) => file.name === 'tab1.csv') as RSetFile).rowCount;
    const entry: ExportLogEntry = {
      exportId: (deps.newUuid ?? generateUuid)(),
      format: 'r_set',
      schemaVersion,
      studyCount: tab1RowCount,
      fileRef: folder.webViewLink,
      exportedAt,
      exportedBy: email ?? '',
    };
    await appendExportLog(project.spreadsheetId, entry, deps.google);
    patchExport(store, {
      generating: false,
      rSet: built,
      rSetResult: { folderRef: folder.webViewLink, folderName, exportedAt, built },
    });
  } catch (err) {
    patchExport(store, { generating: false, generateError: toMessage(err) });
  }
}

/** 選択中の形式に応じて分岐する（従来 3 形式 / R セット） */
async function generateExport(store: Store, deps: ExportServiceDeps): Promise<void> {
  if (store.getState().export.format === 'r_set') {
    await generateRSetExport(store, deps);
  } else {
    await generateClassicExport(store, deps);
  }
}

/**
 * 「CSV を生成して Drive に保存」: 選択形式の未検証セルが残っていれば警告ダイアログを開き、
 * なければ即生成する（ui-states.md §3: 続行を経ずに生成は始まらない）
 */
export async function requestExportGenerate(store: Store, deps: ExportServiceDeps): Promise<void> {
  const state = store.getState();
  if (state.export.generating || state.export.confirmingWarning) {
    return;
  }
  if (state.export.format === 'r_set') {
    const rSet = state.export.rSet;
    if (rSet === null || rSetDataRowCount(rSet) === 0) {
      return; // データ行 0 件はボタンを無効化しているが、防御として no-op
    }
    if (countRSetUnverifiedCells(rSet) > 0) {
      patchExport(store, { confirmingWarning: true });
      return;
    }
    await generateExport(store, deps);
    return;
  }
  const built = state.export.built;
  if (built === null) {
    return;
  }
  const target = built[state.export.format];
  if (target.rowCount === 0) {
    return; // データ行 0 件はボタンを無効化しているが、防御として no-op
  }
  if ((target.unverifiedCellCount ?? 0) > 0) {
    patchExport(store, { confirmingWarning: true });
    return;
  }
  await generateExport(store, deps);
}

/** 警告ダイアログの「続行して生成」 */
export async function confirmExportGenerate(store: Store, deps: ExportServiceDeps): Promise<void> {
  if (!store.getState().export.confirmingWarning) {
    return;
  }
  patchExport(store, { confirmingWarning: false });
  await generateExport(store, deps);
}

/** 警告ダイアログの「中止」 */
export function cancelExportWarning(store: Store): void {
  patchExport(store, { confirmingWarning: false });
}

/** 生成完了カードの「ローカル保存」（Drive に保存したものと同一内容の Blob ダウンロード） */
export function downloadExportResult(
  store: Store,
  download: typeof downloadTextFile = downloadTextFile,
): void {
  const state = store.getState().export;
  if (state.format === 'r_set') {
    const rSetResult = state.rSetResult;
    if (rSetResult === null) {
      return;
    }
    // zip 化はしない（要望どおり 8 ファイルを個別ダウンロード）
    for (const file of rSetResult.built.files) {
      download(file.name, file.content, file.name.endsWith('.json') ? 'application/json' : 'text/csv');
    }
    return;
  }
  const result = state.result;
  if (result === null) {
    return;
  }
  download(result.filename, result.csv, 'text/csv');
}

/** Methods 文案カードの言語タブ切替（English / 日本語） */
export function changeMethodsLanguage(store: Store, language: MethodsLanguage): void {
  patchExport(store, { methodsLanguage: language });
}

/** Methods 文案カードのワークフロートグル切替（単一レビュアー / 二重独立） */
export function changeMethodsWorkflow(store: Store, workflow: MethodsWorkflow): void {
  patchExport(store, { methodsWorkflow: workflow });
}

/**
 * Methods 文案カードの「コピー」: 現在の言語 / ワークフロー / 実績値から文案を組み立てて
 * クリップボードへ書き込む（reviewerAdminService.copyReviewInvite と同じ seam 方式）
 */
export async function copyMethodsText(store: Store, deps: ExportServiceDeps): Promise<void> {
  const exportState = store.getState().export;
  if (exportState.methodsFacts === null) {
    return;
  }
  const { text } = buildMethodsText(
    exportState.methodsLanguage,
    exportState.methodsWorkflow,
    exportState.methodsFacts,
  );
  const write = deps.writeClipboard ?? ((value: string) => navigator.clipboard.writeText(value));
  try {
    await write(text);
    showToast(t('export.toastCopied'));
  } catch (err) {
    showToast(t('common.toastCopyFailed', { reason: toMessage(err) }));
  }
}
