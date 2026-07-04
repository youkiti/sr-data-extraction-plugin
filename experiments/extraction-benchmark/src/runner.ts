// LLM 実行 → outputs/runs/（IMPLEMENTATION.md §8）。
// プロンプト構築・応答検証・quote アンカリング・LLM 呼び出しは本番 src/ をそのまま import する
// （README.md §8.1「プロンプト二重管理を避ける」）。ここで書くのは
// 実行ループ・リトライ・コスト上限監視・run JSON の保存だけ
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
} from '../../../src/features/extraction/skills/extractData.js';
import {
  AiOutputFormatError,
  type RejectedAiItem,
  type ValidatedAiItem,
} from '../../../src/features/extraction/validateAiOutput.js';
import { anchorQuote } from '../../../src/features/anchoring/anchorQuote.js';
import { normalizeText } from '../../../src/features/anchoring/normalizeText.js';
import type { AnchorResult, NormalizedPage } from '../../../src/domain/anchor.js';
import {
  type ChatMessage,
  type ChatOptions,
  type ChatResponse,
  type LLMProvider,
  LlmProviderError,
} from '../../../src/lib/llm/LLMProvider.js';
import { estimateCostUsd } from '../../../src/lib/llm/pricing.js';
import { createProvider } from '../../../src/lib/llm/providerFactory.js';
import { benchRoot, MODELS, REPEATS, TARGETS } from './config.js';
import { loadBenchmarkSchema } from './loadSchema.js';

dotenv.config({ path: path.join(benchRoot, '.env'), quiet: true });

/** コスト上限（README.md §7 / §9 承認チェックリスト #6。超えそうになったら中断して報告） */
const COST_LIMIT_USD = 5;

/** 429 / 5xx のリトライ待機時間（README.md §8.4-4 / IMPLEMENTATION.md §8 の「最大3回・指数バックオフ」） */
const RETRY_BACKOFFS_MS = [2000, 4000, 8000];

/** run JSON に保存する 1 項目。本番 ValidatedAiItem に quote アンカリング結果を付加する */
interface AnchoredItem extends ValidatedAiItem {
  anchor: AnchorResult | null;
}

/** outputs/runs/{runId}.json の保存形状 */
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
  rejected: RejectedAiItem[];
  items: AnchoredItem[];
  rawResponse: unknown;
  /** 全リトライ失敗時のみ設定（LlmProviderError 等）。items は空で保存する */
  error?: string;
  /** AiOutputFormatError（JSON パース不能）時のみ設定。items は空で保存する */
  formatError?: string;
}

async function loadPages(pdfId: string): Promise<ExtractDataPage[]> {
  const raw = await readFile(path.join(benchRoot, 'outputs', 'textlayer', `${pdfId}.json`), 'utf8');
  return (JSON.parse(raw) as { pages: ExtractDataPage[] }).pages;
}

// 正規化済みページを 1 回だけ作って quote アンカリングで使い回す
function toNormalizedPages(pages: ExtractDataPage[]): NormalizedPage[] {
  return pages.map((p) => ({ page: p.page, text: normalizeText(p.text) }));
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isRetryableError(error: unknown): error is LlmProviderError {
  return (
    error instanceof LlmProviderError &&
    error.status !== null &&
    (error.status === 429 || error.status >= 500)
  );
}

/**
 * provider.chat を 429 / 5xx で最大 3 回まで指数バックオフ（2s, 4s, 8s）で再試行する。
 * プロバイダはリトライを内蔵していない（GeminiProvider / OpenRouterProvider は非 2xx で
 * LlmProviderError を throw するだけ）ため、ここで面倒を見る。それ以外のエラー・
 * 再試行上限到達時は握りつぶさず呼び出し元へ再 throw する（作業原則6）
 */
async function chatWithRetry(
  provider: LLMProvider,
  messages: readonly ChatMessage[],
  options: ChatOptions,
  runId: string,
): Promise<ChatResponse> {
  for (let attempt = 0; ; attempt++) {
    try {
      return await provider.chat(messages, options);
    } catch (error) {
      const remainingRetries = attempt < RETRY_BACKOFFS_MS.length;
      if (!isRetryableError(error) || !remainingRetries) {
        throw error;
      }
      const waitMs = RETRY_BACKOFFS_MS[attempt] as number;
      console.error(
        `${runId}: LLM呼び出し失敗（status=${error.status}）。${waitMs}ms 待って再試行します（${attempt + 1}/${RETRY_BACKOFFS_MS.length}）`,
      );
      await sleep(waitMs);
    }
  }
}

async function main(): Promise<void> {
  const fields = await loadBenchmarkSchema();
  const outDir = path.join(benchRoot, 'outputs', 'runs');
  await mkdir(outDir, { recursive: true });

  let cumulativeCostUsd = 0;

  for (const model of MODELS) {
    const apiKey = process.env[model.keyEnv];
    if (!apiKey) {
      throw new Error(
        `${model.keyEnv} が .env にありません（model=${model.id}）。.env.example を参考に ` +
          `experiments/extraction-benchmark/.env を作成してください`,
      );
    }
    const provider = createProvider({ apiKey, model: model.id });

    for (const target of TARGETS) {
      const pages = await loadPages(target.pdfId);
      const normPages = toNormalizedPages(pages);
      const userPrompt = buildExtractDataUserPrompt({ fields, pages });

      for (let r = 1; r <= REPEATS; r++) {
        const runId = `${model.id.replace(/\//g, '__')}__${target.pdfId}__r${r}`;
        const t0 = Date.now();
        let record: RunRecord;

        try {
          const res = await chatWithRetry(
            provider,
            [
              { role: 'system', content: EXTRACT_DATA_SYSTEM_PROMPT },
              { role: 'user', content: userPrompt },
            ],
            { temperature: 0, responseSchema: EXTRACT_DATA_RESPONSE_SCHEMA },
            runId,
          );
          const elapsedMs = Date.now() - t0;
          const costUsd = estimateCostUsd(model.id, res.tokensIn, res.tokensOut);

          try {
            const parsed = parseExtractDataResponse(res.text, fields); // { items, rejected }

            // 各 item の quote をアンカリング。quote なしは anchor 対象外
            // （指標(3) quote アンカリング成功率の分母から除外される。README.md §4.1）
            const anchored: AnchoredItem[] = parsed.items.map((item) => {
              const normQuote = item.quote ? normalizeText(item.quote) : '';
              const anchor = normQuote ? anchorQuote(normQuote, normPages, item.page) : null;
              return { ...item, anchor };
            });

            record = {
              runId,
              model: model.id,
              pdfId: target.pdfId,
              repeat: r,
              promptVersion: EXTRACT_DATA_PROMPT_VERSION,
              executedAt: new Date().toISOString(),
              elapsedMs,
              tokensIn: res.tokensIn,
              tokensOut: res.tokensOut,
              costUsd,
              rejected: parsed.rejected, // 破棄行（採点側で不正解として計上。README.md §4.0）
              items: anchored,
              rawResponse: res.raw, // 監査・再現用（CC BY 論文なので本文断片保存 OK）
            };
          } catch (parseError) {
            if (!(parseError instanceof AiOutputFormatError)) {
              throw parseError;
            }
            // JSON パース不能 = バッチ全体失敗。全 field 欠落 = 全行不正解として
            // 採点側で扱えるよう items は空で保存する（握りつぶさず formatError に記録）
            console.error(`${runId}: AI応答のJSONパースに失敗しました: ${parseError.message}`);
            record = {
              runId,
              model: model.id,
              pdfId: target.pdfId,
              repeat: r,
              promptVersion: EXTRACT_DATA_PROMPT_VERSION,
              executedAt: new Date().toISOString(),
              elapsedMs,
              tokensIn: res.tokensIn,
              tokensOut: res.tokensOut,
              costUsd,
              rejected: [],
              items: [],
              rawResponse: res.raw,
              formatError: parseError.message,
            };
          }
        } catch (error) {
          // リトライも尽きた LLM 呼び出し失敗。握りつぶさず error フラグ付きで保存して次の run へ進む
          const elapsedMs = Date.now() - t0;
          const message = error instanceof Error ? error.message : String(error);
          console.error(`${runId}: 全リトライ失敗。error フラグ付きで保存して次の run へ進みます: ${message}`);
          record = {
            runId,
            model: model.id,
            pdfId: target.pdfId,
            repeat: r,
            promptVersion: EXTRACT_DATA_PROMPT_VERSION,
            executedAt: new Date().toISOString(),
            elapsedMs,
            tokensIn: null,
            tokensOut: null,
            costUsd: null,
            rejected: [],
            items: [],
            rawResponse: null,
            error: message,
          };
        }

        await writeFile(path.join(outDir, `${runId}.json`), JSON.stringify(record, null, 1), 'utf8');
        console.log(
          `${runId}: items=${record.items.length} rejected=${record.rejected.length} ` +
            `${record.elapsedMs}ms cost=${record.costUsd ?? 'null'}`,
        );

        cumulativeCostUsd += record.costUsd ?? 0;
        if (cumulativeCostUsd >= COST_LIMIT_USD) {
          console.error(
            `累計コスト概算が上限 $${COST_LIMIT_USD} に到達しました（$${cumulativeCostUsd.toFixed(4)}）。` +
              `残りの run は実行せず中断します。作業原則6に従い状況を報告してください。`,
          );
          return;
        }

        await sleep(2000); // レート制限への儀礼的ウェイト
      }
    }
  }
  console.log(`全 run 完了。累計コスト概算: $${cumulativeCostUsd.toFixed(4)}`);
}

await main();
