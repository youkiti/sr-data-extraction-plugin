// Options（S11）の実処理: Gemini / OpenRouter API キーの保存（BYOK）と既定モデルの保存。
// 状態仕様は docs/ui-states.md §2（trim 保存・API キーの空文字は保存抑止・
// 既定モデルの空は「未設定に戻す」・保存中はボタン無効化）
import { createModelSelect } from '../app/ui/modelSelect';
import {
  loadGeminiApiKey,
  loadOpenRouterApiKey,
  saveGeminiApiKey,
  saveOpenRouterApiKey,
} from '../lib/storage/secretsStore';
import { loadDefaultModel, saveDefaultModel } from '../lib/storage/settingsStore';

/** ステータス要素へ文言 + 通常 / エラー系の色分けを反映する */
function makeSetStatus(statusEl: HTMLElement): (text: string, isError: boolean) => void {
  return (text, isError) => {
    statusEl.textContent = text;
    statusEl.classList.toggle('options__status--error', isError);
  };
}

/** API キー節の共通配線（Gemini / OpenRouter で鏡写し。必須要素が欠けている場合は何もしない） */
async function bootstrapApiKeySection(
  doc: Document,
  ids: { input: string; saveButton: string; status: string },
  providerLabel: string,
  load: () => Promise<string | null>,
  save: (key: string) => Promise<void>,
): Promise<void> {
  const input = doc.getElementById(ids.input) as HTMLInputElement | null;
  const saveButton = doc.getElementById(ids.saveButton) as HTMLButtonElement | null;
  const statusEl = doc.getElementById(ids.status);
  if (!input || !saveButton || !statusEl) {
    return;
  }

  const setStatus = makeSetStatus(statusEl);

  const savedKey = await load();
  setStatus(`${providerLabel}: ${savedKey ? '保存済み' : '未設定'}`, false);

  const handleSave = async (): Promise<void> => {
    const value = input.value.trim();
    if (value === '') {
      setStatus('API キーが空のため保存しませんでした。', true);
      return;
    }
    saveButton.disabled = true;
    try {
      await save(value);
      input.value = '';
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
async function bootstrapDefaultModelSection(doc: Document): Promise<void> {
  const container = doc.getElementById('default-model-container');
  const saveButton = doc.getElementById('save-default-model') as HTMLButtonElement | null;
  const statusEl = doc.getElementById('default-model-status');
  if (!container || !saveButton || !statusEl) {
    return;
  }

  const setStatus = makeSetStatus(statusEl);

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

export async function bootstrapOptions(doc: Document): Promise<void> {
  await bootstrapApiKeySection(
    doc,
    { input: 'gemini-api-key', saveButton: 'save-keys', status: 'options-status' },
    'Gemini',
    loadGeminiApiKey,
    saveGeminiApiKey,
  );
  await bootstrapApiKeySection(
    doc,
    { input: 'openrouter-api-key', saveButton: 'save-openrouter-key', status: 'openrouter-status' },
    'OpenRouter',
    loadOpenRouterApiKey,
    saveOpenRouterApiKey,
  );
  await bootstrapDefaultModelSection(doc);
}
