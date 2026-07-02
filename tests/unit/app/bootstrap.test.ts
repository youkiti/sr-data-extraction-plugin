// メインビュー起動配線のテスト。hashchange の発火タイミングを決定的に制御するため、
// 実 window ではなくスタブ（location / addEventListener のみ実装）を注入する
import { installChromeMock, type ChromeMock } from '../../setup/chrome-mock';
import { bootstrapApp, seedState, type AppDeps } from '../../../src/app/bootstrap';

// bootstrap → lib/pdf/loadPdf 経由で pdfjs-dist（ESM 専用）が require されるのを防ぐ
// （loadPdf 自体の挙動は tests/unit/lib/pdf/loadPdf.test.ts で検証済み）
jest.mock('pdfjs-dist', () => ({
  GlobalWorkerOptions: { workerSrc: '' },
  getDocument: jest.fn(),
}));
import type { AppState } from '../../../src/app/store';
import { SHEET_HEADERS } from '../../../src/domain/sheetsSchema';
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

const flush = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

const PROJECT = {
  projectId: 'p1',
  spreadsheetId: 'sheet-1',
  driveFolderId: 'folder-1',
  name: 'テスト SR',
};

/** Documents タブ 1 行分（SHEET_HEADERS.Documents の列順） */
const DOC_ROW = [
  'doc-1',
  'Smith 2020',
  'drive-1',
  'src-1',
  'smith2020.pdf',
  '',
  '',
  'https://drive.google.com/file/d/txt-1/view',
  'ok',
  '10',
  '20000',
  '2026-07-02T00:00:00Z',
  'tester@example.com',
  '',
];

/** Sheets API を values 応答で偽装した AppDeps（Picker / PDF は使う直前で失敗させる） */
function createFakeDeps(values: string[][]): { deps: AppDeps; fetchMock: jest.Mock } {
  const fetchMock = jest.fn(async () => ({
    ok: true,
    json: async () => ({ values }),
    text: async () => '',
  }));
  const deps: AppDeps = {
    google: {
      fetch: fetchMock as unknown as typeof fetch,
      getAccessToken: async () => 'token',
    },
    profile: {
      getProfileUserInfo: async () => ({ email: 'tester@example.com', id: 'uid' }),
    },
    picker: {
      getAccessToken: async () => {
        throw new Error('picker offline');
      },
      extensionId: 'ext',
      pickerPageUrl: 'https://example.com/picker.html',
      createTab: jest.fn(),
      removeTab: jest.fn(),
      addExternalMessageListener: jest.fn(() => () => undefined),
      addTabRemovedListener: jest.fn(() => () => undefined),
    },
    loadPdf: async () => {
      throw new Error('pdf not available in test');
    },
    extractDocxText: async () => {
      throw new Error('docx not available in test');
    },
    loadApiKey: async () => null,
    buildProvider: () => {
      throw new Error('llm not available in test');
    },
  };
  return { deps, fetchMock };
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

  test('E2E seam: documents スライスも部分注入でマージする', async () => {
    const stub = createWindowStub({
      documents: { records: [], importing: true } as unknown as AppState['documents'],
    });
    const state = await seedState(asWindow(stub));
    expect(state.documents.records).toEqual([]);
    expect(state.documents.importing).toBe(true);
    expect(state.documents.loading).toBe(false); // 未指定フィールドは既定値
  });

  test('E2E seam: protocol スライスも部分注入でマージする', async () => {
    const stub = createWindowStub({
      protocol: { records: [], editing: true } as unknown as AppState['protocol'],
    });
    const state = await seedState(asWindow(stub));
    expect(state.protocol.records).toEqual([]);
    expect(state.protocol.editing).toBe(true);
    expect(state.protocol.saving).toBe(false); // 未指定フィールドは既定値
  });

  test('E2E seam: schema スライスも部分注入でマージする', async () => {
    const stub = createWindowStub({
      schema: { versions: [], model: 'gemini-test' } as unknown as AppState['schema'],
    });
    const state = await seedState(asWindow(stub));
    expect(state.schema.versions).toEqual([]);
    expect(state.schema.model).toBe('gemini-test');
    expect(state.schema.drafting).toBe(false); // 未指定フィールドは既定値
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

  test('#/documents 入場で一覧を読み込む（0 件 → 空状態表示）', async () => {
    const stub = createWindowStub({ currentProject: PROJECT });
    const { deps, fetchMock } = createFakeDeps([[...SHEET_HEADERS.Documents]]);
    await bootstrapApp(asWindow(stub), deps);

    stub.location.hash = '#/documents';
    stub.fireHashChange();
    await flush();

    expect(fetchMock).toHaveBeenCalledTimes(1); // Documents タブの values GET
    expect(document.getElementById('documents-empty')).not.toBeNull();
  });

  test('#/documents の再読み込みボタンで強制再取得する', async () => {
    const stub = createWindowStub({ currentProject: PROJECT });
    const { deps, fetchMock } = createFakeDeps([[...SHEET_HEADERS.Documents], DOC_ROW]);
    await bootstrapApp(asWindow(stub), deps);
    stub.location.hash = '#/documents';
    stub.fireHashChange();
    await flush();
    expect(document.querySelectorAll('#documents-table tbody tr')).toHaveLength(1);

    (document.getElementById('documents-reload') as HTMLButtonElement).click();
    await flush();
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  test('#/documents の取り込みボタンは Picker 起動失敗をトーストで案内する', async () => {
    const stub = createWindowStub({ currentProject: PROJECT });
    const { deps } = createFakeDeps([[...SHEET_HEADERS.Documents]]);
    await bootstrapApp(asWindow(stub), deps);
    stub.location.hash = '#/documents';
    stub.fireHashChange();
    await flush();

    (document.getElementById('documents-import') as HTMLButtonElement).click();
    await flush();
    expect(toastTexts()).toContain('Drive Picker を開けませんでした: picker offline');
  });

  test('#/documents の study_label 編集が保存まで配線されている', async () => {
    const stub = createWindowStub({ currentProject: PROJECT });
    const { deps, fetchMock } = createFakeDeps([[...SHEET_HEADERS.Documents], DOC_ROW]);
    await bootstrapApp(asWindow(stub), deps);
    stub.location.hash = '#/documents';
    stub.fireHashChange();
    await flush();

    const input = document.querySelector('.documents__label-input') as HTMLInputElement;
    input.value = 'Smith 2020a';
    input.dispatchEvent(new Event('change'));
    await flush();

    // updateDocument = 検証用 GET + 行 PUT の 2 呼び出しが追加される
    expect(fetchMock.mock.calls.length).toBeGreaterThanOrEqual(3);
    expect(toastTexts()).toContain('study_label を保存しました');
    expect(
      (document.querySelector('.documents__label-input') as HTMLInputElement).value,
    ).toBe('Smith 2020a');
  });

  test('#/protocol 入場で全 version を読み込む（0 件 → 新規フォーム表示）', async () => {
    const stub = createWindowStub({ currentProject: PROJECT });
    const { deps, fetchMock } = createFakeDeps([[...SHEET_HEADERS.Protocol]]);
    await bootstrapApp(asWindow(stub), deps);

    stub.location.hash = '#/protocol';
    stub.fireHashChange();
    await flush();

    expect(fetchMock).toHaveBeenCalledTimes(1); // Protocol タブの values GET
    expect(document.getElementById('protocol-form')).not.toBeNull();
  });

  test('#/protocol の保存 → 読み取り専用 → 編集 / キャンセル / 再読み込みが配線されている', async () => {
    const stub = createWindowStub({ currentProject: PROJECT });
    const { deps, fetchMock } = createFakeDeps([[...SHEET_HEADERS.Protocol]]);
    await bootstrapApp(asWindow(stub), deps);
    stub.location.hash = '#/protocol';
    stub.fireHashChange();
    await flush();

    // 保存: 手入力本文 → ensureChildFolder / version 解決 / 追記 まで fake fetch で通る
    const textarea = document.getElementById('protocol-inline') as HTMLTextAreaElement;
    textarea.value = 'P: 成人肺炎';
    (document.getElementById('protocol-form') as HTMLFormElement).dispatchEvent(
      new Event('submit', { cancelable: true }),
    );
    await flush();
    expect(toastTexts()).toContain('プロトコル v1 を保存しました');
    expect(document.getElementById('protocol-readonly')).not.toBeNull();

    // 編集 → 再入力フォーム → キャンセルで読み取り専用へ戻る
    (document.getElementById('protocol-edit') as HTMLButtonElement).click();
    expect(document.getElementById('protocol-form')).not.toBeNull();
    (document.getElementById('protocol-cancel') as HTMLButtonElement).click();
    expect(document.getElementById('protocol-readonly')).not.toBeNull();

    // 再読み込み（Protocol タブは fake ではヘッダーのみ → 空フォームへ戻る）
    const callsBefore = fetchMock.mock.calls.length;
    (document.getElementById('protocol-reload') as HTMLButtonElement).click();
    await flush();
    expect(fetchMock.mock.calls.length).toBeGreaterThan(callsBefore);
    expect(document.getElementById('protocol-form')).not.toBeNull();
  });

  test('#/protocol のバージョン切替が配線されている', async () => {
    const makeProtocolSeed = (version: number): Record<string, unknown> => ({
      version,
      frameworkType: null,
      researchQuestion: '',
      inclusionCriteria: null,
      exclusionCriteria: null,
      studyDesign: null,
      blockCount: 0,
      combinationExpression: '',
      sourceType: 'manual',
      sourceFilename: null,
      rawTextRef: null,
      rawTextPreview: 'preview',
      rawTextInline: '本文',
      createdAt: `2026-07-0${version}T00:00:00Z`,
      createdBy: 'tester@example.com',
    });
    const stub = createWindowStub({
      currentProject: PROJECT,
      protocol: {
        records: [makeProtocolSeed(2), makeProtocolSeed(1)],
      } as unknown as AppState['protocol'],
    });
    await bootstrapApp(asWindow(stub));
    stub.location.hash = '#/protocol';
    stub.fireHashChange();
    await flush();

    const select = document.getElementById('protocol-version-select') as HTMLSelectElement;
    select.value = '1';
    select.dispatchEvent(new Event('change'));
    expect(document.getElementById('protocol-old-note')?.textContent).toContain('最新: v2');
  });

  const EDITOR_ROW = {
    fieldId: null,
    section: 'methods',
    fieldName: 'study_design',
    fieldLabel: '研究デザイン',
    entityLevel: 'study',
    dataType: 'text',
    unit: null,
    allowedValues: null,
    required: true,
    extractionInstruction: 'Report the design.',
    example: null,
    aiGenerated: true,
    note: null,
  };

  test('#/schema 入場で schema / documents / protocol を読み込む（版なし → ドラフトフォーム）', async () => {
    const stub = createWindowStub({
      currentProject: PROJECT,
      counts: { protocolVersions: 1 } as AppState['counts'],
    });
    const { deps, fetchMock } = createFakeDeps([[...SHEET_HEADERS.SchemaVersions]]);
    await bootstrapApp(asWindow(stub), deps);

    stub.location.hash = '#/schema';
    stub.fireHashChange();
    await flush();

    // SchemaVersions / Documents / Protocol の 3 タブを読む
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(document.getElementById('schema-draft-form')).not.toBeNull();

    // モデル入力とドラフト実行の配線（選択 0 本 → ガード文言）
    const model = document.getElementById('schema-model') as HTMLInputElement;
    model.value = 'gemini-test';
    model.dispatchEvent(new Event('change'));
    (document.getElementById('schema-draft-run') as HTMLButtonElement).click();
    await flush();
    expect(document.getElementById('schema-draft-error')?.textContent).toContain('1〜3 本選択');
  });

  test('#/schema のエディタ操作（追加 / 編集 / 削除 / プリセット / 確定 / キャンセル）が配線されている', async () => {
    const stub = createWindowStub({
      currentProject: PROJECT,
      counts: { protocolVersions: 1 } as AppState['counts'],
      schema: { versions: [], editorRows: [EDITOR_ROW] } as unknown as AppState['schema'],
    });
    const { deps } = createFakeDeps([[...SHEET_HEADERS.Protocol]]);
    await bootstrapApp(asWindow(stub), deps);
    stub.location.hash = '#/schema';
    stub.fireHashChange();
    await flush();
    expect(document.getElementById('schema-editor')).not.toBeNull();

    (document.getElementById('schema-add-row') as HTMLButtonElement).click();
    expect(document.querySelectorAll('#schema-editor-table tbody tr')).toHaveLength(2);

    const nameInput = document.querySelector(
      'input[aria-label="2 行目の field_name"]',
    ) as HTMLInputElement;
    nameInput.value = 'country';
    nameInput.dispatchEvent(new Event('change'));

    (document.querySelector('button[aria-label="2 行目を削除"]') as HTMLButtonElement).click();
    expect(document.querySelectorAll('#schema-editor-table tbody tr')).toHaveLength(1);

    (document.getElementById('schema-preset-binary') as HTMLButtonElement).click();
    expect(document.querySelectorAll('#schema-editor-table tbody tr')).toHaveLength(3);

    // 確定: fake fetch は Protocol タブがヘッダーのみ → 「プロトコルが未入力」で失敗表示
    (document.getElementById('schema-confirm') as HTMLButtonElement).click();
    await flush();
    expect(document.getElementById('schema-confirm-error')?.textContent).toContain(
      'プロトコルが未入力',
    );

    (document.getElementById('schema-editor-cancel') as HTMLButtonElement).click();
    expect(document.getElementById('schema-editor')).toBeNull();
    expect(document.getElementById('schema-draft-form')).not.toBeNull();
  });

  test('#/schema の確定済み画面（新しい版を作る / 再読み込み / サンプル選択）が配線されている', async () => {
    const stub = createWindowStub({
      currentProject: PROJECT,
      counts: { protocolVersions: 1, schemaVersions: 1 } as AppState['counts'],
      schema: {
        versions: [
          {
            schemaVersion: 1,
            parentVersion: null,
            protocolVersion: 1,
            createdByType: 'ai_draft',
            createdAt: '2026-07-02T00:00:00Z',
            createdBy: 'e2e@example.com',
            note: null,
          },
        ],
        currentFields: [],
      } as unknown as AppState['schema'],
      documents: {
        records: [
          {
            documentId: 'doc-1',
            studyLabel: 'Smith 2020',
            driveFileId: 'drive-1',
            sourceFileId: 'src-1',
            filename: 'smith2020.pdf',
            pmid: null,
            doi: null,
            textRef: 'https://drive.google.com/file/d/txt-1/view',
            textStatus: 'ok',
            pageCount: 2,
            charCount: 4000,
            importedAt: '2026-07-01T00:00:00Z',
            importedBy: 'e2e@example.com',
            note: null,
          },
        ],
      } as unknown as AppState['documents'],
    });
    const { deps, fetchMock } = createFakeDeps([[...SHEET_HEADERS.SchemaVersions]]);
    await bootstrapApp(asWindow(stub), deps);
    stub.location.hash = '#/schema';
    stub.fireHashChange();
    await flush();
    expect(document.getElementById('schema-confirmed')).not.toBeNull();

    // 新しい版を作る → エディタ → キャンセルで戻る
    (document.getElementById('schema-new-version') as HTMLButtonElement).click();
    expect(document.getElementById('schema-editor')).not.toBeNull();
    (document.getElementById('schema-editor-cancel') as HTMLButtonElement).click();

    // 再読み込み（fake はヘッダーのみ → 版なしのドラフトフォームへ）
    (document.getElementById('schema-reload') as HTMLButtonElement).click();
    await flush();
    expect(fetchMock).toHaveBeenCalled();
    expect(document.getElementById('schema-draft-form')).not.toBeNull();

    // サンプル論文の選択切替
    const checkbox = document.querySelector(
      '#schema-sample-list input[type="checkbox"]',
    ) as HTMLInputElement;
    checkbox.checked = true;
    checkbox.dispatchEvent(new Event('change'));
    expect(document.querySelector('.schema__samples legend')?.textContent).toContain(
      '1 / 3 本選択中',
    );
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
