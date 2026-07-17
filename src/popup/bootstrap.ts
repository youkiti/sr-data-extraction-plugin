// Popup（S1）の実処理。状態仕様は docs/ui-states.md §1
// （未ログイン / ログイン済 ×最近 0・N 件 / ログイン処理中 / ログイン失敗）。
//
// 任意のプロジェクト選択（作成・既存 ID・履歴クリック）は直後にメインビュータブを
// 開くので、独立した「メインビューを開く」ボタンは持たない（sr-query-builder と同一）。
// すべての deps を引数注入するので OAuth 無しでテスト可能。
import { createChromeGoogleApiDeps } from '../app/services/factories';
import { BUILD_DATE } from '../build-info';
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
import {
  createChromeProfileDeps,
  getChromeProfileEmail,
  getCurrentUserEmail,
  type ProfileDeps,
} from '../lib/google/identity';
import type { GoogleApiDeps } from '../lib/google/types';
import { getUiLanguage, localizeDom, setUiLanguage, t } from '../lib/i18n';
import { loadUiLanguage } from '../lib/storage/settingsStore';

export interface PopupDeps {
  /** メインビュー（app.html）へ遷移する（S1 はフルページ表示のため同一タブを書き換える） */
  openAppTab: () => void;
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
  return {
    openAppTab: () => {
      // S1 は新規タブのフルページとして開かれるため、選択後は同一タブのまま
      // メインビューへ遷移する（タブを増やさない）
      void chrome.tabs.update({ url: chrome.runtime.getURL('app/app.html') });
    },
    openOptions: () => {
      // 設定はアプリ内 #/options として同一タブで開く（別タブを増やさない）。
      // メインビューのサイドバー・歯車リンクから各作業画面へ行き来できる
      void chrome.tabs.update({ url: chrome.runtime.getURL('app/app.html#/options') });
    },
    google: createChromeGoogleApiDeps(auth),
    profile: createChromeProfileDeps(auth),
    chromeProfileEmail: () => getChromeProfileEmail(),
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
  recentList: HTMLElement;
  createForm: HTMLFormElement;
  createTitle: HTMLInputElement;
  createSubmit: HTMLButtonElement;
  createError: HTMLElement;
  openForm: HTMLFormElement;
  openId: HTMLInputElement;
  openError: HTMLElement;
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
    recentList: doc.getElementById('popup-recent'),
    createForm: doc.getElementById('popup-create-form'),
    createTitle: doc.getElementById('popup-create-title'),
    createSubmit: doc.querySelector('#popup-create-form button[type="submit"]'),
    createError: doc.getElementById('popup-create-error'),
    openForm: doc.getElementById('popup-open-form'),
    openId: doc.getElementById('popup-open-id'),
    openError: doc.getElementById('popup-open-error'),
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
  // アプリ名の下にビルド日を表示する（要素が無い環境では何もしない）
  const buildDateEl = doc.getElementById('popup-build-date');
  if (buildDateEl) {
    buildDateEl.textContent = `build ${BUILD_DATE}`;
  }
  bindLoginButton(doc, els, deps);
  bindLogoutButton(doc, els, deps);
  els.openOptionsButton.addEventListener('click', () => {
    deps.openOptions();
  });
  bindCreateForm(els, deps);
  bindOpenForm(els, deps);
  await refresh(doc, els, deps);
}

async function refresh(doc: Document, els: PopupElements, deps: PopupDeps): Promise<void> {
  const authed = await deps.isAuthenticated();
  els.auth.hidden = authed;
  els.projects.hidden = !authed;

  if (!authed) {
    els.status.textContent = t('popup.statusLoginRequired');
    return;
  }

  await renderAccount(els, deps);
  const recent = await loadRecentProjects();
  renderRecent(doc, els, recent, deps);
  els.status.textContent =
    recent.length > 0 ? t('popup.statusPickRecent') : t('popup.statusCreateOrOpen');
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

function renderRecent(
  doc: Document,
  els: PopupElements,
  recent: ProjectRef[],
  deps: PopupDeps
): void {
  els.recentList.replaceChildren();
  if (recent.length === 0) {
    els.recentSection.hidden = true;
    return;
  }
  els.recentSection.hidden = false;
  for (const entry of recent) {
    const li = doc.createElement('li');
    const btn = doc.createElement('button');
    btn.type = 'button';
    btn.textContent = `${entry.name} — ${entry.projectId.slice(0, 8)}`;
    btn.addEventListener('click', () => {
      void setCurrentProject(entry).then(() => {
        deps.openAppTab();
      });
    });
    li.appendChild(btn);
    els.recentList.appendChild(li);
  }
}

function bindLoginButton(doc: Document, els: PopupElements, deps: PopupDeps): void {
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
      await refresh(doc, els, deps);
    });
  });
}

function bindLogoutButton(doc: Document, els: PopupElements, deps: PopupDeps): void {
  els.logoutButton.addEventListener('click', () => {
    // E-Popup-4: 処理中の再クリックを防ぐ
    els.logoutButton.disabled = true;
    void deps
      .signOut()
      // プロジェクト選択状態もユーザーに紐付くため一緒にクリアする
      // （別アカウントでログインし直しても他人の recent が残らない）
      .then(() => clearProjectSelection())
      .then(() => refresh(doc, els, deps))
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

function bindOpenForm(els: PopupElements, deps: PopupDeps): void {
  els.openForm.addEventListener('submit', (event) => {
    event.preventDefault();
    els.openError.textContent = '';
    void loadExistingProject(els.openId.value, { google: deps.google, profile: deps.profile })
      .then(() => {
        els.openId.value = '';
        deps.openAppTab();
      })
      .catch((err: unknown) => {
        els.openError.textContent = formatError(err);
      });
  });
}

function formatError(err: unknown): string {
  if (err instanceof Error) return err.message;
  return String(err);
}
