// メインビューの中央ストア（単方向フロー）。view は render(state) の純粋関数とし、
// 状態変更は必ず setState 経由で行う（architecture.md §2.2）
import type { ConfirmedArmStructure } from '../domain/armStructure';
import type { Decision } from '../domain/decision';
import type { DocumentRecord } from '../domain/document';
import type { StudyRecord } from '../domain/study';
import type { Evidence } from '../domain/evidence';
import type { ExportFormat } from '../domain/exportLog';
import type { ExtractionRun } from '../domain/extractionRun';
import type { ProjectRole, ReviewerAssignment, ReviewerRole, ReviewMode } from '../domain/reviewer';
import type { AnnotatorPairResolution } from '../features/adjudication/pairResolution';
import type { StudyGate } from '../features/adjudication/gate';
import type { AdjudicationCell } from '../features/adjudication/cellMatch';
import type { DraftArmRow } from '../features/adjudication/armMatch';
import type { AgreementReport } from '../features/adjudication/agreement';
import type { BuiltExport, ClassicExportFormat } from '../features/export/buildExport';
import type {
  MethodsFacts,
  MethodsLanguage,
  MethodsWorkflow,
} from '../features/export/methodsBoilerplate';
import type { BuiltRSet, RSetMaterials } from '../features/export/rset/buildRSet';
import type { ProjectRef } from '../domain/project';
import type { Protocol } from '../domain/protocol';
import type { SchemaField } from '../domain/schemaField';
import type { SchemaVersion } from '../domain/schemaVersion';
import type { BatchFailure, RunProgress } from '../features/extraction/executeRun';
import type { FieldSelection, FieldSubsetBadge } from '../features/extraction/fieldSelection';
import type { ExtractStudyRow } from '../features/extraction/studyProgress';
import type { ProgressCounts } from '../features/project/progressCounts';
import type { TiabImportPlan } from '../features/documents/tiabReview';
import type { DashboardData } from '../features/verification/dashboard';
import type { LoadedPdfView } from '../features/verification/pdfViewCache';
import type { RobPrespecDialogState } from '../features/schema/presets/robPrespec';
import type { SchemaEditorRow } from '../features/schema/types';
import type { FieldValidationError } from '../features/schema/validateField';
import type { VerificationProgress } from '../features/verification/progress';
import type { VerificationData } from '../features/verification/types';
import type { VerifyLayoutMode } from '../lib/storage/settingsStore';
import type { RouteHash } from './router';

// 定義は features/project/progressCounts.ts（Sheets 読み出しと同居）。従来の import 先を維持する
export type { ProgressCounts };

/** #/home + ガードが使う進捗カウントの読込状態（counts 本体は AppState.counts） */
export interface HomeState {
  /** Sheets からの読込が完了したか（E2E seam の counts 注入時も true = 再読込しない） */
  countsLoaded: boolean;
  countsLoading: boolean;
  countsError: string | null;
}

/**
 * プロジェクトに対する実効ロールの解決状態（独立二重レビュー機能。
 * docs/design-independent-dual-review.md §1・§3.1）。bootstrap の起動シーケンスで
 * プロジェクト読込後に 1 回解決する（roleService.loadRole）。role = null は未解決（起動直後 /
 * プロジェクト未選択）を表し、ガード・ナビ描画は既定で 'owner' 相当（制限なし）として扱う
 */
export interface RoleState {
  role: ProjectRole | null;
  resolving: boolean;
  /** ロール解決自体の失敗（ネットワーク等）。unregistered はエラーではなくロール値で表現する */
  error: string | null;
  /**
   * reviewer 系ロールのプロジェクトフォルダアクセス付与済みか（§7.2）。owner は不要なため
   * 常に true 扱いにする。付与前は #/verify 入場をガードで塞ぐ
   */
  folderAccessGranted: boolean;
  folderAccessChecking: boolean;
  folderAccessError: string | null;
}

/** owner の「レビュアー管理」カード（Home。§7.1・§2.1）が使う入力 1 件分 */
export interface ReviewerFormInput {
  email: string;
  role: ReviewerRole;
  reviewMode: ReviewMode | null;
}

/** owner の「レビュアー管理」カードの状態 */
export interface ReviewersState {
  /** email ごとに畳み込んだ現在の登録状態（revoked 含む）。null = 未読込 */
  assignments: ReviewerAssignment[] | null;
  loading: boolean;
  loadError: string | null;
  saving: boolean;
  saveError: string | null;
  /** モード変更確認ダイアログ（既存 reviewer のモードを変える送信時に表示）。null = 非表示 */
  confirmingChange: ReviewerFormInput | null;
}

/** 取り込み進捗 1 行の段階（ui-states.md §3「コピー → テキスト抽出の 2 段階表示」+ 前後の状態 + 重複スキップ〔issue #102〕） */
export type ImportRowStatus = 'queued' | 'copy' | 'extract' | 'done' | 'failed' | 'skipped';

export interface ImportRow {
  /** 進捗行の突き合わせキー（Drive/ローカル共通。features/documents/importDocuments.ts の ImportSelection.key） */
  key: string;
  filename: string;
  status: ImportRowStatus;
  /** failed（失敗段階 + 理由）/ skipped（スキップ理由）のときの詳細。それ以外は null */
  detail: string | null;
}

/** 統合ダイアログ（S3 グルーピング。§4.5）の状態 */
export interface MergeDialogState {
  /** 統合する study_id（2 件以上） */
  studyIds: string[];
  /** 統合後の study_label（編集可・既定 = 最初に取り込まれた study の値） */
  label: string;
  /** 統合後の registration_id（編集可） */
  registrationId: string;
  /** 対象 study のいずれかに抽出済みデータ（完了 run）があるか（警告文言の出し分け・§4.5） */
  hasExtractedData: boolean;
}

/** S3「tiab-review から採用リストを読み込む」カードの状態（issue #68・requirements.md §4.5 / ※Q2） */
export interface TiabImportState {
  /** カードの開閉（閉 = 導線ボタンのみ表示） */
  open: boolean;
  /** 直近プレビュー時の入力値（再描画でフォームを復元する） */
  sheetInput: string;
  /** tiab シートの読み込み + プレビュー計算中 */
  loading: boolean;
  error: string | null;
  /** 反映プラン（プレビュー = そのまま実行内容）。null = 未計算 */
  plan: TiabImportPlan | null;
  /** 「取り込みを実行」の反映中 */
  applying: boolean;
  /** 直近の実行結果サマリ（次のプレビューまで残す） */
  result: { studiesUpdated: number; documentsUpdated: number; unmatched: number } | null;
}

/** #/documents（S3）の画面状態 */
export interface DocumentsState {
  /** Documents タブの一覧。null = 未読込（画面表示時に読み込む） */
  records: DocumentRecord[] | null;
  /** Studies タブの一覧（作成順）。null = 未読込。グループ表示・統合の素材（§4.5） */
  studies: StudyRecord[] | null;
  /** 完了 run で抽出済みの study_id（統合時の「未抽出に戻る」警告の素材） */
  extractedStudyIds: string[];
  /** 無視した統合候補ペアのキー（storage.local から復元。再提案を抑止する §4.5） */
  ignoredCandidateKeys: string[];
  loading: boolean;
  loadError: string | null;
  importing: boolean;
  /** 直近の取り込みの進捗行（次の取り込み開始まで残す） */
  importRows: ImportRow[];
  /** 統合のために選択中の study_id（2 件以上でダイアログを開ける） */
  selectedStudyIds: string[];
  /** 統合確認ダイアログ。null = 非表示 */
  mergeDialog: MergeDialogState | null;
  merging: boolean;
  mergeError: string | null;
  /** tiab-review 採用リスト取り込みカード（issue #68） */
  tiabImport: TiabImportState;
}

/** #/protocol（S4）の画面状態 */
export interface ProtocolState {
  /** Protocol タブの全 version（降順）。null = 未読込（画面表示時に読み込む） */
  records: Protocol[] | null;
  loading: boolean;
  loadError: string | null;
  saving: boolean;
  /** 保存・パース失敗の文言（フォームのエラー領域に表示） */
  saveError: string | null;
  /** 既存版があるときに再入力フォームを開いているか（読み取り専用 ↔ フォームの分岐） */
  editing: boolean;
  /** 読み取り専用表示で選択中の版。null = 最新 */
  selectedVersion: number | null;
  /** 保存中・保存失敗の再描画でフォーム本文を復元するための下書き（手入力のみ） */
  draftText: string;
}

/** #/schema（S5）の画面状態 */
export interface SchemaState {
  /** SchemaVersions タブの全版（降順）。null = 未読込 */
  versions: SchemaVersion[] | null;
  /** 最新版（versions[0]）の項目。確定済みサマリに使う */
  currentFields: SchemaField[] | null;
  loading: boolean;
  loadError: string | null;
  /** ドラフト生成の実行状態。経過時間も store で持ち再描画に耐える（ui-states.md §3） */
  drafting: boolean;
  draftElapsedSeconds: number;
  draftError: string | null;
  /** ドラフトフォームの選択状態（サンプル論文 1〜3 本 + requested_model） */
  selectedDocumentIds: string[];
  model: string;
  /** エディタ行。null = エディタ非表示 */
  editorRows: SchemaEditorRow[] | null;
  editorErrors: FieldValidationError[];
  /** 確定時の created_by_type（AI ドラフト直後 = ai_draft。人が触ったら user_edit） */
  editorOrigin: 'ai_draft' | 'user_edit';
  confirming: boolean;
  /** RoB プリセット事前設定ダイアログ（issue #103。ui-states.md §3）。null = 非表示 */
  presetDialog: RobPrespecDialogState | null;
}

/** #/pilot（S6）の画面状態。run の結果と埋め込み検証 UI の素材はタブのセッション内で保持する */
export interface PilotState {
  /** 対象 study の選択。初回表示時にテキスト層ありの先頭 3 study を既定選択する（ui-states.md §3・v0.10） */
  selectedStudyIds: string[];
  /** 既定選択を一度だけ行うためのフラグ（ユーザーの選択解除を上書きしない） */
  selectionInitialized: boolean;
  model: string;
  running: boolean;
  progress: RunProgress | null;
  runError: string | null;
  /** 直近のパイロット run（完了後に埋め込み検証 UI と再パイロット導線を出す） */
  run: ExtractionRun | null;
  /** 直近 run に使ったスキーマ項目（判定保存時の field_name / entity_level 解決に使う） */
  runFields: SchemaField[] | null;
  /** 直近 run の全 Evidence（文献切替時の検証素材。Sheets を読み直さない） */
  evidence: Evidence[] | null;
  batchFailures: BatchFailure[];
  rejectedCount: number;
  /**
   * これまでのパイロット run（完了行のみ・新しい順）。null = 未読込（画面表示時に読み込む）。
   * 「履歴から選択」「既存データの自動読込」の素材（S6）
   */
  history: ExtractionRun[] | null;
  historyLoading: boolean;
  historyError: string | null;
  /** 起動後に最新 run を一度だけ自動読込するためのフラグ（selectionInitialized と同じ運用） */
  historyInitialized: boolean;
  /** 履歴から読み込み中の run_id（履歴項目のスピナー + 二重起動防止）。null = なし */
  loadingRunId: string | null;
  /** 埋め込み検証 UI で表示中の study */
  verifyStudyId: string | null;
  verification: VerificationData | null;
  verifyLoading: boolean;
  verifyError: string | null;
  /** 表示中文献の自分の StudyData 行の values（判定保存時の全量上書きの素材） */
  studyValues: Record<string, string | null> | null;
  /** オフラインキューへ退避した判定書き込みの件数 */
  queuedDecisions: number;
  /**
   * 検証パネルのレイアウトモード（フォーカス / リスト。issue #38）。settingsStore 由来で
   * 検証データ束の読込時に読み直す（S6 / S8 で共有する設定）。既定は 'focus'
   */
  layoutMode: VerifyLayoutMode;
  /** 自分の StudyData 行の updated_at（楽観ロックの期待値。issue #64） */
  studyRowUpdatedAt: string | null;
  /** 自分の ResultsData 行のセルキー別 updated_at（楽観ロックの期待値。issue #64） */
  resultsRowUpdatedAt: Record<string, string>;
  /** 保存の競合検出バナー（#verify-conflict-warning）の文言。null = 非表示（issue #64） */
  conflictMessage: string | null;
  /**
   * run 単位のフィールド選択（issue #80）。null = 全選択（既定）。
   * 画面入場のたびに全選択へリセットする（storage への永続化はしない）
   */
  selectedFieldIds: FieldSelection;
  /** 折りたたみ中の section 名（既定は全展開 = 空配列） */
  collapsedFieldSections: string[];
}

/** #/extract（S7）の画面状態。run の結果はタブのセッション内で保持する */
export interface ExtractState {
  /** 対象 study の選択。初回表示時に「未抽出の全件」を既定選択する（ui-states.md §3・v0.10） */
  selectedStudyIds: string[];
  /** 既定選択を一度だけ行うためのフラグ（ユーザーの選択解除を上書きしない） */
  selectionInitialized: boolean;
  model: string;
  /** ExtractionRuns 由来の抽出済み study_id（完了行のみ）。null = 未読込（画面表示時に読み込む） */
  extractedStudyIds: string[] | null;
  /**
   * 中断された run（running 行のみで完了行がない）に含まれ、まだ再抽出されていない
   * study_id。中断バナーの素材（extractedStudyIds と同時に読み込む）
   */
  interruptedStudyIds: string[] | null;
  loading: boolean;
  loadError: string | null;
  /** 実行確認カード（#extract-confirm）を表示中か */
  confirming: boolean;
  running: boolean;
  /** 実行中〜完了後の study 単位進捗（1 行 = 1 study） */
  studyRows: ExtractStudyRow[];
  progress: RunProgress | null;
  runError: string | null;
  /** 直近の full run（完了後にサマリ + 検証導線を出す） */
  run: ExtractionRun | null;
  /** 直近 run の応答要素の破棄件数（partial_failure バナーに併記） */
  rejectedCount: number;
  /** 再試行（single_study run）実行中の study_id。null = なし */
  retryingStudyId: string | null;
  /**
   * run 単位のフィールド選択（issue #80）。null = 全選択（既定）。
   * 画面入場・対象再読込のたびに全選択へリセットする（storage への永続化はしない）
   */
  selectedFieldIds: FieldSelection;
  /** 折りたたみ中の section 名（既定は全展開 = 空配列） */
  collapsedFieldSections: string[];
  /**
   * 直近実行時に実際に使った fieldIds（A-2: 失敗 study の再試行〔retryExtractStudy〕が
   * 元 run と同じ選択を引き継ぐための保持値）。performRun 呼び出し前に確定させ、
   * 成功・失敗にかかわらず保持する。まだ一度も実行していなければ null（= 全項目相当）
   */
  lastRunFieldIds: string[] | null;
  /**
   * study_id → 直近の完了 run がサブセット（fieldIds ≠ null）だったときの
   * { selected, total }（S7 の「抽出済み」バッジ注記の素材。issue #80）。
   * 全項目 run が直近だった study はキー自体を持たない
   */
  fieldSubsetBadges: Record<string, FieldSubsetBadge>;
}

/** #/verify（S8）の一覧 1 study ぶんの検証素材（Evidence がある study のみ。v0.10 フェーズ 3） */
export interface VerifyTarget {
  study: StudyRecord;
  /** study 配下の文書（role 固定順 → 取り込み順） */
  documents: DocumentRecord[];
  /** 表示する run（当該 study の最新 run）の全文書ぶんの Evidence */
  evidence: Evidence[];
  /** 表示する run の schema_version の全項目 */
  fields: SchemaField[];
  schemaVersion: number;
  /** セレクタの進捗チップ（判定済み n / 総セル m） */
  progress: VerificationProgress;
}

/** #/verify（S8）の画面状態 */
export interface VerifyState {
  /** 検証対象一覧。null = 未読込（画面表示時に読み込む） */
  targets: VerifyTarget[] | null;
  loading: boolean;
  loadError: string | null;
  /** 表示中の study（URL クエリ ?study= と同期する） */
  selectedStudyId: string | null;
  /** URL クエリ ?entity= のセル単位ディープリンク（S9 ダッシュボードのセルクリック）。null = なし */
  deepLinkEntityKey: string | null;
  verification: VerificationData | null;
  verifyLoading: boolean;
  verifyError: string | null;
  /** 表示中文献の自分の StudyData 行の values（判定保存時の全量上書きの素材） */
  studyValues: Record<string, string | null> | null;
  /** オフラインキューへ退避した判定書き込みの件数 */
  queuedDecisions: number;
  /** 検証パネルのレイアウトモード（issue #38）。settingsStore 由来。既定は 'focus' */
  layoutMode: VerifyLayoutMode;
  /** 自分の StudyData 行の updated_at（楽観ロックの期待値。issue #64） */
  studyRowUpdatedAt: string | null;
  /** 自分の ResultsData 行のセルキー別 updated_at（楽観ロックの期待値。issue #64） */
  resultsRowUpdatedAt: Record<string, string>;
  /** 保存の競合検出バナー（#verify-conflict-warning）の文言。null = 非表示（issue #64） */
  conflictMessage: string | null;
}

/** #/export（S10）の直近の生成結果（結果カードの素材。次の生成開始まで残す） */
export interface ExportResultInfo {
  format: ClassicExportFormat;
  filename: string;
  /** Drive の webViewLink（ExportLog.file_ref と同値） */
  fileRef: string;
  rowCount: number;
  exportedAt: string;
  /** ローカル保存用の CSV 本文（Drive に保存したものと同一内容を保持する） */
  csv: string;
}

/** #/export（S10）の R セット生成完了カードの素材（issue #60。8 ファイルを保存したサブフォルダ単位） */
export interface RSetResultInfo {
  /** 保存先サブフォルダ（`exports/rset_{YYYYMMDD-HHMMSS}/`）の webViewLink */
  folderRef: string;
  folderName: string;
  exportedAt: string;
  /** Drive へ保存した内容と同一（ファイル一覧・行数・issues 件数・ローカル保存の素材を兼ねる） */
  built: BuiltRSet;
}

/** #/export（S10）の画面状態 */
export interface ExportState {
  /** 選択中の形式（`r_set` を含む） */
  format: ExportFormat;
  /** 従来 3 形式の構築結果。null = 未読込（画面表示時に読み込む） */
  built: Record<ClassicExportFormat, BuiltExport> | null;
  /**
   * R セット（issue #60）の素材。generateExport が正確な exported_at で
   * export_manifest.json を再構築するために保持する（built はプレビュー表示用の 1 回目の構築）
   */
  rSetMaterials: RSetMaterials | null;
  /** R セットの構築結果（読込時に構築。サマリ・プレビュー表示に使う） */
  rSet: BuiltRSet | null;
  /** built / rSet の構築に使った最新確定版（ExportLog.schema_version） */
  schemaVersion: number | null;
  loading: boolean;
  loadError: string | null;
  /** 未検証セル残存の警告ダイアログ（#export-warning）を表示中か */
  confirmingWarning: boolean;
  generating: boolean;
  generateError: string | null;
  result: ExportResultInfo | null;
  /** R セットの生成完了カードの素材 */
  rSetResult: RSetResultInfo | null;
  /** Methods 文案カード（docs/methods-boilerplate.md）の実績値。null = 未読込（loadExportData 成功時に設定） */
  methodsFacts: MethodsFacts | null;
  /** Methods 文案カードの言語タブ。既定 English（§4: 投稿論文の主想定言語） */
  methodsLanguage: MethodsLanguage;
  /** Methods 文案カードのワークフロートグル。既定 単一レビュアー（§4） */
  methodsWorkflow: MethodsWorkflow;
}

/**
 * 3 名以上の study（pair.kind === 'selectable'）で選択できる 2 名の組（issue #63）。
 * 一覧読込時に全組合せぶんのゲートを事前計算して持つ
 */
export interface AdjudicatePairOption {
  annotatorA: string;
  annotatorB: string;
  gate: StudyGate;
}

/** `#/adjudicate`（S12。docs/design-independent-dual-review.md §6）一覧 1 study ぶんの行 */
export interface AdjudicateStudyRow {
  study: StudyRecord;
  pair: AnnotatorPairResolution;
  /** pair.kind === 'ready' のときのみ非 null */
  gate: StudyGate | null;
  /** pair.kind === 'selectable'（3 名以上。issue #63）のときのみ非 null: 選択可能な 2 名の組一覧 */
  pairOptions: AdjudicatePairOption[] | null;
}

/**
 * 裁定中の 1 study ぶんの作業データ（study 切替のたびに作り直す）。
 * PDF ビューア素材は VerificationData と同様に遅延読込のフックとして持つ
 * （features/verification/pdfViewCache の LRU キャッシュを内部に閉じ込める）
 */
export interface AdjudicateWorking {
  study: StudyRecord;
  /** study 配下の文書（role 固定順 → 取り込み順） */
  documents: DocumentRecord[];
  annotatorA: string;
  annotatorB: string;
  /** 突き合わせに使う表のデザイン（最新確定版）の全項目 */
  fields: SchemaField[];
  schemaVersion: number;
  armsA: readonly { armKey: string; armName: string }[];
  armsB: readonly { armKey: string; armName: string }[];
  /** 群構成が必要なスキーマか（arm / outcome_result 項目の有無） */
  needsArmConfirmation: boolean;
  /**
   * A の各群（index 順）に対応する B の armKey（null = 対応なし。issue #63 の並べ替えマッピング）。
   * 既定は名称一致 → 位置対応 → 残り物同士の自動対応。consensus 群構成の確定後は変更不可
   */
  armMapping: (string | null)[];
  /** マッピング適用後に本数・対応名称が完全一致するか（§6.2・§13） */
  armsMatched: boolean;
  /** 確定済みの consensus 群構成。null = 未確定（arm / outcome_result セルはロック） */
  consensusArmStructure: ConfirmedArmStructure | null;
  /** 群構成確定カードの編集用ドラフト（未確定時のみ画面が使う） */
  armDraft: DraftArmRow[];
  /** 両 annotator の現在値を突き合わせたセル一覧（study 切替時に 1 度だけ計算するスナップショット） */
  cells: AdjudicationCell[];
  /** consensus 自身の判定履歴（study 内）。セルの裁定状態はこれを畳み込んで導出する */
  consensusDecisions: Decision[];
  /**
   * study 配下の全文書ぶんの AI 根拠（表示する run のもの。issue #63）。
   * 裁定 PDF ペインの根拠ハイライトの情報源。human_independent 由来のセル（AI 抽出なし）は
   * 対応する Evidence が無い（features/adjudication/cellMatch.ts の indexEvidenceByCellKey 参照）
   */
  evidence: Evidence[];
  /** スキップしたセル（セッション内のみ。永続化しない。key = cellKeyOf(fieldId, entityKey)） */
  skippedCellKeys: string[];
  /**
   * マッピング変更時にセル突き合わせを再計算する（issue #63）。生素材（両者の行・Decisions）は
   * クロージャに閉じ込め、remap（B の armKey → 正準 armKey 辞書）だけを受け取る
   */
  rebuildCells(remap: ReadonlyMap<string, string>): AdjudicationCell[];
  /** documentId 1 件ぶんの PDF ビューア素材を遅延読込する（features/verification/pdfViewCache 経由） */
  loadPdfView(documentId: string): Promise<LoadedPdfView>;
  retryPdfView(documentId: string): Promise<LoadedPdfView>;
  disposePdf(): Promise<void>;
}

/** `#/adjudicate`（S12）の画面状態 */
export interface AdjudicateState {
  /** study 一覧（ゲート付き）。null = 未読込 */
  rows: AdjudicateStudyRow[] | null;
  loading: boolean;
  loadError: string | null;
  /** URL クエリ ?study= と同期する選択中 study */
  selectedStudyId: string | null;
  working: AdjudicateWorking | null;
  workingLoading: boolean;
  /** 一覧に戻らず画面内に表示するエラー（対象外 study の選択・裁定不可等） */
  workingError: string | null;
  /** 書き込み中フラグ（二重送信防止。失敗はトーストのみで状態維持） */
  saving: boolean;
  /**
   * 検証側（verificationService）と共有する 'decisions' オフラインキューへ退避中の
   * 裁定書き込み件数（issue #63）。0 より大きいと画面にオフラインバナーを出す。
   * キューは spreadsheetId × userEmail 単位で検証・裁定の書き込みを一括管理するため、
   * この画面以外（#/verify・#/pilot）由来の退避分も合算されうる
   */
  queuedWrites: number;
  /** セル一覧の「不一致のみ」フィルタ（既定 ON。§6.4） */
  mismatchOnlyFilter: boolean;
  /**
   * 3 名以上の study（selectable）で裁定者が選んだ 2 名（studyId → 組。issue #63）。
   * セッション内のみで永続化しない。選択が pairOptions に無い（force 再読込で組が変わった等）
   * 場合は未選択として扱う
   */
  pairSelections: Record<string, { annotatorA: string; annotatorB: string }>;
  /**
   * レビュアー間一致度レポート（issue #66）。null = 未計算（画面入場時には自動読込しない
   * オンデマンド計算。Sheets 読み出しを増やさないため）。読込成功時は対象が 0 件でも
   * 空のレポート（studyCount=0）を入れる = 「対象なし」は agreementError ではなく
   * この空レポートで表現する
   */
  agreement: AgreementReport | null;
  agreementLoading: boolean;
  /** 読み込み失敗時の案内文言（role="alert" で表示）。対象なしはここではなく agreement 側で表す */
  agreementError: string | null;
}

/** #/dashboard（S9）の画面状態 */
export interface DashboardState {
  /** 集計結果。null = 未読込（画面表示時に読み込む） */
  data: DashboardData | null;
  loading: boolean;
  loadError: string | null;
}

export interface AppState {
  currentProject: ProjectRef | null;
  counts: ProgressCounts;
  home: HomeState;
  /** プロジェクトに対する実効ロールの解決状態（独立二重レビュー機能） */
  role: RoleState;
  /** owner の「レビュアー管理」カード（Home）の状態 */
  reviewers: ReviewersState;
  documents: DocumentsState;
  protocol: ProtocolState;
  schema: SchemaState;
  pilot: PilotState;
  extract: ExtractState;
  verify: VerifyState;
  dashboard: DashboardState;
  export: ExportState;
  /** `#/adjudicate`（S12）の画面状態 */
  adjudicate: AdjudicateState;
  /**
   * #/options へ入る直前のルート（settingsView の「戻る」リンク先）。
   * bootstrap の handleHashChange が #/options 遷移時にのみ更新する。null = 記録なし
   * （直接 #/options を開いた等）で #/home へ戻す（B. 設定画面の「戻る」改善）
   */
  settingsReturnHash: RouteHash | null;
}

export type StateListener = (state: AppState) => void;

export interface Store {
  getState(): AppState;
  setState(patch: Partial<AppState>): void;
  subscribe(listener: StateListener): () => void;
}

export function createInitialState(): AppState {
  return {
    currentProject: null,
    counts: {
      documents: 0,
      protocolVersions: 0,
      schemaVersions: 0,
      pilotRuns: 0,
      evidenceRows: 0,
      dataRows: 0,
    },
    home: {
      countsLoaded: false,
      countsLoading: false,
      countsError: null,
    },
    role: {
      role: null,
      resolving: false,
      error: null,
      folderAccessGranted: false,
      folderAccessChecking: false,
      folderAccessError: null,
    },
    reviewers: {
      assignments: null,
      loading: false,
      loadError: null,
      saving: false,
      saveError: null,
      confirmingChange: null,
    },
    documents: {
      records: null,
      studies: null,
      extractedStudyIds: [],
      ignoredCandidateKeys: [],
      loading: false,
      loadError: null,
      importing: false,
      importRows: [],
      selectedStudyIds: [],
      mergeDialog: null,
      merging: false,
      mergeError: null,
      tiabImport: {
        open: false,
        sheetInput: '',
        loading: false,
        error: null,
        plan: null,
        applying: false,
        result: null,
      },
    },
    protocol: {
      records: null,
      loading: false,
      loadError: null,
      saving: false,
      saveError: null,
      editing: false,
      selectedVersion: null,
      draftText: '',
    },
    schema: {
      versions: null,
      currentFields: null,
      loading: false,
      loadError: null,
      drafting: false,
      draftElapsedSeconds: 0,
      draftError: null,
      selectedDocumentIds: [],
      model: '',
      editorRows: null,
      editorErrors: [],
      editorOrigin: 'user_edit',
      confirming: false,
      presetDialog: null,
    },
    pilot: {
      selectedStudyIds: [],
      selectionInitialized: false,
      model: '',
      running: false,
      progress: null,
      runError: null,
      run: null,
      runFields: null,
      evidence: null,
      batchFailures: [],
      rejectedCount: 0,
      history: null,
      historyLoading: false,
      historyError: null,
      historyInitialized: false,
      loadingRunId: null,
      verifyStudyId: null,
      verification: null,
      verifyLoading: false,
      verifyError: null,
      studyValues: null,
      queuedDecisions: 0,
      layoutMode: 'focus',
      studyRowUpdatedAt: null,
      resultsRowUpdatedAt: {},
      conflictMessage: null,
      selectedFieldIds: null,
      collapsedFieldSections: [],
    },
    extract: {
      selectedStudyIds: [],
      selectionInitialized: false,
      model: '',
      extractedStudyIds: null,
      interruptedStudyIds: null,
      loading: false,
      loadError: null,
      confirming: false,
      running: false,
      studyRows: [],
      progress: null,
      runError: null,
      run: null,
      rejectedCount: 0,
      retryingStudyId: null,
      selectedFieldIds: null,
      collapsedFieldSections: [],
      lastRunFieldIds: null,
      fieldSubsetBadges: {},
    },
    verify: {
      targets: null,
      loading: false,
      loadError: null,
      selectedStudyId: null,
      deepLinkEntityKey: null,
      verification: null,
      verifyLoading: false,
      verifyError: null,
      studyValues: null,
      queuedDecisions: 0,
      layoutMode: 'focus',
      studyRowUpdatedAt: null,
      resultsRowUpdatedAt: {},
      conflictMessage: null,
    },
    dashboard: {
      data: null,
      loading: false,
      loadError: null,
    },
    adjudicate: {
      rows: null,
      loading: false,
      loadError: null,
      selectedStudyId: null,
      working: null,
      workingLoading: false,
      workingError: null,
      saving: false,
      queuedWrites: 0,
      mismatchOnlyFilter: true,
      pairSelections: {},
      agreement: null,
      agreementLoading: false,
      agreementError: null,
    },
    export: {
      format: 'study_wide',
      built: null,
      rSetMaterials: null,
      rSet: null,
      schemaVersion: null,
      loading: false,
      loadError: null,
      confirmingWarning: false,
      generating: false,
      generateError: null,
      result: null,
      rSetResult: null,
      methodsFacts: null,
      methodsLanguage: 'en',
      methodsWorkflow: 'single',
    },
    settingsReturnHash: null,
  };
}

export function createStore(initial: AppState = createInitialState()): Store {
  let state = initial;
  const listeners = new Set<StateListener>();
  return {
    getState: () => state,
    setState(patch) {
      state = { ...state, ...patch };
      for (const listener of listeners) {
        listener(state);
      }
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}
