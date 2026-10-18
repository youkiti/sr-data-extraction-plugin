// 群（arm）の順番に依存しない感度分析（純粋関数）。
//
// 採点は gold 行と AI 項目を `field_id + entity_key`（entity_key は `arm:1`, `arm:2`, … の
// 位置ベースのラベル）で突き合わせる（src/metrics.ts computePerRunMetrics）。entity_key は
// 「何番目に出てきた群か」で振られるだけで、どの実治療腕が arm:1 になるかは gold 側の入力経緯と
// AI の読み取り順で食い違いうる。入力の結合時に群の順番がずれると、
// AI の値が正しくても群番号が食い違うだけで不一致になる。
//
// ここでは「gold の群ラベルと AI の群ラベルの対応（写像）を変えたら正確度がどこまで上がるか」を
// 純粋関数として提供する。**主指標（凍結定義の accuracy 等）はこのファイルでは一切変更しない**。
// あくまで事後的な感度分析（gold を見て最良の対応を選ぶので上限寄りの参考値）。
import { computePerRunMetrics, type PerRunMetrics, type RunItem, type ScorableRun } from './metrics';
import type { GoldFile } from './validateGold';

/** gold の群キー → AI の群キー の対応（値が無い gold 群キーは対応なし = マップに含めない）。 */
export type ArmMapping = Readonly<Record<string, string>>;

/** 候補（単射）の数の上限。群は最大 6 想定なので通常は数百程度に収まる（下記コメント参照）。 */
const MAX_CANDIDATES = 10_000;

/** `arm:` で始まる entity_key の集合（重複排除・昇順）を取り出す。study レベルの `-` 等は対象外。 */
export function armKeys(entityKeys: Iterable<string>): string[] {
  return [...new Set(Array.from(entityKeys).filter((key) => key.startsWith('arm:')))].sort();
}

function factorial(n: number): number {
  let result = 1;
  for (let i = 2; i <= n; i++) result *= i;
  return result;
}

function nCr(n: number, r: number): number {
  if (r < 0 || r > n) return 0;
  return factorial(n) / (factorial(r) * factorial(n - r));
}

/** items から k 個選ぶ組み合わせ（順序を問わない）。 */
function combinations<T>(items: readonly T[], k: number): T[][] {
  if (k === 0) return [[]];
  if (k > items.length) return [];
  const [first, ...rest] = items;
  if (first === undefined) return [];
  const withFirst = combinations(rest, k - 1).map((c) => [first, ...c]);
  const withoutFirst = combinations(rest, k);
  return [...withFirst, ...withoutFirst];
}

/** items の全順列。 */
function permutations<T>(items: readonly T[]): T[][] {
  if (items.length === 0) return [[]];
  const result: T[][] = [];
  items.forEach((item, i) => {
    const rest = [...items.slice(0, i), ...items.slice(i + 1)];
    for (const perm of permutations(rest)) {
      result.push([item, ...perm]);
    }
  });
  return result;
}

function canonicalKey(mapping: ArmMapping): string {
  return Object.entries(mapping)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([k, v]) => `${k}=${v}`)
    .join('&');
}

/**
 * gold の群キー → AI の群キー（または「対応なし」）への単射をすべて列挙する。
 *
 * 「不一致のまま残す」より「別の群へ対応付ける」ほうが accuracy を下げることは無い
 * （対応なしの群の行は不一致として数えるだけで、誤対応も不一致として数えるだけなので、
 * accuracy に限れば損をしない）ため、最大濃度（min(gold数, AI数)）の対応だけを列挙すれば
 * 最良値の探索としては十分で、候補数を絞れる。AI の群が gold より多い場合は gold 側を
 * 全部対応させ（余った AI 群は対応なし = extra）、gold の群が AI より多い場合は AI 側を
 * 全部対応させる（対応しなかった gold 群 = その群の行は AI 項目なしとして不正解）。
 * 恒等写像（同じキーどうし）は明示的に候補へ加える（生成された順列に無い場合の保険）。
 *
 * 群は最大 6 想定（group 数 g, AI 側 a のとき候補数は nCr(g,k)×nCr(a,k)×k!、k=min(g,a)）。
 * g=a=6 でも 720 件で、上限 10,000 に十分収まる。AI が群を大量に誤検出した場合など
 * 上限を超えるときは throw する。
 */
export function candidateMappings(goldArmKeys: readonly string[], aiArmKeys: readonly string[]): ArmMapping[] {
  const g = goldArmKeys.length;
  const a = aiArmKeys.length;
  const k = Math.min(g, a);

  const totalCandidates = nCr(g, k) * nCr(a, k) * factorial(k);
  if (totalCandidates > MAX_CANDIDATES) {
    throw new Error(
      `arm 対応の候補数（${totalCandidates}）が上限 ${MAX_CANDIDATES} を超えました（gold の群数=${g}, AI の群数=${a}）`,
    );
  }

  const goldSubsets = combinations(goldArmKeys, k);
  const aiSubsets = combinations(aiArmKeys, k);
  const aiPermsPerSubset = aiSubsets.flatMap((subset) => permutations(subset));

  const seen = new Set<string>();
  const mappings: ArmMapping[] = [];
  for (const goldSubset of goldSubsets) {
    for (const aiPerm of aiPermsPerSubset) {
      const mapping: Record<string, string> = {};
      goldSubset.forEach((goldKey, i) => {
        const aiKey = aiPerm[i];
        if (aiKey !== undefined) mapping[goldKey] = aiKey;
      });
      const canonical = canonicalKey(mapping);
      if (!seen.has(canonical)) {
        seen.add(canonical);
        mappings.push(mapping);
      }
    }
  }

  // 恒等写像を必ず候補に含める（同じキーが両側にあるものだけ対応させる）
  const identity: Record<string, string> = {};
  for (const key of goldArmKeys) {
    if (aiArmKeys.includes(key)) identity[key] = key;
  }
  if (!seen.has(canonicalKey(identity))) {
    mappings.push(identity);
  }

  return mappings;
}

/**
 * AI 項目の entityKey を写像（gold 群キー → AI 群キー）に従って gold 側のキーへ付け替えた
 * ScorableRun を返す。arm 以外の項目（study レベル等）はそのまま。写像の値（AI 群キー）に
 * 現れない AI の群の項目は、gold のどのキーとも衝突しないキーへ退避する。元の run は変更しない。
 */
export function remapRun(run: ScorableRun, mapping: ArmMapping): ScorableRun {
  const inverse = new Map<string, string>();
  for (const [goldKey, aiKey] of Object.entries(mapping)) {
    inverse.set(aiKey, goldKey);
  }
  const items: RunItem[] = run.items.map((item) => {
    if (!item.entityKey.startsWith('arm:')) return item;
    const goldKey = inverse.get(item.entityKey);
    const newEntityKey = goldKey ?? `__unmapped_arm__${item.entityKey}`;
    return { ...item, entityKey: newEntityKey };
  });
  return { ...run, items };
}

export interface BestArmMappingResult {
  /** 恒等写像（現状の対応）で採点した PerRunMetrics */
  asIs: PerRunMetrics;
  /** 全候補中で overall.accuracy が最大の PerRunMetrics */
  best: PerRunMetrics;
  /** best に対応する写像 */
  mapping: ArmMapping;
  /** best が恒等写像でないか（= 対応を変えたほうが良かったか） */
  changed: boolean;
}

/**
 * gold の群キー・AI の群キーから作れる全候補写像について `computePerRunMetrics(remapRun(run, m), gold)`
 * を計算し、`overall.accuracy` が最大の写像を返す。同点なら恒等写像を優先し、それでも同点なら
 * 列挙順で最初のものを採用する（列挙順は candidateMappings の戻り順）。
 */
export function bestArmMapping(run: ScorableRun, gold: GoldFile): BestArmMappingResult {
  const goldArmKeys = armKeys(gold.rows.map((row) => row.entity_key));
  const aiArmKeys = armKeys(run.items.map((item) => item.entityKey));

  const identity: Record<string, string> = {};
  for (const key of goldArmKeys) {
    if (aiArmKeys.includes(key)) identity[key] = key;
  }
  const identityCanonical = canonicalKey(identity);
  const asIs = computePerRunMetrics(remapRun(run, identity), gold);

  const candidates = candidateMappings(goldArmKeys, aiArmKeys);

  let best = asIs;
  let bestMapping: ArmMapping = identity;
  let bestIsIdentity = true;
  let bestAccuracy = asIs.overall.accuracy ?? -Infinity;

  for (const mapping of candidates) {
    const isIdentity = canonicalKey(mapping) === identityCanonical;
    const metrics = isIdentity ? asIs : computePerRunMetrics(remapRun(run, mapping), gold);
    const accuracy = metrics.overall.accuracy ?? -Infinity;
    const strictlyBetter = accuracy > bestAccuracy;
    const tieBackToIdentity = accuracy === bestAccuracy && isIdentity && !bestIsIdentity;
    if (strictlyBetter || tieBackToIdentity) {
      best = metrics;
      bestMapping = mapping;
      bestIsIdentity = isIdentity;
      bestAccuracy = accuracy;
    }
  }

  return { asIs, best, mapping: bestMapping, changed: !bestIsIdentity };
}
