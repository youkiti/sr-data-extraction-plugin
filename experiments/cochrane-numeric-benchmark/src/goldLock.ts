import path from 'node:path';
import { EXPECTED_SHA256_PREFIX, selectedTiers, type Tier } from './config';
import { fileHash, filesUnder, goldFile, loadEvaluation, refDir, sha256 } from './io';
import type { EvalValue } from './evaluationSet';
import { loadRecheck } from './recheck';

export interface GoldLock { tiers: Tier[]; hashes: Record<string, string>; taskDigest: string; recheckLabelsSha256: string | null }
export function assertLabels(values: EvalValue[]): void {
  const missing = values.filter((value) => (value.upstreamLabel === undefined ? value.label : value.upstreamLabel) === null).length;
  if (missing) throw new Error(`未裁定の評価値が ${missing} 件あります。全ラベルの確定後に実行してください`);
}
export async function goldHashes(root: string, tiers = selectedTiers()): Promise<GoldLock> {
  const hashes: Record<string, string> = {};
  const tasks: string[] = [];
  for (const tier of tiers) {
    const base = refDir(root, tier);
    const gold = goldFile(root, tier);
    const final = path.join(base, 'final.jsonl');
    const files = [gold, final, ...(await filesUnder(path.join(base, 'judgments'))).filter((file) => file.endsWith('.jsonl'))];
    const taskFiles = (await filesUnder(path.join(root, 'data', 'processed', tier, 'numeric_tasks'))).filter((file) => file.endsWith('.json'));
    for (const file of [...files, ...taskFiles]) {
      const relative = path.relative(root, file).replace(/\\/g, '/');
      const hash = await fileHash(file);
      hashes[relative] = hash;
      if (taskFiles.includes(file)) tasks.push(`${relative}\t${hash}`);
      const prefix = EXPECTED_SHA256_PREFIX[tier][path.basename(file)];
      if (prefix && !hash.startsWith(prefix)) throw new Error(`gold の既定ハッシュ接頭辞と一致しません: ${tier}/${path.basename(file)}`);
    }
  }
  return { tiers: [...tiers], hashes, taskDigest: sha256(tasks.sort().join('\n')), recheckLabelsSha256: null };
}
export async function verifyGoldLock(root: string, lock: GoldLock, values: EvalValue[]): Promise<void> {
  const allValues = process.env.BENCH_STUDIES ? (await loadEvaluation(root, { ignoreStudySubset: true })).values : values;
  const recheck = await loadRecheck(values, allValues);
  if (lock.recheckLabelsSha256 !== recheck.hash) throw new Error('gold-lock と再チェックラベルのハッシュが違います');
  const fresh = await goldHashes(root, lock.tiers);
  const keys = [...new Set([...Object.keys(lock.hashes), ...Object.keys(fresh.hashes)])];
  if (keys.some((key) => lock.hashes[key] !== fresh.hashes[key]) || lock.taskDigest !== fresh.taskDigest) throw new Error('gold-lock と現在の入力ハッシュが違います。採点を中断しました');
  if (selectedTiers().some((tier) => !lock.tiers.includes(tier))) throw new Error('選択 tier の gold-lock がありません');
}
