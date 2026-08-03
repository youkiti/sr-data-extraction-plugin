// デモモード共通定数（tiab-review-plugin/src/demo/constants.ts の方針を踏襲）。
//
// Playwright での録画・自動操作のたびに値が変わらないよう、乱数や Date.now() は
// 一切使わずここに固定値としてまとめる。fetchMock.ts / seed.ts / auth.ts / identity.ts /
// googleDeps.ts / picker.ts から共通で参照する。

/** デモ用スプレッドシートの固定 ID（fetchMock はこの ID へのアクセスのみ許可する） */
export const DEMO_SPREADSHEET_ID = 'demo-spreadsheet-udca-2026';

/** デモ用プロジェクトの固定 ID（Meta.project_id） */
export const DEMO_PROJECT_ID = 'demo-project-udca-2026';

/** デモ用 Drive フォルダの固定 ID（Meta.drive_folder_id。実際にフォルダは作らない） */
export const DEMO_DRIVE_FOLDER_ID = 'demo-drive-folder-udca-2026';

/** プロジェクト名。popup / app のヘッダーに表示される */
export const DEMO_PROJECT_TITLE = 'デモ: 新生児高ビリルビン血症に対する補助療法の RCT レビュー';

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
 */
export const DEMO_TIMESTAMPS = {
  projectCreatedAt: '2026-07-20T00:00:00.000Z',
  protocolCreatedAt: '2026-07-20T00:05:00.000Z',
  documentImportedAt: '2026-07-20T00:10:00.000Z',
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

/** SchemaVersions / StudyData / ResultsData 等が参照する確定スキーマ版・プロトコル版 */
export const DEMO_SCHEMA_VERSION = 1;
export const DEMO_PROTOCOL_VERSION = 1;

/** ExtractionRuns の run_id（AI 一括抽出でシード済みの run） */
export const DEMO_SEED_RUN_ID = 'demo-run-seed-001';

/** study / document の固定 ID（本 PR は実論文 PDF が 1 本のため study は 1 件のみ） */
export const DEMO_STUDY_ID = 'demo-study-udca';
export const DEMO_DOCUMENT_ID = 'demo-doc-udca';

/**
 * デモ論文の PDF 本体（Drive files.get?alt=media が返すバイナリ）と抽出済みテキスト
 * （extracted_texts/{document_id}.txt 相当。Drive files.get?alt=media がテキストとして返す）
 * の、fetchMock 内での仮想 Drive ファイル ID。
 */
export const DEMO_DRIVE_PDF_FILE_ID = 'demo-drive-pdf-udca';
export const DEMO_DRIVE_TEXT_FILE_ID = 'demo-drive-text-udca';

/**
 * video/fixtures/fetch-fixtures.sh が取得する実 PDF のファイル名（拡張バンドル内での配置は
 * webpack.config.js の CopyPlugin が `fixtures/` 直下へ転写する）。
 * fetchMock.ts が chrome.runtime.getURL('fixtures/' + DEMO_FIXTURE_PDF_FILENAME) 経由で読み込む。
 */
export const DEMO_FIXTURE_PDF_FILENAME = 'PMC10715657_plosone_udca_rct.pdf';

/** 群構成（ArmStructures）の固定キー・名称 */
export const DEMO_ARM_KEYS = ['arm:1', 'arm:2'] as const;
export const DEMO_ARM_NAMES: Record<(typeof DEMO_ARM_KEYS)[number], string> = {
  'arm:1': 'UDCA + 光線療法群',
  'arm:2': '光線療法単独群（対照）',
};

/** outcome_result の entity_key（アウトカム: 総ビリルビン低下率、群別） */
export const DEMO_OUTCOME_ENTITY_KEYS = [
  'outcome:tsb_reduction|arm:1',
  'outcome:tsb_reduction|arm:2',
] as const;
