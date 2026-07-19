// S1「tiab-review から引き継いで作成」→ S3 引き継ぎパネルの受け渡し状態（※Q2。
// docs/ui-states.md §1 / §3）。chrome.storage.local に**プロジェクト単位のキー**で保持する
// （ignoredCandidatesKey と同じ流儀。単一スロットだと別プロジェクトの引き継ぎ作成や
// 古いタブからの反映確定が他プロジェクトの保留中の引き継ぎを巻き込んで消してしまう）。
// 反映実行（applyTiabImport）の成功、または「この案内を閉じる」で破棄する
import { getLocal, removeLocal, setLocal } from '../../lib/storage/chromeStorage';

/** 引き継ぎ状態を保存する storage.local キー（プロジェクト単位） */
export function tiabHandoffKey(projectId: string): string {
  return `sr-data-extraction:tiab-handoff:${projectId}`;
}

export interface TiabHandoff {
  /** tiab-review スプレッドシートの ID（S1 の Picker 選択で drive.file 付与済み） */
  tiabSheetId: string;
}

export async function saveTiabHandoff(projectId: string, handoff: TiabHandoff): Promise<void> {
  await setLocal(tiabHandoffKey(projectId), handoff);
}

export async function loadTiabHandoff(projectId: string): Promise<TiabHandoff | null> {
  return (await getLocal<TiabHandoff>(tiabHandoffKey(projectId))) ?? null;
}

export async function clearTiabHandoff(projectId: string): Promise<void> {
  await removeLocal(tiabHandoffKey(projectId));
}
