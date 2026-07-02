import { ROUTES, findRoute, normalizeHash } from '../../../src/app/router';
import { createInitialState } from '../../../src/app/store';

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
      const element = route.render(createInitialState());
      expect(element).toBeInstanceOf(HTMLElement);
      expect(element.querySelector('h2')?.textContent).toBeTruthy();
    },
  );

  test('#/documents は著作権の注意書きを常時表示する（ui-states.md §3）', () => {
    const element = findRoute('#/documents').render(createInitialState());
    expect(element.textContent).toContain('著作権フリー / 利用許諾済みの PDF のみ取り込んでください');
  });

  test('#/home はプロジェクト名と進捗サマリを表示する（0 件でも崩れない）', () => {
    const state = createInitialState();
    const emptyView = findRoute('#/home').render(state);
    expect(emptyView.textContent).toContain('未選択');
    expect(emptyView.querySelectorAll('dd')).toHaveLength(5);

    state.currentProject = { spreadsheetId: 's1', name: '肺炎 SR' };
    state.counts.documents = 12;
    const filledView = findRoute('#/home').render(state);
    expect(filledView.textContent).toContain('肺炎 SR');
    expect(filledView.textContent).toContain('12');
  });
});
