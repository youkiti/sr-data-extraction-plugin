import { getPendingWriteCount, subscribePendingWrites, trackPendingWrite } from '../../../../src/app/services/pendingWrites';
import { withSpreadsheetWriteLock } from '../../../../src/app/services/verificationService';
import { createSavingBadge, updateSavingBadges } from '../../../../src/app/ui/savingBadge';
import { setUiLanguage } from '../../../../src/lib/i18n';

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => { resolve = done; });
  return { promise, resolve };
}

test('待機中を含めた 3 件を数え、決着ごとに購読者へ通知する', async () => {
  const listener = jest.fn();
  const unsubscribe = subscribePendingWrites(() => listener(getPendingWriteCount()));
  const tasks = [deferred(), deferred(), deferred()];
  const writes = tasks.map((task) => withSpreadsheetWriteLock('sheet', () => task.promise));
  expect(getPendingWriteCount()).toBe(3);
  for (let i = 0; i < tasks.length; i += 1) {
    tasks[i]!.resolve();
    await writes[i];
    expect(getPendingWriteCount()).toBe(2 - i);
  }
  expect(listener.mock.calls.map(([n]) => n)).toEqual([1, 2, 3, 2, 1, 0]);
  unsubscribe();
  await withSpreadsheetWriteLock('sheet', async () => undefined);
  expect(listener).toHaveBeenCalledTimes(6);
});

test('異なるシートも合計し、同期例外・reject 後も件数を戻す', async () => {
  const task = deferred();
  const write = withSpreadsheetWriteLock('one', () => task.promise);
  await expect(withSpreadsheetWriteLock('two', async () => {
    expect(getPendingWriteCount()).toBe(2);
    throw new Error('保存失敗');
  })).rejects.toThrow('保存失敗');
  expect(getPendingWriteCount()).toBe(1);
  task.resolve();
  await write;
  await expect(trackPendingWrite(() => { throw new Error('登録失敗'); })).rejects.toThrow('登録失敗');
  expect(getPendingWriteCount()).toBe(0);
});

test('接続中の全バッジを同じ要素のまま更新し、新規作成時にも現在件数を使う', async () => {
  setUiLanguage('ja');
  const badges = ['verify-saving', 'pilot-saving', 'adjudicate-saving'].map(createSavingBadge);
  document.body.replaceChildren(...badges);
  const unsubscribe = subscribePendingWrites(() => updateSavingBadges(document));
  expect(badges.every((badge) => badge.hidden)).toBe(true);
  const task = deferred();
  const write = withSpreadsheetWriteLock('sheet', () => task.promise);
  for (const badge of badges) {
    expect(document.getElementById(badge.id)).toBe(badge);
    expect(badge.hidden).toBe(false);
    expect(badge.textContent).toBe('保存中（1 件）');
    expect(badge.getAttribute('role')).toBe('status');
  }
  expect(createSavingBadge('new').hidden).toBe(false);
  setUiLanguage('en');
  expect(createSavingBadge('english').textContent).toBe('Saving (1)');
  task.resolve();
  await write;
  expect(badges.every((badge) => badge.hidden)).toBe(true);
  unsubscribe();
  setUiLanguage('ja');
});
