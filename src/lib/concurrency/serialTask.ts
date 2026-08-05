// キー単位で非同期タスクを直列化する小さな排他機構。
// 同じキーのタスクは、前のタスクが決着（成功・失敗を問わない）してから開始する。
// 異なるキーは互いに独立して並行実行できる（待たない）。
//
// 用途: シート単位のロックを持たない read-modify-write（例: annotator 行の upsert）を、
// 呼び出し側でキー（例: spreadsheetId）ごとに直列化して同時実行による重複行を防ぐ。
//
// 実装のポイント:
// - 各キーの末尾には「直前のタスクの決着だけを表す」マーカー Promise を保持する。
//   このマーカーは常に resolve され、reject しない（前のタスクの失敗を catch で
//   握りつぶして待ち役に変換する）ため、前のタスクが reject しても後続の連鎖は
//   汚染されず、次のタスクは通常どおり開始できる。
// - 呼び出し元へ返す Promise は task() の結果をそのまま採用するため、解決値・例外は
//   透過的に伝わる（マーカーとは別物）。
// - 最後に予約されたタスクが決着した時点でそのキーのエントリを削除し、Map が
//   無制限に肥大するのを防ぐ（決着後に新しいタスクが積まれていなければ削除する）。
export interface SerialTaskQueue<K = string> {
  /**
   * key が同じ呼び出し同士は前の呼び出しが決着するまで開始を待つ。
   * key が異なる呼び出しは互いに待たない。
   */
  run<T>(key: K, task: () => Promise<T>): Promise<T>;
}

export function createSerialTaskQueue<K = string>(): SerialTaskQueue<K> {
  // 各キーの「直前のタスクの決着」を表すマーカー（常に resolve。次のタスクはこれを待つ）
  const tails = new Map<K, Promise<void>>();

  function run<T>(key: K, task: () => Promise<T>): Promise<T> {
    const previousTail = tails.get(key) ?? Promise.resolve();
    // 前のタスクの決着を待ってから自分の task を開始する。task の解決値 / 例外は
    // そのまま呼び出し元へ伝わる（Promise が返す Promise を採用する挙動）
    const result = previousTail.then(task);
    // 自分の決着（成功・失敗いずれか）だけを表すマーカーへ変換して次の待ち役にする
    const settleMarker = result.then(
      () => undefined,
      () => undefined,
    );
    tails.set(key, settleMarker);
    // 自分が最後の予約者のままなら、決着後にエントリを掃除する（無制限な肥大を防ぐ）。
    // 自分の後に新しいタスクが積まれていれば tails.get(key) は既に別のマーカーに
    // 差し替わっているため、その新しいタスク側の掃除に任せて何もしない
    void settleMarker.then(() => {
      if (tails.get(key) === settleMarker) {
        tails.delete(key);
      }
    });
    return result;
  }

  return { run };
}
