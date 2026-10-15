// #/options（アプリ内設定画面）の描画テスト。本文は settingsSections.ts 共通、
// 配線は bootstrapOptions（詳細は tests/unit/options/bootstrap.test.ts で網羅）。
// ここでは「同一タブで完結する設定画面が組み上がり配線される」ことを確認する
import { installChromeMock, type ChromeMock } from '../../../setup/chrome-mock';
import { renderSettingsView, resetSettingsViewCache } from '../../../../src/app/views/settingsView';
import { createInitialState, createStore } from '../../../../src/app/store';
import { setUiLanguage } from '../../../../src/lib/i18n';
import { onLlmConnectionSettingsChanged } from '../../../../src/lib/storage/settingsStore';
import * as factory from '../../../../src/lib/llm/providerFactory';
import * as modelList from '../../../../src/lib/llm/modelListFetcher';
import { LlmProviderError } from '../../../../src/lib/llm/LLMProvider';
import type { ViewContext } from '../../../../src/app/views/types';

const flush = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

// renderSettingsView は state / ctx を参照しないためダミーで足りる
const stubCtx = {} as ViewContext;

describe('renderSettingsView', () => {

  test('画面の該当節へのヘルプリンクを表示する', () => {
    const view = renderSettingsView(createInitialState(), stubCtx);
    expect(view.querySelector('[data-help="options"]')).not.toBeNull();
  });
  let chromeMock: ChromeMock;

  beforeEach(() => {
    resetSettingsViewCache();
    setUiLanguage('ja');
    chromeMock = installChromeMock();
  });

  afterEach(() => {
    jest.restoreAllMocks();
    document.body.replaceChildren();
    setUiLanguage('ja');
  });

  test.each([false, true])('保存通知で再描画されても処理中の DOM と最終結果を保持する（認証失敗: %s）', async (fails) => {
    let complete!: (value: { text: string }) => void;
    let reject!: (reason: Error) => void;
    const chat = jest.fn().mockReturnValue(new Promise((resolve, rejectPromise) => {
      complete = resolve;
      reject = rejectPromise;
    }));
    jest.spyOn(factory, 'createProvider').mockImplementation((config) => ({
      providerId: config.provider!, model: config.model, supportsImageInput: true, chat,
    }));
    jest.spyOn(modelList, 'fetchModelIds').mockResolvedValue(['custom-model']);
    Object.assign(chromeMock.storage.local.data, {
      'settings.llmProvider': 'anthropic',
      'settings.defaultModel': 'custom-model',
      'secrets.anthropicApiKey': 'test-key',
    });
    const store = createStore();
    const view = renderSettingsView(store.getState(), stubCtx);
    document.body.replaceChildren(view);
    await flush();
    const button = view.querySelector<HTMLButtonElement>('#save-and-test-llm-connection')!;
    const status = view.querySelector<HTMLElement>('#llm-connection-status')!;
    const render = jest.fn((state) => document.body.replaceChildren(renderSettingsView(state, stubCtx)));
    const unsubscribeStore = store.subscribe(render);
    const source = { addListener: jest.fn(), removeListener: jest.fn() };
    Object.assign(chromeMock.storage, { onChanged: source });
    const unsubscribeSettings = onLlmConnectionSettingsChanged(() => store.setState({}));
    const onChanged = source.addListener.mock.calls[0]![0];
    chromeMock.storage.local.set.mockImplementation(async (items: Record<string, unknown>) => {
      Object.assign(chromeMock.storage.local.data, items);
      const changes = Object.fromEntries(Object.entries(items).map(([key, newValue]) => [key, { newValue }]));
      onChanged(changes, 'local');
    });
    try {
      button.click();
      await flush();
      expect(render).toHaveBeenCalledTimes(2);
      expect(document.body.firstElementChild).toBe(view);
      expect(document.querySelector('#save-and-test-llm-connection')).toBe(button);
      expect(document.querySelector('#llm-connection-status')).toBe(status);
      expect(button.disabled).toBe(true);
      expect(chat).toHaveBeenCalledTimes(1);
      if (fails) {
        reject(new LlmProviderError('認証失敗', 'anthropic', 401, ''));
      } else {
        complete({ text: '{"ok":true}' });
      }
      await flush();
      const expected = fails ? 'API キーが受け付けられませんでした' : '保存しました。接続を確認しました';
      expect(status.textContent).toContain(expected);
      expect(button.disabled).toBe(false);
    } finally {
      unsubscribeSettings();
      unsubscribeStore();
    }
  });

  test('表示中の再描画は同じコンテナを返し、別の画面へ移った後は作り直す', async () => {
    const state = createInitialState();
    const view = renderSettingsView(state, stubCtx);
    document.body.replaceChildren(view);
    await flush();
    expect(renderSettingsView(state, stubCtx)).toBe(view);
    document.body.replaceChildren();
    const next = renderSettingsView(state, stubCtx);
    expect(next).not.toBe(view);
    await flush();
  });

  test('戻り先が変わるとコンテナと戻るリンクを作り直す', async () => {
    const state = createInitialState();
    const view = renderSettingsView(state, stubCtx);
    await flush();
    const next = renderSettingsView({ ...state, settingsReturnHash: '#/pilot' }, stubCtx);
    expect(next).not.toBe(view);
    expect(next.querySelector('.settings__back')?.getAttribute('href')).toBe('#/pilot');
    await flush();
  });

  test('表示言語が変わるとコンテナと見出しを作り直す', async () => {
    const state = createInitialState();
    const view = renderSettingsView(state, stubCtx);
    await flush();
    setUiLanguage('en');
    const next = renderSettingsView(state, stubCtx);
    expect(next).not.toBe(view);
    expect(next.querySelector('h2')?.textContent).toBe('Settings');
    await flush();
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
    expect(view.querySelector('#llm-connection-status')?.textContent).toContain('未保存');
    // 既定モデルセレクタ（createModelSelect）がコンテナへ生成される
    expect(view.querySelector('#default-model')).not.toBeNull();
  });

  test('保存済みの既定モデルをセレクタへ復元する', async () => {
    chromeMock.storage.local.data['settings.defaultModel'] = 'gemini-2.0-flash';
    const view = renderSettingsView(createInitialState(), stubCtx);
    await flush();
    expect((view.querySelector('#default-model') as HTMLSelectElement).value).toBe(
      'gemini-2.0-flash',
    );
  });
});
