// メインビュー起動配線のテスト。hashchange の発火タイミングを決定的に制御するため、
// 実 window ではなくスタブ（location / addEventListener のみ実装）を注入する
import { installChromeMock, type ChromeMock } from '../../setup/chrome-mock';
import { bootstrapApp, createChromeAppDeps, seedState, type AppDeps } from '../../../src/app/bootstrap';

// bootstrap → lib/pdf/loadPdf 経由で pdfjs-dist（ESM 専用）が require されるのを防ぐ
// （loadPdf 自体の挙動は tests/unit/lib/pdf/loadPdf.test.ts で検証済み）
jest.mock('pdfjs-dist', () => ({
  GlobalWorkerOptions: { workerSrc: '' },
  getDocument: jest.fn(),
}));
// #/export の配線テストはサービス呼び出しの委譲だけを見る（実処理は exportService.test.ts）
jest.mock('../../../src/app/services/exportService', () => ({
  loadExportData: jest.fn(),
  selectExportFormat: jest.fn(),
  requestExportGenerate: jest.fn(),
  confirmExportGenerate: jest.fn(),
  cancelExportWarning: jest.fn(),
  downloadExportResult: jest.fn(),
}));
import {
  cancelExportWarning,
  confirmExportGenerate,
  downloadExportResult,
  loadExportData,
  requestExportGenerate,
  selectExportFormat,
} from '../../../src/app/services/exportService';
import type { BuiltExport } from '../../../src/features/export/buildExport';
import type { ExportFormat } from '../../../src/domain/exportLog';
import type { AppState } from '../../../src/app/store';
import { SHEET_HEADERS } from '../../../src/domain/sheetsSchema';
import { CURRENT_PROJECT_STORAGE_KEY } from '../../../src/features/project/projectStore';

interface WindowStub {
  document: Document;
  location: { hash: string };
  // hashchange を発火しない URL 正規化（syncVerifyRoute の ?doc= 書き戻し）用
  history: { replaceState: jest.Mock };
  __E2E_PRELOADED_STATE__?: Partial<AppState>;
  addEventListener: jest.Mock;
  fireHashChange(): void;
}

function createWindowStub(preloaded?: Partial<AppState>): WindowStub {
  const listeners: Record<string, EventListener[]> = {};
  const stub: WindowStub = {
    document,
    location: { hash: '' },
    // 実 history と同じく、hashchange を発火せずに location.hash だけ差し替える
    history: {
      replaceState: jest.fn((_state: unknown, _title: string, url: string) => {
        stub.location.hash = url;
      }),
    },
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

describe('createChromeAppDeps', () => {
  test('loadApiKey はプロバイダ別に secretsStore のキーを引く', async () => {
    const chromeMock = installChromeMock();
    chromeMock.storage.local.data['secrets.geminiApiKey'] = 'g-key';
    chromeMock.storage.local.data['secrets.openRouterApiKey'] = 'or-key';
    const deps = createChromeAppDeps();
    await expect(deps.loadApiKey('gemini')).resolves.toBe('g-key');
    await expect(deps.loadApiKey('openrouter')).resolves.toBe('or-key');
  });
});

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

/** 起動時の進捗カウント読込（batchGet）を発火させないための注入（読込済み扱い） */
const COUNTS_LOADED = { countsLoaded: true } as AppState['home'];

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

  test('E2E seam: counts 注入で home.countsLoaded が立つ（起動時の Sheets 読込を抑止）', async () => {
    const withCounts = await seedState(
      asWindow(createWindowStub({ counts: { documents: 4 } as AppState['counts'] })),
    );
    expect(withCounts.home.countsLoaded).toBe(true);

    const withoutCounts = await seedState(asWindow(createWindowStub({})));
    expect(withoutCounts.home.countsLoaded).toBe(false);
  });

  test('E2E seam: home スライスも部分注入でマージする（counts 併用時の明示指定が勝つ）', async () => {
    const stub = createWindowStub({
      counts: { documents: 4 } as AppState['counts'],
      home: { countsLoaded: false, countsError: '注入エラー' } as AppState['home'],
    });
    const state = await seedState(asWindow(stub));
    expect(state.home.countsLoaded).toBe(false);
    expect(state.home.countsError).toBe('注入エラー');
    expect(state.home.countsLoading).toBe(false); // 未指定フィールドは既定値
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

  test('E2E seam: dashboard スライスも部分注入でマージする', async () => {
    const stub = createWindowStub({
      dashboard: { loadError: '注入エラー' } as unknown as AppState['dashboard'],
    });
    const state = await seedState(asWindow(stub));
    expect(state.dashboard.loadError).toBe('注入エラー');
    expect(state.dashboard.loading).toBe(false); // 未指定フィールドは既定値
  });

  test('E2E seam: export スライスも部分注入でマージする', async () => {
    const stub = createWindowStub({
      export: { loadError: '注入エラー' } as unknown as AppState['export'],
    });
    const state = await seedState(asWindow(stub));
    expect(state.export.loadError).toBe('注入エラー');
    expect(state.export.format).toBe('study_wide'); // 未指定フィールドは既定値
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
    const stub = createWindowStub({ currentProject: PROJECT, home: COUNTS_LOADED });
    const { deps, fetchMock } = createFakeDeps([[...SHEET_HEADERS.Documents]]);
    await bootstrapApp(asWindow(stub), deps);

    stub.location.hash = '#/documents';
    stub.fireHashChange();
    await flush();

    expect(fetchMock).toHaveBeenCalledTimes(1); // Documents タブの values GET
    expect(document.getElementById('documents-empty')).not.toBeNull();
  });

  test('#/documents の再読み込みボタンで強制再取得する', async () => {
    const stub = createWindowStub({ currentProject: PROJECT, home: COUNTS_LOADED });
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
    const stub = createWindowStub({ currentProject: PROJECT, home: COUNTS_LOADED });
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
    const stub = createWindowStub({ currentProject: PROJECT, home: COUNTS_LOADED });
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
    const stub = createWindowStub({ currentProject: PROJECT, home: COUNTS_LOADED });
    const { deps, fetchMock } = createFakeDeps([[...SHEET_HEADERS.Protocol]]);
    await bootstrapApp(asWindow(stub), deps);

    stub.location.hash = '#/protocol';
    stub.fireHashChange();
    await flush();

    expect(fetchMock).toHaveBeenCalledTimes(1); // Protocol タブの values GET
    expect(document.getElementById('protocol-form')).not.toBeNull();
  });

  test('#/protocol の保存 → 読み取り専用 → 編集 / キャンセル / 再読み込みが配線されている', async () => {
    const stub = createWindowStub({ currentProject: PROJECT, home: COUNTS_LOADED });
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

// ---------------------------------------------------------------------------
// 進捗カウントの起動時読込（#/home + ガードの実データ化）
// ---------------------------------------------------------------------------

describe('bootstrapApp: 進捗カウントの起動時読込', () => {
  beforeEach(() => {
    installChromeMock();
    document.body.innerHTML = APP_TEMPLATE;
  });

  /** batchGet 応答（7 範囲）。failFirst = true なら 1 回目だけ HTTP 500 を返す */
  function createCountsDeps(options: { failFirst?: boolean } = {}): {
    deps: AppDeps;
    fetchMock: jest.Mock;
  } {
    const { deps, fetchMock } = createFakeDeps([]);
    let failed = false;
    fetchMock.mockImplementation(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (options.failFirst === true && !failed) {
        failed = true;
        return { ok: false, status: 500, json: async () => ({}), text: async () => 'boom' };
      }
      let json: unknown = {};
      if (url.includes('/values:batchGet')) {
        json = {
          valueRanges: [
            { values: [['doc-1'], ['doc-2']] }, // Documents
            { values: [['1']] }, // Protocol
            { values: [['1']] }, // SchemaVersions
            { values: [['pilot']] }, // ExtractionRuns run_type
            { values: [['ev-1'], ['ev-2'], ['ev-3']] }, // Evidence
            { values: [['doc-1']] }, // StudyData
            { values: [['r-1']] }, // ResultsData
          ],
        };
      }
      return { ok: true, status: 200, json: async () => json, text: async () => '' };
    });
    return { deps, fetchMock };
  }

  test('起動時に batchGet 1 回で counts を読み、サマリとガードのディム解除へ反映する', async () => {
    const stub = createWindowStub({ currentProject: PROJECT });
    const { deps, fetchMock } = createCountsDeps();
    const store = await bootstrapApp(asWindow(stub), deps);
    await flush();

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(decodeURIComponent(String(fetchMock.mock.calls[0][0]))).toContain('/values:batchGet');
    expect(store?.getState().counts).toEqual({
      documents: 2,
      protocolVersions: 1,
      schemaVersions: 1,
      pilotRuns: 1,
      evidenceRows: 3,
      dataRows: 2,
    });
    // #/home のサマリが実データで描画される
    expect(document.querySelector('.home__summary')?.textContent).toContain('文献数');
    // ガード: protocolVersions = 1 で #/schema のディムが解除される
    const schemaLink = document.querySelector('#app-nav a[href="#/schema"]') as HTMLAnchorElement;
    expect(schemaLink.getAttribute('aria-disabled')).toBeNull();
  });

  test('読込失敗は #home-counts-error + 再読み込みで force 再取得して復帰する', async () => {
    const stub = createWindowStub({ currentProject: PROJECT });
    const { deps, fetchMock } = createCountsDeps({ failFirst: true });
    const store = await bootstrapApp(asWindow(stub), deps);
    await flush();

    expect(document.getElementById('home-counts-error')?.textContent).toContain(
      '進捗を読み込めませんでした',
    );
    expect(store?.getState().home.countsLoaded).toBe(false);

    (document.getElementById('home-counts-reload') as HTMLButtonElement).click();
    await flush();
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(store?.getState().home.countsLoaded).toBe(true);
    expect(document.getElementById('home-counts-error')).toBeNull();
    expect(document.querySelector('.home__summary')).not.toBeNull();
  });

  test('E2E seam: counts 注入済み（countsLoaded）なら起動時読込を行わない', async () => {
    const stub = createWindowStub({
      currentProject: PROJECT,
      counts: { documents: 4 } as AppState['counts'],
    });
    const { deps, fetchMock } = createCountsDeps();
    await bootstrapApp(asWindow(stub), deps);
    await flush();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  test('プロジェクト未選択なら起動時読込を行わない', async () => {
    const stub = createWindowStub();
    const { deps, fetchMock } = createCountsDeps();
    await bootstrapApp(asWindow(stub), deps);
    await flush();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// #/pilot（S6）の配線
// ---------------------------------------------------------------------------

describe('bootstrapApp: #/pilot', () => {
  // パネルのモジュールキャッシュを毎回破棄する（キーボードリスナの後始末）
  afterEach(async () => {
    const { disposeVerificationPanelCache } = await import(
      '../../../src/app/views/verificationPanel'
    );
    disposeVerificationPanelCache();
  });

  const FIELD = {
    schemaVersion: 1,
    fieldId: 'f-total',
    fieldIndex: 1,
    section: 'methods',
    fieldName: 'sample_size_total',
    fieldLabel: '総サンプルサイズ',
    entityLevel: 'study' as const,
    dataType: 'integer' as const,
    unit: null,
    allowedValues: null,
    required: true,
    extractionInstruction: '総 N を抽出',
    example: null,
    aiGenerated: false,
    note: null,
  };

  const DOC_RECORD = {
    documentId: 'doc-1',
    studyLabel: 'Smith 2020',
    driveFileId: 'drive-1',
    sourceFileId: 'src-1',
    filename: 'smith2020.pdf',
    pmid: null,
    doi: null,
    textRef: 'https://drive.google.com/file/d/txt-1/view',
    textStatus: 'ok' as const,
    pageCount: 10,
    charCount: 20000,
    importedAt: '2026-07-02T00:00:00Z',
    importedBy: 'tester@example.com',
    note: null,
  };

  const SCHEMA_VERSION_ROW = {
    schemaVersion: 1,
    parentVersion: null,
    protocolVersion: 1,
    createdByType: 'user_edit' as const,
    createdAt: 't0',
    createdBy: 'tester@example.com',
    note: null,
  };

  const RUN = {
    runId: 'run-1',
    runType: 'pilot' as const,
    schemaVersion: 1,
    documentIds: ['doc-1', 'doc-x'],
    provider: 'gemini',
    requestedModel: 'gemini-test',
    modelVersion: null,
    inputMode: 'text_only' as const,
    status: 'done' as const,
    startedAt: 't1',
    finishedAt: 't2',
    tokensIn: null,
    tokensOut: null,
    costEstimate: null,
  };

  function pilotPreloaded(pilotPatch: Partial<AppState['pilot']> = {}): Partial<AppState> {
    return {
      currentProject: PROJECT,
      counts: { schemaVersions: 1, documents: 1 } as AppState['counts'],
      documents: { records: [DOC_RECORD] } as unknown as AppState['documents'],
      schema: {
        versions: [SCHEMA_VERSION_ROW],
        currentFields: [FIELD],
      } as unknown as AppState['schema'],
      pilot: pilotPatch as AppState['pilot'],
    };
  }

  test('seedState は pilot スライスも部分注入でマージする', async () => {
    const stub = createWindowStub({ pilot: { model: 'gemini-x' } as AppState['pilot'] });
    const state = await seedState(asWindow(stub));
    expect(state.pilot.model).toBe('gemini-x');
    expect(state.pilot.running).toBe(false); // 他フィールドは既定を維持
  });

  test('#/pilot 入場で既定選択が適用され、選択・モデル・実行が配線されている', async () => {
    const stub = createWindowStub(pilotPreloaded());
    const { deps } = createFakeDeps([[...SHEET_HEADERS.Documents]]);
    const store = await bootstrapApp(asWindow(stub), deps);

    stub.location.hash = '#/pilot';
    stub.fireHashChange();
    await flush();

    // 既定選択（テキスト層ありの先頭 = doc-1）
    expect(store?.getState().pilot.selectedDocumentIds).toEqual(['doc-1']);
    const checkbox = document.querySelector(
      '#pilot-documents input[type="checkbox"]',
    ) as HTMLInputElement;
    expect(checkbox.checked).toBe(true);

    // 選択解除の配線
    checkbox.checked = false;
    checkbox.dispatchEvent(new Event('change'));
    expect(store?.getState().pilot.selectedDocumentIds).toEqual([]);

    // モデル変更の配線（プルダウン → store）
    const model = document.getElementById('pilot-model') as HTMLSelectElement;
    model.value = 'gemini-2.0-flash';
    model.dispatchEvent(new Event('change'));
    expect(store?.getState().pilot.model).toBe('gemini-2.0-flash');

    // 実行の配線（API キー未設定 → インラインエラー）
    const box = document.querySelector(
      '#pilot-documents input[type="checkbox"]',
    ) as HTMLInputElement;
    box.checked = true;
    box.dispatchEvent(new Event('change'));
    (document.getElementById('pilot-run') as HTMLButtonElement).click();
    await flush();
    expect(document.getElementById('pilot-run-error')?.textContent).toContain(
      'Gemini API キーが未設定です',
    );
  });

  test('#/pilot の検証セクション（文献切替 / 再試行）が配線されている', async () => {
    const stub = createWindowStub(
      pilotPreloaded({
        selectionInitialized: true,
        selectedDocumentIds: ['doc-1'],
        model: 'gemini-test',
        run: RUN,
        runFields: [FIELD],
        evidence: [],
        // 再試行の対象（loadPilotVerification は文献未発見時に verifyDocumentId を変えない）
        verifyDocumentId: 'doc-x',
      } as Partial<AppState['pilot']>),
    );
    const { deps } = createFakeDeps([[...SHEET_HEADERS.Documents]]);
    const store = await bootstrapApp(asWindow(stub), deps);
    stub.location.hash = '#/pilot';
    stub.fireHashChange();
    await flush();

    // 文献切替: 一覧に無い ID → verifyError の配線を観測
    const select = document.getElementById('pilot-verify-doc') as HTMLSelectElement;
    select.value = 'doc-x';
    select.dispatchEvent(new Event('change'));
    await flush();
    expect(store?.getState().pilot.verifyError).toContain('doc-x が見つかりません');
    expect(document.getElementById('pilot-verify-error')?.textContent).toContain('doc-x');

    // 再試行の配線（verifyDocumentId は doc-x のまま → 再度同じエラー）
    (document.getElementById('pilot-verify-retry') as HTMLButtonElement).click();
    await flush();
    expect(store?.getState().pilot.verifyError).toContain('doc-x が見つかりません');

    // verifyDocumentId が無いときの再試行は何もしない
    const current = store?.getState();
    store?.setState({
      pilot: { ...(current as AppState).pilot, verifyDocumentId: null, verifyError: 'まだエラー' },
    });
    (document.getElementById('pilot-verify-retry') as HTMLButtonElement).click();
    await flush();
    expect(store?.getState().pilot.verifyError).toBe('まだエラー');
  });

  test('#/pilot の判定保存（onDecision）と群構成確定（onArmConfirm）が配線されている', async () => {
    const ARM_FIELD = {
      ...FIELD,
      fieldId: 'f-arm-n',
      fieldIndex: 2,
      fieldName: 'arm_n',
      fieldLabel: '群の N',
      entityLevel: 'arm' as const,
    };
    const verification = {
      document: DOC_RECORD,
      fields: [FIELD, ARM_FIELD],
      evidence: [
        {
          evidenceId: 'ev-1',
          runId: 'run-1',
          documentId: 'doc-1',
          fieldId: 'f-total',
          entityKey: '-',
          value: '120',
          notReported: false,
          quote: null,
          page: null,
          confidence: null,
          anchorStatus: null,
        },
        {
          evidenceId: 'ev-arm',
          runId: 'run-1',
          documentId: 'doc-1',
          fieldId: 'f-arm-n',
          entityKey: 'arm:1',
          value: '50',
          notReported: false,
          quote: null,
          page: null,
          confidence: null,
          anchorStatus: null,
        },
      ],
      decisions: [],
      annotator: 'tester@example.com',
      schemaVersion: 1,
      armStructure: null,
      pdf: null,
      pdfError: 'テストでは PDF なし',
      textPages: [],
    };
    const stub = createWindowStub(
      pilotPreloaded({
        selectionInitialized: true,
        selectedDocumentIds: ['doc-1'],
        model: 'gemini-test',
        run: { ...RUN, documentIds: ['doc-1'] },
        runFields: [FIELD],
        evidence: verification.evidence,
        verifyDocumentId: 'doc-1',
        verification,
      } as unknown as Partial<AppState['pilot']>),
    );
    // StudyData ヘッダを返す fake（判定保存の upsert が読む）
    const { deps, fetchMock } = createFakeDeps([
      ['document_id', 'annotator', 'annotator_type', 'schema_version', 'run_id', 'updated_at'],
    ]);
    const store = await bootstrapApp(asWindow(stub), deps);
    stub.location.hash = '#/pilot';
    stub.fireHashChange();
    await flush();

    // 埋め込み検証パネルの承認ボタン → 判定保存
    const accept = document.querySelector('.verify__action--accept') as HTMLButtonElement;
    accept.click();
    await flush();
    await flush();

    const urls = () => fetchMock.mock.calls.map((call) => decodeURIComponent(String(call[0])));
    expect(urls().some((url) => url.includes('Decisions') && url.includes(':append'))).toBe(true);
    expect(store?.getState().pilot.studyValues).toEqual({ sample_size_total: '120' });
    expect(document.querySelector('.verify__chip--accept')).not.toBeNull();

    // 群構成の確定 → ArmStructures への追記まで配線されている
    const nameInput = document.querySelector('.verify__arm-name') as HTMLInputElement;
    nameInput.value = '介入群';
    nameInput.dispatchEvent(new Event('change'));
    (document.getElementById('verify-arm-confirm') as HTMLButtonElement).click();
    await flush();
    await flush();
    expect(urls().some((url) => url.includes('ArmStructures!A1:append'))).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// #/extract（S7）の配線
// ---------------------------------------------------------------------------

describe('bootstrapApp: #/extract', () => {
  beforeEach(() => {
    installChromeMock();
    document.body.innerHTML = APP_TEMPLATE;
  });

  const FIELD = {
    schemaVersion: 1,
    fieldId: 'f-total',
    fieldIndex: 1,
    section: 'methods',
    fieldName: 'sample_size_total',
    fieldLabel: '総サンプルサイズ',
    entityLevel: 'study' as const,
    dataType: 'integer' as const,
    unit: null,
    allowedValues: null,
    required: true,
    extractionInstruction: '総 N を抽出',
    example: null,
    aiGenerated: false,
    note: null,
  };

  const DOC_RECORD = {
    documentId: 'doc-1',
    studyLabel: 'Smith 2020',
    driveFileId: 'drive-1',
    sourceFileId: 'src-1',
    filename: 'smith2020.pdf',
    pmid: null,
    doi: null,
    textRef: 'https://drive.google.com/file/d/txt-1/view',
    textStatus: 'ok' as const,
    pageCount: 10,
    charCount: 20000,
    importedAt: '2026-07-02T00:00:00Z',
    importedBy: 'tester@example.com',
    note: null,
  };

  function extractPreloaded(extractPatch: Partial<AppState['extract']> = {}): Partial<AppState> {
    return {
      currentProject: PROJECT,
      counts: { schemaVersions: 1, documents: 1, pilotRuns: 1 } as AppState['counts'],
      documents: { records: [DOC_RECORD] } as unknown as AppState['documents'],
      schema: {
        versions: [
          {
            schemaVersion: 1,
            parentVersion: null,
            protocolVersion: 1,
            createdByType: 'user_edit',
            createdAt: 't0',
            createdBy: 'tester@example.com',
            note: null,
          },
        ],
        currentFields: [FIELD],
      } as unknown as AppState['schema'],
      extract: extractPatch as AppState['extract'],
    };
  }

  test('seedState は extract スライスも部分注入でマージする', async () => {
    const stub = createWindowStub({ extract: { model: 'gemini-x' } as AppState['extract'] });
    const state = await seedState(asWindow(stub));
    expect(state.extract.model).toBe('gemini-x');
    expect(state.extract.running).toBe(false); // 他フィールドは既定を維持
  });

  test('#/extract 入場で既定選択が適用され、選択・モデル・実行確認 → 実行が配線されている', async () => {
    const stub = createWindowStub(extractPreloaded());
    const { deps, fetchMock } = createFakeDeps([[...SHEET_HEADERS.ExtractionRuns]]);
    deps.loadApiKey = async () => 'api-key';
    const store = await bootstrapApp(asWindow(stub), deps);

    stub.location.hash = '#/extract';
    stub.fireHashChange();
    await flush();

    // ExtractionRuns を読んで既定選択（未抽出の全件 = doc-1）
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(store?.getState().extract.selectedDocumentIds).toEqual(['doc-1']);

    // 選択解除 / 再選択の配線
    const checkbox = document.querySelector(
      '#extract-documents input[type="checkbox"]',
    ) as HTMLInputElement;
    checkbox.checked = false;
    checkbox.dispatchEvent(new Event('change'));
    expect(store?.getState().extract.selectedDocumentIds).toEqual([]);
    checkbox.checked = true;
    checkbox.dispatchEvent(new Event('change'));

    // モデル変更の配線（プルダウン → store）
    const model = document.getElementById('extract-model') as HTMLSelectElement;
    model.value = 'gemini-2.0-flash';
    model.dispatchEvent(new Event('change'));
    expect(store?.getState().extract.model).toBe('gemini-2.0-flash');

    // 実行 → 確認カード → キャンセルの配線
    (document.getElementById('extract-run') as HTMLButtonElement).click();
    await flush();
    expect(document.getElementById('extract-confirm')).not.toBeNull();
    (document.getElementById('extract-confirm-cancel') as HTMLButtonElement).click();
    expect(document.getElementById('extract-confirm')).toBeNull();

    // 確認 → 実行の配線（fake fetch は Protocol タブを返せない → runError 表示で観測）
    (document.getElementById('extract-run') as HTMLButtonElement).click();
    await flush();
    (document.getElementById('extract-confirm-run') as HTMLButtonElement).click();
    await flush();
    expect(store?.getState().extract.runError).not.toBeNull();
    expect(document.getElementById('extract-run-error')).not.toBeNull();
  });

  test('#/extract の再試行と再読み込みが配線されている', async () => {
    const stub = createWindowStub(
      extractPreloaded({
        selectionInitialized: true,
        selectedDocumentIds: ['doc-1'],
        model: 'gemini-test',
        extractedDocumentIds: ['doc-1'],
        run: {
          runId: 'run-1',
          runType: 'full',
          schemaVersion: 1,
          documentIds: ['doc-1'],
          provider: 'gemini',
          requestedModel: 'gemini-test',
          modelVersion: null,
          inputMode: 'text_only',
          status: 'partial_failure',
          startedAt: 't1',
          finishedAt: 't2',
          tokensIn: null,
          tokensOut: null,
          costEstimate: null,
        },
        docRows: [{ documentId: 'doc-1', status: 'failed', detail: 'api_error（500）' }],
      } as Partial<AppState['extract']>),
    );
    const { deps, fetchMock } = createFakeDeps([[...SHEET_HEADERS.ExtractionRuns]]);
    const store = await bootstrapApp(asWindow(stub), deps);
    stub.location.hash = '#/extract';
    stub.fireHashChange();
    await flush();

    // 再試行の配線（API キー未設定 → インラインエラーで観測）
    (document.querySelector('.extract__retry') as HTMLButtonElement).click();
    await flush();
    expect(store?.getState().extract.runError).toContain('Gemini API キーが未設定です');

    // 読み込み失敗 → 再読み込みの配線（documents + ExtractionRuns を強制再取得）
    const current = store?.getState() as AppState;
    store?.setState({ extract: { ...current.extract, loadError: 'boom' } });
    const callsBefore = fetchMock.mock.calls.length;
    (document.getElementById('extract-reload') as HTMLButtonElement).click();
    await flush();
    expect(fetchMock.mock.calls.length).toBeGreaterThan(callsBefore);
  });
});

// ---------------------------------------------------------------------------
// #/verify（S8）の配線
// ---------------------------------------------------------------------------

describe('bootstrapApp: #/verify・#/dashboard', () => {
  afterEach(async () => {
    const { disposeVerificationPanelCache } = await import(
      '../../../src/app/views/verificationPanel'
    );
    disposeVerificationPanelCache();
  });

  const FIELD_ROW = [
    '1',
    'f-total',
    '1',
    'methods',
    'sample_size_total',
    '総サンプルサイズ',
    'study',
    'integer',
    '',
    '',
    'TRUE',
    '総 N を抽出',
    '',
    'FALSE',
    '',
  ];
  const ARM_FIELD_ROW = [
    '1',
    'f-arm-n',
    '2',
    'outcomes',
    'arm_n',
    '群の N',
    'arm',
    'integer',
    '',
    '',
    'TRUE',
    '群別 N を抽出',
    '',
    'FALSE',
    '',
  ];
  const EVIDENCE_ROW = [
    'ev-1',
    'run-1',
    'doc-1',
    'f-total',
    '-',
    '120',
    'FALSE',
    'a total of 120',
    '1',
    'high',
    'exact',
  ];
  const RUN_ROW = [
    'run-1',
    'pilot',
    '1',
    'doc-1',
    'gemini',
    'gemini-test',
    '',
    'text_only',
    'done',
    't1',
    't2',
    '',
    '',
    '',
  ];

  const DOC_RECORD_1 = {
    documentId: 'doc-1',
    studyLabel: 'Smith 2020',
    driveFileId: 'drive-1',
    sourceFileId: 'src-1',
    filename: 'smith2020.pdf',
    pmid: null,
    doi: null,
    textRef: 'ref',
    textStatus: 'ok' as const,
    pageCount: 2,
    charCount: 1000,
    importedAt: 't0',
    importedBy: 'tester@example.com',
    note: null,
  };
  const DOC_RECORD_2 = { ...DOC_RECORD_1, documentId: 'doc-2', studyLabel: 'Jones 2021' };

  /** タブ名で values をルーティングする Sheets/Drive スタブ */
  function createVerifyFakeDeps(
    tabValues: Record<string, string[][]>,
    options: { failEvidence?: boolean; failStudyData?: boolean } = {},
  ): { deps: AppDeps; fetchMock: jest.Mock } {
    const fetchMock = jest.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = decodeURIComponent(String(input));
      const method = (init as RequestInit | undefined)?.method ?? 'GET';
      if (options.failEvidence && url.includes('/values/Evidence')) {
        return { ok: false, status: 500, json: async () => ({}), text: async () => 'boom' };
      }
      if (options.failStudyData && url.includes('/values/StudyData')) {
        return { ok: false, status: 500, json: async () => ({}), text: async () => 'boom' };
      }
      let json: unknown = {};
      if (url.includes('fields=sheets.properties.title')) {
        // 存在するタブ = Meta + tabValues のキー（ArmStructures を渡さなければ旧プロジェクト相当）
        json = {
          sheets: ['Meta', ...Object.keys(tabValues)].map((title) => ({ properties: { title } })),
        };
      } else if (method === 'GET' && url.includes('/values/')) {
        const tab = Object.keys(tabValues).find((name) => url.includes(`/values/${name}`));
        json = { values: tab === undefined ? [] : tabValues[tab] };
      }
      return { ok: true, status: 200, json: async () => json, text: async () => '' };
    });
    const { deps } = createFakeDeps([]);
    deps.google = { fetch: fetchMock as unknown as typeof fetch, getAccessToken: async () => 'token' };
    return { deps, fetchMock };
  }

  function verifyPreloaded(documents = [DOC_RECORD_1]): Partial<AppState> {
    return {
      currentProject: PROJECT,
      counts: { evidenceRows: 1 } as AppState['counts'],
      documents: { records: documents } as unknown as AppState['documents'],
    };
  }

  const BASE_TABS: Record<string, string[][]> = {
    Evidence: [[...SHEET_HEADERS.Evidence], EVIDENCE_ROW],
    ExtractionRuns: [[...SHEET_HEADERS.ExtractionRuns], RUN_ROW],
    Decisions: [[...SHEET_HEADERS.Decisions]],
    SchemaFields: [[...SHEET_HEADERS.SchemaFields], FIELD_ROW],
    StudyData: [['document_id', 'annotator', 'annotator_type', 'schema_version', 'run_id', 'updated_at']],
  };

  test('#/verify 入場で一覧を読み込み、?doc= なしは先頭文献を開く', async () => {
    const stub = createWindowStub(verifyPreloaded());
    const { deps } = createVerifyFakeDeps(BASE_TABS);
    const store = await bootstrapApp(asWindow(stub), deps);
    stub.location.hash = '#/verify';
    stub.fireHashChange();
    await flush();
    await flush();

    const select = document.getElementById('verify-doc') as HTMLSelectElement;
    expect(select.options[0]?.textContent).toBe('Smith 2020（判定済み 0 / 1）');
    expect(store?.getState().verify.selectedDocumentId).toBe('doc-1');
    // ?doc= なし入場でも既定文献を URL へ書き戻す（replaceState 経由。共有・リロード可能に）
    expect(stub.history.replaceState).toHaveBeenCalledWith(null, '', '#/verify?doc=doc-1');
    expect(stub.location.hash).toBe('#/verify?doc=doc-1');
    // PDF はスタブで開けない → pdfError 側のペインでフォームは使える
    expect(document.querySelector('.verify__panes')).not.toBeNull();
    expect(document.querySelector('.verify__pdf-error')).not.toBeNull();

    // 同じ状態での再 hashchange は再読込しない（alreadyShown）
    const decisionsReads = () =>
      (deps.google.fetch as unknown as jest.Mock).mock.calls.filter(([url]) =>
        decodeURIComponent(String(url)).includes('/values/Decisions'),
      ).length;
    const before = decisionsReads();
    stub.fireHashChange();
    await flush();
    expect(decisionsReads()).toBe(before);
  });

  test('?entity= だけの入場は既定文献を補い ?entity= を保って書き戻す', async () => {
    const stub = createWindowStub(verifyPreloaded());
    const { deps } = createVerifyFakeDeps(BASE_TABS);
    const store = await bootstrapApp(asWindow(stub), deps);
    stub.location.hash = '#/verify?entity=-';
    stub.fireHashChange();
    await flush();
    await flush();
    expect(store?.getState().verify.selectedDocumentId).toBe('doc-1');
    // doc は既定で補い、セル単位ディープリンクの entity は維持する
    expect(stub.history.replaceState).toHaveBeenCalledWith(null, '', '#/verify?doc=doc-1&entity=-');
    expect(stub.location.hash).toBe('#/verify?doc=doc-1&entity=-');
  });

  test('セレクタ切替は hash 書き換え → ?doc= の文献を開く（直リンクと同経路）', async () => {
    const stub = createWindowStub(verifyPreloaded([DOC_RECORD_1, DOC_RECORD_2]));
    const tabs = {
      ...BASE_TABS,
      Evidence: [
        [...SHEET_HEADERS.Evidence],
        EVIDENCE_ROW,
        ['ev-2', 'run-1', 'doc-2', 'f-total', '-', '99', 'FALSE', '', '', '', ''],
      ],
    };
    const { deps } = createVerifyFakeDeps(tabs);
    const store = await bootstrapApp(asWindow(stub), deps);
    stub.location.hash = '#/verify';
    stub.fireHashChange();
    await flush();
    await flush();
    expect(store?.getState().verify.selectedDocumentId).toBe('doc-1');

    const select = document.getElementById('verify-doc') as HTMLSelectElement;
    select.value = 'doc-2';
    select.dispatchEvent(new Event('change'));
    expect(stub.location.hash).toBe('#/verify?doc=doc-2');
    stub.fireHashChange();
    await flush();
    await flush();
    expect(store?.getState().verify.selectedDocumentId).toBe('doc-2');
  });

  test('?doc= が存在しない文献なら #verify-error を出し、選び直せる', async () => {
    const stub = createWindowStub(verifyPreloaded());
    const { deps } = createVerifyFakeDeps(BASE_TABS);
    const store = await bootstrapApp(asWindow(stub), deps);
    stub.location.hash = '#/verify?doc=doc-9';
    stub.fireHashChange();
    await flush();
    await flush();
    expect(store?.getState().verify.verifyError).toContain('doc-9 が見つかりません');
    expect(document.getElementById('verify-error')?.textContent).toContain('doc-9');
    expect(document.getElementById('verify-doc')).not.toBeNull();
  });

  test('一覧読み込み失敗は #verify-error + 再試行が force 再読込につながる', async () => {
    const stub = createWindowStub(verifyPreloaded());
    const { deps, fetchMock } = createVerifyFakeDeps(BASE_TABS, { failEvidence: true });
    await bootstrapApp(asWindow(stub), deps);
    stub.location.hash = '#/verify';
    stub.fireHashChange();
    await flush();
    await flush();
    expect(document.getElementById('verify-error')?.textContent).toContain(
      '検証対象を読み込めませんでした',
    );

    const callsBefore = fetchMock.mock.calls.length;
    (document.getElementById('verify-retry') as HTMLButtonElement).click();
    await flush();
    await flush();
    expect(fetchMock.mock.calls.length).toBeGreaterThan(callsBefore);
    expect(document.getElementById('verify-error')).not.toBeNull(); // 依然失敗のまま
  });

  test('検証データ読込失敗（verifyError）後の同一 hash 再発火は再読込しない', async () => {
    const stub = createWindowStub(verifyPreloaded());
    const { deps, fetchMock } = createVerifyFakeDeps(BASE_TABS, { failStudyData: true });
    const store = await bootstrapApp(asWindow(stub), deps);
    stub.location.hash = '#/verify?doc=doc-1';
    stub.fireHashChange();
    await flush();
    await flush();
    expect(store?.getState().verify.selectedDocumentId).toBe('doc-1');
    expect(store?.getState().verify.verifyError).toContain('HTTP 500');

    const callsBefore = fetchMock.mock.calls.length;
    stub.fireHashChange(); // alreadyShown（verifyError あり）→ 再読込しない
    await flush();
    expect(fetchMock.mock.calls.length).toBe(callsBefore);
  });

  test('判定と群構成確定がサービス層の書き込みまで配線されている', async () => {
    const stub = createWindowStub(verifyPreloaded());
    const tabs = {
      ...BASE_TABS,
      SchemaFields: [[...SHEET_HEADERS.SchemaFields], FIELD_ROW, ARM_FIELD_ROW],
      Evidence: [
        [...SHEET_HEADERS.Evidence],
        EVIDENCE_ROW,
        ['ev-arm', 'run-1', 'doc-1', 'f-arm-n', 'arm:1', '50', 'FALSE', '', '', '', ''],
      ],
    };
    const { deps, fetchMock } = createVerifyFakeDeps(tabs);
    await bootstrapApp(asWindow(stub), deps);
    stub.location.hash = '#/verify';
    stub.fireHashChange();
    await flush();
    await flush();

    // 群構成の確定 → ArmStructures タブ作成（旧プロジェクト）+ 追記
    const nameInput = document.querySelector('.verify__arm-name') as HTMLInputElement;
    nameInput.value = '介入群';
    nameInput.dispatchEvent(new Event('change'));
    (document.getElementById('verify-arm-confirm') as HTMLButtonElement).click();
    await flush();
    await flush();
    const urls = () => fetchMock.mock.calls.map((call) => decodeURIComponent(String(call[0])));
    expect(urls().some((url) => url.includes(':batchUpdate'))).toBe(true);
    expect(urls().some((url) => url.includes('ArmStructures!A1:append'))).toBe(true);

    // 判定（study セルの承認）→ StudyData upsert + Decisions 追記
    (document.querySelector('.verify__action--accept') as HTMLButtonElement).click();
    await flush();
    await flush();
    expect(urls().some((url) => url.includes('Decisions') && url.includes(':append'))).toBe(true);
  });

  test('?entity= ディープリンクは verify スライスへ写り、該当タブへ切替える', async () => {
    const stub = createWindowStub(verifyPreloaded());
    const tabs = {
      ...BASE_TABS,
      SchemaFields: [[...SHEET_HEADERS.SchemaFields], FIELD_ROW, ARM_FIELD_ROW],
      Evidence: [
        [...SHEET_HEADERS.Evidence],
        EVIDENCE_ROW,
        ['ev-arm', 'run-1', 'doc-1', 'f-arm-n', 'arm:1', '50', 'FALSE', '', '', '', ''],
      ],
      // 群構成は確定済み（未確定だとロック中タブへのディープリンクは無視される）
      ArmStructures: [
        [...SHEET_HEADERS.ArmStructures],
        ['doc-1', '1', 'arm:1', '介入群', 'tester@example.com', 'human_with_ai', 't0', ''],
      ],
    };
    const { deps } = createVerifyFakeDeps(tabs);
    const store = await bootstrapApp(asWindow(stub), deps);
    stub.location.hash = '#/verify?doc=doc-1&entity=arm:1';
    stub.fireHashChange();
    await flush();
    await flush();
    await flush(); // focusEntity は DOM 接続後の microtask で適用される

    expect(store?.getState().verify.deepLinkEntityKey).toBe('arm:1');
    expect(document.querySelector('.verify__tab--active')?.textContent).toBe('群（arm）');
    const focused = document.querySelector('.verify__cell--focused') as HTMLElement;
    expect(focused.querySelector('.verify__cell-label')?.textContent).toBe('群の N');
  });

  test('#/dashboard 入場で集計を読み込み、セルが ?doc=&entity= ディープリンクを持つ', async () => {
    const stub = createWindowStub(verifyPreloaded());
    const { deps, fetchMock } = createVerifyFakeDeps(BASE_TABS);
    const store = await bootstrapApp(asWindow(stub), deps);
    stub.location.hash = '#/dashboard';
    stub.fireHashChange();
    await flush();
    await flush();

    expect(store?.getState().dashboard.data?.rows).toHaveLength(1);
    expect(document.querySelector('#dashboard-summary')?.textContent).toContain('検証進捗');
    const link = document.querySelector('#dashboard-matrix a');
    expect(link?.getAttribute('href')).toBe('#/verify?doc=doc-1&entity=-');

    // 同じ状態での再 hashchange は再読込しない（読込済みガード）
    const callsBefore = fetchMock.mock.calls.length;
    stub.fireHashChange();
    await flush();
    expect(fetchMock.mock.calls.length).toBe(callsBefore);
  });

  test('#/dashboard の読み込み失敗は #dashboard-load-error + 再読み込みで force 再取得する', async () => {
    const stub = createWindowStub(verifyPreloaded());
    const { deps, fetchMock } = createVerifyFakeDeps(BASE_TABS, { failEvidence: true });
    await bootstrapApp(asWindow(stub), deps);
    stub.location.hash = '#/dashboard';
    stub.fireHashChange();
    await flush();
    await flush();
    expect(document.getElementById('dashboard-load-error')?.textContent).toContain(
      '進捗を読み込めませんでした',
    );

    const callsBefore = fetchMock.mock.calls.length;
    (document.getElementById('dashboard-reload') as HTMLButtonElement).click();
    await flush();
    await flush();
    expect(fetchMock.mock.calls.length).toBeGreaterThan(callsBefore);
    expect(document.getElementById('dashboard-load-error')).not.toBeNull(); // 依然失敗のまま
  });
});

// ---------------------------------------------------------------------------
// #/export（S10）の配線
// ---------------------------------------------------------------------------

describe('bootstrapApp: #/export', () => {
  const loadExportDataMock = loadExportData as jest.Mock;
  const selectExportFormatMock = selectExportFormat as jest.Mock;
  const requestExportGenerateMock = requestExportGenerate as jest.Mock;
  const confirmExportGenerateMock = confirmExportGenerate as jest.Mock;
  const cancelExportWarningMock = cancelExportWarning as jest.Mock;
  const downloadExportResultMock = downloadExportResult as jest.Mock;

  beforeEach(() => {
    installChromeMock();
    document.body.innerHTML = APP_TEMPLATE;
  });

  function makeBuilt(format: ExportFormat): BuiltExport {
    return {
      format,
      csv: 'csv',
      header: ['study_label'],
      previewRows: [['Smith 2020']],
      rowCount: 1,
      documentCount: 1,
      unverifiedCellCount: format === 'results_long' ? null : 0,
      skippedStudyLabels: [],
      droppedRowCount: 0,
    };
  }

  function exportPreloaded(exportPatch: Partial<AppState['export']> = {}): Partial<AppState> {
    return {
      currentProject: PROJECT,
      counts: {
        documents: 1,
        protocolVersions: 1,
        schemaVersions: 1,
        pilotRuns: 1,
        evidenceRows: 1,
        dataRows: 1, // #/export のガード（ui-flow.md §4）
      },
      export: exportPatch as AppState['export'],
    };
  }

  test('#/export 入場で素材読込を起動し、各操作をサービスへ委譲する', async () => {
    const stub = createWindowStub(
      exportPreloaded({
        built: {
          study_wide: makeBuilt('study_wide'),
          results_long: makeBuilt('results_long'),
          audit: makeBuilt('audit'),
        },
        schemaVersion: 2,
      }),
    );
    const { deps } = createFakeDeps([]);
    const store = await bootstrapApp(asWindow(stub), deps);
    stub.location.hash = '#/export';
    stub.fireHashChange();
    expect(loadExportDataMock).toHaveBeenCalledWith(store, deps);

    // 形式ラジオ切替 → selectExportFormat
    const radios = document.querySelectorAll<HTMLInputElement>('#export-format input[type=radio]');
    (radios[2] as HTMLInputElement).dispatchEvent(new Event('change'));
    expect(selectExportFormatMock).toHaveBeenCalledWith(store, 'audit');

    // 生成 → requestExportGenerate
    (document.getElementById('export-generate') as HTMLButtonElement).click();
    expect(requestExportGenerateMock).toHaveBeenCalledWith(store, deps);

    // 警告ダイアログ → confirm / cancel
    store?.setState({ export: { ...store.getState().export, confirmingWarning: true } });
    (document.getElementById('export-warning-continue') as HTMLButtonElement).click();
    expect(confirmExportGenerateMock).toHaveBeenCalledWith(store, deps);
    (document.getElementById('export-warning-cancel') as HTMLButtonElement).click();
    expect(cancelExportWarningMock).toHaveBeenCalledWith(store);

    // 結果カード → downloadExportResult
    store?.setState({
      export: {
        ...store.getState().export,
        confirmingWarning: false,
        result: {
          format: 'study_wide',
          filename: 'study_wide_20260703-090000.csv',
          fileRef: 'https://drive/file-1',
          rowCount: 1,
          exportedAt: '2026-07-03T09:00:00.000Z',
          csv: 'csv',
        },
      },
    });
    (document.getElementById('export-download') as HTMLButtonElement).click();
    expect(downloadExportResultMock).toHaveBeenCalledWith(store);
  });

  test('#/export の読み込み失敗は再読み込みで force 再取得を委譲する', async () => {
    const stub = createWindowStub(exportPreloaded({ loadError: '権限がありません' }));
    const { deps } = createFakeDeps([]);
    const store = await bootstrapApp(asWindow(stub), deps);
    stub.location.hash = '#/export';
    stub.fireHashChange();
    expect(document.getElementById('export-load-error')?.textContent).toContain(
      '権限がありません',
    );
    (document.getElementById('export-reload') as HTMLButtonElement).click();
    expect(loadExportDataMock).toHaveBeenCalledWith(store, deps, { force: true });
  });
});
