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
import { createChromeAuthDeps } from '../lib/google/auth';
import {
  createChromeProfileDeps,
  getCurrentUserEmail,
  type ProfileDeps,
} from '../lib/google/identity';
import type { GoogleApiDeps } from '../lib/google/types';

export interface PopupDeps {
  /** メインビュー（app.html）を新規タブで開く */
  openAppTab: () => void;
  /** 設定画面（options.html）を開く */
  openOptions: () => void;
  /** Sheets / Drive API 呼び出し用の依存 */
  google: GoogleApiDeps;
  /** メールアドレス取得用の依存 */
  profile: ProfileDeps;
  /** 既にログイン済みかを UI を出さずに確認（interactive=false 相当） */
  isAuthenticated: () => Promise<boolean>;
  /** Google OAuth 同意 UI を明示的に開く。true=成功 / false=失敗 */
  signIn: () => Promise<boolean>;
  /**
   * ログアウト。キャッシュされた OAuth トークンを削除する。
   * Google 側のトークン失効は行わない（Chrome の identity キャッシュからの除去のみ）。
   * プロジェクト選択状態のクリアは呼び出し側（bindLogoutButton）が行う。
   */
  signOut: () => Promise<void>;
}

export function createChromePopupDeps(): PopupDeps {
  const auth = createChromeAuthDeps();
  return {
    openAppTab: () => {
      void chrome.tabs.create({ url: chrome.runtime.getURL('app/app.html') });
    },
    openOptions: () => {
      void chrome.tabs.create({ url: chrome.runtime.getURL('options/options.html') });
    },
    google: createChromeGoogleApiDeps(auth),
    profile: createChromeProfileDeps(),
    isAuthenticated: async () => {
      try {
        await auth.getAuthToken({ interactive: false });
        return true;
      } catch {
        return false;
      }
    },
    signIn: async () => {
      try {
        await auth.getAuthToken({ interactive: true });
        return true;
      } catch {
        return false;
      }
    },
    signOut: async () => {
      try {
        const token = await auth.getAuthToken({ interactive: false });
        await auth.removeCachedAuthToken(token);
      } catch {
        // トークンが既に無ければ何もしない
      }
    },
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
    els.status.textContent = 'ログインが必要です。';
    return;
  }

  await renderAccount(els, deps);
  const recent = await loadRecentProjects();
  renderRecent(doc, els, recent, deps);
  els.status.textContent =
    recent.length > 0
      ? '最近のプロジェクトから選ぶか、新しく作成してください。'
      : '新しいプロジェクトを作成するか、スプレッドシート ID から開いてください。';
}

async function renderAccount(els: PopupElements, deps: PopupDeps): Promise<void> {
  try {
    const email = await getCurrentUserEmail(deps.profile);
    els.email.textContent = email ?? '(不明)';
  } catch {
    els.email.textContent = '(不明)';
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
        els.loginError.textContent =
          'ログインに失敗しました。ブラウザに Google アカウントが追加されているか確認してください。';
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
    els.createSubmit.textContent = '作成中…';
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
        els.createSubmit.textContent = '作成';
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
