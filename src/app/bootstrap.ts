// メインビューの起動配線: ストアのシード → ヘッダ / サイドバー描画 → ルーティング開始。
// E2E seam（test-strategy.md §2.1）: window.__E2E_PRELOADED_STATE__ があれば
// ストアのシードへ上書きマージする（本番動作には影響しない）
import { createInitialState, createStore, type AppState, type Store, type VerifyTarget } from './store';
import { docQueryOf, entityQueryOf, findRoute, normalizeHash, ROUTES, type RouteHash } from './router';
import { guardRoute } from './guards';
import { showToast } from './ui/toast';
import type { ViewContext } from './views/types';
import {
  importFromPicker,
  loadDocuments,
  saveStudyLabel,
  type DocumentsServiceDeps,
} from './services/documentsService';
import {
  cancelEditProtocol,
  loadProtocols,
  selectProtocolVersion,
  startEditProtocol,
  submitProtocol,
  type ProtocolServiceDeps,
} from './services/protocolService';
import {
  addEditorRow,
  cancelEditor,
  confirmSchema,
  insertOutcomePreset,
  loadSchema,
  removeEditorRow,
  runDraftSchema,
  setDraftModel,
  startEditorFromCurrent,
  toggleSampleDocument,
  updateEditorRow,
  type SchemaServiceDeps,
} from './services/schemaService';
import {
  initPilotSelection,
  loadPilotVerification,
  persistPilotArmConfirmation,
  persistPilotDecision,
  runPilot,
  setPilotModel,
  togglePilotDocument,
  type PilotServiceDeps,
} from './services/pilotService';
import {
  cancelExtractConfirm,
  initExtractSelection,
  loadExtractTargets,
  requestExtractRun,
  retryExtractDocument,
  runExtract,
  setExtractModel,
  toggleExtractDocument,
} from './services/extractService';
import {
  loadVerifyTargets,
  openVerifyDocument,
  persistVerifyArmConfirmation,
  persistVerifyDecision,
} from './services/verifyService';
import { loadDashboard } from './services/dashboardService';
import { loadProgressCounts } from './services/homeService';
import {
  cancelExportWarning,
  confirmExportGenerate,
  downloadExportResult,
  loadExportData,
  requestExportGenerate,
  selectExportFormat,
} from './services/exportService';
import { createChromeGoogleApiDeps } from './services/factories';
import { loadCurrentProject } from '../features/project/projectStore';
import { extractDocxText } from '../lib/docx/extractDocxText';
import { createChromeProfileDeps } from '../lib/google/identity';
import { createChromePickerDeps } from '../lib/google/picker';
import { createProvider } from '../lib/llm/providerFactory';
import { loadDisposablePdf } from '../lib/pdf/loadPdf';
import { loadGeminiApiKey } from '../lib/storage/secretsStore';

declare global {
  interface Window {
    __E2E_PRELOADED_STATE__?: Partial<AppState>;
  }
}

export async function seedState(win: Window): Promise<AppState> {
  const state = createInitialState();
  const storedProject = await loadCurrentProject();
  if (storedProject) {
    state.currentProject = storedProject;
  }
  const preloaded = win.__E2E_PRELOADED_STATE__;
  if (preloaded) {
    return {
      ...state,
      ...preloaded,
      counts: { ...state.counts, ...(preloaded.counts ?? {}) },
      // counts を注入したテストは「読込済み」として扱い、起動時の Sheets 読込を行わない
      home: {
        ...state.home,
        countsLoaded: preloaded.counts !== undefined,
        ...(preloaded.home ?? {}),
      },
      documents: { ...state.documents, ...(preloaded.documents ?? {}) },
      protocol: { ...state.protocol, ...(preloaded.protocol ?? {}) },
      schema: { ...state.schema, ...(preloaded.schema ?? {}) },
      pilot: { ...state.pilot, ...(preloaded.pilot ?? {}) },
      extract: { ...state.extract, ...(preloaded.extract ?? {}) },
      verify: { ...state.verify, ...(preloaded.verify ?? {}) },
      dashboard: { ...state.dashboard, ...(preloaded.dashboard ?? {}) },
      export: { ...state.export, ...(preloaded.export ?? {}) },
    };
  }
  return state;
}

/** app 実行時のサービス依存（documents / protocol / schema / pilot の各サービス）。テストは fake を注入する */
export type AppDeps = DocumentsServiceDeps & ProtocolServiceDeps & SchemaServiceDeps & PilotServiceDeps;

/** Chrome ランタイムから AppDeps を組み立てる既定実装 */
export function createChromeAppDeps(): AppDeps {
  const google = createChromeGoogleApiDeps();
  return {
    google,
    profile: createChromeProfileDeps(),
    picker: createChromePickerDeps(google),
    loadPdf: loadDisposablePdf,
    extractDocxText,
    loadApiKey: loadGeminiApiKey,
    buildProvider: createProvider,
  };
}

/** 起動配線を行い、後続の画面実装（services 層）が使うストアを返す */
export async function bootstrapApp(
  win: Window,
  deps: AppDeps = createChromeAppDeps(),
): Promise<Store | null> {
  const doc = win.document;
  const statusEl = doc.getElementById('app-status');
  const contextEl = doc.getElementById('app-context');
  const navEl = doc.getElementById('app-nav');
  const contentEl = doc.getElementById('app-content');
  const titleButton = doc.getElementById('app-title');
  const openPopupButton = doc.getElementById('app-open-popup');
  if (!statusEl || !contextEl || !navEl || !contentEl || !titleButton || !openPopupButton) {
    return null;
  }

  const store = createStore(await seedState(win));
  let currentHash: RouteHash = '#/home';

  // view のユーザー操作をサービス層へ委譲するコンテキスト（views/types.ts）
  const viewContext: ViewContext = {
    home: {
      onReload: () => {
        void loadProgressCounts(store, deps, { force: true });
      },
    },
    documents: {
      onImport: () => {
        void importFromPicker(store, deps);
      },
      onReload: () => {
        void loadDocuments(store, deps, { force: true });
      },
      onSaveStudyLabel: (documentId, label) => {
        void saveStudyLabel(store, deps, documentId, label);
      },
    },
    protocol: {
      onSubmit: (input) => {
        void submitProtocol(store, deps, input);
      },
      onStartEdit: () => {
        startEditProtocol(store);
      },
      onCancelEdit: () => {
        cancelEditProtocol(store);
      },
      onSelectVersion: (version) => {
        selectProtocolVersion(store, version);
      },
      onReload: () => {
        void loadProtocols(store, deps, { force: true });
      },
    },
    schema: {
      onReload: () => {
        void loadSchema(store, deps, { force: true });
      },
      onToggleSample: (documentId, selected) => {
        toggleSampleDocument(store, documentId, selected);
      },
      onChangeModel: (model) => {
        setDraftModel(store, model);
      },
      onRunDraft: () => {
        void runDraftSchema(store, deps);
      },
      onEditRow: (index, patch) => {
        updateEditorRow(store, index, patch);
      },
      onAddRow: () => {
        addEditorRow(store);
      },
      onRemoveRow: (index) => {
        removeEditorRow(store, index);
      },
      onInsertPreset: (kind) => {
        insertOutcomePreset(store, kind);
      },
      onConfirm: (note) => {
        void confirmSchema(store, deps, note);
      },
      onCancelEditor: () => {
        cancelEditor(store);
      },
      onStartNewVersion: () => {
        startEditorFromCurrent(store);
      },
    },
    pilot: {
      onToggleDocument: (documentId, selected) => {
        togglePilotDocument(store, documentId, selected);
      },
      onChangeModel: (model) => {
        setPilotModel(store, model);
      },
      onRun: () => {
        void runPilot(store, deps);
      },
      onSelectVerifyDocument: (documentId) => {
        void loadPilotVerification(store, deps, documentId);
      },
      onRetryVerifyLoad: () => {
        const documentId = store.getState().pilot.verifyDocumentId;
        if (documentId !== null) {
          void loadPilotVerification(store, deps, documentId);
        }
      },
      onDecision: (decision) => {
        void persistPilotDecision(store, deps, decision);
      },
      onArmConfirm: (arms) => {
        void persistPilotArmConfirmation(store, deps, arms);
      },
    },
    extract: {
      onToggleDocument: (documentId, selected) => {
        toggleExtractDocument(store, documentId, selected);
      },
      onChangeModel: (model) => {
        setExtractModel(store, model);
      },
      onRequestRun: () => {
        void requestExtractRun(store, deps);
      },
      onConfirmRun: () => {
        void runExtract(store, deps);
      },
      onCancelConfirm: () => {
        cancelExtractConfirm(store);
      },
      onRetryDocument: (documentId) => {
        void retryExtractDocument(store, deps, documentId);
      },
      onReloadTargets: () => {
        void loadDocuments(store, deps, { force: true });
        void loadExtractTargets(store, deps, { force: true });
      },
    },
    verify: {
      onSelectDocument: (documentId) => {
        // hash 書き換え → hashchange → syncVerifyRoute の一本道（直リンクと同じ経路を通す）
        win.location.hash = `#/verify?doc=${encodeURIComponent(documentId)}`;
      },
      onRetryLoad: () => {
        void loadVerifyTargets(store, deps, { force: true }).then(() => syncVerifyRoute());
      },
      onDecision: (decision) => {
        void persistVerifyDecision(store, deps, decision);
      },
      onArmConfirm: (arms) => {
        void persistVerifyArmConfirmation(store, deps, arms);
      },
    },
    dashboard: {
      onReload: () => {
        void loadDashboard(store, deps, { force: true });
      },
    },
    export: {
      onSelectFormat: (format) => {
        selectExportFormat(store, format);
      },
      onGenerate: () => {
        void requestExportGenerate(store, deps);
      },
      onConfirmGenerate: () => {
        void confirmExportGenerate(store, deps);
      },
      onCancelGenerate: () => {
        cancelExportWarning(store);
      },
      onDownload: () => {
        downloadExportResult(store);
      },
      onReload: () => {
        void loadExportData(store, deps, { force: true });
      },
    },
  };

  /**
   * #/verify の表示同期: 一覧を読み込み、?doc=（なければ選択済み or 先頭）を開く。
   * セレクタ切替も hash 書き換え経由でここへ合流する（ui-states.md §3 の URL 同期）。
   * ?entity=（S9 ダッシュボードのセル単位ディープリンク）は verify スライスへ写し、
   * 検証パネルが該当タブへの切替 + 先頭セルへのスクロール・フォーカスとして消費する
   */
  const syncVerifyRoute = async (): Promise<void> => {
    const entity = entityQueryOf(win.location.hash);
    if (entity !== store.getState().verify.deepLinkEntityKey) {
      store.setState({
        verify: { ...store.getState().verify, deepLinkEntityKey: entity },
      });
    }
    await loadVerifyTargets(store, deps);
    const verify = store.getState().verify;
    const targets = verify.targets;
    if (targets === null || targets.length === 0) {
      return;
    }
    const desired =
      docQueryOf(win.location.hash) ??
      verify.selectedDocumentId ??
      (targets[0] as VerifyTarget).document.documentId;
    // 読み込み中の再入は openVerifyDocument 側の verifyLoading ガードが弾く
    const alreadyShown =
      desired === verify.selectedDocumentId &&
      (verify.verification !== null || verify.verifyError !== null);
    if (!alreadyShown) {
      await openVerifyDocument(store, deps, desired);
    }
    // 初回入場（?doc= 無し）は既定文献を URL へ書き戻し、リロード・共有・戻る操作で
    // 同じ文献へ着地できるようにする。replaceState は hashchange を発火しないため
    // 再入ループにならず履歴も汚さない（セル単位ディープリンクの ?entity= は保つ）
    if (docQueryOf(win.location.hash) === null) {
      const entityQuery = entity !== null ? `&entity=${encodeURIComponent(entity)}` : '';
      win.history.replaceState(
        null,
        '',
        `#/verify?doc=${encodeURIComponent(desired)}${entityQuery}`,
      );
    }
  };

  const renderHeader = (state: AppState): void => {
    if (state.currentProject) {
      statusEl.textContent = `プロジェクト: ${state.currentProject.name}`;
      openPopupButton.hidden = true;
    } else {
      // 状態 A（ui-states.md §3）: 未選択メッセージ + Popup へ戻る導線を出す
      statusEl.textContent =
        'プロジェクトが選択されていません。Popup からプロジェクトを選択してください。';
      openPopupButton.hidden = false;
    }
  };

  const renderNav = (state: AppState): void => {
    const items = ROUTES.map((route) => {
      const guard = guardRoute(route.hash, state);
      const link = doc.createElement('a');
      link.href = route.hash;
      link.textContent = route.label;
      link.className = 'app__nav-link';
      if (route.hash === currentHash) {
        link.classList.add('app__nav-link--current');
        link.setAttribute('aria-current', 'page');
      }
      if (!guard.allowed) {
        // 状態 B（ui-states.md §3): ディム表示 + クリック時はトーストで案内し遷移しない
        link.classList.add('app__nav-link--dimmed');
        link.setAttribute('aria-disabled', 'true');
        link.addEventListener('click', (event) => {
          event.preventDefault();
          showToast(guard.message, doc);
        });
      }
      const item = doc.createElement('li');
      item.append(link);
      return item;
    });
    navEl.replaceChildren(...items);
  };

  const renderRoute = (): void => {
    const route = findRoute(currentHash);
    contentEl.replaceChildren(route.render(store.getState(), viewContext));
    contextEl.textContent = `${route.label} 画面を表示しています`;
  };

  const handleHashChange = (): void => {
    const target = normalizeHash(win.location.hash);
    const guard = guardRoute(target, store.getState());
    if (!guard.allowed) {
      showToast(guard.message, doc);
      win.location.hash = currentHash;
      return;
    }
    if (guard.warning) {
      showToast(guard.warning, doc);
    }
    currentHash = target;
    renderRoute();
    renderNav(store.getState());
    if (currentHash === '#/home') {
      // 起動時に読めなかった場合の再入場リトライ（読込済みなら loadProgressCounts 側で no-op）
      void loadProgressCounts(store, deps);
    }
    if (currentHash === '#/documents') {
      // 初回表示時に一覧を読み込む（読込済みなら loadDocuments 側で no-op）
      void loadDocuments(store, deps);
    }
    if (currentHash === '#/protocol') {
      // 初回表示時に全 version を読み込む（読込済みなら loadProtocols 側で no-op）
      void loadProtocols(store, deps);
    }
    if (currentHash === '#/schema') {
      // スキーマ一覧に加え、ドラフトフォームが使う文献一覧・プロトコルも先読みする
      void loadSchema(store, deps);
      void loadDocuments(store, deps);
      void loadProtocols(store, deps);
    }
    if (currentHash === '#/pilot') {
      // 文献 + スキーマの読込後に既定選択（テキスト層ありの先頭 3 本）を一度だけ適用する
      void Promise.all([loadDocuments(store, deps), loadSchema(store, deps)]).then(() => {
        initPilotSelection(store);
      });
    }
    if (currentHash === '#/extract') {
      // 文献 + スキーマ + 抽出済み document の読込後に既定選択（未抽出の全件）を一度だけ適用する
      void Promise.all([
        loadDocuments(store, deps),
        loadSchema(store, deps),
        loadExtractTargets(store, deps),
      ]).then(() => {
        initExtractSelection(store);
      });
    }
    if (currentHash === '#/verify') {
      // 一覧読込 → ?doc=（なければ先頭）の検証データ読込。セレクタ切替も同じ経路
      void syncVerifyRoute();
    }
    if (currentHash === '#/dashboard') {
      // 初回表示時に集計を読み込む（読込済みなら loadDashboard 側で no-op）
      void loadDashboard(store, deps);
    }
    if (currentHash === '#/export') {
      // 初回表示時に素材を読み込んで 3 形式の CSV を構築（読込済みなら loadExportData 側で no-op）
      void loadExportData(store, deps);
    }
  };

  titleButton.addEventListener('click', () => {
    win.location.hash = '#/home';
  });
  openPopupButton.addEventListener('click', () => {
    void chrome.tabs.create({ url: chrome.runtime.getURL('popup/popup.html') });
  });
  win.addEventListener('hashchange', handleHashChange);
  store.subscribe((state) => {
    renderHeader(state);
    renderNav(state);
    renderRoute();
  });

  renderHeader(store.getState());
  handleHashChange();
  // ガード・#/home サマリの進捗カウントを起動時に読み込む（プロジェクト未選択 /
  // E2E seam で counts 注入済み（countsLoaded）なら loadProgressCounts 側で no-op）
  void loadProgressCounts(store, deps);
  return store;
}
