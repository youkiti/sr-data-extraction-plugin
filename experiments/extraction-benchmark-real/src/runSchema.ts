import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';

export function assertRunSchema(current: string, runs: readonly { name: string; schemaFile?: string }[]): void {
  for (const run of runs) {
    if (!run.name.endsWith('.json') || run.name.startsWith('_')) continue;
    if ((run.schemaFile ?? 'benchmark-schema.json') !== current) {
      throw new Error(`スキーマが異なる run があります: ${run.name}`);
    }
  }
}

export async function checkRunSchemas(dir: string, current: string): Promise<void> {
  let names: string[];
  try { names = await readdir(dir); } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return;
    throw error;
  }
  const runs = [];
  for (const name of names.filter((name) => name.endsWith('.json') && !name.startsWith('_'))) {
    const raw = await readFile(path.join(dir, name), 'utf8');
    try {
      const run = JSON.parse(raw) as { schemaFile?: string } | null;
      runs.push({ name, schemaFile: run?.schemaFile });
    } catch (error) {
      // 壊れた JSON は runner の既存の再試行判定に委ねる。
      if (!(error instanceof SyntaxError)) throw error;
    }
  }
  assertRunSchema(current, runs);
}
