// 検証パネル（S6 埋め込み / S8 単独）の入力データ束。
// サービス層（verificationService.loadStudyVerificationBundle）が組み立て、verificationPanel が消費する。
// v0.10 フェーズ 3: 抽出・検証・エクスポートの単位は study（試験）。1 study は複数の document（PDF）で
// 報告されうるため、PDF・テキスト層・ハイライトは document 単位、判定・セルモデルは study 単位で扱う
import type { ConfirmedArmStructure } from '../../domain/armStructure';
import type { Decision } from '../../domain/decision';
import type { DocumentRecord } from '../../domain/document';
import type { Evidence } from '../../domain/evidence';
import type { SchemaField } from '../../domain/schemaField';
import type { StudyRecord } from '../../domain/study';
import type { TextLayerPage } from '../../domain/textLayer';
import type { PdfViewerDocument } from '../../lib/pdf/renderPage';

/** study 配下の 1 文書ぶんのビューア素材（PDF + テキスト層）。role 固定順に並ぶ */
export interface VerificationDocumentView {
  document: DocumentRecord;
  /** PDF ドキュメント。読み込み失敗時は null + pdfError */
  pdf: PdfViewerDocument | null;
  pdfError: string | null;
  /** PDF テキスト層（ハイライト・検索の素材）。読み込み失敗・テキスト層なしは空配列 */
  textPages: readonly TextLayerPage[];
}

export interface VerificationData {
  /** 検証単位の study（Studies 由来。study_label / registration_id を保持） */
  study: StudyRecord;
  /**
   * study 配下の文書ビューア素材（role 固定順 → 取り込み順）。
   * 1 件以上。ハイライト・検索・PDF 表示は Evidence.document_id が指す文書に対して行う
   */
  documents: readonly VerificationDocumentView[];
  /** 当該 run の schema_version の全項目 */
  fields: readonly SchemaField[];
  /** study の全文書ぶんの AI 根拠（表示中の run のもの。各行は document_id で出所を持つ） */
  evidence: readonly Evidence[];
  /** 当該 study の判定履歴（全 annotator。パネル側で自分の行に絞る） */
  decisions: readonly Decision[];
  /** 自分（判定者）の email。human_with_ai 行の annotator になる */
  annotator: string;
  schemaVersion: number;
  /**
   * 自分が確定した群構成（ArmStructures の最新 version）。null = 未確定で、
   * arm / outcome_result レベル項目があるスキーマでは該当タブをディムし確定カードを出す
   */
  armStructure: ConfirmedArmStructure | null;
  /** 差し替え時にサービス層が呼ぶ後始末（全文書の pdfjs destroy）。パネルは触らない */
  disposePdf?: () => Promise<void>;
}
