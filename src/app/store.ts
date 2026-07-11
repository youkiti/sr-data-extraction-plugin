// メインビューの中央ストア（単方向フロー）。view は render(state) の純粋関数とし、
// 状態変更は必ず setState 経由で行う（architecture.md §2.2）
import type { DocumentRecord } from '../domain/document';
import type { StudyRecord } from '../domain/study';
import type { Evidence } from '../domain/evidence';
import type { ExportFormat } from '../domain/exportLog';
import type { ExtractionRun } from '../domain/extractionRun';
import type { BuiltExport } from '../features/export/buildExport';
import type { ProjectRef } from '../domain/project';
import type { Protocol } from '../domain/protocol';
import type { SchemaField } from '../domain/schemaField';
import type { SchemaVersion } from '../domain/schemaVersion';
import type { BatchFailure, RunProgress } from '../features/extraction/executeRun';
import type { ExtractStudyRow } from '../features/extraction/studyProgress';
import type { ProgressCounts } from '../features/project/progressCounts';
import type { DashboardData } from '../features/verification/dashboard';
import type { SchemaEditorRow } from '../features/schema/types';
import type { FieldValidationError } from '../features/schema/validateField';
import type { VerificationProgress } from '../features/verification/progress';
import type { VerificationData } from '../features/verification/types';
import type { VerifyLayoutMode } from '../lib/storage/settingsStore';

// 定義は features/project/progressCounts.ts（Sheets 読み出しと同居）。従来の import 先を維持する
export type { ProgressCounts };

/** #/home + ガードが使う進捗カウントの読込状態（counts 本体は AppState.counts） */
export interface HomeState {
  /** Sheets からの読込が完了したか（E2E seam の counts 注入時も true = 再読込しない） */
  countsLoaded: boolean;
  countsLoading: boolean;
  countsError: string | null;
}

/** 取り込み進捗 1 行の段階（ui-states.md §3「コピー → テキスト抽出の 2 段階表示」+ 前後の状態） */
export type ImportRowStatus = 'queued' | 'copy' | 'extract' | 'done' | 'failed';

export interface ImportRow {
  /** 進捗行の突き合わせキー（Drive/ローカル共通。features/documents/importDocuments.ts の ImportSelection.key） */
  key: string;
  filename: string;
  status: ImportRowStatus;
  /** failed のときの詳細（失敗段階 + 理由）。それ以外は null */
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
}

/** #/export（S10）の直近の生成結果（結果カードの素材。次の生成開始まで残す） */
export interface ExportResultInfo {
  format: ExportFormat;
  filename: string;
  /** Drive の webViewLink（ExportLog.file_ref と同値） */
  fileRef: string;
  rowCount: number;
  exportedAt: string;
  /** ローカル保存用の CSV 本文（Drive に保存したものと同一内容を保持する） */
  csv: string;
}

/** #/export（S10）の画面状態 */
export interface ExportState {
  /** 選択中の形式 */
  format: ExportFormat;
  /** 3 形式の構築結果。null = 未読込（画面表示時に読み込む） */
  built: Record<ExportFormat, BuiltExport> | null;
  /** built の構築に使った最新確定版（ExportLog.schema_version） */
  schemaVersion: number | null;
  loading: boolean;
  loadError: string | null;
  /** 未検証セル残存の警告ダイアログ（#export-warning）を表示中か */
  confirmingWarning: boolean;
  generating: boolean;
  generateError: string | null;
  result: ExportResultInfo | null;
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
  documents: DocumentsState;
  protocol: ProtocolState;
  schema: SchemaState;
  pilot: PilotState;
  extract: ExtractState;
  verify: VerifyState;
  dashboard: DashboardState;
  export: ExportState;
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
    },
    dashboard: {
      data: null,
      loading: false,
      loadError: null,
    },
    export: {
      format: 'study_wide',
      built: null,
      schemaVersion: null,
      loading: false,
      loadError: null,
      confirmingWarning: false,
      generating: false,
      generateError: null,
      result: null,
    },
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
