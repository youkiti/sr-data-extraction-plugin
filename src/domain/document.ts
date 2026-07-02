// Documents タブに対応する型（requirements.md §3.2）。runtime 依存ゼロの純粋型

/**
 * テキスト層の抽出状態。
 * no_text_layer はスキャン PDF で、pdf_native モードでのみ抽出可・アンカリング / ハイライト不可（※Q7）
 */
export type TextStatus = 'ok' | 'partial' | 'no_text_layer';

/** 1 行 = 1 論文 */
export interface DocumentRecord {
  documentId: string;
  /** 表示・CSV 用の研究ラベル（例: `Smith 2020`）。AI が書誌から提案、ユーザー編集可 */
  studyLabel: string;
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
