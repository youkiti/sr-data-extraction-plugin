// #/extract（S7）のサービス層（v0.10 study / document）。
// - 対象読み込み: ExtractionRuns から抽出済み study を引き（完了行のみ）、「未抽出の全 study」を既定選択にする
// - 一括実行: extractionService.runExtraction（runType = 'full'）を配線し、
//   study 単位の進捗（features/extraction/studyProgress）へ畳み込む。抽出は study の全文書を連結して 1 回
// - 失敗 study の再試行: runType = 'single_study' で当該 1 study のみ再実行する
import type { DocumentRecord } from '../../domain/document';
import type { StudyRecord } from '../../domain/study';
import type { SchemaField } from '../../domain/schemaField';
import { readDocuments } from '../../features/documents/documentRepository';
import { readStudies } from '../../features/documents/studyRepository';
import {
  buildStudySelection,
  documentsForStudies,
} from '../../features/documents/studySelection';
import { makeLoadDocumentPages } from '../../features/documents/loadDocumentPages';
import { makeLoadDocumentPageImages } from '../../features/documents/loadDocumentPageImages';
import { buildAiAnnotationRows } from '../../features/extraction/aiAnnotationRows';
import {
  filterFieldsBySelection,
  resolveFieldIdsForRun,
  selectedFieldCount,
  toggleCollapsedSection,
  toggleFieldSection,
  toggleFieldSelection,
  type FieldSubsetBadge,
} from '../../features/extraction/fieldSelection';
import {
  createStudyProgressTracker,
  type ExtractStudyRow,
} from '../../features/extraction/studyProgress';
import { planRun } from '../../features/extraction/planRun';
import {
  readRunStudyCoverage,
  type CompletedRunStudySummary,
} from '../../features/extraction/runRepository';
import { getSchemaFieldsByVersion } from '../../features/schema/schemaRepository';
import { ensureChildFolder } from '../../lib/google/drive';
import type { GoogleApiDeps } from '../../lib/google/types';
import { missingApiKeyMessage } from '../../lib/llm/modelCatalog';
import {
  resolveProviderConfig,
  type ProviderConfig,
} from '../../lib/llm/providerFactory';
import { nowIso8601 } from '../../utils/iso8601';
import type { ExtractState, Store } from '../store';
import { showToast } from '../ui/toast';
import { runExtraction, type RunExtractionOutcome } from './extractionService';
import { resolveProtocol, type SchemaServiceDeps } from './schemaService';

/** S5 と同じ依存で足りる（google + loadApiKey + buildProvider。resolveProtocol も共用） */
export type ExtractServiceDeps = SchemaServiceDeps;

function toMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/** extract スライスだけを差し替える setState ヘルパ（他スライスは維持） */
function patchExtract(store: Store, patch: Partial<ExtractState>): void {
  store.setState({ extract: { ...store.getState().extract, ...patch } });
}

/** documents 一覧を解決する（documents スライスに読込済みならそれを使う） */
async function resolveDocuments(
  store: Store,
  google: GoogleApiDeps,
  spreadsheetId: string,
): Promise<readonly DocumentRecord[]> {
  const cached = store.getState().documents.records;
  return cached ?? (await readDocuments(spreadsheetId, google));
}

/** Studies 一覧を解決する（documents スライスに読込済みならそれを使う） */
async function resolveStudies(
  store: Store,
  google: GoogleApiDeps,
  spreadsheetId: string,
): Promise<readonly StudyRecord[]> {
  const cached = store.getState().documents.studies;
  return cached ?? (await readStudies(spreadsheetId, google));
}

/**
 * ExtractionRuns の study カバレッジ（抽出済み = 完了行のみ / 中断 run の残り）を読み込む。
 * 既定選択（未抽出の全 study）・「抽出済み」バッジ・中断バナーの素材。
 * あわせて documents / studies を documents スライスへ読み込む（選択リスト表示のため）。
 * 中断 run の study は抽出済みに数えないため、そのまま既定選択に含まれて再開できる
 */
export async function loadExtractTargets(
  store: Store,
  deps: ExtractServiceDeps,
  options: { force?: boolean } = {},
): Promise<void> {
  const state = store.getState();
  const project = state.currentProject;
  if (!project || state.extract.loading) {
    return;
  }
  if (state.extract.extractedStudyIds !== null && options.force !== true) {
    return;
  }
  patchExtract(store, { loading: true, loadError: null });
  try {
    const coverage = await readRunStudyCoverage(project.spreadsheetId, deps.google);
    const documents = await resolveDocuments(store, deps.google, project.spreadsheetId);
    const studies = await resolveStudies(store, deps.google, project.spreadsheetId);
    const fieldSubsetBadges = await loadFieldSubsetBadges(
      project.spreadsheetId,
      deps.google,
      coverage.latestCompletedRunByStudy,
    );
    // 選択リスト表示のため documents スライスへも反映（未読込だったときのみ）
    const after = store.getState().documents;
    store.setState({
      documents: {
        ...after,
        records: after.records ?? [...documents],
        studies: after.studies ?? [...studies],
      },
    });
    patchExtract(store, {
      loading: false,
      extractedStudyIds: [...coverage.extracted],
      interruptedStudyIds: [...coverage.interrupted],
      fieldSubsetBadges,
    });
  } catch (err) {
    patchExtract(store, { loading: false, loadError: toMessage(err) });
  }
}

/**
 * S7 の「直近 run は n/m 項目」バッジ注記の素材（issue #80）。study_id ごとに、直近の完了 run が
 * サブセット（fieldIds ≠ null）だったときだけ { selected, total } を持つ
 * （全項目 run が直近だった study は注記なし = キーを持たない）。
 * latestByStudy は readRunStudyCoverage が ExtractionRuns を読んだついでに組み立てた値を渡す
 * （バッジ専用に同じタブをもう一度 GET しないため）
 */
async function loadFieldSubsetBadges(
  spreadsheetId: string,
  google: GoogleApiDeps,
  latestByStudy: ReadonlyMap<string, CompletedRunStudySummary>,
): Promise<Record<string, FieldSubsetBadge>> {
  const fieldsByVersion = new Map<number, SchemaField[]>();
  const badges: Record<string, FieldSubsetBadge> = {};
  for (const [studyId, run] of latestByStudy) {
    if (run.fieldIds === null) {
      continue;
    }
    let fields = fieldsByVersion.get(run.schemaVersion);
    if (fields === undefined) {
      fields = await getSchemaFieldsByVersion(spreadsheetId, run.schemaVersion, google);
      fieldsByVersion.set(run.schemaVersion, fields);
    }
    badges[studyId] = { selected: run.fieldIds.length, total: fields.length };
  }
  return badges;
}

/**
 * フィールド選択チェックリストを全選択へリセットする（A-4: 画面入場・対象再読込のたびに
 * 全選択へ戻す。storage への永続化はしない）。bootstrap の `#/extract` ルート入場時と
 * `onReloadTargets` の両方から呼ぶ
 */
export function resetExtractFieldSelection(store: Store): void {
  patchExtract(store, { selectedFieldIds: null, collapsedFieldSections: [] });
}

/** フィールドチェックリストの単一項目切替 */
export function toggleExtractField(store: Store, fieldId: string, selected: boolean): void {
  const { schema, extract } = store.getState();
  const allFieldIds = (schema.currentFields ?? []).map((field) => field.fieldId);
  patchExtract(store, {
    selectedFieldIds: toggleFieldSelection(extract.selectedFieldIds, allFieldIds, fieldId, selected),
  });
}

/** section 見出しの全選択 / 全解除トグル */
export function toggleExtractFieldSection(
  store: Store,
  sectionFieldIds: readonly string[],
  selected: boolean,
): void {
  const { schema, extract } = store.getState();
  const allFieldIds = (schema.currentFields ?? []).map((field) => field.fieldId);
  patchExtract(store, {
    selectedFieldIds: toggleFieldSection(
      extract.selectedFieldIds,
      allFieldIds,
      sectionFieldIds,
      selected,
    ),
  });
}

/** section の折りたたみ切替 */
export function toggleExtractFieldSectionCollapse(store: Store, section: string): void {
  const { extract } = store.getState();
  patchExtract(store, {
    collapsedFieldSections: toggleCollapsedSection(extract.collapsedFieldSections, section),
  });
}

/**
 * 初回表示時の既定選択: まだ一度も抽出されていない全 study（ui-states.md §3）。
 * pdf_native 対応（handoff-scanned-pdf-native-highlight.md §7.4 PR2）によりテキスト層が無い
 * study もページ画像で抽出できるため、hasTextLayer では絞り込まない。
 * モデル名は S6 / S5 の入力があれば引き継ぐ。一度初期化したら再実行しない
 */
export function initExtractSelection(store: Store): void {
  const state = store.getState();
  const { extract, documents } = state;
  if (
    extract.selectionInitialized ||
    documents.records === null ||
    documents.studies === null ||
    extract.extractedStudyIds === null
  ) {
    return;
  }
  const extracted = new Set(extract.extractedStudyIds);
  // ガードで documents.records / studies は非 null
  const defaults = buildStudySelection(documents.studies, documents.records)
    .filter((item) => !extracted.has(item.study.studyId))
    .map((item) => item.study.studyId);
  patchExtract(store, {
    selectionInitialized: true,
    selectedStudyIds: defaults,
    model: extract.model === '' ? state.pilot.model || state.schema.model : extract.model,
  });
}

/** 対象 study チェックボックスの切替（上限なし。抽出済みの再抽出も選択可） */
export function toggleExtractStudy(store: Store, studyId: string, selected: boolean): void {
  const current = store.getState().extract.selectedStudyIds;
  if (!selected) {
    patchExtract(store, { selectedStudyIds: current.filter((id) => id !== studyId) });
    return;
  }
  if (!current.includes(studyId)) {
    patchExtract(store, { selectedStudyIds: [...current, studyId] });
  }
}

export function setExtractModel(store: Store, model: string): void {
  patchExtract(store, { model: model.trim() });
}

/**
 * 「一括抽出を実行」: 入力を検証し、実行確認カード（#extract-confirm）を開く。
 * 実行自体は confirmExtractRun が行う（確認を経ずに実行は始まらない — ui-states.md §3）
 */
export async function requestExtractRun(store: Store, deps: ExtractServiceDeps): Promise<void> {
  const { extract, schema } = store.getState();
  if (extract.running || extract.retryingStudyId !== null) {
    return;
  }
  if (schema.currentFields === null || schema.currentFields.length === 0) {
    patchExtract(store, {
      runError: '確定済みの表のデザインを読み込めていません。表のデザイン画面で確定・再読込してください',
    });
    return;
  }
  if (extract.selectedStudyIds.length === 0) {
    patchExtract(store, { runError: '対象 study を 1 件以上選択してください' });
    return;
  }
  const allFieldIds = schema.currentFields.map((field) => field.fieldId);
  if (selectedFieldCount(extract.selectedFieldIds, allFieldIds) === 0) {
    patchExtract(store, { runError: '抽出項目を 1 つ以上選択してください' });
    return;
  }
  if (extract.model === '') {
    patchExtract(store, { runError: 'モデルを選択してください（「その他」で直接入力も可）' });
    return;
  }
  const providerResolution = await resolveProviderConfig(extract.model, deps);
  if (providerResolution.config === null) {
    patchExtract(store, { runError: missingApiKeyMessage(providerResolution.provider) });
    return;
  }
  patchExtract(store, { runError: null, confirming: true });
}

export function cancelExtractConfirm(store: Store): void {
  patchExtract(store, { confirming: false });
}

/** 抽出 1 回ぶんの共通実行（full / single_study）。進捗を studyRows へ畳み込む */
async function performRun(
  store: Store,
  deps: ExtractServiceDeps,
  params: {
    spreadsheetId: string;
    driveFolderId: string;
    runType: 'full' | 'single_study';
    /** 抽出する study_id 群（進捗トラッカーの分母） */
    studyIds: readonly string[];
    /** studyIds の配下文書すべて（連結・アンカリングの対象） */
    targets: readonly DocumentRecord[];
    /** 選択サブセットで絞り込んだ fields（全選択時は schema.currentFields の全件。issue #80） */
    fields: readonly SchemaField[];
    /** ExtractionRuns へ記録する run 単位のフィールド選択（全選択時は null。issue #80） */
    fieldIds: string[] | null;
    model: string;
    providerConfig: ProviderConfig;
    onStudyRows: (rows: ExtractStudyRow[]) => void;
  },
): Promise<RunExtractionOutcome> {
  const { text: protocolContext } = await resolveProtocol(store, deps, params.spreadsheetId);

  // 進捗リストの分母（study 別バッチ数）を実行前に計画しておく。
  // runExtraction は内部で再計画するが、同一入力なら計画は一致する（extractionService の契約）
  const plan = planRun({
    documents: params.targets,
    fields: params.fields,
    model: params.model,
    protocolContext,
  });
  const tracker = createStudyProgressTracker(params.studyIds, plan.batches);
  params.onStudyRows(tracker.rows());

  // logs/llm フォルダを名前で解決（プロジェクト生成時に作成済み。Meta はトップフォルダ ID のみ保持）
  const logsFolder = await ensureChildFolder('logs', params.driveFolderId, deps.google);
  const llmFolder = await ensureChildFolder('llm', logsFolder.id, deps.google);

  const outcome = await runExtraction(
    {
      spreadsheetId: params.spreadsheetId,
      logsLlmFolderId: llmFolder.id,
      runType: params.runType,
      documents: params.targets,
      fields: params.fields,
      model: params.model,
      protocolContext,
      fieldIds: params.fieldIds,
      onProgress: (progress) => {
        tracker.onProgress(progress);
        patchExtract(store, { progress });
        params.onStudyRows(tracker.rows());
      },
    },
    {
      google: deps.google,
      apiKey: params.providerConfig.apiKey,
      provider: params.providerConfig.provider,
      endpoint: params.providerConfig.endpoint,
      loadDocumentPages: makeLoadDocumentPages(params.targets, deps.google),
      loadDocumentPageImages: makeLoadDocumentPageImages(params.targets, deps.google),
      buildProvider: deps.buildProvider,
      resolveRateLimitPolicy: deps.resolveRateLimitPolicy,
      newUuid: deps.newUuid,
      now: deps.now,
    },
  );

  // 進捗カウントへ反映（evidenceRows / dataRows。ガードと #/home サマリの素材）
  const transfer = buildAiAnnotationRows(outcome.result.evidence, params.fields, {
    runId: outcome.run.runId,
    schemaVersion: outcome.plan.schemaVersion,
    updatedAt: (deps.now ?? nowIso8601)(),
  });
  const after = store.getState();
  store.setState({
    counts: {
      ...after.counts,
      evidenceRows: after.counts.evidenceRows + outcome.result.evidence.length,
      dataRows: after.counts.dataRows + transfer.studyRows.length + transfer.resultsRows.length,
    },
  });
  // 実行済み run の対象 study は以後「抽出済み」（既定選択・バッジの素材を更新）
  const extracted = new Set(after.extract.extractedStudyIds ?? []);
  for (const studyId of params.studyIds) {
    extracted.add(studyId);
  }
  patchExtract(store, { extractedStudyIds: [...extracted] });
  return outcome;
}

/**
 * 一括抽出を実行する（S7 の中核フロー。確認カードの「実行する」から呼ばれる）
 */
export async function runExtract(store: Store, deps: ExtractServiceDeps): Promise<void> {
  const state = store.getState();
  const project = state.currentProject;
  const fields = state.schema.currentFields;
  if (
    !project ||
    state.extract.running ||
    state.extract.retryingStudyId !== null ||
    fields === null
  ) {
    return;
  }
  const providerResolution = await resolveProviderConfig(state.extract.model, deps);
  if (providerResolution.config === null) {
    patchExtract(store, {
      confirming: false,
      runError: missingApiKeyMessage(providerResolution.provider),
    });
    return;
  }
  // 選択サブセットで fields を絞り込む（全選択時は fieldIds: null。issue #80）。
  // performRun 呼び出し前に lastRunFieldIds を確定させる = 成功・失敗にかかわらず
  // 再試行（retryExtractStudy）が同じ選択を引き継げる（A-2）
  const fieldIds = resolveFieldIdsForRun(state.extract.selectedFieldIds);
  const runFields = filterFieldsBySelection(fields, fieldIds);
  patchExtract(store, {
    confirming: false,
    running: true,
    runError: null,
    progress: null,
    run: null,
    rejectedCount: 0,
    armWarnings: [],
    studyRows: [],
    lastRunFieldIds: fieldIds,
  });
  try {
    const records = await resolveDocuments(store, deps.google, project.spreadsheetId);
    const studies = await resolveStudies(store, deps.google, project.spreadsheetId);
    const studyIds = [...state.extract.selectedStudyIds];
    const targets = documentsForStudies(buildStudySelection(studies, records), studyIds);
    const outcome = await performRun(store, deps, {
      spreadsheetId: project.spreadsheetId,
      driveFolderId: project.driveFolderId,
      runType: 'full',
      studyIds,
      targets,
      fields: runFields,
      fieldIds,
      model: state.extract.model,
      providerConfig: providerResolution.config,
      onStudyRows: (rows) => patchExtract(store, { studyRows: rows }),
    });
    patchExtract(store, {
      running: false,
      progress: null,
      run: outcome.run,
      rejectedCount: outcome.result.rejectedItems.length,
      // arm completeness 警告（issue #106。#extract-arm-warnings の素材）
      armWarnings: outcome.result.armWarnings,
    });
    showToast(
      outcome.run.status === 'done'
        ? `一括抽出が完了しました（Evidence ${outcome.result.evidence.length} 件）`
        : '一括抽出が部分的に失敗しました。失敗した study は再試行できます',
    );
  } catch (err) {
    patchExtract(store, { running: false, progress: null, runError: toMessage(err) });
  }
}

/**
 * 失敗した study 1 件を再抽出する（run_type = 'single_study'。ui-states.md §3 の「再試行」）。
 * 対象行だけを実行中表示に差し替え、完了後にその行の結果で置き換える
 */
export async function retryExtractStudy(
  store: Store,
  deps: ExtractServiceDeps,
  studyId: string,
): Promise<void> {
  const state = store.getState();
  const project = state.currentProject;
  const fields = state.schema.currentFields;
  if (
    !project ||
    state.extract.running ||
    state.extract.retryingStudyId !== null ||
    fields === null
  ) {
    return;
  }
  const providerResolution = await resolveProviderConfig(state.extract.model, deps);
  if (providerResolution.config === null) {
    patchExtract(store, { runError: missingApiKeyMessage(providerResolution.provider) });
    return;
  }
  // 対象行を差し替えるヘルパ（他の行の結果表示は維持する）
  const replaceRow = (row: ExtractStudyRow): void => {
    patchExtract(store, {
      studyRows: store
        .getState()
        .extract.studyRows.map((current) => (current.studyId === studyId ? row : current)),
    });
  };
  // A-2: 元 run と同じ field 選択を引き継ぐ（現在のチェックリスト選択ではなく
  // lastRunFieldIds = 直近実行時に実際に使った値を使う）
  const fieldIds = state.extract.lastRunFieldIds;
  const runFields = filterFieldsBySelection(fields, fieldIds);
  patchExtract(store, { retryingStudyId: studyId, runError: null, lastRunFieldIds: fieldIds });
  // 再計画前のプレースホルダ（バッチ数はまだ不明 = 0/0。onStudyRows が実数で置き換える）
  replaceRow({ studyId, status: 'running', completedBatches: 0, totalBatches: 0, detail: null });
  try {
    const records = await resolveDocuments(store, deps.google, project.spreadsheetId);
    const studies = await resolveStudies(store, deps.google, project.spreadsheetId);
    const targets = documentsForStudies(buildStudySelection(studies, records), [studyId]);
    if (targets.length === 0) {
      throw new Error(`study ${studyId} の文書が見つかりません`);
    }
    const outcome = await performRun(store, deps, {
      spreadsheetId: project.spreadsheetId,
      driveFolderId: project.driveFolderId,
      runType: 'single_study',
      studyIds: [studyId],
      targets,
      fields: runFields,
      fieldIds,
      model: state.extract.model,
      providerConfig: providerResolution.config,
      onStudyRows: (rows) => {
        // 単一 study run（studyIds = [studyId]）なので必ず 1 行。
        // 計画時の queued は行差し替えでは「実行中」として見せる
        const row = rows[0] as ExtractStudyRow;
        replaceRow(row.status === 'queued' ? { ...row, status: 'running' } : row);
      },
    });
    patchExtract(store, {
      retryingStudyId: null,
      rejectedCount: store.getState().extract.rejectedCount + outcome.result.rejectedItems.length,
      // 当該 study の arm completeness 警告を再試行の結果で差し替える（issue #106）
      armWarnings: [
        ...store.getState().extract.armWarnings.filter((warning) => warning.studyId !== studyId),
        ...outcome.result.armWarnings,
      ],
    });
    showToast(
      outcome.run.status === 'done'
        ? '再試行が完了しました'
        : '再試行が部分的に失敗しました。失敗の内訳を確認してください',
    );
  } catch (err) {
    replaceRow({
      studyId,
      status: 'failed',
      completedBatches: 0,
      totalBatches: 0,
      detail: toMessage(err),
    });
    patchExtract(store, { retryingStudyId: null, runError: toMessage(err) });
  }
}
