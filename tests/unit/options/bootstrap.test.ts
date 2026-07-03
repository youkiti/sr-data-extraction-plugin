// Options（S11）の状態仕様テスト（docs/ui-states.md §2 と 1:1 対応）
import { installChromeMock, type ChromeMock } from '../../setup/chrome-mock';
import { MODEL_PRICING } from '../../../src/lib/llm/pricing';
import { bootstrapOptions } from '../../../src/options/bootstrap';

const OPTIONS_TEMPLATE = `
  <main class="options">
    <p id="options-status">読み込み中…</p>
    <label for="gemini-api-key">Gemini API キー</label>
    <input id="gemini-api-key" type="password" autocomplete="off" />
    <button id="save-keys" type="button">保存</button>
  </main>
`;

/** 既定モデル節を含むフルテンプレート（options.html §2「既定モデル」と同じ要素構成） */
const OPTIONS_TEMPLATE_WITH_MODEL = `
  <main class="options">
    <p id="options-status">読み込み中…</p>
    <label for="gemini-api-key">Gemini API キー</label>
    <input id="gemini-api-key" type="password" autocomplete="off" />
    <button id="save-keys" type="button">保存</button>
    <p id="default-model-status">読み込み中…</p>
    <label for="default-model">既定モデル</label>
    <input id="default-model" type="text" list="default-model-candidates" autocomplete="off" />
    <datalist id="default-model-candidates"></datalist>
    <button id="save-default-model" type="button">保存</button>
  </main>
`;

const flush = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

function statusEl(): HTMLElement {
  return document.getElementById('options-status') as HTMLElement;
}

function inputEl(): HTMLInputElement {
  return document.getElementById('gemini-api-key') as HTMLInputElement;
}

function saveButton(): HTMLButtonElement {
  return document.getElementById('save-keys') as HTMLButtonElement;
}

describe('bootstrapOptions', () => {
  let chromeMock: ChromeMock;

  beforeEach(() => {
    chromeMock = installChromeMock();
    document.body.innerHTML = OPTIONS_TEMPLATE;
  });

  test('必須要素が欠けている場合は何もしない', async () => {
    document.body.innerHTML = '<p>壊れた DOM</p>';
    await expect(bootstrapOptions(document)).resolves.toBeUndefined();
  });

  test('状態 A: 未設定なら「Gemini: 未設定」', async () => {
    await bootstrapOptions(document);
    expect(statusEl().textContent).toBe('Gemini: 未設定');
  });

  test('状態 A: 保存済みなら「Gemini: 保存済み」', async () => {
    chromeMock.storage.local.data['secrets.geminiApiKey'] = 'AIzaSySAVED';
    await bootstrapOptions(document);
    expect(statusEl().textContent).toBe('Gemini: 保存済み');
  });

  test('空文字（空白のみ）は保存を抑止しエラー表示する', async () => {
    await bootstrapOptions(document);
    inputEl().value = '   ';
    saveButton().click();
    await flush();
    expect(statusEl().textContent).toBe('API キーが空のため保存しませんでした。');
    expect(statusEl().classList.contains('options__status--error')).toBe(true);
    expect(chromeMock.storage.local.set).not.toHaveBeenCalled();
  });

  test('状態 B: trim して保存し、完了メッセージを出して入力欄をクリアする', async () => {
    await bootstrapOptions(document);
    inputEl().value = '  AIzaSyNEWKEY  ';
    saveButton().click();
    await flush();
    expect(chromeMock.storage.local.data['secrets.geminiApiKey']).toBe('AIzaSyNEWKEY');
    expect(statusEl().textContent).toBe('保存しました。');
    expect(statusEl().classList.contains('options__status--error')).toBe(false);
    expect(inputEl().value).toBe('');
    expect(saveButton().disabled).toBe(false);
  });

  test('状態 B: 保存中はボタンを無効化する', async () => {
    await bootstrapOptions(document);
    let resolveSet: () => void = () => undefined;
    chromeMock.storage.local.set.mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          resolveSet = resolve;
        }),
    );
    inputEl().value = 'AIzaSyPENDING';
    saveButton().click();
    await flush();
    expect(saveButton().disabled).toBe(true);
    resolveSet();
    await flush();
    expect(saveButton().disabled).toBe(false);
    expect(statusEl().textContent).toBe('保存しました。');
  });

  test('状態 B: 保存失敗時は赤系メッセージ + ボタン復帰', async () => {
    await bootstrapOptions(document);
    chromeMock.storage.local.set.mockRejectedValueOnce(new Error('quota exceeded'));
    inputEl().value = 'AIzaSyFAIL';
    saveButton().click();
    await flush();
    expect(statusEl().textContent).toBe('保存に失敗しました。もう一度お試しください。');
    expect(statusEl().classList.contains('options__status--error')).toBe(true);
    expect(saveButton().disabled).toBe(false);
  });
});

describe('bootstrapOptions（既定モデル。docs/ui-states.md §2「既定モデル」）', () => {
  let chromeMock: ChromeMock;

  function modelStatusEl(): HTMLElement {
    return document.getElementById('default-model-status') as HTMLElement;
  }

  function modelInputEl(): HTMLInputElement {
    return document.getElementById('default-model') as HTMLInputElement;
  }

  function modelSaveButton(): HTMLButtonElement {
    return document.getElementById('save-default-model') as HTMLButtonElement;
  }

  beforeEach(() => {
    chromeMock = installChromeMock();
    document.body.innerHTML = OPTIONS_TEMPLATE_WITH_MODEL;
  });

  test('既定モデル節の要素が欠けている場合は API キー節だけ配線する', async () => {
    document.body.innerHTML = OPTIONS_TEMPLATE;
    await bootstrapOptions(document);
    expect(statusEl().textContent).toBe('Gemini: 未設定');
    expect(document.getElementById('default-model-status')).toBeNull();
  });

  test('datalist に単価表（MODEL_PRICING）のモデル ID を列挙する', async () => {
    await bootstrapOptions(document);
    const values = Array.from(
      document.querySelectorAll('#default-model-candidates option'),
    ).map((option) => (option as HTMLOptionElement).value);
    expect(values).toEqual(Object.keys(MODEL_PRICING));
  });

  test('未設定なら「既定モデル: 未設定」+ input は空', async () => {
    await bootstrapOptions(document);
    expect(modelStatusEl().textContent).toBe('既定モデル: 未設定');
    expect(modelInputEl().value).toBe('');
  });

  test('保存済みなら「既定モデル: 保存済み」+ 保存値を input へ表示（マスク不要）', async () => {
    chromeMock.storage.local.data['settings.defaultModel'] = 'gemini-2.0-flash';
    await bootstrapOptions(document);
    expect(modelStatusEl().textContent).toBe('既定モデル: 保存済み');
    expect(modelInputEl().value).toBe('gemini-2.0-flash');
  });

  test('trim して保存し「保存しました。」（input は trim 後の値を保持）', async () => {
    await bootstrapOptions(document);
    modelInputEl().value = '  gemini-2.5-pro  ';
    modelSaveButton().click();
    await flush();
    expect(chromeMock.storage.local.data['settings.defaultModel']).toBe('gemini-2.5-pro');
    expect(modelStatusEl().textContent).toBe('保存しました。');
    expect(modelStatusEl().classList.contains('options__status--error')).toBe(false);
    expect(modelInputEl().value).toBe('gemini-2.5-pro');
    expect(modelSaveButton().disabled).toBe(false);
  });

  test('空文字は「未設定に戻す」（キー削除 + 案内文言。API キーと違い解除を許す）', async () => {
    chromeMock.storage.local.data['settings.defaultModel'] = 'gemini-2.5-pro';
    await bootstrapOptions(document);
    modelInputEl().value = '   ';
    modelSaveButton().click();
    await flush();
    expect(chromeMock.storage.local.remove).toHaveBeenCalledWith('settings.defaultModel');
    expect(chromeMock.storage.local.data['settings.defaultModel']).toBeUndefined();
    expect(modelStatusEl().textContent).toBe('未設定に戻しました。');
    expect(modelStatusEl().classList.contains('options__status--error')).toBe(false);
    expect(modelInputEl().value).toBe('');
  });

  test('保存中はボタンを無効化する', async () => {
    await bootstrapOptions(document);
    let resolveSet: () => void = () => undefined;
    chromeMock.storage.local.set.mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          resolveSet = resolve;
        }),
    );
    modelInputEl().value = 'gemini-2.5-pro';
    modelSaveButton().click();
    await flush();
    expect(modelSaveButton().disabled).toBe(true);
    resolveSet();
    await flush();
    expect(modelSaveButton().disabled).toBe(false);
    expect(modelStatusEl().textContent).toBe('保存しました。');
  });

  test('保存失敗時は赤系メッセージ + ボタン復帰', async () => {
    await bootstrapOptions(document);
    chromeMock.storage.local.set.mockRejectedValueOnce(new Error('quota exceeded'));
    modelInputEl().value = 'gemini-2.5-pro';
    modelSaveButton().click();
    await flush();
    expect(modelStatusEl().textContent).toBe('保存に失敗しました。もう一度お試しください。');
    expect(modelStatusEl().classList.contains('options__status--error')).toBe(true);
    expect(modelSaveButton().disabled).toBe(false);
  });
});
