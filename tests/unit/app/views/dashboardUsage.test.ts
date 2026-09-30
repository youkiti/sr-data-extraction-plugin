import { renderDashboardUsage } from '../../../../src/app/views/dashboardUsage';
import { createInitialState, createStore, type DashboardState } from '../../../../src/app/store';
import { aggregateUsage, type UsageSummary } from '../../../../src/features/usage/aggregateUsage';
import { setUiLanguage } from '../../../../src/lib/i18n';

function render(patch: Partial<DashboardState['usage']> = {}) {
  const callbacks = {
    onReload: jest.fn(),
    onReloadUsage: jest.fn(),
    onSaveBudget: jest.fn(),
    onBudgetDraftChange: jest.fn(),
    onBudgetError: jest.fn(),
  };
  const usage = { ...createInitialState().dashboard.usage, ...patch };
  const root = renderDashboardUsage(usage, callbacks);
  return {
    root,
    callbacks,
    input: root.querySelector<HTMLInputElement>('#dashboard-budget-input'),
  };
}

function empty(): UsageSummary {
  return aggregateUsage({ logs: [], runs: [] });
}

function filled(): UsageSummary {
  const summary = empty();
  summary.totals = {
    calls: 3,
    errorCalls: 1,
    tokensIn: 100,
    tokensOut: 20,
    cachedTokensIn: 80,
    costUsd: 4,
    wastedCostUsd: 1,
    unknownPriceCalls: 1,
    cacheHitRate: 0.8,
  };
  summary.costPerStudyUsd = 2;
  summary.byRun = [true, false].map((estimated) => ({
    ...summary.totals,
    key: String(estimated),
    runId: String(estimated),
    runType: 'full',
    status: estimated ? 'running' : 'done',
    model: 'model',
    startedAt: estimated ? null : '2026-08-01',
    succeededStudies: 2,
    costPerStudyUsd: 2,
    estimated,
    successCountEstimated: estimated,
  }));
  summary.byRun.push({ ...summary.byRun[1]!, status: 'partial_failure' });
  summary.byPurpose = [{ ...summary.totals, key: 'extract_study' }];
  summary.byModel = [{ ...summary.totals, key: 'model' }];
  summary.byMonth = [{ ...summary.totals, key: '2026-08' }];
  summary.byRunType[2]!.calls = 1;
  summary.byRunType[2]!.costPerStudyUsd = 2;
  summary.undercountedGeminiCalls = 1;
  summary.undercountedGeminiCostUsd = 1;
  summary.estimatedCalls = 1;
  summary.unassignedCalls = 1;
  return summary;
}

describe('費用・予算カード', () => {
  beforeEach(() => {
    setUiLanguage('ja');
  });

  test('独立した読込中・未読込・失敗と再読込操作を表示する', () => {
    const initial = render();
    expect(initial.root.querySelector('#dashboard-usage-loading')).not.toBeNull();
    const loading = render({ loading: true });
    expect(loading.root.querySelector<HTMLButtonElement>('#dashboard-usage-reload')?.disabled).toBe(
      true,
    );
    const failed = render({ loadError: '失敗' });
    expect(failed.root.querySelector('#dashboard-usage-error')?.getAttribute('role')).toBe('alert');
    failed.root.querySelector<HTMLButtonElement>('#dashboard-usage-reload')?.click();
    expect(failed.callbacks.onReloadUsage).toHaveBeenCalled();
  });

  test('未呼出でも空表・不明値・未設定予算と入力のラベルを表示する', () => {
    const { root, input } = render({ summary: empty() });
    expect(root.querySelector('#dashboard-usage-summary')?.textContent).toContain('—');
    expect(root.querySelector('#dashboard-usage-by-run')?.tagName).toBe('P');
    expect(root.querySelector('#dashboard-budget-status')?.textContent).toBe('未設定');
    expect(input?.getAttribute('aria-label')).toBe('プロジェクト予算 (USD)');
    expect(input?.type).toBe('text');
    expect(input?.getAttribute('inputmode')).toBe('decimal');
    expect(root.querySelector('#dashboard-budget-clear')).toBeNull();
    expect(root.querySelector('#dashboard-usage-undercount')).toBeNull();
  });

  test('全軸・過小計上と推定割当・単一 study費用・予算超過を表示する', () => {
    const { root, callbacks } = render({
      summary: filled(),
      budget: { budgetUsd: 2, updatedBy: 'owner', updatedAt: '2026-08-01' },
    });
    expect(root.querySelector('#dashboard-usage-summary')?.textContent).toContain('$4.0000');
    expect(root.querySelector('#dashboard-usage-summary')?.textContent).toContain(
      '成功 study あたりの費用',
    );
    expect(root.querySelector('#dashboard-usage-by-run')?.textContent).toContain('成功 study 数');
    expect(root.textContent).toContain('80.0%');
    expect(root.textContent).toContain('1 回を合計から除外');
    expect(root.textContent).toContain('単一 study');
    expect(root.querySelector('#dashboard-usage-undercount')?.textContent).toContain('過小計上');
    expect(root.querySelector('#dashboard-usage-estimated')?.textContent).toContain('未割当: 1');
    expect(root.querySelector('.dashboard__estimated')?.textContent).toBe('推定');
    expect(root.querySelector('#dashboard-usage-by-run')?.tagName).toBe('TABLE');
    expect(root.querySelector('#dashboard-usage-by-run')?.textContent).toContain('中断');
    expect(root.querySelector('#dashboard-usage-by-run')?.textContent).toContain('一部失敗');
    expect(root.querySelector('#dashboard-budget-status')?.textContent).toContain('200.0%');
    expect(root.querySelector('#dashboard-budget-over')?.getAttribute('role')).toBe('status');
    root.querySelector<HTMLButtonElement>('#dashboard-budget-clear')?.click();
    expect(callbacks.onSaveBudget).toHaveBeenCalledWith(null);
  });

  test('予算以下・更新者なし・手編集のゼロ予算を扱い、保存中は操作を無効にする', () => {
    const result = render({
      summary: empty(),
      budgetSaving: true,
      budget: { budgetUsd: 0, updatedBy: null, updatedAt: null },
    });
    expect(result.root.querySelector('#dashboard-budget-status')?.textContent).toContain('—');
    for (const id of ['save', 'clear']) {
      expect(
        result.root.querySelector<HTMLButtonElement>(`#dashboard-budget-${id}`)?.disabled,
      ).toBe(true);
    }
    expect(result.input?.disabled).toBe(true);
    expect(result.root.querySelector('#dashboard-budget-over')).toBeNull();
  });

  test('存在しない run 種別の単価も不明とし、未割当だけでも注記する', () => {
    const summary = empty();
    summary.byRunType = [];
    summary.unassignedCalls = 2;
    const { root } = render({ summary });
    expect(root.querySelector('#dashboard-usage-estimated')?.textContent).toContain('未割当: 2');
    expect(root.textContent).not.toContain('単一 study');
  });

  test('空・非有限・ゼロ・負数の下書きをサービスへ渡さず、正数は保存する', () => {
    for (const budgetDraft of ['', '   ', '0', '-1', 'Infinity', '非数値']) {
      const { root, callbacks } = render({
        summary: empty(), budgetDraft, budgetError: '保存失敗',
      });
      expect(root.querySelector('#dashboard-budget-error')?.textContent).toContain('保存失敗');
      root.querySelector<HTMLButtonElement>('#dashboard-budget-save')!.click();
      expect(callbacks.onSaveBudget).not.toHaveBeenCalled();
      expect(callbacks.onBudgetError).toHaveBeenCalledWith(
        '0 より大きい有限の金額を入力してください',
      );
    }
    const { root, callbacks } = render({ summary: empty(), budgetDraft: ' 12.34 ' });
    root.querySelector<HTMLButtonElement>('#dashboard-budget-save')!.click();
    expect(callbacks.onSaveBudget).toHaveBeenCalledWith(12.34);
  });

  test('下書きと検証エラーは進捗の再描画で消えず、保存には state の値を使う', () => {
    const state = createInitialState();
    state.dashboard.usage.summary = empty();
    const store = createStore(state);
    const container = document.createElement('div');
    const callbacks = {
      onReload: jest.fn(),
      onReloadUsage: jest.fn(),
      onSaveBudget: jest.fn(),
      onBudgetDraftChange: (value: string) => {
        const dashboard = store.getState().dashboard;
        store.setState({
          dashboard: {
            ...dashboard,
            usage: { ...dashboard.usage, budgetDraft: value, budgetError: null },
          },
        });
      },
      onBudgetError: (reason: string) => {
        const dashboard = store.getState().dashboard;
        store.setState({
          dashboard: { ...dashboard, usage: { ...dashboard.usage, budgetError: reason } },
        });
      },
    };
    const rerender = () => {
      container.replaceChildren(renderDashboardUsage(store.getState().dashboard.usage, callbacks));
    };
    const unsubscribe = store.subscribe(rerender);
    rerender();
    container.querySelector<HTMLButtonElement>('#dashboard-budget-save')!.click();
    store.setState({ dashboard: { ...store.getState().dashboard, loadError: '進捗読込失敗' } });
    const error = container.querySelector<HTMLElement>('#dashboard-budget-error')!;
    expect(error.hidden).toBe(false);
    expect(error.textContent).toContain('0 より大きい有限の金額');
    const input = container.querySelector<HTMLInputElement>('#dashboard-budget-input')!;
    input.value = '10.25';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    expect(store.getState().dashboard.usage.budgetError).toBeNull();
    store.setState({ dashboard: { ...store.getState().dashboard, loadError: null } });
    const restored = container.querySelector<HTMLInputElement>('#dashboard-budget-input')!;
    expect(restored.value).toBe('10.25');
    // DOM だけを変更しても保存には保持済みの下書きを使う。
    restored.value = '99';
    container.querySelector<HTMLButtonElement>('#dashboard-budget-save')!.click();
    expect(callbacks.onSaveBudget).toHaveBeenCalledWith(10.25);
    unsubscribe();
  });

  test('未編集なら保存済み予算を入力・保存に使う', () => {
    const { root, input, callbacks } = render({
      summary: empty(),
      budget: { budgetUsd: 2, updatedBy: 'owner', updatedAt: '日時' },
    });
    expect(input?.value).toBe('2');
    root.querySelector<HTMLButtonElement>('#dashboard-budget-save')!.click();
    expect(callbacks.onSaveBudget).toHaveBeenCalledWith(2);
  });

  test('英語でも費用と予算説明を表示する', () => {
    setUiLanguage('en');
    const { root } = render({ summary: empty() });
    expect(root.textContent).toContain('estimated from the price table');
    expect(root.textContent).toContain('never blocks runs');
  });
});
