import { estimateCostUsd } from '../../../src/lib/llm/pricing';
import { GUARD_PRICING, REPORT_FALLBACK_PRICING } from './config';

export type CostBasis = 'measured' | 'estimated_input_tokens' | 'measured_failure' | 'estimated_output_limit' | 'estimated_input_only';
export function guardCostUsd(model: string, tokensIn: number, tokensOut: number): number {
  const price = GUARD_PRICING[model];
  if (!price) throw new Error(`監視単価がありません: ${model}`);
  return (tokensIn * price.inputPerMillion + tokensOut * price.outputPerMillion) / 1_000_000;
}
export function reportCostUsd(model: string, tokensIn: number, tokensOut: number, cachedTokensIn: number | null, timestampMs: number): number {
  const cost = estimateCostUsd(model, tokensIn, tokensOut, cachedTokensIn, REPORT_FALLBACK_PRICING[model], timestampMs);
  if (cost === null) throw new Error(`報告単価がありません: ${model}`);
  return cost;
}
export function failureUsage(error: unknown, promptCharacters: number) {
  const obj = typeof error === 'object' && error !== null ? error as Record<string, unknown> : {};
  const usage = typeof obj.usage === 'object' && obj.usage !== null ? obj.usage as Record<string, unknown> : {};
  const token = (n: unknown): n is number => typeof n === 'number' && Number.isFinite(n) && n >= 0;
  if (token(usage.tokensIn) && token(usage.tokensOut)) return { tokensIn: usage.tokensIn, tokensOut: usage.tokensOut,
    cachedTokensIn: token(usage.cachedTokensIn) ? usage.cachedTokensIn : null, costBasis: 'measured_failure' as CostBasis };
  return { tokensIn: Math.ceil(promptCharacters / 4), tokensOut: obj.failureKind === 'output_limit' ? 65536 : 0,
    cachedTokensIn: null, costBasis: (obj.failureKind === 'output_limit' ? 'estimated_output_limit' : 'estimated_input_only') as CostBasis };
}
export function costLimits(env: NodeJS.ProcessEnv = process.env) {
  const limit = Number(env.BENCH_COST_LIMIT_USD);
  if (!Number.isFinite(limit) || limit <= 0) throw new Error('BENCH_COST_LIMIT_USD に正の数値を指定してください');
  const pause = env.BENCH_COST_PAUSE_USD === undefined ? limit * 0.875 : Number(env.BENCH_COST_PAUSE_USD);
  if (!Number.isFinite(pause) || pause <= 0 || pause > limit) throw new Error('BENCH_COST_PAUSE_USD は正かつ上限以下にしてください');
  return { limit, pause };
}
export function otherSpend(env: NodeJS.ProcessEnv = process.env): number {
  const raw = env.BENCH_OTHER_SPEND_USD;
  const value = raw === undefined ? 0 : Number(raw);
  if (raw?.trim() === '' || !Number.isFinite(value) || value < 0) throw new Error('BENCH_OTHER_SPEND_USD は 0 以上の数値にしてください');
  return value;
}
// extraction-benchmark-real/src/costGuard.ts の redactSecret を移植。
export function redactSecret(text: string, secret: string): string {
  if (secret === '') return text;
  let result = text.split(secret).join('[REDACTED]');
  const encoded = encodeURIComponent(secret);
  if (encoded !== secret) {
    result = result.split(encoded).join('[REDACTED]');
  }
  return result;
}
export function safeError(error: unknown, secrets = Object.entries(process.env).filter(([name]) => /API_KEY|TOKEN|SECRET/.test(name)).map(([, value]) => value ?? '')): string {
  return secrets.reduce((message, secret) => redactSecret(message, secret), String(error)).slice(0, 500);
}
