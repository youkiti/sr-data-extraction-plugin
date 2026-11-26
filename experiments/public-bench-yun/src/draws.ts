import path from 'node:path';
import { stat } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { mulberry32 } from '../../cochrane-numeric-benchmark/src/bootstrap';
import { safeError } from '../../cochrane-numeric-benchmark/src/cost';
import { readJson, writeJson } from '../../cochrane-numeric-benchmark/src/io';
import { outputRoot } from './config';
import type { Manifest } from './manifest';

export const SEED = 20261127;
export const REPLICATES = 2000;
export function sortedPmcids(values: unknown): number[] {
  if (!Array.isArray(values) || !values.length || values.some((id) => !Number.isSafeInteger(id) || id <= 0) || new Set(values).size !== values.length) {
    throw new Error('PMCID は重複のない正整数の配列で指定してください');
  }
  return [...values as number[]].sort((a, b) => a - b);
}
export function makeDraws(values: number[]) {
  const pmcids = sortedPmcids(values), random = mulberry32(SEED);
  const draws = Array.from({ length: REPLICATES }, () => pmcids.map(() => Math.floor(random() * pmcids.length)));
  return { seed: SEED, replicates: REPLICATES, pmcids, draws };
}
export async function pmcidsFrom(source: string): Promise<number[]> {
  if (!(await stat(source)).isDirectory()) return sortedPmcids(await readJson<unknown>(source));
  const manifest = await readJson<Manifest>(path.join(source, '_inputs.json'));
  const requests = Object.keys(manifest.hashes).filter((key) => key.startsWith('request/'));
  if (!requests.length || !manifest.models.length) throw new Error('入力マニフェストに依頼計画がありません');
  const perModel = manifest.models.map((model) => sortedPmcids(requests.filter((key) => key.startsWith(`request/${model}__PMC`)).map((key) => {
    const suffix = key.slice(`request/${model}__PMC`.length);
    if (!/^\d+$/.test(suffix)) throw new Error('依頼計画の PMCID が不正です');
    return Number(suffix);
  })));
  if (perModel.some((ids) => JSON.stringify(ids) !== JSON.stringify(perModel[0]))) throw new Error('モデル間で RCT 計画が異なります');
  return perModel[0]!;
}
export async function writeDraws(root: string, name: string, pmcids: number[]): Promise<string> {
  if (!/^[A-Za-z0-9_-]+$/.test(name)) throw new Error('name は英数字・_・- で指定してください');
  const file = path.join(root, `draws-${name}.json`);
  await writeJson(file, makeDraws(pmcids));
  return file;
}
export async function main(args = process.argv.slice(2)): Promise<void> {
  if (args.length !== 4 || !args.includes('--name') || !args.includes('--pmcids-from')) throw new Error('--name と --pmcids-from を指定してください');
  const name = args[args.indexOf('--name') + 1]!, source = args[args.indexOf('--pmcids-from') + 1]!;
  console.log(await writeDraws(outputRoot(), name, await pmcidsFrom(source)));
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try { await main(); } catch (error) { console.error(safeError(error)); process.exitCode = 1; }
}
