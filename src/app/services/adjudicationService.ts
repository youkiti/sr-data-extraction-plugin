// `#/adjudicate`（S12。docs/design-independent-dual-review.md §6・§9 PR3・§13）のサービス層。
// - study 一覧の読込: 対象 annotator ペアの解決 + study 単位ゲート（progress 100%）。
//   3 名以上の study は全 2 名組合せのゲートを事前計算し（pairOptions）、裁定者が一覧で
//   選んだ組（AdjudicateState.pairSelections）で裁定を開始する（issue #63 の 3 人以上対応）
// - study を開く: 群構成突き合わせ + セル突き合わせのスナップショットを組み立てる
//   （表示する run の Evidence も study 単位で解決し working へ持たせる。issue #63:
//   PDF ペインの根拠ハイライト + セル一覧の各レビュアーの note 表示に使う）。
//   セル突き合わせの前に B 側 entity_key を arm マッピング（armMatch.ts。issue #63 の
//   並べ替えマッピング）で正準キーへ書き換える。マッピングは consensus 版 ArmStructures の
//   note から復元し、無ければ既定（名称一致 → 位置対応 → 残り物同士）を使う
// - 群構成の確定・改訂の永続化（annotator='consensus' の新版として追記。note に
//   arm マッピング辞書を直列化して残す）
// - セルの裁定（一致一括採用 / A・B 採用 / 第 3 の値 / not_reported / undo）の永続化
//   consensus 行 upsert → Decisions batch 追記の順で行う（features/adjudication/consensusRepository）。
//   失敗は検証側（app/services/verificationService.ts）と共有する 'decisions' オフラインキューへ
//   退避し、次回成功時に再送する（issue #63）
import type { ConfirmedArmStructure } from '../../domain/armStructure';
import type { DocumentRecord } from '../../domain/document';
import type { SchemaField } from '../../domain/schemaField';
import type { StudyRecord } from '../../domain/study';
import {
  buildAgreementReport,
  buildAgreementSummaryCsv,
  buildAgreementDisagreementsCsv,
  type AgreementStudyInput,
} from '../../features/adjudication/agreement';
import {
  armMappingFromRemap,
  armsMatch,
  buildArmKeyRemap,
  buildConsensusArmDraft,
  buildDefaultArmMapping,
  parseArmKeyRemapNote,
  remapArmEntityKey,
  serializeArmKeyRemap,
  type DraftArmRow,
} from '../../features/adjudication/armMatch';
import { buildAdjudicationCells, type AdjudicationCell } from '../../features/adjudication/cellMatch';
import {
  buildBulkAcceptWrites,
  buildChoiceWrite,
  buildCustomValueWrite,
  buildNotReportedWrite,
  buildUndoWrite,
  toConsensusDecision,
  type ConsensusCellWrite,
  type ConsensusWriteParams,
} from '../../features/adjudication/consensusWrites';
import { computeStudyGate, type StudyGate } from '../../features/adjudication/gate';
import { resolveAnnotatorPair } from '../../features/adjudication/pairResolution';
import { readDocuments } from '../../features/documents/documentRepository';
import { readStudies } from '../../features/documents/studyRepository';
import { buildStudySelection } from '../../features/documents/studySelection';
import type { DisposablePdfDocument } from '../../features/documents/extractTextLayer';
import { readResultsDataRows, readStudyDataSheet } from '../../features/extraction/annotationRepository';
import { readEvidenceRows } from '../../features/extraction/evidenceRepository';
import { readRunSchemaVersions } from '../../features/extraction/runRepository';
import { getSchemaFieldsByVersion, listSchemaVersions } from '../../features/schema/schemaRepository';
import {
  latestArmStructure,
  latestArmStructureNote,
  readAllArmStructures,
  appendArmStructureVersion,
} from '../../features/verification/armStructureRepository';
import { needsArmConfirmation } from '../../features/verification/armDraft';
import { deriveCellStates, emptyCellState, type CellState } from '../../features/verification/cellState';
import { readAllDecisions } from '../../features/verification/decisionRepository';
import { createPdfViewCache } from '../../features/verification/pdfViewCache';
import { getCurrentUserEmail, type ProfileDeps } from '../../lib/google/identity';
import type { GoogleApiDeps } from '../../lib/google/types';
import type { OfflineQueue } from '../../lib/storage/offlineQueue';
import { nowIso8601 } from '../../utils/iso8601';
import type {
  AdjudicatePairOption,
  AdjudicateState,
  AdjudicateStudyRow,
  AdjudicateWorking,
  Store,
} from '../store';
import { downloadTextFile } from '../ui/download';
import { showToast } from '../ui/toast';
import { t } from '../../lib/i18n';
import { timestampForFilename } from './exportService';
import { latestRunEvidenceByStudy } from './verifyService';
import { persistConsensusWrite, type QueuedWrite } from './verificationService';

export interface AdjudicationServiceDeps {
  google: GoogleApiDeps;
  profile: ProfileDeps;
  /** lib/pdf/loadPdf.ts（テストは fake で完結させるため注入） */
  loadPdf: (data: ArrayBuffer) => Promise<DisposablePdfDocument>;
  /** テスト差し替え用のオフラインキュー（既定は検証側と共有するモジュール共有 'decisions' キュー。issue #63） */
  decisionQueue?: OfflineQueue<QueuedWrite>;
  now?: () => string;
}

function toMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/** adjudicate スライスだけを差し替える setState ヘルパ（他スライスは維持） */
function patchAdjudicate(store: Store, patch: Partial<AdjudicateState>): void {
  store.setState({ adjudicate: { ...store.getState().adjudicate, ...patch } });
}

async function resolveDocuments(
  store: Store,
  deps: AdjudicationServiceDeps,
  spreadsheetId: string,
): Promise<readonly DocumentRecord[]> {
  const cached = store.getState().documents.records;
  return cached ?? (await readDocuments(spreadsheetId, deps.google));
}

async function resolveStudies(
  store: Store,
  deps: AdjudicationServiceDeps,
  spreadsheetId: string,
): Promise<readonly StudyRecord[]> {
  const cached = store.getState().documents.studies;
  return cached ?? (await readStudies(spreadsheetId, deps.google));
}

/**
 * study 一覧を読み込む（S12 の初期表示）。対象 study ごとに annotator ペアを解決し、
 * 2 名ちょうど（ready）の study はゲート（進捗 100%）を計算する。3 名以上（selectable。
 * issue #63）は全 2 名組合せぶんのゲートを事前計算して pairOptions へ入れ、裁定者の
 * 選択（pairSelections）に委ねる。1 名以下（waiting）は gate=null のまま返し画面側が案内する
 */
export async function loadAdjudicateTargets(
  store: Store,
  deps: AdjudicationServiceDeps,
  options: { force?: boolean } = {},
): Promise<void> {
  const state = store.getState();
  const project = state.currentProject;
  if (!project || state.adjudicate.loading) {
    return;
  }
  if (state.adjudicate.rows !== null && options.force !== true) {
    return;
  }
  patchAdjudicate(store, { loading: true, loadError: null });
  try {
    const { spreadsheetId } = project;
    const documents = await resolveDocuments(store, deps, spreadsheetId);
    const studies = await resolveStudies(store, deps, spreadsheetId);
    const studySheet = await readStudyDataSheet(spreadsheetId, deps.google);
    const resultsRows = await readResultsDataRows(spreadsheetId, deps.google);
    const decisions = await readAllDecisions(spreadsheetId, deps.google);
    const armRows = await readAllArmStructures(spreadsheetId, deps.google);
    const versions = await listSchemaVersions(spreadsheetId, deps.google);
    const latest = versions[0];
    const fields = latest === undefined ? [] : await getSchemaFieldsByVersion(spreadsheetId, latest.schemaVersion, deps.google);

    const rows: AdjudicateStudyRow[] = [];
    for (const item of buildStudySelection(studies, documents)) {
      const { study } = item;
      const studyDecisions = decisions.filter((decision) => decision.studyId === study.studyId);
      const pair = resolveAnnotatorPair({
        studyId: study.studyId,
        studyDataRows: studySheet.rows,
        resultsDataRows: resultsRows,
        decisions,
      });
      let gate: StudyGate | null = null;
      let pairOptions: AdjudicatePairOption[] | null = null;
      const studyArmRows = armRows.filter((row) => row.studyId === study.studyId);
      if (pair.kind === 'ready') {
        const armStructureA = latestArmStructure(studyArmRows, pair.annotatorA);
        const armStructureB = latestArmStructure(studyArmRows, pair.annotatorB);
        gate = computeStudyGate(pair.annotatorA, pair.annotatorB, fields, studyDecisions, armStructureA, armStructureB);
      } else if (pair.kind === 'selectable') {
        // issue #63: 3 名以上は全 2 名組合せ（email 昇順ペア）のゲートを事前計算する
        pairOptions = [];
        const emails = pair.annotators;
        for (let i = 0; i < emails.length; i += 1) {
          for (let j = i + 1; j < emails.length; j += 1) {
            const annotatorA = emails[i] as string;
            const annotatorB = emails[j] as string;
            pairOptions.push({
              annotatorA,
              annotatorB,
              gate: computeStudyGate(
                annotatorA,
                annotatorB,
                fields,
                studyDecisions,
                latestArmStructure(studyArmRows, annotatorA),
                latestArmStructure(studyArmRows, annotatorB),
              ),
            });
          }
        }
      }
      rows.push({ study, pair, gate, pairOptions });
    }
    patchAdjudicate(store, { loading: false, rows });
  } catch (err) {
    patchAdjudicate(store, { loading: false, loadError: toMessage(err) });
  }
}

/**
 * この study で実際に裁定へ使う 2 名とゲートを解決する（issue #63）。
 * ready（2 名ちょうど）は自動確定のペアを、selectable（3 名以上）は裁定者の選択
 * （pairSelections）に一致する pairOptions の組を返す。未選択・選択が無効・waiting は null
 */
function resolveEffectivePair(
  row: AdjudicateStudyRow,
  pairSelections: AdjudicateState['pairSelections'],
): { annotatorA: string; annotatorB: string; gate: StudyGate } | null {
  if (row.pair.kind === 'ready') {
    // gate は pair.kind === 'ready' のとき必ず計算される（loadAdjudicateTargets の不変条件）
    /* istanbul ignore next -- 上記の理由で row.gate === null 側は実行時に到達しない */
    if (row.gate === null) {
      return null;
    }
    return { annotatorA: row.pair.annotatorA, annotatorB: row.pair.annotatorB, gate: row.gate };
  }
  if (row.pair.kind === 'selectable' && row.pairOptions !== null) {
    const selection = pairSelections[row.study.studyId];
    if (selection === undefined) {
      return null;
    }
    const option = row.pairOptions.find(
      (candidate) =>
        candidate.annotatorA === selection.annotatorA && candidate.annotatorB === selection.annotatorB,
    );
    return option ?? null;
  }
  return null;
}

/** study が見つからない・ペア未選択・ゲート未達のときの案内文言 */
function unavailableMessage(
  row: AdjudicateStudyRow | undefined,
  pairSelections: AdjudicateState['pairSelections'],
): string {
  if (row === undefined) {
    return t('adjudicate.svcStudyNotFound');
  }
  if (row.pair.kind === 'waiting') {
    return t('adjudicate.svcWaitingBoth');
  }
  if (row.pair.kind === 'selectable' && resolveEffectivePair(row, pairSelections) === null) {
    return t('adjudicate.svcSelectPair');
  }
  return t('adjudicate.svcNotReady');
}

/**
 * 指定 study の裁定作業データを組み立てて開く。対象外（ペア未確定 / ゲート未達）は
 * workingError に案内文言を入れて一覧表示へ留まる
 */
export async function openAdjudicateStudy(
  store: Store,
  deps: AdjudicationServiceDeps,
  studyId: string,
): Promise<void> {
  const state = store.getState();
  const project = state.currentProject;
  const rows = state.adjudicate.rows;
  if (!project || rows === null || state.adjudicate.workingLoading) {
    return;
  }
  const row = rows.find((candidate) => candidate.study.studyId === studyId);
  const effectivePair = row === undefined ? null : resolveEffectivePair(row, state.adjudicate.pairSelections);
  if (row === undefined || effectivePair === null || !effectivePair.gate.ready) {
    await state.adjudicate.working?.disposePdf();
    patchAdjudicate(store, {
      selectedStudyId: studyId,
      working: null,
      workingError: unavailableMessage(row, state.adjudicate.pairSelections),
    });
    return;
  }

  await state.adjudicate.working?.disposePdf();
  patchAdjudicate(store, { workingLoading: true, workingError: null, selectedStudyId: studyId, working: null });
  try {
    const { spreadsheetId } = project;
    const { annotatorA, annotatorB } = effectivePair;
    const documents = await resolveDocuments(store, deps, spreadsheetId);
    const studies = await resolveStudies(store, deps, spreadsheetId);
    const item = buildStudySelection(studies, documents).find((candidate) => candidate.study.studyId === studyId);
    if (item === undefined) {
      throw new Error(t('extraction.errStudyDocsNotFound', { id: studyId }));
    }
    const versions = await listSchemaVersions(spreadsheetId, deps.google);
    const latest = versions[0];
    if (latest === undefined) {
      throw new Error(t('adjudicate.svcNoSchema'));
    }
    const fields = await getSchemaFieldsByVersion(spreadsheetId, latest.schemaVersion, deps.google);
    const studySheet = await readStudyDataSheet(spreadsheetId, deps.google);
    const resultsRows = await readResultsDataRows(spreadsheetId, deps.google);
    const decisions = await readAllDecisions(spreadsheetId, deps.google);
    const armRows = await readAllArmStructures(spreadsheetId, deps.google);
    const studyArmRows = armRows.filter((r) => r.studyId === studyId);
    // issue #63: PDF ペインの根拠ハイライトの情報源。表示する run（既知 run のうち study の
    // 最新）の Evidence のみを対象にする（latestRunEvidenceByStudy を再利用）。
    // S8/S9 は issue #80 で field 単位合成（composeEvidenceByStudy。完了 run のみ対象）へ
    // 移行したが、裁定のハイライトは補助表示のため v1 は study 単位の最新 run のままとする
    // （サブセット run が最新のとき対象外 field のハイライトが出ない・中断 run の Evidence が
    // こちらでは出るのに S8/S9 では出ない、という食い違いを許容する割り切り。
    // 必要になったら合成へ揃える）
    const allEvidence = await readEvidenceRows(spreadsheetId, deps.google);
    const runVersions = await readRunSchemaVersions(spreadsheetId, deps.google);
    const evidenceByStudy = latestRunEvidenceByStudy(allEvidence, new Set(runVersions.keys()));
    const studyEvidence = evidenceByStudy.get(studyId)?.evidence ?? [];

    const studyDataRowA = studySheet.rows.find((r) => r.studyId === studyId && r.annotator === annotatorA) ?? null;
    const studyDataRowB = studySheet.rows.find((r) => r.studyId === studyId && r.annotator === annotatorB) ?? null;
    const resultsRowsA = resultsRows.filter((r) => r.studyId === studyId && r.annotator === annotatorA);
    const resultsRowsB = resultsRows.filter((r) => r.studyId === studyId && r.annotator === annotatorB);
    // issue #63: セル一覧の「A/B のメモ」表示に使う（各自の Decisions を noteA/noteB へ畳み込む）
    const decisionsA = decisions.filter((d) => d.studyId === studyId && d.annotator === annotatorA);
    const decisionsB = decisions.filter((d) => d.studyId === studyId && d.annotator === annotatorB);
    const armsA = latestArmStructure(studyArmRows, annotatorA)?.arms ?? [];
    const armsB = latestArmStructure(studyArmRows, annotatorB)?.arms ?? [];
    const consensusArmStructure = latestArmStructure(studyArmRows, 'consensus');
    // issue #63（arm 並べ替えマッピング）: 確定済み consensus 版の note に永続化した辞書が
    // あればそれを復元し、無ければ既定マッピング（名称一致 → 位置対応 → 残り物同士）を使う
    const persistedRemap = parseArmKeyRemapNote(latestArmStructureNote(studyArmRows, 'consensus'));
    const armMapping =
      persistedRemap !== null
        ? armMappingFromRemap(armsA, armsB, persistedRemap)
        : buildDefaultArmMapping(armsA, armsB);
    const armKeyRemap = persistedRemap ?? buildArmKeyRemap(armsA, armsB, armMapping);
    const armDraft: DraftArmRow[] =
      consensusArmStructure !== null
        ? consensusArmStructure.arms.map((arm) => ({ ...arm }))
        : buildConsensusArmDraft(armsA, armsB, armMapping);

    // B 側の entity_key（arm:n / outcome:...|arm:n）を正準キーへ書き換えてから突き合わせる。
    // マッピング変更時（setAdjudicateArmMapping）は同じクロージャで再計算する
    const rebuildCells = (remap: ReadonlyMap<string, string>): AdjudicationCell[] =>
      buildAdjudicationCells(
        fields,
        studyDataRowA,
        studyDataRowB,
        resultsRowsA,
        resultsRowsB.map((r) => ({ ...r, entityKey: remapArmEntityKey(r.entityKey, remap) })),
        decisionsA,
        decisionsB.map((d) => ({ ...d, entityKey: remapArmEntityKey(d.entityKey, remap) })),
      );
    const cells = rebuildCells(armKeyRemap);
    const consensusDecisions = decisions.filter((d) => d.studyId === studyId && d.annotator === 'consensus');

    const pdfCache = createPdfViewCache({ google: deps.google, loadPdf: deps.loadPdf });
    const driveFileIdByDocument = new Map(item.documents.map((doc) => [doc.documentId, doc.driveFileId]));
    const working: AdjudicateWorking = {
      study: item.study,
      documents: item.documents,
      annotatorA,
      annotatorB,
      fields,
      schemaVersion: latest.schemaVersion,
      armsA,
      armsB,
      needsArmConfirmation: needsArmConfirmation(fields),
      armMapping,
      armsMatched: armsMatch(armsA, armsB, armMapping),
      consensusArmStructure,
      armDraft,
      cells,
      consensusDecisions,
      evidence: studyEvidence,
      skippedCellKeys: [],
      rebuildCells,
      loadPdfView: (documentId) => {
        const driveFileId = driveFileIdByDocument.get(documentId);
        if (driveFileId === undefined) {
          return Promise.resolve({
            pdf: null,
            pdfError: t('verify.pdfDocNotFound', { id: documentId }),
            textPages: [],
          });
        }
        return pdfCache.load(documentId, driveFileId);
      },
      retryPdfView: (documentId) => {
        const driveFileId = driveFileIdByDocument.get(documentId);
        if (driveFileId === undefined) {
          return Promise.resolve({
            pdf: null,
            pdfError: t('verify.pdfDocNotFound', { id: documentId }),
            textPages: [],
          });
        }
        return pdfCache.retry(documentId, driveFileId);
      },
      disposePdf: () => pdfCache.disposeAll(),
    };
    patchAdjudicate(store, { workingLoading: false, working });
  } catch (err) {
    patchAdjudicate(store, { workingLoading: false, workingError: toMessage(err) });
  }
}

/** 「一覧に戻る」。開いていた study の PDF キャッシュを破棄してから選択を解除する */
export function backToAdjudicateList(store: Store): void {
  const working = store.getState().adjudicate.working;
  patchAdjudicate(store, { selectedStudyId: null, working: null, workingError: null });
  void working?.disposePdf();
}

/**
 * 3 名以上の study（selectable）で裁定する 2 名の組を選ぶ / 解除する（issue #63）。
 * セッション内のみの選択（永続化なし）。選択の妥当性（pairOptions に含まれるか）は
 * resolveEffectivePair が開く時点で検証する
 */
export function setAdjudicatePairSelection(
  store: Store,
  studyId: string,
  selection: { annotatorA: string; annotatorB: string } | null,
): void {
  const next = { ...store.getState().adjudicate.pairSelections };
  if (selection === null) {
    delete next[studyId];
  } else {
    next[studyId] = selection;
  }
  patchAdjudicate(store, { pairSelections: next });
}

/**
 * arm 並べ替えマッピングの変更（issue #63）: A の index 行に対応する B の armKey を選ぶ
 * （null = 対応なし）。同じ B 群が他の行で選ばれていれば外して 1:1 対応を保つ。
 * マッピング変更はセル突き合わせ・一致判定・consensus ドラフトへ即時反映する
 * （consensus 群構成の確定後は変更不可 = no-op。確定時に辞書が note へ永続化されるため）
 */
export function setAdjudicateArmMapping(store: Store, index: number, bArmKey: string | null): void {
  const working = store.getState().adjudicate.working;
  if (working === null || working.consensusArmStructure !== null) {
    return;
  }
  if (index < 0 || index >= working.armMapping.length) {
    return;
  }
  if (bArmKey !== null && !working.armsB.some((arm) => arm.armKey === bArmKey)) {
    return;
  }
  const armMapping = working.armMapping.map((current) => (current === bArmKey ? null : current));
  armMapping[index] = bArmKey;
  const remap = buildArmKeyRemap(working.armsA, working.armsB, armMapping);
  patchAdjudicate(store, {
    working: {
      ...working,
      armMapping,
      armsMatched: armsMatch(working.armsA, working.armsB, armMapping),
      armDraft: buildConsensusArmDraft(working.armsA, working.armsB, armMapping),
      cells: working.rebuildCells(remap),
    },
  });
}

/** 群構成確定カードのドラフト編集（永続化なし。ローカル state のみ） */
export function updateAdjudicateArmDraftRow(store: Store, index: number, armName: string): void {
  const working = store.getState().adjudicate.working;
  if (working === null) {
    return;
  }
  const armDraft = working.armDraft.map((row, i) => (i === index ? { ...row, armName } : row));
  patchAdjudicate(store, { working: { ...working, armDraft } });
}

export function addAdjudicateArmDraftRow(store: Store): void {
  const working = store.getState().adjudicate.working;
  if (working === null) {
    return;
  }
  // 追加行の armKey は既存ドラフトと衝突しない最小の arm:n を採番する
  // （行削除後の再追加で `arm:${length + 1}` が既存キーと重複する不具合の修正。issue #63）
  const taken = new Set(working.armDraft.map((row) => row.armKey));
  let n = 1;
  while (taken.has(`arm:${n}`)) {
    n += 1;
  }
  const armDraft = [...working.armDraft, { armKey: `arm:${n}`, armName: '' }];
  patchAdjudicate(store, { working: { ...working, armDraft } });
}

export function removeAdjudicateArmDraftRow(store: Store, index: number): void {
  const working = store.getState().adjudicate.working;
  if (working === null) {
    return;
  }
  const armDraft = working.armDraft.filter((_, i) => i !== index);
  patchAdjudicate(store, { working: { ...working, armDraft } });
}

/**
 * 「このまま採用」/ 編集後の「確定」共通の永続化（ArmStructures へ annotator='consensus' で追記）。
 * note には裁定者と arm マッピング辞書（issue #63。B の armKey → 正準 armKey）を直列化して残し、
 * 再入場時に同じセル突き合わせを復元できるようにする
 */
export async function confirmAdjudicateArms(
  store: Store,
  deps: AdjudicationServiceDeps,
  arms: readonly { armKey: string; armName: string }[],
): Promise<void> {
  const project = store.getState().currentProject;
  const working = store.getState().adjudicate.working;
  if (!project || working === null) {
    return;
  }
  if (arms.length === 0 || arms.some((arm) => arm.armName.trim() === '')) {
    showToast(t('adjudicate.toastArmNames'));
    return;
  }
  try {
    const decidedBy = (await getCurrentUserEmail(deps.profile)) ?? '';
    const confirmedAt = (deps.now ?? nowIso8601)();
    const remap = buildArmKeyRemap(working.armsA, working.armsB, working.armMapping);
    const result: ConfirmedArmStructure = await appendArmStructureVersion(
      project.spreadsheetId,
      {
        studyId: working.study.studyId,
        arms: arms.map((arm) => ({ armKey: arm.armKey, armName: arm.armName.trim() })),
        annotator: 'consensus',
        annotatorType: 'consensus',
        confirmedAt,
        note: `裁定者: ${decidedBy} / ${serializeArmKeyRemap(remap)}`,
      },
      deps.google,
    );
    const current = store.getState().adjudicate.working;
    if (current !== null && current.study.studyId === working.study.studyId) {
      patchAdjudicate(store, {
        working: {
          ...current,
          consensusArmStructure: result,
          armDraft: result.arms.map((arm) => ({ ...arm })),
        },
      });
    }
    showToast(t('adjudicate.toastArmConfirmed'));
  } catch (err) {
    showToast(t('adjudicate.toastArmConfirmFailed', { reason: toMessage(err) }));
  }
}

/** セッション内のみのスキップ（consensus セルを作らず Decisions にも残さない。§6.4） */
export function skipAdjudicateCell(store: Store, cellKey: string): void {
  const working = store.getState().adjudicate.working;
  if (working === null || working.skippedCellKeys.includes(cellKey)) {
    return;
  }
  patchAdjudicate(store, {
    working: { ...working, skippedCellKeys: [...working.skippedCellKeys, cellKey] },
  });
}

/** スキップの取り消し（セッション内のみ） */
export function unskipAdjudicateCell(store: Store, cellKey: string): void {
  const working = store.getState().adjudicate.working;
  if (working === null || !working.skippedCellKeys.includes(cellKey)) {
    return;
  }
  patchAdjudicate(store, {
    working: { ...working, skippedCellKeys: working.skippedCellKeys.filter((key) => key !== cellKey) },
  });
}

/** セル一覧の「不一致のみ」フィルタ切替（永続化なし。画面セッション内のみ） */
export function setAdjudicateMismatchOnlyFilter(store: Store, value: boolean): void {
  patchAdjudicate(store, { mismatchOnlyFilter: value });
}

/** consensus 自身の現在のセル状態（判定履歴の畳み込み） */
export function adjudicateCellStates(working: AdjudicateWorking): Map<string, CellState> {
  return deriveCellStates(working.consensusDecisions);
}

async function applyWrites(
  store: Store,
  deps: AdjudicationServiceDeps,
  working: AdjudicateWorking,
  writes: readonly ConsensusCellWrite[],
): Promise<void> {
  const project = store.getState().currentProject;
  /* istanbul ignore if -- 呼び出し元は必ずプロジェクト選択済み・非空の writes を渡す（防御） */
  if (!project || writes.length === 0) {
    return;
  }
  if (store.getState().adjudicate.saving) {
    return;
  }
  patchAdjudicate(store, { saving: true });
  try {
    const decidedBy = (await getCurrentUserEmail(deps.profile)) ?? '';
    const decidedAt = (deps.now ?? nowIso8601)();
    const params: ConsensusWriteParams = {
      studyId: working.study.studyId,
      decidedBy,
      decidedAt,
      schemaVersion: working.schemaVersion,
    };
    // 即時保存に失敗しても persistConsensusWrite が 'decisions' オフラインキューへ退避し
    // 'queued' を返す（throw しない。issue #63）。人間の判断はこの時点で確定しているため、
    // キュー退避でも検証パネルと同様にセル状態を楽観反映する（復帰後の再送は
    // persistConsensusWrite 自身が次回の成功保存時にまとめて行う）
    const result = await persistConsensusWrite(
      project.spreadsheetId,
      { consensusWrites: writes, consensusParams: params },
      deps,
    );
    const queuedWrites =
      result.status === 'saved' ? result.remainingCount : store.getState().adjudicate.queuedWrites + 1;
    const current = store.getState().adjudicate.working;
    if (current !== null && current.study.studyId === working.study.studyId) {
      const newDecisions = [...current.consensusDecisions, ...writes.map((write) => toConsensusDecision(write, params))];
      patchAdjudicate(store, { saving: false, queuedWrites, working: { ...current, consensusDecisions: newDecisions } });
    } else {
      patchAdjudicate(store, { saving: false, queuedWrites });
    }
  } catch (err) {
    patchAdjudicate(store, { saving: false });
    showToast(t('adjudicate.toastSaveFailed', { reason: toMessage(err) }));
  }
}

/**
 * 「一致セルを一括採用」。既に consensus が判定済みのセルは対象外（再実行しても冪等）。
 * 群構成未確定の arm / outcome_result セルは個別裁定と同じくロック対象のため一括採用からも除外する
 * （群構成カードの確定を経ずに arm 依存セルへ consensus 値が書かれるのを防ぐ）
 */
export async function acceptAllMatchingCells(store: Store, deps: AdjudicationServiceDeps): Promise<void> {
  const working = store.getState().adjudicate.working;
  if (working === null) {
    return;
  }
  const states = adjudicateCellStates(working);
  const unlockedCells = working.cells.filter((cell) => !isArmLocked(working, cell));
  const writes = buildBulkAcceptWrites(unlockedCells, states);
  if (writes.length === 0) {
    showToast(t('adjudicate.toastNoMatches'));
    return;
  }
  await applyWrites(store, deps, working, writes);
}

function isArmLocked(working: AdjudicateWorking, cell: AdjudicationCell): boolean {
  const level = cell.field.entityLevel;
  return (level === 'arm' || level === 'outcome_result') && working.consensusArmStructure === null;
}

/** A または B を採用する個別裁定 */
export async function adjudicateCellChoice(
  store: Store,
  deps: AdjudicationServiceDeps,
  cellKey: string,
  choice: 'A' | 'B',
): Promise<void> {
  const working = store.getState().adjudicate.working;
  const cell = working?.cells.find((candidate) => candidate.cellKey === cellKey);
  if (working === null || cell === undefined) {
    return;
  }
  if (isArmLocked(working, cell)) {
    showToast(t('adjudicate.toastArmFirst'));
    return;
  }
  await applyWrites(store, deps, working, [buildChoiceWrite(cell, choice)]);
}

/** 第 3 の値を入力する個別裁定 */
export async function adjudicateCellCustomValue(
  store: Store,
  deps: AdjudicationServiceDeps,
  cellKey: string,
  value: string,
): Promise<void> {
  const working = store.getState().adjudicate.working;
  const cell = working?.cells.find((candidate) => candidate.cellKey === cellKey);
  if (working === null || cell === undefined) {
    return;
  }
  if (isArmLocked(working, cell)) {
    showToast(t('adjudicate.toastArmFirst'));
    return;
  }
  await applyWrites(store, deps, working, [buildCustomValueWrite(cell, value)]);
}

/** not_reported 裁定 */
export async function adjudicateCellNotReported(
  store: Store,
  deps: AdjudicationServiceDeps,
  cellKey: string,
): Promise<void> {
  const working = store.getState().adjudicate.working;
  const cell = working?.cells.find((candidate) => candidate.cellKey === cellKey);
  if (working === null || cell === undefined) {
    return;
  }
  if (isArmLocked(working, cell)) {
    showToast(t('adjudicate.toastArmFirst'));
    return;
  }
  await applyWrites(store, deps, working, [buildNotReportedWrite(cell)]);
}

/** 裁定の取り消し（undo） */
export async function undoAdjudicateCell(
  store: Store,
  deps: AdjudicationServiceDeps,
  cellKey: string,
): Promise<void> {
  const working = store.getState().adjudicate.working;
  const cell = working?.cells.find((candidate) => candidate.cellKey === cellKey);
  if (working === null || cell === undefined) {
    return;
  }
  const state = adjudicateCellStates(working).get(cellKey) ?? emptyCellState();
  const write = buildUndoWrite(cell, state);
  if (write === null) {
    return;
  }
  await applyWrites(store, deps, working, [write]);
}

// ---------------------------------------------------------------------------
// レビュアー間一致度レポート（issue #66）。一覧画面のカードからオンデマンドで計算する
// （画面入場時の自動読込はしない = Sheets 読み出しを増やさないため）。
// ---------------------------------------------------------------------------

/**
 * study 単位で ready ペア（human annotator ちょうど 2 名）を解決し、
 * features/adjudication/cellMatch.buildAdjudicationCells でセルを組み立てる。
 * openAdjudicateStudy と同じ読み出しパターン（studies / documents / StudyData /
 * ResultsData / Decisions / 最新確定 SchemaFields）を使う
 */
async function collectReadyStudyInputs(
  store: Store,
  deps: AdjudicationServiceDeps,
  spreadsheetId: string,
  fields: readonly SchemaField[],
): Promise<AgreementStudyInput[]> {
  const documents = await resolveDocuments(store, deps, spreadsheetId);
  const studies = await resolveStudies(store, deps, spreadsheetId);
  const studySheet = await readStudyDataSheet(spreadsheetId, deps.google);
  const resultsRows = await readResultsDataRows(spreadsheetId, deps.google);
  const decisions = await readAllDecisions(spreadsheetId, deps.google);

  const inputs: AgreementStudyInput[] = [];
  for (const item of buildStudySelection(studies, documents)) {
    const { study } = item;
    const pair = resolveAnnotatorPair({
      studyId: study.studyId,
      studyDataRows: studySheet.rows,
      resultsDataRows: resultsRows,
      decisions,
    });
    if (pair.kind !== 'ready') {
      continue;
    }
    const studyDataRowA =
      studySheet.rows.find((r) => r.studyId === study.studyId && r.annotator === pair.annotatorA) ?? null;
    const studyDataRowB =
      studySheet.rows.find((r) => r.studyId === study.studyId && r.annotator === pair.annotatorB) ?? null;
    const resultsRowsA = resultsRows.filter((r) => r.studyId === study.studyId && r.annotator === pair.annotatorA);
    const resultsRowsB = resultsRows.filter((r) => r.studyId === study.studyId && r.annotator === pair.annotatorB);
    const cells = buildAdjudicationCells(fields, studyDataRowA, studyDataRowB, resultsRowsA, resultsRowsB);
    inputs.push({ studyId: study.studyId, studyLabel: study.studyLabel, cells });
  }
  return inputs;
}

/**
 * レビュアー間一致度レポートを読み込む（S12 一覧カードの「一致度を計算」ボタン）。
 * 確定済みスキーマが無い・ready ペアが 0 件のときはエラーではなく、studyCount=0 の
 * 空レポートを結果として入れる（画面側は agreement.studyCount === 0 を「対象なし」として
 * 案内文言に切り替える。agreementError は読み込み自体の失敗〔ネットワーク等〕専用）
 */
export async function loadAgreementReport(store: Store, deps: AdjudicationServiceDeps): Promise<void> {
  const state = store.getState();
  const project = state.currentProject;
  if (!project || state.adjudicate.agreementLoading) {
    return;
  }
  patchAdjudicate(store, { agreementLoading: true, agreementError: null });
  try {
    const { spreadsheetId } = project;
    const versions = await listSchemaVersions(spreadsheetId, deps.google);
    const latest = versions[0];
    const fields = latest === undefined ? [] : await getSchemaFieldsByVersion(spreadsheetId, latest.schemaVersion, deps.google);
    const studyInputs = await collectReadyStudyInputs(store, deps, spreadsheetId, fields);
    const report = buildAgreementReport(fields, studyInputs);
    patchAdjudicate(store, { agreementLoading: false, agreement: report });
  } catch (err) {
    patchAdjudicate(store, { agreementLoading: false, agreementError: toMessage(err) });
  }
}

/**
 * 一致度レポートの CSV をローカル保存する（S10 の downloadExportResult と同じ Blob ダウンロード
 * パターン。download 引数はテストの seam）。レポート未計算（agreement === null）は no-op
 */
export function downloadAgreementCsv(
  store: Store,
  deps: AdjudicationServiceDeps,
  kind: 'summary' | 'disagreements',
  download: typeof downloadTextFile = downloadTextFile,
): void {
  const report = store.getState().adjudicate.agreement;
  if (report === null) {
    return;
  }
  const timestamp = timestampForFilename((deps.now ?? nowIso8601)());
  if (kind === 'summary') {
    download(`agreement_summary_${timestamp}.csv`, buildAgreementSummaryCsv(report), 'text/csv');
  } else {
    download(`agreement_disagreements_${timestamp}.csv`, buildAgreementDisagreementsCsv(report), 'text/csv');
  }
}
