// 初回 run から再探索対象を決め、出力先の通常 run・別実験との混在を防ぐ。
// プロンプトへ渡すのは項目定義だけで、初回の値や引用は渡さない。
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { localName } from './loadSchema';
import type { RunItem } from './metrics';

export interface TargetCell { fieldId: string; entityKey: string }
export interface ReaskRun { error: string | null; formatError: string | null; items: RunItem[] }

/** キーを衝突しない文字列にして返す。セルの重複排除と採点で共有する。 */
export function cellKey(cell: TargetCell): string { return JSON.stringify([cell.fieldId, cell.entityKey]); }

/** 未設定なら undefined、設定済みなら安全なディレクトリ名を返す。 */
export function reaskFromName(): string | undefined {
  const value = process.env.BENCH_REASK_FROM;
  return value === undefined ? undefined : localName(value, '');
}

/** 未報告要素のキーを初出順に返す。重複要素があってもセルは一度だけ探索する。 */
export function targetCells(run: ReaskRun): TargetCell[] {
  if (run.error !== null || run.formatError !== null) throw new Error('初回 run が失敗しています');
  const cells = new Map<string, TargetCell>();
  for (const item of run.items) {
    if (item.notReported === true) cells.set(cellKey(item), { fieldId: item.fieldId, entityKey: item.entityKey });
  }
  return [...cells.values()];
}

/** 対象セルを持つ項目だけをスキーマ順に返す。定義自体は変更しない。 */
export function reaskFields<T extends { fieldId: string }>(cells: readonly TargetCell[], fields: readonly T[]): T[] {
  const ids = new Set(cells.map((cell) => cell.fieldId));
  return fields.filter((field) => ids.has(field.fieldId));
}

/** 現在と異なる再探索元があれば throw する。通常 run と再探索 run も混在させない。 */
export function assertReaskFrom(current: string | undefined, runs: readonly { name: string; reaskFrom?: unknown }[]): void {
  for (const run of runs) {
    if (!run.name.endsWith('.json') || run.name.startsWith('_')) continue;
    if (run.reaskFrom !== current) throw new Error(`再探索元が異なる run があります: ${run.name}`);
  }
}

/** 出力先の混在を検査する。壊れた JSON は既存 runner の退避・再試行に委ねる。 */
export async function checkReaskFrom(dir: string, current: string | undefined): Promise<void> {
  let names: string[];
  try { names = await readdir(dir); } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return;
    throw error;
  }
  const runs = [];
  for (const name of names.filter((name) => name.endsWith('.json') && !name.startsWith('_'))) {
    const raw = await readFile(path.join(dir, name), 'utf8');
    try {
      const run = JSON.parse(raw) as { reaskFrom?: unknown } | null;
      runs.push({ name, reaskFrom: run?.reaskFrom });
    } catch (error) {
      if (!(error instanceof SyntaxError)) throw error;
    }
  }
  assertReaskFrom(current, runs);
}

/** 全計画の初回 run を読み対象セルを返す。不備は全論文を列挙し、API 呼び出し前に止める。 */
export async function loadReaskTargets(dir: string, planned: readonly { runId: string; target: { pdfId: string } }[]): Promise<Map<string, TargetCell[]>> {
  const result = new Map<string, TargetCell[]>();
  const errors: string[] = [];
  for (const p of planned) {
    try {
      const run = JSON.parse(await readFile(path.join(dir, `${p.runId}.json`), 'utf8')) as ReaskRun;
      result.set(p.runId, targetCells(run));
    } catch (error) {
      errors.push(`${p.target.pdfId} (${p.runId}): ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  if (errors.length) throw new Error(`初回 run の検査に失敗しました:\n${errors.join('\n')}`);
  return result;
}
