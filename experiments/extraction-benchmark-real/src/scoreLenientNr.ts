// 参考値: 「gold は値あり・AI は未報告」を正解に数えた場合の正確度（2 通り）。
//   A: 全項目で、AI の未報告を正解に数える
//   B: 治療の構成要素のフラグ 17 個で gold が 0 のときだけ、AI の未報告を正解に数える
// それ以外の判定は主指標と同じ（src/entityGroups.ts の classifyRow + matchesValue）。
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { runsDir } from './config';
import { matchesValue, type RunItem } from './metrics';
import { validateAllGold } from './validateGold';
import { classifyRow } from './entityGroups';

const FLAGS = new Set(['se', 'sd', 'cr', 'cw', 'sr', 'sc', 're', 'pi', 'w', 'dt', 'ns', 'he', 'tg', 'ind', 'gp', 'ff', 'ae']);

const gold = await validateAllGold();
const dir = runsDir();
const tally = new Map<string, { rows: number; strict: number; lenientAll: number; lenientFlagZero: number }>();
for (const name of (await readdir(dir)).filter((n) => n.endsWith('.json') && !n.startsWith('_'))) {
  const run = JSON.parse(await readFile(path.join(dir, name), 'utf8')) as { model: string; pdfId: string; items: RunItem[] };
  const g = gold.get(run.pdfId);
  if (g === undefined) throw new Error(`gold が無い: ${run.pdfId}`);
  const items = new Map(run.items.map((i) => [`${i.fieldId} ${i.entityKey}`, i]));
  const t = tally.get(run.model) ?? { rows: 0, strict: 0, lenientAll: 0, lenientFlagZero: 0 };
  for (const row of g.rows) {
    const outcome = classifyRow(row, items.get(`${row.field_id} ${row.entity_key}`), matchesValue);
    t.rows += 1;
    if (outcome === 'correct') { t.strict += 1; t.lenientAll += 1; t.lenientFlagZero += 1; continue; }
    if (outcome === 'missed_value') {
      t.lenientAll += 1;
      if (FLAGS.has(row.field_id) && row.value_gold?.trim() === '0') t.lenientFlagZero += 1;
    }
  }
  tally.set(run.model, t);
}
const pct = (n: number, d: number) => `${((n / d) * 100).toFixed(1)}%`;
for (const [model, t] of tally) {
  console.log(`${model}: 主指標 ${pct(t.strict, t.rows)} / A 全項目で未報告を正解 ${pct(t.lenientAll, t.rows)}（${t.lenientAll}/${t.rows}） / B フラグの 0 だけ ${pct(t.lenientFlagZero, t.rows)}（${t.lenientFlagZero}/${t.rows}）`);
}
