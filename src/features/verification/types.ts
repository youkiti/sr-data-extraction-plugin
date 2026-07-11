// 検証パネル（S6 埋め込み / S8 単独）の入力データ束。
// サービス層（verificationService.loadStudyVerificationBundle）が組み立て、verificationPanel が消費する。
// v0.10 フェーズ 3: 抽出・検証・エクスポートの単位は study（試験）。1 study は複数の document（PDF）で
// 報告されうるため、PDF・テキスト層・ハイライトは document 単位、判定・セルモデルは study 単位で扱う
//
// issue #28 案3: PDF（バイナリ → pdfjs → テキスト層）は表示中の 1 文書だけを遅延読込する。
// bundle 組み立て時（loadVerificationBundle）に読むのは軽量な extracted_texts（.txt）だけで、
// PDF バイナリは 1 件も読まない。文書ごとの重い PDF 素材は `loadPdfView` を通じて必要になった
// ときだけ取得し、直近 PDF_CACHE_SIZE 件を features/verification/pdfViewCache がキャッシュする
import type { ConfirmedArmStructure } from '../../domain/armStructure';
import type { Decision } from '../../domain/decision';
import type { DocumentRecord } from '../../domain/document';
import type { Evidence } from '../../domain/evidence';
import type { SchemaField } from '../../domain/schemaField';
import type { StudyRecord } from '../../domain/study';
import type { LoadedPdfView } from './pdfViewCache';

export type { LoadedPdfView } from './pdfViewCache';

/** extractedPages が読む最小限のページ構造（TextLayerPage の構造的サブセット） */
export interface ExtractedPage {
  /** 1-indexed ページ番号 */
  page: number;
  text: string;
}

/**
 * study 配下の 1 文書ぶんの軽量素材（bundle 組み立て時に全文書ぶん先読みする）。
 * PDF バイナリは含まない — extracted_texts（Drive の .txt。document.textRef）由来の
 * ページ別テキストのみ。PDF ビューア素材は VerificationData.loadPdfView で別途遅延読込する
 */
export interface VerificationDocumentView {
  document: DocumentRecord;
  /** extracted_texts のページ別テキスト（no_text_layer・読込失敗は空配列） */
  extractedPages: readonly ExtractedPage[];
  /** extracted_texts の読込に失敗した理由（成功・対象外なら null。UI 表示は必須ではない） */
  extractedTextError: string | null;
}

export interface VerificationData {
  /** 検証単位の study（Studies 由来。study_label / registration_id を保持） */
  study: StudyRecord;
  /**
   * study 配下の文書の軽量素材（role 固定順 → 取り込み順）。
   * 1 件以上。ハイライト・検索・PDF 表示は Evidence.document_id が指す文書に対して行う
   */
  documents: readonly VerificationDocumentView[];
  /** 当該 run の schema_version の全項目 */
  fields: readonly SchemaField[];
  /** study の全文書ぶんの AI 根拠（表示中の run のもの。各行は document_id で出所を持つ） */
  evidence: readonly Evidence[];
  /** 当該 study の判定履歴（全 annotator。パネル側で自分の行に絞る） */
  decisions: readonly Decision[];
  /** 自分（判定者）の email。annotator 行の annotator になる */
  annotator: string;
  /**
   * 判定を書き込む annotator_type（独立二重レビュー機能。design §5.2）。
   * ロールから導出する（`domain/reviewer.ts` の `annotatorTypeForRole`）。
   * `human_independent` のときパネルは独立入力モード（panelMode）で描画する
   */
  annotatorType: 'human_with_ai' | 'human_independent';
  schemaVersion: number;
  /**
   * 自分が確定した群構成（ArmStructures の最新 version）。null = 未確定で、
   * arm / outcome_result レベル項目があるスキーマでは該当タブをディムし確定カードを出す
   */
  armStructure: ConfirmedArmStructure | null;
  /**
   * documentId 1 件ぶんの PDF ビューア素材（バイナリ → pdfjs → テキスト層）を遅延読込する。
   * 表示中の文書だけを呼び出すこと（パネルが担う）。内部で LRU キャッシュ + in-flight
   * 重複排除を行うため、同じ documentId への複数回呼び出しは安全（throw しない設計）
   */
  loadPdfView(documentId: string): Promise<LoadedPdfView>;
  /** documentId の PDF 読込を再試行する（失敗時のキャッシュを捨てて読み直す） */
  retryPdfView(documentId: string): Promise<LoadedPdfView>;
  /** 差し替え時にサービス層が呼ぶ後始末（PDF キャッシュ全体の pdfjs destroy）。パネルは触らない */
  disposePdf?: () => Promise<void>;
}
