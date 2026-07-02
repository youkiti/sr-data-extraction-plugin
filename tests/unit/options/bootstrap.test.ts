// Options（S11）の状態仕様テスト（docs/ui-states.md §2 と 1:1 対応）
import { installChromeMock, type ChromeMock } from '../../setup/chrome-mock';
import { bootstrapOptions } from '../../../src/options/bootstrap';

const OPTIONS_TEMPLATE = `
  <main class="options">
    <p id="options-status">読み込み中…</p>
    <label for="gemini-api-key">Gemini API キー</label>
    <input id="gemini-api-key" type="password" autocomplete="off" />
    <button id="save-keys" type="button">保存</button>
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
