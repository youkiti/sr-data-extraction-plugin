// 画面右下のトースト通知。role="status" でスクリーンリーダにも通知する
const TOAST_CONTAINER_ID = 'toast-container';

export const TOAST_DURATION_MS = 4000;

export function showToast(message: string, doc: Document = document): void {
  let container = doc.getElementById(TOAST_CONTAINER_ID);
  if (!container) {
    container = doc.createElement('div');
    container.id = TOAST_CONTAINER_ID;
    container.className = 'toast-container';
    doc.body.append(container);
  }
  const toast = doc.createElement('p');
  toast.className = 'toast';
  toast.setAttribute('role', 'status');
  toast.textContent = message;
  container.append(toast);
  setTimeout(() => {
    toast.remove();
  }, TOAST_DURATION_MS);
}
