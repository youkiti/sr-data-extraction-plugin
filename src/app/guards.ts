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
 * reviewer 系ロール（reviewer_with_ai / reviewer_independent / adjudicator）は #/home と
 * #/verify 以外へ遷移できない（盲検の漏えい面遮断。design §3.1）。#/verify は加えてフォルダ
 * アクセス付与（§7.2）を要求する。
 *
 * `#/adjudicate`（S12。裁定は盲検解除後の工程）は owner / adjudicator のみ許可し、counts に
 * よる入場条件は課さない（design §6.1・§9 PR3。対象が無ければ画面内の空状態で案内する）
 */
export function guardRoute(hash: string, state: AppState, role: ProjectRole = 'owner'): GuardResult {
  const { counts } = state;
  if (hash === '#/adjudicate') {
    return role === 'owner' || role === 'adjudicator'
      ? { allowed: true }
      : { allowed: false, message: 'このプロジェクトでは裁定権限のため利用できません' };
  }
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
      if (role !== 'owner') {
        // reviewer 系ロールは盲検のため loadProgressCounts を読み込まず、state.counts は
        // 常に初期値（全 0）のまま変化しない。設計（design §3.1）は mode② の入場ガードを
        // 「schemaVersions ≥ 1 かつ studies ≥ 1」へ差し替えるとしているが、reviewer_with_ai の
        // 「evidenceRows ≥ 1」も含め counts に依拠する判定は reviewer には常に false になり、
        // フォルダアクセスを付与していても #/verify へ永久に入れなくなるバグになる（監査で発覚）。
        // そのため reviewer 系ロールは counts ベースの判定を一切行わず、フォルダアクセス付与の
        // みをゲートにする。「AI 抽出が未実施」「確定スキーマが無い」は検証画面（verifyService の
        // 読込結果）内の空状態表示に譲る（意図的な設計からの逸脱。実装指示に基づく）
        if (!state.role.folderAccessGranted) {
          return {
            allowed: false,
            message: 'プロジェクトフォルダへのアクセス付与が必要です（Home から付与してください）',
          };
        }
        return { allowed: true };
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
