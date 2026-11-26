import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { benchRoot } from './config';
import { mulberry32 } from './bootstrap';
import { inputRoot, loadEvaluation, writeJson } from './io';

export function pickPilot(studies: readonly { reviewId: string; studyKey: string }[], seed = 20261126, n = 10) {
  if (!Number.isSafeInteger(seed) || !Number.isSafeInteger(n) || n < 1) throw new Error('seed は整数、n は正の整数で指定してください');
  const reviews = [...new Set(studies.map((study) => study.reviewId))].sort();
  if (n > reviews.length) throw new Error('n がレビュー数を超えています');
  const rng = mulberry32(seed);
  const remaining = [...reviews];
  // 並べたレビューから Math.floor(rng() * 残りの数) の位置を取り出す非復元抽出。
  const chosen = Array.from({ length: n }, () => remaining.splice(Math.floor(rng() * remaining.length), 1)[0]!);
  const selected = chosen.map((reviewId) => {
    const pool = studies.filter((study) => study.reviewId === reviewId).map((study) => study.studyKey).sort();
    return { reviewId, studyKey: pool[Math.floor(rng() * pool.length)]! };
  });
  return { seed, n, method: 'mulberry32: レビューを非復元抽出し各レビューから研究を1件抽出',
    reviewsTotal: reviews.length, studiesTotal: studies.length, selected };
}
export function pilotArgs(args: readonly string[]) {
  let seed = 20261126, n = 10;
  for (let i = 0; i < args.length; i += 2) {
    const name = args[i], raw = args[i + 1];
    if (!['--seed', '--n'].includes(name ?? '') || raw === undefined || !/^-?\d+$/.test(raw) || !Number.isSafeInteger(Number(raw))) throw new Error('--seed <整数> と --n <正の整数> を指定してください');
    if (name === '--seed') seed = Number(raw); else n = Number(raw);
  }
  return { seed, n };
}
export async function main(): Promise<void> {
  const { seed, n } = pilotArgs(process.argv.slice(2));
  const previous = process.env.BENCH_STUDIES;
  let set;
  try {
    delete process.env.BENCH_STUDIES;
    set = await loadEvaluation(await inputRoot());
  } finally {
    if (previous === undefined) delete process.env.BENCH_STUDIES; else process.env.BENCH_STUDIES = previous;
  }
  const result = pickPilot(set.studies, seed, n);
  await writeJson(path.join(benchRoot, 'outputs', `pilot-seed${seed}-n${n}.json`), result);
  console.log(result.selected.map((study) => study.studyKey).join(','));
  for (const study of result.selected) console.log(`${study.reviewId}: ${study.studyKey}`);
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try { await main(); } catch (error) { console.error(String(error)); process.exitCode = 1; }
}
