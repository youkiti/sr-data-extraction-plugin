import { ROUTES, studyQueryOf, entityQueryOf, findRoute, normalizeHash } from '../../../src/app/router';
import { createInitialState } from '../../../src/app/store';
import type { ViewContext } from '../../../src/app/views/types';

const stubCtx: ViewContext = {
  home: {
    onReload: jest.fn(),
    onGrantFolderAccess: jest.fn(),
    onReloadReviewers: jest.fn(),
    onAddReviewer: jest.fn(),
    onConfirmReviewerChange: jest.fn(),
    onCancelReviewerChange: jest.fn(),
    onRevokeReviewer: jest.fn(),
    onCopyInvite: jest.fn(),
  },
  documents: {
    onImport: jest.fn(),
    onImportFiles: jest.fn(),
    onReload: jest.fn(),
    onSaveStudyLabel: jest.fn(),
    onSaveRegistrationId: jest.fn(),
    onSaveDocumentRole: jest.fn(),
    onToggleStudySelection: jest.fn(),
    onOpenMerge: jest.fn(),
    onOpenMergeCandidate: jest.fn(),
    onIgnoreCandidate: jest.fn(),
    onUpdateMergeLabel: jest.fn(),
    onUpdateMergeRegistration: jest.fn(),
    onConfirmMerge: jest.fn(),
    onCancelMerge: jest.fn(),
  },
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
    onToggleStudy: jest.fn(),
    onChangeModel: jest.fn(),
    onRun: jest.fn(),
    onSelectRun: jest.fn(),
    onReloadHistory: jest.fn(),
    onSelectVerifyStudy: jest.fn(),
    onRetryVerifyLoad: jest.fn(),
    onDecision: jest.fn(),
    onArmConfirm: jest.fn(),
    onChangeLayoutMode: jest.fn(),
    onReloadVerification: jest.fn(),
    onRelocateQuote: jest.fn(),
  },
  extract: {
    onToggleStudy: jest.fn(),
    onChangeModel: jest.fn(),
    onRequestRun: jest.fn(),
    onConfirmRun: jest.fn(),
    onCancelConfirm: jest.fn(),
    onRetryStudy: jest.fn(),
    onReloadTargets: jest.fn(),
  },
  verify: {
    onSelectStudy: jest.fn(),
    onRetryLoad: jest.fn(),
    onDecision: jest.fn(),
    onArmConfirm: jest.fn(),
    onChangeLayoutMode: jest.fn(),
    onReloadVerification: jest.fn(),
    onRelocateQuote: jest.fn(),
  },
  dashboard: { onReload: jest.fn() },
  export: {
    onSelectFormat: jest.fn(),
    onGenerate: jest.fn(),
    onConfirmGenerate: jest.fn(),
    onCancelGenerate: jest.fn(),
    onDownload: jest.fn(),
    onReload: jest.fn(),
    onChangeMethodsLanguage: jest.fn(),
    onChangeMethodsWorkflow: jest.fn(),
    onCopyMethods: jest.fn(),
  },
  adjudicate: {
    onSelectStudy: jest.fn(),
    onBackToList: jest.fn(),
    onRetryLoad: jest.fn(),
    onArmDraftChange: jest.fn(),
    onArmDraftAdd: jest.fn(),
    onArmDraftRemove: jest.fn(),
    onConfirmArms: jest.fn(),
    onAcceptAllMatches: jest.fn(),
    onChooseA: jest.fn(),
    onChooseB: jest.fn(),
    onCustomValue: jest.fn(),
    onNotReported: jest.fn(),
    onSkip: jest.fn(),
    onUnskip: jest.fn(),
    onUndo: jest.fn(),
    onToggleMismatchOnly: jest.fn(),
    onLoadAgreement: jest.fn(),
    onDownloadAgreementCsv: jest.fn(),
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

  test('設定ルート #/options も正規化対象（ステップナビ外だが解決できる）', () => {
    expect(normalizeHash('#/options')).toBe('#/options');
  });
});

describe('findRoute', () => {
  test('ハッシュに対応するルート定義を返す', () => {
    expect(findRoute('#/schema').label).toBe('表のデザイン');
  });

  test('設定ルート #/options を解決する', () => {
    expect(findRoute('#/options').label).toBe('設定');
  });
});

describe('studyQueryOf', () => {
  test('#/verify?study=... の study を取り出す（URL エンコードも復元）', () => {
    expect(studyQueryOf('#/verify?study=study-1')).toBe('study-1');
    expect(studyQueryOf('#/verify?study=study%20x&other=1')).toBe('study x');
  });

  test('クエリなし・study なし・空値は null', () => {
    expect(studyQueryOf('#/verify')).toBeNull();
    expect(studyQueryOf('#/verify?entity=arm:1')).toBeNull();
    expect(studyQueryOf('#/verify?study=')).toBeNull();
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
  test('ui-flow.md §2 の 9 ルート + 裁定（S12・独立二重レビュー機能）を順序どおり定義する', () => {
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
      '#/adjudicate',
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
