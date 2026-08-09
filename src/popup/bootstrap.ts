// Popup（S1）の実処理。状態仕様は docs/ui-states.md §1
// （未ログイン / ログイン済 ×最近 0・N 件 / ログイン処理中 / ログイン失敗）。
//
// 任意のプロジェクト選択（作成・既存 ID・履歴クリック）は直後にメインビュータブを
// 開くので、独立した「メインビューを開く」ボタンは持たない（sr-query-builder と同一）。
// すべての deps を引数注入するので OAuth 無しでテスト可能。
import { createChromeGoogleApiDeps } from '../app/services/factories';
import { BUILD_DATE, withDevSuffix } from '../build-info';
import { createNewProject, loadExistingProject } from '../app/services/projectService';
import type { ProjectRef } from '../domain/project';
import {
  clearProjectSelection,
  loadRecentProjects,
  setCurrentProject,
} from '../features/project/projectStore';
import {
  createChromeAuthClientDeps,
  getAccessToken,
  signOut as brokerSignOut,
} from '../lib/google/auth';
import { listRecentSpreadsheets, type DriveSpreadsheetEntry } from '../lib/google/drive';
import {
  createChromeProfileDeps,
  getChromeProfileEmail,
  getCurrentUserEmail,
  type ProfileDeps,
} from '../lib/google/identity';
import {
  createChromePickerDeps,
  openSpreadsheetPicker,
  openTiabSpreadsheetPicker,
  type PickerSelection,
  type SpreadsheetPickResult,
} from '../lib/google/picker';
import { SheetsAccessDeniedError } from '../lib/google/sheets';
import type { GoogleApiDeps } from '../lib/google/types';
import { getUiLanguage, localizeDom, setUiLanguage, t } from '../lib/i18n';
import { applyPublicPageLanguage } from '../lib/publicPages';
import { loadUiLanguage } from '../lib/storage/settingsStore';
import { readTiabSheet } from '../features/documents/tiabSheetReader';
import { resolveAdoptedReferences } from '../features/documents/tiabReview';
import { saveTiabHandoff } from '../features/project/tiabHandoffStore';

export interface PopupDeps {
  /**
   * メインビュー（app.html）へ遷移する（S1 はフルページ表示のため同一タブを書き換える）。
   * hash を渡すと該当ルートへ直接遷移する（例: '#/documents'。tiab-review 引き継ぎ作成後）
   */
  openAppTab: (hash?: string) => void;
  /** 設定画面を開く（アプリ内 #/options へ同一タブ遷移） */
  openOptions: () => void;
  /** Sheets / Drive API 呼び出し用の依存 */
  google: GoogleApiDeps;
  /** メールアドレス取得用の依存（OAuth で認可したアカウントのメール） */
  profile: ProfileDeps;
  /**
   * Chrome プロファイルのメール。OAuth アカウントとの不一致表示にのみ使う
   * （取れなければ null。比較できないだけで機能には影響しない）
   */
  chromeProfileEmail: () => Promise<string | null>;
  /**
   * 共有シートの drive.file 許可用 Picker を開く（docs/ui-states.md §1「アクセス許可が必要」）。
   * 要求 ID と同じシートが選ばれたら 'granted'、別シートは 'mismatch'、キャンセルは 'cancelled'
   */
  openSpreadsheetPicker: (spreadsheetId: string) => Promise<SpreadsheetPickResult>;
  /**
   * tiab-review 引き継ぎ用の全シート選択 Picker（S1 #popup-tiab-handoff。docs/ui-states.md §1）。
   * `view=spreadsheet` を `file_id` 制限なしで開き、選択がそのまま drive.file 付与になる。
   * キャンセル / タブを閉じる → null
   */
  openTiabSheetPicker: () => Promise<PickerSelection | null>;
  /** 許可後の開き直し再試行の間隔待ち（テストで固定するため注入） */
  sleep: (ms: number) => Promise<void>;
  /** 既にログイン済みかを UI を出さずに確認（サイレント取得のみ） */
  isAuthenticated: () => Promise<boolean>;
  /** Google OAuth 認可ウィンドウを明示的に開く。true=成功 / false=失敗 */
  signIn: () => Promise<boolean>;
  /**
   * ログアウト。認証ブローカーがトークンを revoke（ベストエフォート）し、
   * セッションのトークンと保存済みメールを破棄する。
   * プロジェクト選択状態のクリアは呼び出し側（bindLogoutButton）が行う。
   */
  signOut: () => Promise<void>;
}

export function createChromePopupDeps(): PopupDeps {
  const auth = createChromeAuthClientDeps();
  const google = createChromeGoogleApiDeps(auth);
  return {
    openAppTab: (hash) => {
      // S1 は新規タブのフルページとして開かれるため、選択後は同一タブのまま
      // メインビューへ遷移する（タブを増やさない）。hash 指定で特定ルートへ直接遷移する
      void chrome.tabs.update({ url: chrome.runtime.getURL('app/app.html' + (hash ?? '')) });
    },
    openOptions: () => {
      // 設定はアプリ内 #/options として同一タブで開く（別タブを増やさない）。
      // メインビューのサイドバー・歯車リンクから各作業画面へ行き来できる
      void chrome.tabs.update({ url: chrome.runtime.getURL('app/app.html#/options') });
    },
    google,
    profile: createChromeProfileDeps(auth),
    chromeProfileEmail: () => getChromeProfileEmail(),
    openSpreadsheetPicker: (spreadsheetId) =>
      openSpreadsheetPicker(createChromePickerDeps(google), spreadsheetId),
    openTiabSheetPicker: () => openTiabSpreadsheetPicker(createChromePickerDeps(google)),
    sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
    isAuthenticated: async () => {
      try {
        await getAccessToken(auth, false);
        return true;
      } catch {
        return false;
      }
    },
    signIn: async () => {
      try {
        await getAccessToken(auth, true);
        return true;
      } catch {
        return false;
      }
    },
    signOut: () => brokerSignOut(auth),
  };
}

/** popup.html の必須要素一式。1 つでも欠けたら起動しない（collectElements） */
interface PopupElements {
  status: HTMLElement;
  auth: HTMLElement;
  projects: HTMLElement;
  loginButton: HTMLButtonElement;
  loginError: HTMLElement;
  email: HTMLElement;
  accountNote: HTMLElement;
  logoutButton: HTMLButtonElement;
  recentSection: HTMLElement;
  recentForm: HTMLFormElement;
  recentSelect: HTMLSelectElement;
  recentSubmit: HTMLButtonElement;
  recentError: HTMLElement;
  createForm: HTMLFormElement;
  createTitle: HTMLInputElement;
  createSubmit: HTMLButtonElement;
  createError: HTMLElement;
  openForm: HTMLFormElement;
  openId: HTMLInputElement;
  openError: HTMLElement;
  openGrant: HTMLButtonElement;
  tiabPick: HTMLButtonElement;
  tiabForm: HTMLFormElement;
  tiabTitle: HTMLInputElement;
  tiabSubmit: HTMLButtonElement;
  tiabStatus: HTMLElement;
  tiabError: HTMLElement;
  openOptionsButton: HTMLElement;
}

function collectElements(doc: Document): PopupElements | null {
  const els = {
    status: doc.getElementById('popup-status'),
    auth: doc.getElementById('popup-auth'),
    projects: doc.getElementById('popup-projects'),
    loginButton: doc.getElementById('login-button'),
    loginError: doc.getElementById('login-error'),
    email: doc.getElementById('popup-email'),
    accountNote: doc.getElementById('popup-account-note'),
    logoutButton: doc.getElementById('logout-button'),
    recentSection: doc.getElementById('popup-recent-section'),
    recentForm: doc.getElementById('popup-recent-form'),
    recentSelect: doc.getElementById('popup-recent-select'),
    recentSubmit: doc.querySelector('#popup-recent-form button[type="submit"]'),
    recentError: doc.getElementById('popup-recent-error'),
    createForm: doc.getElementById('popup-create-form'),
    createTitle: doc.getElementById('popup-create-title'),
    createSubmit: doc.querySelector('#popup-create-form button[type="submit"]'),
    createError: doc.getElementById('popup-create-error'),
    openForm: doc.getElementById('popup-open-form'),
    openId: doc.getElementById('popup-open-id'),
    openError: doc.getElementById('popup-open-error'),
    openGrant: doc.getElementById('popup-open-grant'),
    tiabPick: doc.getElementById('tiab-pick'),
    tiabForm: doc.getElementById('tiab-create-form'),
    tiabTitle: doc.getElementById('tiab-project-title'),
    tiabSubmit: doc.getElementById('tiab-create-submit'),
    tiabStatus: doc.getElementById('tiab-status'),
    tiabError: doc.getElementById('tiab-error'),
    openOptionsButton: doc.getElementById('open-options'),
  };
  for (const el of Object.values(els)) {
    if (el === null) {
      return null;
    }
  }
  return els as unknown as PopupElements;
}

export async function bootstrapPopup(doc: Document, deps: PopupDeps): Promise<void> {
  const els = collectElements(doc);
  if (!els) {
    return;
  }
  // 表示言語（issue #93）: 保存値を反映してから静的文言（data-i18n 系属性）を解決する。
  // Popup 自体に言語セレクタは無く、切替は Options で行う（次回表示時に反映）
  setUiLanguage(await loadUiLanguage());
  doc.documentElement.lang = getUiLanguage();
  localizeDom(doc);
  // 公開ページ（ヘルプ）も同じ言語で開くよう href へ ?lang= を反映する
  applyPublicPageLanguage(doc, getUiLanguage());
  // dev ビルドではヘッダーのアプリ名・タブタイトルにも manifest 名と同じ「 (dev)」を
  // 付ける（要素が無い環境では何もしない。以下のビルド日表示も同様）
  doc.title = withDevSuffix(doc.title);
  const popupTitleEl = doc.querySelector('.popup__title');
  if (popupTitleEl) {
    popupTitleEl.textContent = withDevSuffix(popupTitleEl.textContent);
  }

  // アプリ名の下にビルド日を表示する
  const buildDateEl = doc.getElementById('popup-build-date');
  if (buildDateEl) {
    buildDateEl.textContent = `build ${BUILD_DATE}`;
  }
  // 最近のスプレッドシート（issue #245）。select の value（spreadsheet ID）から
  // 「どちらを優先して開くか」を引けるよう、refresh() のたびに renderRecent が
  // このマップを作り直す（bindRecentForm と同じ Map インスタンスを参照させる）
  const recentEntries = new Map<string, RecentEntry>();
  bindLoginButton(doc, els, deps, recentEntries);
  bindLogoutButton(doc, els, deps, recentEntries);
  els.openOptionsButton.addEventListener('click', () => {
    deps.openOptions();
  });
  bindCreateForm(els, deps);
  bindOpenForm(els, deps);
  bindTiabHandoff(els, deps);
  bindRecentForm(els, deps, recentEntries);
  await refresh(doc, els, deps, recentEntries);
}

async function refresh(
  doc: Document,
  els: PopupElements,
  deps: PopupDeps,
  recentEntries: Map<string, RecentEntry>
): Promise<void> {
  const authed = await deps.isAuthenticated();
  els.auth.hidden = authed;
  els.projects.hidden = !authed;

  if (!authed) {
    els.status.textContent = t('popup.statusLoginRequired');
    return;
  }

  await renderAccount(els, deps);
  await renderRecent(doc, els, deps, recentEntries);
  els.status.textContent =
    recentEntries.size > 0 ? t('popup.statusPickRecent') : t('popup.statusCreateOrOpen');
}

async function renderAccount(els: PopupElements, deps: PopupDeps): Promise<void> {
  els.accountNote.hidden = true;
  els.accountNote.textContent = '';
  let email: string | null = null;
  try {
    email = await getCurrentUserEmail(deps.profile);
    els.email.textContent = email ?? t('popup.emailUnknown');
  } catch {
    els.email.textContent = t('popup.emailUnknown');
  }
  if (email === null) {
    return;
  }
  // launchWebAuthFlow では Chrome プロファイル以外のアカウントも選べるため、
  // 不一致時は明示表示する（annotator / created_by はこの OAuth アカウントで記録される）
  try {
    const profileEmail = await deps.chromeProfileEmail();
    if (profileEmail !== null && profileEmail !== email) {
      els.accountNote.hidden = false;
      els.accountNote.textContent = t('popup.accountMismatch', { profileEmail });
    }
  } catch {
    // 不一致表示は補助情報。取得失敗時は何も出さない
  }
}

/** listRecentSpreadsheets に渡す取得件数。履歴用途のプルダウンなので多くは要らない */
const RECENT_SPREADSHEETS_MAX = 15;

/**
 * 「最近のスプレッドシート」select の 1 option 分（issue #245）。
 * `localRef` があれば開く際にローカル履歴（検証スキップの速い経路）を優先する。
 * Drive のみで見つかった ID は `localRef: null`（開く際に loadExistingProject で検証する）
 */
interface RecentEntry {
  id: string;
  /** ファイル名のみ（識別子はここに含めない。option 生成時に id の先頭 8 文字を付ける） */
  label: string;
  localRef: ProjectRef | null;
}

/**
 * ローカル履歴（recentProjects）と Drive の最近のスプレッドシート一覧をマージして
 * select を組み立てる（issue #245）。
 *
 * マージ規則: Drive の返却順（recency 降順）を先頭に、Drive に無いローカル履歴を
 * 末尾に追加する。両方にある ID は Drive 側の位置に 1 つだけ出し、ラベルは Drive の
 * ファイル名を使う（開く際の実体はローカルの ProjectRef を優先 — openRecentEntry 参照）。
 * 同名プロジェクトを区別できるよう、option の表示テキストは末尾に spreadsheet ID の
 * 先頭 8 文字を付ける（旧 UI の `${name} — ${projectId.slice(0, 8)}` に相当。
 * createProject はファイル名にそのまま projectTitle を使うため、同名タイトルで
 * 作った複数プロジェクトがファイル名だけでは区別できない）。
 *
 * Drive 呼び出し失敗（権限未取得・オフライン等）はセクションを消さず、ローカル履歴のみで
 * 一覧を作る（アクセストークン等の機微情報を含みうるため詳細はログにのみ残す）。
 */
async function renderRecent(
  doc: Document,
  els: PopupElements,
  deps: PopupDeps,
  recentEntries: Map<string, RecentEntry>
): Promise<void> {
  recentEntries.clear();
  els.recentSelect.replaceChildren();

  const local = await loadRecentProjects();
  let driveFiles: DriveSpreadsheetEntry[] = [];
  try {
    driveFiles = await listRecentSpreadsheets(RECENT_SPREADSHEETS_MAX, deps.google);
  } catch (err) {
    console.error('[popup] 最近のスプレッドシート（Drive）の取得に失敗しました', err);
  }

  const localById = new Map(local.map((ref) => [ref.spreadsheetId, ref]));
  const merged: RecentEntry[] = [];
  const seen = new Set<string>();
  for (const file of driveFiles) {
    if (seen.has(file.id)) {
      continue;
    }
    seen.add(file.id);
    merged.push({ id: file.id, label: file.name, localRef: localById.get(file.id) ?? null });
  }
  for (const ref of local) {
    if (seen.has(ref.spreadsheetId)) {
      continue;
    }
    seen.add(ref.spreadsheetId);
    merged.push({ id: ref.spreadsheetId, label: ref.name, localRef: ref });
  }

  if (merged.length === 0) {
    els.recentSection.hidden = true;
    return;
  }
  els.recentSection.hidden = false;
  for (const entry of merged) {
    recentEntries.set(entry.id, entry);
    const option = doc.createElement('option');
    option.value = entry.id;
    // 同名プロジェクト（同名スプレッドシート）を区別できるよう id の先頭 8 文字を付ける
    option.textContent = `${entry.label} — ${entry.id.slice(0, 8)}`;
    els.recentSelect.appendChild(option);
  }
}

/**
 * 選択したスプレッドシートを開く（issue #245）。
 * ローカル履歴に一致すればそれを優先し（検証をスキップできる速い経路）、
 * Drive のみで見つかった場合は loadExistingProject で検証してから開く。
 */
async function openRecentEntry(
  id: string,
  entry: RecentEntry | undefined,
  deps: PopupDeps
): Promise<void> {
  if (entry?.localRef) {
    await setCurrentProject(entry.localRef);
    return;
  }
  await loadExistingProject(id, { google: deps.google, profile: deps.profile });
}

function bindRecentForm(
  els: PopupElements,
  deps: PopupDeps,
  recentEntries: Map<string, RecentEntry>
): void {
  els.recentForm.addEventListener('submit', (event) => {
    event.preventDefault();
    els.recentError.textContent = '';
    const id = els.recentSelect.value;
    if (id === '') {
      return;
    }
    els.recentSubmit.disabled = true;
    els.recentSubmit.textContent = t('popup.recentOpening');
    void openRecentEntry(id, recentEntries.get(id), deps)
      .then(() => {
        deps.openAppTab();
      })
      .catch((err: unknown) => {
        if (err instanceof SheetsAccessDeniedError) {
          // このセクションには許可導線（Picker ボタン）を持たない。
          // 許可が必要な場合は「スプレッドシート ID / URL で開く」セクションへ誘導する
          els.recentError.textContent = t('popup.accessNeeded');
          return;
        }
        els.recentError.textContent = formatError(err);
      })
      .finally(() => {
        els.recentSubmit.disabled = false;
        els.recentSubmit.textContent = t('popup.recentOpen');
      });
  });
}

function bindLoginButton(
  doc: Document,
  els: PopupElements,
  deps: PopupDeps,
  recentEntries: Map<string, RecentEntry>
): void {
  els.loginButton.addEventListener('click', () => {
    els.loginError.textContent = '';
    // 状態 C（ログイン処理中）: ボタンを無効化して Google 認可ウィンドウの結果を待つ
    els.loginButton.disabled = true;
    void deps.signIn().then(async (ok) => {
      els.loginButton.disabled = false;
      if (!ok) {
        // 状態 D（ログイン失敗）
        els.loginError.textContent = t('popup.loginFailed');
        return;
      }
      await refresh(doc, els, deps, recentEntries);
    });
  });
}

function bindLogoutButton(
  doc: Document,
  els: PopupElements,
  deps: PopupDeps,
  recentEntries: Map<string, RecentEntry>
): void {
  els.logoutButton.addEventListener('click', () => {
    // E-Popup-4: 処理中の再クリックを防ぐ
    els.logoutButton.disabled = true;
    void deps
      .signOut()
      // プロジェクト選択状態もユーザーに紐付くため一緒にクリアする
      // （別アカウントでログインし直しても他人の recent が残らない）
      .then(() => clearProjectSelection())
      .then(() => refresh(doc, els, deps, recentEntries))
      .finally(() => {
        els.logoutButton.disabled = false;
      });
  });
}

function bindCreateForm(els: PopupElements, deps: PopupDeps): void {
  els.createForm.addEventListener('submit', (event) => {
    event.preventDefault();
    els.createError.textContent = '';
    els.createSubmit.disabled = true;
    els.createSubmit.textContent = t('popup.creating');
    void createNewProject(els.createTitle.value, { google: deps.google, profile: deps.profile })
      .then(() => {
        els.createTitle.value = '';
        deps.openAppTab();
      })
      .catch((err: unknown) => {
        els.createError.textContent = formatError(err);
      })
      .finally(() => {
        els.createSubmit.disabled = false;
        els.createSubmit.textContent = t('popup.createSubmit');
      });
  });
}

/** 許可後の開き直し再試行（docs/ui-states.md §1「アクセス許可が必要」） */
const GRANT_RETRY_MAX = 3;
const GRANT_RETRY_INTERVAL_MS = 2_000;

function bindOpenForm(els: PopupElements, deps: PopupDeps): void {
  // 「Google で許可する」の対象 ID。アクセス拒否時にセットし、フォーム再送でリセット
  let grantTargetId: string | null = null;

  els.openForm.addEventListener('submit', (event) => {
    event.preventDefault();
    els.openError.textContent = '';
    grantTargetId = null;
    els.openGrant.hidden = true;
    void loadExistingProject(els.openId.value, { google: deps.google, profile: deps.profile })
      .then(() => {
        els.openId.value = '';
        deps.openAppTab();
      })
      .catch((err: unknown) => {
        if (err instanceof SheetsAccessDeniedError) {
          // drive.file では未許可と不存在を区別できないため、Picker 許可導線を出す
          grantTargetId = err.spreadsheetId;
          els.openError.textContent = t('popup.accessNeeded');
          els.openGrant.hidden = false;
          return;
        }
        els.openError.textContent = formatError(err);
      });
  });

  els.openGrant.addEventListener('click', () => {
    const spreadsheetId = grantTargetId;
    if (spreadsheetId === null || els.openGrant.disabled) {
      return;
    }
    els.openGrant.disabled = true;
    els.openGrant.textContent = t('popup.grantWaiting');
    void runGrantFlow(els, deps, spreadsheetId).finally(() => {
      els.openGrant.disabled = false;
      els.openGrant.textContent = t('popup.openGrant');
    });
  });
}

/**
 * 「Google で許可する」→ スプレッドシート Picker → 開き直し再試行（最大 3 回・約 2 秒間隔）。
 * 失敗が続いた場合は最終文言に切り替えて打ち切る（再誘導ループしない。ui-states.md §1）
 */
async function runGrantFlow(
  els: PopupElements,
  deps: PopupDeps,
  spreadsheetId: string,
): Promise<void> {
  let result: SpreadsheetPickResult;
  try {
    result = await deps.openSpreadsheetPicker(spreadsheetId);
  } catch (err) {
    els.openError.textContent = formatError(err);
    return;
  }
  if (result === 'cancelled') {
    // 案内文とボタンは残す（ユーザーがもう一度押せる）
    return;
  }
  if (result === 'mismatch') {
    els.openError.textContent = t('popup.grantMismatch');
    return;
  }
  for (let attempt = 1; attempt <= GRANT_RETRY_MAX; attempt += 1) {
    try {
      await loadExistingProject(spreadsheetId, { google: deps.google, profile: deps.profile });
      els.openId.value = '';
      els.openError.textContent = '';
      els.openGrant.hidden = true;
      deps.openAppTab();
      return;
    } catch (err) {
      if (!(err instanceof SheetsAccessDeniedError)) {
        // 許可は通ったが別の検証エラー（別ツールのシート等）。通常のエラー表示に戻す
        els.openError.textContent = formatError(err);
        els.openGrant.hidden = true;
        return;
      }
      if (attempt < GRANT_RETRY_MAX) {
        await deps.sleep(GRANT_RETRY_INTERVAL_MS);
      }
    }
  }
  els.openError.textContent = t('popup.grantStillDenied');
  els.openGrant.hidden = true;
}

/**
 * Picker 選択直後のシート検証読み。Picker での選択（= drive.file 付与）は Sheets API への
 * 伝播に数秒かかることがある（runGrantFlow と同じ事情）ため、アクセス拒否
 * （SheetsAccessDeniedError）だけは最大 GRANT_RETRY_MAX 回・GRANT_RETRY_INTERVAL_MS 間隔で
 * リトライする。それ以外の失敗（tiab-review のシートでない等）は即座に投げ直す
 */
async function readTiabSheetWithGrantRetry(
  deps: PopupDeps,
  sheetId: string,
): ReturnType<typeof readTiabSheet> {
  for (let attempt = 1; ; attempt += 1) {
    try {
      return await readTiabSheet(sheetId, deps.google);
    } catch (err) {
      if (!(err instanceof SheetsAccessDeniedError) || attempt >= GRANT_RETRY_MAX) {
        throw err;
      }
      await deps.sleep(GRANT_RETRY_INTERVAL_MS);
    }
  }
}

/**
 * tiab-review から引き継いで作成（S1 #popup-tiab-handoff。docs/ui-states.md §1 状態 A〜E）。
 * Picker でシートを選ぶ → References / Decisions を直読みして include 件数を検証 →
 * タイトル確認フォームで新規プロジェクトを作成し、引き継ぎ状態（tiab シート ID）を
 * chrome.storage.local（プロジェクト単位キー）へ保存して S3 documents（#/documents）へ
 * 直接遷移する。
 */
function bindTiabHandoff(els: PopupElements, deps: PopupDeps): void {
  // 検証成功した tiab シートの ID（作成フォーム submit で使う。別シートの選び直しで更新される）
  let checkedSheetId: string | null = null;

  els.tiabPick.addEventListener('click', () => {
    els.tiabError.textContent = '';
    els.tiabPick.disabled = true;
    // 状態 B: Picker 選択中
    els.tiabStatus.textContent = t('popup.tiabPicking');
    void deps
      .openTiabSheetPicker()
      .then(async (selection) => {
        if (selection === null) {
          // キャンセル / タブを閉じる: 状態 A へ戻る（既に検証済みのフォームがあれば維持する）
          els.tiabStatus.textContent = '';
          return;
        }
        // 状態 C: 検証中（付与直後の伝播遅延はリトライで吸収する）
        els.tiabStatus.textContent = t('popup.tiabChecking');
        const sheet = await readTiabSheetWithGrantRetry(deps, selection.sourceFileId);
        const adopted = resolveAdoptedReferences(
          sheet.references,
          sheet.decisions,
          sheet.activeFulltextAiRound,
        );
        if (adopted.includes.length === 0) {
          // include 0 件のまま作成しても S3 の引き継ぎで取り込めるものが無い（行き止まり）
          // ため、作成へ進ませず tiab-review 側の判定状況の確認を促す
          checkedSheetId = null;
          els.tiabForm.hidden = true;
          els.tiabStatus.textContent = '';
          els.tiabError.textContent = t('popup.tiabNoIncludes');
          return;
        }
        // 状態 D: 作成確認
        checkedSheetId = selection.sourceFileId;
        els.tiabForm.hidden = false;
        els.tiabTitle.value = selection.filename;
        els.tiabStatus.textContent = t('popup.tiabDetected', { n: adopted.includes.length });
      })
      .catch((err: unknown) => {
        // tiab-review のシートでない等の検証失敗: 状態 A へ戻す
        els.tiabError.textContent = formatError(err);
        els.tiabStatus.textContent = '';
        els.tiabForm.hidden = true;
        checkedSheetId = null;
      })
      .finally(() => {
        els.tiabPick.disabled = false;
      });
  });

  els.tiabForm.addEventListener('submit', (event) => {
    event.preventDefault();
    els.tiabError.textContent = '';
    const sheetId = checkedSheetId;
    // 状態 E: 作成中
    els.tiabSubmit.disabled = true;
    els.tiabSubmit.textContent = t('popup.creating');
    void createNewProject(els.tiabTitle.value, { google: deps.google, profile: deps.profile })
      .then(async (ref) => {
        if (sheetId !== null) {
          // 引き継ぎ状態の保存はベストエフォート — プロジェクトは既に作成済みなので、
          // storage の失敗で作成を失敗扱いにしない（失敗時は S3 の引き継ぎパネルが
          // 出ないだけで、従来の手動導線で続行できる。エラー表示のまま再送信させると
          // 同一プロジェクトの二重作成につながる）
          await saveTiabHandoff(ref.projectId, { tiabSheetId: sheetId }).catch(() => undefined);
        }
        deps.openAppTab('#/documents');
      })
      .catch((err: unknown) => {
        // 状態 E（作成失敗）: プロジェクトは作られていないので再送信でやり直せる
        els.tiabError.textContent = formatError(err);
      })
      .finally(() => {
        els.tiabSubmit.disabled = false;
        els.tiabSubmit.textContent = t('popup.tiabCreateSubmit');
      });
  });
}

function formatError(err: unknown): string {
  if (err instanceof Error) return err.message;
  return String(err);
}
