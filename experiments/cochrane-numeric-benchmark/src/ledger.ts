import { appendFile, readFile, writeFile } from 'node:fs/promises';
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
      entries.push(entry);
    } catch {
      if (index === last && !raw.endsWith('\n')) { warn('費用レジャの途中で切れた最終行を無視しました'); return; }
      throw new Error(`費用レジャの ${index + 1} 行目が壊れています`);
    }
  });
  return entries;
}
export async function readLedger(file: string): Promise<LedgerEntry[]> {
  try { return parseLedger(await readFile(file, 'utf8')); } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [];
    throw error;
  }
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
