// view が受け取る共通コンテキスト。view は render(state, ctx) の純粋関数のまま、
// 副作用（サービス呼び出し）はコールバック経由で bootstrap へ委譲する（architecture.md §2.2）
import type { Decision } from '../../domain/decision';
import type { DocumentRole } from '../../domain/document';
import type { Evidence } from '../../domain/evidence';
import type { ExportFormat } from '../../domain/exportLog';
import type { ReviewMode } from '../../domain/reviewer';
import type { MethodsLanguage, MethodsWorkflow } from '../../features/export/methodsBoilerplate';
import type { ProtocolSubmitInput } from '../../features/protocol/submitInput';
import type { SchemaPresetKind } from '../../features/schema/presets';
import type { SchemaEditorRow } from '../../features/schema/types';
import type { VerifyLayoutMode } from '../../lib/storage/settingsStore';
import type { RelocateQuoteOutcome } from '../services/relocateQuoteService';

/** #/home のユーザー操作コールバック（owner のレビュアー管理カード + reviewer の縮退版 Home を含む） */
export interface HomeViewCallbacks {
  /** 進捗カウント読込失敗時の再読み込み（force 再取得。owner のみ） */
  onReload(): void;
  /** reviewer 系: プロジェクトフォルダへのアクセス付与（Picker → 到達性確認。§7.2） */
  onGrantFolderAccess(): void;
  /** owner: レビュアー一覧の再読み込み */
  onReloadReviewers(): void;
  /** owner: レビュアー追加フォームの送信（既存 reviewer のモード変更は確認ダイアログを挟む） */
  onAddReviewer(input: { email: string; role: 'reviewer' | 'adjudicator'; reviewMode: ReviewMode }): void;
  /** owner: モード変更確認ダイアログの「続行」 */
  onConfirmReviewerChange(): void;
  /** owner: モード変更確認ダイアログの「キャンセル」 */
  onCancelReviewerChange(): void;
  /** owner: レビュアーの登録解除（revoked 行の追記） */
  onRevokeReviewer(email: string): void;
  /** owner: レビュー相手への依頼文をクリップボードへコピー */
  onCopyInvite(email: string): void;
}

/** #/documents（S3）のユーザー操作コールバック */
export interface DocumentsViewCallbacks {
  /** 「Drive から PDF を取り込む」: Picker 起動 → importDocuments */
  onImport(): void;
  /** ローカル PDF の取り込み（D&D / ファイル選択ダイアログ経由） */
  onImportFiles(files: File[]): void;
  /** 一覧の再読み込み（読込済みでも強制再取得） */
  onReload(): void;
  /** study_label のインライン編集確定（Studies 行の上書き） */
  onSaveStudyLabel(studyId: string, label: string): void;
  /** registration_id のインライン編集確定（空は解除） */
  onSaveRegistrationId(studyId: string, registrationId: string): void;
  /** document_role のインライン編集確定（Documents 行の上書き） */
  onSaveDocumentRole(documentId: string, role: DocumentRole): void;
  /** 統合対象チェックボックスの切替 */
  onToggleStudySelection(studyId: string, selected: boolean): void;
  /** 選択中 study からの統合ダイアログを開く（2 件以上） */
  onOpenMerge(): void;
  /** 統合候補バナーからの統合ダイアログを開く */
  onOpenMergeCandidate(studyIds: readonly string[]): void;
  /** 統合候補を無視する（storage.local へ永続化） */
  onIgnoreCandidate(studyIds: readonly string[]): void;
  /** 統合ダイアログの study_label 入力 */
  onUpdateMergeLabel(label: string): void;
  /** 統合ダイアログの registration_id 入力 */
  onUpdateMergeRegistration(registrationId: string): void;
  /** 統合の確定（新 study_id 発行 + Documents 付け替え） */
  onConfirmMerge(): void;
  /** 統合ダイアログのキャンセル */
  onCancelMerge(): void;
  /** tiab-review 採用リスト取り込みカード（issue #68）を開く */
  onTiabOpen(): void;
  /** 同カードを閉じる（入力・プレビューを破棄） */
  onTiabClose(): void;
  /** tiab-review シートの読み込み → include 抽出 → 反映プレビュー計算 */
  onTiabPreview(sheetInput: string): void;
  /** プレビューの反映（Studies 上書き + Documents 転記）を実行 */
  onTiabApply(): void;
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
  /** 「AI に表のデザインをドラフトさせる」 */
  onRunDraft(): void;
  /** エディタ行の編集確定（change イベント単位） */
  onEditRow(index: number, patch: Partial<SchemaEditorRow>): void;
  onAddRow(): void;
  onRemoveRow(index: number): void;
  /** プリセット挿入（二値 / 連続アウトカム・RoB 2 / ROBINS-I） */
  onInsertPreset(kind: SchemaPresetKind): void;
  /** 「版として確定」（note = 改訂理由） */
  onConfirm(note: string): void;
  onCancelEditor(): void;
  /** 確定済み画面の「新しい版を作る」 */
  onStartNewVersion(): void;
}

/** #/pilot（S6）のユーザー操作コールバック */
export interface PilotViewCallbacks {
  /** 対象 study チェックボックスの切替（最大 3 study） */
  onToggleStudy(studyId: string, selected: boolean): void;
  /** requested_model の変更 */
  onChangeModel(model: string): void;
  /** 抽出対象フィールドのチェックリスト（issue #80）: 単一項目の切替 */
  onToggleField(fieldId: string, selected: boolean): void;
  /** 抽出対象フィールドのチェックリスト: section 見出しの全選択 / 全解除トグル */
  onToggleFieldSection(fieldIds: readonly string[], selected: boolean): void;
  /** 抽出対象フィールドのチェックリスト: section の折りたたみ切替 */
  onToggleFieldSectionCollapse(section: string): void;
  /** 「パイロット抽出を実行」 */
  onRun(): void;
  /** 過去のパイロット結果を履歴から読み込む */
  onSelectRun(runId: string): void;
  /** 履歴の読み込み失敗時の再読み込み */
  onReloadHistory(): void;
  /** 埋め込み検証 UI の対象 study 切替 */
  onSelectVerifyStudy(studyId: string): void;
  /** 検証データ読み込み失敗時の再試行 */
  onRetryVerifyLoad(): void;
  /** 検証パネルの判定 1 操作（annotator 行の更新 + Decisions 追記） */
  onDecision(decision: Decision): void;
  /** 群構成の確定・改訂（ArmStructures へ新 version を追記） */
  onArmConfirm(arms: readonly { armKey: string; armName: string }[]): void;
  /** 人間が追加した entity インスタンス宣言（Decisions へ追記） */
  onInstanceDeclare?(decisions: readonly Decision[]): void;
  /** 検証パネルのレイアウトモード切替（フォーカス ⇄ リスト。issue #38）の永続化 */
  onChangeLayoutMode(mode: VerifyLayoutMode): void;
  /** 保存の競合検出バナー（issue #64）の「再読み込み」: 埋め込み検証データ束を読み直す */
  onReloadVerification(): void;
  /**
   * 「AI で再特定」ボタン（anchor failed の quote 再特定。issue #94）。
   * 他のコールバックと異なり結果を Promise で返す（verificationPanel.ts の
   * VerificationPanelOptions.onRelocateQuote と同型。実行中スピナー・成功時のハイライト反映・
   * not_found 案内をパネル自身が local overlay として持つため、この操作だけ結果を待つ必要がある）
   */
  onRelocateQuote(evidence: Evidence): Promise<RelocateQuoteOutcome>;
}

/** #/extract（S7）のユーザー操作コールバック */
export interface ExtractViewCallbacks {
  /** 対象 study チェックボックスの切替（上限なし） */
  onToggleStudy(studyId: string, selected: boolean): void;
  /** requested_model の変更 */
  onChangeModel(model: string): void;
  /** 抽出対象フィールドのチェックリスト（issue #80）: 単一項目の切替 */
  onToggleField(fieldId: string, selected: boolean): void;
  /** 抽出対象フィールドのチェックリスト: section 見出しの全選択 / 全解除トグル */
  onToggleFieldSection(fieldIds: readonly string[], selected: boolean): void;
  /** 抽出対象フィールドのチェックリスト: section の折りたたみ切替 */
  onToggleFieldSectionCollapse(section: string): void;
  /** 「一括抽出を実行」: 検証 → 実行確認カードを開く */
  onRequestRun(): void;
  /** 確認カードの「実行する」: full run を開始 */
  onConfirmRun(): void;
  /** 確認カードのキャンセル */
  onCancelConfirm(): void;
  /** 失敗した study 1 件の再試行（run_type = single_study） */
  onRetryStudy(studyId: string): void;
  /** 読み込み失敗時の再読み込み（文献一覧 + 抽出済み study を強制再取得） */
  onReloadTargets(): void;
}

/** #/verify（S8）のユーザー操作コールバック */
export interface VerifyViewCallbacks {
  /** study セレクタの切替（URL ?study= と同期する） */
  onSelectStudy(studyId: string): void;
  /** 一覧読み込み失敗時の再試行 */
  onRetryLoad(): void;
  /** 検証パネルの判定 1 操作（annotator 行の更新 + Decisions 追記） */
  onDecision(decision: Decision): void;
  /** 群構成の確定・改訂（ArmStructures へ新 version を追記） */
  onArmConfirm(arms: readonly { armKey: string; armName: string }[]): void;
  /** 人間が追加した entity インスタンス宣言（Decisions へ追記） */
  onInstanceDeclare?(decisions: readonly Decision[]): void;
  /** 検証パネルのレイアウトモード切替（フォーカス ⇄ リスト。issue #38）の永続化 */
  onChangeLayoutMode(mode: VerifyLayoutMode): void;
  /** 保存の競合検出バナー（issue #64）の「再読み込み」: 表示中 study を読み直す */
  onReloadVerification(): void;
  /** 「AI で再特定」ボタン（anchor failed の quote 再特定。issue #94）。PilotViewCallbacks 参照 */
  onRelocateQuote(evidence: Evidence): Promise<RelocateQuoteOutcome>;
}

/** #/dashboard（S9）のユーザー操作コールバック（セルクリックはハッシュ遷移のためここに持たない） */
export interface DashboardViewCallbacks {
  /** 読み込み失敗時の再読み込み（強制再取得） */
  onReload(): void;
}

/** `#/adjudicate`（S12）のユーザー操作コールバック */
export interface AdjudicateViewCallbacks {
  /** 一覧からの study 選択（URL ?study= と同期する） */
  onSelectStudy(studyId: string): void;
  /** 裁定中画面の「一覧に戻る」 */
  onBackToList(): void;
  /** 一覧の読み込み失敗時の再読み込み */
  onRetryLoad(): void;
  /** 群構成確定カードのドラフト編集 */
  onArmDraftChange(index: number, armName: string): void;
  onArmDraftAdd(): void;
  onArmDraftRemove(index: number): void;
  /** 群構成の確定（「このまま採用」/ 編集後の「確定」の両方から呼ぶ） */
  onConfirmArms(arms: readonly { armKey: string; armName: string }[]): void;
  /** 「一致セルを一括採用」 */
  onAcceptAllMatches(): void;
  /** セル単位の裁定: A / B の採用 */
  onChooseA(cellKey: string): void;
  onChooseB(cellKey: string): void;
  /** 第 3 の値を入力して確定 */
  onCustomValue(cellKey: string, value: string): void;
  onNotReported(cellKey: string): void;
  /** スキップ（consensus セルを作らない） / その取り消し */
  onSkip(cellKey: string): void;
  onUnskip(cellKey: string): void;
  /** 裁定済みセルの取り消し（undo） */
  onUndo(cellKey: string): void;
  /** セル一覧の「不一致のみ」フィルタ切替 */
  onToggleMismatchOnly(value: boolean): void;
  /** レビュアー間一致度レポートの読み込み（オンデマンド計算。issue #66） */
  onLoadAgreement(): void;
  /** 一致度レポートの CSV ダウンロード（項目別サマリ / 不一致一覧） */
  onDownloadAgreementCsv(kind: 'summary' | 'disagreements'): void;
}

/** #/export（S10）のユーザー操作コールバック */
export interface ExportViewCallbacks {
  /** 形式選択ラジオの切替（サマリ・プレビューが追随する） */
  onSelectFormat(format: ExportFormat): void;
  /** 「CSV を生成して Drive に保存」: 未検証セルが残っていれば警告ダイアログを開く */
  onGenerate(): void;
  /** 警告ダイアログの「続行して生成」 */
  onConfirmGenerate(): void;
  /** 警告ダイアログの「中止」 */
  onCancelGenerate(): void;
  /** 生成完了カードの「ローカル保存」（Blob ダウンロード） */
  onDownload(): void;
  /** 読み込み失敗時の再読み込み（強制再取得） */
  onReload(): void;
  /** Methods 文案カード（issue #67）: 言語タブ切替 */
  onChangeMethodsLanguage(language: MethodsLanguage): void;
  /** Methods 文案カード: ワークフロートグル切替 */
  onChangeMethodsWorkflow(workflow: MethodsWorkflow): void;
  /** Methods 文案カード: 「コピー」ボタン */
  onCopyMethods(): void;
}

export interface ViewContext {
  home: HomeViewCallbacks;
  documents: DocumentsViewCallbacks;
  protocol: ProtocolViewCallbacks;
  schema: SchemaViewCallbacks;
  pilot: PilotViewCallbacks;
  extract: ExtractViewCallbacks;
  verify: VerifyViewCallbacks;
  dashboard: DashboardViewCallbacks;
  export: ExportViewCallbacks;
  adjudicate: AdjudicateViewCallbacks;
}
