// Popup（S1）の実処理。プロジェクトの新規作成ウィザード（S2）・切替 UI は今後実装し、
// スケルトン段階は「現在のプロジェクト表示 + メインビューを開く」のみ提供する
// （docs/ui-states.md §1 の drift 注記参照）
import { loadCurrentProject } from '../features/project/projectStore';

export async function bootstrapPopup(doc: Document): Promise<void> {
  const statusEl = doc.getElementById('popup-status');
  const projectEl = doc.getElementById('popup-project');
  const openButton = doc.getElementById('open-app');
  if (!statusEl || !projectEl || !openButton) {
    return;
  }
  const project = await loadCurrentProject();
  if (project) {
    statusEl.textContent = '現在のプロジェクト:';
    projectEl.textContent = project.name;
    projectEl.hidden = false;
  } else {
    statusEl.textContent = 'プロジェクトが未選択です。メインビューは空状態で開きます。';
    projectEl.hidden = true;
  }
  openButton.addEventListener('click', () => {
    void chrome.tabs.create({ url: chrome.runtime.getURL('app/app.html') });
  });
}
