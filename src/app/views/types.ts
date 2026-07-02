// view が受け取る共通コンテキスト。view は render(state, ctx) の純粋関数のまま、
// 副作用（サービス呼び出し）はコールバック経由で bootstrap へ委譲する（architecture.md §2.2）
import type { ProtocolSubmitInput } from '../../features/protocol/submitInput';

/** #/documents（S3）のユーザー操作コールバック */
export interface DocumentsViewCallbacks {
  /** 「Drive から PDF を取り込む」: Picker 起動 → importDocuments */
  onImport(): void;
  /** 一覧の再読み込み（読込済みでも強制再取得） */
  onReload(): void;
  /** study_label のインライン編集確定 */
  onSaveStudyLabel(documentId: string, label: string): void;
}

/** #/protocol（S4）のユーザー操作コールバック */
export interface ProtocolViewCallbacks {
  /** フォーム送信（手入力 / md / docx）: パース → Drive 退避 → Protocol タブへ追記 */
  onSubmit(input: ProtocolSubmitInput): void;
  /** 「新しい版を入力」: 読み取り専用 → 再入力フォームへ */
  onStartEdit(): void;
  /** 再入力フォームのキャンセル: 読み取り専用へ戻る */
  onCancelEdit(): void;
  /** バージョン切替 select の変更 */
  onSelectVersion(version: number): void;
  /** 一覧の再読み込み（読込済みでも強制再取得） */
  onReload(): void;
}

export interface ViewContext {
  documents: DocumentsViewCallbacks;
  protocol: ProtocolViewCallbacks;
}
