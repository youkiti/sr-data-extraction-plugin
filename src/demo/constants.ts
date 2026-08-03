// デモモード共通定数（tiab-review-plugin/src/demo/constants.ts の方針を踏襲）。
//
// Playwright での録画・自動操作のたびに値が変わらないよう、乱数や Date.now() は
// 一切使わずここに固定値としてまとめる。fetchMock.ts / seed.ts / auth.ts / identity.ts /
// googleDeps.ts / picker.ts から共通で参照する。
//
// デモは架空論文 2 本（paperData.mjs の PAPER1 = 2 群 / PAPER2 = 3 群）を扱うため、
// study / document / Drive ファイル ID は配列（インデックス 0 = paper1, 1 = paper2）で持つ。

/** デモ用スプレッドシートの固定 ID（fetchMock はこの ID へのアクセスのみ許可する） */
export const DEMO_SPREADSHEET_ID = 'demo-spreadsheet-srdep-2026';

/** デモ用プロジェクトの固定 ID（Meta.project_id） */
export const DEMO_PROJECT_ID = 'demo-project-srdep-2026';

/** デモ用 Drive フォルダの固定 ID（Meta.drive_folder_id。実際にフォルダは作らない） */
export const DEMO_DRIVE_FOLDER_ID = 'demo-drive-folder-srdep-2026';

/** プロジェクト名。popup / app のヘッダーに表示される（架空の周術期リハビリ・鎮痛薬 SR という体裁） */
export const DEMO_PROJECT_TITLE = 'デモ: 周術期の介入に関する RCT レビュー（架空データ）';

/** デモ用ログインユーザー（oauth2/v3/userinfo のモック応答・Meta.created_by 等に使用） */
export const DEMO_USER_EMAIL = 'demo-owner@example.com';
export const DEMO_USER_DISPLAY_NAME = 'デモ 太郎';

/** 独立二重レビュー（S12 裁定・κ 一致度レポート）のデモ用レビュアー 2 名 */
export const DEMO_REVIEWER_A_EMAIL = 'reviewer-a@example.com';
export const DEMO_REVIEWER_B_EMAIL = 'reviewer-b@example.com';

/** platform/demo が発行する固定トークン文字列（値そのものに意味はない） */
export const DEMO_TOKEN = 'demo-token';

/** 拡張機能 ID（Picker 起動時の拡張機能 ID プレースホルダ。デモでは Picker 自体を起動しない） */
export const DEMO_EXTENSION_ID_FALLBACK = 'demo-extension';

/**
 * シードの各種タイムスタンプ（ISO 8601・UTC）。日付は録画のたびにブレないよう固定する。
 * 時系列（登録 → スキーマ確定 → 抽出 → 検証 → 裁定）が前後しないよう昇順に採番している。
 * デモ論文 2（3 群）は「取り込み済みだが未抽出・群構成未確定」の状態で止めるため、
 * 抽出・群構成確定・判定系のタイムスタンプを持たない（seed.ts 参照）。
 */
export const DEMO_TIMESTAMPS = {
  projectCreatedAt: '2026-07-20T00:00:00.000Z',
  protocolCreatedAt: '2026-07-20T00:05:00.000Z',
  documentImportedAt: '2026-07-20T00:10:00.000Z',
  documentImportedAt2: '2026-07-20T00:12:00.000Z',
  schemaCreatedAt: '2026-07-20T00:20:00.000Z',
  extractionStartedAt: '2026-07-20T00:30:00.000Z',
  extractionFinishedAt: '2026-07-20T00:32:00.000Z',
  armConfirmedAtOwner: '2026-07-20T01:00:00.000Z',
  armConfirmedAtReviewerA: '2026-07-20T01:05:00.000Z',
  armConfirmedAtReviewerB: '2026-07-20T01:10:00.000Z',
  decidedAtOwner: '2026-07-20T01:30:00.000Z',
  decidedAtReviewerA: '2026-07-20T02:00:00.000Z',
  decidedAtReviewerB: '2026-07-20T02:10:00.000Z',
  /** 裁定（consensus）で一致セルを一括採用した日時。独立レビュアー2名の判定より後 */
  consensusDecidedAt: '2026-07-20T02:30:00.000Z',
} as const;

/** SchemaVersions / StudyData / ResultsData 等が参照する確定スキーマ版・プロトコル版（両論文共通） */
export const DEMO_SCHEMA_VERSION = 1;
export const DEMO_PROTOCOL_VERSION = 1;

/** ExtractionRuns の run_id（デモ論文 1 を AI 一括抽出でシード済みの run） */
export const DEMO_SEED_RUN_ID = 'demo-run-seed-001';

/**
 * study / document の固定 ID（インデックス 0 = デモ論文 1〔2 群〕、1 = デモ論文 2〔3 群〕）。
 * paperData.mjs の PAPERS 配列と同じ順序に対応させる。
 */
export const DEMO_STUDY_IDS = ['demo-study-1', 'demo-study-2'] as const;
export const DEMO_DOCUMENT_IDS = ['demo-doc-1', 'demo-doc-2'] as const;

/**
 * デモ論文の PDF 本体（Drive files.get?alt=media が返すバイナリ）と抽出済みテキスト
 * （extracted_texts/{document_id}.txt 相当）の、fetchMock 内での仮想 Drive ファイル ID。
 * インデックスは DEMO_STUDY_IDS / DEMO_DOCUMENT_IDS と同じ（0=論文1, 1=論文2）。
 */
export const DEMO_DRIVE_PDF_FILE_IDS = ['demo-drive-pdf-1', 'demo-drive-pdf-2'] as const;
export const DEMO_DRIVE_TEXT_FILE_IDS = ['demo-drive-text-1', 'demo-drive-text-2'] as const;

/**
 * デモビルドが同梱する架空論文 PDF のファイル名（video/fixtures/build-fixtures.mjs が
 * video/fixtures/demo-paper-0N.html から生成する。webpack.config.js の CopyPlugin が
 * dist-demo/fixtures/ 直下へ転写し、fetchMock.ts が chrome.runtime.getURL('fixtures/' + name)
 * 経由で読み込む）。paperData.mjs の PAPERS[].filename と同じ値（値を変える場合は両方直すこと）
 */
export const DEMO_FIXTURE_PDF_FILENAMES = ['demo-paper-01.pdf', 'demo-paper-02.pdf'] as const;
