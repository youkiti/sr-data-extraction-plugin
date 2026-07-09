// #/pilot（S6）のサービス層。
// - パイロット実行: extractionService.runExtraction（runType = 'pilot'）を配線する
// - 検証データ束の組み立て / 判定・群構成の永続化は S8 と共有の verificationService へ委譲する
import type { Decision } from '../../domain/decision';
import type { DocumentRecord } from '../../domain/document';
import type { SchemaField } from '../../domain/schemaField';
import { readDocuments } from '../../features/documents/documentRepository';
import { readStudies } from '../../features/documents/studyRepository';
import {
  buildStudySelection,
  documentsForStudies,
  type StudySelectionItem,
} from '../../features/documents/studySelection';
import { makeLoadDocumentPages } from '../../features/documents/loadDocumentPages';
import { buildAiAnnotationRows } from '../../features/extraction/aiAnnotationRows';
import { readEvidenceRows } from '../../features/extraction/evidenceRepository';
import { readPilotRuns } from '../../features/extraction/runRepository';
import { getSchemaFieldsByVersion } from '../../features/schema/schemaRepository';
import { ensureChildFolder } from '../../lib/google/drive';
import type { LlmProviderId } from '../../domain/llmApiLog';
import type { LLMProvider } from '../../lib/llm/LLMProvider';
import { missingApiKeyMessage } from '../../lib/llm/modelCatalog';
import { resolveProviderId, type ProviderConfig } from '../../lib/llm/providerFactory';
import { nowIso8601 } from '../../utils/iso8601';
import type { PilotState, Store } from '../store';
import { showToast } from '../ui/toast';
import { runExtraction } from './extractionService';
import { resolveProtocol } from './schemaService';
import {
  loadVerificationBundle,
  persistArmConfirmation,
  persistDecisionWrite,
  persistInstanceDeclarations,
  type QueuedDecisionWrite,
  type VerificationDeps,
} from './verificationService';

export interface PilotServiceDeps extends VerificationDeps {
  /** BYOK の API キーをプロバイダ別に解決する（既定は lib/storage/secretsStore の各 load 関数） */
  loadApiKey: (provider: LlmProviderId) => Promise<string | null>;
  /** provider 生成（実行時は lib/llm/providerFactory.createProvider。テストは fake を注入） */
  buildProvider: (config: ProviderConfig) => LLMProvider;
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
  // ガードで documents.records / studies は非 null
  const defaults = buildStudySelection(state.documents.studies, state.documents.records)
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
    showToast('パイロット対象は 3 study までです');
    return;
  }
  patchPilot(store, { selectedStudyIds: [...current, studyId] });
}

export function setPilotModel(store: Store, model: string): void {
  patchPilot(store, { model: model.trim() });
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

/** Studies 一覧を解決する（documents スライスに読込済みならそれを使う） */
async function resolveStudies(
  store: Store,
  deps: PilotServiceDeps,
  spreadsheetId: string,
): Promise<StudySelectionItem[]> {
  const cachedStudies = store.getState().documents.studies;
  const studies = cachedStudies ?? (await readStudies(spreadsheetId, deps.google));
  const records = await resolveDocuments(store, deps, spreadsheetId);
  return buildStudySelection(studies, records);
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
      runError: '確定済みスキーマを読み込めていません。#/schema で確定・再読込してください',
    });
    return;
  }
  const { selectedStudyIds, model } = state.pilot;
  if (selectedStudyIds.length < 1 || selectedStudyIds.length > 3) {
    patchPilot(store, { runError: '対象 study を 1〜3 件選択してください' });
    return;
  }
  if (model === '') {
    patchPilot(store, { runError: 'モデルを選択してください（「その他」で直接入力も可）' });
    return;
  }
  const apiKey = await deps.loadApiKey(resolveProviderId(model));
  if (apiKey === null) {
    patchPilot(store, { runError: missingApiKeyMessage(resolveProviderId(model)) });
    return;
  }

  patchPilot(store, { running: true, runError: null, progress: null });
  try {
    // 選択 study の全文書を連結対象にする（study 単位抽出。§4.3）
    const selection = await resolveStudies(store, deps, project.spreadsheetId);
    const targets = documentsForStudies(selection, selectedStudyIds);
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
        fields,
        model,
        protocolContext,
        onProgress: (progress) => patchPilot(store, { progress }),
      },
      {
        google: deps.google,
        apiKey,
        loadDocumentPages: makeLoadDocumentPages(targets, deps.google),
        buildProvider: deps.buildProvider,
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
        ? `パイロット抽出が完了しました（Evidence ${outcome.result.evidence.length} 件）`
        : 'パイロット抽出が部分的に失敗しました。失敗の内訳を確認してください',
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
    patchPilot(store, { historyError: `run ${runId} が履歴に見つかりません` });
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
    patchPilot(store, { verifyError: `study ${studyId} が見つかりません` });
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
      },
      deps,
    );
    patchPilot(store, {
      verifyLoading: false,
      verification: bundle.verification,
      studyValues: bundle.studyValues,
    });
  } catch (err) {
    patchPilot(store, { verifyLoading: false, verifyError: toMessage(err) });
  }
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
    showToast(`判定を保存できません: field_id ${decision.fieldId} がスキーマにありません`);
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
  const result = await persistDecisionWrite(project.spreadsheetId, write, deps);
  if (result.status === 'queued') {
    patchPilot(store, { queuedDecisions: store.getState().pilot.queuedDecisions + 1 });
  } else {
    patchPilot(store, { queuedDecisions: result.remainingCount });
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
      annotatorType: 'human_with_ai',
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
