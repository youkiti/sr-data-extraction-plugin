// TypeSafe System One（jev）の疎通確認。論文 1 本の全文と、初回抽出が未報告としたセルの一部を
// 「値が報告されているか」の noul 質問として 1 リクエストで送り、応答の形・所要時間・使用量を見る。
// ★外部 API を 1 回だけ呼ぶ。キー（TYPE_SAFE_API_KEY）は環境変数から読み、ログに出さない。
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { loadLocalConfig } from './localConfig';
import { benchRoot } from './config';
import { loadBenchmarkSchema } from './loadSchema';

const PDF_ID = process.env.JEV_PROBE_PDF ?? loadLocalConfig().probes.jevPdfId;
const BASE_RUN = `outputs/runs-v10-issue275-20260930/gemini-3.5-flash__text_only__${PDF_ID}__r1.json`;
const MAX_QUESTIONS = Number(process.env.JEV_PROBE_QUESTIONS ?? '200');
const QUESTION =
  'Does `document` explicitly report a value for `field` for the study arm `arm`? Answer yes only if the value itself is stated in the document.';

interface Item { fieldId: string; entityKey: string; value: string | null; notReported: boolean }

async function main(): Promise<void> {
  const apiKey = process.env.TYPE_SAFE_API_KEY?.trim();
  if (!apiKey) throw new Error('TYPE_SAFE_API_KEY がありません');
  const pages = (JSON.parse(await readFile(path.join(benchRoot, 'outputs', 'textlayer', `${PDF_ID}.json`), 'utf8')) as {
    pages: Array<{ page: number; text: string }>;
  }).pages;
  const document = pages.map((p) => `[PAGE ${p.page}]\n${p.text}`).join('\n\n');
  const run = JSON.parse(await readFile(path.join(benchRoot, BASE_RUN), 'utf8')) as { items: Item[] };
  const gold = JSON.parse(await readFile(path.join(benchRoot, 'gold', `${PDF_ID}.json`), 'utf8')) as {
    rows: Array<{ field_id: string; entity_key: string; not_reported: boolean; value_gold: string | null }>;
  };
  const goldByKey = new Map(gold.rows.map((r) => [`${r.field_id} ${r.entity_key}`, r]));
  const fields = new Map((await loadBenchmarkSchema()).map((f) => [f.fieldId, f]));
  const armNames = new Map(run.items.filter((i) => i.fieldId === 'arm_name').map((i) => [i.entityKey, i.value ?? i.entityKey]));

  // 群レベルの未報告セルを先頭から MAX_QUESTIONS 個（gold が報告済みのものと未報告のものを交互に）
  const cells = run.items.filter((i) => i.notReported);
  const reported = cells.filter((c) => goldByKey.get(`${c.fieldId} ${c.entityKey}`)?.not_reported === false);
  const unreported = cells.filter((c) => goldByKey.get(`${c.fieldId} ${c.entityKey}`)?.not_reported === true);
  const picked: Item[] = [];
  for (let i = 0; picked.length < MAX_QUESTIONS && (i < reported.length || i < unreported.length); i++) {
    if (reported[i]) picked.push(reported[i]!);
    if (unreported[i] && picked.length < MAX_QUESTIONS) picked.push(unreported[i]!);
  }

  const questions: Record<string, unknown> = {};
  picked.forEach((cell, index) => {
    const field = fields.get(cell.fieldId)!;
    questions[`q${index}`] = {
      type: 'noul',
      instructions: {
        field: { name: field.fieldName, description: field.extractionInstruction },
        arm: cell.entityKey === '-' ? 'the whole study (not arm-specific)' : (armNames.get(cell.entityKey) ?? cell.entityKey),
        question: QUESTION,
      },
    };
  });

  const body = JSON.stringify({ model: 'jev-1.13.0', state: { document }, questions });
  console.log(`論文 ${PDF_ID}: 本文 ${document.length} 文字 / 質問 ${picked.length} 個 / リクエスト ${body.length} 文字`);
  const t0 = Date.now();
  const response = await fetch('https://api.typesafe.ai/v1/systemone', {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body,
    signal: AbortSignal.timeout(120_000),
  });
  const elapsed = Date.now() - t0;
  const text = await response.text();
  console.log(`HTTP ${response.status} / ${elapsed}ms`);
  if (!response.ok) {
    console.log(text.slice(0, 600).split(apiKey).join('[KEY]'));
    return;
  }
  const data = JSON.parse(text) as { model?: string; usage?: unknown; answers?: Record<string, { noul?: number }> };
  console.log('model:', data.model, 'usage:', JSON.stringify(data.usage));
  picked.forEach((cell, index) => {
    const g = goldByKey.get(`${cell.fieldId} ${cell.entityKey}`);
    const noul = data.answers?.[`q${index}`]?.noul;
    console.log(
      `${cell.fieldId}\t${cell.entityKey}\tgold=${g?.not_reported ? '未報告' : `報告済み(${g?.value_gold})`}\tnoul=${typeof noul === 'number' ? noul.toFixed(3) : String(noul)}`,
    );
  });
}

await main();
