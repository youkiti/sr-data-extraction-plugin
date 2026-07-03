// オフライン書き込みキュー（architecture.md §2。tiab-review の offline-queue.ts を共通化して流用）。
// Sheets への追記に失敗した項目を端末内へ退避し、オンライン復帰時に flush で古い順に再送する。
// - キューは「用途名 × spreadsheetId × userEmail」単位に分離する
// - 保存先は 2 段構え: LOCAL_QUEUE_LIMIT 件までは chrome.storage.local、あふれたら
//   IndexedDB へ移す（storage.local の 5MB クォータを長期オフラインで使い切らないため）
import { getLocal, removeLocal, setLocal } from './chromeStorage';

const LOCAL_QUEUE_LIMIT = 100;
const LOCAL_QUEUE_PREFIX = 'offlineQueue:';
const DB_NAME = 'sr-data-extraction-plugin';
const DB_VERSION = 1;
const STORE_NAME = 'offlineQueue';

interface QueueRecord {
  queueKey: string;
  items: unknown[];
}

export interface OfflineQueueConfig<T> {
  /** ストレージキーの名前空間。用途ごとに一意にする（例: 'decisions'） */
  name: string;
  /** キュー内で項目を同定する id。同じ id を再 enqueue すると置換（upsert）になる */
  getId: (item: T) => string;
  /** flush 順を決めるソートキー（ISO 8601 文字列の辞書順比較を想定） */
  getSortKey: (item: T) => string;
}

export interface FlushResult {
  flushedCount: number;
  remainingCount: number;
}

export interface OfflineQueue<T> {
  /** 項目をキューへ追加する（同一 id は置換）。spreadsheetId / userEmail が空なら何もしない */
  enqueue(spreadsheetId: string, userEmail: string, item: T): Promise<void>;
  /** キューを古い順に再送する。save が失敗した項目以降は順序を保ってキューへ残す */
  flush(
    spreadsheetId: string,
    userEmail: string,
    save: (item: T) => Promise<void>,
  ): Promise<FlushResult>;
}

function buildLocalKey(queueKey: string): string {
  return LOCAL_QUEUE_PREFIX + queueKey;
}

function openQueueDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onerror = () => reject(request.error);
    request.onupgradeneeded = () => {
      // DB_VERSION 1 の新規作成時のみ呼ばれるため、ストアは常に未作成
      request.result.createObjectStore(STORE_NAME, { keyPath: 'queueKey' });
    };
    request.onsuccess = () => resolve(request.result);
  });
}

async function requestOnQueueStore<R>(
  mode: IDBTransactionMode,
  operate: (store: IDBObjectStore) => IDBRequest<R>,
): Promise<R> {
  const db = await openQueueDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, mode);
    tx.oncomplete = () => db.close();
    const request = operate(tx.objectStore(STORE_NAME));
    request.onerror = () => reject(request.error);
    request.onsuccess = () => resolve(request.result);
  });
}

async function readQueueFromDb(queueKey: string): Promise<unknown[]> {
  const record = await requestOnQueueStore<QueueRecord | undefined>('readonly', (store) =>
    store.get(queueKey),
  );
  return record?.items ?? [];
}

async function writeQueueToDb(queueKey: string, items: unknown[]): Promise<void> {
  await requestOnQueueStore('readwrite', (store) =>
    store.put({ queueKey, items } satisfies QueueRecord),
  );
}

async function deleteQueueFromDb(queueKey: string): Promise<void> {
  await requestOnQueueStore('readwrite', (store) => store.delete(queueKey));
}

export function createOfflineQueue<T>(config: OfflineQueueConfig<T>): OfflineQueue<T> {
  const buildQueueKey = (spreadsheetId: string, userEmail: string): string =>
    `${config.name}::${spreadsheetId}::${userEmail}`;

  const sortQueue = (items: T[]): T[] =>
    items.slice().sort((a, b) => config.getSortKey(a).localeCompare(config.getSortKey(b)));

  const upsertItem = (items: T[], item: T): T[] => {
    const next = items.slice();
    const index = next.findIndex((existing) => config.getId(existing) === config.getId(item));
    if (index >= 0) {
      next[index] = item;
    } else {
      next.push(item);
    }
    return sortQueue(next);
  };

  const loadQueue = async (queueKey: string): Promise<T[]> => {
    const localItems = await getLocal<T[]>(buildLocalKey(queueKey));
    if (localItems && localItems.length > 0) {
      return sortQueue(localItems);
    }
    try {
      return sortQueue((await readQueueFromDb(queueKey)) as T[]);
    } catch {
      // IndexedDB が使えなくても本体機能は止めない（tiab-review と同じ縮退）
      return [];
    }
  };

  const saveQueue = async (queueKey: string, items: T[]): Promise<void> => {
    const localKey = buildLocalKey(queueKey);
    if (items.length <= LOCAL_QUEUE_LIMIT) {
      await setLocal(localKey, items);
      // 過去にあふれて IndexedDB 側へ移した残骸を掃除する（二重保存の防止）
      await deleteQueueFromDb(queueKey);
      return;
    }
    await removeLocal(localKey);
    await writeQueueToDb(queueKey, items);
  };

  return {
    async enqueue(spreadsheetId, userEmail, item) {
      if (!spreadsheetId || !userEmail) return;
      const queueKey = buildQueueKey(spreadsheetId, userEmail);
      const items = await loadQueue(queueKey);
      await saveQueue(queueKey, upsertItem(items, item));
    },

    async flush(spreadsheetId, userEmail, save) {
      if (!spreadsheetId || !userEmail) {
        return { flushedCount: 0, remainingCount: 0 };
      }
      const queueKey = buildQueueKey(spreadsheetId, userEmail);
      const items = await loadQueue(queueKey);
      if (items.length === 0) {
        return { flushedCount: 0, remainingCount: 0 };
      }

      let flushedCount = 0;
      let remaining: T[] = [];
      for (const [index, current] of items.entries()) {
        try {
          await save(current);
          flushedCount += 1;
        } catch {
          // 失敗した項目から後ろは順序を保って残し、次回 flush で再送する
          remaining = items.slice(index);
          break;
        }
      }

      await saveQueue(queueKey, remaining);
      return { flushedCount, remainingCount: remaining.length };
    },
  };
}
