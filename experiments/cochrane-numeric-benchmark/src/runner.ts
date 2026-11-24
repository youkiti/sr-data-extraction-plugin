import { mkdir, rename } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import dotenv from 'dotenv';
import { EXTRACT_DATA_PROMPT_VERSION, parseExtractDataResponse } from '../../../src/features/extraction/skills/extractData';
import type { ValidatedAiItem, RejectedAiItem } from '../../../src/features/extraction/validateAiOutput';
import { createProvider } from '../../../src/lib/llm/providerFactory';
import type { ChatResponse } from '../../../src/lib/llm/LLMProvider';
import { normalizeText } from '../../../src/features/anchoring/normalizeText';
import { anchorQuote } from '../../../src/features/anchoring/anchorQuote';
import { anchorQuoteSegments } from '../../../src/features/anchoring/anchorQuoteSegments';
import { benchRoot, repoRoot, runsDir, selectedModels } from './config';
import { inputRoot, loadEvaluation, printCounts, writeJson } from './io';
import { buildStudyRequest, promptCharacters } from './prompt';
import { classifyFailure, errorInfo, retryDecision, RETRY_MAX_ATTEMPTS } from './retry';
import { costLimits, failureUsage, guardCostUsd, reportCostUsd, safeError, type CostBasis } from './cost';
import { ledgerWriter, readLedger } from './ledger';
import { harnessCommit, inputManifest, readRunState, resumeDecision, runIdFor } from './resume';
import type { Study, UsableDocument } from './evaluationSet';

export interface ScoringItem {
  fieldId: string; entityKey: string; value: string | null; notReported: boolean; quote: string | null; anchorStatus: string | null;
}
export interface RunRecord {
  runId: string; model: string; studyKey: string; tier: string; reviewId: string; promptVersion: number;
  executedAt: string; attempts: number; elapsedMs: number; tokensIn: number; tokensOut: number; cachedTokensIn: number | null;
  thoughtsTokens: number | null; sentSettings: unknown; responseModel: string | null;
  // 費用欄は最後の試行のみ。採点は台帳の全試行を合算する。
  guardCostUsd: number; listCostUsd: number; reportCostUsd: number; costBasis: CostBasis;
  // 今回の run 実行内の合計（過去の中断分は含めない）。
  attemptsGuardCostUsd: number;
  outcome: 'ok' | 'format_error' | 'request_failed'; error: string | null;
  items: ScoringItem[]; rejected: RejectedAiItem[]; rawText: string | null;
}
// extraction-benchmark-real/src/runner.ts の timeoutFetch を移植。
export const timeoutFetch: typeof fetch = (input, init) => {
  const timeoutSignal = AbortSignal.timeout(600_000);
  const callerSignal = init?.signal;
  const signal = callerSignal != null ? AbortSignal.any([callerSignal, timeoutSignal]) : timeoutSignal;
  return fetch(input, { ...init, signal });
};
export function anchorItems(items: ValidatedAiItem[], docs: UsableDocument[]) {
  const normalized = docs.map((doc) => doc.pages.map((page) => ({ page: page.page, text: normalizeText(page.text) })));
  return items.map((item) => {
    const pages = normalized[item.documentIndex - 1] ?? [];
    let anchorStatus: string | null = item.quote === null ? null : anchorQuote(normalizeText(item.quote), pages, item.page).status;
    if (anchorStatus === 'failed' && item.quoteSeq === null && anchorQuoteSegments(item.quote!, pages, item.page) !== null) anchorStatus = 'segments';
    return { ...item, anchorStatus };
  });
}
const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

export async function main(): Promise<void> {
  let executed = 0, skipped = 0, failed = 0, cumulative = 0;
  try {
    console.log(`harness commit: ${await harnessCommit()}, prompt version: ${EXTRACT_DATA_PROMPT_VERSION}`);
    const dry = process.env.BENCH_DRY_RUN === '1';
    if (!dry) dotenv.config({ path: [path.join(benchRoot, '.env'), path.join(repoRoot, '.env')], quiet: true });
    const root = await inputRoot();
    const limits = dry ? null : costLimits();
    const models = selectedModels();
    for (const model of models) guardCostUsd(model.id, 0, 0);
    const set = await loadEvaluation(root);
    printCounts(set);
    const dir = runsDir();
    const ledgerFile = path.join(dir, '_ledger.jsonl');
    const ledger = await readLedger(ledgerFile);
    cumulative = ledger.reduce((sum, entry) => sum + entry.guardCostUsd, 0);
    const plans: { model: typeof models[number]; study: Study; docs: UsableDocument[]; runId: string;
      file: string; action: ReturnType<typeof resumeDecision>; request: ReturnType<typeof buildStudyRequest> }[] = [];
    for (const model of models) for (const study of set.studies) {
      const runId = runIdFor(model.id, study.studyKey);
      const file = path.join(dir, `${runId}.json`);
      const action = resumeDecision(await readRunState(file), ledger.filter((line) => line.runId === runId), EXTRACT_DATA_PROMPT_VERSION);
      const docs = set.documents.get(study.studyKey)!;
      plans.push({ model, study, docs, runId, file, action, request: buildStudyRequest(study, docs) });
    }
    await inputManifest(set, dry);
    skipped = plans.filter((plan) => plan.action === 'skip').length;
    if (dry) {
      const userChars = plans.reduce((sum, plan) => sum + promptCharacters(plan.request.messages.slice(1)), 0);
      console.log(`planned: ${plans.length - skipped}, skip: ${skipped}, items: ${plans.reduce((n, p) => n + p.study.items.length, 0)}, documents: ${plans.reduce((n, p) => n + p.docs.length, 0)}, user-prompt characters: ${userChars}`);
      return;
    }
    // 全キーの存在を呼び出し前に検査し、途中で別モデルだけが進むことを防ぐ。
    for (const model of models) if (!process.env[model.keyEnv]?.trim()) throw new Error(`${model.keyEnv} がありません`);
    await mkdir(dir, { recursive: true });
    const append = ledgerWriter(ledgerFile);
    let stopped = false;
    const workers = [...new Set(models.map((model) => model.keyEnv))];
    const worker = async (keyEnv: string) => {
      let lastFinished = 0;
      for (const plan of plans.filter((entry) => entry.model.keyEnv === keyEnv && entry.action !== 'skip')) {
        if (stopped) return;
        if (plan.action === 'backup_execute') await rename(plan.file, path.join(dir, `_corrupt-${Date.now()}__${plan.runId}.json.bak`));
        const provider = createProvider({ apiKey: process.env[keyEnv]!, model: plan.model.id, fetch: timeoutFetch });
        const chars = promptCharacters(plan.request.messages);
        let attemptsGuardCostUsd = 0;
        for (let attempt = 1; attempt <= RETRY_MAX_ATTEMPTS; attempt++) {
          await sleep(Math.max(0, lastFinished + 2000 - Date.now()));
          if (stopped) return;
          if (cumulative >= limits!.pause) {
            stopped = true; process.exitCode = 1;
            console.error(`費用の見張りで停止しました（累計 $${cumulative.toFixed(6)} / 停止 $${limits!.pause} / 上限 $${limits!.limit}）。本人に確認してから BENCH_COST_PAUSE_USD を上げて再開してください`);
            return;
          }
          const attemptAt = new Date().toISOString();
          const start = Date.now();
          let response: ChatResponse | null = null, failure: unknown = null;
          try { response = await provider.chat(plan.request.messages, plan.request.chatOptions); } catch (error) { failure = error; }
          const elapsedMs = Date.now() - start;
          lastFinished = Date.now();
          const info = errorInfo(failure);
          const kind = classifyFailure(info);
          if (failure !== null && (kind === 'spend_cap' || kind === 'auth')) {
            stopped = true; process.exitCode = 2; console.error(`${kind} により全体を中断しました`); return;
          }
          let outcome: RunRecord['outcome'] = response ? 'ok' : 'request_failed';
          let items: RunRecord['items'] = [], rejected: RejectedAiItem[] = [];
          if (response) {
            try {
              const parsed = parseExtractDataResponse(response.text, plan.request.fields, plan.request.documentCount);
              items = anchorItems(parsed.items, plan.docs); rejected = parsed.rejected;
            } catch (error) { outcome = 'format_error'; failure = error; }
          }
          const usage = response ? {
            tokensIn: response.tokensIn ?? Math.ceil(chars / 4), tokensOut: response.tokensOut ?? 0,
            cachedTokensIn: response.cachedTokensIn,
            costBasis: (response.tokensIn === null ? 'estimated_input_tokens' : 'measured') as CostBasis,
          } : failureUsage(failure, chars);
          const guard = guardCostUsd(plan.model.id, usage.tokensIn, usage.tokensOut);
          // extraction-benchmark-real/src/runner.ts と同じく、費用の永続化を run 保存より先にする。
          cumulative += guard;
          attemptsGuardCostUsd += guard;
          await append({ runId: plan.runId, attempt, attemptAt, model: plan.model.id, studyKey: plan.study.studyKey,
            outcome, ...usage, guardCostUsd: guard, elapsedMs });
          const decision = response ? { retry: false, waitMs: 0 } : retryDecision(kind, attempt, info.retryAfterMs);
          if (decision.retry) { await sleep(decision.waitMs); continue; }
          const record: RunRecord = { runId: plan.runId, model: plan.model.id, studyKey: plan.study.studyKey,
            tier: plan.study.tier, reviewId: plan.study.reviewId, promptVersion: EXTRACT_DATA_PROMPT_VERSION,
            executedAt: attemptAt, attempts: attempt, elapsedMs, ...usage,
            thoughtsTokens: response?.thoughtsTokensOut ?? null, sentSettings: response?.sentSettings ??
              (typeof failure === 'object' && failure !== null ? (failure as Record<string, unknown>).sentSettings ?? null : null),
            responseModel: response?.responseModel ?? null, guardCostUsd: guard, listCostUsd: guard, attemptsGuardCostUsd,
            reportCostUsd: reportCostUsd(plan.model.id, usage.tokensIn, usage.tokensOut, usage.cachedTokensIn, Date.parse(attemptAt)),
            outcome, error: failure === null ? null : safeError(failure), items, rejected, rawText: response?.text ?? null };
          await writeJson(plan.file, record);
          executed++; if (outcome !== 'ok') failed++;
          break;
        }
      }
    };
    const results = await Promise.allSettled(workers.map((keyEnv) => worker(keyEnv).catch((error) => {
      stopped = true;
      throw error;
    })));
    const rejectedWorker = results.find((result) => result.status === 'rejected');
    if (rejectedWorker?.status === 'rejected') throw rejectedWorker.reason;
  } finally {
    console.log(`executed: ${executed}, skipped: ${skipped}, failed: ${failed}, cumulative guard cost: $${cumulative.toFixed(6)}`);
  }
}

// テストからは I/O を起動しない。
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try { await main(); } catch (error) { console.error(safeError(error)); process.exitCode = 1; }
}
