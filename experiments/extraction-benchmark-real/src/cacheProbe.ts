// issue #89 受け入れ条件 4 の実測プローブ: 「同一 study（文書固定）× 異なる fields バッチ」の
// 2 連続コールで、2 コール目に Gemini implicit caching が効くか（usageMetadata.cachedContentTokenCount）を
// 直接測る。本番 executeRun の section 分割（1 study 複数バッチ）を最小構成で模す。
// 実行時のツリーの extractData.ts（v4 or v5）がそのまま効くので、差し替えて 2 回走らせて比較する。
// ★API 課金あり（flash-lite 2 コール ≈ $0.04 / 回）
import path from 'node:path';
import { loadLocalConfig } from './localConfig';
import { readFile } from 'node:fs/promises';
import dotenv from 'dotenv';
import {
  buildExtractDataSystemPrompt,
  buildExtractDataUserContent,
  extractDataResponseSchema,
  EXTRACT_DATA_PROMPT_VERSION,
  type ExtractDataPage,
} from '../../../src/features/extraction/skills/extractData';
import { createProvider } from '../../../src/lib/llm/providerFactory';
import { benchRoot, repoRoot } from './config';
import { loadBenchmarkSchema } from './loadSchema';

dotenv.config({ path: [path.join(benchRoot, '.env'), path.join(repoRoot, '.env')], quiet: true });

const MODEL = 'gemini-3.1-flash-lite';
const PDF_ID = loadLocalConfig().probes.cachePdfId;

async function main(): Promise<void> {
  const apiKey = process.env['GEMINI_API_KEY'];
  if (apiKey === undefined || apiKey === '') throw new Error('GEMINI_API_KEY がありません');
  const provider = createProvider({ apiKey, model: MODEL });

  const raw = await readFile(path.join(benchRoot, 'outputs', 'textlayer', `${PDF_ID}.json`), 'utf8');
  const pages = (JSON.parse(raw) as { pages: ExtractDataPage[] }).pages;
  const fields = await loadBenchmarkSchema();
  // バッチ A / B: 先頭 20 項目と続く 20 項目（本番の section 分割相当 = fields だけが変わる）
  const batchA = fields.slice(0, 20);
  const batchB = fields.slice(20, 40);

  console.log(`promptVersion=${EXTRACT_DATA_PROMPT_VERSION} model=${MODEL} pdf=${PDF_ID}`);
  for (const [label, batch] of [['batchA', batchA], ['batchB', batchB]] as const) {
    const content = buildExtractDataUserContent({
      fields: batch,
      documents: [{ role: 'article', filename: `${PDF_ID}.pdf`, mode: 'text', pages }],
    });
    const t0 = Date.now();
    const res = await provider.chat(
      [
        { role: 'system', content: buildExtractDataSystemPrompt(false) },
        { role: 'user', content },
      ],
      { temperature: 0, maxOutputTokens: 16384, responseSchema: extractDataResponseSchema(false) },
    );
    const usage = (res.raw as { usageMetadata?: Record<string, unknown> }).usageMetadata ?? {};
    console.log(
      `${label}: promptTokens=${String(usage['promptTokenCount'])} ` +
        `cached=${String(usage['cachedContentTokenCount'] ?? 0)} ` +
        `elapsed=${Date.now() - t0}ms`,
    );
    await new Promise((resolve) => setTimeout(resolve, 2000));
  }
}

await main();
