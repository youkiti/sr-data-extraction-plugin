// #/pilot（S6）のサービス層。
// - パイロット実行: extractionService.runExtraction（runType = 'pilot'）を配線する
// - 検証データ束の組み立て / 判定・群構成の永続化は S8 と共有の verificationService へ委譲する
import type { Decision } from '../../domain/decision';
import type { DocumentRecord } from '../../domain/document';
import type { Evidence } from '../../domain/evidence';
import { annotatorTypeForRole } from '../../domain/reviewer';
import type { SchemaField } from '../../domain/schemaField';
import { readDocuments } from '../../features/documents/documentRepository';
import { readStudies } from '../../features/documents/studyRepository';
import {
  buildExtractionCandidates,
  documentsForStudies,
  effectiveStudyIds,
  type StudySelectionItem,
} from '../../features/documents/studySelection';
import { makeLoadDocumentPages } from '../../features/documents/loadDocumentPages';
import { makeLoadDocumentPageImages } from '../../features/documents/loadDocumentPageImages';
import { buildAiAnnotationRows } from '../../features/extraction/aiAnnotationRows';
import { readEvidenceRows } from '../../features/extraction/evidenceRepository';
import {
  filterFieldsBySelection,
  resolveFieldIdsForRun,
  selectedFieldCount,
  toggleCollapsedSection,
  toggleFieldSection,
  toggleFieldSelection,
} from '../../features/extraction/fieldSelection';
import { readPilotRuns } from '../../features/extraction/runRepository';
import { getSchemaFieldsByVersion } from '../../features/schema/schemaRepository';
import { ensureChildFolder } from '../../lib/google/drive';
import type { LLMProvider } from '../../lib/llm/LLMProvider';
import { missingApiKeyMessage } from '../../lib/llm/modelCatalog';
import {
  resolveEffectiveHighAccuracyImages,
  resolveProviderConfig,
  type ProviderConfig,
  type ProviderResolutionDeps,
} from '../../lib/llm/providerFactory';
import type { RateLimitPolicy } from '../../lib/llm/rateLimitPolicy';
import type { VerifyLayoutMode } from '../../lib/storage/settingsStore';
import { nowIso8601 } from '../../utils/iso8601';
import type { PilotState, Store } from '../store';
import { showToast } from '../ui/toast';
import { t } from '../../lib/i18n';
import { runExtraction } from './extractionService';
import { relocateQuote, type RelocateQuoteOutcome } from './relocateQuoteService';
import { resolveProtocol } from './schemaService';
import {
  foldDecisionWriteTokens,
  loadVerificationBundle,
  persistArmConfirmation,
  persistDecisionWrite,
  persistInstanceDeclarations,
  persistVerifyLayoutMode,
  resultsCellKeyOf,
  type QueuedDecisionWrite,
  type VerificationDeps,
} from './verificationService';

export interface PilotServiceDeps extends VerificationDeps, ProviderResolutionDeps {
  /** provider 生成（実行時は lib/llm/providerFactory.createProvider。テストは fake を注入） */
  buildProvider: (config: ProviderConfig) => LLMProvider;
  /** 実効レート制限ポリシー（429 対策）を解決する。runExtraction へそのまま渡す */
  resolveRateLimitPolicy?: () => Promise<RateLimitPolicy>;
}

function toMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/** pilot スライスだけを差し替える setState ヘルパ（他スライスは維持） */
function patchPilot(store: Store, patch: Partial<PilotState>): void {
  store.setState({ pilot: { ...store.getState().pilot, ...patch } });
}

/**
 * 初回表示時の既定選択: テキスト層のある study の先頭 3 件（ui-states.md §3「既定 2〜3 本」・v0.10）。
 * モデル名は S5 のドラフトフォームの入力があれば引き継ぐ。一度初期化したら再実行しない
 */
export function initPilotSelection(store: Store): void {
  const state = store.getState();
  if (
    state.pilot.selectionInitialized ||
    state.documents.records === null ||
    state.documents.studies === null
  ) {
    return;
  }
  // ガードで documents.records / studies は非 null。除外文書は既定選択の候補から外す（issue #181）
  const defaults = buildExtractionCandidates(state.documents.studies, state.documents.records)
    .filter((item) => item.hasTextLayer)
    .slice(0, 3)
    .map((item) => item.study.studyId);
  patchPilot(store, {
    selectionInitialized: true,
    selectedStudyIds: defaults,
    model: state.pilot.model === '' ? state.schema.model : state.pilot.model,
  });
}

/** 対象 study チェックボックスの切替（最大 3 study。超過は無視して案内） */
export function togglePilotStudy(store: Store, studyId: string, selected: boolean): void {
  const current = store.getState().pilot.selectedStudyIds;
  if (!selected) {
    patchPilot(store, { selectedStudyIds: current.filter((id) => id !== studyId) });
    return;
  }
  if (current.includes(studyId)) {
    return;
  }
  if (current.length >= 3) {
    showToast(t('pilot.toastMax3'));
    return;
  }
  patchPilot(store, { selectedStudyIds: [...current, studyId] });
}

export function setPilotModel(store: Store, model: string): void {
  patchPilot(store, { model: model.trim() });
}

/**
 * フィールド選択チェックリストを全選択へリセットする（A-4: 画面入場のたびに全選択へ戻す。
 * storage への永続化はしない）。bootstrap の `#/pilot` ルート入場時に呼ぶ。
 * 高精度読み取りモード（issue #176）のトグルも同じ理由で毎回 false へ戻す
 * （前回オンにしたことを忘れたまま高コストな run を打たせない設計）
 */
export function resetPilotFieldSelection(store: Store): void {
  patchPilot(store, {
    selectedFieldIds: null,
    collapsedFieldSections: [],
    highAccuracyImages: false,
  });
}

/** 高精度読み取りモード（issue #176）のトグル切替 */
export function setPilotHighAccuracyImages(store: Store, enabled: boolean): void {
  patchPilot(store, { highAccuracyImages: enabled });
}

/** フィールドチェックリストの単一項目切替 */
export function togglePilotField(store: Store, fieldId: string, selected: boolean): void {
  const { schema, pilot } = store.getState();
  const allFieldIds = (schema.currentFields ?? []).map((field) => field.fieldId);
  patchPilot(store, {
    selectedFieldIds: toggleFieldSelection(pilot.selectedFieldIds, allFieldIds, fieldId, selected),
  });
}

/** section 見出しの全選択 / 全解除トグル */
export function togglePilotFieldSection(
  store: Store,
  sectionFieldIds: readonly string[],
  selected: boolean,
): void {
  const { schema, pilot } = store.getState();
  const allFieldIds = (schema.currentFields ?? []).map((field) => field.fieldId);
  patchPilot(store, {
    selectedFieldIds: toggleFieldSection(
      pilot.selectedFieldIds,
      allFieldIds,
      sectionFieldIds,
      selected,
    ),
  });
}

/** section の折りたたみ切替 */
export function togglePilotFieldSectionCollapse(store: Store, section: string): void {
  const { pilot } = store.getState();
  patchPilot(store, {
    collapsedFieldSections: toggleCollapsedSection(pilot.collapsedFieldSections, section),
  });
}

/** documents 一覧を解決する（documents スライスに読込済みならそれを使う） */
async function resolveDocuments(
  store: Store,
  deps: PilotServiceDeps,
  spreadsheetId: string,
): Promise<readonly DocumentRecord[]> {
  const cached = store.getState().documents.records;
  return cached ?? (await readDocuments(spreadsheetId, deps.google));
}

/**
 * Studies 一覧（抽出候補。除外文書は対象から外す。issue #181）を解決する
 * （documents スライスに読込済みならそれを使う）
 */
async function resolveStudies(
  store: Store,
  deps: PilotServiceDeps,
  spreadsheetId: string,
): Promise<StudySelectionItem[]> {
  const cachedStudies = store.getState().documents.studies;
  const studies = cachedStudies ?? (await readStudies(spreadsheetId, deps.google));
  const records = await resolveDocuments(store, deps, spreadsheetId);
  return buildExtractionCandidates(studies, records);
}

/**
 * パイロット抽出を実行する（S6 の中核フロー）。
 * 完了後は最初の抽出済み文献の検証データを読み込み、埋め込み検証 UI へつなぐ
 */
export async function runPilot(store: Store, deps: PilotServiceDeps): Promise<void> {
  const state = store.getState();
  const project = state.currentProject;
  if (!project || state.pilot.running) {
    return;
  }
  const fields = state.schema.currentFields;
  if (fields === null || fields.length === 0) {
    patchPilot(store, {
      runError: t('extraction.errNoSchema'),
    });
    return;
  }
  const { selectedStudyIds, model, selectedFieldIds } = state.pilot;
  // 除外済み study は候補から外して検証する（issue #181 PR レビュー対応）。
  // S6/S7 表示後に S3 で除外されると selectedStudyIds に除外済み ID が残るため
  const candidates = buildExtractionCandidates(
    state.documents.studies ?? [],
    state.documents.records ?? [],
  );
  const targetStudyIds = effectiveStudyIds(candidates, selectedStudyIds);
  if (targetStudyIds.length < 1 || targetStudyIds.length > 3) {
    patchPilot(store, { runError: t('pilot.errStudies') });
    return;
  }
  const allFieldIds = fields.map((field) => field.fieldId);
  if (selectedFieldCount(selectedFieldIds, allFieldIds) === 0) {
    patchPilot(store, { runError: t('extraction.errNoFields') });
    return;
  }
  if (model === '') {
    patchPilot(store, { runError: t('extraction.errNoModel') });
    return;
  }
  const providerResolution = await resolveProviderConfig(model, deps);
  if (providerResolution.config === null) {
    patchPilot(store, { runError: missingApiKeyMessage(providerResolution.provider) });
    return;
  }
  // 選択サブセットで fields を絞り込む（全選択時は fieldIds: null。issue #80）。
  // 埋め込み検証 UI（runFields）は絞り込まず表のデザインの全項目のまま渡す（幽霊セルと同じ扱いで
  // 未抽出項目も人間が手動で判定できるようにするため。絞り込むのは LLM 呼び出し側の fields のみ）
  const fieldIds = resolveFieldIdsForRun(selectedFieldIds);
  const extractionFields = filterFieldsBySelection(fields, fieldIds);
  // 高精度読み取りモード（issue #176）: UI は非対応プロバイダで選択自体を disabled にするが、
  // ここでも二重に効かせる（モデル変更後の古い選択が残っていても、非対応プロバイダには送らない）
  const highAccuracyImages = resolveEffectiveHighAccuracyImages(model, state.pilot.highAccuracyImages);

  patchPilot(store, { running: true, runError: null, progress: null });
  try {
    // 選択 study の全文書を連結対象にする（study 単位抽出。§4.3）
    const selection = await resolveStudies(store, deps, project.spreadsheetId);
    const targets = documentsForStudies(selection, targetStudyIds);
    const { text: protocolContext } = await resolveProtocol(store, deps, project.spreadsheetId);

    // logs/llm フォルダを名前で解決（プロジェクト生成時に作成済み。Meta はトップフォルダ ID のみ保持）
    const logsFolder = await ensureChildFolder('logs', project.driveFolderId, deps.google);
    const llmFolder = await ensureChildFolder('llm', logsFolder.id, deps.google);

    const outcome = await runExtraction(
      {
        spreadsheetId: project.spreadsheetId,
        logsLlmFolderId: llmFolder.id,
        runType: 'pilot',
        documents: targets,
        fields: extractionFields,
        model,
        protocolContext,
        fieldIds,
        highAccuracyImages,
        onProgress: (progress) => patchPilot(store, { progress }),
      },
      {
        google: deps.google,
        apiKey: providerResolution.config.apiKey,
        provider: providerResolution.config.provider,
        endpoint: providerResolution.config.endpoint,
        loadDocumentPages: makeLoadDocumentPages(targets, deps.google),
        loadDocumentPageImages: makeLoadDocumentPageImages(targets, deps.google),
        buildProvider: deps.buildProvider,
        resolveRateLimitPolicy: deps.resolveRateLimitPolicy,
        newUuid: deps.newUuid,
        now: deps.now,
      },
    );

    // 進捗カウントへ反映（pilotRuns / evidenceRows / dataRows。ガードと #/home サマリの素材）
    const transfer = buildAiAnnotationRows(outcome.result.evidence, fields, {
      runId: outcome.run.runId,
      schemaVersion: outcome.plan.schemaVersion,
      updatedAt: (deps.now ?? nowIso8601)(),
    });
    const after = store.getState();
    store.setState({
      counts: {
        ...after.counts,
        pilotRuns: after.counts.pilotRuns + 1,
        evidenceRows: after.counts.evidenceRows + outcome.result.evidence.length,
        dataRows:
          after.counts.dataRows + transfer.studyRows.length + transfer.resultsRows.length,
      },
      pilot: {
        ...after.pilot,
        running: false,
        progress: null,
        run: outcome.run,
        runFields: [...fields],
        evidence: outcome.result.evidence,
        batchFailures: outcome.result.batchFailures,
        rejectedCount: outcome.result.rejectedItems.length,
        // 完了した run を履歴の先頭（最新）へ足し、自動読込済み扱いにする
        history: [outcome.run, ...(after.pilot.history ?? [])],
        historyInitialized: true,
      },
    });
    showToast(
      outcome.run.status === 'done'
        ? t('pilot.toastDone', { n: outcome.result.evidence.length })
        : t('pilot.toastPartial'),
    );
    // 最初の抽出 study を検証 UI に開く（配下の全文書を連結表示。v0.10 フェーズ 3）
    const firstStudyId = outcome.run.studyIds[0];
    if (firstStudyId !== undefined) {
      await loadPilotVerification(store, deps, firstStudyId);
    }
  } catch (err) {
    patchPilot(store, { running: false, progress: null, runError: toMessage(err) });
  }
}

/**
 * これまでのパイロット結果の履歴を読み込む（S6 初回表示 + エラー再読込）。
 * 読込済み（history 非 null）は force 指定がない限り no-op（他サービスの load* と同じ規約）
 */
export async function loadPilotHistory(
  store: Store,
  deps: PilotServiceDeps,
  options: { force?: boolean } = {},
): Promise<void> {
  const state = store.getState();
  const project = state.currentProject;
  if (!project || state.pilot.historyLoading) {
    return;
  }
  if (state.pilot.history !== null && options.force !== true) {
    return;
  }
  patchPilot(store, { historyLoading: true, historyError: null });
  try {
    const history = await readPilotRuns(project.spreadsheetId, deps.google);
    patchPilot(store, { historyLoading: false, history });
  } catch (err) {
    patchPilot(store, { historyLoading: false, historyError: toMessage(err) });
  }
}

/**
 * 起動後に最新のパイロット結果を一度だけ自動読込する（既存データがあれば「最初から」にしない）。
 * 履歴未読込・読込失敗（history === null）のときは初期化フラグを立てず、再読込でやり直せるようにする。
 * このセッションで既に run を持っている（実行直後など）ときは上書きしない
 */
export async function autoLoadLatestPilotRun(
  store: Store,
  deps: PilotServiceDeps,
): Promise<void> {
  const { pilot } = store.getState();
  if (pilot.historyInitialized || pilot.history === null) {
    return;
  }
  patchPilot(store, { historyInitialized: true });
  const latest = pilot.history[0];
  if (latest === undefined || pilot.run !== null) {
    return;
  }
  await loadPilotRun(store, deps, latest.runId);
}

/**
 * 履歴の特定 run を読み込んで結果サマリ + 埋め込み検証 UI を復元する（S6「履歴から選択」）。
 * Evidence を当該 run で絞り、run の schema_version の項目を解決してから最初の文献の検証を開く
 */
export async function loadPilotRun(
  store: Store,
  deps: PilotServiceDeps,
  runId: string,
): Promise<void> {
  const state = store.getState();
  const project = state.currentProject;
  if (!project || state.pilot.running || state.pilot.loadingRunId !== null) {
    return;
  }
  const run = state.pilot.history?.find((candidate) => candidate.runId === runId);
  if (run === undefined) {
    patchPilot(store, { historyError: t('pilot.errRunNotFound', { id: runId }) });
    return;
  }
  // 表示中の PDF を破棄してから読み込む（pdfjs のメモリ解放）
  await state.pilot.verification?.disposePdf?.();
  patchPilot(store, {
    loadingRunId: runId,
    historyError: null,
    runError: null,
    run: null,
    runFields: null,
    evidence: null,
    // 履歴 run はバッチ失敗の内訳を再構成できないため空にする（サマリは run.status で表示）
    batchFailures: [],
    rejectedCount: 0,
    verifyStudyId: null,
    verification: null,
    verifyLoading: false,
    verifyError: null,
    studyValues: null,
  });
  try {
    const allEvidence = await readEvidenceRows(project.spreadsheetId, deps.google);
    const fields = await getSchemaFieldsByVersion(
      project.spreadsheetId,
      run.schemaVersion,
      deps.google,
    );
    patchPilot(store, {
      loadingRunId: null,
      run,
      runFields: fields,
      evidence: allEvidence.filter((item) => item.runId === runId),
    });
    // run は study 単位（studyIds）。最初の study を検証 UI に開く（配下の全文書を連結表示）
    const firstStudyId = run.studyIds[0];
    if (firstStudyId !== undefined) {
      await loadPilotVerification(store, deps, firstStudyId);
    }
  } catch (err) {
    patchPilot(store, { loadingRunId: null, historyError: toMessage(err) });
  }
}

/**
 * 埋め込み検証 UI のデータ束を読み込む（study 切替を含む。v0.10 フェーズ 3 = study 単位）。
 * study 配下の全文書を連結して開き、根拠クリックで出所 PDF へ切替わる。
 * PDF の読み込み失敗は verifyError にせず pdfError として持ち、フォーム側の検証は続行できる
 */
export async function loadPilotVerification(
  store: Store,
  deps: PilotServiceDeps,
  studyId: string,
): Promise<void> {
  const state = store.getState();
  const project = state.currentProject;
  const { run, runFields, evidence } = state.pilot;
  if (!project || run === null || runFields === null || evidence === null) {
    return;
  }
  const selection = await resolveStudies(store, deps, project.spreadsheetId);
  const item = selection.find((candidate) => candidate.study.studyId === studyId);
  if (item === undefined) {
    patchPilot(store, { verifyError: t('pilot.errStudyNotFound', { id: studyId }) });
    return;
  }
  // 前の study の PDF を破棄してから読み込む（pdfjs のメモリ解放）
  await store.getState().pilot.verification?.disposePdf?.();
  patchPilot(store, {
    verifyLoading: true,
    verifyError: null,
    verifyStudyId: studyId,
    verification: null,
    studyValues: null,
    // 楽観ロックのトークン・競合バナーもデータ束読込のたびにリセットする（issue #64）
    studyRowUpdatedAt: null,
    resultsRowUpdatedAt: {},
    conflictMessage: null,
  });
  try {
    const bundle = await loadVerificationBundle(
      {
        spreadsheetId: project.spreadsheetId,
        study: item.study,
        documents: item.documents,
        fields: runFields,
        evidence: evidence.filter((row) => row.studyId === studyId),
        schemaVersion: run.schemaVersion,
        annotatorType: annotatorTypeForRole(state.role.role ?? 'owner'),
      },
      deps,
    );
    patchPilot(store, {
      verifyLoading: false,
      verification: bundle.verification,
      studyValues: bundle.studyValues,
      layoutMode: bundle.layoutMode,
      studyRowUpdatedAt: bundle.studyRowUpdatedAt,
      resultsRowUpdatedAt: bundle.resultsRowUpdatedAt,
    });
  } catch (err) {
    patchPilot(store, { verifyLoading: false, verifyError: toMessage(err) });
  }
}

/**
 * 検証パネルのレイアウトモードを切替える（`#verify-layout-toggle`。パネル側は楽観反映済み）。
 * store へ反映しつつ settingsStore へ永続化する（S6 / S8 で設定を共有）
 */
export async function setPilotLayoutMode(
  store: Store,
  deps: PilotServiceDeps,
  mode: VerifyLayoutMode,
): Promise<void> {
  patchPilot(store, { layoutMode: mode });
  await persistVerifyLayoutMode(mode, deps);
}

/**
 * 検証パネルの判定 1 操作を永続化する（requirements.md §4.2「判定ごとに即時書き込み」）。
 * パネル側は楽観更新済みのため、失敗時はオフラインキューへ退避して後で再送する
 */
export async function persistPilotDecision(
  store: Store,
  deps: PilotServiceDeps,
  decision: Decision,
): Promise<void> {
  const state = store.getState();
  const project = state.currentProject;
  if (!project) {
    return;
  }
  const field = state.pilot.runFields?.find(
    (candidate: SchemaField) => candidate.fieldId === decision.fieldId,
  );
  if (field === undefined) {
    showToast(t('verify.errFieldNotInSchema', { id: decision.fieldId }));
    return;
  }
  let studyValues: Record<string, string | null> | null = null;
  if (field.entityLevel === 'study') {
    studyValues = { ...(state.pilot.studyValues ?? {}), [field.fieldName]: decision.value };
    patchPilot(store, { studyValues });
  }
  const write: QueuedDecisionWrite = {
    decision,
    fieldName: field.fieldName,
    entityLevel: field.entityLevel,
    studyValues,
  };
  // 楽観ロックの期待値（issue #64）: study 項目は自分の StudyData 行の updated_at、
  // それ以外は自分の該当 ResultsData セルの updated_at（無ければ「行が無い」を期待）
  const expectedUpdatedAt =
    field.entityLevel === 'study'
      ? state.pilot.studyRowUpdatedAt
      : (state.pilot.resultsRowUpdatedAt[resultsCellKeyOf(decision.entityKey, decision.fieldId)] ??
        null);
  const result = await persistDecisionWrite(project.spreadsheetId, write, deps, expectedUpdatedAt);
  if (result.status === 'queued') {
    patchPilot(store, { queuedDecisions: store.getState().pilot.queuedDecisions + 1 });
  } else if (result.status === 'conflict') {
    patchPilot(store, { conflictMessage: result.message });
  } else {
    const current = store.getState().pilot;
    const folded = foldDecisionWriteTokens(result.written, {
      studyRowUpdatedAt: current.studyRowUpdatedAt,
      resultsRowUpdatedAt: current.resultsRowUpdatedAt,
    });
    patchPilot(store, {
      queuedDecisions: result.remainingCount,
      studyRowUpdatedAt: folded.studyRowUpdatedAt,
      resultsRowUpdatedAt: folded.resultsRowUpdatedAt,
    });
  }
}

/**
 * 埋め込み検証パネルの群構成確定を永続化し、次回読み込み用に楽観結果をスライスへ反映する。
 * パネル側は確定を楽観反映済みのため、失敗時はトーストのみ（verificationService 側で表示）
 */
export async function persistPilotArmConfirmation(
  store: Store,
  deps: PilotServiceDeps,
  arms: readonly { armKey: string; armName: string }[],
): Promise<void> {
  const state = store.getState();
  const project = state.currentProject;
  const verification = state.pilot.verification;
  if (!project || verification === null) {
    return;
  }
  await persistArmConfirmation(
    project.spreadsheetId,
    {
      studyId: verification.study.studyId,
      arms,
      annotator: verification.annotator,
      annotatorType: verification.annotatorType,
      confirmedAt: (deps.now ?? nowIso8601)(),
    },
    deps,
  );
}

/**
 * 埋め込み検証パネルで人間が追加した entity インスタンスを Decisions へ追記する。
 * ResultsData は各セルの判定時に保存する。
 */
export async function persistPilotInstanceDeclarations(
  store: Store,
  deps: PilotServiceDeps,
  decisions: readonly Decision[],
): Promise<void> {
  const project = store.getState().currentProject;
  if (!project) {
    return;
  }
  await persistInstanceDeclarations(project.spreadsheetId, decisions, deps);
}

/**
 * 埋め込み検証パネルの「AI で再特定」ボタン（issue #94）。relocateQuoteService.relocateQuote へ
 * 委譲する薄いラッパで、store から spreadsheetId / Drive フォルダ / 対象項目 / 出所文書の
 * extracted_texts を解決するだけの責務を持つ（LLM 呼び出し・アンカリング・Evidence 追記の
 * 実体は relocateQuoteService 側）。verificationPanel.ts はこの戻り値を await して
 * ローカルの楽観反映（ハイライト差し替え・ジャンプ）を行う
 */
export async function persistPilotRelocateQuote(
  store: Store,
  deps: PilotServiceDeps,
  evidence: Evidence,
): Promise<RelocateQuoteOutcome> {
  const state = store.getState();
  const project = state.currentProject;
  const verification = state.pilot.verification;
  if (!project || verification === null) {
    return { status: 'not_found', message: t('pilot.relocateNotLoaded') };
  }
  const field = verification.fields.find((candidate) => candidate.fieldId === evidence.fieldId);
  const documentView = verification.documents.find(
    (view) => view.document.documentId === evidence.documentId,
  );
  if (field === undefined || documentView === undefined) {
    return { status: 'not_found', message: t('pilot.relocateNoTarget') };
  }
  return relocateQuote(
    {
      spreadsheetId: project.spreadsheetId,
      driveFolderId: project.driveFolderId,
      evidence,
      field,
      documentPages: documentView.extractedPages,
    },
    deps,
  );
}
