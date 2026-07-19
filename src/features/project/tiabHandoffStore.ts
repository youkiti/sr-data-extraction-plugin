// S1「tiab-review から引き継いで作成」→ S3 引き継ぎパネルの受け渡し状態（※Q2。
// docs/ui-states.md §1 / §3）。chrome.storage.local に 1 スロットだけ保持し、
// S3 は currentProject と projectId が一致するときだけ引き継ぎパネルを表示する。
// 反映実行（applyTiabImport）の成功、または「この案内を閉じる」で破棄する
import { getLocal, removeLocal, setLocal } from '../../lib/storage/chromeStorage';

export const TIAB_HANDOFF_STORAGE_KEY = 'tiabHandoff';

export interface TiabHandoff {
  /** 引き継ぎ先（S1 で自動作成した）プロジェクト */
  projectId: string;
  /** tiab-review スプレッドシートの ID（S1 の Picker 選択で drive.file 付与済み） */
  tiabSheetId: string;
}

export async function saveTiabHandoff(handoff: TiabHandoff): Promise<void> {
  await setLocal(TIAB_HANDOFF_STORAGE_KEY, handoff);
}

export async function loadTiabHandoff(): Promise<TiabHandoff | null> {
  return (await getLocal<TiabHandoff>(TIAB_HANDOFF_STORAGE_KEY)) ?? null;
}

export async function clearTiabHandoff(): Promise<void> {
  await removeLocal(TIAB_HANDOFF_STORAGE_KEY);
}
