// Options（S11）の実処理: Gemini API キーの保存（BYOK）と既定モデルの保存。
// 状態仕様は docs/ui-states.md §2（trim 保存・API キーの空文字は保存抑止・
// 既定モデルの空文字は「未設定に戻す」・保存中はボタン無効化）
import { MODEL_PRICING } from '../lib/llm/pricing';
import { loadGeminiApiKey, saveGeminiApiKey } from '../lib/storage/secretsStore';
import { loadDefaultModel, saveDefaultModel } from '../lib/storage/settingsStore';

/** ステータス要素へ文言 + 通常 / エラー系の色分けを反映する */
function makeSetStatus(statusEl: HTMLElement): (text: string, isError: boolean) => void {
  return (text, isError) => {
    statusEl.textContent = text;
    statusEl.classList.toggle('options__status--error', isError);
  };
}

/** Gemini API キー節の配線（必須要素が欠けている場合は何もしない） */
async function bootstrapGeminiKeySection(doc: Document): Promise<void> {
  const input = doc.getElementById('gemini-api-key') as HTMLInputElement | null;
  const saveButton = doc.getElementById('save-keys') as HTMLButtonElement | null;
  const statusEl = doc.getElementById('options-status');
  if (!input || !saveButton || !statusEl) {
    return;
  }

  const setStatus = makeSetStatus(statusEl);

  const savedKey = await loadGeminiApiKey();
  setStatus(`Gemini: ${savedKey ? '保存済み' : '未設定'}`, false);

  const handleSave = async (): Promise<void> => {
    const value = input.value.trim();
    if (value === '') {
      setStatus('API キーが空のため保存しませんでした。', true);
      return;
    }
    saveButton.disabled = true;
    try {
      await saveGeminiApiKey(value);
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
 * 保存値は S5 スキーマ画面のモデル入力の初期値になる（schemaService.loadSchema が注入）
 */
async function bootstrapDefaultModelSection(doc: Document): Promise<void> {
  const input = doc.getElementById('default-model') as HTMLInputElement | null;
  const datalist = doc.getElementById('default-model-candidates') as HTMLDataListElement | null;
  const saveButton = doc.getElementById('save-default-model') as HTMLButtonElement | null;
  const statusEl = doc.getElementById('default-model-status');
  if (!input || !datalist || !saveButton || !statusEl) {
    return;
  }

  const setStatus = makeSetStatus(statusEl);

  // 候補 = 単価表にあるモデル ID（候補提示のみ。単価表にないモデルも自由入力できる）
  for (const model of Object.keys(MODEL_PRICING)) {
    const option = doc.createElement('option');
    option.value = model;
    datalist.append(option);
  }

  const savedModel = await loadDefaultModel();
  input.value = savedModel ?? '';
  setStatus(`既定モデル: ${savedModel ? '保存済み' : '未設定'}`, false);

  const handleSave = async (): Promise<void> => {
    const value = input.value.trim();
    saveButton.disabled = true;
    try {
      // 空文字は「未設定に戻す」（API キーと違い空での解除を許す）
      await saveDefaultModel(value);
      input.value = value;
      setStatus(value === '' ? '未設定に戻しました。' : '保存しました。', false);
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
  await bootstrapGeminiKeySection(doc);
  await bootstrapDefaultModelSection(doc);
}
