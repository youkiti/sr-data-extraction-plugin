import { installChromeMock, type ChromeMock } from '../../setup/chrome-mock';
import { bootstrapPopup } from '../../../src/popup/bootstrap';
import { CURRENT_PROJECT_STORAGE_KEY } from '../../../src/features/project/projectStore';

const POPUP_TEMPLATE = `
  <main class="popup">
    <h1>SR データ抽出</h1>
    <p id="popup-status">読み込み中…</p>
    <p id="popup-project" hidden></p>
    <button id="open-app" type="button">メインビューを開く</button>
  </main>
`;

describe('bootstrapPopup', () => {
  let chromeMock: ChromeMock;

  beforeEach(() => {
    chromeMock = installChromeMock();
    document.body.innerHTML = POPUP_TEMPLATE;
  });

  test('必須要素が欠けている場合は何もしない', async () => {
    document.body.innerHTML = '<p>壊れた DOM</p>';
    await expect(bootstrapPopup(document)).resolves.toBeUndefined();
  });

  test('プロジェクト未選択: 未選択メッセージを表示し、プロジェクト名は隠す', async () => {
    await bootstrapPopup(document);
    expect(document.getElementById('popup-status')?.textContent).toContain(
      'プロジェクトが未選択です',
    );
    expect((document.getElementById('popup-project') as HTMLElement).hidden).toBe(true);
  });

  test('プロジェクト選択済み: プロジェクト名を表示する', async () => {
    chromeMock.storage.local.data[CURRENT_PROJECT_STORAGE_KEY] = {
      spreadsheetId: 's1',
      name: '肺炎 SR',
    };
    await bootstrapPopup(document);
    expect(document.getElementById('popup-status')?.textContent).toBe('現在のプロジェクト:');
    const projectEl = document.getElementById('popup-project') as HTMLElement;
    expect(projectEl.hidden).toBe(false);
    expect(projectEl.textContent).toBe('肺炎 SR');
  });

  test('「メインビューを開く」で app.html を新規タブに開く', async () => {
    await bootstrapPopup(document);
    (document.getElementById('open-app') as HTMLButtonElement).click();
    expect(chrome.tabs.create).toHaveBeenCalledWith({
      url: 'chrome-extension://test-extension-id/app/app.html',
    });
  });
});
