// Options（S11）の実処理: Gemini API キーの保存（BYOK）。
// 状態仕様は docs/ui-states.md §2（trim 保存・空文字は保存抑止・保存中はボタン無効化）
import { loadGeminiApiKey, saveGeminiApiKey } from '../lib/storage/secretsStore';

export async function bootstrapOptions(doc: Document): Promise<void> {
  const input = doc.getElementById('gemini-api-key') as HTMLInputElement | null;
  const saveButton = doc.getElementById('save-keys') as HTMLButtonElement | null;
  const statusEl = doc.getElementById('options-status');
  if (!input || !saveButton || !statusEl) {
    return;
  }

  const setStatus = (text: string, isError: boolean): void => {
    statusEl.textContent = text;
    statusEl.classList.toggle('options__status--error', isError);
  };

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
