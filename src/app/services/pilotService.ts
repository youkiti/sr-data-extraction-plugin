// #/pilot（S6）のサービス層。
// - パイロット実行: extractionService.runExtraction（runType = 'pilot'）を配線する
// - 検証データ束の組み立て / 判定・群構成の永続化は S8 と共有の verificationService へ委譲する
import type { Decision } from '../../domain/decision';
import type { DocumentRecord } from '../../domain/document';
import type { SchemaField } from '../../domain/schemaField';
import { readDocuments } from '../../features/documents/documentRepository';
import { makeLoadDocumentPages } from '../../features/documents/loadDocumentPages';
import { buildAiAnnotationRows } from '../../features/extraction/aiAnnotationRows';
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
 * 初回表示時の既定選択: テキスト層のある文献の先頭 3 本（ui-states.md §3「既定 2〜3 本」）。
 * モデル名は S5 のドラフトフォームの入力があれば引き継ぐ。一度初期化したら再実行しない
 */
export function initPilotSelection(store: Store): void {
  const state = store.getState();
  if (state.pilot.selectionInitialized || state.documents.records === null) {
    return;
  }
  const defaults = state.documents.records
    .filter((doc) => doc.textStatus !== 'no_text_layer')
    .slice(0, 3)
    .map((doc) => doc.documentId);
  patchPilot(store, {
    selectionInitialized: true,
    selectedDocumentIds: defaults,
    model: state.pilot.model === '' ? state.schema.model : state.pilot.model,
  });
}

/** 対象文献チェックボックスの切替（最大 3 本。超過は無視して案内） */
export function togglePilotDocument(store: Store, documentId: string, selected: boolean): void {
  const current = store.getState().pilot.selectedDocumentIds;
  if (!selected) {
    patchPilot(store, { selectedDocumentIds: current.filter((id) => id !== documentId) });
    return;
  }
  if (current.includes(documentId)) {
    return;
  }
  if (current.length >= 3) {
    showToast('パイロット対象は 3 本までです');
    return;
  }
  patchPilot(store, { selectedDocumentIds: [...current, documentId] });
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
  const { selectedDocumentIds, model } = state.pilot;
  if (selectedDocumentIds.length < 1 || selectedDocumentIds.length > 3) {
    patchPilot(store, { runError: '対象文献を 1〜3 本選択してください' });
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
    const documents = await resolveDocuments(store, deps, project.spreadsheetId);
    const targets = documents.filter((doc) => selectedDocumentIds.includes(doc.documentId));
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
      },
    });
    showToast(
      outcome.run.status === 'done'
        ? `パイロット抽出が完了しました（Evidence ${outcome.result.evidence.length} 件）`
        : 'パイロット抽出が部分的に失敗しました。失敗の内訳を確認してください',
    );
    const firstDocumentId = outcome.run.documentIds[0];
    if (firstDocumentId !== undefined) {
      await loadPilotVerification(store, deps, firstDocumentId);
    }
  } catch (err) {
    patchPilot(store, { running: false, progress: null, runError: toMessage(err) });
  }
}

/**
 * 埋め込み検証 UI のデータ束を読み込む（文献切替を含む）。
 * PDF の読み込み失敗は verifyError にせず pdfError として持ち、フォーム側の検証は続行できる
 */
export async function loadPilotVerification(
  store: Store,
  deps: PilotServiceDeps,
  documentId: string,
): Promise<void> {
  const state = store.getState();
  const project = state.currentProject;
  const { run, runFields, evidence } = state.pilot;
  if (!project || run === null || runFields === null || evidence === null) {
    return;
  }
  const documents = await resolveDocuments(store, deps, project.spreadsheetId);
  const document = documents.find((doc) => doc.documentId === documentId);
  if (document === undefined) {
    patchPilot(store, { verifyError: `文献 ${documentId} が見つかりません` });
    return;
  }
  // 前の文献の PDF を破棄してから読み込む（pdfjs のメモリ解放）
  await store.getState().pilot.verification?.disposePdf?.();
  patchPilot(store, {
    verifyLoading: true,
    verifyError: null,
    verifyDocumentId: documentId,
    verification: null,
    studyValues: null,
  });
  try {
    const bundle = await loadVerificationBundle(
      {
        spreadsheetId: project.spreadsheetId,
        document,
        fields: runFields,
        evidence: evidence.filter((item) => item.documentId === documentId),
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
      documentId: verification.document.documentId,
      arms,
      annotator: verification.annotator,
      annotatorType: 'human_with_ai',
      confirmedAt: (deps.now ?? nowIso8601)(),
    },
    deps,
  );
}
