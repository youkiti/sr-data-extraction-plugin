// LLM 実行 → outputs/runs/{runId}.json（IMPLEMENTATION.md §8）。
// 本番コード（プロンプト構築・応答検証・アンカリング・LLM 呼び出し・単価）をそのまま import して
// 二重管理を避ける。1 run = (model, pdfId, repeat)。計 3 モデル × 2 論文 × 3 反復 = 18 run。
//
// ★このスクリプトは API 課金が発生する。実行前に .env（GEMINI_API_KEY / OPENROUTER_API_KEY）と
//   outputs/textlayer/*.json（npm run extract-text 済み）が必要。累計コストが上限 $5 に達したら中断する。
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import dotenv from 'dotenv';
import {
  buildExtractDataUserPrompt,
  EXTRACT_DATA_PROMPT_VERSION,
  EXTRACT_DATA_RESPONSE_SCHEMA,
  EXTRACT_DATA_SYSTEM_PROMPT,
  parseExtractDataResponse,
  type ExtractDataPage,
} from '../../../src/features/extraction/skills/extractData';
import { AiOutputFormatError } from '../../../src/features/extraction/validateAiOutput';
import type {
  RejectedAiItem,
  ValidatedAiItem,
} from '../../../src/features/extraction/validateAiOutput';
import { createProvider } from '../../../src/lib/llm/providerFactory';
import {
  LlmProviderError,
  type ChatMessage,
  type ChatOptions,
  type ChatResponse,
  type LLMProvider,
} from '../../../src/lib/llm/LLMProvider';
import { normalizeText } from '../../../src/features/anchoring/normalizeText';
import { anchorQuote } from '../../../src/features/anchoring/anchorQuote';
import { estimateCostUsd } from '../../../src/lib/llm/pricing';
import type { AnchorResult, NormalizedPage } from '../../../src/domain/anchor';
import { benchRoot, MODELS, REPEATS, TARGETS } from './config';
import { loadBenchmarkSchema } from './loadSchema';

dotenv.config({ path: path.join(benchRoot, '.env'), quiet: true });

/** コスト上限（README §7 / §9 #6）。累計概算がこれに達したら中断して報告する */
const COST_LIMIT_USD = 5;

/** quote アンカリング結果を付与した検証済み要素 */
type AnchoredItem = ValidatedAiItem & { anchor: AnchorResult | null };

async function loadPages(pdfId: string): Promise<ExtractDataPage[]> {
  const raw = await readFile(
    path.join(benchRoot, 'outputs', 'textlayer', `${pdfId}.json`),
    'utf8',
  );
  return (JSON.parse(raw) as { pages: ExtractDataPage[] }).pages;
}

/** 正規化済みページを 1 回だけ作って quote アンカリングで使い回す */
function toNormalizedPages(pages: ExtractDataPage[]): NormalizedPage[] {
  return pages.map((p) => ({ page: p.page, text: normalizeText(p.text) }));
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** 429 / 5xx は数秒待って最大 3 回まで再試行する（IMPLEMENTATION.md §8） */
async function chatWithRetry(
  provider: LLMProvider,
  messages: ChatMessage[],
  options: ChatOptions,
): Promise<ChatResponse> {
  const maxAttempts = 3;
  let lastError: unknown;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await provider.chat(messages, options);
    } catch (error) {
      lastError = error;
      const status = error instanceof LlmProviderError ? error.status : null;
      const retriable = status === 429 || (status !== null && status >= 500);
      if (!retriable || attempt === maxAttempts) {
        throw error;
      }
      const waitMs = attempt * 5000;
      console.warn(`  再試行 ${attempt}/${maxAttempts - 1}（${waitMs}ms 待機・status=${status ?? 'n/a'}）`);
      await sleep(waitMs);
    }
  }
  throw lastError;
}

interface RunRecord {
  runId: string;
  model: string;
  pdfId: string;
  repeat: number;
  promptVersion: number;
  executedAt: string;
  elapsedMs: number;
  tokensIn: number | null;
  tokensOut: number | null;
  costUsd: number | null;
  /** LLM 呼び出しが 3 回試行しても失敗した場合のメッセージ（成功時 null） */
  error: string | null;
  /** 応答が JSON としてパースできなかった場合のメッセージ（成功時 null） */
  formatError: string | null;
  rejected: RejectedAiItem[];
  items: AnchoredItem[];
  rawResponse: unknown;
}

async function writeRun(outDir: string, record: RunRecord): Promise<void> {
  await writeFile(
    path.join(outDir, `${record.runId}.json`),
    JSON.stringify(record, null, 1),
    'utf8',
  );
}

async function main(): Promise<void> {
  const fields = await loadBenchmarkSchema();
  const outDir = path.join(benchRoot, 'outputs', 'runs');
  await mkdir(outDir, { recursive: true });

  let totalCost = 0;

  for (const model of MODELS) {
    const apiKey = process.env[model.keyEnv];
    if (apiKey === undefined || apiKey === '') {
      throw new Error(`${model.keyEnv} が .env にありません（model=${model.id}）`);
    }
    const provider = createProvider({ apiKey, model: model.id });

    for (const target of TARGETS) {
      const pages = await loadPages(target.pdfId);
      const normPages = toNormalizedPages(pages);
      const userPrompt = buildExtractDataUserPrompt({ fields, pages });

      for (let r = 1; r <= REPEATS; r++) {
        const runId = `${model.id.replace(/\//g, '__')}__${target.pdfId}__r${r}`;
        const t0 = Date.now();

        let res: ChatResponse | null = null;
        let transportError: string | null = null;
        try {
          res = await chatWithRetry(
            provider,
            [
              { role: 'system', content: EXTRACT_DATA_SYSTEM_PROMPT },
              { role: 'user', content: userPrompt },
            ],
            { temperature: 0, responseSchema: EXTRACT_DATA_RESPONSE_SCHEMA },
          );
        } catch (error) {
          // 3 回試行しても失敗 → error フラグで保存し握りつぶさず先へ進む（作業原則 6）
          transportError = String(error);
        }
        const elapsedMs = Date.now() - t0;

        let items: AnchoredItem[] = [];
        let rejected: RejectedAiItem[] = [];
        let formatError: string | null = null;
        if (res !== null) {
          try {
            const parsed = parseExtractDataResponse(res.text, fields);
            rejected = parsed.rejected;
            items = parsed.items.map((item) => {
              const normQuote = item.quote ? normalizeText(item.quote) : '';
              // quote なしは anchor 対象外（指標(3)の分母から除外される）
              const anchor = normQuote ? anchorQuote(normQuote, normPages, item.page) : null;
              return { ...item, anchor };
            });
          } catch (error) {
            if (error instanceof AiOutputFormatError) {
              // JSON パース不能 = バッチ全体失敗。全 field 欠落として採点側が扱えるよう items:[] で保存
              formatError = error.message;
            } else {
              throw error;
            }
          }
        }

        const tokensIn = res?.tokensIn ?? null;
        const tokensOut = res?.tokensOut ?? null;
        const costUsd = estimateCostUsd(model.id, tokensIn, tokensOut);
        totalCost += costUsd ?? 0;

        await writeRun(outDir, {
          runId,
          model: model.id,
          pdfId: target.pdfId,
          repeat: r,
          promptVersion: EXTRACT_DATA_PROMPT_VERSION,
          executedAt: new Date().toISOString(),
          elapsedMs,
          tokensIn,
          tokensOut,
          costUsd,
          error: transportError,
          formatError,
          rejected,
          items,
          rawResponse: res?.raw ?? null,
        });

        const flag = transportError ? ' ERROR' : formatError ? ' FORMAT_ERROR' : '';
        console.log(
          `${runId}: items=${items.length} rejected=${rejected.length} ${elapsedMs}ms ` +
            `cost=$${(costUsd ?? 0).toFixed(4)} 累計=$${totalCost.toFixed(4)}${flag}`,
        );

        if (totalCost >= COST_LIMIT_USD) {
          console.error(
            `コスト上限 $${COST_LIMIT_USD} に到達（累計 $${totalCost.toFixed(2)}）。中断します。`,
          );
          return;
        }
        await sleep(2000); // レート制限への儀礼的ウェイト
      }
    }
  }
  console.log(`完了。累計コスト概算 $${totalCost.toFixed(4)}`);
}

await main();
