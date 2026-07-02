// ルート遷移の前提条件ガード（ui-flow.md §4）。
// allowed = false のルートはサイドバーでディム表示し、遷移せずトーストで案内する。
// warning は「遷移は許可するが警告バナー / トーストを出す」ケース（#/extract のパイロット未実施）
import type { AppState } from './store';

export type GuardResult =
  | {
      allowed: true;
      /** allowed = true でも表示する警告文言（#/extract のパイロット未実施） */
      warning?: string;
    }
  | {
      allowed: false;
      /** 未充足時にトーストで案内する文言 */
      message: string;
    };

export function guardRoute(hash: string, state: AppState): GuardResult {
  const { counts } = state;
  switch (hash) {
    case '#/schema':
      if (counts.protocolVersions < 1) {
        return { allowed: false, message: 'プロトコルを先に入力してください' };
      }
      return { allowed: true };
    case '#/pilot':
      if (counts.schemaVersions < 1 || counts.documents < 1) {
        return {
          allowed: false,
          message: '確定済みスキーマと取り込み済み文献（1 本以上）が必要です',
        };
      }
      return { allowed: true };
    case '#/extract':
      if (counts.schemaVersions < 1) {
        return { allowed: false, message: '確定済みスキーマが必要です' };
      }
      if (counts.pilotRuns < 1) {
        return { allowed: true, warning: 'パイロット抽出を推奨します' };
      }
      return { allowed: true };
    case '#/verify':
      if (counts.evidenceRows < 1) {
        return { allowed: false, message: 'AI 抽出が未実施です。先に抽出を実行してください' };
      }
      return { allowed: true };
    case '#/export':
      if (counts.dataRows < 1) {
        return { allowed: false, message: 'エクスポートできるデータがまだありません' };
      }
      return { allowed: true };
    default:
      // #/home / #/documents / #/protocol / #/dashboard はいつでも遷移可
      return { allowed: true };
  }
}
