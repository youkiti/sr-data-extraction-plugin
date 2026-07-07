// Studies タブに対応する型（requirements.md §3.2 v0.10）。study（試験）は抽出・検証・
// エクスポートの単位。1 行 = 1 試験（trial）。グルーピング変更のたびに新しい study_id の
// 行を追記し、旧行は監査用に残置する（§4.5）。study_label / registration_id / note は行内編集可

/** 1 行 = 1 試験（trial） */
export interface StudyRecord {
  studyId: string;
  /** 表示・CSV 用の研究ラベル（例: `Smith 2020`）。AI が書誌から提案、ユーザー編集可（v0.10 で Documents から移設） */
  studyLabel: string;
  /** 試験登録番号（例: `NCT01234567`）。取り込み時の自動検出（§4.5）を初期値にユーザー編集可 */
  registrationId: string | null;
  createdAt: string;
  createdBy: string;
  note: string | null;
}
