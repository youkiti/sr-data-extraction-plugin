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
import type { RunWarning } from '../../domain/extractionRun';
import { annotatorTypeForRole } from '../../domain/reviewer';
import type { StudyRecord } from '../../domain/study';
import type { ConfirmedArmStructure } from '../../domain/armStructure';
import type { SchemaField } from '../../domain/schemaField';
import { readDocuments } from '../../features/documents/documentRepository';
import { readStudies } from '../../features/documents/studyRepository';
import { buildStudySelection } from '../../features/documents/studySelection';
import { readEvidenceRows } from '../../features/extraction/evidenceRepository';
import {
  pickLatestCompletedRunByStudy,
  readCompletedRunMetas,
  type CompletedRunMeta,
} from '../../features/extraction/runRepository';
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
import { t } from '../../lib/i18n';
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
import {
  relocateQuote,
  type RelocateQuoteDeps,
  type RelocateQuoteOutcome,
} from './relocateQuoteService';

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
 * その study は「未抽出」扱い = 一覧に出ない。S7 の既定選択で再抽出できる）。
 *
 * study 単位（run 内の field 選択を区別しない）の「最新 run」判定のみが必要な用途
 * （adjudicationService の PDF ペインの根拠ハイライト索引）向けに残している。
 * S8 一覧 / S9 ダッシュボードの表示値は field_id 単位で run を選ぶ composeEvidenceByStudy
 * （issue #80）を使う
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

/** study × field_id 単位で選定した「表示する run」の集約結果（composeEvidenceByStudy の戻り値） */
export interface ComposedEvidenceByStudy {
  /**
   * fields リスト解決に使う schema_version。「その study を含む最新の完了 run」の版を採用する
   * （サブセット run でも最新ならその版。従来の latestRunEvidenceByStudy と同じ判定基準）
   */
  schemaVersion: number;
  /** 上記の版を決めた run_id（表示・デバッグ用） */
  runId: string;
  /** field_id ごとに選定した run の Evidence を合成したもの */
  evidence: Evidence[];
  /**
   * 上記の最新完了 run の warnings のうち当該 study ぶん（issue #106:
   * arm completeness。S8 の `#verify-arm-completeness-warning` の素材）
   */
  armWarnings: RunWarning[];
}

/**
 * candidateRunIds のうち targets(meta) を満たす run の中で最も新しい（runOrder が大きい）
 * run_id を返す。該当が無ければ空文字（composeEvidenceByStudy の呼び出し方では、
 * fieldId は必ずいずれかの候補 run の Evidence 由来のため実質到達しない）
 */
function pickLatestRunId(
  candidateRunIds: ReadonlySet<string>,
  runOrder: ReadonlyMap<string, number>,
  runById: ReadonlyMap<string, CompletedRunMeta>,
  targets: (meta: CompletedRunMeta) => boolean,
): string {
  let winner = '';
  let winnerOrder = -1;
  for (const runId of candidateRunIds) {
    // candidateRunIds は runById 由来の run_id のみで構成される（呼び出し側で保証）
    const meta = runById.get(runId) as CompletedRunMeta;
    if (!targets(meta)) {
      continue;
    }
    const order = runOrder.get(runId) as number; // runById と同じ completedRuns から作るため必ず解決できる
    if (order > winnerOrder) {
      winnerOrder = order;
      winner = runId;
    }
  }
  return winner;
}

/**
 * study × field_id 単位で「表示する run」を選び、その run の Evidence だけを合成する
 * （issue #80 案 A: run 単位のフィールド選択に対応した合成ビュー）。
 *
 * 規約:
 * - 完了 run（readCompletedRunMetas の戻り値）のみを対象にする。ExtractionRuns に無い
 *   run_id の Evidence（孤児。旧プロトコル以前の実行）の除外は従来どおり。一方、running 行
 *   しかない中断 run の flush 済み Evidence は、従来（latestRunEvidenceByStudy + 全 run 対象の
 *   readRunSchemaVersions）は S8/S9 に表示されていたが、issue #80 で意図的に除外へ厳格化した
 *   （S7 のカバレッジ判定「中断 run の study は未抽出に戻る」と表示を一致させる。
 *   再抽出が完了するまで S8/S9 には出ない）
 * - study の schema_version は「その study を含む最新の完了 run」の版を採用する
 *   （サブセット run でも最新ならその版。fields リスト解決に使う）
 * - field_id ごとに「fieldIds が null（= 全項目）または当該 field_id を含む、その study の
 *   最新の完了 run」を選び、その run の当該 field の Evidence だけを採用する。
 *   選定した run に当該 field の Evidence が 0 件でも、より古い run へはフォールバックしない
 *   （「最新の対象 run が正」という規約。過去 run の値が透けて見える事故を防ぐ）
 * - run の新旧は started_at の昇順で比較する。null は最古として扱い、null 同士・同値は
 *   安定ソートにより completedRuns の並び順（= シート行順）を保つ
 */
export function composeEvidenceByStudy(
  evidence: readonly Evidence[],
  completedRuns: readonly CompletedRunMeta[],
): Map<string, ComposedEvidenceByStudy> {
  const sorted = [...completedRuns].sort((a, b) => {
    const ak = a.startedAt ?? '';
    const bk = b.startedAt ?? '';
    if (ak < bk) {
      return -1;
    }
    if (ak > bk) {
      return 1;
    }
    return 0; // 同値・null 同士は安定ソートによりシート行順を保つ
  });
  const runOrder = new Map<string, number>();
  sorted.forEach((meta, i) => runOrder.set(meta.runId, i));
  const runById = new Map(completedRuns.map((meta) => [meta.runId, meta]));

  // 既知（完了 run に紐づく）Evidence のみを study ごとに集約する（孤児 Evidence は除外）
  const knownByStudy = new Map<string, Evidence[]>();
  for (const item of evidence) {
    if (!runById.has(item.runId)) {
      continue;
    }
    const list = knownByStudy.get(item.studyId) ?? [];
    list.push(item);
    knownByStudy.set(item.studyId, list);
  }

  const result = new Map<string, ComposedEvidenceByStudy>();
  for (const [studyId, items] of knownByStudy) {
    const candidateRunIds = new Set(items.map((item) => item.runId));

    // schemaVersion 解決用: study を含む最新の完了 run（サブセットでも最新なら採用）
    const latestRunId = pickLatestRunId(candidateRunIds, runOrder, runById, () => true);
    const latestMeta = runById.get(latestRunId) as CompletedRunMeta;

    // field_id ごとの勝者 run をメモ化しながら決定する
    const winnerByField = new Map<string, string>();
    const resolveWinner = (fieldId: string): string => {
      const cached = winnerByField.get(fieldId);
      if (cached !== undefined) {
        return cached;
      }
      const winner = pickLatestRunId(
        candidateRunIds,
        runOrder,
        runById,
        (meta) => meta.fieldIds === null || meta.fieldIds.includes(fieldId),
      );
      winnerByField.set(fieldId, winner);
      return winner;
    };

    result.set(studyId, {
      schemaVersion: latestMeta.schemaVersion,
      runId: latestRunId,
      evidence: items.filter((item) => item.runId === resolveWinner(item.fieldId)),
      // 最新完了 run の arm completeness 警告から当該 study ぶんを抜き出す（issue #106）
      armWarnings: (latestMeta.warnings ?? []).filter(
        (warning) => warning.studyId === studyId,
      ),
    });
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

/** readVerifyTargetMaterials の戻り値（検証対象素材一式 + ダッシュボードの AI 精度算入判定用 run 情報） */
export interface VerifyTargetMaterialsResult {
  materials: VerifyTargetMaterial[];
  /**
   * run_id → started_at（完了 run のみ。started_at 未記録の旧プロトコル行は null）。
   * dashboard.ts の isAiAccuracyEligible がセル単位の AI 精度算入判定に使う（PR #190 レビュー対応）。
   * 独立入力モードは常に空 map（下記 readIndependentVerifyTargetMaterials 呼び出し側参照）
   */
  runStartedAt: Map<string, string | null>;
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
        // 独立入力モードは AI 抽出の情報を一切見せない（issue #106 の警告も出さない）
        armWarnings: [],
        // 独立入力モードは AI 抽出の有無・実施状況を一切見せない盲検レビューのため、
        // no_result バナー（AI 抽出結果なし）も出さず常に 'extracted' 固定にする
        aiExtractionStatus: 'extracted',
      },
      ownDecisions,
      armStructure,
    });
  }
  return materials;
}

/**
 * Evidence がある study、および「完了 run の対象だったが AI 抽出が全滅して Evidence が
 * 1 行も生成されなかった study（= AI 抽出結果なし）」の検証素材一式を読み込む
 * （S8 一覧と S9 ダッシュボードの共通素材）。
 * 進捗の分母・分子はセルモデル（features/verification/progress.ts）で数える。
 * study 内の文書は role 固定順 → 取り込み順で並べ、Evidence は全文書ぶんを渡す。
 *
 * 独立入力モード（role='reviewer_independent'）は Evidence 非依存の別経路
 * （readIndependentVerifyTargetMaterials）へ委譲する（design §5.1）。ダッシュボードは
 * owner 専用のため、独立入力モードの runStartedAt は空 map で構わない（実害なし）
 */
export async function readVerifyTargetMaterials(
  store: Store,
  deps: VerificationDeps,
  spreadsheetId: string,
): Promise<VerifyTargetMaterialsResult> {
  const role = store.getState().role.role ?? 'owner';
  if (role === 'reviewer_independent') {
    const materials = await readIndependentVerifyTargetMaterials(store, deps, spreadsheetId);
    return { materials, runStartedAt: new Map() };
  }
  const documents = await resolveDocuments(store, deps, spreadsheetId);
  const studies = await resolveStudies(store, deps, spreadsheetId);
  const allEvidence = await readEvidenceRows(spreadsheetId, deps.google);
  const completedRuns = await readCompletedRunMetas(spreadsheetId, deps.google);
  const allDecisions = await readAllDecisions(spreadsheetId, deps.google);
  const allArmRows = await readAllArmStructures(spreadsheetId, deps.google);
  const annotator = (await getCurrentUserEmail(deps.profile)) ?? '';

  // field_id 単位で「表示する run」を選び Evidence を合成する（issue #80。サブセット run が
  // 最新でも、対象外の field は過去 run の Evidence が透けて見え続ける）
  const byStudy = composeEvidenceByStudy(allEvidence, completedRuns);
  // study_id ごとの「その study を含む最新の完了 run」（S7 バッジ注記と同じ関数・同じ並び規約を
  // 再利用する。CompletedRunMeta は CompletedRunStudySummary のスーパーセットのためそのまま渡せる）。
  // Evidence が 1 行も無い study が「そもそも完了 run の対象外（未抽出）」なのか「対象だったが
  // 全滅（AI 抽出結果なし）」なのかを見分けるために使う
  const latestCompletedRunByStudy = pickLatestCompletedRunByStudy(completedRuns);
  const fieldsByVersion = new Map<number, SchemaField[]>();
  const materials: VerifyTargetMaterial[] = [];
  // アクティブ study を作成順で。配下文書は role 固定順 → 取り込み順（buildStudySelection）
  for (const item of buildStudySelection(studies, documents)) {
    const entry = byStudy.get(item.study.studyId);
    // entry が無い（Evidence が 1 行も無い。孤児 Evidence のみ含む場合を含む）study のうち、
    // 完了 run の対象に一度も含まれていないものは、従来どおり「未抽出」として一覧から除外する。
    // 除外が確定するこの時点より前に decisions / armStructure の filter を走らせない
    // （study 数・Decisions 行数が多い実プロジェクトで、除外される study ぶんの無駄な計算を防ぐ）
    const latestRun = entry === undefined ? latestCompletedRunByStudy.get(item.study.studyId) : undefined;
    if (entry === undefined && latestRun === undefined) {
      continue;
    }

    const ownDecisions = allDecisions.filter(
      (decision) => decision.studyId === item.study.studyId && decision.annotator === annotator,
    );
    const armStructure = latestArmStructure(
      allArmRows.filter((row) => row.studyId === item.study.studyId),
      annotator,
    );

    // entry の有無から表示に使う値だけを決める。fields の解決と materials.push は
    // 下の 1 箇所にまとめる（将来 aiExtractionStatus に 'partial' 等を足すときも 1 箇所で済む）。
    // entry === undefined のときは、完了 run の対象だったのに Evidence が 1 行も生成されなかった
    // = AI 抽出結果なし（latestRun は上の guard により必ず解決済み）
    const schemaVersion = entry !== undefined ? entry.schemaVersion : (latestRun as CompletedRunMeta).schemaVersion;
    const evidence = entry?.evidence ?? [];
    // 直近 run の arm completeness 警告（issue #106。S8 バナーの素材）。no_result には無い
    const armWarnings = entry?.armWarnings ?? [];
    const aiExtractionStatus: VerifyTarget['aiExtractionStatus'] =
      entry !== undefined ? 'extracted' : 'no_result';

    let fields = fieldsByVersion.get(schemaVersion);
    if (fields === undefined) {
      fields = await getSchemaFieldsByVersion(spreadsheetId, schemaVersion, deps.google);
      fieldsByVersion.set(schemaVersion, fields);
    }
    materials.push({
      target: {
        study: item.study,
        documents: item.documents,
        evidence,
        fields,
        schemaVersion,
        progress: verificationProgress(fields, evidence, ownDecisions, { armStructure }),
        armWarnings,
        aiExtractionStatus,
      },
      ownDecisions,
      armStructure,
    });
  }
  // Sheets の GET を追加せず、既読の completedRuns から run_id → started_at map を作るだけ
  // （dashboard.ts のセル単位 AI 精度判定に使う。PR #190 レビュー対応）
  const runStartedAt = new Map(completedRuns.map((meta) => [meta.runId, meta.startedAt]));
  return { materials, runStartedAt };
}

/**
 * verify スライスの読込済みキャッシュを無効化する（抽出完了処理から呼ぶ。PR #190 のレビュー対応）。
 * PR #190 で #/verify の入場ガードを「確定スキーマ ≥ 1 かつ document ≥ 1」へ緩和した結果、
 * 抽出前に #/verify を開くと `targets: []` がキャッシュされ、その後 #/pilot・#/extract で抽出しても
 * `loadVerifyTargets`（`targets !== null` で早期 return）が再読込しないまま残ってしまう
 * （再入場してもページ再読み込みまで空一覧が残る）。抽出完了のたびにキャッシュを破棄し、
 * 次回 #/verify 入場時の既存の読込経路（force なしの自然な再読込）に委ねる。
 * `loading` / `queuedDecisions` / `layoutMode` / `deepLinkEntityKey` は抽出の成否と無関係なので
 * 触らない（queuedDecisions はオフラインキュー件数、layoutMode は設定由来のため）
 */
export function invalidateVerifyTargets(store: Store): void {
  // 表示中 PDF を解放してから状態を破棄する（pdfjs のメモリ解放。openVerifyStudy と同じ流儀）。
  // 抽出完了処理を PDF 解放の完了で足止めしないよう fire-and-forget にする
  void store.getState().verify.verification?.disposePdf?.();
  patchVerify(store, {
    targets: null,
    selectedStudyId: null,
    verification: null,
    verifyError: null,
    loadError: null,
    studyValues: null,
    studyRowUpdatedAt: null,
    resultsRowUpdatedAt: {},
    conflictMessage: null,
  });
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
    const { materials } = await readVerifyTargetMaterials(store, deps, project.spreadsheetId);
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
    // 楽観ロックのトークン・競合バナーもデータ束読込のたびにリセットする（issue #64）
    studyRowUpdatedAt: null,
    resultsRowUpdatedAt: {},
    conflictMessage: null,
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
      studyRowUpdatedAt: bundle.studyRowUpdatedAt,
      resultsRowUpdatedAt: bundle.resultsRowUpdatedAt,
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
    showToast(t('verify.errFieldNotInSchema', { id: decision.fieldId }));
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
  // 楽観ロックの期待値（issue #64）: study 項目は自分の StudyData 行の updated_at、
  // それ以外は自分の該当 ResultsData セルの updated_at（無ければ「行が無い」を期待）
  const expectedUpdatedAt =
    field.entityLevel === 'study'
      ? state.verify.studyRowUpdatedAt
      : (state.verify.resultsRowUpdatedAt[resultsCellKeyOf(decision.entityKey, decision.fieldId)] ??
        null);
  const result = await persistDecisionWrite(project.spreadsheetId, write, deps, expectedUpdatedAt);
  if (result.status === 'queued') {
    patchVerify(store, { queuedDecisions: store.getState().verify.queuedDecisions + 1 });
  } else if (result.status === 'conflict') {
    patchVerify(store, { conflictMessage: result.message });
  } else {
    const current = store.getState().verify;
    const folded = foldDecisionWriteTokens(result.written, {
      studyRowUpdatedAt: current.studyRowUpdatedAt,
      resultsRowUpdatedAt: current.resultsRowUpdatedAt,
    });
    patchVerify(store, {
      queuedDecisions: result.remainingCount,
      studyRowUpdatedAt: folded.studyRowUpdatedAt,
      resultsRowUpdatedAt: folded.resultsRowUpdatedAt,
    });
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

/**
 * `#/verify` 単独画面の「AI で再特定」ボタン（issue #94）。relocateQuoteService.relocateQuote へ
 * 委譲する薄いラッパ（pilotService.persistPilotRelocateQuote の #/verify 版）。store から
 * spreadsheetId / Drive フォルダ / 対象項目 / 出所文書の extracted_texts を解決するだけの責務を持つ
 */
export async function persistVerifyRelocateQuote(
  store: Store,
  deps: VerificationDeps & RelocateQuoteDeps,
  evidence: Evidence,
): Promise<RelocateQuoteOutcome> {
  const state = store.getState();
  const project = state.currentProject;
  const verification = state.verify.verification;
  if (!project || verification === null) {
    return { status: 'not_found', message: 'プロジェクトまたは検証データが読み込まれていません' };
  }
  const field = verification.fields.find((candidate) => candidate.fieldId === evidence.fieldId);
  const documentView = verification.documents.find(
    (view) => view.document.documentId === evidence.documentId,
  );
  if (field === undefined || documentView === undefined) {
    return { status: 'not_found', message: '対象項目または出所文書が見つかりません' };
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
