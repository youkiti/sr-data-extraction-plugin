// view が受け取る共通コンテキスト。view は render(state, ctx) の純粋関数のまま、
// 副作用（サービス呼び出し）はコールバック経由で bootstrap へ委譲する（architecture.md §2.2）

/** #/documents（S3）のユーザー操作コールバック */
export interface DocumentsViewCallbacks {
  /** 「Drive から PDF を取り込む」: Picker 起動 → importDocuments */
  onImport(): void;
  /** 一覧の再読み込み（読込済みでも強制再取得） */
  onReload(): void;
  /** study_label のインライン編集確定 */
  onSaveStudyLabel(documentId: string, label: string): void;
}

export interface ViewContext {
  documents: DocumentsViewCallbacks;
}
