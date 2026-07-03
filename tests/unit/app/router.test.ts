import { ROUTES, docQueryOf, entityQueryOf, findRoute, normalizeHash } from '../../../src/app/router';
import { createInitialState } from '../../../src/app/store';
import type { ViewContext } from '../../../src/app/views/types';

const stubCtx: ViewContext = {
  home: { onReload: jest.fn() },
  documents: { onImport: jest.fn(), onReload: jest.fn(), onSaveStudyLabel: jest.fn() },
  protocol: {
    onSubmit: jest.fn(),
    onStartEdit: jest.fn(),
    onCancelEdit: jest.fn(),
    onSelectVersion: jest.fn(),
    onReload: jest.fn(),
  },
  schema: {
    onReload: jest.fn(),
    onToggleSample: jest.fn(),
    onChangeModel: jest.fn(),
    onRunDraft: jest.fn(),
    onEditRow: jest.fn(),
    onAddRow: jest.fn(),
    onRemoveRow: jest.fn(),
    onInsertPreset: jest.fn(),
    onConfirm: jest.fn(),
    onCancelEditor: jest.fn(),
    onStartNewVersion: jest.fn(),
  },
  pilot: {
    onToggleDocument: jest.fn(),
    onChangeModel: jest.fn(),
    onRun: jest.fn(),
    onSelectVerifyDocument: jest.fn(),
    onRetryVerifyLoad: jest.fn(),
    onDecision: jest.fn(),
    onArmConfirm: jest.fn(),
  },
  extract: {
    onToggleDocument: jest.fn(),
    onChangeModel: jest.fn(),
    onRequestRun: jest.fn(),
    onConfirmRun: jest.fn(),
    onCancelConfirm: jest.fn(),
    onRetryDocument: jest.fn(),
    onReloadTargets: jest.fn(),
  },
  verify: {
    onSelectDocument: jest.fn(),
    onRetryLoad: jest.fn(),
    onDecision: jest.fn(),
    onArmConfirm: jest.fn(),
  },
  dashboard: { onReload: jest.fn() },
  export: {
    onSelectFormat: jest.fn(),
    onGenerate: jest.fn(),
    onConfirmGenerate: jest.fn(),
    onCancelGenerate: jest.fn(),
    onDownload: jest.fn(),
    onReload: jest.fn(),
  },
};

describe('normalizeHash', () => {
  test('定義済みハッシュはそのまま返す', () => {
    expect(normalizeHash('#/documents')).toBe('#/documents');
  });

  test('クエリ付き（#/verify?doc=...）はクエリを切り落とす', () => {
    expect(normalizeHash('#/verify?doc=abc&entity=arm:1')).toBe('#/verify');
  });

  test('未知のハッシュ・空文字は #/home へ倒す', () => {
    expect(normalizeHash('#/unknown')).toBe('#/home');
    expect(normalizeHash('')).toBe('#/home');
  });
});

describe('findRoute', () => {
  test('ハッシュに対応するルート定義を返す', () => {
    expect(findRoute('#/schema').label).toBe('スキーマ');
  });
});

describe('docQueryOf', () => {
  test('#/verify?doc=... の doc を取り出す（URL エンコードも復元）', () => {
    expect(docQueryOf('#/verify?doc=doc-1')).toBe('doc-1');
    expect(docQueryOf('#/verify?doc=doc%20x&other=1')).toBe('doc x');
  });

  test('クエリなし・doc なし・空値は null', () => {
    expect(docQueryOf('#/verify')).toBeNull();
    expect(docQueryOf('#/verify?entity=arm:1')).toBeNull();
    expect(docQueryOf('#/verify?doc=')).toBeNull();
  });
});

describe('entityQueryOf', () => {
  test('#/verify?doc=...&entity=... の entity を取り出す（URL エンコードも復元）', () => {
    expect(entityQueryOf('#/verify?doc=doc-1&entity=arm:1')).toBe('arm:1');
    expect(entityQueryOf('#/verify?doc=doc-1&entity=arm%3A1')).toBe('arm:1');
    expect(entityQueryOf('#/verify?entity=outcome:mortality|arm:1')).toBe('outcome:mortality|arm:1');
  });

  test('クエリなし・entity なし・空値は null', () => {
    expect(entityQueryOf('#/verify')).toBeNull();
    expect(entityQueryOf('#/verify?doc=doc-1')).toBeNull();
    expect(entityQueryOf('#/verify?entity=')).toBeNull();
  });
});

describe('ROUTES', () => {
  test('ui-flow.md §2 の 9 ルートを順序どおり定義する', () => {
    expect(ROUTES.map((route) => route.hash)).toEqual([
      '#/home',
      '#/documents',
      '#/protocol',
      '#/schema',
      '#/pilot',
      '#/extract',
      '#/verify',
      '#/dashboard',
      '#/export',
    ]);
  });

  test.each(ROUTES.map((route) => [route.label, route] as const))(
    '%s の render が見出し付きの要素を返す',
    (_label, route) => {
      const element = route.render(createInitialState(), stubCtx);
      expect(element).toBeInstanceOf(HTMLElement);
      expect(element.querySelector('h2')?.textContent).toBeTruthy();
    },
  );

  test('#/documents は LLM 送信の注意書きを常時表示する（ui-states.md §3）', () => {
    const element = findRoute('#/documents').render(createInitialState(), stubCtx);
    expect(element.textContent).toContain('取り込んだ PDF が外部へ送信されるのは LLM API への抽出リクエストのみです');
  });

  test('#/home はプロジェクト名と進捗サマリを表示する（0 件でも崩れない）', () => {
    const state = createInitialState();
    const emptyView = findRoute('#/home').render(state, stubCtx);
    expect(emptyView.textContent).toContain('未選択');
    expect(emptyView.querySelectorAll('dd')).toHaveLength(5);

    state.currentProject = { projectId: 'p1', spreadsheetId: 's1', driveFolderId: 'f1', name: '肺炎 SR' };
    state.counts.documents = 12;
    const filledView = findRoute('#/home').render(state, stubCtx);
    expect(filledView.textContent).toContain('肺炎 SR');
    expect(filledView.textContent).toContain('12');
  });
});
