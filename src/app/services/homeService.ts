// #/home + ガードの進捗カウント読込サービス。
// 起動時（bootstrap）に 1 回読み込み、以後は各画面の操作が counts を増分更新する。
// 読込失敗時は #/home の再読み込みボタン（force）で再取得できる。
// 独立二重レビュー機能（docs/design-independent-dual-review.md §3）: reviewer 系ロールには
// 進捗カウント（Decisions 総数等の間接的な進捗情報）を見せないため、ロールが解決済みで
// owner でないと分かっている間はそもそも読み込まない
import { readProgressCounts } from '../../features/project/progressCounts';
import type { GoogleApiDeps } from '../../lib/google/types';
import type { HomeState, Store } from '../store';

import { computeAnnotatorProgress } from '../../features/adjudication/gate';
import { isReviewSetsActive } from '../../features/review/reviewSets';
import { readDocuments } from '../../features/documents/documentRepository';
import { resolveActiveStudies } from '../../features/documents/studyRepository';
import { getCurrentUserEmail } from '../../lib/google/identity';
import {
  readReviewSetProgressMaterials,
  filterReviewSetStudies,
  reviewSetsForFiltering,
  requireReviewSets,
  reviewSetStudies,
  type ReviewSetServiceDeps,
} from './reviewSetService';

export interface HomeServiceDeps {
  google: GoogleApiDeps;
}

function toMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/** home スライスだけを差し替える setState ヘルパ（他スライスは維持） */
function patchHome(store: Store, patch: Partial<HomeState>): void {
  store.setState({ home: { ...store.getState().home, ...patch } });
}

/**
 * 進捗カウントを Sheets から読み込む（起動時 + #/home 入場時。
 * 読込済みなら no-op、force で強制再取得）。プロジェクト未選択なら何もしない
 */
export async function loadProgressCounts(
  store: Store,
  deps: HomeServiceDeps,
  options: { force?: boolean } = {},
): Promise<void> {
  const state = store.getState();
  const project = state.currentProject;
  if (!project || state.home.countsLoading) {
    return;
  }
  if (state.role.role !== null && state.role.role !== 'owner') {
    return;
  }
  if (state.home.countsLoaded && options.force !== true) {
    return;
  }
  patchHome(store, { countsLoading: true, countsError: null });
  try {
    const counts = await readProgressCounts(project.spreadsheetId, deps.google);
    store.setState({
      counts,
      home: { ...store.getState().home, countsLoading: false, countsLoaded: true },
    });
  } catch (err) {
    patchHome(store, { countsLoading: false, countsError: toMessage(err) });
  }
}

/** reviewer 系 Home には自分の担当 study の完了数だけを読み込む */
export async function loadAssignedProgress(
  store: Store,
  deps: ReviewSetServiceDeps,
): Promise<void> {
  const state = store.getState();
  const project = state.currentProject;
  if (
    !project ||
    state.role.role === null ||
    state.role.role === 'owner' ||
    state.home.assignedProgressLoading
  )
    return;
  patchHome(store, { assignedProgressLoading: true, assignedProgressError: null });
  try {
    await requireReviewSets(store, deps);
    const studies = await reviewSetStudies(store, deps);
    const documents =
      store.getState().documents.records ??
      (await readDocuments(project.spreadsheetId, deps.google));
    const sets = reviewSetsForFiltering(store, true);
    if (!isReviewSetsActive(resolveActiveStudies(studies, documents), sets)) {
      patchHome(store, { assignedProgressLoading: false, assignedProgress: null });
      return;
    }
    const email = (await getCurrentUserEmail(deps.profile)) ?? '';
    const material = await readReviewSetProgressMaterials(store, deps);
    const ownStudies = filterReviewSetStudies(store, material.studies, documents, email, true);
    const done = ownStudies.filter(
      (study) =>
        computeAnnotatorProgress(
          email,
          material.fields,
          material.decisions.filter((decision) => decision.studyId === study.studyId),
          material.armStructures.get(study.studyId)?.get(email) ?? null,
        ).complete,
    ).length;
    patchHome(store, {
      assignedProgressLoading: false,
      assignedProgress: { done, total: ownStudies.length },
    });
  } catch (error) {
    patchHome(store, {
      assignedProgressLoading: false,
      assignedProgress: null,
      assignedProgressError: toMessage(error),
    });
  }
}
