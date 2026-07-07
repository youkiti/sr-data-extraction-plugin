// #/extract（S7）のサービス層。
// - 対象読み込み: ExtractionRuns から抽出済み study を引き、その study に属する document を
//   「抽出済み」とみなして「未抽出の全件」を既定選択にする（フェーズ 1 は 1 study = 1 文書）
// - 一括実行: extractionService.runExtraction（runType = 'full'）を配線し、
//   document 単位の進捗（features/extraction/docProgress）へ畳み込む
// - 失敗文献の再試行: runType = 'single_study' で当該 1 本のみ再実行する
import type { DocumentRecord } from '../../domain/document';
import type { SchemaField } from '../../domain/schemaField';
import { readDocuments } from '../../features/documents/documentRepository';
import { makeLoadDocumentPages } from '../../features/documents/loadDocumentPages';
import { buildAiAnnotationRows } from '../../features/extraction/aiAnnotationRows';
import {
  createDocProgressTracker,
  type ExtractDocRow,
} from '../../features/extraction/docProgress';
import { planRun } from '../../features/extraction/planRun';
import { readRunStudyCoverage } from '../../features/extraction/runRepository';
import { ensureChildFolder } from '../../lib/google/drive';
import type { GoogleApiDeps } from '../../lib/google/types';
import { missingApiKeyMessage } from '../../lib/llm/modelCatalog';
import { resolveProviderId } from '../../lib/llm/providerFactory';
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

/**
 * ExtractionRuns の study カバレッジ（抽出済み = 完了行のみ / 中断 run の残り）を読み込み、
 * 所属 document へ写像する。既定選択（未抽出の全件）・「抽出済み」バッジ・中断バナーの素材。
 * カバレッジは study_ids で記録されるため、documents を突き合わせて document 単位へ落とす
 * （フェーズ 1 は 1 study = 1 文書）。中断 run の study は抽出済みに数えないため、
 * その document が既定選択に含まれてそのまま再開できる
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
  if (state.extract.extractedDocumentIds !== null && options.force !== true) {
    return;
  }
  patchExtract(store, { loading: true, loadError: null });
  try {
    const coverage = await readRunStudyCoverage(project.spreadsheetId, deps.google);
    const documents = await resolveDocuments(store, deps.google, project.spreadsheetId);
    patchExtract(store, {
      loading: false,
      extractedDocumentIds: documents
        .filter((doc) => coverage.extracted.has(doc.studyId))
        .map((doc) => doc.documentId),
      interruptedDocumentIds: documents
        .filter((doc) => coverage.interrupted.has(doc.studyId))
        .map((doc) => doc.documentId),
    });
  } catch (err) {
    patchExtract(store, { loading: false, loadError: toMessage(err) });
  }
}

/**
 * 初回表示時の既定選択: テキスト層があり、かつまだ一度も抽出されていない全件（ui-states.md §3）。
 * モデル名は S6 / S5 の入力があれば引き継ぐ。一度初期化したら再実行しない
 */
export function initExtractSelection(store: Store): void {
  const state = store.getState();
  const { extract, documents } = state;
  if (
    extract.selectionInitialized ||
    documents.records === null ||
    extract.extractedDocumentIds === null
  ) {
    return;
  }
  const extracted = new Set(extract.extractedDocumentIds);
  const defaults = documents.records
    .filter((doc) => doc.textStatus !== 'no_text_layer' && !extracted.has(doc.documentId))
    .map((doc) => doc.documentId);
  patchExtract(store, {
    selectionInitialized: true,
    selectedDocumentIds: defaults,
    model: extract.model === '' ? state.pilot.model || state.schema.model : extract.model,
  });
}

/** 対象文献チェックボックスの切替（上限なし。抽出済みの再抽出も選択可） */
export function toggleExtractDocument(store: Store, documentId: string, selected: boolean): void {
  const current = store.getState().extract.selectedDocumentIds;
  if (!selected) {
    patchExtract(store, { selectedDocumentIds: current.filter((id) => id !== documentId) });
    return;
  }
  if (!current.includes(documentId)) {
    patchExtract(store, { selectedDocumentIds: [...current, documentId] });
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
  if (extract.running || extract.retryingDocumentId !== null) {
    return;
  }
  if (schema.currentFields === null || schema.currentFields.length === 0) {
    patchExtract(store, {
      runError: '確定済みスキーマを読み込めていません。#/schema で確定・再読込してください',
    });
    return;
  }
  if (extract.selectedDocumentIds.length === 0) {
    patchExtract(store, { runError: '対象文献を 1 本以上選択してください' });
    return;
  }
  if (extract.model === '') {
    patchExtract(store, { runError: 'モデルを選択してください（「その他」で直接入力も可）' });
    return;
  }
  if ((await deps.loadApiKey(resolveProviderId(extract.model))) === null) {
    patchExtract(store, { runError: missingApiKeyMessage(resolveProviderId(extract.model)) });
    return;
  }
  patchExtract(store, { runError: null, confirming: true });
}

export function cancelExtractConfirm(store: Store): void {
  patchExtract(store, { confirming: false });
}

/** 抽出 1 回ぶんの共通実行（full / single_document）。進捗を docRows へ畳み込む */
async function performRun(
  store: Store,
  deps: ExtractServiceDeps,
  params: {
    spreadsheetId: string;
    driveFolderId: string;
    runType: 'full' | 'single_study';
    targets: readonly DocumentRecord[];
    fields: readonly SchemaField[];
    model: string;
    apiKey: string;
    onDocRows: (rows: ExtractDocRow[]) => void;
  },
): Promise<RunExtractionOutcome> {
  const { text: protocolContext } = await resolveProtocol(store, deps, params.spreadsheetId);

  // 進捗リストの分母（document 別バッチ数）を実行前に計画しておく。
  // runExtraction は内部で再計画するが、同一入力なら計画は一致する（extractionService の契約）
  const plan = planRun({
    documents: params.targets,
    fields: params.fields,
    model: params.model,
    protocolContext,
  });
  const tracker = createDocProgressTracker(
    params.targets.map((doc) => doc.documentId),
    plan.batches,
  );
  params.onDocRows(tracker.rows());

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
      onProgress: (progress) => {
        tracker.onProgress(progress);
        patchExtract(store, { progress });
        params.onDocRows(tracker.rows());
      },
    },
    {
      google: deps.google,
      apiKey: params.apiKey,
      loadDocumentPages: makeLoadDocumentPages(params.targets, deps.google),
      buildProvider: deps.buildProvider,
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
  // 実行済み run の対象 document は以後「抽出済み」（既定選択・バッジの素材を更新）。
  // run は study_ids で記録されるが、フェーズ 1 は 1 study = 1 文書なので targets の document を数える
  const extracted = new Set(after.extract.extractedDocumentIds ?? []);
  for (const doc of params.targets) {
    extracted.add(doc.documentId);
  }
  patchExtract(store, { extractedDocumentIds: [...extracted] });
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
    state.extract.retryingDocumentId !== null ||
    fields === null
  ) {
    return;
  }
  const apiKey = await deps.loadApiKey(resolveProviderId(state.extract.model));
  if (apiKey === null) {
    patchExtract(store, {
      confirming: false,
      runError: missingApiKeyMessage(resolveProviderId(state.extract.model)),
    });
    return;
  }
  patchExtract(store, {
    confirming: false,
    running: true,
    runError: null,
    progress: null,
    run: null,
    rejectedCount: 0,
    docRows: [],
  });
  try {
    const documents = await resolveDocuments(store, deps.google, project.spreadsheetId);
    const selected = new Set(state.extract.selectedDocumentIds);
    const targets = documents.filter((doc) => selected.has(doc.documentId));
    const outcome = await performRun(store, deps, {
      spreadsheetId: project.spreadsheetId,
      driveFolderId: project.driveFolderId,
      runType: 'full',
      targets,
      fields,
      model: state.extract.model,
      apiKey,
      onDocRows: (rows) => patchExtract(store, { docRows: rows }),
    });
    patchExtract(store, {
      running: false,
      progress: null,
      run: outcome.run,
      rejectedCount: outcome.result.rejectedItems.length,
    });
    showToast(
      outcome.run.status === 'done'
        ? `一括抽出が完了しました（Evidence ${outcome.result.evidence.length} 件）`
        : '一括抽出が部分的に失敗しました。失敗した文献は再試行できます',
    );
  } catch (err) {
    patchExtract(store, { running: false, progress: null, runError: toMessage(err) });
  }
}

/**
 * 失敗した文献 1 本を再抽出する（run_type = 'single_study'。ui-states.md §3 の「再試行」）。
 * 対象行だけを実行中表示に差し替え、完了後にその行の結果で置き換える
 */
export async function retryExtractDocument(
  store: Store,
  deps: ExtractServiceDeps,
  documentId: string,
): Promise<void> {
  const state = store.getState();
  const project = state.currentProject;
  const fields = state.schema.currentFields;
  if (
    !project ||
    state.extract.running ||
    state.extract.retryingDocumentId !== null ||
    fields === null
  ) {
    return;
  }
  const apiKey = await deps.loadApiKey(resolveProviderId(state.extract.model));
  if (apiKey === null) {
    patchExtract(store, { runError: missingApiKeyMessage(resolveProviderId(state.extract.model)) });
    return;
  }
  // 対象行を差し替えるヘルパ（他の行の結果表示は維持する）
  const replaceRow = (row: ExtractDocRow): void => {
    patchExtract(store, {
      docRows: store
        .getState()
        .extract.docRows.map((current) => (current.documentId === documentId ? row : current)),
    });
  };
  patchExtract(store, { retryingDocumentId: documentId, runError: null });
  // 再計画前のプレースホルダ（バッチ数はまだ不明 = 0/0。onDocRows が実数で置き換える）
  replaceRow({ documentId, status: 'running', completedBatches: 0, totalBatches: 0, detail: null });
  try {
    const documents = await resolveDocuments(store, deps.google, project.spreadsheetId);
    const target = documents.find((doc) => doc.documentId === documentId);
    if (target === undefined) {
      throw new Error(`文献 ${documentId} が見つかりません`);
    }
    const outcome = await performRun(store, deps, {
      spreadsheetId: project.spreadsheetId,
      driveFolderId: project.driveFolderId,
      runType: 'single_study',
      targets: [target],
      fields,
      model: state.extract.model,
      apiKey,
      onDocRows: (rows) => {
        // 単一文献 run（targets = [target]）なので必ず 1 行。
        // 計画時の queued は行差し替えでは「実行中」として見せる
        const row = rows[0] as ExtractDocRow;
        replaceRow(row.status === 'queued' ? { ...row, status: 'running' } : row);
      },
    });
    patchExtract(store, {
      retryingDocumentId: null,
      rejectedCount: store.getState().extract.rejectedCount + outcome.result.rejectedItems.length,
    });
    showToast(
      outcome.run.status === 'done'
        ? '再試行が完了しました'
        : '再試行が部分的に失敗しました。失敗の内訳を確認してください',
    );
  } catch (err) {
    replaceRow({
      documentId,
      status: 'failed',
      completedBatches: 0,
      totalBatches: 0,
      detail: toMessage(err),
    });
    patchExtract(store, { retryingDocumentId: null, runError: toMessage(err) });
  }
}
