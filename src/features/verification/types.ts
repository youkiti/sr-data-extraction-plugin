// 検証パネル（S6 埋め込み / S8 単独）の入力データ束。
// サービス層（verificationService.loadVerificationBundle）が組み立て、verificationPanel が消費する
import type { ConfirmedArmStructure } from '../../domain/armStructure';
import type { Decision } from '../../domain/decision';
import type { DocumentRecord } from '../../domain/document';
import type { Evidence } from '../../domain/evidence';
import type { SchemaField } from '../../domain/schemaField';
import type { TextLayerPage } from '../../domain/textLayer';
import type { PdfViewerDocument } from '../../lib/pdf/renderPage';

export interface VerificationData {
  document: DocumentRecord;
  /** 当該 run の schema_version の全項目 */
  fields: readonly SchemaField[];
  /** 当該 document の AI 根拠（表示中の run のもの） */
  evidence: readonly Evidence[];
  /** 当該 document の判定履歴（全 annotator。パネル側で自分の行に絞る） */
  decisions: readonly Decision[];
  /** 自分（判定者）の email。human_with_ai 行の annotator になる */
  annotator: string;
  schemaVersion: number;
  /**
   * 自分が確定した群構成（ArmStructures の最新 version）。null = 未確定で、
   * arm / outcome_result レベル項目があるスキーマでは該当タブをディムし確定カードを出す
   */
  armStructure: ConfirmedArmStructure | null;
  /** PDF ドキュメント。読み込み失敗時は null + pdfError */
  pdf: PdfViewerDocument | null;
  pdfError: string | null;
  /** PDF テキスト層（ハイライト・検索の素材）。読み込み失敗・テキスト層なしは空配列 */
  textPages: readonly TextLayerPage[];
  /** 差し替え時にサービス層が呼ぶ後始末（pdfjs の destroy）。パネルは触らない */
  disposePdf?: () => Promise<void>;
}
