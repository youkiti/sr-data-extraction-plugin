// プロジェクト参照の型定義。Popup で選択され chrome.storage.local に永続化し、
// メインビューが起動時に読み込む最小情報（1 プロジェクト = 1 スプレッドシート）
export interface ProjectRef {
  spreadsheetId: string;
  name: string;
}
