// 統合された LLM 接続の段階と、既存の補助設定を検証する。
import { installChromeMock, type ChromeMock } from '../../setup/chrome-mock';
import { getUiLanguage, onUiLanguageChange, setUiLanguage } from '../../../src/lib/i18n';
import { bootstrapOptions, bootstrapOptionsPage } from '../../../src/options/bootstrap';
import { buildSettingsSections } from '../../../src/options/settingsSections';
import { LlmProviderError } from '../../../src/lib/llm/LLMProvider';
import * as factory from '../../../src/lib/llm/providerFactory';
import * as modelList from '../../../src/lib/llm/modelListFetcher';

const OPTIONS_TEMPLATE = '<main></main>';
const OPTIONS_TEMPLATE_WITH_RATE_LIMIT = buildSettingsSections().outerHTML;
const flush = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));
const input = (id: string): HTMLInputElement => document.getElementById(id) as HTMLInputElement;
const select = (id: string): HTMLSelectElement => document.getElementById(id) as HTMLSelectElement;
const button = (): HTMLButtonElement => document.getElementById('save-and-test-llm-connection') as HTMLButtonElement;
const status = (): string => document.getElementById('llm-connection-status')!.textContent!;
function change(id: string, value: string): void {
  select(id).value = value;
  select(id).dispatchEvent(new Event('change'));
}
function customModel(value: string): void {
  input('default-model').value = value;
  input('default-model').dispatchEvent(new Event('change'));
}

describe('統合された LLM 接続', () => {
  let chromeMock: ChromeMock;
  const chat = jest.fn();
  let fetchIds: jest.SpyInstance;
  beforeEach(() => {
    chromeMock = installChromeMock();
    document.body.replaceChildren(buildSettingsSections());
    chat.mockReset().mockResolvedValue({ text: '{"ok":true}' });
    jest.spyOn(factory, 'createProvider').mockImplementation((config) => ({
      providerId: config.provider!, model: config.model, supportsImageInput: true, chat,
    }));
    fetchIds = jest.spyOn(modelList, 'fetchModelIds').mockResolvedValue(['custom-model']);
  });
  afterEach(() => {
    jest.restoreAllMocks();
  });
  async function setup(provider = 'gemini', model = 'custom-model'): Promise<void> {
    await bootstrapOptions(document);
    change('llm-provider', provider);
    customModel(model);
    const key = document.querySelector<HTMLInputElement>('#' + provider.replaceAll('_', '-') + '-api-key');
    if (key) {
      key.value = 'test-key';
    }
    if (provider === 'local_llm') {
      document.getElementById('local-llm-preset-ollama')!.click();
    }
    if (provider === 'openai_compatible' || provider === 'azure_openai') {
      input(provider.replaceAll('_', '-') + '-endpoint').value = 'https://example.org/v1/chat/completions';
    }
  }
  async function save(): Promise<void> {
    button().click();
    await flush();
  }
  test('Anthropic で Gemini の単価表モデルを直接入力すると保存せず停止する', async () => {
    await setup('anthropic', 'gemini-3.8-flash');
    await save();
    expect(status()).toContain('モデルを選び直してください');
    expect(chromeMock.storage.local.set).not.toHaveBeenCalled();
    expect(chat).not.toHaveBeenCalled();
  });
  test('OpenAI 互換では単価表と同名のモデルを保存し接続確認する', async () => {
    await setup('openai_compatible', 'gemini-3.8-flash');
    await save();
    expect(chromeMock.storage.local.data['settings.defaultModel']).toBe('gemini-3.8-flash');
    expect(chat).toHaveBeenCalledTimes(1);
    expect(status()).not.toContain('モデルを選び直してください');
  });
  test('必須要素がない場合は何もしない', async () => {
    document.body.innerHTML = '';
    await expect(bootstrapOptions(document)).resolves.toBeUndefined();
  });
  test('初期値を推定し、方式を切り替えると候補を絞ってモデルを空に戻す', async () => {
    await bootstrapOptions(document);
    expect(select('llm-provider').value).toBe('gemini');
    expect(input('gemini-api-key').placeholder).toBe('API キーを入力');
    change('llm-provider', 'anthropic');
    expect(input('default-model').value).toBe('');
    expect(document.querySelector('#default-model-options option[value="gemini-3.8-flash"]')).toBeNull();
    expect(document.getElementById('anthropic-fields')!.hidden).toBe(false);
    expect(document.getElementById('gemini-fields')!.hidden).toBe(true);
    button().click();
    await flush();
    expect(status()).toBe('保存できませんでした: 既定モデルを選んでください');
    expect(chromeMock.storage.local.set).not.toHaveBeenCalled();
  });
  test('保存済みのキーは伏せ、モデルと取得一覧を復元する', async () => {
    Object.assign(chromeMock.storage.local.data, {
      'settings.llmProvider': 'anthropic',
      'settings.defaultModel': 'custom-model',
      'settings.fetchedModelIds': { anthropic: ['custom-model'] },
      'secrets.anthropicApiKey': 'saved-key',
    });
    await bootstrapOptions(document);
    expect(input('anthropic-api-key').value).toBe('');
    expect(input('anthropic-api-key').placeholder).toContain('保存済み');
    expect(input('default-model').value).toBe('custom-model');
    await save();
    expect(factory.createProvider).toHaveBeenCalledWith(expect.objectContaining({ apiKey: 'saved-key' }));
  });
  test.each(['gemini', 'openrouter', 'anthropic', 'azure_openai', 'openai_compatible', 'local_llm'])(
    '%s の保存→一覧取得→接続確認を実行する', async (provider) => {
      await setup(provider);
      await save();
      expect(chromeMock.storage.local.data['settings.llmProvider']).toBe(provider);
      expect(chromeMock.storage.local.data['settings.defaultModel']).toBe('custom-model');
      expect(chat).toHaveBeenCalledWith(expect.any(Array), expect.objectContaining({ maxOutputTokens: 4096 }));
      expect(status()).toContain('保存しました。接続を確認しました');
      expect(button().disabled).toBe(false);
      if (provider === 'gemini' || provider === 'azure_openai') {
        expect(fetchIds).not.toHaveBeenCalled();
        expect(status()).not.toContain('件を取得');
      } else {
        expect(fetchIds).toHaveBeenCalled();
        expect(chromeMock.storage.local.data['settings.fetchedModelIds']).toEqual({ [provider]: ['custom-model'] });
        expect(input('default-model').value).toBe('custom-model');
      }
    },
  );
  test('処理中は無効化し、reasoning effort と保存済みキーを使う', async () => {
    chromeMock.storage.local.data['settings.defaultReasoningEffort'] = 'high';
    await setup();
    let complete!: (value: { text: string }) => void;
    chat.mockReturnValueOnce(new Promise((resolve) => { complete = resolve; }));
    button().click();
    expect(button().disabled).toBe(true);
    await flush();
    expect(factory.createProvider).toHaveBeenCalledWith(expect.objectContaining({ reasoningEffort: 'high' }));
    complete({ text: '{"ok":true}' });
    await flush();
    expect(button().disabled).toBe(false);
    expect(input('gemini-api-key').value).toBe('');
  });
  test.each([
    ['gemini', 'sk-or-wrong', 'OpenRouter'],
    ['openrouter', 'AIzaWrong', 'Gemini'],
    ['anthropic', '', 'API キー'],
  ])('入力検証で %s のキー不正を止める', async (provider, key, message) => {
    await setup(provider);
    input(provider + '-api-key').value = key;
    await save();
    expect(status()).toContain('保存できませんでした:');
    expect(status()).toContain(message);
    expect(chat).not.toHaveBeenCalled();
  });
  test('ローカルのプリセットと外部 URL 拒否', async () => {
    await setup('local_llm');
    expect(input('local-llm-endpoint').value).toBe('http://localhost:11434/v1/chat/completions');
    document.getElementById('local-llm-preset-lmstudio')!.click();
    expect(input('local-llm-endpoint').value).toBe('http://localhost:1234/v1/chat/completions');
    expect(document.getElementById('local-llm-api-key')).toBeNull();
    input('local-llm-endpoint').value = 'https://remote.example/v1/chat/completions';
    await save();
    expect(status()).toContain('ローカル LLM には localhost');
    expect(chromeMock.storage.local.set).not.toHaveBeenCalled();
  });
  test('権限拒否は保存前に停止する', async () => {
    await setup('local_llm');
    chromeMock.permissions.request.mockResolvedValueOnce(false);
    await save();
    expect(status()).toBe('保存できませんでした: 接続先へのアクセスが許可されませんでした');
    expect(chromeMock.storage.local.set).not.toHaveBeenCalled();
  });
  test('保存失敗は一覧取得に進まない', async () => {
    await setup('anthropic');
    chromeMock.storage.local.set.mockRejectedValueOnce(new Error('storage error'));
    await save();
    expect(status()).toBe('保存できませんでした: 保存に失敗しました');
    expect(fetchIds).not.toHaveBeenCalled();
  });
  test.each([
    [new Error('HTTP 401'), 'API キーが受け付けられませんでした（HTTP 401）'],
    [new Error('HTTP 403'), 'API キーが受け付けられませんでした（HTTP 403）'],
    [new TypeError('Failed to fetch'), '接続先に届きませんでした'],
    [new Error('HTTP 500'), 'モデル一覧を取得できませんでした'],
    ['unknown', 'モデル一覧を取得できませんでした'],
  ])('一覧取得失敗は保存を保持し呼び出しを止める: %s', async (error, message) => {
    await setup('anthropic');
    fetchIds.mockRejectedValueOnce(error);
    await save();
    expect(status()).toContain('保存しました。接続を確認できませんでした:');
    expect(status()).toContain(message);
    expect(chromeMock.storage.local.data['settings.defaultModel']).toBe('custom-model');
    expect(chat).not.toHaveBeenCalled();
  });
  test.each([
    [new LlmProviderError('failed', 'gemini', 404, ''), 'モデル「custom-model」'],
    [new LlmProviderError('failed', 'gemini', 401, ''), 'API キー'],
    [new LlmProviderError('failed', 'gemini', 403, ''), 'API キー'],
    [new LlmProviderError('model_not_found', 'gemini', null, ''), 'モデル「custom-model」'],
    [new Error('failure'), 'failure'],
  ])('呼び出し失敗を分類する: %s', async (error, message) => {
    await setup();
    chat.mockRejectedValueOnce(error);
    await save();
    expect(status()).toContain(message);
    expect(status()).toContain('保存しました。接続を確認できませんでした:');
  });
  test.each(['not json', '{}', 'null'])('JSON の確認に失敗する: %s', async (text) => {
    await setup();
    chat.mockResolvedValueOnce({ text });
    await save();
    expect(status()).toContain('JSON Schema に従う応答を確認できませんでした');
  });
  test('OpenAI 互換の loopback はキーがなくても接続できる', async () => {
    await setup('openai_compatible');
    input('openai-compatible-api-key').value = '';
    input('openai-compatible-endpoint').value = 'http://localhost:1234/v1/chat/completions';
    await save();
    expect(factory.createProvider).toHaveBeenCalledWith(expect.objectContaining({ apiKey: '' }));
  });
  test('保存済みの方式と工場出荷モデルが食い違うと初期選択を空にする', async () => {
    chromeMock.storage.local.data['settings.llmProvider'] = 'anthropic';
    await bootstrapOptions(document);
    expect(input('default-model').value).toBe('');
  });
  test('一部の入力欄がない DOM でも初期化し、URL 未入力を拒否する', async () => {
    document.getElementById('gemini-fields')!.remove();
    document.getElementById('local-llm-endpoint')!.remove();
    await bootstrapOptions(document);
    document.getElementById('local-llm-preset-ollama')!.click();
    change('llm-provider', 'local_llm');
    customModel('local-model');
    await save();
    expect(status()).toContain('保存できませんでした:');
    expect(chat).not.toHaveBeenCalled();
  });
  test('OpenAI 互換の URL 欄がない場合は保存も呼び出しもせず案内する', async () => {
    await setup('openai_compatible');
    input('openai-compatible-endpoint').remove();
    await save();
    expect(status()).toContain('保存できませんでした:');
    expect(chromeMock.storage.local.set).not.toHaveBeenCalled();
    expect(chat).not.toHaveBeenCalled();
  });

  test('一覧の保存後に別画面が一覧を消しても接続確認を続ける', async () => {
    await setup('anthropic');
    const original = chromeMock.storage.local.set.getMockImplementation()!;
    chromeMock.storage.local.set.mockImplementation(async (items) => {
      await original(items);
      if ('settings.fetchedModelIds' in items) {
        delete chromeMock.storage.local.data['settings.fetchedModelIds'];
      }
    });
    await save();
    expect(status()).toContain('モデル 0 件を取得');
  });
  test('別方式の保存値を保持し、未知の保存モデルは直接入力として表示する', async () => {
    Object.assign(chromeMock.storage.local.data, {
      'settings.defaultModel': 'private-model',
      'settings.openAiCompatibleEndpoint': 'https://remote.example/v1/chat/completions',
      'settings.azureOpenAiEndpoint': 'https://azure.example/chat/completions',
      'settings.localLlmEndpoint': 'http://localhost:1234/v1/chat/completions',
      'secrets.openRouterApiKey': 'old-key',
    });
    await bootstrapOptions(document);
    expect(input('default-model').value).toBe('private-model');
    input('gemini-api-key').value = 'new-key';
    await save();
    expect(chromeMock.storage.local.data['secrets.openRouterApiKey']).toBe('old-key');
    expect(chromeMock.storage.local.data['settings.localLlmEndpoint']).toContain('1234');
  });
});

describe('bootstrapOptions（レート制限 tier。docs/ui-states.md §2「レート制限」）', () => {
  let chromeMock: ChromeMock;

  function tierSelectEl(): HTMLSelectElement {
    return document.getElementById('rate-limit-tier') as HTMLSelectElement;
  }
  function customRowEl(): HTMLElement {
    return document.getElementById('rate-limit-custom-row') as HTMLElement;
  }
  function customRpmEl(): HTMLInputElement {
    return document.getElementById('rate-limit-custom-rpm') as HTMLInputElement;
  }
  function concurrencyRowEl(): HTMLElement {
    return document.getElementById('rate-limit-concurrency-row') as HTMLElement;
  }
  function concurrencyEl(): HTMLInputElement {
    return document.getElementById('rate-limit-concurrency') as HTMLInputElement;
  }
  function descEl(): HTMLElement {
    return document.getElementById('rate-limit-tier-desc') as HTMLElement;
  }
  function rlStatusEl(): HTMLElement {
    return document.getElementById('rate-limit-status') as HTMLElement;
  }
  function rlSaveButton(): HTMLButtonElement {
    return document.getElementById('save-rate-limit') as HTMLButtonElement;
  }

  beforeEach(() => {
    chromeMock = installChromeMock();
    document.body.innerHTML = OPTIONS_TEMPLATE_WITH_RATE_LIMIT;
  });

  test('要素が欠けている場合は他節だけ配線する（レート制限節は何もしない）', async () => {
    document.body.innerHTML = OPTIONS_TEMPLATE;
    await bootstrapOptions(document);
    expect(document.getElementById('rate-limit-status')).toBeNull();
  });

  test('未設定なら既定 tier（gemini_free）を選択し、カスタム RPM 入力は隠す', async () => {
    await bootstrapOptions(document);
    expect(tierSelectEl().value).toBe('gemini_free');
    expect(rlStatusEl().textContent).toBe('レート制限: Gemini 無料枠（Free）');
    expect(customRowEl().hidden).toBe(true);
    expect(descEl().textContent).toContain('無料枠');
  });

  test('保存済み（カスタム tier + RPM）なら custom を選択し RPM 入力を表示・充填する', async () => {
    chromeMock.storage.local.data['settings.rateLimitTier'] = 'custom';
    chromeMock.storage.local.data['settings.rateLimitCustomRpm'] = 45;
    await bootstrapOptions(document);
    expect(tierSelectEl().value).toBe('custom');
    expect(customRowEl().hidden).toBe(false);
    expect(customRpmEl().value).toBe('45');
  });

  test('tier を custom へ変更すると RPM / 同時実行数入力が現れ、非 custom へ戻すと隠れる', async () => {
    await bootstrapOptions(document);
    tierSelectEl().value = 'custom';
    tierSelectEl().dispatchEvent(new Event('change'));
    expect(customRowEl().hidden).toBe(false);
    expect(concurrencyRowEl().hidden).toBe(false);
    tierSelectEl().value = 'gemini_tier2';
    tierSelectEl().dispatchEvent(new Event('change'));
    expect(customRowEl().hidden).toBe(true);
    expect(concurrencyRowEl().hidden).toBe(true);
  });

  test('保存済み同時実行数は入力に充填する', async () => {
    chromeMock.storage.local.data['settings.rateLimitTier'] = 'custom';
    chromeMock.storage.local.data['settings.rateLimitCustomConcurrency'] = 4;
    await bootstrapOptions(document);
    expect(concurrencyRowEl().hidden).toBe(false);
    expect(concurrencyEl().value).toBe('4');
  });

  test('custom tier + RPM + 同時実行数を保存する', async () => {
    await bootstrapOptions(document);
    tierSelectEl().value = 'custom';
    tierSelectEl().dispatchEvent(new Event('change'));
    customRpmEl().value = '60';
    concurrencyEl().value = '3';
    rlSaveButton().click();
    await flush();
    expect(chromeMock.storage.local.data['settings.rateLimitCustomRpm']).toBe(60);
    expect(chromeMock.storage.local.data['settings.rateLimitCustomConcurrency']).toBe(3);
    expect(rlStatusEl().textContent).toBe('保存しました。');
  });

  test('custom tier で同時実行数が空なら省略保存（キー削除）でエラーにしない', async () => {
    await bootstrapOptions(document);
    tierSelectEl().value = 'custom';
    tierSelectEl().dispatchEvent(new Event('change'));
    customRpmEl().value = '60';
    concurrencyEl().value = '   ';
    rlSaveButton().click();
    await flush();
    expect(chromeMock.storage.local.remove).toHaveBeenCalledWith(
      'settings.rateLimitCustomConcurrency',
    );
    expect(rlStatusEl().textContent).toBe('保存しました。');
  });

  test('custom tier で同時実行数が非正なら保存せずエラー表示する', async () => {
    await bootstrapOptions(document);
    tierSelectEl().value = 'custom';
    tierSelectEl().dispatchEvent(new Event('change'));
    customRpmEl().value = '60';
    concurrencyEl().value = '0';
    rlSaveButton().click();
    await flush();
    expect(rlStatusEl().textContent).toBe('同時実行数は 1 以上の数値を入力してください。');
    expect(rlStatusEl().classList.contains('options__status--error')).toBe(true);
    expect(chromeMock.storage.local.set).not.toHaveBeenCalled();
  });

  test('非 custom tier を保存すると tier を書き、カスタム RPM キーは削除する', async () => {
    await bootstrapOptions(document);
    tierSelectEl().value = 'gemini_tier1';
    tierSelectEl().dispatchEvent(new Event('change'));
    rlSaveButton().click();
    await flush();
    expect(chromeMock.storage.local.data['settings.rateLimitTier']).toBe('gemini_tier1');
    expect(chromeMock.storage.local.remove).toHaveBeenCalledWith('settings.rateLimitCustomRpm');
    expect(rlStatusEl().textContent).toBe('保存しました。');
    expect(rlSaveButton().disabled).toBe(false);
  });

  test('custom tier + 有効な RPM を保存する', async () => {
    await bootstrapOptions(document);
    tierSelectEl().value = 'custom';
    tierSelectEl().dispatchEvent(new Event('change'));
    customRpmEl().value = '60';
    rlSaveButton().click();
    await flush();
    expect(chromeMock.storage.local.data['settings.rateLimitTier']).toBe('custom');
    expect(chromeMock.storage.local.data['settings.rateLimitCustomRpm']).toBe(60);
    expect(rlStatusEl().textContent).toBe('保存しました。');
  });

  test('custom tier で RPM が空・不正なら保存せずエラー表示する', async () => {
    await bootstrapOptions(document);
    tierSelectEl().value = 'custom';
    tierSelectEl().dispatchEvent(new Event('change'));
    customRpmEl().value = '   ';
    rlSaveButton().click();
    await flush();
    expect(rlStatusEl().textContent).toBe('RPM は 1 以上の数値を入力してください。');
    expect(rlStatusEl().classList.contains('options__status--error')).toBe(true);
    expect(chromeMock.storage.local.set).not.toHaveBeenCalled();
  });

  test('select の値が不正な場合は既定 tier（gemini_free）へ倒す', async () => {
    await bootstrapOptions(document);
    // 存在しない値をセットすると DOM 上は '' になり、isRateLimitTierId=false
    tierSelectEl().value = 'nonexistent';
    tierSelectEl().dispatchEvent(new Event('change'));
    expect(descEl().textContent).toContain('無料枠'); // gemini_free の説明
    rlSaveButton().click();
    await flush();
    expect(chromeMock.storage.local.data['settings.rateLimitTier']).toBe('gemini_free');
  });

  test('保存失敗時は赤系メッセージ + ボタン復帰', async () => {
    await bootstrapOptions(document);
    chromeMock.storage.local.set.mockRejectedValueOnce(new Error('quota exceeded'));
    tierSelectEl().value = 'gemini_tier1';
    tierSelectEl().dispatchEvent(new Event('change'));
    rlSaveButton().click();
    await flush();
    expect(rlStatusEl().textContent).toBe('保存に失敗しました。もう一度お試しください。');
    expect(rlSaveButton().disabled).toBe(false);
  });
});

describe('bootstrapOptions（reasoning effort の既定値。docs/ui-states.md §2「reasoning effort の既定値」・issue #127 PR5）', () => {
  let chromeMock: ChromeMock;

  function effortSelect(): HTMLSelectElement {
    return document.getElementById('default-reasoning-effort') as HTMLSelectElement;
  }
  function effortStatusEl(): HTMLElement {
    return document.getElementById('default-reasoning-effort-status') as HTMLElement;
  }

  beforeEach(() => {
    chromeMock = installChromeMock();
    document.body.replaceChildren(buildSettingsSections());
  });

  test('必須要素が欠けている場合は他の節だけ配線する', async () => {
    document.body.innerHTML = OPTIONS_TEMPLATE;
    await expect(bootstrapOptions(document)).resolves.toBeUndefined();
    expect(document.getElementById('default-reasoning-effort-status')).toBeNull();
  });

  test('未設定なら空欄（未設定）を選択し、ステータスに「未設定」を表示する', async () => {
    await bootstrapOptions(document);
    expect(effortSelect().value).toBe('');
    expect(effortStatusEl().textContent).toBe('reasoning effort の既定値: 未設定');
  });

  test('保存済みなら該当 option を選択して復元する', async () => {
    chromeMock.storage.local.data['settings.defaultReasoningEffort'] = 'high';
    await bootstrapOptions(document);
    expect(effortSelect().value).toBe('high');
    expect(effortStatusEl().textContent).toBe('reasoning effort の既定値: 保存済み');
  });

  test('不正な保存値は空欄（未設定）へ倒す', async () => {
    chromeMock.storage.local.data['settings.defaultReasoningEffort'] = 'xhigh';
    await bootstrapOptions(document);
    expect(effortSelect().value).toBe('');
    expect(effortStatusEl().textContent).toBe('reasoning effort の既定値: 未設定');
  });

  test('change で即時保存する（low / medium / high）', async () => {
    await bootstrapOptions(document);
    effortSelect().value = 'medium';
    effortSelect().dispatchEvent(new Event('change'));
    await flush();
    expect(chromeMock.storage.local.data['settings.defaultReasoningEffort']).toBe('medium');
    expect(effortStatusEl().textContent).toBe('reasoning effort の既定値: 保存済み');
  });

  test('未設定（空欄）へ戻すと保存キーを削除する', async () => {
    chromeMock.storage.local.data['settings.defaultReasoningEffort'] = 'high';
    await bootstrapOptions(document);
    effortSelect().value = '';
    effortSelect().dispatchEvent(new Event('change'));
    await flush();
    expect(chromeMock.storage.local.remove).toHaveBeenCalledWith('settings.defaultReasoningEffort');
    expect(chromeMock.storage.local.data['settings.defaultReasoningEffort']).toBeUndefined();
    expect(effortStatusEl().textContent).toBe('reasoning effort の既定値: 未設定');
  });

  test('保存失敗時は赤系メッセージを表示する', async () => {
    await bootstrapOptions(document);
    chromeMock.storage.local.set.mockRejectedValueOnce(new Error('quota exceeded'));
    effortSelect().value = 'low';
    effortSelect().dispatchEvent(new Event('change'));
    await flush();
    expect(effortStatusEl().textContent).toBe('保存に失敗しました。もう一度お試しください。');
    expect(effortStatusEl().classList.contains('options__status--error')).toBe(true);
  });

});

describe('bootstrapOptions（表示言語。docs/ui-states.md §2「表示言語」・issue #93）', () => {
  let chromeMock: ChromeMock;

  function languageSelect(): HTMLSelectElement {
    return document.getElementById('ui-language') as HTMLSelectElement;
  }

  function toastTexts(): string[] {
    return Array.from(document.querySelectorAll('.toast')).map((node) => node.textContent ?? '');
  }

  beforeEach(() => {
    chromeMock = installChromeMock();
    document.body.replaceChildren(buildSettingsSections());
  });

  afterEach(() => {
    // モジュール内の言語状態を既定へ戻す（他テストへの言語漏れを防ぐ）
    setUiLanguage('ja');
  });

  test('セレクタは現在の表示言語を初期選択する（既定 ja。option は 日本語 / English）', async () => {
    await bootstrapOptions(document);
    expect(languageSelect().value).toBe('ja');
    const options = Array.from(languageSelect().options).map((option) => option.textContent);
    expect(options).toEqual(['日本語', 'English']);
  });

  test('現在言語が en なら en を初期選択する', async () => {
    setUiLanguage('en');
    await bootstrapOptions(document);
    expect(languageSelect().value).toBe('en');
  });

  test('en 選択で即時保存し、setUiLanguage で購読者へ通知する', async () => {
    const listener = jest.fn();
    const unsubscribe = onUiLanguageChange(listener);
    await bootstrapOptions(document);
    languageSelect().value = 'en';
    languageSelect().dispatchEvent(new Event('change'));
    await flush();
    expect(chromeMock.storage.local.data['settings.uiLanguage']).toBe('en');
    expect(getUiLanguage()).toBe('en');
    expect(listener).toHaveBeenCalledWith('en');
    unsubscribe();
  });

  test('不正な select 値は既定 ja へ倒す', async () => {
    setUiLanguage('en');
    await bootstrapOptions(document);
    // 存在しない値をセットすると DOM 上は '' になり、isUiLanguage=false → 'ja'
    languageSelect().value = 'nonexistent';
    languageSelect().dispatchEvent(new Event('change'));
    await flush();
    expect(getUiLanguage()).toBe('ja');
    expect(chromeMock.storage.local.data['settings.uiLanguage']).toBe('ja');
  });

  test('保存失敗は表示切替自体を妨げず、トーストで知らせる', async () => {
    await bootstrapOptions(document);
    chromeMock.storage.local.set.mockRejectedValueOnce(new Error('quota exceeded'));
    languageSelect().value = 'en';
    languageSelect().dispatchEvent(new Event('change'));
    await flush();
    // 表示言語はメモリ内で切り替わる（次回起動時は保存済みの言語へ戻る）
    expect(getUiLanguage()).toBe('en');
    // トースト文言は切替後の言語（en）で出る
    expect(toastTexts()).toContain('Failed to save the display language.');
  });
});

describe('bootstrapOptionsPage（スタンドアロン options.html の起動配線。issue #93）', () => {
  let chromeMock: ChromeMock;

  const PAGE_TEMPLATE = `
    <main class="options">
      <div class="options__header">
        <h1 data-i18n="options.heading">設定</h1>
        <a id="options-open-app" href="../app/app.html" data-i18n="options.openApp">アプリを開く</a>
      </div>
      <div id="settings-body"></div>
    </main>
  `;

  beforeEach(() => {
    chromeMock = installChromeMock();
    document.body.innerHTML = PAGE_TEMPLATE;
  });

  afterEach(() => {
    setUiLanguage('ja');
  });

  test('#settings-body が無ければ何もしない', async () => {
    document.body.innerHTML = '<p>壊れた DOM</p>';
    await expect(bootstrapOptionsPage(document)).resolves.toBeUndefined();
  });

  test('保存済みの表示言語（en）で本文を構築し、静的部分・<html lang> も追従する', async () => {
    chromeMock.storage.local.data['settings.uiLanguage'] = 'en';
    await bootstrapOptionsPage(document);
    expect(document.documentElement.lang).toBe('en');
    // jest は dev ビルド相当（__DEV_NAME_SUFFIX__ = ' (dev)'）なのでタブタイトルにも付く
    expect(document.title).toBe('SR Data Extraction Plugin — Settings (dev)');
    expect(document.querySelector('h1')?.textContent).toBe('Settings');
    expect(document.getElementById('options-open-app')?.textContent).toBe('Open the app');
    const select = document.getElementById('ui-language') as HTMLSelectElement;
    expect(select.value).toBe('en');
    // 表示言語節の見出しも en で構築される
    const headings = Array.from(document.querySelectorAll('h2')).map((h) => h.textContent);
    expect(headings).toContain('Display language');
  });

  test('言語切替で本文を新言語で再構築する（ja → en → ja）', async () => {
    await bootstrapOptionsPage(document);
    expect(document.documentElement.lang).toBe('ja');
    const headingsJa = Array.from(document.querySelectorAll('h2')).map((h) => h.textContent);
    expect(headingsJa).toContain('表示言語');

    const select = document.getElementById('ui-language') as HTMLSelectElement;
    select.value = 'en';
    select.dispatchEvent(new Event('change'));
    await flush();
    expect(document.documentElement.lang).toBe('en');
    expect(document.querySelector('h1')?.textContent).toBe('Settings');
    const headingsEn = Array.from(document.querySelectorAll('h2')).map((h) => h.textContent);
    expect(headingsEn).toContain('Display language');
    expect(chromeMock.storage.local.data['settings.uiLanguage']).toBe('en');

    // ja へ復帰できる（再構築後の新しいセレクタから）
    const select2 = document.getElementById('ui-language') as HTMLSelectElement;
    expect(select2.value).toBe('en');
    select2.value = 'ja';
    select2.dispatchEvent(new Event('change'));
    await flush();
    expect(document.documentElement.lang).toBe('ja');
    expect(document.querySelector('h1')?.textContent).toBe('設定');
    expect(chromeMock.storage.local.data['settings.uiLanguage']).toBe('ja');
  });
});
