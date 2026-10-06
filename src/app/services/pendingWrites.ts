// 保存結果が未確定の書き込みだけを数える（端末内への退避済み件数は含めない）。
let pendingWrites = 0;
const listeners = new Set<() => void>();

export function getPendingWriteCount(): number {
  return pendingWrites;
}

export function subscribePendingWrites(listener: () => void): () => void {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

function notify(): void {
  listeners.forEach((listener) => listener());
}

/** キューへの登録前に加算し、成功・失敗のどちらでも一度だけ減算する。 */
export async function trackPendingWrite<T>(enqueue: () => Promise<T>): Promise<T> {
  pendingWrites += 1;
  try {
    notify();
    return await enqueue();
  } finally {
    pendingWrites -= 1;
    notify();
  }
}
