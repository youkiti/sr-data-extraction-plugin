// Options（S11）の実処理: Gemini / OpenRouter API キーの保存（BYOK）と既定モデルの保存。
// 状態仕様は docs/ui-states.md §2（trim 保存・API キーの空文字は保存抑止・
// 既定モデルの空は「未設定に戻す」・保存中はボタン無効化）
import { createModelSelect } from '../app/ui/modelSelect';
import { showToast } from '../app/ui/toast';
import type { LlmProviderId } from '../domain/llmApiLog';
import {
  getUiLanguage,
  isUiLanguage,
  localizeDom,
  onUiLanguageChange,
  setUiLanguage,
  t,
} from '../lib/i18n';
import { buildSettingsSections } from './settingsSections';
import { createProvider, resolveProviderId } from '../lib/llm/providerFactory';
import {
  getRateLimitTier,
  isRateLimitTierId,
  type RateLimitTierId,
} from '../lib/llm/rateLimitPolicy';
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
  loadRateLimitCustomConcurrency,
  loadRateLimitCustomRpm,
  loadRateLimitTier,
  loadUiLanguage,
  normalizeOpenAiCompatibleEndpoint,
  saveDefaultModel,
  saveLlmConnectionSettings,
  saveRateLimitCustomConcurrency,
  saveRateLimitCustomRpm,
  saveRateLimitTier,
  saveUiLanguage,
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
    input.placeholder = saved ? t('options.placeholderSavedKey') : t('options.placeholderEnterKey');
  };

  const savedKey = await load();
  setSavedPlaceholder(savedKey !== null);
  setStatus(
    `${providerLabel}: ${savedKey ? t('options.statusSavedKey') : t('options.statusUnsetKey')}`,
    false,
  );

  const handleSave = async (): Promise<void> => {
    const value = input.value.trim();
    if (value === '') {
      setStatus(t('options.toastEmptyKey'), true);
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
      setStatus(t('options.toastSaved'), false);
    } catch {
      setStatus(t('options.toastSaveFailed'), true);
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
      ariaLabel: t('options.defaultModelTitle'),
      value: pendingModel,
      placeholderLabel: t('options.defaultModelPlaceholder'),
      onChange: (model) => {
        pendingModel = model;
      },
    }),
  );
  setStatus(
    t('options.defaultModelStatus', {
      status: savedModel ? t('options.statusSavedKey') : t('options.statusUnsetKey'),
    }),
    false,
  );

  const handleSave = async (): Promise<void> => {
    saveButton.disabled = true;
    try {
      // 空（プレースホルダ or その他の空文字）は「未設定に戻す」（API キーと違い空での解除を許す）
      await saveDefaultModel(pendingModel);
      setStatus(pendingModel === '' ? t('options.defaultModelCleared') : t('options.toastSaved'), false);
    } catch {
      setStatus(t('options.toastSaveFailed'), true);
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
    ? t('options.placeholderSavedKey')
    : t('options.placeholderKeyOptional');

  const renderProvider = (): void => {
    customFields.hidden = selectedProvider(providerSelect) !== 'openai_compatible';
  };
  renderProvider();
  providerSelect.addEventListener('change', renderProvider);
  setStatus(
    settings.provider === null ? t('options.connectionUnsaved') : t('options.connectionSaved'),
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
        throw new Error(
          t('options.errKeyMissing', { provider: provider === 'gemini' ? 'Gemini' : 'OpenRouter' }),
        );
      }
      return { provider, apiKey, model };
    }
    const endpoint = normalizeOpenAiCompatibleEndpoint(endpointInput.value);
    const enteredKey = apiKeyInput.value.trim();
    const apiKey = enteredKey || (await loadOpenAiCompatibleApiKey());
    if (apiKey === null && !isLoopbackEndpoint(endpoint)) {
      throw new Error(t('options.errCompatibleKeyMissing'));
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
          throw new Error(t('options.errPermissionDenied'));
        }
        if (config.provider === 'openai_compatible' && apiKeyInput.value.trim() !== '') {
          await saveOpenAiCompatibleApiKey(apiKeyInput.value);
          apiKeyInput.value = '';
          apiKeyInput.placeholder = t('options.placeholderSavedKey');
        }
        await saveLlmConnectionSettings({
          provider: config.provider,
          openAiCompatibleEndpoint: config.endpoint ?? null,
        });
        setStatus(t('options.toastSaved'), false);
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
          throw new Error(t('options.errPermissionDenied'));
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
          throw new Error(t('options.testNoJson'));
        }
        setStatus(t('options.testSucceeded'), false);
      } catch (err) {
        setStatus(
          t('options.testFailed', { reason: err instanceof Error ? err.message : String(err) }),
          true,
        );
      } finally {
        testButton.disabled = false;
      }
    })();
  });
}

/**
 * レート制限 tier 節の配線（必須要素が欠けている場合は何もしない）。
 * tier セレクタ + カスタム RPM 入力を読み込み、保存する。カスタム tier のときだけ
 * RPM 入力を表示する。保存値は抽出のスロットル + リトライ強度を決める
 * （docs/ui-states.md §2「レート制限」）
 */
async function bootstrapRateLimitSection(root: ParentNode): Promise<void> {
  const select = root.querySelector<HTMLSelectElement>('#rate-limit-tier');
  const customRow = root.querySelector<HTMLElement>('#rate-limit-custom-row');
  const customInput = root.querySelector<HTMLInputElement>('#rate-limit-custom-rpm');
  const concurrencyRow = root.querySelector<HTMLElement>('#rate-limit-concurrency-row');
  const concurrencyInput = root.querySelector<HTMLInputElement>('#rate-limit-concurrency');
  const descEl = root.querySelector<HTMLElement>('#rate-limit-tier-desc');
  const saveButton = root.querySelector<HTMLButtonElement>('#save-rate-limit');
  const statusEl = root.querySelector<HTMLElement>('#rate-limit-status');
  if (
    !select ||
    !customRow ||
    !customInput ||
    !concurrencyRow ||
    !concurrencyInput ||
    !descEl ||
    !saveButton ||
    !statusEl
  ) {
    return;
  }

  const setStatus = makeSetStatus(statusEl);

  // 選択中の tier ID（select の値が不正なら既定へ倒す。syncTierUi と保存で共有）
  const currentTierId = (): RateLimitTierId =>
    isRateLimitTierId(select.value) ? select.value : 'gemini_free';

  // 選択 tier に応じて説明文とカスタム RPM / 同時実行数入力の表示を切り替える
  const syncTierUi = (): void => {
    const tier = getRateLimitTier(currentTierId());
    descEl.textContent = tier.description;
    customRow.hidden = !tier.editableRpm;
    concurrencyRow.hidden = !tier.editableConcurrency;
  };

  const savedTier = await loadRateLimitTier();
  const savedRpm = await loadRateLimitCustomRpm();
  const savedConcurrency = await loadRateLimitCustomConcurrency();
  select.value = savedTier;
  if (savedRpm !== null) {
    customInput.value = String(savedRpm);
  }
  if (savedConcurrency !== null) {
    concurrencyInput.value = String(savedConcurrency);
  }
  syncTierUi();
  setStatus(t('options.rateLimitStatus', { label: getRateLimitTier(savedTier).label }), false);

  select.addEventListener('change', syncTierUi);

  const handleSave = async (): Promise<void> => {
    const tierId = currentTierId();
    // カスタム tier で RPM が空・不正なら保存しない（プリセット既定へ戻すのは明示削除扱い）
    const rpmRaw = customInput.value.trim();
    const rpm = rpmRaw === '' ? Number.NaN : Number(rpmRaw);
    if (getRateLimitTier(tierId).editableRpm && (!Number.isFinite(rpm) || rpm <= 0)) {
      setStatus(t('options.errRpm'), true);
      return;
    }
    // 同時実行数は任意（空 = プリセット既定 = 逐次）。入力があるときだけ 1 以上を要求する
    const concurrencyRaw = concurrencyInput.value.trim();
    const concurrency = concurrencyRaw === '' ? Number.NaN : Number(concurrencyRaw);
    if (
      getRateLimitTier(tierId).editableConcurrency &&
      concurrencyRaw !== '' &&
      (!Number.isFinite(concurrency) || concurrency <= 0)
    ) {
      setStatus(t('options.errConcurrency'), true);
      return;
    }
    saveButton.disabled = true;
    try {
      await saveRateLimitTier(tierId);
      await saveRateLimitCustomRpm(rpm);
      await saveRateLimitCustomConcurrency(concurrency);
      setStatus(t('options.toastSaved'), false);
    } catch {
      setStatus(t('options.toastSaveFailed'), true);
    } finally {
      saveButton.disabled = false;
    }
  };

  saveButton.addEventListener('click', () => {
    void handleSave();
  });
}

/**
 * 表示言語セレクタの配線（issue #93。docs/ui-states.md §2「表示言語」）。
 * change で即時に保存 + setUiLanguage（購読者 = アプリのストア再描画 / options.html の
 * 本文再構築が新言語で描き直す）。保存失敗は切替自体を妨げず、トーストで知らせる。
 * 初期値は保存値ではなく現在の表示言語（同期。各エントリの起動時に保存値を反映済み）
 */
function bootstrapUiLanguageSection(root: ParentNode): void {
  const select = root.querySelector<HTMLSelectElement>('#ui-language');
  if (!select) {
    return;
  }
  select.value = getUiLanguage();
  select.addEventListener('change', () => {
    const language = isUiLanguage(select.value) ? select.value : 'ja';
    void saveUiLanguage(language).catch(() => {
      showToast(t('options.languageSaveFailed'), select.ownerDocument);
    });
    setUiLanguage(language);
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
    (key) => (looksLikeOpenRouterApiKey(key) ? t('options.warnOpenRouterKey') : null),
  );
  await bootstrapApiKeySection(
    root,
    { input: 'openrouter-api-key', saveButton: 'save-openrouter-key', status: 'openrouter-status' },
    'OpenRouter',
    loadOpenRouterApiKey,
    saveOpenRouterApiKey,
    (key) => (looksLikeGeminiApiKey(key) ? t('options.warnGeminiKey') : null),
  );
  await bootstrapLlmConnectionSection(root);
  await bootstrapDefaultModelSection(root);
  await bootstrapRateLimitSection(root);
  bootstrapUiLanguageSection(root);
}

/**
 * スタンドアロン設定ページ（options.html）の起動配線: 保存済みの表示言語を反映してから
 * 設定本文を構築・配線し、言語切替のたびに本文を新言語で再構築する（issue #93）。
 * アプリ内 #/options はストア再描画が同じ役割を担うため、これは options.html 専用
 */
export async function bootstrapOptionsPage(doc: Document): Promise<void> {
  const body = doc.getElementById('settings-body');
  if (!body) {
    return;
  }
  setUiLanguage(await loadUiLanguage());
  const rebuild = async (): Promise<void> => {
    // 静的部分（h1 / アプリを開くリンクの data-i18n）+ <html lang> + タイトルも追従させる
    doc.documentElement.lang = getUiLanguage();
    doc.title = t('options.documentTitle');
    localizeDom(doc);
    body.replaceChildren(buildSettingsSections());
    await bootstrapOptions(doc);
  };
  onUiLanguageChange(() => {
    void rebuild();
  });
  await rebuild();
}
