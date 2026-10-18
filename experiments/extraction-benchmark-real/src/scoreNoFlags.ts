// 参考値: 治療の構成要素のフラグ 17 個（gold は「書かれていなければ 0」の取り決め）を除いた正確度。
// 一致の規則は主指標と同じ（src/entityGroups.ts の classifyRow + matchesValue）。
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { runsDir } from './config';
import { matchesValue, type RunItem } from './metrics';
import { validateAllGold } from './validateGold';
import { classifyRow } from './entityGroups';

const FLAGS = new Set(['se', 'sd', 'cr', 'cw', 'sr', 'sc', 're', 'pi', 'w', 'dt', 'ns', 'he', 'tg', 'ind', 'gp', 'ff', 'ae']);

const gold = await validateAllGold();
const dir = runsDir();
const tally = new Map<string, { rows: number; correct: number; flagRows: number; flagCorrect: number }>();
for (const name of (await readdir(dir)).filter((n) => n.endsWith('.json') && !n.startsWith('_'))) {
  const run = JSON.parse(await readFile(path.join(dir, name), 'utf8')) as { model: string; pdfId: string; items: RunItem[] };
  const g = gold.get(run.pdfId);
  if (g === undefined) throw new Error(`gold が無い: ${run.pdfId}`);
  const items = new Map(run.items.map((i) => [`${i.fieldId} ${i.entityKey}`, i]));
  const t = tally.get(run.model) ?? { rows: 0, correct: 0, flagRows: 0, flagCorrect: 0 };
  for (const row of g.rows) {
    const ok = classifyRow(row, items.get(`${row.field_id} ${row.entity_key}`), matchesValue) === 'correct';
    if (FLAGS.has(row.field_id)) { t.flagRows += 1; if (ok) t.flagCorrect += 1; }
    else { t.rows += 1; if (ok) t.correct += 1; }
  }
  tally.set(run.model, t);
}
for (const [model, t] of tally) {
  console.log(`${model}: フラグ以外 ${t.correct}/${t.rows} = ${((t.correct / t.rows) * 100).toFixed(1)}% / フラグ ${t.flagCorrect}/${t.flagRows} = ${((t.flagCorrect / t.flagRows) * 100).toFixed(1)}%`);
}
