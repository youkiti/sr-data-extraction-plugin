import {
  cancelEditProtocol,
  loadProtocols,
  selectProtocolVersion,
  startEditProtocol,
  submitProtocol,
  type ProtocolServiceDeps,
} from '../../../../src/app/services/protocolService';
import { createInitialState, createStore, type Store } from '../../../../src/app/store';
import type { Protocol } from '../../../../src/domain/protocol';
import { listProtocols } from '../../../../src/features/protocol/protocolRepository';
import { saveProtocol } from '../../../../src/features/protocol/saveProtocol';
import { ensureChildFolder } from '../../../../src/lib/google/drive';

jest.mock('../../../../src/features/protocol/protocolRepository', () => ({
  listProtocols: jest.fn(),
}));
jest.mock('../../../../src/features/protocol/saveProtocol', () => ({
  saveProtocol: jest.fn(),
}));
jest.mock('../../../../src/lib/google/drive', () => ({
  ensureChildFolder: jest.fn(),
}));

const listProtocolsMock = listProtocols as jest.MockedFunction<typeof listProtocols>;
const saveProtocolMock = saveProtocol as jest.MockedFunction<typeof saveProtocol>;
const ensureChildFolderMock = ensureChildFolder as jest.MockedFunction<typeof ensureChildFolder>;

function makeProtocol(version: number, overrides: Partial<Protocol> = {}): Protocol {
  return {
    version,
    frameworkType: null,
    researchQuestion: '',
    inclusionCriteria: null,
    exclusionCriteria: null,
    studyDesign: null,
    blockCount: 0,
    combinationExpression: '',
    sourceType: 'manual',
    sourceFilename: null,
    rawTextRef: null,
    rawTextPreview: 'preview',
    rawTextInline: '本文',
    createdAt: '2026-07-02T00:00:00Z',
    createdBy: 'tester@example.com',
    ...overrides,
  };
}

function makeDeps(email = 'tester@example.com'): {
  deps: ProtocolServiceDeps;
  extractDocxText: jest.Mock;
} {
  const extractDocxText = jest.fn(async () => 'docx から抽出した本文');
  return {
    deps: {
      google: { fetch: jest.fn() as unknown as typeof fetch, getAccessToken: async () => 't' },
      profile: { getProfileUserInfo: async () => ({ email, id: 'uid' }) },
      extractDocxText,
    },
    extractDocxText,
  };
}

function makeStore(withProject = true): Store {
  const initial = createInitialState();
  if (withProject) {
    initial.currentProject = {
      projectId: 'p1',
      spreadsheetId: 'sheet-1',
      driveFolderId: 'folder-1',
      name: 'テスト SR',
    };
  }
  return createStore(initial);
}

function toastTexts(): string[] {
  return Array.from(document.querySelectorAll('.toast')).map((node) => node.textContent ?? '');
}

beforeEach(() => {
  jest.clearAllMocks();
  document.body.innerHTML = '';
  ensureChildFolderMock.mockResolvedValue({
    id: 'folder-raw',
    webViewLink: 'https://drive.google.com/drive/folders/folder-raw',
  });
});

describe('loadProtocols', () => {
  test('プロジェクト未選択なら何もしない', async () => {
    await loadProtocols(makeStore(false), makeDeps().deps);
    expect(listProtocolsMock).not.toHaveBeenCalled();
  });

  test('読込中は何もしない', async () => {
    const store = makeStore();
    store.setState({ protocol: { ...store.getState().protocol, loading: true } });
    await loadProtocols(store, makeDeps().deps);
    expect(listProtocolsMock).not.toHaveBeenCalled();
  });

  test('読込済みなら no-op、force 指定時のみ再読込する', async () => {
    const store = makeStore();
    store.setState({ protocol: { ...store.getState().protocol, records: [] } });
    await loadProtocols(store, makeDeps().deps);
    expect(listProtocolsMock).not.toHaveBeenCalled();

    listProtocolsMock.mockResolvedValue([makeProtocol(1)]);
    await loadProtocols(store, makeDeps().deps, { force: true });
    expect(listProtocolsMock).toHaveBeenCalledWith('sheet-1', expect.anything());
    expect(store.getState().protocol.records).toHaveLength(1);
  });

  test('成功: records と進捗カウントを反映し、選択版をリセットする', async () => {
    const store = makeStore();
    store.setState({ protocol: { ...store.getState().protocol, selectedVersion: 9 } });
    listProtocolsMock.mockResolvedValue([makeProtocol(2), makeProtocol(1)]);
    await loadProtocols(store, makeDeps().deps);
    const { protocol, counts } = store.getState();
    expect(protocol.records?.map((r) => r.version)).toEqual([2, 1]);
    expect(protocol.loading).toBe(false);
    expect(protocol.selectedVersion).toBeNull();
    expect(counts.protocolVersions).toBe(2);
  });

  test('失敗: loadError に文言を残す（Error 以外は文字列化）', async () => {
    const store = makeStore();
    listProtocolsMock.mockRejectedValue(new Error('403'));
    await loadProtocols(store, makeDeps().deps);
    expect(store.getState().protocol.loadError).toBe('403');
    expect(store.getState().protocol.loading).toBe(false);

    listProtocolsMock.mockRejectedValue('壊れた応答');
    await loadProtocols(store, makeDeps().deps, { force: true });
    expect(store.getState().protocol.loadError).toBe('壊れた応答');
  });
});

describe('submitProtocol', () => {
  test('プロジェクト未選択・保存中は何もしない', async () => {
    await submitProtocol(makeStore(false), makeDeps().deps, {
      sourceType: 'manual',
      inlineText: '本文',
    });
    const store = makeStore();
    store.setState({ protocol: { ...store.getState().protocol, saving: true } });
    await submitProtocol(store, makeDeps().deps, { sourceType: 'manual', inlineText: '本文' });
    expect(saveProtocolMock).not.toHaveBeenCalled();
  });

  test('手入力の保存成功: raw_protocols 解決 → saveProtocol → records 先頭へ追加 + トースト', async () => {
    const store = makeStore();
    const { deps } = makeDeps();
    const saved = makeProtocol(1);
    saveProtocolMock.mockResolvedValue(saved);

    await submitProtocol(store, deps, { sourceType: 'manual', inlineText: 'P: 成人肺炎' });

    expect(ensureChildFolderMock).toHaveBeenCalledWith('raw_protocols', 'folder-1', deps.google);
    expect(saveProtocolMock).toHaveBeenCalledWith(
      {
        spreadsheetId: 'sheet-1',
        rawProtocolsFolderId: 'folder-raw',
        parsed: expect.objectContaining({ sourceType: 'manual', plainText: 'P: 成人肺炎' }),
        createdBy: 'tester@example.com',
      },
      { google: deps.google },
    );
    const { protocol, counts } = store.getState();
    expect(protocol.records).toEqual([saved]);
    expect(protocol.saving).toBe(false);
    expect(protocol.editing).toBe(false);
    expect(protocol.draftText).toBe('');
    expect(counts.protocolVersions).toBe(1);
    expect(toastTexts()).toContain('プロトコル v1 を保存しました');
  });

  test('読込済み records には先頭へ追加し、選択版をリセットする', async () => {
    const store = makeStore();
    store.setState({
      protocol: {
        ...store.getState().protocol,
        records: [makeProtocol(1)],
        editing: true,
        selectedVersion: 1,
      },
    });
    saveProtocolMock.mockResolvedValue(makeProtocol(2));
    await submitProtocol(store, makeDeps().deps, { sourceType: 'manual', inlineText: '改訂本文' });
    const { protocol, counts } = store.getState();
    expect(protocol.records?.map((r) => r.version)).toEqual([2, 1]);
    expect(protocol.selectedVersion).toBeNull();
    expect(protocol.editing).toBe(false);
    expect(counts.protocolVersions).toBe(2);
  });

  test('email が取れないときは created_by 空文字で保存する', async () => {
    const store = makeStore();
    const { deps } = makeDeps('');
    saveProtocolMock.mockResolvedValue(makeProtocol(1));
    await submitProtocol(store, deps, { sourceType: 'manual', inlineText: '本文' });
    expect(saveProtocolMock).toHaveBeenCalledWith(
      expect.objectContaining({ createdBy: '' }),
      expect.anything(),
    );
  });

  test('markdown ファイル: パース結果を saveProtocol へ渡す（draftText は空のまま）', async () => {
    const store = makeStore();
    saveProtocolMock.mockResolvedValue(makeProtocol(1, { sourceType: 'markdown' }));
    await submitProtocol(store, makeDeps().deps, {
      sourceType: 'markdown',
      file: { name: 'protocol.md', text: async () => '# 本文' },
    });
    expect(saveProtocolMock).toHaveBeenCalledWith(
      expect.objectContaining({
        parsed: expect.objectContaining({
          sourceType: 'markdown',
          sourceFilename: 'protocol.md',
          plainText: '# 本文',
        }),
      }),
      expect.anything(),
    );
    expect(store.getState().protocol.draftText).toBe('');
  });

  test('docx ファイル: 注入された extractDocxText でテキスト化する', async () => {
    const store = makeStore();
    const { deps, extractDocxText } = makeDeps();
    saveProtocolMock.mockResolvedValue(makeProtocol(1, { sourceType: 'docx' }));
    const buffer = new ArrayBuffer(8);
    await submitProtocol(store, deps, {
      sourceType: 'docx',
      file: { name: 'protocol.docx', arrayBuffer: async () => buffer },
    });
    expect(extractDocxText).toHaveBeenCalledWith(buffer);
    expect(saveProtocolMock).toHaveBeenCalledWith(
      expect.objectContaining({
        parsed: expect.objectContaining({
          sourceType: 'docx',
          plainText: 'docx から抽出した本文',
        }),
      }),
      expect.anything(),
    );
  });

  test('保存失敗: saveError に文言を残し、手入力の下書きを保全する', async () => {
    const store = makeStore();
    saveProtocolMock.mockRejectedValue(new Error('Sheets への追記に失敗しました'));
    await submitProtocol(store, makeDeps().deps, {
      sourceType: 'manual',
      inlineText: '編集中の本文',
    });
    const { protocol } = store.getState();
    expect(protocol.saving).toBe(false);
    expect(protocol.saveError).toBe('Sheets への追記に失敗しました');
    expect(protocol.draftText).toBe('編集中の本文');
    expect(protocol.records).toBeNull(); // 反映されない
  });

  test('パース失敗（ファイル読み込みエラー）も saveError へ倒す', async () => {
    const store = makeStore();
    await submitProtocol(store, makeDeps().deps, {
      sourceType: 'markdown',
      file: {
        name: 'protocol.md',
        text: async () => {
          throw new Error('読み込めませんでした');
        },
      },
    });
    expect(store.getState().protocol.saveError).toBe('読み込めませんでした');
    expect(saveProtocolMock).not.toHaveBeenCalled();
  });
});

describe('編集モードと版選択の状態遷移', () => {
  test('startEditProtocol: editing = true にしてエラーを消す', () => {
    const store = makeStore();
    store.setState({ protocol: { ...store.getState().protocol, saveError: '古いエラー' } });
    startEditProtocol(store);
    expect(store.getState().protocol.editing).toBe(true);
    expect(store.getState().protocol.saveError).toBeNull();
  });

  test('cancelEditProtocol: editing = false にして下書きを破棄する', () => {
    const store = makeStore();
    store.setState({
      protocol: {
        ...store.getState().protocol,
        editing: true,
        draftText: '書きかけ',
        saveError: 'エラー',
      },
    });
    cancelEditProtocol(store);
    const { protocol } = store.getState();
    expect(protocol.editing).toBe(false);
    expect(protocol.draftText).toBe('');
    expect(protocol.saveError).toBeNull();
  });

  test('selectProtocolVersion: 選択版のみ変更する', () => {
    const store = makeStore();
    selectProtocolVersion(store, 2);
    expect(store.getState().protocol.selectedVersion).toBe(2);
  });
});
