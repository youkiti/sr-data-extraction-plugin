import { TOAST_DURATION_MS, showToast } from '../../../../src/app/ui/toast';

describe('showToast', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    document.body.innerHTML = '';
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  test('コンテナを生成して role="status" のトーストを追加する', () => {
    showToast('保存しました');
    const container = document.getElementById('toast-container');
    expect(container).not.toBeNull();
    const toast = container?.querySelector('.toast');
    expect(toast?.getAttribute('role')).toBe('status');
    expect(toast?.textContent).toBe('保存しました');
  });

  test('2 回目以降は既存コンテナを再利用する', () => {
    showToast('1 件目');
    showToast('2 件目');
    expect(document.querySelectorAll('#toast-container')).toHaveLength(1);
    expect(document.querySelectorAll('.toast')).toHaveLength(2);
  });

  test('表示時間経過後に自動で消える', () => {
    showToast('消えるメッセージ');
    expect(document.querySelectorAll('.toast')).toHaveLength(1);
    jest.advanceTimersByTime(TOAST_DURATION_MS);
    expect(document.querySelectorAll('.toast')).toHaveLength(0);
  });
});
