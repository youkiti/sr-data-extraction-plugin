// owner 用費用集計と予算保存。検証進捗の読込成否から独立して動く。
import { readUsageRuns } from '../../features/extraction/runRepository';
import { readProjectBudget, saveProjectBudget } from '../../features/project/projectBudget';
import { aggregateUsage } from '../../features/usage/aggregateUsage';
import { getCurrentUserEmail, type ProfileDeps } from '../../lib/google/identity';
import type { GoogleApiDeps } from '../../lib/google/types';
import { readLlmApiLogEntries } from '../../lib/llm/apiLogRepository';
import { nowIso8601 } from '../../utils/iso8601';
import type { DashboardState, Store } from '../store';

export interface UsageServiceDeps {
  google: GoogleApiDeps;
  profile: ProfileDeps;
  now?: () => string;
}

// store ごとの要求番号で、遅れて完了した古い読込による上書きを防ぐ。
const usageRequestSequences = new WeakMap<Store, number>();

function patchUsage(store: Store, patch: Partial<DashboardState['usage']>): void {
  const dashboard = store.getState().dashboard;
  store.setState({ dashboard: { ...dashboard, usage: { ...dashboard.usage, ...patch } } });
}

/**
 * 全 purpose のログ、完了・中断 run、予算を並行読込し、独立キャッシュへ保存する。
 * 強制読込は読込中でも開始し、成功・失敗とも最新の要求だけを state に反映する。
 */
export async function loadUsage(
  store: Store,
  deps: UsageServiceDeps,
  options: { force?: boolean } = {},
): Promise<void> {
  const state = store.getState();
  const project = state.currentProject;
  if (!project || (state.role.role ?? 'owner') !== 'owner') {
    return;
  }
  if (
    (state.dashboard.usage.loading || state.dashboard.usage.summary !== null) &&
    options.force !== true
  ) {
    return;
  }
  const requestSequence = (usageRequestSequences.get(store) ?? 0) + 1;
  usageRequestSequences.set(store, requestSequence);
  patchUsage(store, { loading: true, loadError: null });
  try {
    const [logs, runs, budget] = await Promise.all([
      readLlmApiLogEntries(project.spreadsheetId, deps.google),
      readUsageRuns(project.spreadsheetId, deps.google),
      readProjectBudget(project.spreadsheetId, deps.google),
    ]);
    if (usageRequestSequences.get(store) !== requestSequence) {
      return;
    }
    patchUsage(store, { summary: aggregateUsage({ logs, runs }), budget, loading: false });
  } catch (err) {
    if (usageRequestSequences.get(store) !== requestSequence) {
      return;
    }
    patchUsage(store, {
      loading: false,
      loadError: err instanceof Error ? err.message : String(err),
    });
  }
}

/** 予算列の上書きは owner だけ。更新者と日時を付け、保存後に費用と予算を再取得する。 */
export async function saveBudget(
  store: Store,
  deps: UsageServiceDeps,
  budgetUsd: number | null,
): Promise<void> {
  const state = store.getState();
  const project = state.currentProject;
  if (!project || (state.role.role ?? 'owner') !== 'owner' || state.dashboard.usage.budgetSaving) {
    return;
  }
  patchUsage(store, { budgetSaving: true, budgetError: null });
  try {
    const email = await getCurrentUserEmail(deps.profile);
    await saveProjectBudget(
      project.spreadsheetId,
      {
        budgetUsd,
        updatedBy: email ?? '',
        updatedAt: (deps.now ?? nowIso8601)(),
      },
      deps.google,
    );
    await loadUsage(store, deps, { force: true });
    patchUsage(store, { budgetSaving: false, budgetDraft: null });
  } catch (err) {
    patchUsage(store, {
      budgetSaving: false,
      budgetError: err instanceof Error ? err.message : String(err),
    });
  }
}

/** S7 の予算警告は失敗しても抽出を妨げない。累積費用だけなので完了 run の読込は不要。 */
export async function loadExtractBudget(
  store: Store,
  deps: { google: GoogleApiDeps },
): Promise<void> {
  const state = store.getState();
  const project = state.currentProject;
  if (!project || (state.role.role ?? 'owner') !== 'owner') {
    return;
  }
  let budget: typeof state.extract.budget = null;
  try {
    const [projectBudget, logs] = await Promise.all([
      readProjectBudget(project.spreadsheetId, deps.google),
      readLlmApiLogEntries(project.spreadsheetId, deps.google),
    ]);
    const summary = aggregateUsage({ logs, runs: [] });
    budget = {
      budgetUsd: projectBudget.budgetUsd,
      spentUsd: summary.totals.costUsd,
      unknownPriceCalls: summary.totals.unknownPriceCalls,
    };
  } catch {
    // 費用の取得失敗は警告なしとして扱う。
  }
  store.setState({ extract: { ...store.getState().extract, budget } });
}
