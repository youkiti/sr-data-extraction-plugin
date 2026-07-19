// tiab-review 引き継ぎ受け渡し状態（S1 → S3。docs/ui-states.md §1 / §3）のテスト。
// chrome.storage.local に **プロジェクト単位のキー** で保持する（ignoredCandidatesKey と同じ流儀）
import { installChromeMock } from '../../../setup/chrome-mock';
import {
  clearTiabHandoff,
  loadTiabHandoff,
  saveTiabHandoff,
  tiabHandoffKey,
  type TiabHandoff,
} from '../../../../src/features/project/tiabHandoffStore';

function handoff(): TiabHandoff {
  return { tiabSheetId: 'tiab-sheet-1' };
}

describe('tiabHandoffStore', () => {
  beforeEach(() => {
    installChromeMock();
  });

  test('未保存なら null', async () => {
    await expect(loadTiabHandoff('project-1')).resolves.toBeNull();
  });

  test('save → load で往復する', async () => {
    await saveTiabHandoff('project-1', handoff());
    await expect(loadTiabHandoff('project-1')).resolves.toEqual(handoff());
  });

  test('save は同一プロジェクトぶんを上書き保存する（最新の 1 件のみ保持）', async () => {
    await saveTiabHandoff('project-1', handoff());
    const next: TiabHandoff = { tiabSheetId: 'tiab-sheet-2' };
    await saveTiabHandoff('project-1', next);
    await expect(loadTiabHandoff('project-1')).resolves.toEqual(next);
  });

  test('clear で消えて null に戻る', async () => {
    await saveTiabHandoff('project-1', handoff());
    await clearTiabHandoff('project-1');
    await expect(loadTiabHandoff('project-1')).resolves.toBeNull();
  });

  test('プロジェクト別に独立している（A を clear しても B は残る）', async () => {
    await saveTiabHandoff('project-a', { tiabSheetId: 'tiab-sheet-a' });
    await saveTiabHandoff('project-b', { tiabSheetId: 'tiab-sheet-b' });
    await clearTiabHandoff('project-a');
    await expect(loadTiabHandoff('project-a')).resolves.toBeNull();
    await expect(loadTiabHandoff('project-b')).resolves.toEqual({ tiabSheetId: 'tiab-sheet-b' });
  });

  test('ストレージキーはプロジェクト単位', () => {
    expect(tiabHandoffKey('project-1')).toBe('sr-data-extraction:tiab-handoff:project-1');
    expect(tiabHandoffKey('project-2')).toBe('sr-data-extraction:tiab-handoff:project-2');
  });
});
