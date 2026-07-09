// Documents タブに対応する型（requirements.md §3.2）。runtime 依存ゼロの純粋型

/**
 * テキスト層の抽出状態。
 * no_text_layer はスキャン PDF で、pdf_native モードでのみ抽出可・アンカリング / ハイライト不可（※Q7）
 */
export type TextStatus = 'ok' | 'partial' | 'no_text_layer';

/**
 * 文書のロール（§3.2 v0.10）。取り込み時の既定は `article`、S3 で編集可。
 * article（本論文）/ registration（試験登録）/ protocol（プロトコル論文・SAP）/
 * abstract（学会抄録）/ supplement（付録・補遺）/ other
 */
export type DocumentRole =
  | 'article'
  | 'registration'
  | 'protocol'
  | 'abstract'
  | 'supplement'
  | 'other';

/**
 * role の固定順（§4.3）。プロンプト連結（フェーズ 2）と S3 のグループ表示（フェーズ 1）で共有する
 * 唯一の定義。並びは article → registration → protocol → abstract → supplement → other
 */
export const DOCUMENT_ROLE_ORDER: readonly DocumentRole[] = [
  'article',
  'registration',
  'protocol',
  'abstract',
  'supplement',
  'other',
];

/** 取り込み時の既定ロール */
export const DEFAULT_DOCUMENT_ROLE: DocumentRole = 'article';

/** role の日本語表示ラベル（検証の文書切替タブなど UI 共通。§3.2） */
export const DOCUMENT_ROLE_LABELS: Record<DocumentRole, string> = {
  article: '本論文',
  registration: '試験登録',
  protocol: 'プロトコル',
  abstract: '学会抄録',
  supplement: '付録・補遺',
  other: 'その他',
};

/** 1 行 = 1 文書（PDF）。試験への所属は study_id で表す */
export interface DocumentRecord {
  documentId: string;
  /** 所属する試験（Studies）。取り込み時は自動生成した 1 文書 study を指し、統合で付け替わる（§4.5） */
  studyId: string;
  /** 文書のロール（§3.2）。取り込み時の既定は article、S3 で編集可 */
  documentRole: DocumentRole;
  /** documents/ 配下のプロジェクト内コピー（凍結スナップショット ※Q9）。表示・抽出・監査はこちらを参照 */
  driveFileId: string;
  /** Picker で選択した元 PDF（出所の記録用。原本が動いても動作に影響しない） */
  sourceFileId: string;
  filename: string;
  pmid: string | null;
  doi: string | null;
  /** extracted_texts/{document_id}.txt の Drive URL。text_status = no_text_layer の場合のみ null */
  textRef: string | null;
  textStatus: TextStatus;
  pageCount: number | null;
  charCount: number | null;
  importedAt: string;
  importedBy: string;
  note: string | null;
}
