// #/options（アプリ内設定画面）の描画テスト。本文は settingsSections.ts 共通、
// 配線は bootstrapOptions（詳細は tests/unit/options/bootstrap.test.ts で網羅）。
// ここでは「同一タブで完結する設定画面が組み上がり配線される」ことを確認する
import { installChromeMock, type ChromeMock } from '../../../setup/chrome-mock';
import { renderSettingsView } from '../../../../src/app/views/settingsView';
import { createInitialState } from '../../../../src/app/store';
import type { ViewContext } from '../../../../src/app/views/types';

const flush = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

// renderSettingsView は state / ctx を参照しないためダミーで足りる
const stubCtx = {} as ViewContext;

describe('renderSettingsView', () => {
  let chromeMock: ChromeMock;

  beforeEach(() => {
    chromeMock = installChromeMock();
  });

  test('見出し + 戻るハッシュリンク（記録なしは #/home）+ 設定各節を組み立てる', () => {
    const view = renderSettingsView(createInitialState(), stubCtx);
    expect(view.querySelector('h2')?.textContent).toBe('設定');

    const back = view.querySelector('.settings__back');
    // 別ページ・別タブではなく同一タブ内のハッシュ遷移で戻る。記録が無いので #/home
    expect(back?.textContent).toBe('← 前の画面へ戻る');
    expect(back?.getAttribute('href')).toBe('#/home');

    // options.html と同じ ID の各節が存在する
    expect(view.querySelector('#gemini-api-key')).not.toBeNull();
    expect(view.querySelector('#openrouter-api-key')).not.toBeNull();
    expect(view.querySelector('#default-model-container')).not.toBeNull();
    expect(view.querySelector('#ui-language')).not.toBeNull();
  });

  test('settingsReturnHash が記録されていればその画面へ戻る', () => {
    const state = { ...createInitialState(), settingsReturnHash: '#/pilot' as const };
    const view = renderSettingsView(state, stubCtx);
    const back = view.querySelector('.settings__back');
    expect(back?.textContent).toBe('← 前の画面へ戻る');
    expect(back?.getAttribute('href')).toBe('#/pilot');
  });

  test('未 attach のコンテナでも bootstrapOptions が配線される（未設定表示 + モデルセレクタ生成）', async () => {
    const view = renderSettingsView(createInitialState(), stubCtx);
    await flush();
    expect(view.querySelector('#options-status')?.textContent).toBe('Gemini: 未設定');
    expect(view.querySelector('#openrouter-status')?.textContent).toBe('OpenRouter: 未設定');
    expect(view.querySelector('#default-model-status')?.textContent).toBe('既定モデル: 未設定');
    // 既定モデルセレクタ（createModelSelect）がコンテナへ生成される
    expect(view.querySelector('#default-model')).not.toBeNull();
  });

  test('保存済みの既定モデルをセレクタへ復元する', async () => {
    chromeMock.storage.local.data['settings.defaultModel'] = 'gemini-2.0-flash';
    const view = renderSettingsView(createInitialState(), stubCtx);
    await flush();
    expect(view.querySelector('#default-model-status')?.textContent).toBe('既定モデル: 保存済み');
    expect((view.querySelector('#default-model') as HTMLSelectElement).value).toBe(
      'gemini-2.0-flash',
    );
  });
});
