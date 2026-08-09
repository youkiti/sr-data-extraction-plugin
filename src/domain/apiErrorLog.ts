// ApiErrorLog タブに対応する型（issue #249: Google API 失敗の診断ログ）。
// llmApiLog.ts に倣うが、実 I/O は features/ 層ではなく lib/diagnostics/apiErrorLog.ts に置く。
// `lib/` から `features/` を import できない（import/no-restricted-paths。architecture.md §2.1）
// ため、lib/google/drive.ts を計装する本機能は lib 層に閉じる必要があるための特殊構成

/**
 * 失敗を検知した経路（呼び出し元の操作の種別）。
 * - pdf_load: PDF ビューアが Drive からバイナリを取得する経路（lib/google/drive.ts の getFileBinary）
 * - evidence_append: AI 抽出の根拠を Evidence タブへ追記する経路
 * - decision_save: 人間の判定を Decisions タブへ追記する経路
 * - annotation_upsert: StudyData / ResultsData の annotator 行 upsert（判定保存・ai 転記の共通経路）
 */
export type ApiErrorLogContext =
  | 'pdf_load'
  | 'evidence_append'
  | 'decision_save'
  | 'annotation_upsert';

export interface ApiErrorLogEntry {
  logId: string;
  /** ISO 8601。失敗が発生した時刻（シートへ書き込んだ／フラッシュした時刻ではない） */
  occurredAt: string;
  /** サインイン中のメール（annotator と同じ値）。未設定（configureApiErrorLog 未呼び出し）時は空文字 */
  loggedBy: string;
  context: ApiErrorLogContext;
  /** 'drive.files.get' / 'sheets.values.append' のような API 名。URL そのものは載せない */
  api: string;
  /** ネットワーク層の失敗（fetch 自体が reject）は null */
  httpStatus: number | null;
  /** 打ち切り済みのエラーメッセージ（API_ERROR_LOG_MESSAGE_MAX_LENGTH で truncate 済み） */
  message: string;
  studyId: string | null;
  documentId: string | null;
  /** googleFetch が最終的に諦めるまでに行った再試行回数 */
  retryCount: number;
  appVersion: string;
}
