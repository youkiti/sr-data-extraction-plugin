// メインビューの起動配線: ストアのシード → ヘッダ / サイドバー描画 → ルーティング開始。
// E2E seam（test-strategy.md §2.1）: window.__E2E_PRELOADED_STATE__ があれば
// ストアのシードへ上書きマージする（本番動作には影響しない）
import { createInitialState, createStore, type AppState, type Store, type VerifyTarget } from './store';
import { studyQueryOf, entityQueryOf, findRoute, normalizeHash, ROUTES, type RouteHash } from './router';
import { guardRoute } from './guards';
import { showToast } from './ui/toast';
import type { ViewContext } from './views/types';
import {
  cancelMerge,
  confirmMerge,
  ignoreCandidate,
  importFromFiles,
  importFromPicker,
  loadDocuments,
  openMergeCandidate,
  openMergeDialog,
  saveDocumentRole,
  saveRegistrationId,
  saveStudyLabel,
  toggleStudySelection,
  updateMergeDialog,
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
  insertSchemaPreset,
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
  autoLoadLatestPilotRun,
  initPilotSelection,
  loadPilotHistory,
  loadPilotRun,
  loadPilotVerification,
  persistPilotArmConfirmation,
  persistPilotDecision,
  persistPilotInstanceDeclarations,
  runPilot,
  setPilotModel,
  togglePilotStudy,
  type PilotServiceDeps,
} from './services/pilotService';
import {
  cancelExtractConfirm,
  initExtractSelection,
  loadExtractTargets,
  requestExtractRun,
  retryExtractStudy,
  runExtract,
  setExtractModel,
  toggleExtractStudy,
} from './services/extractService';
import {
  loadVerifyTargets,
  openVerifyStudy,
  persistVerifyArmConfirmation,
  persistVerifyDecision,
  persistVerifyInstanceDeclarations,
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
import { BUILD_DATE } from '../build-info';
import { createChromeProfileDeps } from '../lib/google/identity';
import { createChromePickerDeps } from '../lib/google/picker';
import { createProvider } from '../lib/llm/providerFactory';
import { loadDisposablePdf } from '../lib/pdf/loadPdf';
import {
  loadGeminiApiKey,
  loadOpenAiCompatibleApiKey,
  loadOpenRouterApiKey,
} from '../lib/storage/secretsStore';
import {
  loadLlmConnectionSettings,
  resolveRateLimitPolicy,
} from '../lib/storage/settingsStore';

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
    loadApiKey: (provider) => {
      if (provider === 'openrouter') {
        return loadOpenRouterApiKey();
      }
      if (provider === 'openai_compatible') {
        return loadOpenAiCompatibleApiKey();
      }
      return loadGeminiApiKey();
    },
    loadLlmConnectionSettings,
    buildProvider: createProvider,
    resolveRateLimitPolicy,
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

  // アプリ名の下にビルド日を表示する（要素が無い環境では何もしない）
  const buildDateEl = doc.getElementById('app-build-date');
  if (buildDateEl) {
    buildDateEl.textContent = `build ${BUILD_DATE}`;
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
      onImportFiles: (files) => {
        void importFromFiles(store, deps, files);
      },
      onReload: () => {
        void loadDocuments(store, deps, { force: true });
      },
      onSaveStudyLabel: (studyId, label) => {
        void saveStudyLabel(store, deps, studyId, label);
      },
      onSaveRegistrationId: (studyId, registrationId) => {
        void saveRegistrationId(store, deps, studyId, registrationId);
      },
      onSaveDocumentRole: (documentId, role) => {
        void saveDocumentRole(store, deps, documentId, role);
      },
      onToggleStudySelection: (studyId, selected) => {
        toggleStudySelection(store, studyId, selected);
      },
      onOpenMerge: () => {
        openMergeDialog(store);
      },
      onOpenMergeCandidate: (studyIds) => {
        openMergeCandidate(store, studyIds);
      },
      onIgnoreCandidate: (studyIds) => {
        void ignoreCandidate(store, deps, studyIds);
      },
      onUpdateMergeLabel: (label) => {
        updateMergeDialog(store, { label });
      },
      onUpdateMergeRegistration: (registrationId) => {
        updateMergeDialog(store, { registrationId });
      },
      onConfirmMerge: () => {
        void confirmMerge(store, deps);
      },
      onCancelMerge: () => {
        cancelMerge(store);
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
        insertSchemaPreset(store, kind);
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
      onToggleStudy: (studyId, selected) => {
        togglePilotStudy(store, studyId, selected);
      },
      onChangeModel: (model) => {
        setPilotModel(store, model);
      },
      onRun: () => {
        void runPilot(store, deps);
      },
      onSelectRun: (runId) => {
        void loadPilotRun(store, deps, runId);
      },
      onReloadHistory: () => {
        void loadPilotHistory(store, deps, { force: true }).then(() =>
          autoLoadLatestPilotRun(store, deps),
        );
      },
      onSelectVerifyStudy: (studyId) => {
        void loadPilotVerification(store, deps, studyId);
      },
      onRetryVerifyLoad: () => {
        const studyId = store.getState().pilot.verifyStudyId;
        if (studyId !== null) {
          void loadPilotVerification(store, deps, studyId);
        }
      },
      onDecision: (decision) => {
        void persistPilotDecision(store, deps, decision);
      },
      onArmConfirm: (arms) => {
        void persistPilotArmConfirmation(store, deps, arms);
      },
      onInstanceDeclare: (decisions) => {
        void persistPilotInstanceDeclarations(store, deps, decisions);
      },
    },
    extract: {
      onToggleStudy: (studyId, selected) => {
        toggleExtractStudy(store, studyId, selected);
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
      onRetryStudy: (studyId) => {
        void retryExtractStudy(store, deps, studyId);
      },
      onReloadTargets: () => {
        void loadDocuments(store, deps, { force: true });
        void loadExtractTargets(store, deps, { force: true });
      },
    },
    verify: {
      onSelectStudy: (studyId) => {
        // hash 書き換え → hashchange → syncVerifyRoute の一本道（直リンクと同じ経路を通す）
        win.location.hash = `#/verify?study=${encodeURIComponent(studyId)}`;
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
      onInstanceDeclare: (decisions) => {
        void persistVerifyInstanceDeclarations(store, deps, decisions);
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
   * #/verify の表示同期: 一覧を読み込み、?study=（なければ選択済み or 先頭）を開く。
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
      studyQueryOf(win.location.hash) ??
      verify.selectedStudyId ??
      (targets[0] as VerifyTarget).study.studyId;
    // 読み込み中の再入は openVerifyStudy 側の verifyLoading ガードが弾く
    const alreadyShown =
      desired === verify.selectedStudyId &&
      (verify.verification !== null || verify.verifyError !== null);
    if (!alreadyShown) {
      await openVerifyStudy(store, deps, desired);
    }
    // 初回入場（?study= 無し）は既定 study を URL へ書き戻し、リロード・共有・戻る操作で
    // 同じ study へ着地できるようにする。replaceState は hashchange を発火しないため
    // 再入ループにならず履歴も汚さない（セル単位ディープリンクの ?entity= は保つ）
    if (studyQueryOf(win.location.hash) === null) {
      const entityQuery = entity !== null ? `&entity=${encodeURIComponent(entity)}` : '';
      win.history.replaceState(
        null,
        '',
        `#/verify?study=${encodeURIComponent(desired)}${entityQuery}`,
      );
    }
  };

  const renderHeader = (state: AppState): void => {
    if (state.currentProject) {
      // プロジェクト名自体をプロジェクト選択ページへの同一タブ遷移リンクにする
      const link = doc.createElement('a');
      link.className = 'app__status-link';
      link.href = '../popup/popup.html';
      link.title = '別のプロジェクトを開く';
      link.textContent = `プロジェクト: ${state.currentProject.name}`;
      statusEl.replaceChildren(link);
      openPopupButton.hidden = true;
    } else {
      // 状態 A（ui-states.md §3）: 未選択メッセージ + プロジェクト選択ページへ戻る導線を出す
      statusEl.textContent =
        'プロジェクトが選択されていません。「プロジェクト選択を開く」から選択してください。';
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
      // 文献 + スキーマ + パイロット履歴の読込後に、既定選択（テキスト層ありの先頭 3 本）を
      // 一度だけ適用し、既存のパイロット結果があれば最新 run を一度だけ自動読込する
      void Promise.all([
        loadDocuments(store, deps),
        loadSchema(store, deps),
        loadPilotHistory(store, deps),
      ]).then(() => {
        initPilotSelection(store);
        void autoLoadLatestPilotRun(store, deps);
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
  // #app-open-popup はプロジェクト選択ページ（popup.html）への同一タブ遷移アンカー
  // （app.html 側の href="../popup/popup.html"）。JS の配線は不要
  win.addEventListener('hashchange', handleHashChange);
  store.subscribe((state) => {
    // ストア更新の再描画は route 全体を replaceChildren で作り直すため、ページ全体
    // （documentElement）のスクロール位置が一旦 0 へクランプされる。ナビゲーション
    // （hashchange）と違い同一画面の部分更新なので、退避して復元する（例: パイロットの
    // 論文チェック・モデル選択・判定操作のたびに一覧の先頭へ戻ってしまうのを防ぐ）
    const scrollTop = doc.documentElement.scrollTop;
    const scrollLeft = doc.documentElement.scrollLeft;
    renderHeader(state);
    renderNav(state);
    renderRoute();
    doc.documentElement.scrollTop = scrollTop;
    doc.documentElement.scrollLeft = scrollLeft;
  });

  renderHeader(store.getState());
  handleHashChange();
  // ガード・#/home サマリの進捗カウントを起動時に読み込む（プロジェクト未選択 /
  // E2E seam で counts 注入済み（countsLoaded）なら loadProgressCounts 側で no-op）
  void loadProgressCounts(store, deps);
  return store;
}
