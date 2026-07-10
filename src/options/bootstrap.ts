// Options（S11）の実処理: Gemini / OpenRouter API キーの保存（BYOK）と既定モデルの保存。
// 状態仕様は docs/ui-states.md §2（trim 保存・API キーの空文字は保存抑止・
// 既定モデルの空は「未設定に戻す」・保存中はボタン無効化）
import { createModelSelect } from '../app/ui/modelSelect';
import type { LlmProviderId } from '../domain/llmApiLog';
import { createProvider, resolveProviderId } from '../lib/llm/providerFactory';
import {
  loadGeminiApiKey,
  loadOpenAiCompatibleApiKey,
  loadOpenRouterApiKey,
  looksLikeGeminiApiKey,
  looksLikeOpenRouterApiKey,
  saveGeminiApiKey,
  saveOpenAiCompatibleApiKey,
  saveOpenRouterApiKey,
} from '../lib/storage/secretsStore';
import { requestEndpointPermission } from '../lib/storage/hostPermission';
import {
  FACTORY_DEFAULT_MODEL,
  isLoopbackEndpoint,
  loadDefaultModel,
  loadLlmConnectionSettings,
  normalizeOpenAiCompatibleEndpoint,
  saveDefaultModel,
  saveLlmConnectionSettings,
} from '../lib/storage/settingsStore';

/** ステータス要素へ文言 + 通常 / エラー系の色分けを反映する */
function makeSetStatus(statusEl: HTMLElement): (text: string, isError: boolean) => void {
  return (text, isError) => {
    statusEl.textContent = text;
    statusEl.classList.toggle('options__status--error', isError);
  };
}

/** API キー節の共通配線（Gemini / OpenRouter で鏡写し。必須要素が欠けている場合は何もしない） */
async function bootstrapApiKeySection(
  root: ParentNode,
  ids: { input: string; saveButton: string; status: string },
  providerLabel: string,
  load: () => Promise<string | null>,
  save: (key: string) => Promise<void>,
  // 別プロバイダのキーを取り違えて入力したときの警告文言を返す（確信できるときのみ非 null）
  foreignKeyWarning: (key: string) => string | null,
): Promise<void> {
  const input = root.querySelector<HTMLInputElement>(`#${ids.input}`);
  const saveButton = root.querySelector<HTMLButtonElement>(`#${ids.saveButton}`);
  const statusEl = root.querySelector<HTMLElement>(`#${ids.status}`);
  if (!input || !saveButton || !statusEl) {
    return;
  }

  const setStatus = makeSetStatus(statusEl);

  // 保存済みのときは平文キーを再表示せず、placeholder で「保存済み」を示す。
  // 未設定のときは入力を促す既定文言に戻す
  const setSavedPlaceholder = (saved: boolean): void => {
    input.placeholder = saved ? '保存済み（変更する場合のみ入力）' : 'API キーを入力';
  };

  const savedKey = await load();
  setSavedPlaceholder(savedKey !== null);
  setStatus(`${providerLabel}: ${savedKey ? '保存済み' : '未設定'}`, false);

  const handleSave = async (): Promise<void> => {
    const value = input.value.trim();
    if (value === '') {
      setStatus('API キーが空のため保存しませんでした。', true);
      return;
    }
    const warning = foreignKeyWarning(value);
    if (warning !== null) {
      setStatus(warning, true);
      return;
    }
    saveButton.disabled = true;
    try {
      await save(value);
      input.value = '';
      setSavedPlaceholder(true);
      setStatus('保存しました。', false);
    } catch {
      setStatus('保存に失敗しました。もう一度お試しください。', true);
    } finally {
      saveButton.disabled = false;
    }
  };

  saveButton.addEventListener('click', () => {
    void handleSave();
  });
}

/**
 * 既定モデル節の配線（必須要素が欠けている場合は何もしない）。
 * モデルセレクタ（共有ウィジェット。プルダウン + その他で直接入力）を
 * #default-model-container へ生成する。保存値は S5 スキーマ画面のモデル入力の
 * 初期値になる（schemaService.loadSchema が注入）
 */
async function bootstrapDefaultModelSection(root: ParentNode): Promise<void> {
  const container = root.querySelector<HTMLElement>('#default-model-container');
  const saveButton = root.querySelector<HTMLButtonElement>('#save-default-model');
  const statusEl = root.querySelector<HTMLElement>('#default-model-status');
  if (!container || !saveButton || !statusEl) {
    return;
  }

  const setStatus = makeSetStatus(statusEl);
  // createModelSelect は要素生成に Document が要る。root が Document ならそれ自身、
  // 要素（アプリ内 #/options の未 attach コンテナ）なら ownerDocument を使う
  const doc = container.ownerDocument;

  const savedModel = await loadDefaultModel();
  // セレクタの選択値（その他は trim したテキスト）。保存ボタンがこれを永続化する
  let pendingModel = savedModel ?? '';
  container.append(
    createModelSelect(doc, {
      id: 'default-model',
      ariaLabel: '既定モデル',
      value: pendingModel,
      placeholderLabel: '未設定',
      onChange: (model) => {
        pendingModel = model;
      },
    }),
  );
  setStatus(`既定モデル: ${savedModel ? '保存済み' : '未設定'}`, false);

  const handleSave = async (): Promise<void> => {
    saveButton.disabled = true;
    try {
      // 空（プレースホルダ or その他の空文字）は「未設定に戻す」（API キーと違い空での解除を許す）
      await saveDefaultModel(pendingModel);
      setStatus(pendingModel === '' ? '未設定に戻しました。' : '保存しました。', false);
    } catch {
      setStatus('保存に失敗しました。もう一度お試しください。', true);
    } finally {
      saveButton.disabled = false;
    }
  };

  saveButton.addEventListener('click', () => {
    void handleSave();
  });
}

const CONNECTION_TEST_SCHEMA = {
  type: 'object',
  properties: { ok: { type: 'boolean' } },
  required: ['ok'],
  additionalProperties: false,
};

function selectedProvider(select: HTMLSelectElement): LlmProviderId {
  const value = select.value;
  return value === 'openrouter' || value === 'openai_compatible' ? value : 'gemini';
}

async function loadKeyForProvider(
  provider: Exclude<LlmProviderId, 'openai_compatible'>,
): Promise<string | null> {
  if (provider === 'openrouter') {
    return loadOpenRouterApiKey();
  }
  return loadGeminiApiKey();
}

/** LLM 接続先の保存と構造化出力の接続テストを配線する */
async function bootstrapLlmConnectionSection(root: ParentNode): Promise<void> {
  const providerSelect = root.querySelector<HTMLSelectElement>('#llm-provider');
  const customFields = root.querySelector<HTMLElement>('#openai-compatible-fields');
  const endpointInput = root.querySelector<HTMLInputElement>('#openai-compatible-endpoint');
  const apiKeyInput = root.querySelector<HTMLInputElement>('#openai-compatible-api-key');
  const saveButton = root.querySelector<HTMLButtonElement>('#save-llm-connection');
  const testButton = root.querySelector<HTMLButtonElement>('#test-llm-connection');
  const statusEl = root.querySelector<HTMLElement>('#llm-connection-status');
  if (
    !providerSelect ||
    !customFields ||
    !endpointInput ||
    !apiKeyInput ||
    !saveButton ||
    !testButton ||
    !statusEl
  ) {
    return;
  }
  const setStatus = makeSetStatus(statusEl);
  const settings = await loadLlmConnectionSettings();
  const defaultModel = (await loadDefaultModel()) ?? FACTORY_DEFAULT_MODEL;
  providerSelect.value = settings.provider ?? resolveProviderId(defaultModel);
  endpointInput.value = settings.openAiCompatibleEndpoint ?? '';
  const savedCustomKey = await loadOpenAiCompatibleApiKey();
  apiKeyInput.placeholder = savedCustomKey
    ? '保存済み（変更する場合のみ入力）'
    : 'API キー（loopback は任意）';

  const renderProvider = (): void => {
    customFields.hidden = selectedProvider(providerSelect) !== 'openai_compatible';
  };
  renderProvider();
  providerSelect.addEventListener('change', renderProvider);
  setStatus(
    settings.provider === null ? '未保存（モデル名から自動判定）' : '接続設定: 保存済み',
    false,
  );

  const resolveFormConfig = async (): Promise<{
    provider: LlmProviderId;
    endpoint?: string;
    apiKey: string;
    model: string;
  }> => {
    const provider = selectedProvider(providerSelect);
    const model = (await loadDefaultModel()) ?? FACTORY_DEFAULT_MODEL;
    if (provider !== 'openai_compatible') {
      const apiKey = await loadKeyForProvider(provider);
      if (apiKey === null) {
        throw new Error(`${provider === 'gemini' ? 'Gemini' : 'OpenRouter'} API キーが未設定です`);
      }
      return { provider, apiKey, model };
    }
    const endpoint = normalizeOpenAiCompatibleEndpoint(endpointInput.value);
    const enteredKey = apiKeyInput.value.trim();
    const apiKey = enteredKey || (await loadOpenAiCompatibleApiKey());
    if (apiKey === null && !isLoopbackEndpoint(endpoint)) {
      throw new Error('OpenAI 互換 API キーが未設定です');
    }
    return { provider, endpoint, apiKey: apiKey ?? '', model };
  };

  saveButton.addEventListener('click', () => {
    void (async () => {
      saveButton.disabled = true;
      try {
        const config = await resolveFormConfig();
        if (
          config.provider === 'openai_compatible' &&
          !(await requestEndpointPermission(config.endpoint as string))
        ) {
          throw new Error('接続先へのアクセスが許可されませんでした');
        }
        if (config.provider === 'openai_compatible' && apiKeyInput.value.trim() !== '') {
          await saveOpenAiCompatibleApiKey(apiKeyInput.value);
          apiKeyInput.value = '';
          apiKeyInput.placeholder = '保存済み（変更する場合のみ入力）';
        }
        await saveLlmConnectionSettings({
          provider: config.provider,
          openAiCompatibleEndpoint: config.endpoint ?? null,
        });
        setStatus('保存しました。', false);
      } catch (err) {
        setStatus(err instanceof Error ? err.message : String(err), true);
      } finally {
        saveButton.disabled = false;
      }
    })();
  });

  testButton.addEventListener('click', () => {
    void (async () => {
      testButton.disabled = true;
      try {
        const config = await resolveFormConfig();
        if (
          config.provider === 'openai_compatible' &&
          !(await requestEndpointPermission(config.endpoint as string))
        ) {
          throw new Error('接続先へのアクセスが許可されませんでした');
        }
        const response = await createProvider(config).chat(
          [
            { role: 'system', content: 'Return JSON matching the supplied schema.' },
            { role: 'user', content: 'Return {"ok":true}.' },
          ],
          { responseSchema: CONNECTION_TEST_SCHEMA, maxOutputTokens: 64, temperature: 0 },
        );
        const parsed = JSON.parse(response.text) as { ok?: unknown };
        if (parsed.ok !== true) {
          throw new Error('JSON Schema に従う応答を確認できませんでした');
        }
        setStatus('接続テストに成功しました。', false);
      } catch (err) {
        setStatus(`接続テストに失敗しました: ${err instanceof Error ? err.message : String(err)}`, true);
      } finally {
        testButton.disabled = false;
      }
    })();
  });
}

/**
 * 設定本文の配線。root は options.html の `document` でも、アプリ内 #/options が
 * 生成した（未 attach でよい）コンテナ要素でもよい（querySelector で解決するため）。
 */
export async function bootstrapOptions(root: ParentNode): Promise<void> {
  await bootstrapApiKeySection(
    root,
    { input: 'gemini-api-key', saveButton: 'save-keys', status: 'options-status' },
    'Gemini',
    loadGeminiApiKey,
    saveGeminiApiKey,
    (key) =>
      looksLikeOpenRouterApiKey(key)
        ? 'OpenRouter のキー（sk-or- で始まる）のようです。Gemini キーはここへ、OpenRouter キーは下の欄へ入力してください。'
        : null,
  );
  await bootstrapApiKeySection(
    root,
    { input: 'openrouter-api-key', saveButton: 'save-openrouter-key', status: 'openrouter-status' },
    'OpenRouter',
    loadOpenRouterApiKey,
    saveOpenRouterApiKey,
    (key) =>
      looksLikeGeminiApiKey(key)
        ? 'Gemini のキー（AIza で始まる）のようです。OpenRouter キーはここへ、Gemini キーは上の欄へ入力してください。'
        : null,
  );
  await bootstrapLlmConnectionSection(root);
  await bootstrapDefaultModelSection(root);
}
