// S6（#/pilot 埋め込み）と S8（#/verify 単独）で共有する検証サービス基盤。
// - 検証データ束（VerificationData）の組み立て: Decisions / StudyData / ArmStructures +
//   extracted_texts（軽量な .txt。study 全文書ぶんを先読み）。
//   PDF バイナリはここでは 1 件も読まない（issue #28 案3）— VerificationData.loadPdfView
//   が表示中の文書だけを遅延読込する（features/verification/pdfViewCache が LRU キャッシュ）
// - 判定の永続化: 自分の annotator 行（StudyData / ResultsData）の upsert + Decisions 追記。
//   失敗時はオフラインキュー（lib/storage/offlineQueue の 'decisions'）へ退避し、成功時に再送する
// - 群構成確定の永続化: ArmStructures へ新 version を追記（キュー退避なし。失敗はトーストで通知）
import { NOT_REPORTED_TOKEN } from '../../domain/annotation';
import type { ConfirmedArmStructure } from '../../domain/armStructure';
import type { Decision } from '../../domain/decision';
import type { DocumentRecord } from '../../domain/document';
import type { Evidence } from '../../domain/evidence';
import type { EntityLevel, SchemaField } from '../../domain/schemaField';
import type { StudyRecord } from '../../domain/study';
import type { DisposablePdfDocument } from '../../features/documents/extractTextLayer';
import { parseExtractedText } from '../../features/documents/extractedText';
import { parseDriveFileId } from '../../features/documents/loadDocumentPages';
import { readStudyDataSheet, upsertResultsDataRows, upsertStudyDataRows } from '../../features/extraction/annotationRepository';
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

/** 検証基盤の共有依存（pilotService / verifyService の deps はこれを拡張する） */
export interface VerificationDeps {
  google: GoogleApiDeps;
  profile: ProfileDeps;
  /** lib/pdf/loadPdf.ts（テストは fake で完結させるため注入） */
  loadPdf: (data: ArrayBuffer) => Promise<DisposablePdfDocument>;
  /** テスト差し替え用のオフラインキュー（既定はモジュール共有の 'decisions' キュー） */
  decisionQueue?: OfflineQueue<QueuedDecisionWrite>;
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

/** キュー項目の同定キー（同じ判定の再 enqueue は置換 = upsert になる） */
export function decisionWriteId(item: QueuedDecisionWrite): string {
  return `${item.decision.decidedAt}|${item.decision.fieldId}|${item.decision.entityKey}`;
}

/** flush の再送順（判定した時刻の昇順） */
export function decisionWriteSortKey(item: QueuedDecisionWrite): string {
  return item.decision.decidedAt;
}

/** モジュール共有の判定キュー（用途名 'decisions'。spreadsheetId × userEmail で分離される） */
export const sharedDecisionQueue = createOfflineQueue<QueuedDecisionWrite>({
  name: 'decisions',
  getId: decisionWriteId,
  getSortKey: decisionWriteSortKey,
});

function toMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
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
      extractedTextError: `text_ref からファイル ID を解決できません: ${document.textRef}`,
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
  const studyValues =
    studySheet.rows.find(
      (row) => row.studyId === study.studyId && row.annotator === annotator,
    )?.values ?? {};
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
        pdfError: `document_id "${documentId}" が study 配下の文書に見つかりません`,
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
        pdfError: `document_id "${documentId}" が study 配下の文書に見つかりません`,
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
    schemaVersion: input.schemaVersion,
    armStructure,
    loadPdfView,
    retryPdfView,
    disposePdf,
  };
  const layoutMode = await (deps.loadVerifyLayoutMode ?? loadVerifyLayoutMode)();
  return { verification, studyValues, layoutMode };
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

/** 判定書き込みの実体（オフライン再送でも同じ経路を通す）。annotator 行 → Decisions の順 */
export async function saveDecisionWrite(
  spreadsheetId: string,
  write: QueuedDecisionWrite,
  deps: VerificationDeps,
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
  | { status: 'saved'; remainingCount: number };

/**
 * 検証パネルの判定 1 操作を永続化する（requirements.md §4.2「判定ごとに即時書き込み」）。
 * パネル側は楽観更新済みのため、失敗時はオフラインキューへ退避して後で再送する。
 * 保存が通ったら過去の退避分も再送する（tiab-review と同じ復帰動作）
 */
export async function persistDecisionWrite(
  spreadsheetId: string,
  write: QueuedDecisionWrite,
  deps: VerificationDeps,
): Promise<PersistDecisionResult> {
  const queue = deps.decisionQueue ?? sharedDecisionQueue;
  try {
    await saveDecisionWrite(spreadsheetId, write, deps);
  } catch {
    await queue.enqueue(spreadsheetId, write.decision.annotator, write);
    showToast('保存に失敗したため、判定をオフラインキューへ退避しました（復帰後に再送されます）');
    return { status: 'queued' };
  }
  const result = await queue.flush(spreadsheetId, write.decision.annotator, (item) =>
    saveDecisionWrite(spreadsheetId, item, deps),
  );
  return { status: 'saved', remainingCount: result.remainingCount };
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
    showToast(`群構成の保存に失敗しました: ${toMessage(err)}`);
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
    showToast(`インスタンス宣言の保存に失敗しました: ${toMessage(err)}`);
  }
}
