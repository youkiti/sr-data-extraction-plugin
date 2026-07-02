// S6（#/pilot 埋め込み）と S8（#/verify 単独）で共有する検証サービス基盤。
// - 検証データ束（VerificationData）の組み立て: Decisions / StudyData / ArmStructures +
//   PDF（バイナリ → pdfjs → テキスト層）の読み込み
// - 判定の永続化: 自分の annotator 行（StudyData / ResultsData）の upsert + Decisions 追記。
//   失敗時はオフラインキュー（lib/storage/offlineQueue の 'decisions'）へ退避し、成功時に再送する
// - 群構成確定の永続化: ArmStructures へ新 version を追記（キュー退避なし。失敗はトーストで通知）
import { NOT_REPORTED_TOKEN } from '../../domain/annotation';
import type { ConfirmedArmStructure } from '../../domain/armStructure';
import type { Decision } from '../../domain/decision';
import type { DocumentRecord } from '../../domain/document';
import type { Evidence } from '../../domain/evidence';
import type { EntityLevel, SchemaField } from '../../domain/schemaField';
import type { DisposablePdfDocument } from '../../features/documents/extractTextLayer';
import { readStudyDataSheet, upsertResultsDataRows, upsertStudyDataRows } from '../../features/extraction/annotationRepository';
import {
  appendArmStructureVersion,
  latestArmStructure,
  readArmStructuresByDocument,
  type ConfirmArmStructureInput,
} from '../../features/verification/armStructureRepository';
import {
  appendDecisionRows,
  readDecisionsByDocument,
} from '../../features/verification/decisionRepository';
import type { VerificationData } from '../../features/verification/types';
import { getFileBinary } from '../../lib/google/drive';
import { getCurrentUserEmail, type ProfileDeps } from '../../lib/google/identity';
import type { GoogleApiDeps } from '../../lib/google/types';
import type { PdfViewerDocument, RenderablePdfPage } from '../../lib/pdf/renderPage';
import { extractTextLayerPages } from '../../lib/pdf/textLayer';
import { createOfflineQueue, type OfflineQueue } from '../../lib/storage/offlineQueue';
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

/** DisposablePdfDocument → ビューア用の最小形。render の viewport 型は実体が同一のため安全 */
function toViewerDocument(pdf: DisposablePdfDocument): PdfViewerDocument {
  return {
    numPages: pdf.numPages,
    getPage: (pageNumber) => pdf.getPage(pageNumber) as unknown as Promise<RenderablePdfPage>,
  };
}

export interface VerificationBundleInput {
  spreadsheetId: string;
  document: DocumentRecord;
  /** 表示する run のスキーマ項目（呼び出し側が版を解決して渡す） */
  fields: readonly SchemaField[];
  /** 当該 document の AI 根拠（表示する run のもの） */
  evidence: readonly Evidence[];
  schemaVersion: number;
}

export interface VerificationBundle {
  verification: VerificationData;
  /** 自分の StudyData 行の values 全量（判定時のスナップショット更新用） */
  studyValues: Record<string, string | null>;
}

/**
 * 検証パネルへ流し込むデータ束を読み込む（S6 / S8 共通）。
 * PDF の読み込み失敗は throw せず pdfError として持ち、フォーム側の検証は続行できる
 */
export async function loadVerificationBundle(
  input: VerificationBundleInput,
  deps: VerificationDeps,
): Promise<VerificationBundle> {
  const { spreadsheetId, document } = input;
  const annotator = (await getCurrentUserEmail(deps.profile)) ?? '';
  const decisions = await readDecisionsByDocument(spreadsheetId, document.documentId, deps.google);
  const studySheet = await readStudyDataSheet(spreadsheetId, deps.google);
  const studyValues =
    studySheet.rows.find(
      (row) => row.documentId === document.documentId && row.annotator === annotator,
    )?.values ?? {};
  const armRows = await readArmStructuresByDocument(spreadsheetId, document.documentId, deps.google);
  const armStructure = latestArmStructure(armRows, annotator);

  let pdf: PdfViewerDocument | null = null;
  let pdfError: string | null = null;
  let textPages: VerificationData['textPages'] = [];
  let disposePdf: VerificationData['disposePdf'];
  try {
    const binary = await getFileBinary(document.driveFileId, deps.google);
    const disposable = await deps.loadPdf(binary);
    textPages = await extractTextLayerPages(disposable);
    pdf = toViewerDocument(disposable);
    disposePdf = async () => {
      await disposable.destroy();
    };
  } catch (err) {
    pdfError = toMessage(err);
  }

  const verification: VerificationData = {
    document,
    fields: input.fields,
    evidence: input.evidence,
    decisions,
    annotator,
    schemaVersion: input.schemaVersion,
    armStructure,
    pdf,
    pdfError,
    textPages,
    disposePdf,
  };
  return { verification, studyValues };
}

/** 判定書き込みの実体（オフライン再送でも同じ経路を通す）。annotator 行 → Decisions の順 */
export async function saveDecisionWrite(
  spreadsheetId: string,
  write: QueuedDecisionWrite,
  deps: VerificationDeps,
): Promise<void> {
  const { decision } = write;
  if (write.studyValues !== null) {
    await upsertStudyDataRows(
      spreadsheetId,
      [
        {
          documentId: decision.documentId,
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
          documentId: decision.documentId,
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
