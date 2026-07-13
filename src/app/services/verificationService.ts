// S6（#/pilot 埋め込み）と S8（#/verify 単独）で共有する検証サービス基盤。
// - 検証データ束（VerificationData）の組み立て: Decisions / StudyData / ArmStructures +
//   extracted_texts（軽量な .txt。study 全文書ぶんを先読み）。
//   PDF バイナリはここでは 1 件も読まない（issue #28 案3）— VerificationData.loadPdfView
//   が表示中の文書だけを遅延読込する（features/verification/pdfViewCache が LRU キャッシュ）
// - 判定の永続化: 自分の annotator 行（StudyData / ResultsData）の upsert + Decisions 追記。
//   失敗時はオフラインキュー（lib/storage/offlineQueue の 'decisions'）へ退避し、成功時に再送する
// - 群構成確定の永続化: ArmStructures へ新 version を追記（キュー退避なし。失敗はトーストで通知）
// - annotator 行 upsert の楽観ロック（issue #64）: 独立二重レビューで同一 annotator が
//   2 コンテキスト（別タブ・別端末）から書くと後勝ち上書きが起きうるため、行の updated_at を
//   バージョントークンとして期待値検証する。競合検出時はキュー退避せず conflict を返す
//   （キューは「オフライン」を扱うためのものであり、競合をキューに入れても解決しない）
import { NOT_REPORTED_TOKEN } from '../../domain/annotation';
import type { ConfirmedArmStructure } from '../../domain/armStructure';
import type { Decision } from '../../domain/decision';
import type { DocumentRecord } from '../../domain/document';
import type { Evidence } from '../../domain/evidence';
import type { EntityLevel, SchemaField } from '../../domain/schemaField';
import type { StudyRecord } from '../../domain/study';
import { applyConsensusWrites } from '../../features/adjudication/consensusRepository';
import type { ConsensusCellWrite, ConsensusWriteParams } from '../../features/adjudication/consensusWrites';
import type { DisposablePdfDocument } from '../../features/documents/extractTextLayer';
import { parseExtractedText } from '../../features/documents/extractedText';
import { parseDriveFileId } from '../../features/documents/loadDocumentPages';
import {
  AnnotationConflictError,
  readResultsDataRows,
  readStudyDataSheet,
  upsertResultsDataRows,
  upsertStudyDataRows,
} from '../../features/extraction/annotationRepository';
import {
  appendArmStructureVersion,
  latestArmStructure,
  readArmStructuresByStudy,
  type ConfirmArmStructureInput,
} from '../../features/verification/armStructureRepository';
import {
  appendDecisionRows,
  readDecisionsByStudy,
} from '../../features/verification/decisionRepository';
import { isEntityInstanceDeclaration } from '../../features/verification/instanceDeclarations';
import { createPdfViewCache } from '../../features/verification/pdfViewCache';
import type {
  ExtractedPage,
  VerificationData,
  VerificationDocumentView,
} from '../../features/verification/types';
import { getFileText } from '../../lib/google/drive';
import { getCurrentUserEmail, type ProfileDeps } from '../../lib/google/identity';
import type { GoogleApiDeps } from '../../lib/google/types';
import { createOfflineQueue, type OfflineQueue } from '../../lib/storage/offlineQueue';
import {
  loadVerifyLayoutMode,
  saveVerifyLayoutMode,
  type VerifyLayoutMode,
} from '../../lib/storage/settingsStore';
import { showToast } from '../ui/toast';
import { t } from '../../lib/i18n';

/** 検証基盤の共有依存（pilotService / verifyService の deps はこれを拡張する） */
export interface VerificationDeps {
  google: GoogleApiDeps;
  profile: ProfileDeps;
  /** lib/pdf/loadPdf.ts（テストは fake で完結させるため注入） */
  loadPdf: (data: ArrayBuffer) => Promise<DisposablePdfDocument>;
  /**
   * テスト差し替え用のオフラインキュー（既定はモジュール共有の 'decisions' キュー）。
   * S12 裁定（adjudicationService.ts）の consensus 書き込みもこの同じキューへ退避する
   * （issue #63。QueuedWrite = QueuedDecisionWrite | QueuedConsensusWrite の判別共用体）
   */
  decisionQueue?: OfflineQueue<QueuedWrite>;
  newUuid?: () => string;
  now?: () => string;
  /** 検証パネルのレイアウトモード設定の読み書き（省略時は lib/storage/settingsStore の実装。issue #38） */
  loadVerifyLayoutMode?: () => Promise<VerifyLayoutMode>;
  saveVerifyLayoutMode?: (mode: VerifyLayoutMode) => Promise<void>;
}

/**
 * 判定 1 操作ぶんの書き込み内容。オフライン退避 → 再送で同じ経路を通せるよう、
 * StudyData の全量 values スナップショットまで自己完結で持つ（再送は後勝ち上書きで冪等）
 */
export interface QueuedDecisionWrite {
  decision: Decision;
  fieldName: string;
  entityLevel: EntityLevel;
  /** entity_level = study のときの StudyData 行 values 全量。他レベルは null */
  studyValues: Record<string, string | null> | null;
}

/**
 * S12 裁定（features/adjudication）の consensus 書き込み一式（issue #63）。
 * `applyConsensusWrites` 1 回ぶんの引数をそのまま保持し、再送時は同じ関数を丸ごと呼び直す
 * （冪等性は consensusRepository.ts のコメントのとおり upsert + Decisions 畳み込みで担保される）。
 * `QueuedDecisionWrite` との判別は `.decision` の有無で行う構造的判別共用体（`kind` フィールドを
 * 増やすと既存の `QueuedDecisionWrite` 構築箇所すべてに手を入れる必要が生じるため、既存コードを
 * 一切変更せずに済む構造的判別を選ぶ）
 */
export interface QueuedConsensusWrite {
  consensusWrites: readonly ConsensusCellWrite[];
  consensusParams: ConsensusWriteParams;
}

/** 'decisions' キューが受け付ける項目の共用体（検証の判定 / 裁定の consensus 書き込み） */
export type QueuedWrite = QueuedDecisionWrite | QueuedConsensusWrite;

function isConsensusWrite(item: QueuedWrite): item is QueuedConsensusWrite {
  return !('decision' in item);
}

/** キュー項目の同定キー（同じ判定 / 同じ裁定操作の再 enqueue は置換 = upsert になる） */
export function decisionWriteId(item: QueuedWrite): string {
  if (isConsensusWrite(item)) {
    return `consensus|${item.consensusParams.studyId}|${item.consensusParams.decidedAt}`;
  }
  return `${item.decision.decidedAt}|${item.decision.fieldId}|${item.decision.entityKey}`;
}

/** flush の再送順（操作した時刻の昇順） */
export function decisionWriteSortKey(item: QueuedWrite): string {
  return isConsensusWrite(item) ? item.consensusParams.decidedAt : item.decision.decidedAt;
}

/**
 * 項目種別に応じて実際の書き込みを行う（flush の再送・即時保存の双方から使う共通ディスパッチ）。
 * 検証の判定は saveDecisionWrite（annotator 行 upsert → Decisions 追記）、S12 裁定の consensus
 * 書き込みは applyConsensusWrites（consensus 行 upsert → Decisions batch 追記）へ委譲する
 */
async function saveQueuedItem(
  spreadsheetId: string,
  item: QueuedWrite,
  deps: VerificationDeps,
): Promise<void> {
  if (isConsensusWrite(item)) {
    await applyConsensusWrites(spreadsheetId, item.consensusWrites, item.consensusParams, deps.google);
    return;
  }
  await saveDecisionWrite(spreadsheetId, item, deps);
}

/** モジュール共有の判定 / 裁定キュー（用途名 'decisions'。spreadsheetId × userEmail で分離される） */
export const sharedDecisionQueue = createOfflineQueue<QueuedWrite>({
  name: 'decisions',
  getId: decisionWriteId,
  getSortKey: decisionWriteSortKey,
});

function toMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/**
 * ResultsData の楽観ロック用トークンマップ（VerificationBundle.resultsRowUpdatedAt）のセルキー。
 * entity_key × field_id の組を JSON 配列でキー化する（区切り文字より安全。issue #64）
 */
export function resultsCellKeyOf(entityKey: string, fieldId: string): string {
  return JSON.stringify([entityKey, fieldId]);
}

export interface VerificationBundleInput {
  spreadsheetId: string;
  /** 検証単位の study（Studies 由来） */
  study: StudyRecord;
  /** study 配下の文書（role 固定順 → 取り込み順。呼び出し側が並べて渡す） */
  documents: readonly DocumentRecord[];
  /** 表示する run のスキーマ項目（呼び出し側が版を解決して渡す） */
  fields: readonly SchemaField[];
  /** study の全文書ぶんの AI 根拠（表示する run のもの。各行は document_id で出所を持つ） */
  evidence: readonly Evidence[];
  schemaVersion: number;
  /** 判定を書き込む annotator_type（呼び出し側がロールから導出して渡す。design §5.2） */
  annotatorType: 'human_with_ai' | 'human_independent';
}

export interface VerificationBundle {
  verification: VerificationData;
  /** 自分の StudyData 行の values 全量（判定時のスナップショット更新用） */
  studyValues: Record<string, string | null>;
  /**
   * 検証パネルのレイアウトモードの初期表示（issue #38）。settingsStore から「検証データ束の
   * 読込時」に読む — study 切替のたびに読み直すことで、他画面での切替を常に最新反映する
   */
  layoutMode: VerifyLayoutMode;
  /**
   * 自分の StudyData 行の読込時 updated_at（楽観ロックの期待値。issue #64）。
   * 行が無ければ null（= 次の保存は「行がまだ無い」ことを期待する）
   */
  studyRowUpdatedAt: string | null;
  /**
   * 自分の ResultsData 行のセルキー（resultsCellKeyOf）別 updated_at（楽観ロックの期待値）。
   * 該当行が無いセルはキー自体を持たない
   */
  resultsRowUpdatedAt: Record<string, string>;
}

/**
 * 1 文書ぶんの extracted_texts（Drive の .txt）を読み込む。document.textRef が null
 * （no_text_layer）は失敗ではなく空配列とし、読み込み失敗は extractedTextError へ持つ
 * （throw しない。bundle 全体を失敗させないため）
 */
async function loadExtractedPages(
  document: DocumentRecord,
  deps: VerificationDeps,
): Promise<{ extractedPages: readonly ExtractedPage[]; extractedTextError: string | null }> {
  if (document.textRef === null) {
    return { extractedPages: [], extractedTextError: null };
  }
  const fileId = parseDriveFileId(document.textRef);
  if (fileId === null) {
    return {
      extractedPages: [],
      extractedTextError: t('verify.errTextRef', { ref: document.textRef }),
    };
  }
  try {
    const content = await getFileText(fileId, deps.google);
    return { extractedPages: parseExtractedText(content), extractedTextError: null };
  } catch (err) {
    return { extractedPages: [], extractedTextError: toMessage(err) };
  }
}

/**
 * 検証パネルへ流し込むデータ束を読み込む（S6 / S8 共通。v0.10 フェーズ 3 = study 単位）。
 * 読み込むのは Decisions / StudyData / ArmStructures + study 配下の全文書ぶんの
 * extracted_texts（軽量な .txt）のみ — PDF バイナリは 1 件も読まない（issue #28 案3）。
 * PDF は `VerificationData.loadPdfView` を通じて表示中の文書だけを遅延読込する
 * （features/verification/pdfViewCache が documentId 単位で LRU キャッシュする）
 */
export async function loadVerificationBundle(
  input: VerificationBundleInput,
  deps: VerificationDeps,
): Promise<VerificationBundle> {
  const { spreadsheetId, study } = input;
  const annotator = (await getCurrentUserEmail(deps.profile)) ?? '';
  const decisions = await readDecisionsByStudy(spreadsheetId, study.studyId, deps.google);
  const studySheet = await readStudyDataSheet(spreadsheetId, deps.google);
  const myStudyRow = studySheet.rows.find(
    (row) => row.studyId === study.studyId && row.annotator === annotator,
  );
  const studyValues = myStudyRow?.values ?? {};
  const studyRowUpdatedAt = myStudyRow?.updatedAt ?? null;

  // 自分の ResultsData 行の updated_at を楽観ロックの期待値として捕捉する（issue #64）。
  // このためだけに 1 GET 増えるが、トークン（updated_at）を得るには読み直すしかない
  const resultsRows = await readResultsDataRows(spreadsheetId, deps.google);
  const resultsRowUpdatedAt: Record<string, string> = {};
  for (const row of resultsRows) {
    if (row.studyId === study.studyId && row.annotator === annotator) {
      resultsRowUpdatedAt[resultsCellKeyOf(row.entityKey, row.fieldId)] = row.updatedAt;
    }
  }

  const armRows = await readArmStructuresByStudy(spreadsheetId, study.studyId, deps.google);
  const armStructure = latestArmStructure(armRows, annotator);

  const documents: VerificationDocumentView[] = [];
  const driveFileIdByDocument = new Map<string, string>();
  for (const document of input.documents) {
    const { extractedPages, extractedTextError } = await loadExtractedPages(document, deps);
    documents.push({ document, extractedPages, extractedTextError });
    driveFileIdByDocument.set(document.documentId, document.driveFileId);
  }

  // PDF は表示中の文書だけを遅延読込する（LRU キャッシュは bundle ＝ study 切替の単位で持つ）
  const pdfCache = createPdfViewCache({ google: deps.google, loadPdf: deps.loadPdf });
  function resolveDriveFileId(documentId: string): string | null {
    return driveFileIdByDocument.get(documentId) ?? null;
  }
  const loadPdfView: VerificationData['loadPdfView'] = async (documentId) => {
    const driveFileId = resolveDriveFileId(documentId);
    if (driveFileId === null) {
      return {
        pdf: null,
        pdfError: t('verify.pdfDocNotFound', { id: documentId }),
        textPages: [],
      };
    }
    return pdfCache.load(documentId, driveFileId);
  };
  const retryPdfView: VerificationData['retryPdfView'] = async (documentId) => {
    const driveFileId = resolveDriveFileId(documentId);
    if (driveFileId === null) {
      return {
        pdf: null,
        pdfError: t('verify.pdfDocNotFound', { id: documentId }),
        textPages: [],
      };
    }
    return pdfCache.retry(documentId, driveFileId);
  };
  const disposePdf: VerificationData['disposePdf'] = () => pdfCache.disposeAll();

  const verification: VerificationData = {
    study,
    documents,
    fields: input.fields,
    evidence: input.evidence,
    decisions,
    annotator,
    annotatorType: input.annotatorType,
    schemaVersion: input.schemaVersion,
    armStructure,
    loadPdfView,
    retryPdfView,
    disposePdf,
  };
  const layoutMode = await (deps.loadVerifyLayoutMode ?? loadVerifyLayoutMode)();
  return { verification, studyValues, layoutMode, studyRowUpdatedAt, resultsRowUpdatedAt };
}

/**
 * 検証パネルのレイアウトモードを永続化する（トグル操作 `#verify-layout-toggle` のたびに呼ぶ）。
 * S6 / S8 共通の永続化経路（呼び出し側は自分のスライスの layoutMode を楽観反映してから呼ぶ）
 */
export async function persistVerifyLayoutMode(
  mode: VerifyLayoutMode,
  deps: VerificationDeps,
): Promise<void> {
  await (deps.saveVerifyLayoutMode ?? saveVerifyLayoutMode)(mode);
}

/**
 * 判定書き込みの実体（オフライン再送でも同じ経路を通す）。annotator 行 → Decisions の順。
 * expectedUpdatedAt（省略可。issue #64）は annotator 行 upsert の楽観ロック期待値へそのまま
 * 引き渡す。省略（undefined）はチェックなし
 */
export async function saveDecisionWrite(
  spreadsheetId: string,
  write: QueuedDecisionWrite,
  deps: VerificationDeps,
  expectedUpdatedAt?: string | null,
): Promise<void> {
  const { decision } = write;
  if (isEntityInstanceDeclaration(decision)) {
    throw new Error('インスタンス宣言イベントは通常の判定保存経路では保存できません');
  }
  if (write.studyValues !== null) {
    await upsertStudyDataRows(
      spreadsheetId,
      [
        {
          studyId: decision.studyId,
          annotator: decision.annotator,
          annotatorType: decision.annotatorType,
          schemaVersion: decision.schemaVersion,
          runId: null,
          updatedAt: decision.decidedAt,
          values: write.studyValues,
          expectedUpdatedAt,
        },
      ],
      deps.google,
    );
  } else {
    const notReported = decision.value === NOT_REPORTED_TOKEN;
    await upsertResultsDataRows(
      spreadsheetId,
      [
        {
          studyId: decision.studyId,
          fieldId: decision.fieldId,
          annotator: decision.annotator,
          annotatorType: decision.annotatorType,
          schemaVersion: decision.schemaVersion,
          entityKey: decision.entityKey,
          runId: null,
          value: notReported ? null : decision.value,
          notReported,
          updatedAt: decision.decidedAt,
          expectedUpdatedAt,
        },
      ],
      deps.google,
      { newUuid: deps.newUuid },
    );
  }
  await appendDecisionRows(spreadsheetId, [decision], deps.google);
}

export type PersistDecisionResult =
  | { status: 'queued' }
  | { status: 'conflict'; message: string }
  | { status: 'saved'; remainingCount: number; written: QueuedDecisionWrite[] };

/**
 * 検証パネルの判定 1 操作を永続化する（requirements.md §4.2「判定ごとに即時書き込み」）。
 * パネル側は楽観更新済みのため、失敗時はオフラインキューへ退避して後で再送する。
 * 保存が通ったら過去の退避分も再送する（tiab-review と同じ復帰動作）。
 *
 * expectedUpdatedAt（省略可。issue #64）は即時保存にのみ適用する楽観ロックの期待値。
 * 即時保存が AnnotationConflictError で失敗した場合はキューへ退避せず（トーストも出さず）
 * conflict を返す — 呼び出し側が再読み込み導線（バナー）を出す。それ以外の失敗は従来どおり
 * キュー退避する。再送（flush のコールバック）は expectedUpdatedAt を渡さない
 * （後勝ち冪等のまま。再送をブロックするとオフライン中のデータが宙に浮いてしまうため）
 */
export async function persistDecisionWrite(
  spreadsheetId: string,
  write: QueuedDecisionWrite,
  deps: VerificationDeps,
  expectedUpdatedAt?: string | null,
): Promise<PersistDecisionResult> {
  const queue = deps.decisionQueue ?? sharedDecisionQueue;
  try {
    await saveDecisionWrite(spreadsheetId, write, deps, expectedUpdatedAt);
  } catch (err) {
    if (err instanceof AnnotationConflictError) {
      return { status: 'conflict', message: err.message };
    }
    await queue.enqueue(spreadsheetId, write.decision.annotator, write);
    showToast(t('verify.toastQueuedDecision'));
    return { status: 'queued' };
  }
  const written: QueuedDecisionWrite[] = [write];
  const result = await queue.flush(spreadsheetId, write.decision.annotator, async (item) => {
    await saveQueuedItem(spreadsheetId, item, deps);
    // written は楽観ロックの期待値の畳み込み（foldDecisionWriteTokens）専用のため、
    // QueuedDecisionWrite（annotator 行の判定書き込み）のみを積む。同じキューを共有する
    // S12 裁定の consensus 書き込み（QueuedConsensusWrite）は annotator 行の楽観ロックとは
    // 無関係なので対象外にする（issue #63）
    if (!isConsensusWrite(item)) {
      written.push(item);
    }
  });
  return { status: 'saved', remainingCount: result.remainingCount, written };
}

export type PersistConsensusResult =
  | { status: 'queued' }
  | { status: 'saved'; remainingCount: number };

/**
 * S12 裁定の consensus 書き込み 1 操作（一括採用 / 個別裁定 1 件ぶん）を永続化する
 * （issue #63。persistDecisionWrite の consensus 版）。immediate 保存が失敗したら
 * 検証側と共有する 'decisions' キューへ退避し、成功時は同キューに残る過去の退避分
 * （判定・裁定どちらも）もあわせて再送する。楽観ロックの概念は consensus 書き込みには
 * 無いため conflict 状態は返さない（applyConsensusWrites に expectedUpdatedAt は渡らない）
 */
export async function persistConsensusWrite(
  spreadsheetId: string,
  item: QueuedConsensusWrite,
  deps: VerificationDeps,
): Promise<PersistConsensusResult> {
  const queue = deps.decisionQueue ?? sharedDecisionQueue;
  const { decidedBy } = item.consensusParams;
  try {
    await applyConsensusWrites(spreadsheetId, item.consensusWrites, item.consensusParams, deps.google);
  } catch {
    await queue.enqueue(spreadsheetId, decidedBy, item);
    showToast(t('verify.toastQueuedAdjudication'));
    return { status: 'queued' };
  }
  const result = await queue.flush(spreadsheetId, decidedBy, (queued) =>
    saveQueuedItem(spreadsheetId, queued, deps),
  );
  return { status: 'saved', remainingCount: result.remainingCount };
}

/**
 * 保存済みの書き込み（即時保存 + 再送成功分）を、次回保存の楽観ロック期待値へ畳み込む。
 * written は行へ書き込んだ順（先頭 = 即時保存、以降 = flush の再送分が decidedAt 昇順）で
 * 並ぶため、即時保存より古い decidedAt の再送が後から同じ行へ updated_at を書き戻すことが
 * ある。「最後に行へ書かれた値」を追うことで、次回保存が偽陽性の競合にならないようにする
 * （issue #64）。入力を破壊せず新オブジェクトを返す
 */
export function foldDecisionWriteTokens(
  written: readonly QueuedDecisionWrite[],
  tokens: { studyRowUpdatedAt: string | null; resultsRowUpdatedAt: Record<string, string> },
): { studyRowUpdatedAt: string | null; resultsRowUpdatedAt: Record<string, string> } {
  let studyRowUpdatedAt = tokens.studyRowUpdatedAt;
  const resultsRowUpdatedAt = { ...tokens.resultsRowUpdatedAt };
  for (const item of written) {
    if (item.entityLevel === 'study') {
      studyRowUpdatedAt = item.decision.decidedAt;
    } else {
      resultsRowUpdatedAt[resultsCellKeyOf(item.decision.entityKey, item.decision.fieldId)] =
        item.decision.decidedAt;
    }
  }
  return { studyRowUpdatedAt, resultsRowUpdatedAt };
}

/**
 * 群構成の確定・改訂を永続化する。成功時は確定内容（新 version）を返し、
 * 失敗時はトーストで通知して null を返す（判定と違いキュー退避はしない。
 * 再読み込み時は未確定に戻るだけで判定データは失われないため）
 */
export async function persistArmConfirmation(
  spreadsheetId: string,
  input: ConfirmArmStructureInput,
  deps: VerificationDeps,
): Promise<ConfirmedArmStructure | null> {
  try {
    return await appendArmStructureVersion(spreadsheetId, input, deps.google);
  } catch (err) {
    showToast(t('verify.toastArmSaveFailed', { reason: toMessage(err) }));
    return null;
  }
}

/**
 * 人間が追加した entity インスタンス宣言を Decisions へ追記する。
 * セル判定ではないため StudyData / ResultsData の annotator 行は更新しない。
 */
export async function persistInstanceDeclarations(
  spreadsheetId: string,
  decisions: readonly Decision[],
  deps: VerificationDeps,
): Promise<void> {
  if (decisions.length === 0) {
    return;
  }
  if (decisions.some((decision) => !isEntityInstanceDeclaration(decision))) {
    throw new Error('インスタンス宣言ではない Decision が含まれています');
  }
  try {
    await appendDecisionRows(spreadsheetId, decisions, deps.google);
  } catch (err) {
    showToast(t('verify.toastInstanceSaveFailed', { reason: toMessage(err) }));
  }
}
