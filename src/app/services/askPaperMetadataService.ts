// 質問済みの監査フラグを復元・保存する。質問と回答は対象にせず、保存失敗でも操作を続ける。
import {
  createChromeProfileDeps,
  getCurrentUserEmail,
  type ProfileDeps,
} from '../../lib/google/identity';
import {
  askPaperUsedStudiesStorageKey,
  loadAskPaperUsedStudies,
  saveAskPaperUsedStudies,
} from '../../lib/storage/askPaperStore';
import type { Store } from '../store';

const scopes = new WeakMap<Store, string>();

export async function loadAskPaperUsedStudyIds(
  store: Store,
  deps: { profile?: ProfileDeps },
): Promise<void> {
  await syncAskPaperUsedStudies(store, deps);
}

export async function rememberAskPaperStudy(
  store: Store,
  deps: { profile?: ProfileDeps },
  studyId: string,
): Promise<void> {
  await syncAskPaperUsedStudies(store, deps, studyId);
}

async function syncAskPaperUsedStudies(
  store: Store,
  deps: { profile?: ProfileDeps },
  studyId?: string,
): Promise<void> {
  const project = store.getState().currentProject;
  if (project === null) return;
  try {
    const email = await getCurrentUserEmail(deps.profile ?? createChromeProfileDeps());
    if (email === null) return;
    const scope = askPaperUsedStudiesStorageKey(project.spreadsheetId, email);
    const saved = await loadAskPaperUsedStudies(project.spreadsheetId, email);
    // 非同期読込中に別プロジェクトへ移った場合は、その状態へ古いフラグを混ぜない。
    if (store.getState().currentProject?.spreadsheetId !== project.spreadsheetId) return;
    const latest = store.getState().askPaper;
    const previousScope = scopes.get(store);
    const currentIds =
      previousScope === undefined || previousScope === scope ? latest.usedStudyIds : [];
    const usedStudyIds = [
      ...new Set([...saved, ...currentIds, ...(studyId === undefined ? [] : [studyId])]),
    ];
    scopes.set(store, scope);
    store.setState({ askPaper: { ...latest, usedStudyIds } });
    if (studyId !== undefined) {
      await saveAskPaperUsedStudies(project.spreadsheetId, email, usedStudyIds);
    }
  } catch {
    console.warn('質問済み study のローカル保存・復元に失敗しました');
  }
}
