// 費用の見張り。課金対象の出力は usageMetadata の candidates + thoughts から求める。
// 本番 GeminiProvider の tokensOut は途中から思考込みになったため、費用計算には使わない。
// 古い run は採点時に、古いレジャは対応する run のトークン値が一致する場合だけ数え直す。
import { appendFile, readFile } from 'node:fs/promises';
import path from 'node:path';
import { estimateCostUsd, MODEL_PRICING, type ModelPricing } from '../../../src/lib/llm/pricing';
import { FALLBACK_PRICING } from './config';

export type CostBasis = 'measured' | 'measured_failure' | 'estimated_output_limit' | 'unknown';

export type CostSource = 'production_pricing' | 'bench_fallback';

export interface BilledCostInput {
  model: string;
  tokensIn: number | null;
  rawResponse: unknown;
  cachedTokensIn: number | null;
}

export interface BilledCostResult {
  billedTokensOut: number | null;
  costUsd: number | null;
  costSource: CostSource;
}

/**
 * 課金対象の出力込みで概算コストを計算する。
 * - 課金対象の出力 = usageMetadata.candidatesTokenCount + thoughtsTokenCount（欠けた側は 0）
 * - usageMetadata が無ければ costUsd は null（tokensOut から推定しない）
 * - どちらの単価表が使われたかは「単価表にキーがあるか」で判定する（本番の estimateCostUsd の
 *   null は「モデル不明」と「トークン不明」の 2 つの意味を持つため、null で分岐しない）
 */
export function billedCostUsd(
  input: BilledCostInput,
  pricing = { production: MODEL_PRICING, fallback: FALLBACK_PRICING, estimate: estimateCostUsd },
): BilledCostResult {
  const { model, tokensIn, rawResponse, cachedTokensIn } = input;
  const usage = extractUsageMetadata(rawResponse);
  const billedTokensOut = usage === null ? null :
    (finiteTokenCount(usage['candidatesTokenCount']) ?? 0) +
    (finiteTokenCount(usage['thoughtsTokenCount']) ?? 0);
  const hasProductionPricing = pricing.production[model] !== undefined;
  const costSource: CostSource = hasProductionPricing ? 'production_pricing' : 'bench_fallback';

  if (billedTokensOut === null) {
    return { costUsd: null, costSource, billedTokensOut };
  }

  if (hasProductionPricing) {
    return {
      costUsd: pricing.estimate(model, tokensIn, billedTokensOut, cachedTokensIn),
      costSource,
      billedTokensOut,
    };
  }

  const fallback: ModelPricing | undefined = pricing.fallback[model];
  if (fallback === undefined) {
    return { costUsd: null, costSource, billedTokensOut };
  }
  // fallback 単価表にはキャッシュ単価が無い前提のため、キャッシュ割引は見込まず入力単価で積む
  const totalIn = tokensIn ?? 0;
  const inputCost = (totalIn / 1_000_000) * fallback.inputPerMillion;
  const outputCost = (billedTokensOut / 1_000_000) * fallback.outputPerMillion;
  return { costUsd: inputCost + outputCost, costSource, billedTokensOut };
}

/** 失敗の使用量を優先し、出力上限だけは費用の見落としを防ぐ上側の見積もりを返す。
 * LLMProvider.LlmUsage と GeminiProvider.parseUsage の tokensOut は本文 + 思考。
 * thoughtsTokensOut は内数なので加算しない。tsx の同一性に依存しないようプロパティで読む。
 * 使用量を読める失敗は実測、読めない出力上限は見積もり、その他は不明とする。
 */
export function failedCostUsd(
  model: string, error: unknown, promptCharacters: number, maxOutputTokens: number,
): BilledCostResult & { costBasis: CostBasis } {
  const obj = typeof error === 'object' && error !== null ? error as Record<string, unknown> : {};
  const usage = typeof obj.usage === 'object' && obj.usage !== null
    ? obj.usage as Record<string, unknown> : {};
  const token = (value: unknown): number | null => {
    const count = finiteTokenCount(value);
    return count !== null && count >= 0 ? count : null;
  };
  let tokensIn = token(usage.tokensIn);
  let tokensOut = token(usage.tokensOut);
  let cachedTokensIn = token(usage.cachedTokensIn);
  let costBasis: CostBasis = 'unknown';
  if (tokensIn !== null && tokensOut !== null) {
    costBasis = 'measured_failure';
  } else if (obj.failureKind === 'output_limit') {
    costBasis = 'estimated_output_limit';
    tokensIn = Math.ceil(promptCharacters / 4);
    tokensOut = maxOutputTokens;
    cachedTokensIn = null;
  } else {
    tokensOut = null;
  }
  return { ...billedCostUsd({ model, tokensIn, cachedTokensIn,
    rawResponse: tokensOut === null ? null : { usageMetadata: { candidatesTokenCount: tokensOut } },
  }), costBasis };
}

/**
 * 本番の単価表・ベンチの補助単価表のどちらにも無いモデルがあれば throw する。
 * runner は API を 1 回も呼ぶ前にこれを通す。
 */
export function assertPricingAvailable(modelIds: readonly string[]): void {
  const missing = modelIds.filter(
    (id) => MODEL_PRICING[id] === undefined && FALLBACK_PRICING[id] === undefined,
  );
  if (missing.length > 0) {
    throw new Error(
      `単価表に無いモデルがあります（本番 MODEL_PRICING にも FALLBACK_PRICING にも無い）: ${missing.join(', ')}`,
    );
  }
}

/** raw レスポンスの使用量。存在しなければ費用不明として扱う。 */
export function extractUsageMetadata(raw: unknown): Record<string, unknown> | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const usage = (raw as Record<string, unknown>)['usageMetadata'];
  return typeof usage === 'object' && usage !== null && !Array.isArray(usage)
    ? usage as Record<string, unknown> : null;
}

function finiteTokenCount(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

/** raw レスポンスから usageMetadata.thoughtsTokenCount を取り出す（無ければ null）。 */
export function extractThoughtsTokens(raw: unknown): number | null {
  return finiteTokenCount(extractUsageMetadata(raw)?.['thoughtsTokenCount']);
}

/** 保存済み run の費用計算に必要な部分。 */
export interface RecordedCostRun {
  runId: string;
  model: string;
  tokensIn: number | null;
  tokensOut: number | null;
  thoughtsTokens?: number | null;
  cachedTokensIn?: number | null;
  rawResponse?: unknown;
  costUsd: number | null;
  costBasis?: CostBasis;
}

/** 採点時の費用。使用量が無い過去の記録だけ記録値を維持する。 */
export function recalculateRunCost(run: RecordedCostRun): { costUsd: number | null; usedRecordedCost: boolean } {
  if (run.costBasis === 'measured_failure' || run.costBasis === 'estimated_output_limit' ||
      extractUsageMetadata(run.rawResponse) === null) {
    return { costUsd: run.costUsd, usedRecordedCost: true };
  }
  return {
    costUsd: billedCostUsd({ ...run, rawResponse: run.rawResponse, cachedTokensIn: run.cachedTokensIn ?? null }).costUsd,
    usedRecordedCost: false,
  };
}

/** 費用レジャの 1 行（1 試行につき 1 行。成功・format error・transport error のどれでも書く）。 */
export interface LedgerEntry {
  runId: string;
  attemptAt: string;
  model: string;
  pdfId: string;
  repeat: number;
  outcome: 'ok' | 'format_error' | 'transport_error';
  tokensIn: number | null;
  tokensOut: number | null;
  thoughtsTokens: number | null;
  cachedTokensIn: number | null;
  costUsd: number | null;
  costSource: CostSource;
  costBasis?: CostBasis;
  /** 新形式の印。応答が無い試行は null。 */
  billedTokensOut?: number | null;
  elapsedMs: number;
}

/** 1 試行ぶんをレジャへ即時追記する（最後に一括書き込みしない）。 */
export async function appendLedger(path: string, entry: LedgerEntry): Promise<void> {
  await appendFile(path, `${JSON.stringify(entry)}\n`, 'utf8');
}

/**
 * レジャの全行を読む。ファイルが無ければ空配列。壊れた行があれば throw する
 * （費用上限の判定がこのファイルに依存するため、黙って飛ばさない）。
 */
export async function readLedger(path: string): Promise<LedgerEntry[]> {
  let raw: string;
  try {
    raw = await readFile(path, 'utf8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [];
    throw error;
  }
  const lines = raw.split('\n').filter((line) => line.trim() !== '');
  return lines.map((line, index) => {
    try {
      const entry = JSON.parse(line) as LedgerEntry;
      return { ...entry, costBasis: entry.costBasis ?? (entry.costUsd === null ? 'unknown' : 'measured') };
    } catch (error) {
      throw new Error(
        `費用レジャの行 ${index + 1} がパースできません: ${path}\n${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  });
}

/** レジャ全体の累計コスト（null は 0 として扱う）。 */
export function totalCostUsd(entries: readonly LedgerEntry[]): number {
  return entries.reduce((sum, entry) => sum + (entry.costUsd ?? 0), 0);
}

export interface LedgerRecalculation {
  recalculatedCount: number;
  recordedCount: number;
  recordedTotalUsd: number;
  totalUsd: number;
}

/** 古い試行と保存済み run が対応するときだけ再計算する（入力を変更しない）。 */
export function recalculateLedger(
  entries: readonly LedgerEntry[],
  runs: ReadonlyMap<string, RecordedCostRun>,
): LedgerRecalculation {
  let recalculatedCount = 0;
  let totalUsd = 0;
  for (const entry of entries) {
    const run = runs.get(entry.runId);
    if (entry.costBasis !== 'measured_failure' && entry.costBasis !== 'estimated_output_limit' &&
        !Object.hasOwn(entry, 'billedTokensOut') && run !== undefined &&
        run.runId === entry.runId && run.tokensOut === entry.tokensOut &&
        run.thoughtsTokens === entry.thoughtsTokens && extractUsageMetadata(run.rawResponse) !== null) {
      totalUsd += recalculateRunCost(run).costUsd ?? 0;
      recalculatedCount += 1;
    } else {
      totalUsd += entry.costUsd ?? 0;
    }
  }
  return { recalculatedCount, recordedCount: entries.length - recalculatedCount,
    recordedTotalUsd: totalCostUsd(entries), totalUsd };
}

/** レジャに対応する run を読む。欠落以外の読み込み・JSON エラーは黙って飛ばさない。 */
export async function readLedgerRuns(dir: string, entries: readonly LedgerEntry[]): Promise<Map<string, RecordedCostRun>> {
  const runs = new Map<string, RecordedCostRun>();
  for (const runId of new Set(entries.filter((entry) => !Object.hasOwn(entry, 'billedTokensOut')).map((entry) => entry.runId))) {
    let raw: string;
    try {
      raw = await readFile(path.join(dir, `${runId}.json`), 'utf8');
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') continue;
      throw error;
    }
    runs.set(runId, JSON.parse(raw) as RecordedCostRun);
  }
  return runs;
}

/** 起動時・再採点時に同じ内訳を 1 行で表示する。 */
export function ledgerCostSummary(result: LedgerRecalculation): string {
  return `費用レジャ: 再計算 ${result.recalculatedCount} 行 / 記録値維持 ${result.recordedCount} 行 / ` +
    `記録累計 $${result.recordedTotalUsd.toFixed(4)} / 再計算後 $${result.totalUsd.toFixed(4)}`;
}

/** 費用上限への到達判定。再開時は再計算後の累計を渡す。 */
export function isCostLimitReached(cumulativeCost: number, costLimitUsd: number): boolean {
  return cumulativeCost >= costLimitUsd;
}

/** 指定 runId の試行回数。 */
export function attemptCount(entries: readonly LedgerEntry[], runId: string): number {
  return entries.filter((entry) => entry.runId === runId).length;
}

/**
 * text 中の secret（生の文字列と URL エンコード形の両方）を [REDACTED] に置換する。
 * Gemini は API キーを URL のクエリ `?key=` で送るため、fetch 由来の例外メッセージに
 * URL ごとキーが載りうる（エンコード形での混入経路）。空文字の secret では何もしない。
 */
export function redactSecret(text: string, secret: string): string {
  if (secret === '') return text;
  let result = text.split(secret).join('[REDACTED]');
  const encoded = encodeURIComponent(secret);
  if (encoded !== secret) {
    result = result.split(encoded).join('[REDACTED]');
  }
  return result;
}
