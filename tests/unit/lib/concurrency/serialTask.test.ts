// createSerialTaskQueue（キー単位の直列化）の単体テスト
import { createSerialTaskQueue } from '../../../../src/lib/concurrency/serialTask';

/** resolve / reject を外から制御できる deferred promise */
function deferred<T>(): {
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (reason: unknown) => void;
} {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

describe('createSerialTaskQueue', () => {
  test('同じキーのタスクは前のタスクが決着してから開始する', async () => {
    const queue = createSerialTaskQueue<string>();
    const order: string[] = [];
    const first = deferred<void>();

    const p1 = queue.run('k', async () => {
      order.push('start-1');
      await first.promise;
      order.push('end-1');
    });
    const p2 = queue.run('k', async () => {
      order.push('start-2');
    });

    // 1 本目が決着するまで 2 本目は開始しない
    await Promise.resolve();
    await Promise.resolve();
    expect(order).toEqual(['start-1']);

    first.resolve();
    await p1;
    await p2;
    expect(order).toEqual(['start-1', 'end-1', 'start-2']);
  });

  test('前のタスクが reject しても後続がブロックされない', async () => {
    const queue = createSerialTaskQueue<string>();
    const order: string[] = [];

    const p1 = queue.run('k', async () => {
      order.push('start-1');
      throw new Error('boom');
    });
    const p2 = queue.run('k', async () => {
      order.push('start-2');
      return 'ok';
    });

    await expect(p1).rejects.toThrow('boom');
    await expect(p2).resolves.toBe('ok');
    expect(order).toEqual(['start-1', 'start-2']);
  });

  test('異なるキーのタスクは互いに待たない', async () => {
    const queue = createSerialTaskQueue<string>();
    const order: string[] = [];
    const blockA = deferred<void>();

    const pA = queue.run('a', async () => {
      order.push('start-a');
      await blockA.promise;
      order.push('end-a');
    });
    const pB = queue.run('b', async () => {
      order.push('start-b');
      order.push('end-b');
    });

    // b は a を待たずに開始・完了できる
    await pB;
    expect(order).toEqual(['start-a', 'start-b', 'end-b']);

    blockA.resolve();
    await pA;
    expect(order).toEqual(['start-a', 'start-b', 'end-b', 'end-a']);
  });

  test('解決値をそのまま呼び出し元へ返す', async () => {
    const queue = createSerialTaskQueue<string>();
    const result = await queue.run('k', async () => 42);
    expect(result).toBe(42);
  });

  test('例外をそのまま呼び出し元へ伝える（ラップしない）', async () => {
    const queue = createSerialTaskQueue<string>();
    const err = new Error('specific error');
    await expect(
      queue.run('k', async () => {
        throw err;
      }),
    ).rejects.toBe(err);
  });

  test('決着したキーのエントリを掃除し、新しい呼び出しは待たずに即開始する', async () => {
    const queue = createSerialTaskQueue<string>();
    await queue.run('k', async () => undefined);
    // 掃除の完了（内部 Map からの削除）をマイクロタスク経由で待つ
    await Promise.resolve();
    await Promise.resolve();

    const order: string[] = [];
    await queue.run('k', async () => {
      order.push('immediate');
    });
    expect(order).toEqual(['immediate']);
  });
});
