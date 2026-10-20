// Options（S11）の実処理: 接続方式・キー・既定モデルを保存して接続を確認する。
// 状態仕様は docs/ui-states.md §2「LLM 接続（統合版）」。
import { withDevSuffix } from '../build-info';
import { createModelSelect } from '../app/ui/modelSelect';
import { showToast } from '../app/ui/toast';
import { openAiDataConsentDialog } from '../app/ui/aiDataConsentDialog';
import type { LlmProviderId } from '../domain/llmApiLog';
import { LlmProviderError, type ReasoningEffort } from '../lib/llm/LLMProvider';
import {
  getUiLanguage,
  isUiLanguage,
  localizeDom,
  onUiLanguageChange,
  setUiLanguage,
  t,
} from '../lib/i18n';
import { buildSettingsSections } from './settingsSections';
import {
  buildModelCatalogFor,
  findProviderModelMismatch,
  providerModelMismatchMessage,
} from '../lib/llm/modelCatalog';
import { fetchModelIds, isModelListFetchSupported } from '../lib/llm/modelListFetcher';
import type { ModelPricing } from '../lib/llm/pricing';
import { createProvider, resolveProviderId } from '../lib/llm/providerFactory';
import {
  getRateLimitTier,
  isRateLimitTierId,
  type RateLimitTierId,
} from '../lib/llm/rateLimitPolicy';
import {
  loadAnthropicApiKey,
  loadAzureOpenAiApiKey,
  loadGeminiApiKey,
  loadOpenAiCompatibleApiKey,
  loadOpenRouterApiKey,
  looksLikeGeminiApiKey,
  looksLikeOpenRouterApiKey,
  saveAnthropicApiKey,
  saveAzureOpenAiApiKey,
  saveGeminiApiKey,
  saveOpenAiCompatibleApiKey,
  saveOpenRouterApiKey,
} from '../lib/storage/secretsStore';
import { requestEndpointPermission } from '../lib/storage/hostPermission';
import {
  AI_DATA_CONSENT_VERSION,
  clearAiDataConsent,
  isCurrentAiDataConsent,
  loadAiDataConsent,
  saveAiDataConsent,
  type AiDataConsentRecord,
} from '../lib/storage/aiDataConsentStore';
import {
  FACTORY_DEFAULT_MODEL,
  isLoopbackEndpoint,
  loadDefaultModel,
  loadFetchedModelIds,
  saveFetchedModelIds,
  saveFetchedModelPricing,
  normalizeLocalLlmEndpoint,
  resolveStoredEndpoint,
  loadDefaultReasoningEffort,
  loadLlmConnectionSettings,
  loadRateLimitCustomConcurrency,
  loadRateLimitCustomRpm,
  loadRateLimitTier,
  loadUiLanguage,
  normalizeOpenAiCompatibleEndpoint,
  requiresFullUrlEndpoint,
  saveDefaultModel,
  saveDefaultReasoningEffort,
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

function isReasoningEffortValue(value: string): value is ReasoningEffort {
  return value === 'low' || value === 'medium' || value === 'high';
}

/**
 * reasoning effort の既定値節の配線（issue #127 PR5。docs/ui-states.md §2「reasoning effort の
 * 既定値」。必須要素が欠けている場合は何もしない）。change の都度即時保存する
 * （#ui-language と同じ流儀。保存に失敗してもセレクタの選択自体は妨げない）
 */
async function bootstrapReasoningEffortSection(root: ParentNode): Promise<void> {
  const select = root.querySelector<HTMLSelectElement>('#default-reasoning-effort');
  const statusEl = root.querySelector<HTMLElement>('#default-reasoning-effort-status');
  if (!select || !statusEl) {
    return;
  }

  const setStatus = makeSetStatus(statusEl);
  const renderStatus = (saved: ReasoningEffort | null): void => {
    setStatus(
      t('options.reasoningEffortStatus', {
        status: saved ? t('options.statusSavedKey') : t('options.statusUnsetKey'),
      }),
      false,
    );
  };

  const saved = await loadDefaultReasoningEffort();
  select.value = saved ?? '';
  renderStatus(saved);

  select.addEventListener('change', () => {
    const value = select.value;
    const effort = isReasoningEffortValue(value) ? value : null;
    void saveDefaultReasoningEffort(effort)
      .then(() => renderStatus(effort))
      .catch(() => setStatus(t('options.toastSaveFailed'), true));
  });
}

// 思考つきモデルは思考トークンも出力上限に数えるため、64 では本文に届く前に打ち切られる。
// 2026-10-07 の実測では Gemini 3.5 / 3.6 / 3.8 Flash が上限 64 で各 3 回中 3 / 3 / 2 回失敗し、
// 4096 では各 3 回とも成功した。構造化出力を守らないローカル LLM などの出力を止めるため、上限は残す。
const CONNECTION_TEST_MAX_OUTPUT_TOKENS = 4_096;

const CONNECTION_TEST_SCHEMA = {
  type: 'object',
  properties: { ok: { type: 'boolean' } },
  required: ['ok'],
  additionalProperties: false,
};

function selectedProvider(select: HTMLSelectElement): LlmProviderId {
  const value = select.value;
  if (
    value === 'openrouter' ||
    value === 'openai_compatible' ||
    value === 'anthropic' ||
    value === 'azure_openai' ||
    value === 'local_llm'
  ) {
    return value;
  }
  return 'gemini';
}

/** プロバイダの例外またはモデル一覧取得のメッセージから HTTP ステータスを読む。 */
function connectionErrorStatus(error: unknown, reason: string): number | null {
  if (error instanceof LlmProviderError) {
    return error.status;
  }
  return Number(/HTTP (\d{3})/.exec(reason)?.[1]) || null;
}

/** LLM 接続の検証・保存・一覧取得・呼び出し確認を順に行う。 */
async function bootstrapLlmConnectionSection(root: ParentNode): Promise<void> {
  const providerSelect = root.querySelector<HTMLSelectElement>('#llm-provider');
  const container = root.querySelector<HTMLElement>('#default-model-container');
  const saveButton = root.querySelector<HTMLButtonElement>('#save-and-test-llm-connection');
  const statusEl = root.querySelector<HTMLElement>('#llm-connection-status');
  if (!providerSelect || !container || !saveButton || !statusEl) {
    return;
  }
  const setStatus = makeSetStatus(statusEl);
  const settings = await loadLlmConnectionSettings();
  let pendingModel = (await loadDefaultModel()) ?? FACTORY_DEFAULT_MODEL;
  let fetched = await loadFetchedModelIds();
  providerSelect.value = settings.provider ?? resolveProviderId(pendingModel);
  if (findProviderModelMismatch(pendingModel, selectedProvider(providerSelect)) !== null) {
    pendingModel = '';
  }
  const fields = [
    {
      provider: 'gemini',
      id: 'gemini',
      label: 'Gemini',
      load: loadGeminiApiKey,
      save: saveGeminiApiKey,
    },
    {
      provider: 'openrouter',
      id: 'openrouter',
      label: 'OpenRouter',
      load: loadOpenRouterApiKey,
      save: saveOpenRouterApiKey,
    },
    {
      provider: 'anthropic',
      id: 'anthropic',
      label: 'Anthropic',
      load: loadAnthropicApiKey,
      save: saveAnthropicApiKey,
    },
    {
      provider: 'azure_openai',
      id: 'azure-openai',
      label: 'Azure OpenAI',
      load: loadAzureOpenAiApiKey,
      save: saveAzureOpenAiApiKey,
    },
    {
      provider: 'openai_compatible',
      id: 'openai-compatible',
      label: t('options.providerOpenAiCompatible'),
      load: loadOpenAiCompatibleApiKey,
      save: saveOpenAiCompatibleApiKey,
    },
    {
      provider: 'local_llm',
      id: 'local-llm',
      label: t('options.providerLocalLlm'),
      load: async () => null,
      save: undefined,
    },
  ] as const;
  for (const field of fields) {
    const input = root.querySelector<HTMLInputElement>('#' + field.id + '-api-key');
    if (input) {
      input.placeholder = (await field.load())
        ? t('options.placeholderSavedKey') : t('options.placeholderEnterKey');
    }
    const endpoint = root.querySelector<HTMLInputElement>('#' + field.id + '-endpoint');
    if (endpoint) {
      endpoint.value = resolveStoredEndpoint(settings, field.provider) ?? '';
    }
  }
  for (const [preset, port] of [['ollama', '11434'], ['lmstudio', '1234']]) {
    root.querySelector('#local-llm-preset-' + preset)?.addEventListener('click', () => {
      const input = root.querySelector<HTMLInputElement>('#local-llm-endpoint');
      if (input) {
        input.value = 'http://localhost:' + port + '/v1/chat/completions';
      }
    });
  }
  const renderModels = (resetMissing: boolean): void => {
    const provider = selectedProvider(providerSelect);
    const groups = buildModelCatalogFor(provider, fetched[provider] ?? []);
    if (resetMissing && !groups.some((group) => group.models.includes(pendingModel))) {
      pendingModel = '';
    }
    container.replaceChildren(createModelSelect(container.ownerDocument, {
      id: 'default-model',
      ariaLabel: t('options.defaultModelTitle'),
      value: pendingModel,
      placeholderLabel: t('options.defaultModelPlaceholder'),
      groups,
      onChange: (model) => {
        pendingModel = model;
      },
    }));
  };
  const renderFields = (): void => {
    for (const field of fields) {
      const element = root.querySelector<HTMLElement>('#' + field.id + '-fields');
      if (element) {
        element.hidden = field.provider !== selectedProvider(providerSelect);
      }
    }
  };
  renderFields();
  renderModels(false);
  providerSelect.addEventListener('change', () => {
    renderFields();
    renderModels(true);
  });
  setStatus(settings.provider === null ? t('options.connectionUnsaved') : t('options.connectionSaved'), false);

  saveButton.addEventListener('click', () => {
    void (async () => {
      saveButton.disabled = true;
      providerSelect.disabled = true;
      let stage = 1;
      const provider = selectedProvider(providerSelect);
      const model = pendingModel.trim();
      try {
        setStatus(t('options.connectionValidating'), false);
        const field = fields.find((item) => item.provider === provider)!;
        const keyInput = root.querySelector<HTMLInputElement>('#' + field.id + '-api-key');
        const enteredKey = keyInput?.value.trim() ?? '';
        if (provider === 'gemini' && looksLikeOpenRouterApiKey(enteredKey)) {
          throw new Error(t('options.warnOpenRouterKey'));
        }
        if (provider === 'openrouter' && looksLikeGeminiApiKey(enteredKey)) {
          throw new Error(t('options.warnGeminiKey'));
        }
        if (model === '') {
          throw new Error(t('options.errDefaultModelRequired'));
        }
        if (findProviderModelMismatch(model, provider) !== null) {
          throw new Error(providerModelMismatchMessage(model, provider));
        }
        const endpointInput = root.querySelector<HTMLInputElement>('#' + field.id + '-endpoint');
        let endpoint: string | undefined;
        if (provider === 'local_llm') {
          endpoint = normalizeLocalLlmEndpoint(endpointInput?.value ?? '');
        } else if (requiresFullUrlEndpoint(provider)) {
          endpoint = normalizeOpenAiCompatibleEndpoint(endpointInput?.value ?? '');
        }
        const apiKey = enteredKey || (await field.load()) || '';
        if (apiKey === '' && provider !== 'local_llm' &&
          !(provider === 'openai_compatible' && isLoopbackEndpoint(endpoint as string))) {
          throw new Error(t('options.errKeyMissing', { provider: field.label }));
        }
        const config = { provider, model, apiKey, endpoint, reasoningEffort: await loadDefaultReasoningEffort() };
        stage = 2;
        setStatus(t('options.connectionPermission'), false);
        if (endpoint !== undefined && !(await requestEndpointPermission(endpoint))) {
          throw new Error(t('options.errPermissionDenied'));
        }
        stage = 3;
        setStatus(t('options.connectionSaving'), false);
        await saveLlmConnectionSettings({
          provider,
          ...(provider === 'openai_compatible' ? { openAiCompatibleEndpoint: endpoint } : {}),
          ...(provider === 'azure_openai' ? { azureOpenAiEndpoint: endpoint } : {}),
          ...(provider === 'local_llm' ? { localLlmEndpoint: endpoint } : {}),
        });
        if (enteredKey !== '' && keyInput) {
          await field.save!(enteredKey);
          keyInput.value = '';
          keyInput.placeholder = t('options.placeholderSavedKey');
        }
        await saveDefaultModel(model);
        stage = 4;
        let count: number | null = null;
        if (isModelListFetchSupported(provider)) {
          setStatus(t('options.fetchModelListFetching'), false);
          let pricing: Record<string, ModelPricing> = {};
          const ids = await fetchModelIds({
            provider, apiKey, chatCompletionsUrl: endpoint,
            onPricing: (fetchedPricing) => {
              pricing = fetchedPricing;
            },
          });
          if (provider === 'openrouter') {
            await saveFetchedModelPricing(provider, pricing);
          }
          await saveFetchedModelIds(provider, ids);
          fetched = await loadFetchedModelIds();
          count = fetched[provider]?.length ?? 0;
          renderModels(false);
        }
        stage = 5;
        setStatus(t('options.connectionTesting'), false);
        const response = await createProvider(config).chat(
          [
            { role: 'system', content: 'Return JSON matching the supplied schema.' },
            { role: 'user', content: 'Return {"ok":true}.' },
          ],
          { responseSchema: CONNECTION_TEST_SCHEMA, maxOutputTokens: CONNECTION_TEST_MAX_OUTPUT_TOKENS, temperature: 0 },
        );
        let parsed: { ok?: unknown } | null;
        try {
          parsed = JSON.parse(response.text) as { ok?: unknown } | null;
        } catch {
          throw new Error(t('options.testNoJson'));
        }
        if (parsed?.ok !== true) {
          throw new Error(t('options.testNoJson'));
        }
        setStatus(count === null ? t('options.connectionSucceeded', { model }) :
          t('options.connectionSucceededWithModels', { model, count }), false);
      } catch (err) {
        const reason = err instanceof Error ? err.message : String(err);
        if (stage <= 3) {
          setStatus(t('options.connectionSaveFailed', {
            reason: stage === 3 ? t('options.connectionStorageFailed') : reason,
          }), true);
        } else {
          const status = connectionErrorStatus(err, reason);
          let detail = reason;
          if (status === 401 || status === 403) {
            detail = t('options.connectionAuthFailed', { status });
          } else if (stage === 5 && (status === 404 || /model_not_found|not_found_error/.test(reason))) {
            detail = t('options.connectionModelMissing', { model });
          } else if (err instanceof TypeError) {
            detail = t('options.connectionUnreachable');
          } else if (stage === 4) {
            detail = t('options.connectionModelsFailed', { reason });
          }
          setStatus(t('options.connectionCheckFailed', { reason: detail }), true);
        }
      } finally {
        saveButton.disabled = false;
        providerSelect.disabled = false;
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

/** 同意した日時を表示言語の書式で出す（壊れた値はそのまま） */
function formatConsentDate(timestamp: string): string {
  const date = new Date(timestamp);
  if (Number.isNaN(date.getTime())) return timestamp;
  return new Intl.DateTimeFormat(getUiLanguage(), { dateStyle: 'medium', timeStyle: 'short' }).format(date);
}

/**
 * 「AI へ送る内容」節の配線（issue #381。docs/ui-states.md §2「AI へ送る内容」）。
 * 説明の再表示は同意画面と同じダイアログを使い、「同意して続行」なら同意を記録する。
 * 送り先の名前は現在の接続方式（未選択ならモデル ID から推定）
 */
async function bootstrapAiDataConsentSection(root: ParentNode): Promise<void> {
  const statusEl = root.querySelector<HTMLElement>('#ai-data-consent-status');
  const showButton = root.querySelector<HTMLButtonElement>('#ai-data-consent-show');
  const revokeButton = root.querySelector<HTMLButtonElement>('#ai-data-consent-revoke');
  if (!statusEl || !showButton || !revokeButton) {
    return;
  }
  const setStatus = makeSetStatus(statusEl);
  const render = (record: AiDataConsentRecord | null): void => {
    const current = isCurrentAiDataConsent(record);
    setStatus(
      current
        ? t('options.aiConsentStatusAccepted', { date: formatConsentDate(record.acceptedAt) })
        : t('options.aiConsentStatusNone'),
      false,
    );
    revokeButton.disabled = !current;
  };
  const failed = (): void => setStatus(t('options.aiConsentFailed'), true);
  await loadAiDataConsent().then(render, () => render(null));

  showButton.addEventListener('click', () => {
    void (async () => {
      const settings = await loadLlmConnectionSettings();
      const provider = settings.provider ?? resolveProviderId((await loadDefaultModel()) ?? FACTORY_DEFAULT_MODEL);
      if (!(await openAiDataConsentDialog(showButton.ownerDocument, provider))) {
        return;
      }
      const record = { version: AI_DATA_CONSENT_VERSION, acceptedAt: new Date().toISOString() };
      await saveAiDataConsent(record);
      render(record);
    })().catch(failed);
  });
  revokeButton.addEventListener('click', () => {
    void clearAiDataConsent().then(() => render(null), failed);
  });
}

/**
 * 設定本文の配線。root は options.html の `document` でも、アプリ内 #/options が
 * 生成した（未 attach でよい）コンテナ要素でもよい（querySelector で解決するため）。
 */
export async function bootstrapOptions(root: ParentNode): Promise<void> {
  await bootstrapLlmConnectionSection(root);
  await bootstrapReasoningEffortSection(root);
  await bootstrapRateLimitSection(root);
  bootstrapUiLanguageSection(root);
  await bootstrapAiDataConsentSection(root);
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
    // タブタイトルにも dev サフィックスを付ける（app / popup と同じ扱い。build-info.ts）
    doc.title = withDevSuffix(t('options.documentTitle'));
    localizeDom(doc);
    body.replaceChildren(buildSettingsSections());
    await bootstrapOptions(doc);
  };
  onUiLanguageChange(() => {
    void rebuild();
  });
  await rebuild();
}
