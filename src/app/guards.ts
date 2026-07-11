// ルート遷移の前提条件ガード（ui-flow.md §4 + docs/design-independent-dual-review.md §3.1）。
// allowed = false のルートはサイドバーでディム表示し、遷移せずトーストで案内する。
// warning は「遷移は許可するが警告バナー / トーストを出す」ケース（#/extract のパイロット未実施）
import type { ProjectRole } from '../domain/reviewer';
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

/**
 * role は省略時 'owner'（未解決 = null のあいだも制限なしとして扱う。roleService.loadRole が
 * 解決するまでの一時的な状態で、既存の owner 専用プロジェクトの挙動を変えないための既定値）。
 *
 * reviewer 系ロール（reviewer_with_ai / reviewer_independent / adjudicator。adjudicator は
 * #/adjudicate 未実装のフェーズ 1 では reviewer と同じ扱い）は #/home と #/verify 以外へ
 * 遷移できない（盲検の漏えい面遮断。design §3.1）。#/verify は加えてフォルダアクセス付与
 * （§7.2）を要求する
 */
export function guardRoute(hash: string, state: AppState, role: ProjectRole = 'owner'): GuardResult {
  const { counts } = state;
  if (role !== 'owner' && hash !== '#/home' && hash !== '#/verify') {
    return { allowed: false, message: 'このプロジェクトではレビュアー権限のため利用できません' };
  }
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
          message: '確定済みの表のデザインと取り込み済み文献（1 本以上）が必要です',
        };
      }
      return { allowed: true };
    case '#/extract':
      if (counts.schemaVersions < 1) {
        return { allowed: false, message: '確定済みの表のデザインが必要です' };
      }
      if (counts.pilotRuns < 1) {
        return { allowed: true, warning: 'パイロット抽出を推奨します' };
      }
      return { allowed: true };
    case '#/verify':
      if (role !== 'owner' && !state.role.folderAccessGranted) {
        return {
          allowed: false,
          message: 'プロジェクトフォルダへのアクセス付与が必要です（Home から付与してください）',
        };
      }
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
