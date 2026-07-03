// offlineQueue の unit テスト。jsdom は IndexedDB を持たないため、
// エラー注入フラグ付きの最小フェイク（open / get / put / delete のみ）を用意する
import { installChromeMock, type ChromeMock } from '../../../setup/chrome-mock';
import { createOfflineQueue } from '../../../../src/lib/storage/offlineQueue';

type VoidHandler = (() => void) | null;

interface FakeRequest {
  onerror: VoidHandler;
  onupgradeneeded?: VoidHandler;
  onsuccess: VoidHandler;
  result?: unknown;
  error?: Error;
}

interface FakeStore {
  get(key: string): FakeRequest;
  put(record: { queueKey: string; items: unknown[] }): FakeRequest;
  delete(key: string): FakeRequest;
}

interface FakeTransaction {
  oncomplete: VoidHandler;
  objectStore(name: string): FakeStore;
}

interface FakeIndexedDb {
  /** queueKey → 保存済みレコード（テストからの直接検査・シード用） */
  records: Map<string, { queueKey: string; items: unknown[] }>;
  flags: { failOpen: boolean; failGet: boolean; failPut: boolean; failDelete: boolean };
}

function installFakeIndexedDb(): FakeIndexedDb {
  const records = new Map<string, { queueKey: string; items: unknown[] }>();
  const flags = { failOpen: false, failGet: false, failPut: false, failDelete: false };
  let storeCreated = false;

  // 実 IDB と同じく、ハンドラ代入後の非同期タイミングでコールバックを発火させる
  const makeStoreRequest = (tx: FakeTransaction, operate: () => unknown): FakeRequest => {
    const request: FakeRequest = { onerror: null, onsuccess: null };
    queueMicrotask(() => {
      try {
        request.result = operate();
        request.onsuccess?.();
      } catch (error) {
        request.error = error as Error;
        request.onerror?.();
      }
      tx.oncomplete?.();
    });
    return request;
  };

  const makeDb = () => ({
    close: jest.fn(),
    createObjectStore: (): void => {
      storeCreated = true;
    },
    transaction: (): FakeTransaction => {
      const tx: FakeTransaction = {
        oncomplete: null,
        objectStore: () => ({
          get: (key) =>
            makeStoreRequest(tx, () => {
              if (flags.failGet) throw new Error('get failed');
              return records.get(key);
            }),
          put: (record) =>
            makeStoreRequest(tx, () => {
              if (flags.failPut) throw new Error('put failed');
              records.set(record.queueKey, { queueKey: record.queueKey, items: record.items });
            }),
          delete: (key) =>
            makeStoreRequest(tx, () => {
              if (flags.failDelete) throw new Error('delete failed');
              records.delete(key);
            }),
        }),
      };
      return tx;
    },
  });

  const factory = {
    open: (): FakeRequest => {
      const request: FakeRequest = { onerror: null, onupgradeneeded: null, onsuccess: null };
      queueMicrotask(() => {
        if (flags.failOpen) {
          request.error = new Error('open failed');
          request.onerror?.();
          return;
        }
        request.result = makeDb();
        if (!storeCreated) {
          request.onupgradeneeded?.();
        }
        request.onsuccess?.();
      });
      return request;
    },
  };

  (globalThis as { indexedDB: IDBFactory }).indexedDB = factory as unknown as IDBFactory;
  return { records, flags };
}

interface QueueItem {
  id: string;
  at: string;
  value: string;
}

function item(id: string, at: string, value = ''): QueueItem {
  return { id, at, value };
}

const SHEET = 'sheet-1';
const EMAIL = 'user@example.com';
const QUEUE_KEY = `decisions::${SHEET}::${EMAIL}`;
const LOCAL_KEY = `offlineQueue:${QUEUE_KEY}`;

function makeQueue() {
  return createOfflineQueue<QueueItem>({
    name: 'decisions',
    getId: (i) => i.id,
    getSortKey: (i) => i.at,
  });
}

/** 辞書順 = 時刻順になる ISO 8601 ソートキーを index から作る */
function at(index: number): string {
  return `2026-07-02T00:00:00.${String(index).padStart(3, '0')}Z`;
}

describe('offlineQueue', () => {
  let chromeMock: ChromeMock;
  let idb: FakeIndexedDb;

  beforeEach(() => {
    chromeMock = installChromeMock();
    idb = installFakeIndexedDb();
  });

  describe('enqueue', () => {
    test('spreadsheetId が空なら何もしない', async () => {
      await makeQueue().enqueue('', EMAIL, item('d1', at(1)));
      expect(chromeMock.storage.local.get).not.toHaveBeenCalled();
      expect(chromeMock.storage.local.set).not.toHaveBeenCalled();
    });

    test('userEmail が空なら何もしない', async () => {
      await makeQueue().enqueue(SHEET, '', item('d1', at(1)));
      expect(chromeMock.storage.local.get).not.toHaveBeenCalled();
      expect(chromeMock.storage.local.set).not.toHaveBeenCalled();
    });

    test('storage.local へソートキー順で保存される', async () => {
      const queue = makeQueue();
      await queue.enqueue(SHEET, EMAIL, item('d2', at(2)));
      await queue.enqueue(SHEET, EMAIL, item('d1', at(1)));
      expect(chromeMock.storage.local.data[LOCAL_KEY]).toEqual([
        item('d1', at(1)),
        item('d2', at(2)),
      ]);
    });

    test('同一 id の再 enqueue は置換（upsert）になる', async () => {
      const queue = makeQueue();
      await queue.enqueue(SHEET, EMAIL, item('d1', at(1), 'before'));
      await queue.enqueue(SHEET, EMAIL, item('d1', at(2), 'after'));
      expect(chromeMock.storage.local.data[LOCAL_KEY]).toEqual([item('d1', at(2), 'after')]);
    });

    test('storage.local が空配列のときは IndexedDB 側の退避分を読み継ぐ', async () => {
      chromeMock.storage.local.data[LOCAL_KEY] = [];
      idb.records.set(QUEUE_KEY, { queueKey: QUEUE_KEY, items: [item('d1', at(1))] });
      await makeQueue().enqueue(SHEET, EMAIL, item('d2', at(2)));
      // 2 件 ≤ LIMIT なので storage.local へ戻り、IndexedDB 側は掃除される
      expect(chromeMock.storage.local.data[LOCAL_KEY]).toEqual([
        item('d1', at(1)),
        item('d2', at(2)),
      ]);
      expect(idb.records.has(QUEUE_KEY)).toBe(false);
    });

    test('LOCAL_QUEUE_LIMIT（100 件）を超えると storage.local から IndexedDB へ移す', async () => {
      chromeMock.storage.local.data[LOCAL_KEY] = Array.from({ length: 100 }, (_, i) =>
        item(`d${i}`, at(i)),
      );
      await makeQueue().enqueue(SHEET, EMAIL, item('d-new', at(100)));
      expect(chromeMock.storage.local.data[LOCAL_KEY]).toBeUndefined();
      expect(idb.records.get(QUEUE_KEY)?.items).toHaveLength(101);
    });

    test('IndexedDB へ移した後の enqueue は IndexedDB から読み継いで追記する', async () => {
      idb.records.set(QUEUE_KEY, {
        queueKey: QUEUE_KEY,
        items: Array.from({ length: 101 }, (_, i) => item(`d${i}`, at(i))),
      });
      await makeQueue().enqueue(SHEET, EMAIL, item('d-new', at(101)));
      expect(chromeMock.storage.local.data[LOCAL_KEY]).toBeUndefined();
      expect(idb.records.get(QUEUE_KEY)?.items).toHaveLength(102);
    });

    test('IndexedDB の読込に失敗してもキューは空扱いで継続する', async () => {
      idb.flags.failGet = true;
      await makeQueue().enqueue(SHEET, EMAIL, item('d1', at(1)));
      expect(chromeMock.storage.local.data[LOCAL_KEY]).toEqual([item('d1', at(1))]);
    });

    test('IndexedDB への退避（put）に失敗したら enqueue は失敗する', async () => {
      chromeMock.storage.local.data[LOCAL_KEY] = Array.from({ length: 100 }, (_, i) =>
        item(`d${i}`, at(i)),
      );
      idb.flags.failPut = true;
      await expect(makeQueue().enqueue(SHEET, EMAIL, item('d-new', at(100)))).rejects.toThrow(
        'put failed',
      );
    });

    test('IndexedDB の掃除（delete）に失敗したら enqueue は失敗する', async () => {
      idb.flags.failDelete = true;
      await expect(makeQueue().enqueue(SHEET, EMAIL, item('d1', at(1)))).rejects.toThrow(
        'delete failed',
      );
    });
  });

  describe('flush', () => {
    test('spreadsheetId / userEmail が空なら何もせず 0 件を返す', async () => {
      const save = jest.fn();
      await expect(makeQueue().flush('', EMAIL, save)).resolves.toEqual({
        flushedCount: 0,
        remainingCount: 0,
      });
      await expect(makeQueue().flush(SHEET, '', save)).resolves.toEqual({
        flushedCount: 0,
        remainingCount: 0,
      });
      expect(save).not.toHaveBeenCalled();
      expect(chromeMock.storage.local.get).not.toHaveBeenCalled();
    });

    test('キューが空なら save を呼ばない', async () => {
      const save = jest.fn();
      await expect(makeQueue().flush(SHEET, EMAIL, save)).resolves.toEqual({
        flushedCount: 0,
        remainingCount: 0,
      });
      expect(save).not.toHaveBeenCalled();
    });

    test('全件成功なら古い順に送信してキューを空にする', async () => {
      const queue = makeQueue();
      await queue.enqueue(SHEET, EMAIL, item('d2', at(2)));
      await queue.enqueue(SHEET, EMAIL, item('d1', at(1)));
      const sent: string[] = [];
      const save = jest.fn(async (i: QueueItem) => {
        sent.push(i.id);
      });
      await expect(queue.flush(SHEET, EMAIL, save)).resolves.toEqual({
        flushedCount: 2,
        remainingCount: 0,
      });
      expect(sent).toEqual(['d1', 'd2']);
      expect(chromeMock.storage.local.data[LOCAL_KEY]).toEqual([]);
    });

    test('途中で失敗したら、その項目以降を順序を保って残す', async () => {
      const queue = makeQueue();
      await queue.enqueue(SHEET, EMAIL, item('d1', at(1)));
      await queue.enqueue(SHEET, EMAIL, item('d2', at(2)));
      await queue.enqueue(SHEET, EMAIL, item('d3', at(3)));
      const save = jest.fn(async (i: QueueItem) => {
        if (i.id === 'd2') throw new Error('offline');
      });
      await expect(queue.flush(SHEET, EMAIL, save)).resolves.toEqual({
        flushedCount: 1,
        remainingCount: 2,
      });
      expect(chromeMock.storage.local.data[LOCAL_KEY]).toEqual([
        item('d2', at(2)),
        item('d3', at(3)),
      ]);
    });

    test('IndexedDB の open に失敗してもキューは空扱いで継続する', async () => {
      idb.flags.failOpen = true;
      const save = jest.fn();
      await expect(makeQueue().flush(SHEET, EMAIL, save)).resolves.toEqual({
        flushedCount: 0,
        remainingCount: 0,
      });
      expect(save).not.toHaveBeenCalled();
    });
  });
});
