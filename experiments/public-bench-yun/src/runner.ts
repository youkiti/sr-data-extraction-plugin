import { mkdir, rename } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { EXTRACT_DATA_PROMPT_VERSION, parseExtractDataResponse } from '../../../src/features/extraction/skills/extractData';
import type { RejectedAiItem } from '../../../src/features/extraction/validateAiOutput';
import { createProvider } from '../../../src/lib/llm/providerFactory';
import type { ChatResponse } from '../../../src/lib/llm/LLMProvider';
import { timeoutFetch, anchorItems, type RunRecord } from '../../cochrane-numeric-benchmark/src/runner';
import { codexPreflight, createCodexProvider, type CodexResponse } from '../../cochrane-numeric-benchmark/src/codexProvider';
import { classifyFailure, errorInfo, failureClass, retryDecision, RETRY_MAX_ATTEMPTS } from '../../cochrane-numeric-benchmark/src/retry';
import { costLimits, failureUsage, guardCostUsd, listCostUsd, reportCostUsd, safeError, type CostBasis } from '../../cochrane-numeric-benchmark/src/cost';
import { ledgerWriter, readLedger, budgetSpend, type LedgerEntry } from '../../cochrane-numeric-benchmark/src/ledger';
import { harnessCommit, readRunState, resumeDecision, runIdFor } from '../../cochrane-numeric-benchmark/src/resume';
import { writeJson } from '../../cochrane-numeric-benchmark/src/io';
import { MODELS, condition, runLabel, outputRoot, yunRoot, runsDir, selectedModels, codexEffort, codexConcurrency, codexTimeoutMs } from './config';
import { loadEvaluation, type Study, type Document } from './dataset';
import { buildStudyRequest, promptCharacters } from './prompt';
import { inputManifest } from './manifest';
export type { RunRecord, ScoringItem } from '../../cochrane-numeric-benchmark/src/runner';
type RunStudy = Study & { tier: string; reviewId: string };

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));
export function interruptedRecord(study: RunStudy, last: LedgerEntry): RunRecord {
  return { ...last, tier: study.tier, reviewId: study.reviewId, promptVersion: EXTRACT_DATA_PROMPT_VERSION,
    executedAt: last.attemptAt, attempts: last.attempt, thoughtsTokens: null, sentSettings: null, responseModel: null,
    listCostUsd: listCostUsd(last.model, last.tokensIn, last.tokensOut), attemptsGuardCostUsd: 0,
    reportCostUsd: reportCostUsd(last.model, last.tokensIn, last.tokensOut, last.cachedTokensIn, Date.parse(last.attemptAt)),
    outcome: 'request_failed', error: '再試行の上限に達した後に中断されていました', items: [], rejected: [], rawText: null };
}

export async function main(): Promise<void> {
  let executed = 0, skipped = 0, failed = 0, cumulative = 0;
  try {
    console.log(`harness commit: ${await harnessCommit()}, prompt version: ${EXTRACT_DATA_PROMPT_VERSION}`);
    const dry = process.env.BENCH_DRY_RUN === '1';
    const models = selectedModels();
    const usesCodex = models.some((model) => !('keyEnv' in model));
    const effort = usesCodex ? codexEffort() : null;
    const concurrency = usesCodex ? codexConcurrency() : 1;
    const timeoutMs = usesCodex ? codexTimeoutMs() : undefined;
    const root = yunRoot();
    const inputCondition = condition();
    const label = runLabel();
    const out = outputRoot();
    console.log(`条件: ${inputCondition}, ラベル: ${label}, モデル: ${models.map((m) => m.id).join(', ')}`);
    for (const model of MODELS) if ('keyEnv' in model) console.log(`${model.keyEnv}: ${process.env[model.keyEnv]?.trim() ? '設定あり' : '未設定'}`);
    const limits = dry ? null : costLimits();
    for (const model of models) guardCostUsd(model.id, 0, 0);
    const set = await loadEvaluation(root, out, inputCondition);
    const dir = runsDir();
    const ledgerFile = path.join(dir, '_ledger.jsonl');
    const ledger = await readLedger(ledgerFile);
    const spend = await budgetSpend(out, 0);
    cumulative = spend.total;
    for (const [label, cost] of Object.entries(spend.labels)) console.log(`guard cost / ${label}: $${cost.toFixed(6)}`);
    console.log(`guard cost / other: $${spend.other.toFixed(6)}, total: $${spend.total.toFixed(6)}`);
    const plans: { model: typeof models[number]; study: RunStudy; docs: Document[]; runId: string;
      file: string; action: ReturnType<typeof resumeDecision>; request: ReturnType<typeof buildStudyRequest> }[] = [];
    for (const model of models) for (const source of set.studies) {
      const study: RunStudy = { ...source, tier: inputCondition, reviewId: 'yun2024' };
      const runId = runIdFor(model.id, study.studyKey);
      const file = path.join(dir, `${runId}.json`);
      const action = resumeDecision(await readRunState(file), ledger.filter((line) => line.runId === runId), EXTRACT_DATA_PROMPT_VERSION);
      const docs = set.documents.get(study.studyKey)!;
      plans.push({ model, study, docs, runId, file, action, request: buildStudyRequest(study, docs) });
    }
    await inputManifest(set, plans, inputCondition, dir, dry, effort);
    skipped = plans.filter((plan) => plan.action.kind === 'skip').length;
    console.log(`planned: ${plans.length - skipped}, skip: ${skipped}`);
    if (dry) {
      const userChars = plans.reduce((sum, plan) => sum + promptCharacters(plan.request.messages.slice(1)), 0);
      console.log(`planned: ${plans.length - skipped}, skip: ${skipped}, items: ${plans.reduce((n, p) => n + p.study.icos.length, 0)}, documents: ${plans.reduce((n, p) => n + p.docs.length, 0)}, user-prompt characters: ${userChars}`);
      return;
    }
    // 依頼が残る全キーを呼び出し前に検査し、途中で別モデルだけが進むことを防ぐ。
    const activeModels = models.filter((model) => plans.some((plan) => plan.model.id === model.id &&
      (plan.action.kind === 'execute' || plan.action.kind === 'backup_execute')));
    const codex = activeModels.some((model) => !('keyEnv' in model)) ? await codexPreflight() : null;
    for (const plan of plans) if (plan.action.kind === 'finalise') {
      await writeJson(plan.file, interruptedRecord(plan.study, plan.action.last));
      executed++; failed++;
    }
    for (const model of activeModels) if ('keyEnv' in model && !process.env[model.keyEnv]?.trim()) throw new Error(`${model.keyEnv} がありません`);
    await mkdir(dir, { recursive: true });
    const append = ledgerWriter(ledgerFile);
    let stopped = false;
    const workers = [...new Set(activeModels.flatMap((model) => 'keyEnv' in model ? [model.keyEnv] : [])),
      ...Array.from({ length: activeModels.some((model) => !('keyEnv' in model)) ? concurrency : 0 }, () => 'codex')];
    const codexPlans = plans.filter((entry) => !('keyEnv' in entry.model) && entry.action.kind !== 'skip');
    function* takeCodexPlans() { while (codexPlans.length) yield codexPlans.shift()!; }
    const worker = async (keyEnv: string) => {
      let lastFinished = 0;
      const queue = keyEnv === 'codex' ? takeCodexPlans() : plans.filter((entry) => 'keyEnv' in entry.model && entry.model.keyEnv === keyEnv && entry.action.kind !== 'skip');
      for (const plan of queue) {
        if (stopped) return;
        if (plan.action.kind === 'skip' || plan.action.kind === 'finalise') continue;
        if (plan.action.kind === 'backup_execute') await rename(plan.file, path.join(dir, `_corrupt-${Date.now()}__${plan.runId}.json.bak`));
        const provider = 'keyEnv' in plan.model
          ? createProvider({ apiKey: process.env[keyEnv]!, model: plan.model.id, fetch: timeoutFetch })
          : createCodexProvider({ effort: effort!, codexVersion: codex!.codexVersion, timeoutMs });
        const chars = promptCharacters(plan.request.messages);
        let attemptsGuardCostUsd = 0;
        for (let attempt = plan.action.attempt; attempt <= RETRY_MAX_ATTEMPTS; attempt++) {
          await sleep(Math.max(0, lastFinished + 2000 - Date.now()));
          if (stopped) return;
          if (cumulative >= limits!.pause) {
            stopped = true; process.exitCode = 1;
            console.error(`費用の見張りで停止しました（累計 $${cumulative.toFixed(6)} / 停止 $${limits!.pause} / 上限 $${limits!.limit}）。本人に確認してから BENCH_COST_PAUSE_USD を上げて再開してください`);
            return;
          }
          const attemptAt = new Date().toISOString();
          const start = Date.now();
          let response: ChatResponse | CodexResponse | null = null, failure: unknown = null;
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
              items = anchorItems(parsed.items, plan.docs.map((doc) => ({ pmcid: plan.study.studyKey, pdf_path: doc.filename, pages: doc.pages }))); rejected = parsed.rejected;
            } catch (error) { outcome = 'format_error'; failure = error; }
          }
          const usage = response ? {
            tokensIn: response.tokensIn ?? Math.ceil(chars / 4), tokensOut: response.tokensOut ?? 0,
            cachedTokensIn: response.cachedTokensIn,
            costBasis: (response.tokensIn === null ? 'estimated_input_tokens' : 'measured') as CostBasis,
          } : failureUsage(failure, chars);
          const guard = guardCostUsd(plan.model.id, usage.tokensIn, usage.tokensOut);
          // run 保存より先に、全試行の費用を永続化する。
          cumulative += guard;
          attemptsGuardCostUsd += guard;
          await append({ runId: plan.runId, attempt, attemptAt, model: plan.model.id, studyKey: plan.study.studyKey,
            outcome, ...usage, guardCostUsd: guard, elapsedMs, httpStatus: response ? null : info.status,
            failureClass: response ? null : failureClass(info) });
          const decision = response ? { retry: false, waitMs: 0 } : retryDecision(kind, attempt, info.retryAfterMs);
          if (decision.retry) { await sleep(decision.waitMs); continue; }
          const record: RunRecord = { runId: plan.runId, model: plan.model.id, studyKey: plan.study.studyKey,
            tier: plan.study.tier, reviewId: plan.study.reviewId, promptVersion: EXTRACT_DATA_PROMPT_VERSION,
            executedAt: attemptAt, attempts: attempt, elapsedMs, ...usage,
            thoughtsTokens: response?.thoughtsTokensOut ?? null, sentSettings: response?.sentSettings ??
              (typeof failure === 'object' && failure !== null ? (failure as Record<string, unknown>).sentSettings ?? null : null),
            responseModel: response?.responseModel ?? null, guardCostUsd: guard,
            listCostUsd: listCostUsd(plan.model.id, usage.tokensIn, usage.tokensOut), attemptsGuardCostUsd,
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
