// Options（S11）の状態仕様テスト（docs/ui-states.md §2 と 1:1 対応）
import { installChromeMock, type ChromeMock } from '../../setup/chrome-mock';
import { MODEL_PRICING } from '../../../src/lib/llm/pricing';
import { MODEL_SELECT_OTHER_VALUE } from '../../../src/app/ui/modelSelect';
import { bootstrapOptions } from '../../../src/options/bootstrap';

const OPTIONS_TEMPLATE = `
  <main class="options">
    <p id="options-status">読み込み中…</p>
    <label for="gemini-api-key">Gemini API キー</label>
    <input id="gemini-api-key" type="password" autocomplete="off" />
    <button id="save-keys" type="button">保存</button>
    <p id="openrouter-status">読み込み中…</p>
    <label for="openrouter-api-key">OpenRouter API キー</label>
    <input id="openrouter-api-key" type="password" autocomplete="off" />
    <button id="save-openrouter-key" type="button">保存</button>
  </main>
`;

/** 既定モデル節を含むフルテンプレート（options.html「既定モデル」と同じ要素構成） */
const OPTIONS_TEMPLATE_WITH_MODEL = `
  <main class="options">
    <p id="options-status">読み込み中…</p>
    <label for="gemini-api-key">Gemini API キー</label>
    <input id="gemini-api-key" type="password" autocomplete="off" />
    <button id="save-keys" type="button">保存</button>
    <p id="openrouter-status">読み込み中…</p>
    <label for="openrouter-api-key">OpenRouter API キー</label>
    <input id="openrouter-api-key" type="password" autocomplete="off" />
    <button id="save-openrouter-key" type="button">保存</button>
    <p id="default-model-status">読み込み中…</p>
    <label for="default-model">既定モデル</label>
    <span id="default-model-container"></span>
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

  test('状態 A: 未設定なら「Gemini: 未設定」+ 入力を促す placeholder', async () => {
    await bootstrapOptions(document);
    expect(statusEl().textContent).toBe('Gemini: 未設定');
    expect(inputEl().placeholder).toBe('API キーを入力');
  });

  test('状態 A: 保存済みなら「Gemini: 保存済み」+ 保存済み placeholder', async () => {
    chromeMock.storage.local.data['secrets.geminiApiKey'] = 'AIzaSySAVED';
    await bootstrapOptions(document);
    expect(statusEl().textContent).toBe('Gemini: 保存済み');
    expect(inputEl().placeholder).toBe('保存済み（変更する場合のみ入力）');
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

  test('OpenRouter キー（sk-or-）を Gemini 欄に入れたら弾いて保存しない', async () => {
    await bootstrapOptions(document);
    inputEl().value = 'sk-or-WRONGFIELD';
    saveButton().click();
    await flush();
    expect(statusEl().textContent).toBe(
      'OpenRouter のキー（sk-or- で始まる）のようです。Gemini キーはここへ、OpenRouter キーは下の欄へ入力してください。',
    );
    expect(statusEl().classList.contains('options__status--error')).toBe(true);
    expect(chromeMock.storage.local.set).not.toHaveBeenCalled();
    expect(inputEl().value).toBe('sk-or-WRONGFIELD');
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
    expect(inputEl().placeholder).toBe('保存済み（変更する場合のみ入力）');
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

describe('bootstrapOptions（OpenRouter API キー節。Gemini と鏡写し）', () => {
  let chromeMock: ChromeMock;

  function orStatusEl(): HTMLElement {
    return document.getElementById('openrouter-status') as HTMLElement;
  }

  function orInputEl(): HTMLInputElement {
    return document.getElementById('openrouter-api-key') as HTMLInputElement;
  }

  function orSaveButton(): HTMLButtonElement {
    return document.getElementById('save-openrouter-key') as HTMLButtonElement;
  }

  beforeEach(() => {
    chromeMock = installChromeMock();
    document.body.innerHTML = OPTIONS_TEMPLATE;
  });

  test('未設定なら「OpenRouter: 未設定」、保存済みなら「OpenRouter: 保存済み」', async () => {
    await bootstrapOptions(document);
    expect(orStatusEl().textContent).toBe('OpenRouter: 未設定');
    chromeMock.storage.local.data['secrets.openRouterApiKey'] = 'sk-or-SAVED';
    document.body.innerHTML = OPTIONS_TEMPLATE;
    await bootstrapOptions(document);
    expect(orStatusEl().textContent).toBe('OpenRouter: 保存済み');
  });

  test('Gemini キー（AIza）を OpenRouter 欄に入れたら弾いて保存しない', async () => {
    await bootstrapOptions(document);
    orInputEl().value = 'AIzaSyWRONGFIELD';
    orSaveButton().click();
    await flush();
    expect(orStatusEl().textContent).toBe(
      'Gemini のキー（AIza で始まる）のようです。OpenRouter キーはここへ、Gemini キーは上の欄へ入力してください。',
    );
    expect(orStatusEl().classList.contains('options__status--error')).toBe(true);
    expect(chromeMock.storage.local.set).not.toHaveBeenCalled();
    expect(orInputEl().value).toBe('AIzaSyWRONGFIELD');
  });

  test('trim して保存し、完了メッセージを出して入力欄をクリアする', async () => {
    await bootstrapOptions(document);
    orInputEl().value = '  sk-or-NEWKEY  ';
    orSaveButton().click();
    await flush();
    expect(chromeMock.storage.local.data['secrets.openRouterApiKey']).toBe('sk-or-NEWKEY');
    expect(orStatusEl().textContent).toBe('保存しました。');
    expect(orInputEl().value).toBe('');
    expect(orSaveButton().disabled).toBe(false);
  });

  test('空文字は保存を抑止し、Gemini 節の表示には影響しない', async () => {
    await bootstrapOptions(document);
    orInputEl().value = '   ';
    orSaveButton().click();
    await flush();
    expect(orStatusEl().textContent).toBe('API キーが空のため保存しませんでした。');
    expect(orStatusEl().classList.contains('options__status--error')).toBe(true);
    expect(statusEl().textContent).toBe('Gemini: 未設定');
    expect(chromeMock.storage.local.set).not.toHaveBeenCalled();
  });

  test('保存失敗時は赤系メッセージ + ボタン復帰', async () => {
    await bootstrapOptions(document);
    chromeMock.storage.local.set.mockRejectedValueOnce(new Error('quota exceeded'));
    orInputEl().value = 'sk-or-FAIL';
    orSaveButton().click();
    await flush();
    expect(orStatusEl().textContent).toBe('保存に失敗しました。もう一度お試しください。');
    expect(orSaveButton().disabled).toBe(false);
  });
});

describe('bootstrapOptions（既定モデル。docs/ui-states.md §2「既定モデル」+「モデルセレクタ」）', () => {
  let chromeMock: ChromeMock;

  function modelStatusEl(): HTMLElement {
    return document.getElementById('default-model-status') as HTMLElement;
  }

  function modelSelectEl(): HTMLSelectElement {
    return document.getElementById('default-model') as HTMLSelectElement;
  }

  function modelCustomEl(): HTMLInputElement {
    return document.getElementById('default-model-custom') as HTMLInputElement;
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

  test('セレクタに単価表（MODEL_PRICING）のモデル ID を optgroup 付きで列挙する', async () => {
    await bootstrapOptions(document);
    const select = modelSelectEl();
    const groups = Array.from(select.querySelectorAll('optgroup')).map((g) => g.label);
    expect(groups).toEqual(['Gemini', 'OpenRouter']);
    const values = Array.from(select.options).map((option) => option.value);
    for (const model of Object.keys(MODEL_PRICING)) {
      expect(values).toContain(model);
    }
    expect(values).toContain(MODEL_SELECT_OTHER_VALUE);
  });

  test('未設定なら「既定モデル: 未設定」+ プレースホルダ選択', async () => {
    await bootstrapOptions(document);
    expect(modelStatusEl().textContent).toBe('既定モデル: 未設定');
    expect(modelSelectEl().value).toBe('');
    expect(modelSelectEl().options[0]?.textContent).toBe('未設定');
    expect(modelCustomEl().hidden).toBe(true);
  });

  test('保存済み（単価表のモデル）なら該当 option を選択して復元する', async () => {
    chromeMock.storage.local.data['settings.defaultModel'] = 'gemini-2.0-flash';
    await bootstrapOptions(document);
    expect(modelStatusEl().textContent).toBe('既定モデル: 保存済み');
    expect(modelSelectEl().value).toBe('gemini-2.0-flash');
    expect(modelCustomEl().hidden).toBe(true);
  });

  test('保存済み（単価表にないモデル）なら「その他」+ テキストに充填して復元する', async () => {
    chromeMock.storage.local.data['settings.defaultModel'] = 'my/custom-model';
    await bootstrapOptions(document);
    expect(modelSelectEl().value).toBe(MODEL_SELECT_OTHER_VALUE);
    expect(modelCustomEl().hidden).toBe(false);
    expect(modelCustomEl().value).toBe('my/custom-model');
  });

  test('プルダウンで選んだモデルを保存し「保存しました。」', async () => {
    await bootstrapOptions(document);
    modelSelectEl().value = 'gemini-2.5-pro';
    modelSelectEl().dispatchEvent(new Event('change'));
    modelSaveButton().click();
    await flush();
    expect(chromeMock.storage.local.data['settings.defaultModel']).toBe('gemini-2.5-pro');
    expect(modelStatusEl().textContent).toBe('保存しました。');
    expect(modelStatusEl().classList.contains('options__status--error')).toBe(false);
    expect(modelSaveButton().disabled).toBe(false);
  });

  test('「その他」の直接入力は trim して保存する', async () => {
    await bootstrapOptions(document);
    modelSelectEl().value = MODEL_SELECT_OTHER_VALUE;
    modelSelectEl().dispatchEvent(new Event('change'));
    modelCustomEl().value = '  my/custom-model  ';
    modelCustomEl().dispatchEvent(new Event('change'));
    modelSaveButton().click();
    await flush();
    expect(chromeMock.storage.local.data['settings.defaultModel']).toBe('my/custom-model');
    expect(modelStatusEl().textContent).toBe('保存しました。');
  });

  test('空（プレースホルダ選択）は「未設定に戻す」（キー削除 + 案内文言）', async () => {
    chromeMock.storage.local.data['settings.defaultModel'] = 'gemini-2.5-pro';
    await bootstrapOptions(document);
    modelSelectEl().value = '';
    modelSelectEl().dispatchEvent(new Event('change'));
    modelSaveButton().click();
    await flush();
    expect(chromeMock.storage.local.remove).toHaveBeenCalledWith('settings.defaultModel');
    expect(chromeMock.storage.local.data['settings.defaultModel']).toBeUndefined();
    expect(modelStatusEl().textContent).toBe('未設定に戻しました。');
    expect(modelStatusEl().classList.contains('options__status--error')).toBe(false);
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
    modelSelectEl().value = 'gemini-2.5-pro';
    modelSelectEl().dispatchEvent(new Event('change'));
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
    modelSelectEl().value = 'gemini-2.5-pro';
    modelSelectEl().dispatchEvent(new Event('change'));
    modelSaveButton().click();
    await flush();
    expect(modelStatusEl().textContent).toBe('保存に失敗しました。もう一度お試しください。');
    expect(modelStatusEl().classList.contains('options__status--error')).toBe(true);
    expect(modelSaveButton().disabled).toBe(false);
  });
});
