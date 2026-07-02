// #/verify（S8 単独画面）のサービス層。
// - 検証対象一覧の読み込み: Evidence がある document を列挙し、表示 run（最新 run）の
//   Evidence・スキーマ項目・進捗チップ（判定済み n / 総セル m）を組み立てる
// - 文献の選択（?doc= 直リンク / セレクタ切替）: verificationService.loadVerificationBundle
// - 判定・群構成確定の永続化: verificationService へ委譲
import type { Decision } from '../../domain/decision';
import type { DocumentRecord } from '../../domain/document';
import type { Evidence } from '../../domain/evidence';
import type { SchemaField } from '../../domain/schemaField';
import { readDocuments } from '../../features/documents/documentRepository';
import { readEvidenceRows } from '../../features/extraction/evidenceRepository';
import { readRunSchemaVersions } from '../../features/extraction/runRepository';
import { getSchemaFieldsByVersion } from '../../features/schema/schemaRepository';
import { readAllDecisions } from '../../features/verification/decisionRepository';
import { verificationProgress } from '../../features/verification/progress';
import { getCurrentUserEmail } from '../../lib/google/identity';
import { nowIso8601 } from '../../utils/iso8601';
import type { Store, VerifyState, VerifyTarget } from '../store';
import { showToast } from '../ui/toast';
import {
  loadVerificationBundle,
  persistArmConfirmation,
  persistDecisionWrite,
  type QueuedDecisionWrite,
  type VerificationDeps,
} from './verificationService';

function toMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/** verify スライスだけを差し替える setState ヘルパ（他スライスは維持） */
function patchVerify(store: Store, patch: Partial<VerifyState>): void {
  store.setState({ verify: { ...store.getState().verify, ...patch } });
}

/** documents 一覧を解決する（documents スライスに読込済みならそれを使う） */
async function resolveDocuments(
  store: Store,
  deps: VerificationDeps,
  spreadsheetId: string,
): Promise<readonly DocumentRecord[]> {
  const cached = store.getState().documents.records;
  return cached ?? (await readDocuments(spreadsheetId, deps.google));
}

/**
 * document ごとに「表示する run」の Evidence を選ぶ。
 * Evidence はシート行順（= 追記順）なので、その document で最後に現れた run_id が最新 run
 */
export function latestRunEvidenceByDocument(
  evidence: readonly Evidence[],
): Map<string, { runId: string; evidence: Evidence[] }> {
  const latestRun = new Map<string, string>();
  for (const item of evidence) {
    latestRun.set(item.documentId, item.runId);
  }
  const result = new Map<string, { runId: string; evidence: Evidence[] }>();
  for (const item of evidence) {
    if (latestRun.get(item.documentId) !== item.runId) {
      continue;
    }
    const entry = result.get(item.documentId) ?? { runId: item.runId, evidence: [] };
    entry.evidence.push(item);
    result.set(item.documentId, entry);
  }
  return result;
}

/** 検証対象 1 文献ぶんの素材（一覧 = target、ダッシュボード集計は ownDecisions も使う） */
export interface VerifyTargetMaterial {
  target: VerifyTarget;
  /** 自分の annotator 行への判定のみ（cells.ts と同じ契約） */
  ownDecisions: Decision[];
}

/**
 * Evidence がある document の検証素材一式を読み込む（S8 一覧と S9 ダッシュボードの共通素材）。
 * 進捗の分母・分子はセルモデル（features/verification/progress.ts）で数える
 */
export async function readVerifyTargetMaterials(
  store: Store,
  deps: VerificationDeps,
  spreadsheetId: string,
): Promise<VerifyTargetMaterial[]> {
  const documents = await resolveDocuments(store, deps, spreadsheetId);
  const allEvidence = await readEvidenceRows(spreadsheetId, deps.google);
  const runVersions = await readRunSchemaVersions(spreadsheetId, deps.google);
  const allDecisions = await readAllDecisions(spreadsheetId, deps.google);
  const annotator = (await getCurrentUserEmail(deps.profile)) ?? '';

  const byDocument = latestRunEvidenceByDocument(allEvidence);
  const fieldsByVersion = new Map<number, SchemaField[]>();
  const materials: VerifyTargetMaterial[] = [];
  for (const document of documents) {
    const entry = byDocument.get(document.documentId);
    if (entry === undefined) {
      continue; // Evidence なし = まだ AI 抽出していない文献は一覧に出さない
    }
    const schemaVersion = runVersions.get(entry.runId);
    if (schemaVersion === undefined) {
      throw new Error(
        `ExtractionRuns に run_id ${entry.runId} がありません（Evidence と実行記録が不整合です）`,
      );
    }
    let fields = fieldsByVersion.get(schemaVersion);
    if (fields === undefined) {
      fields = await getSchemaFieldsByVersion(spreadsheetId, schemaVersion, deps.google);
      fieldsByVersion.set(schemaVersion, fields);
    }
    const ownDecisions = allDecisions.filter(
      (decision) =>
        decision.documentId === document.documentId && decision.annotator === annotator,
    );
    materials.push({
      target: {
        document,
        evidence: entry.evidence,
        fields,
        schemaVersion,
        progress: verificationProgress(fields, entry.evidence, ownDecisions),
      },
      ownDecisions,
    });
  }
  return materials;
}

/** 検証対象一覧を読み込む（S8 の初期表示） */
export async function loadVerifyTargets(
  store: Store,
  deps: VerificationDeps,
  options: { force?: boolean } = {},
): Promise<void> {
  const state = store.getState();
  const project = state.currentProject;
  if (!project || state.verify.loading) {
    return;
  }
  if (state.verify.targets !== null && options.force !== true) {
    return;
  }
  patchVerify(store, { loading: true, loadError: null });
  try {
    const materials = await readVerifyTargetMaterials(store, deps, project.spreadsheetId);
    patchVerify(store, { loading: false, targets: materials.map((material) => material.target) });
  } catch (err) {
    patchVerify(store, { loading: false, loadError: toMessage(err) });
  }
}

/**
 * 文献を選択して検証データ束を読み込む（?doc= 直リンク / セレクタ切替の両方が通る経路）。
 * 存在しない document_id は verifyError にして一覧から選び直せる状態を保つ
 */
export async function openVerifyDocument(
  store: Store,
  deps: VerificationDeps,
  documentId: string,
): Promise<void> {
  const state = store.getState();
  const project = state.currentProject;
  const targets = state.verify.targets;
  if (!project || targets === null || state.verify.verifyLoading) {
    return;
  }
  const target = targets.find((candidate) => candidate.document.documentId === documentId);
  if (target === undefined) {
    patchVerify(store, { verifyError: `文献 ${documentId} が見つかりません` });
    return;
  }
  // 前の文献の PDF を破棄してから読み込む（pdfjs のメモリ解放）
  await state.verify.verification?.disposePdf?.();
  patchVerify(store, {
    verifyLoading: true,
    verifyError: null,
    selectedDocumentId: documentId,
    verification: null,
    studyValues: null,
  });
  try {
    const bundle = await loadVerificationBundle(
      {
        spreadsheetId: project.spreadsheetId,
        document: target.document,
        fields: target.fields,
        evidence: target.evidence,
        schemaVersion: target.schemaVersion,
      },
      deps,
    );
    patchVerify(store, {
      verifyLoading: false,
      verification: bundle.verification,
      studyValues: bundle.studyValues,
    });
  } catch (err) {
    patchVerify(store, { verifyLoading: false, verifyError: toMessage(err) });
  }
}

/**
 * 検証パネルの判定 1 操作を永続化する（pilotService.persistPilotDecision の S8 版）。
 * パネル側は楽観更新済みのため、失敗時はオフラインキューへ退避して後で再送する
 */
export async function persistVerifyDecision(
  store: Store,
  deps: VerificationDeps,
  decision: Decision,
): Promise<void> {
  const state = store.getState();
  const project = state.currentProject;
  if (!project) {
    return;
  }
  const target = state.verify.targets?.find(
    (candidate) => candidate.document.documentId === decision.documentId,
  );
  const field = target?.fields.find((candidate) => candidate.fieldId === decision.fieldId);
  if (field === undefined) {
    showToast(`判定を保存できません: field_id ${decision.fieldId} がスキーマにありません`);
    return;
  }
  let studyValues: Record<string, string | null> | null = null;
  if (field.entityLevel === 'study') {
    studyValues = { ...(state.verify.studyValues ?? {}), [field.fieldName]: decision.value };
    patchVerify(store, { studyValues });
  }
  const write: QueuedDecisionWrite = {
    decision,
    fieldName: field.fieldName,
    entityLevel: field.entityLevel,
    studyValues,
  };
  const result = await persistDecisionWrite(project.spreadsheetId, write, deps);
  if (result.status === 'queued') {
    patchVerify(store, { queuedDecisions: store.getState().verify.queuedDecisions + 1 });
  } else {
    patchVerify(store, { queuedDecisions: result.remainingCount });
  }
}

/**
 * 群構成の確定を永続化する（パネル側は楽観反映済み。失敗はトーストのみ）
 */
export async function persistVerifyArmConfirmation(
  store: Store,
  deps: VerificationDeps,
  arms: readonly { armKey: string; armName: string }[],
): Promise<void> {
  const state = store.getState();
  const project = state.currentProject;
  const verification = state.verify.verification;
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
