// tiab-review 引き継ぎ受け渡し状態（S1 → S3。docs/ui-states.md §1 / §3）のテスト。
// chrome.storage.local に 1 スロットだけ保持する（projectStore と同じ設計）
import { installChromeMock } from '../../../setup/chrome-mock';
import {
  clearTiabHandoff,
  loadTiabHandoff,
  saveTiabHandoff,
  TIAB_HANDOFF_STORAGE_KEY,
  type TiabHandoff,
} from '../../../../src/features/project/tiabHandoffStore';

function handoff(): TiabHandoff {
  return { projectId: 'project-1', tiabSheetId: 'tiab-sheet-1' };
}

describe('tiabHandoffStore', () => {
  beforeEach(() => {
    installChromeMock();
  });

  test('未保存なら null', async () => {
    await expect(loadTiabHandoff()).resolves.toBeNull();
  });

  test('save → load で往復する', async () => {
    await saveTiabHandoff(handoff());
    await expect(loadTiabHandoff()).resolves.toEqual(handoff());
  });

  test('save は上書き保存する（最新の 1 件のみ保持）', async () => {
    await saveTiabHandoff(handoff());
    const next: TiabHandoff = { projectId: 'project-2', tiabSheetId: 'tiab-sheet-2' };
    await saveTiabHandoff(next);
    await expect(loadTiabHandoff()).resolves.toEqual(next);
  });

  test('clear で消えて null に戻る', async () => {
    await saveTiabHandoff(handoff());
    await clearTiabHandoff();
    await expect(loadTiabHandoff()).resolves.toBeNull();
  });

  test('ストレージキーは固定値', () => {
    expect(TIAB_HANDOFF_STORAGE_KEY).toBe('tiabHandoff');
  });
});
