// view が受け取る共通コンテキスト。view は render(state, ctx) の純粋関数のまま、
// 副作用（サービス呼び出し）はコールバック経由で bootstrap へ委譲する（architecture.md §2.2）
import type { Decision } from '../../domain/decision';
import type { ProtocolSubmitInput } from '../../features/protocol/submitInput';
import type { OutcomePresetKind } from '../../features/schema/presets/outcomeTemplates';
import type { SchemaEditorRow } from '../../features/schema/types';

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

/** #/schema（S5）のユーザー操作コールバック */
export interface SchemaViewCallbacks {
  /** 一覧（SchemaVersions + 現行版）の再読み込み */
  onReload(): void;
  /** サンプル論文チェックボックスの切替（最大 3 本） */
  onToggleSample(documentId: string, selected: boolean): void;
  /** requested_model の変更 */
  onChangeModel(model: string): void;
  /** 「AI にスキーマをドラフトさせる」 */
  onRunDraft(): void;
  /** エディタ行の編集確定（change イベント単位） */
  onEditRow(index: number, patch: Partial<SchemaEditorRow>): void;
  onAddRow(): void;
  onRemoveRow(index: number): void;
  /** 二値 / 連続アウトカムのプリセット挿入 */
  onInsertPreset(kind: OutcomePresetKind): void;
  /** 「版として確定」（note = 改訂理由） */
  onConfirm(note: string): void;
  onCancelEditor(): void;
  /** 確定済み画面の「新しい版を作る」 */
  onStartNewVersion(): void;
}

/** #/pilot（S6）のユーザー操作コールバック */
export interface PilotViewCallbacks {
  /** 対象文献チェックボックスの切替（最大 3 本） */
  onToggleDocument(documentId: string, selected: boolean): void;
  /** requested_model の変更 */
  onChangeModel(model: string): void;
  /** 「パイロット抽出を実行」 */
  onRun(): void;
  /** 埋め込み検証 UI の対象文献切替 */
  onSelectVerifyDocument(documentId: string): void;
  /** 検証データ読み込み失敗時の再試行 */
  onRetryVerifyLoad(): void;
  /** 検証パネルの判定 1 操作（annotator 行の更新 + Decisions 追記） */
  onDecision(decision: Decision): void;
  /** 群構成の確定・改訂（ArmStructures へ新 version を追記） */
  onArmConfirm(arms: readonly { armKey: string; armName: string }[]): void;
}

/** #/verify（S8）のユーザー操作コールバック */
export interface VerifyViewCallbacks {
  /** document セレクタの切替（URL ?doc= と同期する） */
  onSelectDocument(documentId: string): void;
  /** 一覧読み込み失敗時の再試行 */
  onRetryLoad(): void;
  /** 検証パネルの判定 1 操作（annotator 行の更新 + Decisions 追記） */
  onDecision(decision: Decision): void;
  /** 群構成の確定・改訂（ArmStructures へ新 version を追記） */
  onArmConfirm(arms: readonly { armKey: string; armName: string }[]): void;
}

export interface ViewContext {
  documents: DocumentsViewCallbacks;
  protocol: ProtocolViewCallbacks;
  schema: SchemaViewCallbacks;
  pilot: PilotViewCallbacks;
  verify: VerifyViewCallbacks;
}
