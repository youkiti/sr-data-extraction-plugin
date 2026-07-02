// メインビューの起動配線: ストアのシード → ヘッダ / サイドバー描画 → ルーティング開始。
// E2E seam（test-strategy.md §2.1）: window.__E2E_PRELOADED_STATE__ があれば
// ストアのシードへ上書きマージする（本番動作には影響しない）
import { createInitialState, createStore, type AppState, type Store } from './store';
import { findRoute, normalizeHash, ROUTES, type RouteHash } from './router';
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
  persistPilotDecision,
  runPilot,
  setPilotModel,
  togglePilotDocument,
  type PilotServiceDeps,
} from './services/pilotService';
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
      documents: { ...state.documents, ...(preloaded.documents ?? {}) },
      protocol: { ...state.protocol, ...(preloaded.protocol ?? {}) },
      schema: { ...state.schema, ...(preloaded.schema ?? {}) },
      pilot: { ...state.pilot, ...(preloaded.pilot ?? {}) },
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
    },
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
  return store;
}
