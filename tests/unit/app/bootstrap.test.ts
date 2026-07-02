// メインビュー起動配線のテスト。hashchange の発火タイミングを決定的に制御するため、
// 実 window ではなくスタブ（location / addEventListener のみ実装）を注入する
import { installChromeMock, type ChromeMock } from '../../setup/chrome-mock';
import { bootstrapApp, seedState } from '../../../src/app/bootstrap';
import type { AppState } from '../../../src/app/store';
import { CURRENT_PROJECT_STORAGE_KEY } from '../../../src/features/project/projectStore';

interface WindowStub {
  document: Document;
  location: { hash: string };
  __E2E_PRELOADED_STATE__?: Partial<AppState>;
  addEventListener: jest.Mock;
  fireHashChange(): void;
}

function createWindowStub(preloaded?: Partial<AppState>): WindowStub {
  const listeners: Record<string, EventListener[]> = {};
  const stub: WindowStub = {
    document,
    location: { hash: '' },
    __E2E_PRELOADED_STATE__: preloaded,
    addEventListener: jest.fn((type: string, handler: EventListener) => {
      (listeners[type] ??= []).push(handler);
    }),
    fireHashChange() {
      for (const handler of listeners['hashchange'] ?? []) {
        handler(new Event('hashchange'));
      }
    },
  };
  return stub;
}

const asWindow = (stub: WindowStub): Window => stub as unknown as Window;

const APP_TEMPLATE = `
  <div class="app">
    <header class="app__header">
      <button id="app-title" type="button">SR データ抽出</button>
      <p id="app-status">読み込み中…</p>
      <button id="app-open-popup" type="button" hidden>プロジェクト選択（Popup）を開く</button>
      <p id="app-context" aria-live="polite">起動中</p>
    </header>
    <ul id="app-nav"></ul>
    <section id="app-content"></section>
  </div>
`;

function toastTexts(): string[] {
  return Array.from(document.querySelectorAll('.toast')).map((node) => node.textContent ?? '');
}

describe('seedState', () => {
  let chromeMock: ChromeMock;

  beforeEach(() => {
    chromeMock = installChromeMock();
  });

  test('ストレージ・注入なしなら初期状態', async () => {
    const state = await seedState(asWindow(createWindowStub()));
    expect(state.currentProject).toBeNull();
    expect(state.counts.documents).toBe(0);
  });

  test('chrome.storage.local の currentProject を読み込む', async () => {
    const project = { projectId: 'p1', spreadsheetId: 's1', driveFolderId: 'f1', name: '保存済みプロジェクト' };
    chromeMock.storage.local.data[CURRENT_PROJECT_STORAGE_KEY] = project;
    const state = await seedState(asWindow(createWindowStub()));
    expect(state.currentProject).toEqual(project);
  });

  test('E2E seam: __E2E_PRELOADED_STATE__ をシードへ上書きマージする', async () => {
    const stub = createWindowStub({
      currentProject: { projectId: 'pe', spreadsheetId: 'e2e', driveFolderId: 'fe', name: 'E2E プロジェクト' },
      counts: { documents: 4 } as AppState['counts'],
    });
    const state = await seedState(asWindow(stub));
    expect(state.currentProject?.name).toBe('E2E プロジェクト');
    expect(state.counts.documents).toBe(4);
    expect(state.counts.evidenceRows).toBe(0); // 未指定カウントは既定値を維持
  });

  test('E2E seam: counts なしの注入でも既定カウントを維持する', async () => {
    const stub = createWindowStub({
      currentProject: { projectId: 'pe', spreadsheetId: 'e2e', driveFolderId: 'fe', name: 'E2E プロジェクト' },
    });
    const state = await seedState(asWindow(stub));
    expect(state.counts.documents).toBe(0);
  });
});

describe('bootstrapApp', () => {
  beforeEach(() => {
    installChromeMock();
    document.body.innerHTML = APP_TEMPLATE;
  });

  test('必須要素が欠けている場合は null を返して何もしない', async () => {
    document.body.innerHTML = '<p>壊れた DOM</p>';
    await expect(bootstrapApp(asWindow(createWindowStub()))).resolves.toBeNull();
  });

  test('プロジェクト未選択（状態 A）: 未選択メッセージ + Popup を開く導線', async () => {
    await bootstrapApp(asWindow(createWindowStub()));
    expect(document.getElementById('app-status')?.textContent).toContain(
      'プロジェクトが選択されていません',
    );
    const openPopup = document.getElementById('app-open-popup') as HTMLButtonElement;
    expect(openPopup.hidden).toBe(false);

    openPopup.click();
    expect(chrome.tabs.create).toHaveBeenCalledWith({
      url: 'chrome-extension://test-extension-id/popup/popup.html',
    });
  });

  test('プロジェクト選択済み: ヘッダにプロジェクト名を表示し導線は隠す', async () => {
    await bootstrapApp(
      asWindow(createWindowStub({ currentProject: { projectId: 'p1', spreadsheetId: 's1', driveFolderId: 'f1', name: '肺炎 SR' } })),
    );
    expect(document.getElementById('app-status')?.textContent).toBe('プロジェクト: 肺炎 SR');
    expect((document.getElementById('app-open-popup') as HTMLButtonElement).hidden).toBe(true);
  });

  test('初期表示は #/home（サイドバー 9 項目 + aria-current + スクリーンリーダ通知）', async () => {
    await bootstrapApp(asWindow(createWindowStub()));
    expect(document.getElementById('app-content')?.textContent).toContain('プロジェクト概要');
    expect(document.getElementById('app-context')?.textContent).toBe('Home 画面を表示しています');
    const links = document.querySelectorAll('#app-nav a');
    expect(links).toHaveLength(9);
    expect(document.querySelector('#app-nav a[aria-current="page"]')?.getAttribute('href')).toBe(
      '#/home',
    );
  });

  test('ガード未充足のステップはディム表示され、クリックでトースト案内（状態 B）', async () => {
    const stub = createWindowStub();
    await bootstrapApp(asWindow(stub));
    const schemaLink = document.querySelector('#app-nav a[href="#/schema"]') as HTMLAnchorElement;
    expect(schemaLink.getAttribute('aria-disabled')).toBe('true');
    expect(schemaLink.classList.contains('app__nav-link--dimmed')).toBe(true);

    schemaLink.click();
    expect(toastTexts()).toContain('プロトコルを先に入力してください');
    expect(document.getElementById('app-content')?.textContent).toContain('プロジェクト概要');
  });

  test('ガード充足済みのルートへ hashchange で遷移する', async () => {
    const stub = createWindowStub();
    await bootstrapApp(asWindow(stub));
    stub.location.hash = '#/documents';
    stub.fireHashChange();
    expect(document.getElementById('app-content')?.textContent).toContain('文献取り込み');
    expect(document.getElementById('app-context')?.textContent).toBe(
      '文献取り込み 画面を表示しています',
    );
    expect(document.querySelector('#app-nav a[aria-current="page"]')?.getAttribute('href')).toBe(
      '#/documents',
    );
  });

  test('ガード未充足ルートへの直接遷移はトースト + 直前ルートへ戻す', async () => {
    const stub = createWindowStub();
    await bootstrapApp(asWindow(stub));
    stub.location.hash = '#/verify';
    stub.fireHashChange();
    expect(toastTexts().some((text) => text.includes('AI 抽出が未実施です'))).toBe(true);
    expect(stub.location.hash).toBe('#/home');
    expect(document.getElementById('app-content')?.textContent).toContain('プロジェクト概要');
  });

  test('#/extract はパイロット未実施でも遷移を許可し警告トーストを出す', async () => {
    const stub = createWindowStub({ counts: { schemaVersions: 1 } as AppState['counts'] });
    await bootstrapApp(asWindow(stub));
    stub.location.hash = '#/extract';
    stub.fireHashChange();
    expect(document.getElementById('app-content')?.textContent).toContain('一括抽出');
    expect(toastTexts()).toContain('パイロット抽出を推奨します');
  });

  test('タイトルクリックで #/home へ戻る', async () => {
    const stub = createWindowStub();
    await bootstrapApp(asWindow(stub));
    stub.location.hash = '#/documents';
    stub.fireHashChange();

    (document.getElementById('app-title') as HTMLButtonElement).click();
    expect(stub.location.hash).toBe('#/home');
    stub.fireHashChange();
    expect(document.getElementById('app-content')?.textContent).toContain('プロジェクト概要');
  });

  test('ストア更新でヘッダ・サイドバー・現在ルートを再描画する', async () => {
    const stub = createWindowStub();
    const store = await bootstrapApp(asWindow(stub));
    expect(store).not.toBeNull();

    store?.setState({ currentProject: { projectId: 'p9', spreadsheetId: 's9', driveFolderId: 'f9', name: '追加プロジェクト' } });
    expect(document.getElementById('app-status')?.textContent).toBe(
      'プロジェクト: 追加プロジェクト',
    );
    expect(document.getElementById('app-content')?.textContent).toContain('追加プロジェクト');
  });
});
