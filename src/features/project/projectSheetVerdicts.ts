// S1「最近のスプレッドシート」で Drive にだけあるシートがプロジェクトかどうかの判定を保存する。
// 最大 200 件を保持し、古い判定から削除する。
// ログアウト時は clearProjectSelection 経由で全消去する。
import { getLocal, setLocal, removeLocal } from '../../lib/storage/chromeStorage';

const STORAGE_KEY = 'projectSheetVerdicts';
const MAX_ENTRIES = 200;

// 配列順で保存時の新旧を保持する（先頭が最も古い）。
type VerdictEntry = [string, boolean];

export async function loadProjectSheetVerdicts(): Promise<Map<string, boolean>> {
  const stored = await getLocal<unknown>(STORAGE_KEY);
  if (!Array.isArray(stored)) return new Map();
  return new Map(stored.filter((item): item is VerdictEntry =>
    Array.isArray(item) && item.length === 2 &&
    typeof item[0] === 'string' && typeof item[1] === 'boolean'
  ));
}

export async function saveProjectSheetVerdicts(verdicts: ReadonlyMap<string, boolean>): Promise<void> {
  const stored = await loadProjectSheetVerdicts();
  for (const [id, verdict] of verdicts) {
    stored.delete(id);
    stored.set(id, verdict);
  }
  await setLocal(STORAGE_KEY, [...stored].slice(-MAX_ENTRIES));
}

export async function clearProjectSheetVerdicts(): Promise<void> {
  await removeLocal(STORAGE_KEY);
}
