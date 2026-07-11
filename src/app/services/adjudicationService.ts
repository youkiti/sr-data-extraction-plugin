// `#/adjudicate`（S12。docs/design-independent-dual-review.md §6・§9 PR3）のサービス層。
// - study 一覧の読込: 対象 annotator ペアの解決 + study 単位ゲート（progress 100%）
// - study を開く: 群構成突き合わせ + セル突き合わせのスナップショットを組み立てる
// - 群構成の確定・改訂の永続化（annotator='consensus' の新版として追記）
// - セルの裁定（一致一括採用 / A・B 採用 / 第 3 の値 / not_reported / undo）の永続化
//   consensus 行 upsert → Decisions batch 追記の順で行う（features/adjudication/consensusRepository）。
//   失敗はトースト表示のみで画面状態を維持する（v1 は offlineQueue への退避なし。§9）
import type { ConfirmedArmStructure } from '../../domain/armStructure';
import type { DocumentRecord } from '../../domain/document';
import type { StudyRecord } from '../../domain/study';
import { armsMatch, buildConsensusArmDraft, type DraftArmRow } from '../../features/adjudication/armMatch';
import { buildAdjudicationCells, type AdjudicationCell } from '../../features/adjudication/cellMatch';
import { applyConsensusWrites } from '../../features/adjudication/consensusRepository';
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
import { getSchemaFieldsByVersion, listSchemaVersions } from '../../features/schema/schemaRepository';
import {
  latestArmStructure,
  readAllArmStructures,
  appendArmStructureVersion,
} from '../../features/verification/armStructureRepository';
import { needsArmConfirmation } from '../../features/verification/armDraft';
import { deriveCellStates, emptyCellState, type CellState } from '../../features/verification/cellState';
import { readAllDecisions } from '../../features/verification/decisionRepository';
import { createPdfViewCache } from '../../features/verification/pdfViewCache';
import { getCurrentUserEmail, type ProfileDeps } from '../../lib/google/identity';
import type { GoogleApiDeps } from '../../lib/google/types';
import { nowIso8601 } from '../../utils/iso8601';
import type { AdjudicateState, AdjudicateStudyRow, AdjudicateWorking, Store } from '../store';
import { showToast } from '../ui/toast';

export interface AdjudicationServiceDeps {
  google: GoogleApiDeps;
  profile: ProfileDeps;
  /** lib/pdf/loadPdf.ts（テストは fake で完結させるため注入） */
  loadPdf: (data: ArrayBuffer) => Promise<DisposablePdfDocument>;
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
 * ペアが確定した study のみゲート（進捗 100%）を計算する。1 名以下・3 名以上は
 * gate=null のまま返し、画面側が案内文言を出す
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
      if (pair.kind === 'ready') {
        const studyArmRows = armRows.filter((row) => row.studyId === study.studyId);
        const armStructureA = latestArmStructure(studyArmRows, pair.annotatorA);
        const armStructureB = latestArmStructure(studyArmRows, pair.annotatorB);
        gate = computeStudyGate(pair.annotatorA, pair.annotatorB, fields, studyDecisions, armStructureA, armStructureB);
      }
      rows.push({ study, pair, gate });
    }
    patchAdjudicate(store, { loading: false, rows });
  } catch (err) {
    patchAdjudicate(store, { loading: false, loadError: toMessage(err) });
  }
}

/** study が見つからない・対象を特定できない・ゲート未達のときの案内文言 */
function unavailableMessage(row: AdjudicateStudyRow | undefined): string {
  if (row === undefined) {
    return '指定された研究が見つかりません';
  }
  if (row.pair.kind === 'waiting') {
    return '両者の検証完了待ちです（対象となる human annotator が 2 名そろっていません）';
  }
  if (row.pair.kind === 'ambiguous') {
    return '対象 annotator を特定できません（human annotator が 3 名以上見つかりました）';
  }
  // gate は pair.kind === 'ready' のときにしか null 以外にならない（loadAdjudicateTargets の
  // 不変条件）。ここまで来た時点で pair は必ず 'ready' なので row.gate は実質常に非 null だが、
  // 型は AdjudicateStudyRow['gate'] のままにしておく（呼び出し元の防御を保つ）
  /* istanbul ignore next -- 上記の理由で row.gate === null 側は実行時に到達しない */
  if (row.gate === null || !row.gate.ready) {
    return 'この研究はまだ両者の検証が完了していないため裁定できません';
  }
  /* istanbul ignore next -- 呼び出し元（openAdjudicateStudy）は非 ready 行のときしかこの関数を呼ばない */
  return '';
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
  const pair = row?.pair;
  if (row === undefined || pair === undefined || pair.kind !== 'ready' || row.gate === null || !row.gate.ready) {
    await state.adjudicate.working?.disposePdf();
    patchAdjudicate(store, {
      selectedStudyId: studyId,
      working: null,
      workingError: unavailableMessage(row),
    });
    return;
  }

  await state.adjudicate.working?.disposePdf();
  patchAdjudicate(store, { workingLoading: true, workingError: null, selectedStudyId: studyId, working: null });
  try {
    const { spreadsheetId } = project;
    const { annotatorA, annotatorB } = pair;
    const documents = await resolveDocuments(store, deps, spreadsheetId);
    const studies = await resolveStudies(store, deps, spreadsheetId);
    const item = buildStudySelection(studies, documents).find((candidate) => candidate.study.studyId === studyId);
    if (item === undefined) {
      throw new Error(`study ${studyId} の文書が見つかりません`);
    }
    const versions = await listSchemaVersions(spreadsheetId, deps.google);
    const latest = versions[0];
    if (latest === undefined) {
      throw new Error('確定済みの表のデザインがありません');
    }
    const fields = await getSchemaFieldsByVersion(spreadsheetId, latest.schemaVersion, deps.google);
    const studySheet = await readStudyDataSheet(spreadsheetId, deps.google);
    const resultsRows = await readResultsDataRows(spreadsheetId, deps.google);
    const decisions = await readAllDecisions(spreadsheetId, deps.google);
    const armRows = await readAllArmStructures(spreadsheetId, deps.google);
    const studyArmRows = armRows.filter((r) => r.studyId === studyId);

    const studyDataRowA = studySheet.rows.find((r) => r.studyId === studyId && r.annotator === annotatorA) ?? null;
    const studyDataRowB = studySheet.rows.find((r) => r.studyId === studyId && r.annotator === annotatorB) ?? null;
    const resultsRowsA = resultsRows.filter((r) => r.studyId === studyId && r.annotator === annotatorA);
    const resultsRowsB = resultsRows.filter((r) => r.studyId === studyId && r.annotator === annotatorB);
    const armsA = latestArmStructure(studyArmRows, annotatorA)?.arms ?? [];
    const armsB = latestArmStructure(studyArmRows, annotatorB)?.arms ?? [];
    const consensusArmStructure = latestArmStructure(studyArmRows, 'consensus');
    const armDraft: DraftArmRow[] =
      consensusArmStructure !== null
        ? consensusArmStructure.arms.map((arm) => ({ ...arm }))
        : buildConsensusArmDraft(armsA, armsB);

    const cells = buildAdjudicationCells(fields, studyDataRowA, studyDataRowB, resultsRowsA, resultsRowsB);
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
      armsMatched: armsMatch(armsA, armsB),
      consensusArmStructure,
      armDraft,
      cells,
      consensusDecisions,
      skippedCellKeys: [],
      loadPdfView: (documentId) => {
        const driveFileId = driveFileIdByDocument.get(documentId);
        if (driveFileId === undefined) {
          return Promise.resolve({
            pdf: null,
            pdfError: `document_id "${documentId}" が study 配下の文書に見つかりません`,
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
            pdfError: `document_id "${documentId}" が study 配下の文書に見つかりません`,
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
  const armDraft = [...working.armDraft, { armKey: `arm:${working.armDraft.length + 1}`, armName: '' }];
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

/** 「このまま採用」/ 編集後の「確定」共通の永続化（ArmStructures へ annotator='consensus' で追記） */
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
    showToast('すべての群に名称を入力してください');
    return;
  }
  try {
    const decidedBy = (await getCurrentUserEmail(deps.profile)) ?? '';
    const confirmedAt = (deps.now ?? nowIso8601)();
    const result: ConfirmedArmStructure = await appendArmStructureVersion(
      project.spreadsheetId,
      {
        studyId: working.study.studyId,
        arms: arms.map((arm) => ({ armKey: arm.armKey, armName: arm.armName.trim() })),
        annotator: 'consensus',
        annotatorType: 'consensus',
        confirmedAt,
        note: `裁定者: ${decidedBy}`,
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
    showToast('群構成を確定しました');
  } catch (err) {
    showToast(`群構成の確定に失敗しました: ${toMessage(err)}`);
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
    await applyConsensusWrites(project.spreadsheetId, writes, params, deps.google);
    const current = store.getState().adjudicate.working;
    if (current !== null && current.study.studyId === working.study.studyId) {
      const newDecisions = [...current.consensusDecisions, ...writes.map((write) => toConsensusDecision(write, params))];
      patchAdjudicate(store, { saving: false, working: { ...current, consensusDecisions: newDecisions } });
    } else {
      patchAdjudicate(store, { saving: false });
    }
  } catch (err) {
    patchAdjudicate(store, { saving: false });
    showToast(`裁定の保存に失敗しました: ${toMessage(err)}`);
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
    showToast('一括採用できる一致セルがありません');
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
    showToast('群構成の確定後に裁定してください');
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
    showToast('群構成の確定後に裁定してください');
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
    showToast('群構成の確定後に裁定してください');
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
