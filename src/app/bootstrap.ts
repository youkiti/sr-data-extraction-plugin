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
  persistPilotRelocateQuote,
  runPilot,
  setPilotLayoutMode,
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
  persistVerifyRelocateQuote,
  setVerifyLayoutMode,
} from './services/verifyService';
import { loadDashboard } from './services/dashboardService';
import { loadProgressCounts } from './services/homeService';
import {
  acceptAllMatchingCells,
  addAdjudicateArmDraftRow,
  adjudicateCellChoice,
  adjudicateCellCustomValue,
  adjudicateCellNotReported,
  backToAdjudicateList,
  confirmAdjudicateArms,
  downloadAgreementCsv,
  loadAdjudicateTargets,
  loadAgreementReport,
  openAdjudicateStudy,
  removeAdjudicateArmDraftRow,
  setAdjudicateMismatchOnlyFilter,
  skipAdjudicateCell,
  undoAdjudicateCell,
  unskipAdjudicateCell,
  updateAdjudicateArmDraftRow,
} from './services/adjudicationService';
import {
  cancelReviewerChange,
  confirmReviewerChange,
  copyReviewInvite,
  loadReviewers,
  requestAddReviewer,
  revokeReviewer,
} from './services/reviewerAdminService';
import { grantFolderAccess, loadRole } from './services/roleService';
import {
  cancelExportWarning,
  changeMethodsLanguage,
  changeMethodsWorkflow,
  confirmExportGenerate,
  copyMethodsText,
  downloadExportResult,
  loadExportData,
  requestExportGenerate,
  selectExportFormat,
} from './services/exportService';
import { createChromeGoogleApiDeps } from './services/factories';
import type { ProjectRole } from '../domain/reviewer';
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
import { el } from './ui/dom';

declare global {
  interface Window {
    __E2E_PRELOADED_STATE__?: Partial<AppState>;
  }
}

/**
 * 解決済みロール。プロジェクト選択済みでロール未確定（null）の間は roleBlockOf が先に
 * 全画面ブロックするため、null がここまで来るのはプロジェクト未選択セッションだけ
 * = 従来どおり 'owner'（制限なし）として扱う
 */
function roleOf(state: AppState): ProjectRole {
  return state.role.role ?? 'owner';
}

/** プロジェクト選択済みセッションでロールが確定していない間の全画面ブロック種別 */
type RoleBlock =
  | { kind: 'resolving' }
  | { kind: 'error'; message: string }
  | { kind: 'unregistered' };

/**
 * 盲検のフェイルクローズ判定（docs/design-independent-dual-review.md §3）。
 * プロジェクト選択済みなのにロールが確定していない（解決待ち / 解決失敗 / 未登録）間は、
 * reviewer かもしれないセッションへ owner 向けの UI・データ読込を開放しない（null = 通常表示）。
 * 一時的な読込エラーで owner 側へフォールバックしない = フェイルクローズがこの関数の要点
 */
function roleBlockOf(state: AppState): RoleBlock | null {
  if (state.currentProject === null) {
    return null; // プロジェクト未選択に盲検対象のデータはない（各ローダも project なしで no-op）
  }
  if (state.role.role === 'unregistered') {
    return { kind: 'unregistered' };
  }
  if (state.role.error !== null) {
    return { kind: 'error', message: state.role.error };
  }
  if (state.role.role === null) {
    return { kind: 'resolving' };
  }
  return null;
}

/**
 * 未登録（unregistered）の全画面ブロック（docs/design-independent-dual-review.md §1）。
 * 共有はされているが Reviewers にも Meta.created_by にも一致しない場合に、
 * 以降の読み込みを中断してこれだけを表示する
 */
function renderUnregisteredBlock(): HTMLElement {
  return el('section', { id: 'app-role-blocked', className: 'view view--role-blocked' }, [
    el('h2', { text: 'アクセスできません' }),
    el('p', {
      attributes: { role: 'alert' },
      text: 'このプロジェクトのレビュアーとして登録されていません。プロジェクトのオーナーに登録を依頼してください。',
    }),
  ]);
}

/** ロール解決待ちのプレースホルダ（盲検のフェイルクローズ: 確定前はどのルートも描画しない） */
function renderRoleResolvingBlock(): HTMLElement {
  return el('section', { id: 'app-role-resolving', className: 'view view--role-blocked' }, [
    el('p', { text: 'このプロジェクトでのロールを確認しています…' }),
  ]);
}

/**
 * ロール解決失敗の全画面ブロック。盲検のフェイルクローズ: 一時的な読込エラーで reviewer に
 * owner 向け UI（全ナビ + エクスポート等）を開放しないため、確認できるまで再試行のみを提供する
 */
function renderRoleErrorBlock(message: string, onRetry: () => void): HTMLElement {
  const retry = el('button', {
    id: 'app-role-retry',
    text: '再試行',
    attributes: { type: 'button' },
  });
  retry.addEventListener('click', onRetry);
  return el('section', { id: 'app-role-error', className: 'view view--role-blocked' }, [
    el('h2', { text: 'ロールを確認できませんでした' }),
    el('p', {
      attributes: { role: 'alert' },
      text: `このプロジェクトでのロールを確認できませんでした: ${message}`,
    }),
    el('p', { text: '盲検保護のため、ロールを確認できるまで画面を表示しません。' }),
    retry,
  ]);
}

export async function seedState(win: Window): Promise<AppState> {
  const state = createInitialState();
  const storedProject = await loadCurrentProject();
  if (storedProject) {
    state.currentProject = storedProject;
  }
  const preloaded = win.__E2E_PRELOADED_STATE__;
  if (preloaded) {
    // ロールは通常メインビュー起動時に Sheets を読んで解決する（roleService.loadRole）。
    // E2E / 単体テストの既定は「プロジェクトが選択済みなら owner 視点で完結させる」
    // （home.countsLoaded と同じ考え方の seam）。reviewer シナリオを検証する spec は
    // role を明示注入して上書きする（下の `...(preloaded.role ?? {})` が勝つ）
    const mergedProject = preloaded.currentProject !== undefined ? preloaded.currentProject : state.currentProject;
    const defaultRole: AppState['role'] =
      mergedProject !== null
        ? { ...state.role, role: 'owner', resolving: false, error: null, folderAccessGranted: true }
        : state.role;
    // レビュアー一覧も同じ考え方: 明示注入が無ければ「読込済み（0 件）」として扱い、
    // #/home 入場時の自動読込（owner のレビュアー管理カード）を抑止する
    const defaultReviewers: AppState['reviewers'] =
      mergedProject !== null ? { ...state.reviewers, assignments: [] } : state.reviewers;
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
      role: { ...defaultRole, ...(preloaded.role ?? {}) },
      reviewers: { ...defaultReviewers, ...(preloaded.reviewers ?? {}) },
      documents: { ...state.documents, ...(preloaded.documents ?? {}) },
      protocol: { ...state.protocol, ...(preloaded.protocol ?? {}) },
      schema: { ...state.schema, ...(preloaded.schema ?? {}) },
      pilot: { ...state.pilot, ...(preloaded.pilot ?? {}) },
      extract: { ...state.extract, ...(preloaded.extract ?? {}) },
      verify: { ...state.verify, ...(preloaded.verify ?? {}) },
      dashboard: { ...state.dashboard, ...(preloaded.dashboard ?? {}) },
      export: { ...state.export, ...(preloaded.export ?? {}) },
      adjudicate: { ...state.adjudicate, ...(preloaded.adjudicate ?? {}) },
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
  // 防御の多重化: 直近にガード評価したロール（ロールが確定・変化したときだけ現在ルートを再ガードする）
  let lastGuardedRole: ProjectRole | null = null;

  // view のユーザー操作をサービス層へ委譲するコンテキスト（views/types.ts）
  const viewContext: ViewContext = {
    home: {
      onReload: () => {
        void loadProgressCounts(store, deps, { force: true });
      },
      onGrantFolderAccess: () => {
        void grantFolderAccess(store, deps);
      },
      onReloadReviewers: () => {
        void loadReviewers(store, deps, { force: true });
      },
      onAddReviewer: (input) => {
        void requestAddReviewer(store, deps, input);
      },
      onConfirmReviewerChange: () => {
        void confirmReviewerChange(store, deps);
      },
      onCancelReviewerChange: () => {
        cancelReviewerChange(store);
      },
      onRevokeReviewer: (email) => {
        void revokeReviewer(store, deps, email);
      },
      onCopyInvite: (email) => {
        void copyReviewInvite(store, deps, email);
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
      onRelocateQuote: (evidence) => persistPilotRelocateQuote(store, deps, evidence),
      onChangeLayoutMode: (mode) => {
        void setPilotLayoutMode(store, deps, mode);
      },
      onReloadVerification: () => {
        // 保存の競合検出バナー（issue #64）の「再読み込み」: 埋め込み検証中の study を読み直す
        const studyId = store.getState().pilot.verifyStudyId;
        if (studyId !== null) {
          void loadPilotVerification(store, deps, studyId);
        }
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
      onRelocateQuote: (evidence) => persistVerifyRelocateQuote(store, deps, evidence),
      onChangeLayoutMode: (mode) => {
        void setVerifyLayoutMode(store, deps, mode);
      },
      onReloadVerification: () => {
        // 保存の競合検出バナー（issue #64）の「再読み込み」: 表示中 study を読み直す
        const studyId = store.getState().verify.selectedStudyId;
        if (studyId !== null) {
          void openVerifyStudy(store, deps, studyId);
        }
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
      onChangeMethodsLanguage: (language) => {
        changeMethodsLanguage(store, language);
      },
      onChangeMethodsWorkflow: (workflow) => {
        changeMethodsWorkflow(store, workflow);
      },
      onCopyMethods: () => {
        void copyMethodsText(store, deps);
      },
    },
    adjudicate: {
      onSelectStudy: (studyId) => {
        // hash 書き換え → hashchange → syncAdjudicateRoute の一本道（#/verify と同じ経路）
        win.location.hash = `#/adjudicate?study=${encodeURIComponent(studyId)}`;
      },
      onBackToList: () => {
        backToAdjudicateList(store);
        win.location.hash = '#/adjudicate';
      },
      onRetryLoad: () => {
        void loadAdjudicateTargets(store, deps, { force: true });
      },
      onArmDraftChange: (index, armName) => {
        updateAdjudicateArmDraftRow(store, index, armName);
      },
      onArmDraftAdd: () => {
        addAdjudicateArmDraftRow(store);
      },
      onArmDraftRemove: (index) => {
        removeAdjudicateArmDraftRow(store, index);
      },
      onConfirmArms: (arms) => {
        void confirmAdjudicateArms(store, deps, arms);
      },
      onAcceptAllMatches: () => {
        void acceptAllMatchingCells(store, deps);
      },
      onChooseA: (cellKey) => {
        void adjudicateCellChoice(store, deps, cellKey, 'A');
      },
      onChooseB: (cellKey) => {
        void adjudicateCellChoice(store, deps, cellKey, 'B');
      },
      onCustomValue: (cellKey, value) => {
        void adjudicateCellCustomValue(store, deps, cellKey, value);
      },
      onNotReported: (cellKey) => {
        void adjudicateCellNotReported(store, deps, cellKey);
      },
      onSkip: (cellKey) => {
        skipAdjudicateCell(store, cellKey);
      },
      onUnskip: (cellKey) => {
        unskipAdjudicateCell(store, cellKey);
      },
      onUndo: (cellKey) => {
        void undoAdjudicateCell(store, deps, cellKey);
      },
      onToggleMismatchOnly: (value) => {
        setAdjudicateMismatchOnlyFilter(store, value);
      },
      onLoadAgreement: () => {
        void loadAgreementReport(store, deps);
      },
      onDownloadAgreementCsv: (kind) => {
        downloadAgreementCsv(store, deps, kind);
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

  /**
   * `#/adjudicate` の表示同期: study 一覧を読み込み、`?study=` があれば裁定作業データを開く
   * （openAdjudicateStudy 側がペア未確定・ゲート未達を検知して workingError へ案内文言を入れる）。
   * `?study=` が無い場合は一覧表示のまま留まる（#/verify と異なり「先頭 study を自動選択」はしない
   * — 一覧のゲート状況を見て裁定者が選ぶのが自然な導線のため）
   */
  const syncAdjudicateRoute = async (): Promise<void> => {
    await loadAdjudicateTargets(store, deps);
    const desired = studyQueryOf(win.location.hash);
    if (desired !== null && desired !== store.getState().adjudicate.selectedStudyId) {
      await openAdjudicateStudy(store, deps, desired);
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
    // 盲検のフェイルクローズ: ロール未確定・解決失敗・未登録の間はナビ自体を出さない
    if (roleBlockOf(state) !== null) {
      navEl.replaceChildren();
      return;
    }
    const role = roleOf(state);
    // reviewer 系ロールは Home と検証だけを表示する（ディムではなく非表示。design §3・§3.1）。
    // adjudicator はこれに加えて #/adjudicate も表示する（owner は既定で adjudicator を兼務するため
    // ROUTES 全件に #/adjudicate が含まれる）
    const visibleRoutes = ROUTES.filter((route) => {
      if (role === 'owner') {
        return true;
      }
      if (route.hash === '#/home' || route.hash === '#/verify') {
        return true;
      }
      return route.hash === '#/adjudicate' && role === 'adjudicator';
    });
    const items = visibleRoutes.map((route) => {
      const guard = guardRoute(route.hash, state, role);
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
    const state = store.getState();
    const block = roleBlockOf(state);
    if (block !== null) {
      // 盲検のフェイルクローズ: ロールが確定するまでどのルートも描画しない（design §1・§3）
      if (block.kind === 'unregistered') {
        contentEl.replaceChildren(renderUnregisteredBlock());
        contextEl.textContent = 'アクセスできません';
      } else if (block.kind === 'error') {
        contentEl.replaceChildren(renderRoleErrorBlock(block.message, retryRole));
        contextEl.textContent = 'ロールを確認できませんでした';
      } else {
        contentEl.replaceChildren(renderRoleResolvingBlock());
        contextEl.textContent = 'ロールを確認しています';
      }
      return;
    }
    const route = findRoute(currentHash);
    contentEl.replaceChildren(route.render(state, viewContext));
    contextEl.textContent = `${route.label} 画面を表示しています`;
  };

  const handleHashChange = (): void => {
    // 盲検のフェイルクローズ: ロール未確定・解決失敗・未登録の間はルート処理（ローダ発火）を行わない
    if (roleBlockOf(store.getState()) !== null) {
      renderRoute();
      renderNav(store.getState());
      return;
    }
    const target = normalizeHash(win.location.hash);
    const guard = guardRoute(target, store.getState(), roleOf(store.getState()));
    if (!guard.allowed) {
      showToast(guard.message, doc);
      win.location.hash = currentHash;
      return;
    }
    if (guard.warning) {
      showToast(guard.warning, doc);
    }
    // #/options へ入る直前のルートを記録する（B. 設定画面の「戻る」改善）。
    // #/options 自体への遷移でのみ更新し、それ以外のステップ間遷移では触らない。
    // setState は購読経由で全再描画を同期発火するため、currentHash を先に新ルートへ
    // 進めてから記録する — 逆順だと退出元ビューの無駄な再構築が 1 回走る
    const previous = currentHash;
    currentHash = target;
    if (target === '#/options' && previous !== '#/options') {
      store.setState({ settingsReturnHash: previous });
    }
    renderRoute();
    renderNav(store.getState());
    if (currentHash === '#/home') {
      // 起動時に読めなかった場合の再入場リトライ（読込済みなら loadProgressCounts 側で no-op。
      // reviewer 系ロールには homeService 側のガードで呼ばれない）
      void loadProgressCounts(store, deps);
      // owner のレビュアー管理カード（reviewer 系ロールには reviewerAdminService 側のガードでも守る）
      void loadReviewers(store, deps);
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
    if (currentHash === '#/adjudicate') {
      // 一覧読込 → ?study=（あれば）の裁定データ読込。セレクタ切替も同じ経路
      void syncAdjudicateRoute();
    }
  };

  /**
   * 初期ルーティング + 進捗カウントの起動時読込（ロール確定後 / 再試行成功後の合流点）。
   * counts の読込は loadProgressCounts 側でも no-op 判定される（プロジェクト未選択 /
   * countsLoaded / reviewer 系ロール）
   */
  const startRouting = (): void => {
    handleHashChange();
    // 盲検のフェイルクローズ: ロールを確認できないまま counts（Decisions 総数等）を読まない
    if (roleBlockOf(store.getState()) === null) {
      void loadProgressCounts(store, deps);
    }
  };

  /** ロール解決失敗画面の「再試行」。解決できたら初期ルーティングをやり直す */
  const retryRole = (): void => {
    void loadRole(store, deps).then(() => {
      if (roleBlockOf(store.getState()) === null) {
        startRouting();
      }
    });
  };

  titleButton.addEventListener('click', () => {
    win.location.hash = '#/home';
  });
  // #app-open-popup はプロジェクト選択ページ（popup.html）への同一タブ遷移アンカー
  // （app.html 側の href="../popup/popup.html"）。JS の配線は不要
  win.addEventListener('hashchange', handleHashChange);
  store.subscribe((state) => {
    // 防御の多重化（盲検のフェイルクローズ）: ロールが確定・変化したタイミングで現在ルートを
    // 再ガードし、不許可になっていたら描画前に #/home へ退避する（セッション中のロール変化への備え）
    const block = roleBlockOf(state);
    const effectiveRole = block === null ? roleOf(state) : null;
    if (effectiveRole !== null && effectiveRole !== lastGuardedRole) {
      lastGuardedRole = effectiveRole;
      const guard = guardRoute(currentHash, state, effectiveRole);
      if (!guard.allowed) {
        showToast(guard.message, doc);
        currentHash = '#/home';
        win.location.hash = '#/home';
      }
    }
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
  // 盲検のフェイルクローズ: プロジェクト選択済みの実セッションでは、ロールを解決し終える
  // まで初期ルーティング（ルートローダ発火）を行わない — reviewer の直リンクで owner 向けの
  // データ（エクスポートの audit プレビュー・進捗カウント等）が読み込まれるのを防ぐ。
  // E2E seam でロール注入済み / プロジェクト未選択なら待ちは発生しない
  if (roleBlockOf(store.getState())?.kind === 'resolving') {
    renderNav(store.getState());
    renderRoute();
    await loadRole(store, deps);
  }
  startRouting();
  return store;
}
