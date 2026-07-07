// service worker の実処理（エントリの service-worker.ts は起動フックのみ。
// architecture.md §4.1 のカバレッジ方針に合わせて deps 注入でテスト可能にする）。
//
// 拡張アイコンのクリックはポップアップを出さず、その場で新規タブを開く:
// - プロジェクト選択済み → メインビュー（app/app.html）
// - 未選択（初回起動・ログアウト後）→ S1 プロジェクト選択ページ（popup/popup.html。
//   メインビューの「プロジェクト選択（Popup）を開く」ボタンと同じフルページ表示）
import { loadCurrentProject } from '../features/project/projectStore';
import type { ProjectRef } from '../domain/project';

export interface BackgroundDeps {
  /** 現在のプロジェクト選択を読む（chrome.storage.local） */
  loadCurrentProject: () => Promise<ProjectRef | null>;
  /** 拡張内ページを新規タブで開く（パスは拡張ルートからの相対） */
  openTab: (path: string) => void;
}

export function createChromeBackgroundDeps(): BackgroundDeps {
  return {
    loadCurrentProject,
    openTab: (path: string) => {
      void chrome.tabs.create({ url: chrome.runtime.getURL(path) });
    },
  };
}

/** 拡張アイコンクリック時の遷移先を決めて新規タブで開く */
export async function handleActionClick(deps: BackgroundDeps): Promise<void> {
  const project = await deps.loadCurrentProject();
  deps.openTab(project !== null ? 'app/app.html' : 'popup/popup.html');
}
