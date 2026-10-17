import { installChromeMock } from '../../../setup/chrome-mock';
import { clearProjectSelection } from '../../../../src/features/project/projectStore';
import {
  loadProjectSheetVerdicts,
  saveProjectSheetVerdicts,
  clearProjectSheetVerdicts,
} from '../../../../src/features/project/projectSheetVerdicts';

beforeEach(() => { installChromeMock(); });

test.each([null, false, 42, 'broken', { sheet: true }])('保存値が配列でなければ空として扱う: %j', async (stored) => {
  await chrome.storage.local.set({ projectSheetVerdicts: stored });
  await expect(loadProjectSheetVerdicts()).resolves.toEqual(new Map());
});

test('不正な要素を飛ばし、文字列と真偽値のペアだけを読み込む', async () => {
  await chrome.storage.local.set({ projectSheetVerdicts: [
    null, 'broken', {}, [], ['short'], ['long', true, 'extra'],
    [42, true], ['wrong', 'true'], ['yes', true], ['no', false],
  ] });
  await expect(loadProjectSheetVerdicts()).resolves.toEqual(new Map([
    ['yes', true], ['no', false],
  ]));
});

test('未保存は空、true / false を一括保存・再読込できる', async () => {
  expect(await loadProjectSheetVerdicts()).toEqual(new Map());
  const verdicts = new Map([['a', true], ['b', false]]);
  await saveProjectSheetVerdicts(verdicts);
  expect(await loadProjectSheetVerdicts()).toEqual(verdicts);
  await clearProjectSheetVerdicts();
  expect(await loadProjectSheetVerdicts()).toEqual(new Map());
});

test('更新した ID を新しい順へ移し、古い判定から落として 200 件に制限する', async () => {
  await saveProjectSheetVerdicts(new Map(Array.from({ length: 200 }, (_, i) => [String(i), true])));
  await saveProjectSheetVerdicts(new Map([['0', false], ['200', true]]));
  const stored = await loadProjectSheetVerdicts();
  expect(stored.size).toBe(200);
  expect(stored.has('1')).toBe(false);
  expect(stored.get('0')).toBe(false);
  expect([...stored.keys()].slice(-2)).toEqual(['0', '200']);
});

test('ログアウトで判定も消去する', async () => {
  await saveProjectSheetVerdicts(new Map([['a', true]]));
  await clearProjectSelection();
  expect(await loadProjectSheetVerdicts()).toEqual(new Map());
});
