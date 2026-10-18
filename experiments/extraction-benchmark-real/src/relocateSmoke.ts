// relocate-quote skill の実 LLM smoke（issue #94 の follow-up。統合担当のローカル確認用）。
// v6 flash run（runs-v6-flash-20260713）で実際に anchor failed になった quote を入力に、
// 本番の relocateQuote skill（プロンプト + スキーマ + パース）→ 本番 anchorQuote で再検証し、
// 「実データの失敗 quote を何件救えるか」を測る。書き込みは一切しない（Sheets/Drive 非接続）。
//
// 実行: npx tsx src/relocateSmoke.ts（ベンチ直下。API 課金あり: gemini-3.5-flash ~10 コール）
import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import dotenv from 'dotenv';
import {
  RELOCATE_QUOTE_RESPONSE_SCHEMA,
  RELOCATE_QUOTE_SYSTEM_PROMPT,
  buildRelocateQuoteUserPrompt,
  parseRelocateQuoteResponse,
  selectRelocateQuoteWindow,
} from '../../../src/features/extraction/skills/relocateQuote';
import { anchorQuote } from '../../../src/features/anchoring/anchorQuote';
import { normalizeText } from '../../../src/features/anchoring/normalizeText';
import { createProvider } from '../../../src/lib/llm/providerFactory';
import { estimateCostUsd } from '../../../src/lib/llm/pricing';
import type { NormalizedPage } from '../../../src/domain/anchor';
import type { ExtractDataPage } from '../../../src/features/extraction/skills/extractData';
import { benchRoot, repoRoot } from './config';
import { loadBenchmarkSchema } from './loadSchema';

const MODEL = 'gemini-3.5-flash';
const RUNS_DIR = path.join(benchRoot, 'outputs', 'runs-v6-flash-20260713');
const TEXTLAYER_DIR = path.join(benchRoot, 'outputs', 'textlayer');
/** 論文の偏りを避けるため 1 論文あたりの採用上限 */
const MAX_PER_PAPER = 2;
const MAX_CASES = 10;

interface SmokeCase {
  paper: string;
  fieldId: string;
  entityKey: string;
  value: string | null;
  quote: string;
  page: number | null;
}

async function collectFailedCases(): Promise<SmokeCase[]> {
  const cases: SmokeCase[] = [];
  const perPaper = new Map<string, number>();
  for (const file of (await readdir(RUNS_DIR)).sort()) {
    if (!file.endsWith('.json')) continue;
    const paper = /__(.+)__r\d+\.json$/.exec(file)?.[1] ?? file;
    const run = JSON.parse(await readFile(path.join(RUNS_DIR, file), 'utf8')) as {
      items?: Array<{
        fieldId?: string;
        field_id?: string;
        entityKey?: string;
        entity_key?: string;
        value?: unknown;
        quote?: string | null;
        page?: number | null;
        anchor?: { status?: string };
        anchorStatus?: string;
      }>;
    };
    for (const item of run.items ?? []) {
      const status = item.anchor?.status ?? item.anchorStatus;
      if (status !== 'failed' || item.quote == null) continue;
      const used = perPaper.get(paper) ?? 0;
      if (used >= MAX_PER_PAPER || cases.length >= MAX_CASES) continue;
      perPaper.set(paper, used + 1);
      cases.push({
        paper,
        fieldId: item.fieldId ?? item.field_id ?? '(unknown)',
        entityKey: item.entityKey ?? item.entity_key ?? '-',
        value: item.value == null ? null : String(item.value),
        quote: item.quote,
        page: item.page ?? null,
      });
    }
  }
  return cases;
}

async function main(): Promise<void> {
  dotenv.config({ path: path.join(benchRoot, '.env') });
  dotenv.config({ path: path.join(repoRoot, '.env') });
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw new Error('GEMINI_API_KEY が .env にありません');

  const schema = await loadBenchmarkSchema();
  const fieldById = new Map(schema.map((f) => [f.fieldId, f]));
  const provider = createProvider({ apiKey, model: MODEL });
  const cases = await collectFailedCases();
  console.log(`smoke 対象: ${cases.length} 件（v6 flash run の anchor failed 実サンプル）`);

  let relocated = 0;
  let notFound = 0;
  let stillFailed = 0;
  let totalCost = 0;

  for (const [i, c] of cases.entries()) {
    const field = fieldById.get(c.fieldId);
    if (!field) {
      console.log(`[${i + 1}] ${c.paper}/${c.fieldId}: スキーマに無い field → skip`);
      continue;
    }
    const textlayer = JSON.parse(
      await readFile(path.join(TEXTLAYER_DIR, `${c.paper}.json`), 'utf8'),
    ) as { pages: Array<{ page: number; text: string }> };
    const pages: ExtractDataPage[] = textlayer.pages.map((p) => ({ page: p.page, text: p.text }));
    const normalizedPages: NormalizedPage[] = pages.map((p) => ({
      page: p.page,
      text: normalizeText(p.text),
    }));

    // 入力の前提確認: 元 quote が本当に failed か（本番と同じ全文書アンカリング）
    const before = anchorQuote(normalizeText(c.quote), normalizedPages, c.page);
    if (before.status !== 'failed') {
      console.log(`[${i + 1}] ${c.paper}/${c.fieldId}: 元 quote が ${before.status} で失敗前提が崩れた → skip`);
      continue;
    }

    const windowPages = selectRelocateQuoteWindow(pages, c.page);
    const response = await provider.chat(
      [
        { role: 'system', content: RELOCATE_QUOTE_SYSTEM_PROMPT },
        {
          role: 'user',
          content: buildRelocateQuoteUserPrompt({
            field,
            value: c.value,
            originalQuote: c.quote,
            originalPage: c.page,
            pages: windowPages,
          }),
        },
      ],
      { temperature: 0, responseSchema: RELOCATE_QUOTE_RESPONSE_SCHEMA },
    );
    totalCost += estimateCostUsd(MODEL, response.tokensIn, response.tokensOut) ?? 0;

    let verdict: string;
    try {
      const parsed = parseRelocateQuoteResponse(response.text);
      if (!parsed.found || parsed.quote === null) {
        notFound++;
        verdict = 'not_found（モデル申告）';
      } else {
        const anchor = anchorQuote(normalizeText(parsed.quote), normalizedPages, parsed.page);
        if (anchor.status === 'failed') {
          stillFailed++;
          verdict = `再特定 quote も failed（quote="${parsed.quote.slice(0, 60)}..."）`;
        } else {
          relocated++;
          verdict = `救済 ${anchor.status} p${anchor.page}（quote="${parsed.quote.slice(0, 60)}..."）`;
        }
      }
    } catch (error) {
      notFound++;
      verdict = `パース不能 → not_found 扱い（${(error as Error).message.slice(0, 60)}）`;
    }
    console.log(`[${i + 1}] ${c.paper}/${c.fieldId}(${c.entityKey}) value=${c.value}: ${verdict}`);
  }

  console.log('---');
  console.log(
    `結果: 救済 ${relocated} / not_found ${notFound} / 再failed ${stillFailed}（計 ${
      relocated + notFound + stillFailed
    } 件・概算 $${totalCost.toFixed(4)}）`,
  );
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
