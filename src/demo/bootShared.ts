// 3 エントリ（app-entry.ts / popup-entry.ts / options-entry.ts）共通の起動前処理。
//
// 起動順序が重要: 1) fetch モックを先にインストール → 2) chrome.storage
// （選択中プロジェクト・API キー）をシード → 3) インメモリ Sheets ストアへ全データをシード →
// 4) 各エントリがこの後で実物のエントリ処理（bootstrapApp 等）を動的 import する。
// 逆順にすると各画面が「まだ何もシードされていない」状態の fetch / storage を読みに行ってしまい、
// プロジェクト未選択のまま起動してしまう。
import { installDemoFetchMock, setDemoDelaysEnabled } from './fetchMock';
import { seedDemoData } from './seed';
import { setCurrentProject } from '../features/project/projectStore';
import { saveGeminiApiKey } from '../lib/storage/secretsStore';
import {
  DEMO_DRIVE_FOLDER_ID,
  DEMO_PROJECT_ID,
  DEMO_PROJECT_TITLE,
  DEMO_SPREADSHEET_ID,
} from './constants';

/** 本物と絶対に混同しないよう、それと分かるダミー文字列にする（本物の API キーは絶対に使わない） */
const DEMO_GEMINI_API_KEY = 'demo-api-key-not-a-real-secret';

/**
 * chrome.storage（選択中プロジェクト・ダミー API キー）とインメモリ Sheets ストアをシードする。
 * 各エントリはこの関数の完了を待ってから実物のエントリ処理を動的 import する。
 *
 * 初期シード投入中（数十回の Sheets 呼び出し）は fetchMock の人工遅延を無効化する
 * （§ fetchMock.ts の delaysEnabled コメント参照）。初期シードは「実際のユーザー操作」ではなく
 * 起動時のセットアップのため、ここに遅延を入れると画面を開くたびに長時間ローディングのままに
 * なってしまう。シード完了後は必ず遅延ありへ戻し、以降の実操作（一括抽出の実行・検証の判定保存等）
 * では実運用らしい待ち時間を保つ。
 */
export async function seedDemoState(): Promise<void> {
  installDemoFetchMock();
  setDemoDelaysEnabled(false);
  try {
    await setCurrentProject({
      projectId: DEMO_PROJECT_ID,
      spreadsheetId: DEMO_SPREADSHEET_ID,
      driveFolderId: DEMO_DRIVE_FOLDER_ID,
      name: DEMO_PROJECT_TITLE,
    });
    // Options が「設定済み」状態で映るようにする（デモ用ダミー値。本物のキーは絶対に埋め込まない）
    await saveGeminiApiKey(DEMO_GEMINI_API_KEY);
    await seedDemoData();
  } finally {
    setDemoDelaysEnabled(true);
  }
}
