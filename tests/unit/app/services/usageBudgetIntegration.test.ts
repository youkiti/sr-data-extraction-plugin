import { loadUsage, saveBudget } from '../../../../src/app/services/usageService';
import { createInitialState, createStore } from '../../../../src/app/store';
import { renderDashboardUsage } from '../../../../src/app/views/dashboardUsage';
import { META_BUDGET_COLUMNS, SHEET_HEADERS } from '../../../../src/domain/sheetsSchema';
import type { GoogleApiDeps } from '../../../../src/lib/google/types';
import { setUiLanguage } from '../../../../src/lib/i18n';

describe('予算フォームから範囲保存・再読込まで', () => {
  test('Meta の予算範囲だけを更新し、再読込後に未設定表示と保存中フラグを解除する', async () => {
    setUiLanguage('ja');
    const base = ['pid', '題名', 'sid', 'folder', '1.0', '作成日時', 'owner'];
    const meta: (string | number | boolean)[][] = [[...SHEET_HEADERS.Meta], [...base]];
    const writes: string[] = [];
    const fetchStub = jest.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = decodeURIComponent(String(input));
      let values: unknown[][] = [];
      if (init?.method === 'PUT') {
        const range = url.split('/values/')[1]!.split('?')[0]!;
        const row = (
          JSON.parse(init.body as string) as {
            values: (string | number | boolean)[][];
          }
        ).values[0]!;
        writes.push(range);
        // 読取後に別ユーザーが基本列を編集しても戻さない。
        meta[1]![1] = '同時編集された題名';
        meta[range === 'Meta!H1:J1' ? 0 : 1]!.splice(7, 3, ...row);
      } else if (url.endsWith('/Meta')) {
        values = meta;
      } else if (url.endsWith('/LLMApiLog')) {
        values = [[...SHEET_HEADERS.LLMApiLog]];
      } else if (url.endsWith('/ExtractionRuns')) {
        values = [[...SHEET_HEADERS.ExtractionRuns]];
      }
      return { ok: true, status: 200, json: async () => ({ values }) } as Response;
    });
    const google: GoogleApiDeps = {
      fetch: fetchStub,
      getAccessToken: async () => 'token',
    };
    const deps = {
      google,
      profile: { getProfileUserInfo: async () => ({ email: 'owner@example.com', id: '' }) },
      now: () => '2026-09-30T00:00:00Z',
    };
    const state = createInitialState();
    state.currentProject = {
      projectId: 'pid',
      spreadsheetId: 'sid',
      driveFolderId: 'folder',
      name: '予算テスト',
    };
    const store = createStore(state);
    await loadUsage(store, deps);
    expect(store.getState().dashboard.usage.budget?.budgetUsd).toBeNull();
    let saving: Promise<void> | undefined;
    const callbacks = {
      onReload: jest.fn(),
      onReloadUsage: jest.fn(),
      onBudgetDraftChange: (value: string) => {
        const dashboard = store.getState().dashboard;
        store.setState({
          dashboard: {
            ...dashboard,
            usage: { ...dashboard.usage, budgetDraft: value, budgetError: null },
          },
        });
      },
      onBudgetError: jest.fn(),
      onSaveBudget: (value: number | null) => {
        saving = saveBudget(store, deps, value);
      },
    };
    const container = document.createElement('div');
    const rerender = () => {
      container.replaceChildren(renderDashboardUsage(store.getState().dashboard.usage, callbacks));
    };
    const unsubscribe = store.subscribe(rerender);
    rerender();
    const input = container.querySelector<HTMLInputElement>('#dashboard-budget-input')!;
    input.value = '10.25';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    container.querySelector<HTMLButtonElement>('#dashboard-budget-save')!.click();
    await saving;
    expect(writes).toEqual(['Meta!H1:J1', 'Meta!H2:J2']);
    expect(meta[0]).toEqual([...SHEET_HEADERS.Meta, ...META_BUDGET_COLUMNS]);
    expect(meta[1]!.slice(7)).toEqual([10.25, 'owner@example.com', '2026-09-30T00:00:00Z']);
    expect(meta[1]![1]).toBe('同時編集された題名');
    expect(store.getState().dashboard.usage).toMatchObject({
      budget: { budgetUsd: 10.25 },
      loading: false,
      budgetSaving: false,
      loadError: null,
      budgetError: null,
      budgetDraft: null,
    });
    const savedCard = renderDashboardUsage(store.getState().dashboard.usage, callbacks);
    expect(savedCard.querySelector('#dashboard-budget-status')?.textContent).toContain('$10.2500');
    expect(savedCard.querySelector<HTMLInputElement>('#dashboard-budget-input')?.value).toBe('10.25');
    unsubscribe();
  });
});
