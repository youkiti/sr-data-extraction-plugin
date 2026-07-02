// fuzzy マッチ用の編集距離（自前 DP。architecture.md §7-4 の判断: スパイクで
// 実用十分な速度を確認済みのため外部ライブラリは導入しない）

/**
 * 準大域アライメント: pattern を text 内の任意の部分文字列と照合し、最小編集距離を返す。
 * text 側の先頭・末尾の読み飛ばしはコスト 0。挿入・削除・置換は各コスト 1
 */
export function bestSubstringDistance(
  pattern: string,
  text: string,
): { distance: number; endIndex: number } {
  const m = pattern.length;
  const n = text.length;
  if (m === 0) {
    return { distance: 0, endIndex: 0 };
  }
  // dp[j] = pattern[0..i) と text の位置 j で終わる部分文字列との最小距離
  let prev = new Array<number>(n + 1).fill(0); // i=0: text 側の開始位置は自由
  let curr = new Array<number>(n + 1).fill(0);
  for (let i = 1; i <= m; i++) {
    curr[0] = i;
    const patternCode = pattern.charCodeAt(i - 1);
    for (let j = 1; j <= n; j++) {
      const cost = patternCode === text.charCodeAt(j - 1) ? 0 : 1;
      curr[j] = Math.min(
        (prev[j] as number) + 1, // pattern 側の削除
        (curr[j - 1] as number) + 1, // text 側の挿入
        (prev[j - 1] as number) + cost, // 一致 / 置換
      );
    }
    [prev, curr] = [curr, prev];
  }
  let best = Number.MAX_SAFE_INTEGER;
  let endIndex = 0;
  for (let j = 0; j <= n; j++) {
    const d = prev[j] as number;
    if (d < best) {
      best = d;
      endIndex = j;
    }
  }
  return { distance: best, endIndex };
}
