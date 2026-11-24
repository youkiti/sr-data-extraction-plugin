import { appendFile, readFile, writeFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import type { Dirent } from 'node:fs';
import type { FailureClass } from './retry';
import type { CostBasis } from './cost';

export interface LedgerEntry {
  runId: string;
  attempt: number;
  attemptAt: string;
  model: string;
  studyKey: string;
  outcome: 'ok' | 'format_error' | 'request_failed';
  tokensIn: number;
  tokensOut: number;
  cachedTokensIn: number | null;
  guardCostUsd: number;
  costBasis: CostBasis;
  elapsedMs: number;
  httpStatus?: number | null;
  failureClass?: FailureClass | null;
}
export function parseLedger(raw: string, warn: (message: string) => void = console.warn): LedgerEntry[] {
  const lines = raw.split('\n');
  let last = lines.length - 1;
  while (last >= 0 && !lines[last]!.trim()) last--;
  const entries: LedgerEntry[] = [];
  lines.forEach((line, index) => {
    if (!line.trim()) return;
    try {
      const entry = JSON.parse(line) as LedgerEntry;
      if (!entry || typeof entry.runId !== 'string' || !Number.isFinite(entry.guardCostUsd) ||
          !Number.isFinite(entry.tokensIn) || !Number.isFinite(entry.tokensOut)) throw new Error('レジャの形が不正です');
      entries.push({ ...entry, httpStatus: entry.httpStatus ?? null, failureClass: entry.failureClass ?? null });
    } catch {
      if (index === last && !raw.endsWith('\n')) { warn('費用レジャの途中で切れた最終行を無視しました'); return; }
      throw new Error(`費用レジャの ${index + 1} 行目が壊れています`);
    }
  });
  return entries;
}
export async function readLedger(file: string, required = false): Promise<LedgerEntry[]> {
  try { return parseLedger(await readFile(file, 'utf8')); } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      if (required) throw new Error('_ledger.jsonl がありません');
      return [];
    }
    throw error;
  }
}
export function assertRunLedger(runIds: string[], ledger: LedgerEntry[]): void {
  if (runIds.some((runId) => !ledger.some((entry) => entry.runId === runId))) throw new Error('台帳のない run があります');
}
export async function assertRunFilesLedger(dir: string, ledger: LedgerEntry[]): Promise<void> {
  for (const name of await readdir(dir)) {
    if (!name.endsWith('.json') || name.startsWith('_')) continue;
    const run = JSON.parse(await readFile(path.join(dir, name), 'utf8')) as { runId: string };
    assertRunLedger([run.runId], ledger);
  }
}
export async function budgetSpend(outputs: string, other: number): Promise<{ labels: Record<string, number>; other: number; total: number }> {
  const labels: Record<string, number> = {};
  let entries: Dirent[];
  try { entries = await readdir(outputs, { withFileTypes: true }); } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    entries = [];
  }
  for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
    if (entry.isDirectory() && entry.name.startsWith('runs-')) {
      labels[entry.name.slice(5)] = (await readLedger(path.join(outputs, entry.name, '_ledger.jsonl'))).reduce((sum, line) => sum + line.guardCostUsd, 0);
    }
  }
  return { labels, other, total: Object.values(labels).reduce((sum, cost) => sum + cost, other) };
}
export function ledgerWriter(file: string): (entry: LedgerEntry) => Promise<void> {
  let chain = Promise.resolve();
  let repaired = false;
  return (entry) => {
    chain = chain.then(async () => {
      // 切れた末尾へ JSON を連結しない。読み取りで許容した末尾だけを除いてから追記する。
      if (!repaired) {
        let raw: string | null = null;
        try { raw = await readFile(file, 'utf8'); } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
        if (raw !== null && !raw.endsWith('\n')) {
          const valid = parseLedger(raw);
          await writeFile(file, valid.map((line) => JSON.stringify(line) + '\n').join(''), 'utf8');
        }
        repaired = true;
      }
      await appendFile(file, JSON.stringify(entry) + '\n', 'utf8');
    });
    return chain;
  };
}
