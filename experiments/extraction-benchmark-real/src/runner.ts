// LLM 実行 → outputs/runs-{RUN_LABEL}/{runId}.json（プロンプト版数 9 の回し直し。旧 issue #176 版は
// src/score.ts 用に outputs/runs-issue176/ のまま残す）。
// 本番コード（プロンプト構築・応答検証・アンカリング・LLM 呼び出し・単価）をそのまま import。
// 1 run = (model, pdfId, repeat)。文書は常にテキストのみ（1 論文 1 コール）。
// ★API 課金が発生。実行前に .env と outputs/textlayer/*.json、BENCH_COST_LIMIT_USD が必要。
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
import dotenv from 'dotenv';
import {
  buildExtractDataUserContent,
  EXTRACT_DATA_PROMPT_VERSION,
  EXTRACT_DATA_RESPONSE_SCHEMA,
  EXTRACT_DATA_SYSTEM_PROMPT,
  parseExtractDataResponse,
  type ExtractDataPage,
} from '../../../src/features/extraction/skills/extractData';
import { AiOutputFormatError } from '../../../src/features/extraction/validateAiOutput';
import type { RejectedAiItem, ValidatedAiItem } from '../../../src/features/extraction/validateAiOutput';
import { createProvider } from '../../../src/lib/llm/providerFactory';
import {
  type ChatMessage,
  type ChatOptions,
  type ChatResponse,
  type LLMProvider,
} from '../../../src/lib/llm/LLMProvider';
import { normalizeText } from '../../../src/features/anchoring/normalizeText';
import { anchorQuote } from '../../../src/features/anchoring/anchorQuote';
import type { AnchorResult, NormalizedPage } from '../../../src/domain/anchor';
import { benchRoot, repoRoot, REPEATS, runsDir, selectedModels, selectedTargets, type BenchmarkInputMode } from './config';
import { checkRunSchemas } from './runSchema';
import { checkReaskFrom, loadReaskTargets, reaskFields, reaskFromName, type TargetCell } from './reask';
import { loadBenchmarkSchema, schemaFileName } from './loadSchema';
import {
  appendLedger,
  assertPricingAvailable,
  attemptCount,
  billedCostUsd,
  failedCostUsd,
  type CostBasis,
  extractThoughtsTokens,
  readLedger,
  redactSecret,
  recalculateLedger,
  readLedgerRuns,
  ledgerCostSummary,
  isCostLimitReached,
  type CostSource,
  type LedgerEntry,
} from './costGuard';
import { classifyFailure, errorInfo, fatalAbortExcerpt, retryDecision, RETRY_MAX_ATTEMPTS } from './retryPolicy';

// キーはリポジトリルートの .env（GEMINI_API_KEY / OPENROUTER_API_KEY）を読む。
// ベンチ直下に .env があればそちらを優先（dotenv は先勝ち・既存 env は上書きしない）。
if (process.env.BENCH_DRY_RUN !== '1') dotenv.config({ path: [path.join(benchRoot, '.env'), path.join(repoRoot, '.env')], quiet: true });

/** リクエスト単位のタイムアウト。本番プロバイダには無いためベンチ側で足す（タイムアウトは transport error として記録する） */
const REQUEST_TIMEOUT_MS = 600_000;
const MAX_OUTPUT_TOKENS = 32768;

/** 入力モードは常にテキストのみ（issue #176 のページ画像モードは本番から撤去済み・runner からも撤去） */
const INPUT_MODE: BenchmarkInputMode = 'text_only';

type AnchoredItem = ValidatedAiItem & { anchor: AnchorResult | null };

interface RunRecord {
  reaskFrom?: string;
  reaskFieldIds?: string[];
  reaskTargetCells?: TargetCell[];
  runId: string;
  model: string;
  inputMode: BenchmarkInputMode;
  pdfId: string;
  repeat: number;
  promptVersion: number;
  schemaFile: string;
  executedAt: string;
  elapsedMs: number;
  tokensIn: number | null;
  tokensOut: number | null;
  thoughtsTokens: number | null;
  cachedTokensIn: number | null;
  costUsd: number | null;
  costSource: CostSource;
  costBasis: CostBasis;
  error: string | null;
  /** transport error 時の応答本文の先頭 500 文字（redactSecret 済み）。無ければ null */
  errorBody: string | null;
  formatError: string | null;
  rejected: RejectedAiItem[];
  items: AnchoredItem[];
  rawResponse: unknown;
}

async function loadPages(pdfId: string): Promise<ExtractDataPage[]> {
  const raw = await readFile(path.join(benchRoot, 'outputs', 'textlayer', `${pdfId}.json`), 'utf8');
  return (JSON.parse(raw) as { pages: ExtractDataPage[] }).pages;
}
function toNormalizedPages(pages: ExtractDataPage[]): NormalizedPage[] {
  return pages.map((p) => ({ page: p.page, text: normalizeText(p.text) }));
}
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * リクエスト単位のタイムアウトを足した fetch。既存の init.signal があれば尊重しつつ
 * AbortSignal.timeout(600_000) を併せる（AbortSignal.any。Node 22 で標準対応）。
 */
const timeoutFetch: typeof fetch = (input, init) => {
  const timeoutSignal = AbortSignal.timeout(REQUEST_TIMEOUT_MS);
  const callerSignal = init?.signal;
  const signal = callerSignal != null ? AbortSignal.any([callerSignal, timeoutSignal]) : timeoutSignal;
  return fetch(input, { ...init, signal });
};

/**
 * 429 と 5xx だけ再試行する（分類は src/retryPolicy.ts。instanceof は使わない）。
 * spend_cap（Google プロジェクトの月間利用上限）・auth・other は再試行せず即 throw する。
 * 呼び出し側（main の実行ループ）が同じエラーを再分類して spend_cap/auth なら実行全体を中断する。
 */
async function chatWithRetry(
  provider: LLMProvider,
  messages: ChatMessage[],
  options: ChatOptions,
): Promise<ChatResponse> {
  let lastError: unknown;
  for (let attempt = 1; attempt <= RETRY_MAX_ATTEMPTS; attempt++) {
    try {
      return await provider.chat(messages, options);
    } catch (error) {
      lastError = error;
      const info = errorInfo(error);
      const kind = classifyFailure(info);
      const decision = retryDecision(kind, attempt, info.retryAfterMs);
      if (!decision.retry) throw error;
      console.warn(
        `  再試行 種別=${kind} 待機${Math.round(decision.waitMs / 1000)}秒（試行 ${attempt + 1}/${RETRY_MAX_ATTEMPTS}）`,
      );
      await sleep(decision.waitMs);
    }
  }
  throw lastError;
}

async function writeRun(outDir: string, record: RunRecord): Promise<void> {
  await writeFile(path.join(outDir, `${record.runId}.json`), JSON.stringify(record, null, 1), 'utf8');
}

function backupTimestamp(): string {
  // YYYYMMDDTHHMMSS（ミリ秒・Z は落とす）
  return new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, '');
}

type RunAction = 'skip_complete' | 'skip_retry_limit' | 'execute';

interface RunDecision {
  action: RunAction;
  /** 上書き前に退避が要る既存 run ファイルがあるか（壊れている場合を含む） */
  fileExists: boolean;
}

/**
 * 1 run（runId）ぶんの状態判定。起こりうる状態:
 * (1) run ファイル無し・レジャ無し → execute
 * (2) run ファイル成功（error/formatError とも null） → skip_complete
 * (3) run ファイル失敗・レジャの試行 1 回 → execute（退避してから再実行）
 * (4) run ファイル失敗・レジャの試行 2 回以上 → skip_retry_limit
 * (5) run ファイルが壊れていて読めない → 未実行として扱う（試行回数はレジャで数える。(3)/(4) と同じ分岐へ）
 * (6) run ファイル無しだがレジャに行がある（書き込み途中で落ちた） → 試行回数に数える。(3)/(4) と同じ分岐へ。
 *     この状態は「レジャへの追記 → run JSON の書き込み」の順（費用上限が規則で run 記録はその例外側）
 *     で発生しうる状態そのもの: 2 つの書き込みの間で落ちれば必ずここに落ちる設計にしてある
 */
async function decideRunAction(
  runPath: string,
  ledgerEntries: readonly LedgerEntry[],
  runId: string,
): Promise<RunDecision> {
  let existingRaw: string | null = null;
  try {
    existingRaw = await readFile(runPath, 'utf8');
  } catch {
    existingRaw = null; // state (1) / (6)
  }
  if (existingRaw !== null) {
    try {
      const existing = JSON.parse(existingRaw) as RunRecord;
      if (existing.error === null && existing.formatError === null) {
        return { action: 'skip_complete', fileExists: true }; // state (2)
      }
    } catch {
      // state (5): 壊れていて読めない → 未実行として扱い、下の試行回数判定へ続く
    }
  }
  const attempts = attemptCount(ledgerEntries, runId);
  if (attempts >= 2) {
    return { action: 'skip_retry_limit', fileExists: existingRaw !== null }; // state (4) / (6) with attempts>=2
  }
  return { action: 'execute', fileExists: existingRaw !== null }; // state (1) / (3) / (5) / (6) with attempts<2
}

function readCostLimitUsd(): number {
  const raw = process.env.BENCH_COST_LIMIT_USD?.trim();
  const value = raw === undefined || raw === '' ? NaN : Number(raw);
  if (!Number.isFinite(value) || value <= 0) {
    console.error(
      'BENCH_COST_LIMIT_USD が未設定か不正です（正の数値を指定してください）。API を呼ぶ前に中断します。',
    );
    process.exit(1);
  }
  return value;
}

async function main(): Promise<void> {
  // 費用上限は環境変数が必須。既定値は持たせない（実行のたびに人が決める）
  const costLimitUsd = readCostLimitUsd();
  const dryRun = process.env.BENCH_DRY_RUN === '1';

  const models = selectedModels();
  const targets = selectedTargets();

  // API を 1 回も呼ぶ前に、選択中の全モデルの単価が分かっているか確認する
  try {
    assertPricingAvailable(models.map((m) => m.id));
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  }

  const reaskFrom = reaskFromName();
  const outDir = runsDir();
  await checkReaskFrom(outDir, reaskFrom);
  await checkRunSchemas(outDir, schemaFileName());
  const ledgerPath = path.join(outDir, '_cost-ledger.jsonl');
  // 起動時にレジャを読み、累計をそこから始める（再開しても総額で上限が効く）
  const ledgerEntries: LedgerEntry[] = await readLedger(ledgerPath);
  const ledgerCosts = recalculateLedger(ledgerEntries, await readLedgerRuns(outDir, ledgerEntries));
  console.log(ledgerCostSummary(ledgerCosts));
  let cumulativeCost = ledgerCosts.totalUsd;

  interface PlannedRun {
    model: (typeof models)[number];
    target: (typeof targets)[number];
    repeat: number;
    runId: string;
    runPath: string;
  }
  const planned: PlannedRun[] = [];
  for (const model of models) {
    for (const target of targets) {
      for (let r = 1; r <= REPEATS; r++) {
        const runId = `${model.id.replace(/\//g, '__')}__${INPUT_MODE}__${target.pdfId}__r${r}`;
        planned.push({ model, target, repeat: r, runId, runPath: path.join(outDir, `${runId}.json`) });
      }
    }
  }

  // 初回の全件検査は、予行でも本実行でも API 呼び出しより先に済ませる。
  const reaskSchema = reaskFrom === undefined ? undefined : await loadBenchmarkSchema();
  const targetsByRun = reaskFrom === undefined ? undefined :
    await loadReaskTargets(path.join(benchRoot, 'outputs', reaskFrom), planned);
  if (targetsByRun !== undefined && reaskSchema !== undefined) {
    for (const p of planned) {
      const cells = targetsByRun.get(p.runId)!;
      console.log(`${p.target.pdfId}: 対象セル数 ${cells.length} / 渡す項目数 ${reaskFields(cells, reaskSchema).length}`);
      if (!cells.length) console.log(`${p.runId}: 対象セルなしのためスキップ`);
    }
  }

  if (dryRun) {
    console.log(`=== BENCH_DRY_RUN=1: API を呼ばず判定のみ表示（対象 ${planned.length} 件） ===`);
    console.log('単価の事前確認:');
    for (const model of models) {
      const source = billedCostUsd({
        model: model.id,
        tokensIn: 0,
        rawResponse: { usageMetadata: { candidatesTokenCount: 0 } },
        cachedTokensIn: null,
      }).costSource;
      console.log(`  ${model.id}: ${source}`);
    }
    console.log(`費用上限: $${costLimitUsd} / レジャ累計: $${cumulativeCost.toFixed(4)}`);

    let executeCount = 0;
    let skipCompleteCount = 0;
    let skipRetryLimitCount = 0;
    let skipNoTargetsCount = 0;
    for (const p of planned) {
      if (targetsByRun?.get(p.runId)?.length === 0) { skipNoTargetsCount += 1; continue; }
      const decision = await decideRunAction(p.runPath, ledgerEntries, p.runId);
      if (decision.action === 'execute') executeCount += 1;
      else if (decision.action === 'skip_complete') skipCompleteCount += 1;
      else skipRetryLimitCount += 1;
    }
    console.log(
      `実行予定 ${executeCount} / 完了済みスキップ ${skipCompleteCount} / 再試行上限スキップ ${skipRetryLimitCount}` +
        (reaskFrom === undefined ? '' : ` / 対象なしスキップ ${skipNoTargetsCount}`) +
        `（合計 ${planned.length} = ${models.length} モデル × ${targets.length} 論文 × ${REPEATS} 反復）`,
    );
    console.log('BENCH_DRY_RUN=1 のため run ファイル・レジャは書きません。');
    return;
  }

  await mkdir(outDir, { recursive: true });
  const fields = reaskSchema ?? await loadBenchmarkSchema();
  const contentByPdfId = new Map<
    string,
    { userContent: ReturnType<typeof buildExtractDataUserContent>; normPages: NormalizedPage[] }
  >();
  async function getContent(pdfId: string, file: string, runFields: typeof fields) {
    const cacheKey = reaskFrom === undefined ? pdfId : JSON.stringify([pdfId, runFields.map((field) => field.fieldId)]);
    const cached = contentByPdfId.get(cacheKey);
    if (cached !== undefined) return cached;
    const pages = await loadPages(pdfId);
    const normPages = toNormalizedPages(pages);
    const userContent = buildExtractDataUserContent({
      fields: runFields,
      documents: [{ role: 'article', filename: file, mode: 'text', pages }],
    });
    const entry = { userContent, normPages };
    contentByPdfId.set(cacheKey, entry);
    return entry;
  }

  const providerByModelId = new Map<string, LLMProvider>();
  function getProvider(model: (typeof models)[number]): LLMProvider {
    const cached = providerByModelId.get(model.id);
    if (cached !== undefined) return cached;
    const apiKey = process.env[model.keyEnv];
    if (apiKey === undefined || apiKey === '') {
      throw new Error(`${model.keyEnv} が .env にありません（model=${model.id}）`);
    }
    const provider = createProvider({ apiKey, model: model.id, fetch: timeoutFetch });
    providerByModelId.set(model.id, provider);
    return provider;
  }

  let executedCount = 0;
  let skippedCount = 0;
  let failedCount = 0;
  let retryLimitCount = 0;
  // 中断時の exitCode。費用上限で中断 = 1、利用上限／認証で中断 = 2（規則の優先順位: 費用上限・
  // キー非表示が先、その次に「モデルと無関係な理由で試行回数を消費しない」、再試行はその下）
  let exitCode: number | null = null;
  let plannedIndex = -1;

  outer: for (const p of planned) {
    plannedIndex += 1;
    const cells = targetsByRun?.get(p.runId);
    if (cells?.length === 0) { skippedCount += 1; continue; }
    const runFields = cells === undefined ? fields : reaskFields(cells, fields);
    const decision = await decideRunAction(p.runPath, ledgerEntries, p.runId);
    if (decision.action === 'skip_complete') {
      console.log(`${p.runId}: 完了済みのためスキップ`);
      skippedCount += 1;
      continue;
    }
    if (decision.action === 'skip_retry_limit') {
      console.log(`${p.runId}: 再試行上限（試行 2 回以上）のためスキップ`);
      retryLimitCount += 1;
      continue;
    }

    // 各 API コールの直前に累計費用を確認する（1 コール分・最大で約 $0.4 の超過はありうる）
    if (isCostLimitReached(cumulativeCost, costLimitUsd)) {
      console.error(`費用上限で中断（累計 $${cumulativeCost.toFixed(4)} が上限 $${costLimitUsd} 以上）。`);
      exitCode = 1;
      break outer;
    }

    if (decision.fileExists) {
      const backupName = `_failed-${backupTimestamp()}__${p.runId}.json.bak`;
      await rename(p.runPath, path.join(outDir, backupName));
      console.log(`${p.runId}: 既存の失敗記録を ${backupName} へ退避`);
    }

    const provider = getProvider(p.model);
    const { userContent, normPages } = await getContent(p.target.pdfId, p.target.file, runFields);

    const t0 = Date.now();
    let res: ChatResponse | null = null;
    let failure: unknown = null;
    let transportError: string | null = null;
    let errorBody: string | null = null;
    try {
      res = await chatWithRetry(
        provider,
        [
          { role: 'system', content: EXTRACT_DATA_SYSTEM_PROMPT },
          { role: 'user', content: userContent },
        ],
        // maxOutputTokens: 68 項目 ×（最大 6 arm）で応答が数万トークンになりうる。
        // プロバイダ既定では低すぎて JSON 途中切れ（FORMAT_ERROR）が頻発するため明示的に上げる。
        { temperature: 0, maxOutputTokens: MAX_OUTPUT_TOKENS, responseSchema: EXTRACT_DATA_RESPONSE_SCHEMA },
      );
    } catch (error) {
      const info = errorInfo(error);
      const kind = classifyFailure(info);
      const apiKeyForRedact = process.env[p.model.keyEnv] ?? '';
      if (kind === 'spend_cap' || kind === 'auth') {
        // モデルに届く前に断られた要求（Google プロジェクトの利用上限・認証エラー）は
        // 再試行しても通らず、人が対処するまで以降の全 run が同じ理由で落ちる。試行回数を
        // 消費せず（run 記録もレジャも書かない）実行全体を即中断する
        const remaining = planned.length - plannedIndex;
        const label = kind === 'spend_cap' ? '利用上限' : '認証エラー';
        console.error(`${label}で中断。残り ${remaining} run は未実行`);
        console.error(fatalAbortExcerpt(info, apiKeyForRedact));
        exitCode = 2;
        break outer;
      }
      failure = error;
      transportError = redactSecret(String(error), apiKeyForRedact);
      errorBody = info.responseBody !== null ? redactSecret(info.responseBody.slice(0, 500), apiKeyForRedact) : null;
    }
    const elapsedMs = Date.now() - t0;

    let items: AnchoredItem[] = [];
    let rejected: RejectedAiItem[] = [];
    let formatError: string | null = null;
    if (res !== null) {
      let parsed: ReturnType<typeof parseExtractDataResponse> | null = null;
      try {
        parsed = parseExtractDataResponse(res.text, runFields, 1); // documentCount=1（単一文書）
      } catch (error) {
        void AiOutputFormatError; // 期待される throw 型（参照保持）
        formatError = redactSecret(
          error instanceof Error ? error.message : String(error),
          process.env[p.model.keyEnv] ?? '',
        );
      }
      if (parsed !== null) {
        rejected = parsed.rejected;
        items = parsed.items.map((item) => {
          const normQuote = item.quote ? normalizeText(item.quote) : '';
          const anchor = normQuote ? anchorQuote(normQuote, normPages, item.page) : null;
          return { ...item, anchor };
        });
      }
    }

    const tokensIn = res?.tokensIn ?? null;
    const tokensOut = res?.tokensOut ?? null;
    const thoughtsTokens = res !== null ? extractThoughtsTokens(res.raw) : null;
    const cachedTokensIn = res?.cachedTokensIn ?? null;
    const promptCharacters = EXTRACT_DATA_SYSTEM_PROMPT.length + (typeof userContent === 'string'
      ? userContent.length : userContent.reduce((sum, part) => sum + (part.type === 'text' ? part.text.length : 0), 0));
    const billed = res === null
      ? failedCostUsd(p.model.id, failure, promptCharacters, MAX_OUTPUT_TOKENS)
      : { ...billedCostUsd({ model: p.model.id, tokensIn, rawResponse: res.raw, cachedTokensIn }),
        costBasis: 'measured' as const };
    cumulativeCost += billed.costUsd ?? 0;

    const outcome: LedgerEntry['outcome'] =
      transportError !== null ? 'transport_error' : formatError !== null ? 'format_error' : 'ok';
    if (outcome !== 'ok') failedCount += 1;

    // 費用上限が規則で、run 記録はその例外側（費用の見張りが優先）。レジャへの追記を run JSON の
    // 書き込みより先に行う: 逆順だと2つの書き込みの間でプロセスが落ちたとき「run ファイルは成功したが
    // レジャに費用が無い」状態になり、再開後はスキップされて費用が総額から永久に漏れる。この順なら
    // 落ちても「レジャに行はあるが run ファイルが無い」= state (6) になり、費用も試行回数も数えられる。
    const ledgerEntry: LedgerEntry = {
      runId: p.runId,
      attemptAt: new Date().toISOString(),
      model: p.model.id,
      pdfId: p.target.pdfId,
      repeat: p.repeat,
      outcome,
      tokensIn,
      tokensOut,
      thoughtsTokens,
      cachedTokensIn,
      costUsd: billed.costUsd,
      costSource: billed.costSource,
      costBasis: billed.costBasis,
      billedTokensOut: billed.billedTokensOut,
      elapsedMs,
    };
    await appendLedger(ledgerPath, ledgerEntry);
    ledgerEntries.push(ledgerEntry);

    await writeRun(outDir, {
      ...(reaskFrom === undefined ? {} : {
        reaskFrom, reaskFieldIds: runFields.map((field) => field.fieldId), reaskTargetCells: cells!,
      }),
      runId: p.runId,
      model: p.model.id,
      inputMode: INPUT_MODE,
      pdfId: p.target.pdfId,
      repeat: p.repeat,
      promptVersion: EXTRACT_DATA_PROMPT_VERSION,
      schemaFile: schemaFileName(),
      executedAt: new Date().toISOString(),
      elapsedMs,
      tokensIn,
      tokensOut,
      thoughtsTokens,
      cachedTokensIn,
      costUsd: billed.costUsd,
      costSource: billed.costSource,
      costBasis: billed.costBasis,
      error: transportError,
      errorBody,
      formatError,
      rejected,
      items,
      rawResponse: res?.raw ?? null,
    });

    executedCount += 1;
    const flag = transportError ? ' ERROR' : formatError ? ' FORMAT_ERROR' : '';
    const costLabel = billed.costBasis === 'estimated_output_limit' ? '（見積もり）'
      : billed.costBasis === 'measured_failure' ? '（失敗・実測）' : '';
    console.log(
      `${p.runId}: items=${items.length} rejected=${rejected.length} ${elapsedMs}ms ` +
        `thoughtsTokens=${thoughtsTokens ?? 'n/a'} cost=$${(billed.costUsd ?? 0).toFixed(4)}${costLabel} ` +
        `累計=$${cumulativeCost.toFixed(4)}${flag}`,
    );

    await sleep(2000);
  }

  // 最後の集計 1 行は中断時（費用上限・利用上限・認証エラー）も必ず出す
  console.log(
    `実行 ${executedCount} / スキップ ${skippedCount} / 失敗 ${failedCount} / 再試行上限 ${retryLimitCount} / ` +
      `累計費用 $${cumulativeCost.toFixed(4)}`,
  );
  if (exitCode !== null) {
    process.exitCode = exitCode;
  }
}

await main();
