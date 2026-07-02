// ステップ 6 の素材: anchored-all.json を §5.1 の指標で集計し、失敗行の詳細を出す
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { AnchorResult } from './anchor.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const spikeRoot = path.resolve(here, '..');

interface AnchoredRow {
  run: string;
  pdfId: string;
  mode: string;
  field_id: string;
  entity_key: string;
  value: string | null;
  not_reported: boolean;
  quote: string | null;
  page: number | null;
  confidence: string;
  anchorBase: AnchorResult | null;
  anchorExtended: AnchorResult | null;
}

interface SchemaField {
  field_id: string;
  entity_level: string;
}

function pct(n: number, d: number): string {
  return d === 0 ? '-' : `${((n / d) * 100).toFixed(1)}%`;
}

interface Tally {
  n: number;
  exact: number;
  normalized: number;
  fuzzy: number;
  failed: number;
}

function newTally(): Tally {
  return { n: 0, exact: 0, normalized: 0, fuzzy: 0, failed: 0 };
}

function add(t: Tally, s: AnchorResult['status']): void {
  t.n++;
  t[s]++;
}

function fmt(label: string, t: Tally): string {
  const anchored = t.exact + t.normalized + t.fuzzy;
  const verbatim = t.exact + t.normalized;
  return `| ${label} | ${t.n} | ${t.exact} | ${t.normalized} | ${t.fuzzy} | ${t.failed} | ${pct(verbatim, t.n)} | ${pct(anchored, t.n)} |`;
}

async function main(): Promise<void> {
  const anchored = JSON.parse(
    await readFile(path.join(spikeRoot, 'outputs', 'anchored', 'anchored-all.json'), 'utf8'),
  ) as AnchoredRow[];
  const schema = JSON.parse(
    await readFile(path.join(spikeRoot, 'schema', 'mini-schema.json'), 'utf8'),
  ) as { fields: SchemaField[] };
  const levelByField = new Map(schema.fields.map((f) => [f.field_id, f.entity_level]));

  const rows = anchored.filter((a) => a.anchorBase != null);
  const groups = new Map<string, Tally>();
  const groupAdd = (key: string, s: AnchorResult['status']): void => {
    const t = groups.get(key) ?? newTally();
    add(t, s);
    groups.set(key, t);
  };

  for (const r of rows) {
    const s = (r.anchorBase as AnchorResult).status;
    groupAdd('ALL', s);
    groupAdd(`mode:${r.mode}`, s);
    groupAdd(`pdf:${r.pdfId}`, s);
    groupAdd(`level:${levelByField.get(r.field_id) ?? '?'}`, s);
    groupAdd(`mode:${r.mode}|level:${levelByField.get(r.field_id) ?? '?'}`, s);
    groupAdd(`pdf:${r.pdfId}|mode:${r.mode}`, s);
  }

  const lines: string[] = [];
  lines.push('| 区分 | n | exact | normalized | fuzzy | failed | verbatim 率 | anchor 成功率 |');
  lines.push('|---|---|---|---|---|---|---|---|');
  for (const key of [...groups.keys()].sort()) {
    lines.push(fmt(key, groups.get(key) as Tally));
  }

  // 非 exact 行の詳細（定性分析用）
  lines.push('');
  lines.push('## 非 exact 行の詳細');
  for (const r of rows) {
    const a = r.anchorBase as AnchorResult;
    if (a.status === 'exact') continue;
    lines.push('');
    lines.push(
      `- ${r.run} ${r.field_id} ${r.entity_key} → **${a.status}** (ai_page=${r.page}, matched_page=${a.page}, dist=${a.bestDistance}, ratio=${a.distanceRatio?.toFixed(3) ?? '-'}, extended=${r.anchorExtended?.status})`,
    );
    lines.push(`  - quote: ${JSON.stringify(r.quote)}`);
  }

  // 複数一致の計測
  const multi = rows.filter((r) => (r.anchorBase as AnchorResult).matchCount > 1);
  lines.push('');
  lines.push(`## 複数一致（matchCount > 1）: ${multi.length} 行`);
  for (const r of multi) {
    lines.push(
      `- ${r.run} ${r.field_id} ${r.entity_key}: ${String((r.anchorBase as AnchorResult).matchCount)} 箇所 (quote=${JSON.stringify(r.quote?.slice(0, 60))})`,
    );
  }

  // not_reported / quote なし
  const noQuote = anchored.filter((a) => a.anchorBase == null);
  lines.push('');
  lines.push(`## quote なし（not_reported 等）: ${noQuote.length} 行`);
  for (const r of noQuote) {
    lines.push(`- ${r.run} ${r.field_id} ${r.entity_key} (not_reported=${r.not_reported}, value=${JSON.stringify(r.value)})`);
  }

  // モード間の値一致（Q3 の補助材料）
  lines.push('');
  lines.push('## モード間の値比較（pdf_native vs text_only）');
  const byKey = new Map<string, Map<string, AnchoredRow>>();
  for (const r of anchored) {
    const k = `${r.pdfId}|${r.field_id}|${r.entity_key}`;
    const m = byKey.get(k) ?? new Map<string, AnchoredRow>();
    m.set(r.mode, r);
    byKey.set(k, m);
  }
  let same = 0;
  let diff = 0;
  const diffs: string[] = [];
  for (const [k, m] of byKey) {
    const a = m.get('pdf_native');
    const b = m.get('text_only');
    if (!a || !b) continue;
    if ((a.value ?? '') === (b.value ?? '')) {
      same++;
    } else {
      diff++;
      diffs.push(`- ${k}: pdf_native=${JSON.stringify(a.value)} / text_only=${JSON.stringify(b.value)}`);
    }
  }
  lines.push(`値完全一致: ${same} / ${same + diff}`);
  lines.push(...diffs);

  const out = lines.join('\n');
  await writeFile(path.join(spikeRoot, 'outputs', 'report-tables.md'), out, 'utf8');
  console.log(out);
}

await main();
