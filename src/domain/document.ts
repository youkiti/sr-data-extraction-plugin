// Documents タブに対応する型（requirements.md §3.2）。runtime 依存ゼロの純粋型

/**
 * テキスト層の抽出状態。
 * no_text_layer はスキャン PDF で、pdf_native モード（ページ画像添付）で抽出。アンカリングは
 * 不可だが、Gemini 系 run では AI 推定の bbox ハイライトを表示できる（※Q7 改訂）
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

/**
 * 除外理由（issue #181: 文献除外機能）。
 * ineligible（対象外と判明）/ duplicate（重複）/ mis_imported（誤って取り込んだ）/
 * on_hold（保留）/ other（その他・自由記述で補足）
 */
export type ExclusionReason = 'ineligible' | 'duplicate' | 'mis_imported' | 'on_hold' | 'other';

/**
 * exclusionReason の固定順（issue #181）。S3 のプルダウン表示等で共有する唯一の定義
 */
export const EXCLUSION_REASON_ORDER: readonly ExclusionReason[] = [
  'ineligible',
  'duplicate',
  'mis_imported',
  'on_hold',
  'other',
];

/** exclusionReason の日本語表示ラベル（issue #181） */
export const EXCLUSION_REASON_LABELS: Record<ExclusionReason, string> = {
  ineligible: '対象外と判明（不適格）',
  duplicate: '重複',
  mis_imported: '誤って取り込んだ',
  on_hold: '保留',
  other: 'その他（自由記述で補足）',
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
  /**
   * Picker で選択した元 PDF（出所の記録用。原本が動いても動作に影響しない）。
   * ローカル取り込み（D&D / ファイル選択）は出所 Drive ファイルが無いため null
   */
  sourceFileId: string | null;
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
  /** 抽出候補から除外中か（true=除外中）。issue #181。解除で false に戻す */
  excluded: boolean;
  /** 直近の除外理由（issue #181）。解除後も残す */
  exclusionReason: ExclusionReason | null;
  /** 除外の自由記述（issue #181）。解除後も残す */
  exclusionNote: string | null;
  /** 直近の除外操作日時（ISO。issue #181）。解除後も残す */
  excludedAt: string | null;
}
