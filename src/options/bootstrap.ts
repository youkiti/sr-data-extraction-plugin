// Options（S11）の実処理: Gemini / OpenRouter API キーの保存（BYOK）と既定モデルの保存。
// 状態仕様は docs/ui-states.md §2（trim 保存・API キーの空文字は保存抑止・
// 既定モデルの空は「未設定に戻す」・保存中はボタン無効化）
import { createModelSelect } from '../app/ui/modelSelect';
import {
  getRateLimitTier,
  isRateLimitTierId,
  type RateLimitTierId,
} from '../lib/llm/rateLimitPolicy';
import {
  loadGeminiApiKey,
  loadOpenRouterApiKey,
  looksLikeGeminiApiKey,
  looksLikeOpenRouterApiKey,
  saveGeminiApiKey,
  saveOpenRouterApiKey,
} from '../lib/storage/secretsStore';
import {
  loadDefaultModel,
  loadRateLimitCustomRpm,
  loadRateLimitTier,
  saveDefaultModel,
  saveRateLimitCustomRpm,
  saveRateLimitTier,
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
  const descEl = root.querySelector<HTMLElement>('#rate-limit-tier-desc');
  const saveButton = root.querySelector<HTMLButtonElement>('#save-rate-limit');
  const statusEl = root.querySelector<HTMLElement>('#rate-limit-status');
  if (!select || !customRow || !customInput || !descEl || !saveButton || !statusEl) {
    return;
  }

  const setStatus = makeSetStatus(statusEl);

  // 選択中の tier ID（select の値が不正なら既定へ倒す。syncTierUi と保存で共有）
  const currentTierId = (): RateLimitTierId =>
    isRateLimitTierId(select.value) ? select.value : 'gemini_free';

  // 選択 tier に応じて説明文とカスタム RPM 入力の表示を切り替える
  const syncTierUi = (): void => {
    const tier = getRateLimitTier(currentTierId());
    descEl.textContent = tier.description;
    customRow.hidden = !tier.editableRpm;
  };

  const savedTier = await loadRateLimitTier();
  const savedRpm = await loadRateLimitCustomRpm();
  select.value = savedTier;
  if (savedRpm !== null) {
    customInput.value = String(savedRpm);
  }
  syncTierUi();
  setStatus(`レート制限: ${getRateLimitTier(savedTier).label}`, false);

  select.addEventListener('change', syncTierUi);

  const handleSave = async (): Promise<void> => {
    const tierId = currentTierId();
    // カスタム tier で RPM が空・不正なら保存しない（プリセット既定へ戻すのは明示削除扱い）
    const rpmRaw = customInput.value.trim();
    const rpm = rpmRaw === '' ? Number.NaN : Number(rpmRaw);
    if (getRateLimitTier(tierId).editableRpm && (!Number.isFinite(rpm) || rpm <= 0)) {
      setStatus('RPM は 1 以上の数値を入力してください。', true);
      return;
    }
    saveButton.disabled = true;
    try {
      await saveRateLimitTier(tierId);
      await saveRateLimitCustomRpm(rpm);
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
  await bootstrapDefaultModelSection(root);
  await bootstrapRateLimitSection(root);
}
