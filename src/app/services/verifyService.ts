// #/verify（S8 単独画面）のサービス層（v0.10 フェーズ 3 = study 単位）。
// - 検証対象一覧の読み込み: Evidence がある study を列挙し、表示 run（最新 run）の
//   Evidence・スキーマ項目・進捗チップ（判定済み n / 総セル m）を組み立てる。
//   ただし独立入力モード（reviewer_independent。design §5.1）は Evidence / ExtractionRuns を
//   一切読まず、Studies × 最新確定スキーマから対象一覧を組む（readIndependentVerifyTargetMaterials）
// - study の選択（?study= 直リンク / セレクタ切替）: verificationService.loadVerificationBundle
// - 判定・群構成確定の永続化: verificationService へ委譲
import type { Decision } from '../../domain/decision';
import type { DocumentRecord } from '../../domain/document';
import type { Evidence } from '../../domain/evidence';
import { annotatorTypeForRole } from '../../domain/reviewer';
import type { StudyRecord } from '../../domain/study';
import type { ConfirmedArmStructure } from '../../domain/armStructure';
import type { SchemaField } from '../../domain/schemaField';
import { readDocuments } from '../../features/documents/documentRepository';
import { readStudies } from '../../features/documents/studyRepository';
import { buildStudySelection } from '../../features/documents/studySelection';
import { readEvidenceRows } from '../../features/extraction/evidenceRepository';
import { readRunSchemaVersions } from '../../features/extraction/runRepository';
import { getSchemaFieldsByVersion, listSchemaVersions } from '../../features/schema/schemaRepository';
import {
  latestArmStructure,
  readAllArmStructures,
} from '../../features/verification/armStructureRepository';
import { readAllDecisions } from '../../features/verification/decisionRepository';
import { verificationProgress } from '../../features/verification/progress';
import { getCurrentUserEmail } from '../../lib/google/identity';
import type { VerifyLayoutMode } from '../../lib/storage/settingsStore';
import { nowIso8601 } from '../../utils/iso8601';
import type { Store, VerifyState, VerifyTarget } from '../store';
import { showToast } from '../ui/toast';
import {
  loadVerificationBundle,
  persistArmConfirmation,
  persistDecisionWrite,
  persistInstanceDeclarations,
  persistVerifyLayoutMode,
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

/** Studies 一覧を解決する（documents スライスに読込済みならそれを使う） */
async function resolveStudies(
  store: Store,
  deps: VerificationDeps,
  spreadsheetId: string,
): Promise<readonly StudyRecord[]> {
  const cached = store.getState().documents.studies;
  return cached ?? (await readStudies(spreadsheetId, deps.google));
}

/**
 * study ごとに「表示する run」の Evidence を選ぶ（v0.10: 抽出単位は study）。
 * Evidence はシート行順（= 追記順）なので、その study で最後に現れた run_id が最新 run。
 * ExtractionRuns に記録がない run（2 行プロトコル導入前に中断した実行の孤児 Evidence）は
 * スキーマ版を解決できないため対象外とし、既知 run の中の最新を採る（1 件もなければ
 * その study は「未抽出」扱い = 一覧に出ない。S7 の既定選択で再抽出できる）
 */
export function latestRunEvidenceByStudy(
  evidence: readonly Evidence[],
  knownRunIds: ReadonlySet<string>,
): Map<string, { runId: string; evidence: Evidence[] }> {
  const known = evidence.filter((item) => knownRunIds.has(item.runId));
  const latestRun = new Map<string, string>();
  for (const item of known) {
    latestRun.set(item.studyId, item.runId);
  }
  const result = new Map<string, { runId: string; evidence: Evidence[] }>();
  for (const item of known) {
    if (latestRun.get(item.studyId) !== item.runId) {
      continue;
    }
    const entry = result.get(item.studyId) ?? { runId: item.runId, evidence: [] };
    entry.evidence.push(item);
    result.set(item.studyId, entry);
  }
  return result;
}

/** 検証対象 1 study ぶんの素材（一覧 = target、ダッシュボード集計は ownDecisions も使う） */
export interface VerifyTargetMaterial {
  target: VerifyTarget;
  /** 自分の annotator 行への判定のみ（cells.ts と同じ契約） */
  ownDecisions: Decision[];
  /** 自分が確定した群構成。未確定なら null */
  armStructure: ConfirmedArmStructure | null;
}

/**
 * 独立入力モード（reviewer_independent）の検証対象素材（design §5.1）。
 * Evidence / ExtractionRuns を一切読まず、Studies（アクティブ study 全件）× 最新確定
 * SchemaVersions から一覧を組む（AI 抽出の有無・実施状況を見せない = Q-a）。
 * 確定済みスキーマが 1 つも無ければ空配列（画面側が「オーナーがスキーマを確定するまで…」の
 * 空状態メッセージを出す）
 */
async function readIndependentVerifyTargetMaterials(
  store: Store,
  deps: VerificationDeps,
  spreadsheetId: string,
): Promise<VerifyTargetMaterial[]> {
  const documents = await resolveDocuments(store, deps, spreadsheetId);
  const studies = await resolveStudies(store, deps, spreadsheetId);
  const versions = await listSchemaVersions(spreadsheetId, deps.google);
  const latest = versions[0];
  if (latest === undefined) {
    return [];
  }
  const fields = await getSchemaFieldsByVersion(spreadsheetId, latest.schemaVersion, deps.google);
  const allDecisions = await readAllDecisions(spreadsheetId, deps.google);
  const allArmRows = await readAllArmStructures(spreadsheetId, deps.google);
  const annotator = (await getCurrentUserEmail(deps.profile)) ?? '';

  const materials: VerifyTargetMaterial[] = [];
  for (const item of buildStudySelection(studies, documents)) {
    const ownDecisions = allDecisions.filter(
      (decision) => decision.studyId === item.study.studyId && decision.annotator === annotator,
    );
    const armStructure = latestArmStructure(
      allArmRows.filter((row) => row.studyId === item.study.studyId),
      annotator,
    );
    materials.push({
      target: {
        study: item.study,
        documents: item.documents,
        evidence: [],
        fields,
        schemaVersion: latest.schemaVersion,
        progress: verificationProgress(fields, [], ownDecisions, { armStructure }),
      },
      ownDecisions,
      armStructure,
    });
  }
  return materials;
}

/**
 * Evidence がある study の検証素材一式を読み込む（S8 一覧と S9 ダッシュボードの共通素材）。
 * 進捗の分母・分子はセルモデル（features/verification/progress.ts）で数える。
 * study 内の文書は role 固定順 → 取り込み順で並べ、Evidence は全文書ぶんを渡す。
 *
 * 独立入力モード（role='reviewer_independent'）は Evidence 非依存の別経路
 * （readIndependentVerifyTargetMaterials）へ委譲する（design §5.1）
 */
export async function readVerifyTargetMaterials(
  store: Store,
  deps: VerificationDeps,
  spreadsheetId: string,
): Promise<VerifyTargetMaterial[]> {
  const role = store.getState().role.role ?? 'owner';
  if (role === 'reviewer_independent') {
    return readIndependentVerifyTargetMaterials(store, deps, spreadsheetId);
  }
  const documents = await resolveDocuments(store, deps, spreadsheetId);
  const studies = await resolveStudies(store, deps, spreadsheetId);
  const allEvidence = await readEvidenceRows(spreadsheetId, deps.google);
  const runVersions = await readRunSchemaVersions(spreadsheetId, deps.google);
  const allDecisions = await readAllDecisions(spreadsheetId, deps.google);
  const allArmRows = await readAllArmStructures(spreadsheetId, deps.google);
  const annotator = (await getCurrentUserEmail(deps.profile)) ?? '';

  const byStudy = latestRunEvidenceByStudy(allEvidence, new Set(runVersions.keys()));
  const fieldsByVersion = new Map<number, SchemaField[]>();
  const materials: VerifyTargetMaterial[] = [];
  // アクティブ study を作成順で。配下文書は role 固定順 → 取り込み順（buildStudySelection）
  for (const item of buildStudySelection(studies, documents)) {
    const entry = byStudy.get(item.study.studyId);
    if (entry === undefined) {
      continue; // Evidence なし（孤児 Evidence のみ含む）= 未抽出の study は一覧に出さない
    }
    // latestRunEvidenceByStudy が既知 run に絞っているため必ず解決できる
    const schemaVersion = runVersions.get(entry.runId) as number;
    let fields = fieldsByVersion.get(schemaVersion);
    if (fields === undefined) {
      fields = await getSchemaFieldsByVersion(spreadsheetId, schemaVersion, deps.google);
      fieldsByVersion.set(schemaVersion, fields);
    }
    const ownDecisions = allDecisions.filter(
      (decision) => decision.studyId === item.study.studyId && decision.annotator === annotator,
    );
    const armStructure = latestArmStructure(
      allArmRows.filter((row) => row.studyId === item.study.studyId),
      annotator,
    );
    materials.push({
      target: {
        study: item.study,
        documents: item.documents,
        evidence: entry.evidence,
        fields,
        schemaVersion,
        progress: verificationProgress(fields, entry.evidence, ownDecisions, { armStructure }),
      },
      ownDecisions,
      armStructure,
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
 * study を選択して検証データ束を読み込む（?study= 直リンク / セレクタ切替の両方が通る経路）。
 * 存在しない study_id は verifyError にして一覧から選び直せる状態を保つ
 */
export async function openVerifyStudy(
  store: Store,
  deps: VerificationDeps,
  studyId: string,
): Promise<void> {
  const state = store.getState();
  const project = state.currentProject;
  const targets = state.verify.targets;
  if (!project || targets === null || state.verify.verifyLoading) {
    return;
  }
  const target = targets.find((candidate) => candidate.study.studyId === studyId);
  if (target === undefined) {
    patchVerify(store, { verifyError: `study ${studyId} が見つかりません` });
    return;
  }
  // 前の study の PDF を破棄してから読み込む（pdfjs のメモリ解放）
  await state.verify.verification?.disposePdf?.();
  patchVerify(store, {
    verifyLoading: true,
    verifyError: null,
    selectedStudyId: studyId,
    verification: null,
    studyValues: null,
  });
  try {
    const bundle = await loadVerificationBundle(
      {
        spreadsheetId: project.spreadsheetId,
        study: target.study,
        documents: target.documents,
        fields: target.fields,
        evidence: target.evidence,
        schemaVersion: target.schemaVersion,
        annotatorType: annotatorTypeForRole(state.role.role ?? 'owner'),
      },
      deps,
    );
    patchVerify(store, {
      verifyLoading: false,
      verification: bundle.verification,
      studyValues: bundle.studyValues,
      layoutMode: bundle.layoutMode,
    });
  } catch (err) {
    patchVerify(store, { verifyLoading: false, verifyError: toMessage(err) });
  }
}

/**
 * 検証パネルのレイアウトモードを切替える（`#verify-layout-toggle`。パネル側は楽観反映済み）。
 * store へ反映しつつ settingsStore へ永続化する（S6 / S8 で設定を共有）
 */
export async function setVerifyLayoutMode(
  store: Store,
  deps: VerificationDeps,
  mode: VerifyLayoutMode,
): Promise<void> {
  patchVerify(store, { layoutMode: mode });
  await persistVerifyLayoutMode(mode, deps);
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
    (candidate) => candidate.study.studyId === decision.studyId,
  );
  const field = target?.fields.find((candidate) => candidate.fieldId === decision.fieldId);
  if (field === undefined) {
    showToast(`判定を保存できません: field_id ${decision.fieldId} が表のデザインにありません`);
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
 * outcome_result などの「人間が追加した entity インスタンス」を Decisions へ追記する。
 * ResultsData は実際のセル判定時に upsert される。
 */
export async function persistVerifyInstanceDeclarations(
  store: Store,
  deps: VerificationDeps,
  decisions: readonly Decision[],
): Promise<void> {
  const project = store.getState().currentProject;
  if (!project) {
    return;
  }
  await persistInstanceDeclarations(project.spreadsheetId, decisions, deps);
}
