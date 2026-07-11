// メインビュー起動配線のテスト。hashchange の発火タイミングを決定的に制御するため、
// 実 window ではなくスタブ（location / addEventListener のみ実装）を注入する
import { installChromeMock, type ChromeMock } from '../../setup/chrome-mock';
import { bootstrapApp, createChromeAppDeps, seedState, type AppDeps } from '../../../src/app/bootstrap';
import { BUILD_DATE } from '../../../src/build-info';

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
// #/adjudicate（S12）の配線テストもサービス呼び出しの委譲だけを見る（実処理は adjudicationService.test.ts）
jest.mock('../../../src/app/services/adjudicationService', () => ({
  loadAdjudicateTargets: jest.fn(),
  openAdjudicateStudy: jest.fn(),
  backToAdjudicateList: jest.fn(),
  updateAdjudicateArmDraftRow: jest.fn(),
  addAdjudicateArmDraftRow: jest.fn(),
  removeAdjudicateArmDraftRow: jest.fn(),
  confirmAdjudicateArms: jest.fn(),
  acceptAllMatchingCells: jest.fn(),
  adjudicateCellChoice: jest.fn(),
  adjudicateCellCustomValue: jest.fn(),
  adjudicateCellNotReported: jest.fn(),
  skipAdjudicateCell: jest.fn(),
  unskipAdjudicateCell: jest.fn(),
  undoAdjudicateCell: jest.fn(),
  setAdjudicateMismatchOnlyFilter: jest.fn(),
}));
import {
  acceptAllMatchingCells,
  addAdjudicateArmDraftRow,
  adjudicateCellChoice,
  adjudicateCellCustomValue,
  adjudicateCellNotReported,
  backToAdjudicateList,
  confirmAdjudicateArms,
  loadAdjudicateTargets,
  openAdjudicateStudy,
  removeAdjudicateArmDraftRow,
  setAdjudicateMismatchOnlyFilter,
  skipAdjudicateCell,
  undoAdjudicateCell,
  unskipAdjudicateCell,
  updateAdjudicateArmDraftRow,
} from '../../../src/app/services/adjudicationService';
import type { BuiltExport } from '../../../src/features/export/buildExport';
import type { ExportFormat } from '../../../src/domain/exportLog';
import { createInitialState, type AdjudicateWorking, type AppState } from '../../../src/app/store';
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
    chromeMock.storage.local.data['secrets.openAiCompatibleApiKey'] = 'custom-key';
    const deps = createChromeAppDeps();
    await expect(deps.loadApiKey('gemini')).resolves.toBe('g-key');
    await expect(deps.loadApiKey('openrouter')).resolves.toBe('or-key');
    await expect(deps.loadApiKey('openai_compatible')).resolves.toBe('custom-key');
    await expect(deps.loadLlmConnectionSettings?.()).resolves.toEqual({
      provider: null,
      openAiCompatibleEndpoint: null,
    });
  });
});

const APP_TEMPLATE = `
  <div class="app">
    <header class="app__header">
      <button id="app-title" type="button">SR データ抽出</button>
      <p id="app-status">読み込み中…</p>
      <a id="app-open-popup" href="../popup/popup.html" hidden>プロジェクト選択を開く</a>
      <a id="app-open-options" href="#/options" aria-label="設定を開く">⚙</a>
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

/** Documents タブ 1 行分（SHEET_HEADERS.Documents の列順。v0.10: study_id + document_role） */
const DOC_ROW = [
  'doc-1',
  'study-1',
  'article',
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

/** Studies タブ 1 行分（SHEET_HEADERS.Studies の列順。v0.10 新設） */
const STUDY_ROW = ['study-1', 'Smith 2020', '', '2026-07-02T00:00:00Z', 'tester@example.com', ''];

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

/** タブ名でルーティングする fetch モック（複数タブを読む画面用。GET は /values/{tab} を照合） */
function createTabRoutingDeps(tabValues: Record<string, string[][]>): {
  deps: AppDeps;
  fetchMock: jest.Mock;
} {
  const fetchMock = jest.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = decodeURIComponent(String(input));
    const method = init?.method ?? 'GET';
    let json: unknown = {};
    if (method === 'GET' && url.includes('/values/')) {
      const tab = Object.keys(tabValues).find((name) => url.includes(`/values/${name}`));
      json = { values: tab === undefined ? [] : tabValues[tab] };
    }
    return { ok: true, status: 200, json: async () => json, text: async () => '' };
  });
  const { deps } = createFakeDeps([]);
  deps.google = { fetch: fetchMock as unknown as typeof fetch, getAccessToken: async () => 'token' };
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

  test('アプリ名の下にビルド日を表示する', async () => {
    const buildDateEl = document.createElement('p');
    buildDateEl.id = 'app-build-date';
    document.querySelector('.app__header')?.appendChild(buildDateEl);
    await bootstrapApp(asWindow(createWindowStub()));
    expect(document.getElementById('app-build-date')?.textContent).toBe(`build ${BUILD_DATE}`);
  });

  test('プロジェクト未選択（状態 A）: 未選択メッセージ + プロジェクト選択ページへの同一タブ導線', async () => {
    await bootstrapApp(asWindow(createWindowStub()));
    expect(document.getElementById('app-status')?.textContent).toContain(
      'プロジェクトが選択されていません',
    );
    const openPopup = document.getElementById('app-open-popup') as HTMLAnchorElement;
    expect(openPopup.hidden).toBe(false);
    // 同一タブ遷移のアンカー（新規タブは開かない）
    expect(openPopup.getAttribute('href')).toBe('../popup/popup.html');
  });

  test('プロジェクト選択済み: ヘッダのプロジェクト名がプロジェクト選択ページへのリンクになり、未選択導線は隠す', async () => {
    await bootstrapApp(
      asWindow(createWindowStub({ currentProject: { projectId: 'p1', spreadsheetId: 's1', driveFolderId: 'f1', name: '肺炎 SR' } })),
    );
    expect(document.getElementById('app-status')?.textContent).toBe('プロジェクト: 肺炎 SR');
    // プロジェクト名自体が同一タブ遷移のアンカー
    const statusLink = document.querySelector('#app-status a') as HTMLAnchorElement;
    expect(statusLink.getAttribute('href')).toBe('../popup/popup.html');
    expect(statusLink.title).toBe('別のプロジェクトを開く');
    expect((document.getElementById('app-open-popup') as HTMLAnchorElement).hidden).toBe(true);
  });

  test('初期表示は #/home（サイドバー 10 項目 + aria-current + スクリーンリーダ通知）', async () => {
    await bootstrapApp(asWindow(createWindowStub()));
    expect(document.getElementById('app-content')?.textContent).toContain('プロジェクト概要');
    expect(document.getElementById('app-context')?.textContent).toBe('Home 画面を表示しています');
    const links = document.querySelectorAll('#app-nav a');
    expect(links).toHaveLength(10);
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

  test('設定ルート #/options はサイドバー外だがアプリ内（同一タブ）で表示できる', async () => {
    const stub = createWindowStub();
    await bootstrapApp(asWindow(stub));
    stub.location.hash = '#/options';
    stub.fireHashChange();
    // 設定画面がコンテンツ領域に組み上がる（別ページ・別タブへ飛ばさない）
    expect(document.getElementById('app-content')?.querySelector('#gemini-api-key')).not.toBeNull();
    expect(document.getElementById('app-context')?.textContent).toBe('設定 画面を表示しています');
    // ステップナビは 10 項目のまま（設定はナビに出さない）
    expect(document.querySelectorAll('#app-nav a')).toHaveLength(10);
    // 戻る導線は #/home へのハッシュリンク（直前ルートの記録が無いため）
    expect(
      document.querySelector('#app-content .settings__back')?.getAttribute('href'),
    ).toBe('#/home');
    // 「アプリを開く」はスタンドアロン options.html 専用の導線（アプリ内には出さない）
    expect(document.getElementById('options-open-app')).toBeNull();
  });

  test('#/options への遷移は直前ルートを記録し、戻る導線がそこへ向く（B. 設定画面の「戻る」改善）', async () => {
    const stub = createWindowStub();
    await bootstrapApp(asWindow(stub));
    // #/home → #/documents → #/options と遷移すると、記録されるのは直前の #/documents
    stub.location.hash = '#/documents';
    stub.fireHashChange();
    stub.location.hash = '#/options';
    stub.fireHashChange();
    expect(
      document.querySelector('#app-content .settings__back')?.getAttribute('href'),
    ).toBe('#/documents');
    expect(document.querySelector('#app-content .settings__back')?.textContent).toBe(
      '← 前の画面へ戻る',
    );

    // #/options 表示中の再描画（別スライスの更新）では記録が上書きされない
    stub.fireHashChange();
    expect(
      document.querySelector('#app-content .settings__back')?.getAttribute('href'),
    ).toBe('#/documents');
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
    const { deps, fetchMock } = createTabRoutingDeps({
      Documents: [[...SHEET_HEADERS.Documents]],
      Studies: [[...SHEET_HEADERS.Studies]],
      ExtractionRuns: [[...SHEET_HEADERS.ExtractionRuns]],
    });
    await bootstrapApp(asWindow(stub), deps);

    stub.location.hash = '#/documents';
    stub.fireHashChange();
    await flush();

    // loadDocuments は Documents / Studies / ExtractionRuns を読む（v0.10）
    expect(fetchMock).toHaveBeenCalled();
    expect(document.getElementById('documents-empty')).not.toBeNull();
  });

  test('#/documents の再読み込みボタンで強制再取得する', async () => {
    const stub = createWindowStub({ currentProject: PROJECT, home: COUNTS_LOADED });
    const tabs = {
      Documents: [[...SHEET_HEADERS.Documents], DOC_ROW],
      Studies: [[...SHEET_HEADERS.Studies], STUDY_ROW],
      ExtractionRuns: [[...SHEET_HEADERS.ExtractionRuns]],
    };
    const { deps, fetchMock } = createTabRoutingDeps(tabs);
    await bootstrapApp(asWindow(stub), deps);
    stub.location.hash = '#/documents';
    stub.fireHashChange();
    await flush();
    expect(document.querySelectorAll('.documents__study-group')).toHaveLength(1);

    const before = fetchMock.mock.calls.length;
    (document.getElementById('documents-reload') as HTMLButtonElement).click();
    await flush();
    expect(fetchMock.mock.calls.length).toBeGreaterThan(before);
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

  test('#/documents のローカルファイル入力は importFromFiles へ配線されている（非 PDF 除外のトースト経路）', async () => {
    const stub = createWindowStub({ currentProject: PROJECT, home: COUNTS_LOADED });
    const { deps } = createFakeDeps([[...SHEET_HEADERS.Documents]]);
    await bootstrapApp(asWindow(stub), deps);
    stub.location.hash = '#/documents';
    stub.fireHashChange();
    await flush();

    const input = document.getElementById('documents-file-input') as HTMLInputElement;
    const file = new File(['x'], 'notes.txt', { type: 'text/plain' });
    Object.defineProperty(input, 'files', { value: [file], configurable: true });
    input.dispatchEvent(new Event('change'));
    await flush();
    expect(toastTexts()).toContain('PDF ファイルが選択されていません');
  });

  test('#/documents の study_label 編集が保存まで配線されている', async () => {
    const stub = createWindowStub({ currentProject: PROJECT, home: COUNTS_LOADED });
    const { deps, fetchMock } = createTabRoutingDeps({
      Documents: [[...SHEET_HEADERS.Documents], DOC_ROW],
      Studies: [[...SHEET_HEADERS.Studies], STUDY_ROW],
      ExtractionRuns: [[...SHEET_HEADERS.ExtractionRuns]],
    });
    await bootstrapApp(asWindow(stub), deps);
    stub.location.hash = '#/documents';
    stub.fireHashChange();
    await flush();

    const before = fetchMock.mock.calls.length;
    const input = document.querySelector('.documents__label-input') as HTMLInputElement;
    input.value = 'Smith 2020a';
    input.dispatchEvent(new Event('change'));
    await flush();

    // updateStudy = 検証用 Studies GET + 行 PUT の 2 呼び出しが追加される（Studies 行の上書き）
    expect(fetchMock.mock.calls.length).toBeGreaterThan(before);
    expect(toastTexts()).toContain('study_label を保存しました');
    expect(
      (document.querySelector('.documents__label-input') as HTMLInputElement).value,
    ).toBe('Smith 2020a');
  });

  test('#/documents のグルーピング操作（role / registration / 統合 / 候補）が配線されている', async () => {
    const study1 = { studyId: 'study-1', studyLabel: 'Smith 2020', registrationId: 'NCT01234567', createdAt: 't', createdBy: 'e', note: null };
    const study2 = { studyId: 'study-2', studyLabel: 'Jones 2021', registrationId: 'NCT01234567', createdAt: 't', createdBy: 'e', note: null };
    const doc1 = { documentId: 'doc-1', studyId: 'study-1', documentRole: 'article' as const, driveFileId: 'd1', sourceFileId: 's1', filename: 'a.pdf', pmid: null, doi: null, textRef: 't1', textStatus: 'ok' as const, pageCount: 1, charCount: 1, importedAt: 't', importedBy: 'e', note: null };
    const doc2 = { ...doc1, documentId: 'doc-2', studyId: 'study-2', filename: 'b.pdf' };
    const stub = createWindowStub({
      currentProject: PROJECT,
      home: COUNTS_LOADED,
      documents: {
        records: [doc1, doc2],
        studies: [study1, study2],
        extractedStudyIds: [],
        ignoredCandidateKeys: [],
        loading: false,
        loadError: null,
        importing: false,
        importRows: [],
        selectedStudyIds: [],
        mergeDialog: null,
        merging: false,
        mergeError: null,
      },
    } as unknown as Partial<AppState>);
    const DOC_ROW_2 = ['doc-2', 'study-2', 'article', 'd2', 's2', 'b.pdf', '', '', 't2', 'ok', '1', '1', 't', 'e', ''];
    const STUDY_ROW_2 = ['study-2', 'Jones 2021', 'NCT01234567', 't', 'e', ''];
    const { deps } = createTabRoutingDeps({
      Documents: [[...SHEET_HEADERS.Documents], DOC_ROW, DOC_ROW_2],
      Studies: [[...SHEET_HEADERS.Studies], STUDY_ROW, STUDY_ROW_2],
      ExtractionRuns: [[...SHEET_HEADERS.ExtractionRuns]],
    });
    const store = await bootstrapApp(asWindow(stub), deps);
    stub.location.hash = '#/documents';
    stub.fireHashChange();
    await flush();

    // 候補バナー → 統合ダイアログ（onOpenMergeCandidate）→ label / registration 入力 → キャンセル
    (document.querySelector('.documents__candidate-merge') as HTMLButtonElement).click();
    await flush();
    expect(document.getElementById('merge-dialog')).not.toBeNull();
    const label = document.getElementById('merge-label') as HTMLInputElement;
    label.value = '統合ラベル';
    label.dispatchEvent(new Event('input'));
    const reg = document.getElementById('merge-registration') as HTMLInputElement;
    reg.value = 'NCT01234567';
    reg.dispatchEvent(new Event('input'));
    (document.getElementById('merge-cancel') as HTMLButtonElement).click();
    await flush();
    expect(store?.getState().documents.mergeDialog).toBeNull();

    // 候補の無視（onIgnoreCandidate）→ バナーが消える
    (document.querySelector('.documents__candidate-ignore') as HTMLButtonElement).click();
    await flush();
    expect(store?.getState().documents.ignoredCandidateKeys).toEqual(['study-1|study-2']);
    expect(document.querySelector('.documents__candidate')).toBeNull();

    // document_role 変更（onSaveDocumentRole）
    const roleSelect = document.querySelector('.documents__role-select') as HTMLSelectElement;
    roleSelect.value = 'registration';
    roleSelect.dispatchEvent(new Event('change'));
    await flush();

    // registration_id 編集（onSaveRegistrationId）
    const regInput = document.querySelector('.documents__registration-input') as HTMLInputElement;
    regInput.value = 'ISRCTN12345678';
    regInput.dispatchEvent(new Event('change'));
    await flush();

    // study を 2 件選択（onToggleStudySelection）→ 統合ボタン（onOpenMerge）→ 確定（onConfirmMerge）。
    // setState ごとに再描画されるためチェックボックスは毎回引き直す
    (document.querySelectorAll('.documents__study-check')[0] as HTMLInputElement).click();
    (document.querySelectorAll('.documents__study-check')[1] as HTMLInputElement).click();
    await flush();
    expect(store?.getState().documents.selectedStudyIds).toEqual(['study-1', 'study-2']);
    (document.getElementById('documents-merge') as HTMLButtonElement).click();
    await flush();
    expect(document.getElementById('merge-dialog')).not.toBeNull();
    (document.getElementById('merge-confirm') as HTMLButtonElement).click();
    await flush();
    await flush();
    // 統合が走り、ダイアログは閉じる
    expect(store?.getState().documents.mergeDialog).toBeNull();
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
            studyId: 'study-1',
            documentRole: 'article',
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

    // 盲検のフェイルクローズにより「プロジェクトあり + ロール未解決」はブロック画面になるため、
    // プロジェクトとロール（解決済み owner）を同時に注入して再描画の配線を確認する
    const current = store?.getState();
    store?.setState({
      currentProject: { projectId: 'p9', spreadsheetId: 's9', driveFolderId: 'f9', name: '追加プロジェクト' },
      role: { ...(current as AppState).role, role: 'owner' },
    });
    expect(document.getElementById('app-status')?.textContent).toBe(
      'プロジェクト: 追加プロジェクト',
    );
    expect(document.getElementById('app-content')?.textContent).toContain('追加プロジェクト');
  });

  test('プロジェクトが選択されたのにロール未解決の間はブロック画面になる（盲検のフェイルクローズ）', async () => {
    const stub = createWindowStub();
    const store = await bootstrapApp(asWindow(stub));

    // ロールを注入せずにプロジェクトだけを与える → 確認中プレースホルダ + ナビ非表示
    store?.setState({ currentProject: PROJECT });
    expect(document.getElementById('app-role-resolving')).not.toBeNull();
    expect(document.querySelectorAll('#app-nav a')).toHaveLength(0);
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
            // ExtractionRuns run_type〜status（完了行のみ pilot に数える）
            { values: [['pilot', '1', 'doc-1', 'gemini', 'gemini-test', '', 'text_only', 'done']] },
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
    studyId: 'study-1',
    documentRole: 'article' as const,
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

  const STUDY_RECORD = {
    studyId: 'study-1',
    studyLabel: 'Smith 2020',
    registrationId: null,
    createdAt: 't0',
    createdBy: 'tester@example.com',
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
    studyIds: ['study-1', 'study-x'],
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
      documents: {
        records: [DOC_RECORD],
        studies: [STUDY_RECORD],
      } as unknown as AppState['documents'],
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

    // 既定選択（テキスト層ありの先頭 = study-1）
    expect(store?.getState().pilot.selectedStudyIds).toEqual(['study-1']);
    const checkbox = document.querySelector(
      '#pilot-documents input[type="checkbox"]',
    ) as HTMLInputElement;
    expect(checkbox.checked).toBe(true);

    // 選択解除の配線
    checkbox.checked = false;
    checkbox.dispatchEvent(new Event('change'));
    expect(store?.getState().pilot.selectedStudyIds).toEqual([]);

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

  test('#/pilot の検証セクション（study 切替セレクタ / 再試行）が配線されている', async () => {
    const stub = createWindowStub(
      pilotPreloaded({
        selectionInitialized: true,
        selectedStudyIds: ['study-1'],
        model: 'gemini-test',
        // run は study 単位（studyIds）。study 切替セレクタは studies を study_id で引く（v0.10）
        run: { ...RUN, studyIds: ['study-1', 'study-x'] },
        runFields: [FIELD],
        evidence: [],
        // 一覧に無い study の読込失敗を残した状態（再試行の対象）。loadPilotVerification は
        // study 未発見時に verifyStudyId を変えない
        verifyStudyId: 'study-x',
        verifyError: 'study study-x が見つかりません',
      } as Partial<AppState['pilot']>),
    );
    const { deps } = createFakeDeps([[...SHEET_HEADERS.Documents]]);
    const store = await bootstrapApp(asWindow(stub), deps);
    stub.location.hash = '#/pilot';
    stub.fireHashChange();
    await flush();

    // study 切替セレクタは run の study を study_label 表示で並べる
    const select = document.getElementById('pilot-verify-study') as HTMLSelectElement;
    expect(select.options.length).toBe(1);
    expect(select.options[0]?.textContent).toBe('Smith 2020');
    expect(select.options[0]?.value).toBe('study-1');
    // 読込失敗の表示
    expect(document.getElementById('pilot-verify-error')?.textContent).toContain('study-x');

    // 再試行の配線（verifyStudyId は study-x のまま → 一覧に無く再度同じエラー）
    (document.getElementById('pilot-verify-retry') as HTMLButtonElement).click();
    await flush();
    expect(store?.getState().pilot.verifyError).toContain('study-x が見つかりません');

    // verifyStudyId が無いときの再試行は何もしない
    const current = store?.getState();
    store?.setState({
      pilot: { ...(current as AppState).pilot, verifyStudyId: null, verifyError: 'まだエラー' },
    });
    (document.getElementById('pilot-verify-retry') as HTMLButtonElement).click();
    await flush();
    expect(store?.getState().pilot.verifyError).toBe('まだエラー');

    // セレクタで実在 study へ切替（onSelectVerifyStudy）→ loadPilotVerification 起動
    const freshSelect = document.getElementById('pilot-verify-study') as HTMLSelectElement;
    freshSelect.value = 'study-1';
    freshSelect.dispatchEvent(new Event('change'));
    await flush();
    expect(store?.getState().pilot.verifyStudyId).toBe('study-1');
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
    const OUTCOME_FIELD = {
      ...FIELD,
      fieldId: 'f-out-event',
      fieldIndex: 3,
      section: 'outcomes',
      fieldName: 'event_count',
      fieldLabel: 'イベント数',
      entityLevel: 'outcome_result' as const,
    };
    const verification = {
      study: STUDY_RECORD,
      documents: [{ document: DOC_RECORD, extractedPages: [], extractedTextError: null }],
      loadPdfView: async () => ({ pdf: null, pdfError: 'テストでは PDF なし', textPages: [] }),
      retryPdfView: async () => ({ pdf: null, pdfError: 'テストでは PDF なし', textPages: [] }),
      fields: [FIELD, ARM_FIELD, OUTCOME_FIELD],
      evidence: [
        {
          evidenceId: 'ev-1',
          runId: 'run-1',
          studyId: 'study-1',
          documentId: 'doc-1',
          fieldId: 'f-total',
          entityKey: '-',
          value: '120',
          notReported: false,
          quote: null,
          page: null,
          confidence: null,
          anchorStatus: null,
          bboxPage: null,
          bbox: null,
        },
        {
          evidenceId: 'ev-arm',
          runId: 'run-1',
          studyId: 'study-1',
          documentId: 'doc-1',
          fieldId: 'f-arm-n',
          entityKey: 'arm:1',
          value: '50',
          notReported: false,
          quote: null,
          page: null,
          confidence: null,
          anchorStatus: null,
          bboxPage: null,
          bbox: null,
        },
      ],
      decisions: [],
      annotator: 'tester@example.com',
      schemaVersion: 1,
      armStructure: null,
    };
    const stub = createWindowStub(
      pilotPreloaded({
        selectionInitialized: true,
        selectedStudyIds: ['study-1'],
        model: 'gemini-test',
        run: { ...RUN, studyIds: ['study-1'] },
        runFields: [FIELD],
        evidence: verification.evidence,
        verifyStudyId: 'study-1',
        verification,
      } as unknown as Partial<AppState['pilot']>),
    );
    // StudyData ヘッダを返す fake（判定保存の upsert が読む。v0.10: 先頭列は study_id）
    const { deps, fetchMock } = createFakeDeps([
      ['study_id', 'annotator', 'annotator_type', 'schema_version', 'run_id', 'updated_at'],
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

    // アウトカム追加 → 予約 Decision の追記まで配線されている
    const decisionAppendCount = () =>
      urls().filter((url) => url.includes('Decisions') && url.includes(':append')).length;
    const beforeOutcomeAdd = decisionAppendCount();
    const outcomeTab = [...document.querySelectorAll<HTMLButtonElement>('.verify__tab')].find(
      (button) => button.textContent === 'アウトカム',
    );
    expect(outcomeTab).toBeDefined();
    outcomeTab!.click();
    (document.getElementById('verify-outcome-add-button') as HTMLButtonElement).click();
    await flush();
    await flush();
    expect(decisionAppendCount()).toBeGreaterThan(beforeOutcomeAdd);
  });

  test('#/pilot のレイアウトモードトグルが onChangeLayoutMode（setPilotLayoutMode）に配線されている', async () => {
    const verification = {
      study: STUDY_RECORD,
      documents: [{ document: DOC_RECORD, extractedPages: [], extractedTextError: null }],
      loadPdfView: async () => ({ pdf: null, pdfError: 'テストでは PDF なし', textPages: [] }),
      retryPdfView: async () => ({ pdf: null, pdfError: 'テストでは PDF なし', textPages: [] }),
      fields: [FIELD],
      evidence: [],
      decisions: [],
      annotator: 'tester@example.com',
      schemaVersion: 1,
      armStructure: null,
    };
    const stub = createWindowStub(
      pilotPreloaded({
        selectionInitialized: true,
        selectedStudyIds: ['study-1'],
        model: 'gemini-test',
        run: { ...RUN, studyIds: ['study-1'] },
        runFields: [FIELD],
        evidence: [],
        verifyStudyId: 'study-1',
        verification,
      } as unknown as Partial<AppState['pilot']>),
    );
    const { deps } = createFakeDeps([[...SHEET_HEADERS.Documents]]);
    const store = await bootstrapApp(asWindow(stub), deps);
    stub.location.hash = '#/pilot';
    stub.fireHashChange();
    await flush();

    const toggle = document.getElementById('verify-layout-toggle') as HTMLButtonElement;
    expect(toggle.textContent).toBe('リスト表示に切替'); // 既定 focus
    toggle.click();
    await flush();
    expect(store?.getState().pilot.layoutMode).toBe('list');
  });

  test('#/pilot の保存競合検出バナー（issue #64）の「再読み込み」は埋め込み検証を読み直す', async () => {
    const verification = {
      study: STUDY_RECORD,
      documents: [{ document: DOC_RECORD, extractedPages: [], extractedTextError: null }],
      loadPdfView: async () => ({ pdf: null, pdfError: 'テストでは PDF なし', textPages: [] }),
      retryPdfView: async () => ({ pdf: null, pdfError: 'テストでは PDF なし', textPages: [] }),
      fields: [FIELD],
      evidence: [],
      decisions: [],
      annotator: 'tester@example.com',
      schemaVersion: 1,
      armStructure: null,
    };
    const stub = createWindowStub(
      pilotPreloaded({
        selectionInitialized: true,
        selectedStudyIds: ['study-1'],
        model: 'gemini-test',
        run: { ...RUN, studyIds: ['study-1'] },
        runFields: [FIELD],
        evidence: [],
        verifyStudyId: 'study-1',
        verification,
        conflictMessage: '読み込み後に別の場所で更新されています。再読み込みしてから判定し直してください',
      } as unknown as Partial<AppState['pilot']>),
    );
    const { deps, fetchMock } = createFakeDeps([[...SHEET_HEADERS.Documents]]);
    await bootstrapApp(asWindow(stub), deps);
    stub.location.hash = '#/pilot';
    stub.fireHashChange();
    await flush();

    expect(document.getElementById('verify-conflict-warning')?.textContent).toContain(
      '読み込み後に別の場所で更新されています',
    );
    const callsBefore = fetchMock.mock.calls.length;
    (document.getElementById('verify-conflict-reload') as HTMLButtonElement).click();
    await flush();
    await flush();
    // onReloadVerification → loadPilotVerification が再度データ束を読みに行く
    expect(fetchMock.mock.calls.length).toBeGreaterThan(callsBefore);
  });

  test('#/pilot の保存競合検出バナーの「再読み込み」は verifyStudyId が無ければ何もしない', async () => {
    const verification = {
      study: STUDY_RECORD,
      documents: [{ document: DOC_RECORD, extractedPages: [], extractedTextError: null }],
      loadPdfView: async () => ({ pdf: null, pdfError: 'テストでは PDF なし', textPages: [] }),
      retryPdfView: async () => ({ pdf: null, pdfError: 'テストでは PDF なし', textPages: [] }),
      fields: [FIELD],
      evidence: [],
      decisions: [],
      annotator: 'tester@example.com',
      schemaVersion: 1,
      armStructure: null,
    };
    const stub = createWindowStub(
      pilotPreloaded({
        selectionInitialized: true,
        selectedStudyIds: ['study-1'],
        model: 'gemini-test',
        run: { ...RUN, studyIds: ['study-1'] },
        runFields: [FIELD],
        evidence: [],
        verifyStudyId: null,
        verification,
        conflictMessage: '読み込み後に別の場所で更新されています。再読み込みしてから判定し直してください',
      } as unknown as Partial<AppState['pilot']>),
    );
    const { deps, fetchMock } = createFakeDeps([[...SHEET_HEADERS.Documents]]);
    await bootstrapApp(asWindow(stub), deps);
    stub.location.hash = '#/pilot';
    stub.fireHashChange();
    await flush();

    const callsBefore = fetchMock.mock.calls.length;
    (document.getElementById('verify-conflict-reload') as HTMLButtonElement).click();
    await flush();
    expect(fetchMock.mock.calls.length).toBe(callsBefore);
  });

  test('#/pilot 入場で履歴の最新 run を自動読込する（既存データを最初からにしない）', async () => {
    const historyRun = { ...RUN, runId: 'run-hist', studyIds: [] };
    const stub = createWindowStub(
      pilotPreloaded({
        selectionInitialized: true,
        selectedStudyIds: ['study-1'],
        model: 'gemini-test',
        history: [historyRun],
        historyInitialized: false,
        run: null,
      } as unknown as Partial<AppState['pilot']>),
    );
    // Evidence ヘッダを返す fake（自動読込は Evidence + SchemaFields を読む）
    const { deps } = createFakeDeps([[...SHEET_HEADERS.Evidence]]);
    const store = await bootstrapApp(asWindow(stub), deps);
    stub.location.hash = '#/pilot';
    stub.fireHashChange();
    await flush();
    await flush();
    await flush();
    expect(store?.getState().pilot.run?.runId).toBe('run-hist');
    expect(store?.getState().pilot.historyInitialized).toBe(true);
  });

  test('#/pilot の履歴項目クリックで過去 run を読み込む（onSelectRun）', async () => {
    const historyRun = { ...RUN, runId: 'run-hist', studyIds: [] };
    const stub = createWindowStub(
      pilotPreloaded({
        selectionInitialized: true,
        selectedStudyIds: ['study-1'],
        model: 'gemini-test',
        history: [historyRun],
        historyInitialized: true, // 自動読込は抑止し、クリック経路のみ観測する
        run: null,
      } as unknown as Partial<AppState['pilot']>),
    );
    const { deps } = createFakeDeps([[...SHEET_HEADERS.Evidence]]);
    const store = await bootstrapApp(asWindow(stub), deps);
    stub.location.hash = '#/pilot';
    stub.fireHashChange();
    await flush();
    (document.querySelector('.pilot__history-open') as HTMLButtonElement).click();
    await flush();
    await flush();
    expect(store?.getState().pilot.run?.runId).toBe('run-hist');
  });

  test('#/pilot の履歴読み込み失敗 → 再読み込みの配線（onReloadHistory）', async () => {
    const stub = createWindowStub(
      pilotPreloaded({
        selectionInitialized: true,
        selectedStudyIds: ['study-1'],
        model: 'gemini-test',
        history: [],
        historyInitialized: true,
        historyError: 'boom',
      } as unknown as Partial<AppState['pilot']>),
    );
    // ExtractionRuns ヘッダを返す fake（再読み込みは readPilotRuns が読む）
    const { deps } = createFakeDeps([[...SHEET_HEADERS.ExtractionRuns]]);
    const store = await bootstrapApp(asWindow(stub), deps);
    stub.location.hash = '#/pilot';
    stub.fireHashChange();
    await flush();
    expect(document.getElementById('pilot-history-error')?.textContent).toContain('boom');
    (document.getElementById('pilot-history-reload') as HTMLButtonElement).click();
    await flush();
    await flush();
    expect(store?.getState().pilot.historyError).toBeNull();
    expect(store?.getState().pilot.history).toEqual([]);
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
    studyId: 'study-1',
    documentRole: 'article' as const,
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

  const STUDY_RECORD = {
    studyId: 'study-1',
    studyLabel: 'Smith 2020',
    registrationId: null,
    createdAt: 't0',
    createdBy: 'tester@example.com',
    note: null,
  };

  function extractPreloaded(extractPatch: Partial<AppState['extract']> = {}): Partial<AppState> {
    return {
      currentProject: PROJECT,
      counts: { schemaVersions: 1, documents: 1, pilotRuns: 1 } as AppState['counts'],
      documents: {
        records: [DOC_RECORD],
        studies: [STUDY_RECORD],
      } as unknown as AppState['documents'],
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

    // ExtractionRuns を読んで既定選択（未抽出の全 study = study-1）
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(store?.getState().extract.selectedStudyIds).toEqual(['study-1']);

    // 選択解除 / 再選択の配線
    const checkbox = document.querySelector(
      '#extract-studies input[type="checkbox"]',
    ) as HTMLInputElement;
    checkbox.checked = false;
    checkbox.dispatchEvent(new Event('change'));
    expect(store?.getState().extract.selectedStudyIds).toEqual([]);
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
        selectedStudyIds: ['study-1'],
        model: 'gemini-test',
        extractedStudyIds: ['study-1'],
        run: {
          runId: 'run-1',
          runType: 'full',
          schemaVersion: 1,
          studyIds: ['study-1'],
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
        studyRows: [
          {
            studyId: 'study-1',
            status: 'failed',
            completedBatches: 1,
            totalBatches: 1,
            detail: 'api_error（500）',
          },
        ],
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
  const OUTCOME_FIELD_ROW = [
    '1',
    'f-out-event',
    '3',
    'outcomes',
    'event_count',
    'イベント数',
    'outcome_result',
    'integer',
    '',
    '',
    'TRUE',
    'イベント数を抽出',
    '',
    'FALSE',
    '',
  ];
  const EVIDENCE_ROW = [
    'ev-1',
    'run-1',
    'study-1',
    'f-total',
    'doc-1',
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
    'study-1',
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
    studyId: 'study-1',
    documentRole: 'article' as const,
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
  const DOC_RECORD_2 = { ...DOC_RECORD_1, documentId: 'doc-2', studyId: 'study-2' };

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
    StudyData: [['study_id', 'annotator', 'annotator_type', 'schema_version', 'run_id', 'updated_at']],
    // 楽観ロックの期待値取得（issue #64）のため loadVerificationBundle が ResultsData も読む
    ResultsData: [[...SHEET_HEADERS.ResultsData]],
    Studies: [[...SHEET_HEADERS.Studies], STUDY_ROW],
  };

  test('#/verify 入場で一覧を読み込み、?study= なしは先頭 study を開く', async () => {
    const stub = createWindowStub(verifyPreloaded());
    const { deps } = createVerifyFakeDeps(BASE_TABS);
    const store = await bootstrapApp(asWindow(stub), deps);
    stub.location.hash = '#/verify';
    stub.fireHashChange();
    await flush();
    await flush();

    const select = document.getElementById('verify-study') as HTMLSelectElement;
    expect(select.options[0]?.textContent).toBe('Smith 2020（判定済み 0 / 1）');
    expect(store?.getState().verify.selectedStudyId).toBe('study-1');
    // ?study= なし入場でも既定 study を URL へ書き戻す（replaceState 経由。共有・リロード可能に）
    expect(stub.history.replaceState).toHaveBeenCalledWith(null, '', '#/verify?study=study-1');
    expect(stub.location.hash).toBe('#/verify?study=study-1');
    // PDF はスタブで開けない → pdfError 側のペインでフォームは使える
    expect(document.querySelector('.verify__panes')).not.toBeNull();
    expect(document.querySelector('.verify__pdf-error')).not.toBeNull();

    // レイアウトモードトグルが onChangeLayoutMode（setVerifyLayoutMode）に配線されている（issue #38）
    const toggle = document.getElementById('verify-layout-toggle') as HTMLButtonElement;
    expect(toggle.textContent).toBe('リスト表示に切替'); // 既定 focus
    toggle.click();
    await flush();
    expect(store?.getState().verify.layoutMode).toBe('list');

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

  test('保存の競合検出バナー（issue #64）の「再読み込み」は表示中 study を読み直す', async () => {
    const stub = createWindowStub(verifyPreloaded());
    const { deps, fetchMock } = createVerifyFakeDeps(BASE_TABS);
    const store = await bootstrapApp(asWindow(stub), deps);
    stub.location.hash = '#/verify';
    stub.fireHashChange();
    await flush();
    await flush();
    expect(store?.getState().verify.selectedStudyId).toBe('study-1');

    // 検出ロジック自体は verificationService.test.ts で検証済み。ここではバナー表示 →
    // 再読み込みボタンの配線（onReloadVerification → openVerifyStudy）だけを確認する
    store?.setState({
      verify: {
        ...(store.getState() as AppState).verify,
        conflictMessage: '読み込み後に別の場所で更新されています。再読み込みしてから判定し直してください',
      },
    });
    await flush();
    expect(document.getElementById('verify-conflict-warning')?.textContent).toContain(
      '読み込み後に別の場所で更新されています',
    );

    const callsBefore = fetchMock.mock.calls.length;
    (document.getElementById('verify-conflict-reload') as HTMLButtonElement).click();
    await flush();
    await flush();
    expect(fetchMock.mock.calls.length).toBeGreaterThan(callsBefore);
    expect(store?.getState().verify.conflictMessage).toBeNull();
    expect(document.getElementById('verify-conflict-warning')).toBeNull();
  });

  test('保存の競合検出バナーの「再読み込み」は selectedStudyId が無ければ何もしない', async () => {
    const stub = createWindowStub(verifyPreloaded());
    const { deps, fetchMock } = createVerifyFakeDeps(BASE_TABS);
    const store = await bootstrapApp(asWindow(stub), deps);
    stub.location.hash = '#/verify';
    stub.fireHashChange();
    await flush();
    await flush();

    // 通常は起こらない防御的なケース（selectedStudyId が無いのに verification は残っている）を
    // 直接注入して「何もしない」分岐を確認する
    store?.setState({
      verify: {
        ...(store.getState() as AppState).verify,
        selectedStudyId: null,
        conflictMessage: '読み込み後に別の場所で更新されています。再読み込みしてから判定し直してください',
      },
    });
    await flush();

    const callsBefore = fetchMock.mock.calls.length;
    (document.getElementById('verify-conflict-reload') as HTMLButtonElement).click();
    await flush();
    expect(fetchMock.mock.calls.length).toBe(callsBefore);
  });

  test('?entity= だけの入場は既定 study を補い ?entity= を保って書き戻す', async () => {
    const stub = createWindowStub(verifyPreloaded());
    const { deps } = createVerifyFakeDeps(BASE_TABS);
    const store = await bootstrapApp(asWindow(stub), deps);
    stub.location.hash = '#/verify?entity=-';
    stub.fireHashChange();
    await flush();
    await flush();
    expect(store?.getState().verify.selectedStudyId).toBe('study-1');
    // study は既定で補い、セル単位ディープリンクの entity は維持する
    expect(stub.history.replaceState).toHaveBeenCalledWith(
      null,
      '',
      '#/verify?study=study-1&entity=-',
    );
    expect(stub.location.hash).toBe('#/verify?study=study-1&entity=-');
  });

  test('セレクタ切替は hash 書き換え → ?study= の study を開く（直リンクと同経路）', async () => {
    const stub = createWindowStub(verifyPreloaded([DOC_RECORD_1, DOC_RECORD_2]));
    const tabs = {
      ...BASE_TABS,
      Studies: [
        [...SHEET_HEADERS.Studies],
        STUDY_ROW,
        ['study-2', 'Jones 2021', '', 't0', 'tester@example.com', ''],
      ],
      Evidence: [
        [...SHEET_HEADERS.Evidence],
        EVIDENCE_ROW,
        ['ev-2', 'run-1', 'study-2', 'f-total', 'doc-2', '-', '99', 'FALSE', '', '', '', ''],
      ],
    };
    const { deps } = createVerifyFakeDeps(tabs);
    const store = await bootstrapApp(asWindow(stub), deps);
    stub.location.hash = '#/verify';
    stub.fireHashChange();
    await flush();
    await flush();
    expect(store?.getState().verify.selectedStudyId).toBe('study-1');

    const select = document.getElementById('verify-study') as HTMLSelectElement;
    select.value = 'study-2';
    select.dispatchEvent(new Event('change'));
    expect(stub.location.hash).toBe('#/verify?study=study-2');
    stub.fireHashChange();
    await flush();
    await flush();
    expect(store?.getState().verify.selectedStudyId).toBe('study-2');
  });

  test('?study= が存在しない study なら #verify-error を出し、選び直せる', async () => {
    const stub = createWindowStub(verifyPreloaded());
    const { deps } = createVerifyFakeDeps(BASE_TABS);
    const store = await bootstrapApp(asWindow(stub), deps);
    stub.location.hash = '#/verify?study=study-9';
    stub.fireHashChange();
    await flush();
    await flush();
    expect(store?.getState().verify.verifyError).toContain('study-9 が見つかりません');
    expect(document.getElementById('verify-error')?.textContent).toContain('study-9');
    expect(document.getElementById('verify-study')).not.toBeNull();
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
    stub.location.hash = '#/verify?study=study-1';
    stub.fireHashChange();
    await flush();
    await flush();
    expect(store?.getState().verify.selectedStudyId).toBe('study-1');
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
      SchemaFields: [[...SHEET_HEADERS.SchemaFields], FIELD_ROW, ARM_FIELD_ROW, OUTCOME_FIELD_ROW],
      Evidence: [
        [...SHEET_HEADERS.Evidence],
        EVIDENCE_ROW,
        ['ev-arm', 'run-1', 'study-1', 'f-arm-n', 'doc-1', 'arm:1', '50', 'FALSE', '', '', '', ''],
      ],
    };
    const { deps, fetchMock } = createVerifyFakeDeps(tabs);
    await bootstrapApp(asWindow(stub), deps);
    stub.location.hash = '#/verify';
    stub.fireHashChange();
    await flush();
    await flush();

    const urls = () => fetchMock.mock.calls.map((call) => decodeURIComponent(String(call[0])));

    // 判定（study セルの承認）→ StudyData upsert + Decisions 追記
    (document.querySelector('.verify__action--accept') as HTMLButtonElement).click();
    await flush();
    await flush();
    expect(urls().some((url) => url.includes('Decisions') && url.includes(':append'))).toBe(true);

    // 群構成の確定 → ArmStructures タブ作成（旧プロジェクト）+ 追記
    const nameInput = document.querySelector('.verify__arm-name') as HTMLInputElement;
    nameInput.value = '介入群';
    nameInput.dispatchEvent(new Event('change'));
    (document.getElementById('verify-arm-confirm') as HTMLButtonElement).click();
    await flush();
    await flush();
    expect(urls().some((url) => url.includes(':batchUpdate'))).toBe(true);
    expect(urls().some((url) => url.includes('ArmStructures!A1:append'))).toBe(true);

    // アウトカム追加 → 予約 Decision の追記まで配線されている
    const decisionAppendCount = () =>
      urls().filter((url) => url.includes('Decisions') && url.includes(':append')).length;
    const beforeOutcomeAdd = decisionAppendCount();
    const outcomeTab = [...document.querySelectorAll<HTMLButtonElement>('.verify__tab')].find(
      (button) => button.textContent === 'アウトカム',
    );
    expect(outcomeTab).toBeDefined();
    outcomeTab!.click();
    (document.getElementById('verify-outcome-add-button') as HTMLButtonElement).click();
    await flush();
    await flush();
    expect(decisionAppendCount()).toBeGreaterThan(beforeOutcomeAdd);
  });

  test('?entity= ディープリンクは verify スライスへ写り、該当タブへ切替える', async () => {
    const stub = createWindowStub(verifyPreloaded());
    const tabs = {
      ...BASE_TABS,
      SchemaFields: [[...SHEET_HEADERS.SchemaFields], FIELD_ROW, ARM_FIELD_ROW],
      Evidence: [
        [...SHEET_HEADERS.Evidence],
        EVIDENCE_ROW,
        ['ev-arm', 'run-1', 'study-1', 'f-arm-n', 'doc-1', 'arm:1', '50', 'FALSE', '', '', '', ''],
      ],
      // 群構成は確定済み（未確定だとロック中タブへのディープリンクは無視される）
      ArmStructures: [
        [...SHEET_HEADERS.ArmStructures],
        ['study-1', '1', 'arm:1', '介入群', 'tester@example.com', 'human_with_ai', 't0', ''],
      ],
    };
    const { deps } = createVerifyFakeDeps(tabs);
    const store = await bootstrapApp(asWindow(stub), deps);
    stub.location.hash = '#/verify?study=study-1&entity=arm:1';
    stub.fireHashChange();
    await flush();
    await flush();
    await flush(); // focusEntity は DOM 接続後の microtask で適用される

    expect(store?.getState().verify.deepLinkEntityKey).toBe('arm:1');
    expect(document.querySelector('.verify__tab--active')?.textContent).toBe('群（arm）');
    const focused = document.querySelector('.verify__cell--focused') as HTMLElement;
    expect(focused.querySelector('.verify__cell-label')?.textContent).toBe('群の N');
  });

  test('#/dashboard 入場で集計を読み込み、セルが ?study=&entity= ディープリンクを持つ', async () => {
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
    expect(link?.getAttribute('href')).toBe('#/verify?study=study-1&entity=-');

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
      studyCount: 1,
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

// ---------------------------------------------------------------------------
// `#/adjudicate`（S12。独立二重レビュー機能 §6・§9 PR3）の配線
// ---------------------------------------------------------------------------

describe('bootstrapApp: #/adjudicate', () => {
  const loadAdjudicateTargetsMock = loadAdjudicateTargets as jest.Mock;
  const openAdjudicateStudyMock = openAdjudicateStudy as jest.Mock;
  const backToAdjudicateListMock = backToAdjudicateList as jest.Mock;
  const updateAdjudicateArmDraftRowMock = updateAdjudicateArmDraftRow as jest.Mock;
  const addAdjudicateArmDraftRowMock = addAdjudicateArmDraftRow as jest.Mock;
  const removeAdjudicateArmDraftRowMock = removeAdjudicateArmDraftRow as jest.Mock;
  const confirmAdjudicateArmsMock = confirmAdjudicateArms as jest.Mock;
  const acceptAllMatchingCellsMock = acceptAllMatchingCells as jest.Mock;
  const adjudicateCellChoiceMock = adjudicateCellChoice as jest.Mock;
  const adjudicateCellCustomValueMock = adjudicateCellCustomValue as jest.Mock;
  const adjudicateCellNotReportedMock = adjudicateCellNotReported as jest.Mock;
  const skipAdjudicateCellMock = skipAdjudicateCell as jest.Mock;
  const unskipAdjudicateCellMock = unskipAdjudicateCell as jest.Mock;
  const undoAdjudicateCellMock = undoAdjudicateCell as jest.Mock;
  const setAdjudicateMismatchOnlyFilterMock = setAdjudicateMismatchOnlyFilter as jest.Mock;

  beforeEach(() => {
    installChromeMock();
    document.body.innerHTML = APP_TEMPLATE;
  });

  const CELL = {
    cellKey: JSON.stringify(['f-1', '-']),
    field: {
      schemaVersion: 1,
      fieldId: 'f-1',
      fieldIndex: 1,
      section: 'population',
      fieldName: 'sample_size',
      fieldLabel: '総サンプルサイズ',
      entityLevel: 'study' as const,
      dataType: 'text' as const,
      unit: null,
      allowedValues: null,
      required: false,
      extractionInstruction: '',
      example: null,
      aiGenerated: false,
      note: null,
    },
    entityKey: '-',
    valueA: '120',
    valueB: '130',
    schemaVersionA: 1,
    schemaVersionB: 1,
    matches: false,
    schemaVersionMismatch: false,
  };

  function makeWorking(): AdjudicateWorking {
    return {
      study: { studyId: 'study-1', studyLabel: 'Smith 2020', registrationId: null, createdAt: 't0', createdBy: 'o@example.com', note: null },
      documents: [],
      annotatorA: 'a@example.com',
      annotatorB: 'b@example.com',
      fields: [CELL.field],
      schemaVersion: 1,
      armsA: [],
      armsB: [],
      needsArmConfirmation: false,
      armsMatched: true,
      consensusArmStructure: null,
      armDraft: [],
      cells: [CELL],
      consensusDecisions: [],
      skippedCellKeys: [],
      loadPdfView: jest.fn().mockResolvedValue({ pdf: null, pdfError: 'テストでは PDF なし', textPages: [] }),
      retryPdfView: jest.fn().mockResolvedValue({ pdf: null, pdfError: 'テストでは PDF なし', textPages: [] }),
      disposePdf: jest.fn().mockResolvedValue(undefined),
    };
  }

  test('#/adjudicate 入場で一覧読込を起動する', async () => {
    const stub = createWindowStub({ currentProject: PROJECT, home: COUNTS_LOADED });
    const { deps } = createFakeDeps([]);
    const store = await bootstrapApp(asWindow(stub), deps);
    stub.location.hash = '#/adjudicate';
    stub.fireHashChange();
    await flush();
    expect(loadAdjudicateTargetsMock).toHaveBeenCalledWith(store, deps);
  });

  test('?study= 付きで入場すると openAdjudicateStudy を呼ぶ（選択済みと同じなら呼ばない）', async () => {
    const stub = createWindowStub({
      currentProject: PROJECT,
      home: COUNTS_LOADED,
      adjudicate: { ...createInitialState().adjudicate, rows: [] },
    });
    const { deps } = createFakeDeps([]);
    const store = await bootstrapApp(asWindow(stub), deps);
    stub.location.hash = '#/adjudicate?study=study-1';
    stub.fireHashChange();
    await flush();
    expect(openAdjudicateStudyMock).toHaveBeenCalledWith(store, deps, 'study-1');

    // 同じ study が選択済みなら再度は呼ばない
    store?.setState({ adjudicate: { ...store.getState().adjudicate, selectedStudyId: 'study-1' } });
    openAdjudicateStudyMock.mockClear();
    stub.fireHashChange();
    await flush();
    expect(openAdjudicateStudyMock).not.toHaveBeenCalled();
  });

  test('一覧の再試行ボタンは force 再取得を委譲する', async () => {
    const stub = createWindowStub({
      currentProject: PROJECT,
      home: COUNTS_LOADED,
      adjudicate: { ...createInitialState().adjudicate, loadError: '権限がありません' },
    });
    const { deps } = createFakeDeps([]);
    await bootstrapApp(asWindow(stub), deps);
    stub.location.hash = '#/adjudicate';
    stub.fireHashChange();
    expect(document.getElementById('adjudicate-error')?.textContent).toContain('権限がありません');
    (document.getElementById('adjudicate-retry') as HTMLButtonElement).click();
    expect(loadAdjudicateTargetsMock).toHaveBeenCalledWith(expect.anything(), deps, { force: true });
  });

  test('一覧の「裁定を開始」は ?study= 付きハッシュへ遷移する', async () => {
    const stub = createWindowStub({
      currentProject: PROJECT,
      home: COUNTS_LOADED,
      adjudicate: {
        ...createInitialState().adjudicate,
        rows: [
          {
            study: { studyId: 'study-9', studyLabel: 'S9', registrationId: null, createdAt: 't0', createdBy: 'o@example.com', note: null },
            pair: { kind: 'ready', annotatorA: 'a@example.com', annotatorB: 'b@example.com' },
            gate: {
              progressA: { annotator: 'a@example.com', decided: 1, total: 1, complete: true },
              progressB: { annotator: 'b@example.com', decided: 1, total: 1, complete: true },
              ready: true,
            },
          },
        ],
      },
    });
    const { deps } = createFakeDeps([]);
    await bootstrapApp(asWindow(stub), deps);
    stub.location.hash = '#/adjudicate';
    stub.fireHashChange();
    (document.querySelector('.adjudicate__open-button') as HTMLButtonElement).click();
    expect(stub.location.hash).toBe('#/adjudicate?study=study-9');
  });

  test('裁定中画面の各操作をサービスへ委譲する', async () => {
    const stub = createWindowStub({
      currentProject: PROJECT,
      home: COUNTS_LOADED,
      adjudicate: {
        ...createInitialState().adjudicate,
        rows: [],
        working: makeWorking(),
      },
    });
    const { deps } = createFakeDeps([]);
    const store = await bootstrapApp(asWindow(stub), deps);
    stub.location.hash = '#/adjudicate';
    stub.fireHashChange();

    (document.getElementById('adjudicate-back') as HTMLButtonElement).click();
    expect(backToAdjudicateListMock).toHaveBeenCalledWith(store);
    expect(stub.location.hash).toBe('#/adjudicate');

    (document.getElementById('adjudicate-accept-all') as HTMLButtonElement).click();
    expect(acceptAllMatchingCellsMock).toHaveBeenCalledWith(store, deps);

    (document.querySelector('.adjudicate__action--choose-a') as HTMLButtonElement).click();
    expect(adjudicateCellChoiceMock).toHaveBeenCalledWith(store, deps, CELL.cellKey, 'A');
    (document.querySelector('.adjudicate__action--choose-b') as HTMLButtonElement).click();
    expect(adjudicateCellChoiceMock).toHaveBeenCalledWith(store, deps, CELL.cellKey, 'B');

    const customInput = document.querySelector('.adjudicate__custom-input') as HTMLInputElement;
    customInput.value = '第 3 の値';
    (document.querySelector('.adjudicate__action--custom') as HTMLButtonElement).click();
    expect(adjudicateCellCustomValueMock).toHaveBeenCalledWith(store, deps, CELL.cellKey, '第 3 の値');

    (document.querySelector('.adjudicate__action--not-reported') as HTMLButtonElement).click();
    expect(adjudicateCellNotReportedMock).toHaveBeenCalledWith(store, deps, CELL.cellKey);

    (document.querySelector('.adjudicate__action--skip') as HTMLButtonElement).click();
    expect(skipAdjudicateCellMock).toHaveBeenCalledWith(store, CELL.cellKey);

    const filterCheckbox = document.getElementById('adjudicate-filter-mismatch') as HTMLInputElement;
    filterCheckbox.checked = false;
    filterCheckbox.dispatchEvent(new Event('change'));
    expect(setAdjudicateMismatchOnlyFilterMock).toHaveBeenCalledWith(store, false);
  });

  test('裁定済み・スキップ済みセルの取り消し操作をサービスへ委譲する', async () => {
    const workingWithDecision: AdjudicateWorking = {
      ...makeWorking(),
      consensusDecisions: [
        {
          decidedAt: 't1',
          decidedBy: 'judge@example.com',
          studyId: 'study-1',
          fieldId: 'f-1',
          entityKey: '-',
          annotator: 'consensus',
          annotatorType: 'consensus',
          schemaVersion: 1,
          action: 'edit',
          value: '120',
          note: null,
        },
      ],
    };
    const stub = createWindowStub({
      currentProject: PROJECT,
      home: COUNTS_LOADED,
      adjudicate: {
        ...createInitialState().adjudicate,
        rows: [],
        working: workingWithDecision,
      },
    });
    const { deps } = createFakeDeps([]);
    const store = await bootstrapApp(asWindow(stub), deps);
    stub.location.hash = '#/adjudicate';
    stub.fireHashChange();

    (document.querySelector('.adjudicate__action--undo') as HTMLButtonElement).click();
    expect(undoAdjudicateCellMock).toHaveBeenCalledWith(store, deps, CELL.cellKey);
  });

  test('スキップ済みセルの「スキップを取り消す」操作をサービスへ委譲する', async () => {
    const workingSkipped: AdjudicateWorking = { ...makeWorking(), skippedCellKeys: [CELL.cellKey] };
    const stub = createWindowStub({
      currentProject: PROJECT,
      home: COUNTS_LOADED,
      adjudicate: { ...createInitialState().adjudicate, rows: [], working: workingSkipped },
    });
    const { deps } = createFakeDeps([]);
    const store = await bootstrapApp(asWindow(stub), deps);
    stub.location.hash = '#/adjudicate';
    stub.fireHashChange();

    (document.querySelector('.adjudicate__action--unskip') as HTMLButtonElement).click();
    expect(unskipAdjudicateCellMock).toHaveBeenCalledWith(store, CELL.cellKey);
  });

  test('群構成の編集・確定操作をサービスへ委譲する', async () => {
    const workingNeedsArm: AdjudicateWorking = {
      ...makeWorking(),
      needsArmConfirmation: true,
      armsMatched: false,
      armsA: [{ armKey: 'arm:1', armName: '介入群' }],
      armsB: [{ armKey: 'arm:1', armName: '対照群' }],
      armDraft: [{ armKey: 'arm:1', armName: '介入群' }],
    };
    const stub = createWindowStub({
      currentProject: PROJECT,
      home: COUNTS_LOADED,
      adjudicate: {
        ...createInitialState().adjudicate,
        rows: [],
        working: workingNeedsArm,
      },
    });
    const { deps } = createFakeDeps([]);
    const store = await bootstrapApp(asWindow(stub), deps);
    stub.location.hash = '#/adjudicate';
    stub.fireHashChange();

    const input = document.querySelector('.adjudicate__arm-draft-input') as HTMLInputElement;
    input.value = '新名称';
    input.dispatchEvent(new Event('change'));
    expect(updateAdjudicateArmDraftRowMock).toHaveBeenCalledWith(store, 0, '新名称');

    (document.getElementById('adjudicate-arm-add') as HTMLButtonElement).click();
    expect(addAdjudicateArmDraftRowMock).toHaveBeenCalledWith(store);

    (document.querySelector('.adjudicate__arm-draft-remove') as HTMLButtonElement).click();
    expect(removeAdjudicateArmDraftRowMock).toHaveBeenCalledWith(store, 0);

    (document.getElementById('adjudicate-arm-confirm') as HTMLButtonElement).click();
    expect(confirmAdjudicateArmsMock).toHaveBeenCalledWith(store, deps, workingNeedsArm.armDraft);
  });
});

// ---------------------------------------------------------------------------
// 独立二重レビュー機能（ロール解決 + reviewer シェル制限 + オンボーディング）
// docs/design-independent-dual-review.md §1・§3・§3.1・§7
// ---------------------------------------------------------------------------

describe('bootstrapApp: 独立二重レビュー機能', () => {
  beforeEach(() => {
    installChromeMock();
    document.body.innerHTML = APP_TEMPLATE;
  });

  test('unregistered ロール: 全画面ブロックを表示し、ナビは出さない', async () => {
    const stub = createWindowStub({
      currentProject: PROJECT,
      home: COUNTS_LOADED,
      role: {
        role: 'unregistered',
        resolving: false,
        error: null,
        folderAccessGranted: false,
        folderAccessChecking: false,
        folderAccessError: null,
      },
    });
    const { deps } = createFakeDeps([]);
    await bootstrapApp(asWindow(stub), deps);

    expect(document.getElementById('app-role-blocked')).not.toBeNull();
    expect(document.getElementById('app-role-blocked')?.textContent).toContain(
      'このプロジェクトのレビュアーとして登録されていません',
    );
    expect(document.getElementById('app-context')?.textContent).toBe('アクセスできません');
    expect(document.querySelectorAll('#app-nav a')).toHaveLength(0);
  });

  test('reviewer_with_ai ロール: ナビは Home / 検証のみ + フォルダアクセス付与ボタンが配線されている', async () => {
    const stub = createWindowStub({
      currentProject: PROJECT,
      home: COUNTS_LOADED,
      counts: { evidenceRows: 1 } as AppState['counts'],
      role: {
        role: 'reviewer_with_ai',
        resolving: false,
        error: null,
        folderAccessGranted: false,
        folderAccessChecking: false,
        folderAccessError: null,
      },
    });
    const { deps } = createFakeDeps([]); // picker.getAccessToken は 'picker offline' で reject する既定
    await bootstrapApp(asWindow(stub), deps);

    // サイドバー: Home と検証だけ（文献取り込み等は非表示）
    const links = Array.from(document.querySelectorAll('#app-nav a')).map((a) =>
      a.getAttribute('href'),
    );
    expect(links).toEqual(['#/home', '#/verify']);

    // 縮退版 Home（進捗カウントは出さない）+ フォルダアクセス付与ボタンの配線
    expect(document.querySelector('.home__summary')).toBeNull();
    (document.getElementById('home-grant-folder-access') as HTMLButtonElement).click();
    await flush();
    expect(toastTexts()).toContain('Drive Picker を開けませんでした: picker offline');
  });

  test('reviewer_independent ロールで #/verify 以外へ直接遷移するとトースト + #/home へ戻される', async () => {
    const stub = createWindowStub({
      currentProject: PROJECT,
      home: COUNTS_LOADED,
      role: {
        role: 'reviewer_independent',
        resolving: false,
        error: null,
        folderAccessGranted: true,
        folderAccessChecking: false,
        folderAccessError: null,
      },
    });
    const { deps } = createFakeDeps([]);
    const stubWindow = asWindow(stub);
    await bootstrapApp(stubWindow, deps);
    stub.location.hash = '#/documents';
    stub.fireHashChange();
    expect(toastTexts()).toContain('このプロジェクトではレビュアー権限のため利用できません');
    expect(stub.location.hash).toBe('#/home');
  });

  test('owner のレビュアー管理カード（追加 / モード変更確認 / 解除 / 再読み込み）が配線されている', async () => {
    const stub = createWindowStub({
      currentProject: PROJECT,
      home: COUNTS_LOADED,
      reviewers: {
        assignments: [
          {
            email: 'r1@example.com',
            role: 'reviewer',
            reviewMode: 'with_ai',
            assignedBy: 'tester@example.com',
            assignedAt: 't0',
          },
        ],
        loading: false,
        loadError: null,
        saving: false,
        saveError: null,
        confirmingChange: null,
      } as AppState['reviewers'],
    });
    const { deps, fetchMock } = createFakeDeps([[...SHEET_HEADERS.Reviewers]]);
    await bootstrapApp(asWindow(stub), deps);

    // 新規追加（onAddReviewer）
    const email = document.getElementById('reviewer-email') as HTMLInputElement;
    email.value = 'r2@example.com';
    (document.getElementById('reviewer-add-form') as HTMLFormElement).dispatchEvent(
      new Event('submit', { cancelable: true }),
    );
    await flush();
    expect(toastTexts()).toContain(
      'r2@example.com を登録し、シート（編集可）とフォルダ（閲覧）を共有しました',
    );
    expect(document.querySelectorAll('#home-reviewers-list tbody tr')).toHaveLength(2);

    // 依頼文コピー（onCopyInvite → copyReviewInvite → navigator.clipboard）
    const writeText = jest.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
    (document.querySelector('.reviewers__invite') as HTMLButtonElement).click();
    await flush();
    expect(writeText).toHaveBeenCalledTimes(1);
    expect(toastTexts()).toContain('レビュー依頼文をコピーしました');

    // 既存 reviewer の review_mode だけを変える送信はモード変更確認ダイアログへ（onAddReviewer → confirmingChange）
    const email2 = document.getElementById('reviewer-email') as HTMLInputElement;
    email2.value = 'r1@example.com';
    const mode = document.getElementById('reviewer-mode') as HTMLSelectElement;
    mode.value = 'independent';
    (document.getElementById('reviewer-add-form') as HTMLFormElement).dispatchEvent(
      new Event('submit', { cancelable: true }),
    );
    await flush();
    expect(document.getElementById('reviewer-mode-confirm')).not.toBeNull();

    // キャンセル（onCancelReviewerChange）
    (document.getElementById('reviewer-mode-confirm-cancel') as HTMLButtonElement).click();
    expect(document.getElementById('reviewer-mode-confirm')).toBeNull();

    // 再送信 → 確認 → 続行（onConfirmReviewerChange）
    const email3 = document.getElementById('reviewer-email') as HTMLInputElement;
    email3.value = 'r1@example.com';
    const mode3 = document.getElementById('reviewer-mode') as HTMLSelectElement;
    mode3.value = 'independent';
    (document.getElementById('reviewer-add-form') as HTMLFormElement).dispatchEvent(
      new Event('submit', { cancelable: true }),
    );
    (document.getElementById('reviewer-mode-confirm-ok') as HTMLButtonElement).click();
    await flush();
    expect(toastTexts()).toContain(
      'r1@example.com を登録し、シート（編集可）とフォルダ（閲覧）を共有しました',
    );

    // 解除（onRevokeReviewer）
    const revokeButtons = document.querySelectorAll('.reviewers__revoke');
    (revokeButtons[0] as HTMLButtonElement).click();
    await flush();
    expect(toastTexts()).toContain('r1@example.com の登録を解除しました');
    // fetchMock は上記一連の POST（タブ作成 + 追記）を記録している
    expect(fetchMock).toHaveBeenCalled();
  });

  test('owner のレビュアー一覧読込失敗（起動時の自動読込）は #home-reviewers-reload の force 再取得で復帰する（onReloadReviewers）', async () => {
    const stub = createWindowStub({
      currentProject: PROJECT,
      home: COUNTS_LOADED,
      // 既定（E2E seam）は「読込済み（0 件）」扱いで自動読込を抑止するため、ここでは明示的に
      // 未読込（null）へ戻して起動時の自動読込（loadReviewers）を実際に走らせる
      reviewers: {
        assignments: null,
        loading: false,
        loadError: null,
        saving: false,
        saveError: null,
        confirmingChange: null,
      } as AppState['reviewers'],
    });
    let call = 0;
    const fetchMock = jest.fn(async () => {
      call += 1;
      if (call === 1) {
        return { ok: false, status: 500, json: async () => ({}), text: async () => 'boom' };
      }
      return { ok: true, status: 200, json: async () => ({ sheets: [] }), text: async () => '' };
    });
    const deps: AppDeps = {
      ...createFakeDeps([]).deps,
      google: { fetch: fetchMock as unknown as typeof fetch, getAccessToken: async () => 'token' },
    };
    await bootstrapApp(asWindow(stub), deps);
    await flush();
    expect(document.getElementById('home-reviewers-error')?.textContent).toContain(
      'Google API failed: HTTP 500',
    );
    (document.getElementById('home-reviewers-reload') as HTMLButtonElement).click();
    await flush();
    expect(document.getElementById('home-reviewers-error')).toBeNull();
    expect(document.getElementById('home-reviewers-empty')).not.toBeNull();
  });
});

// ---------------------------------------------------------------------------
// ロール解決の初期化順序とフェイルクローズ（盲検ガード。design §1・§3）
// - 初期ルーティングはロール確定後に行う（ロール確定前にルートローダを発火させない）
// - ロール解決失敗はフェイルクローズ（エラー画面 + 再試行のみ。owner へフォールバックしない）
// - ロールがセッション中に変わったら現在ルートを再ガードして退避する
// ---------------------------------------------------------------------------

describe('bootstrapApp: ロール解決の初期化順序とフェイルクローズ（盲検ガード）', () => {
  const loadExportDataMock = loadExportData as jest.Mock;
  let chromeMock: ChromeMock;

  beforeEach(() => {
    chromeMock = installChromeMock();
    document.body.innerHTML = APP_TEMPLATE;
  });

  /**
   * ロール解決（Meta / Reviewers 読み出し）を実弾で通す Sheets fetch スタブ。
   * failuresBeforeSuccess で先頭 n 回の fetch を HTTP 500 にし、gate で全 fetch を保留できる
   */
  function createRoleDeps(options: {
    email: string;
    reviewersRows?: string[][];
    failuresBeforeSuccess?: number;
    gate?: Promise<void>;
  }): { deps: AppDeps; fetchMock: jest.Mock } {
    let failures = options.failuresBeforeSuccess ?? 0;
    const fetchMock = jest.fn(async (input: RequestInfo | URL) => {
      if (options.gate) {
        await options.gate;
      }
      const url = decodeURIComponent(String(input));
      if (failures > 0) {
        failures -= 1;
        return { ok: false, status: 500, json: async () => ({}), text: async () => 'boom' };
      }
      let json: unknown = { values: [] };
      if (url.includes('fields=sheets.properties.title')) {
        json = {
          sheets: ['Meta', 'Documents', 'SchemaFields', 'Reviewers'].map((title) => ({
            properties: { title },
          })),
        };
      } else if (url.includes('/values/Meta')) {
        // schema_version は CURRENT_SCHEMA_VERSION（'1.0'）と一致させる（loadProjectMeta の検証）
        json = {
          values: [
            [...SHEET_HEADERS.Meta],
            ['p1', 'テスト SR', 'sheet-1', 'folder-1', '1.0', 't0', 'owner@example.com'],
          ],
        };
      } else if (url.includes('/values/Reviewers')) {
        json = { values: [[...SHEET_HEADERS.Reviewers], ...(options.reviewersRows ?? [])] };
      } else if (url.includes('/values:batchGet')) {
        json = { valueRanges: [] };
      }
      return { ok: true, status: 200, json: async () => json, text: async () => '' };
    });
    const { deps } = createFakeDeps([]);
    deps.google = { fetch: fetchMock as unknown as typeof fetch, getAccessToken: async () => 'token' };
    deps.profile = { getProfileUserInfo: async () => ({ email: options.email, id: 'uid' }) };
    return { deps, fetchMock };
  }

  /** fetch 履歴に batchGet（進捗カウント読込）が含まれるか */
  function calledBatchGet(fetchMock: jest.Mock): boolean {
    return fetchMock.mock.calls.some((call) => String(call[0]).includes('batchGet'));
  }

  test('ロール確定前は初期ルーティングを行わず、reviewer の #/export 直リンクは #/home へ退避する', async () => {
    chromeMock.storage.local.data[CURRENT_PROJECT_STORAGE_KEY] = PROJECT;
    const stub = createWindowStub();
    stub.location.hash = '#/export';
    let release: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const { deps, fetchMock } = createRoleDeps({
      email: 'reviewer@example.com',
      reviewersRows: [['reviewer@example.com', 'reviewer', 'with_ai', 'owner@example.com', 't0']],
      gate,
    });

    const boot = bootstrapApp(asWindow(stub), deps);
    await flush();
    // ロール確定前（盲検のフェイルクローズ）: プレースホルダ + ナビ非表示 + #/export のローダ未発火
    expect(document.getElementById('app-role-resolving')).not.toBeNull();
    expect(document.querySelectorAll('#app-nav a')).toHaveLength(0);
    expect(loadExportDataMock).not.toHaveBeenCalled();

    release();
    await boot;
    await flush();
    // reviewer_with_ai と解決 → #/export は不許可 → トーストで #/home へ退避し、ローダは最後まで発火しない
    expect(toastTexts()).toContain('このプロジェクトではレビュアー権限のため利用できません');
    expect(stub.location.hash).toBe('#/home');
    expect(loadExportDataMock).not.toHaveBeenCalled();
    expect(document.getElementById('app-role-resolving')).toBeNull();
    expect(document.getElementById('app-content')?.textContent).toContain('プロジェクト概要');
    expect(document.querySelectorAll('#app-nav a')).toHaveLength(2);
    // reviewer には進捗カウント（batchGet）も読ませない（滑り込みの防止）
    expect(calledBatchGet(fetchMock)).toBe(false);
  });

  test('ロール解決失敗はフェイルクローズ（エラー画面 + ナビ非表示 + ローダ不発火）。再試行で復帰する', async () => {
    chromeMock.storage.local.data[CURRENT_PROJECT_STORAGE_KEY] = PROJECT;
    const stub = createWindowStub();
    const { deps, fetchMock } = createRoleDeps({
      email: 'owner@example.com',
      failuresBeforeSuccess: 1,
    });
    await bootstrapApp(asWindow(stub), deps);
    await flush();

    // 一時的な読込エラーで owner UI を開放しない（フェイルクローズ）
    expect(document.getElementById('app-role-error')?.textContent).toContain(
      'ロールを確認できませんでした',
    );
    expect(document.getElementById('app-context')?.textContent).toBe('ロールを確認できませんでした');
    expect(document.querySelectorAll('#app-nav a')).toHaveLength(0);
    expect(calledBatchGet(fetchMock)).toBe(false);

    // 再試行 → owner と解決 → 通常の Home + ナビ 10 項目 + 進捗カウント読込
    (document.getElementById('app-role-retry') as HTMLButtonElement).click();
    await flush();
    await flush();
    expect(document.getElementById('app-role-error')).toBeNull();
    expect(document.getElementById('app-content')?.textContent).toContain('プロジェクト概要');
    expect(document.querySelectorAll('#app-nav a')).toHaveLength(10);
    expect(calledBatchGet(fetchMock)).toBe(true);
  });

  test('再試行も失敗したらエラー画面のまま（フェイルクローズ維持）、その後の再試行で復帰する', async () => {
    chromeMock.storage.local.data[CURRENT_PROJECT_STORAGE_KEY] = PROJECT;
    const stub = createWindowStub();
    const { deps, fetchMock } = createRoleDeps({
      email: 'owner@example.com',
      failuresBeforeSuccess: 2,
    });
    await bootstrapApp(asWindow(stub), deps);
    await flush();
    expect(document.getElementById('app-role-error')).not.toBeNull();

    // 1 回目の再試行も失敗 → エラー画面を維持し、ルートローダは発火しない
    (document.getElementById('app-role-retry') as HTMLButtonElement).click();
    await flush();
    expect(document.getElementById('app-role-error')).not.toBeNull();
    expect(calledBatchGet(fetchMock)).toBe(false);

    // 2 回目の再試行で復帰
    (document.getElementById('app-role-retry') as HTMLButtonElement).click();
    await flush();
    await flush();
    expect(document.getElementById('app-role-error')).toBeNull();
    expect(document.getElementById('app-content')?.textContent).toContain('プロジェクト概要');
  });

  test('ロールがセッション中に変わったら現在ルートを再ガードし、不許可なら #/home へ退避する（防御の多重化）', async () => {
    const stub = createWindowStub({
      currentProject: PROJECT,
      counts: { dataRows: 1 } as AppState['counts'],
    });
    const { deps } = createFakeDeps([]);
    const store = await bootstrapApp(asWindow(stub), deps);
    stub.location.hash = '#/export';
    stub.fireHashChange();
    expect(document.getElementById('app-context')?.textContent).toBe(
      'エクスポート 画面を表示しています',
    );

    // ロールが reviewer へ変わる → 現在ルート（#/export）が不許可になり #/home へ退避する
    const current = store?.getState();
    store?.setState({
      role: { ...(current as AppState).role, role: 'reviewer_with_ai', folderAccessGranted: true },
    });
    expect(toastTexts()).toContain('このプロジェクトではレビュアー権限のため利用できません');
    expect(stub.location.hash).toBe('#/home');
    // 退避後の再描画はレビュアー向けの縮退版 Home
    expect(document.getElementById('app-content')?.textContent).toContain('プロジェクト概要');
    expect(document.querySelectorAll('#app-nav a')).toHaveLength(2);
  });
});
