import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { benchRoot, TARGETS } from './config';
import { outcomeFields } from './outcomeFields';
import { buildOutcomeGold } from './outcomeGold';
import type { GoldFile } from './validateGold';

async function main(): Promise<void> {
  const files = await Promise.all(TARGETS.map(async ({ pdfId }) => {
    const gold = JSON.parse(await readFile(path.join(benchRoot, 'gold', `${pdfId}.json`), 'utf8')) as GoldFile;
    return { ...gold, rows: buildOutcomeGold(gold.rows) };
  }));
  await mkdir(path.join(benchRoot, 'gold-outcome'), { recursive: true });
  await mkdir(path.join(benchRoot, 'schema'), { recursive: true });
  let groups = 0, rows = 0, reported = 0;
  console.log('論文\t組の数\t行数\t報告済み');
  for (const gold of files) {
    const g = new Set(gold.rows.map((r) => r.entity_key)).size;
    const n = gold.rows.filter((r) => !r.not_reported).length;
    groups += g; rows += gold.rows.length; reported += n;
    console.log(`${gold.pdf_id}\t${g}\t${gold.rows.length}\t${n}`);
    await writeFile(path.join(benchRoot, 'gold-outcome', `${gold.pdf_id}.json`), JSON.stringify(gold, null, 2), 'utf8');
  }
  console.log(`合計\t${groups}\t${rows}\t${reported}`);
  for (const [condition, name] of [['F', 'free'], ['L', 'list']] as const) {
    await writeFile(path.join(benchRoot, 'schema', `benchmark-schema-outcome-${name}.json`),
      JSON.stringify({ schema_version: 1, fields: outcomeFields(condition) }, null, 2), 'utf8');
  }
}

await main();
