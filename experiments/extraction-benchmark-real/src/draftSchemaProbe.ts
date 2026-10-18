// issue #226 の再現確認: 表のデザインのドラフト（draft-schema skill）へサンプル論文を 1 本渡したときと
// 3 本渡したときで、提案される項目の数と出力トークン数がどう変わるかを見る。
// 本番の draftSchema（プロンプト・構造化出力スキーマ・応答パース）と GeminiProvider をそのまま使い、
// 呼び出しのオプションも本番（src/app/services/schemaService.ts の runDraftSchema）と同じにする。
// 入力: raw/draft-probe-protocol.txt（測定用に書いたプロトコル）+ outputs/textlayer/{pdfId}.json。
// 出力: outputs/draft-schema-issue226/{model}__{条件}__r{n}.json（1 枠 1 ファイル）+ _attempts.jsonl（全試行の追記ログ）。
// 応答を受け取れた枠（成功・形式エラー・HTTP 200 の打ち切り）は結果として確定し、引き直さない。
// 再実行するのは、応答を受け取れなかった枠（HTTP エラー・通信の例外）と、版数・入力が変わった枠だけ。
// ★外部 API を「条件 2 × 反復」回だけ呼ぶ。キーはログ・記録に出さない。
// 使い方: npx tsx src/draftSchemaProbe.ts        … 未完了の呼び出しを実行してから集計を表示
//         npx tsx src/draftSchemaProbe.ts report … API を呼ばず、記録だけから集計を表示
import { createHash } from 'node:crypto';
import { appendFile, mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { loadLocalConfig } from './localConfig';
import dotenv from 'dotenv';
import {
  buildDraftSchemaUserPrompt,
  DRAFT_SCHEMA_PROMPT_VERSION,
  DRAFT_SCHEMA_RESPONSE_SCHEMA,
  DRAFT_SCHEMA_SYSTEM_PROMPT,
  parseDraftSchemaResponse,
  type DraftSchemaSamplePaper,
} from '../../../src/features/schema/skills/draftSchema';
import { createProvider } from '../../../src/lib/llm/providerFactory';
import { benchRoot, repoRoot } from './config';

dotenv.config({ path: [path.join(benchRoot, '.env'), path.join(repoRoot, '.env')], quiet: true });

const MODEL = process.env.DRAFT_PROBE_MODEL?.trim() || 'gemini-3.8-flash';
const REPEATS = Number(process.env.DRAFT_PROBE_REPEATS ?? '3');
// 3 本の合計は約 13.7 万文字（報告された入力 30,793 トークンに近い規模）。1 本の条件は 3 本の先頭と同じ論文
const CONDITIONS: ReadonlyArray<{ name: string; papers: readonly string[] }> = loadLocalConfig().probes.draftConditions;
const OUT_DIR = path.join(benchRoot, 'outputs', 'draft-schema-issue226');

/** content_error = HTTP 200 で応答は来たが打ち切り・本文なし / http_error = HTTP 4xx・5xx / unknown = 通信の例外・タイムアウト */
type Outcome = 'success' | 'format_error' | 'content_error' | 'http_error' | 'unknown';
/** 応答を受け取れた = その枠の結果として確定する種別（成功するまで引き直すと、見たい現象が集計から落ちる） */
const FINAL_OUTCOMES: readonly Outcome[] = ['success', 'format_error', 'content_error'];

interface ProbeRecord {
  model: string;
  condition: string;
  papers: readonly string[];
  repeat: number;
  promptVersion: number;
  promptChars: number;
  /** システム + ユーザープロンプトの SHA-256。プロトコル・論文の組・プロンプトが変わった記録を混ぜないための照合用 */
  promptHash: string;
  outcome: Outcome;
  /** 成功時だけ入る。失敗・結果不明を 0 件として数えないために null と区別する */
  fieldCount: number | null;
  fieldNames: string[] | null;
  tokensIn: number | null;
  /** 本番の tokensOut は「本文 + 思考」の合計。本文だけの量は tokensOut - thoughtsTokensOut */
  tokensOut: number | null;
  thoughtsTokensOut: number | null;
  elapsedMs: number;
  error: string | null;
  responseText: string | null;
  recordedAt: string;
}

async function loadSample(pdfId: string): Promise<DraftSchemaSamplePaper> {
  const raw = await readFile(path.join(benchRoot, 'outputs', 'textlayer', `${pdfId}.json`), 'utf8');
  const pages = (JSON.parse(raw) as { pages: Array<{ page: number; text: string }> }).pages;
  if (pages.length === 0) throw new Error(`${pdfId} の本文が空です`);
  return { label: pdfId, pages };
}

interface Prepared {
  userPrompt: string;
  promptHash: string;
}

async function prepare(protocolText: string, papers: readonly string[]): Promise<Prepared> {
  const samples = await Promise.all(papers.map(loadSample));
  const userPrompt = buildDraftSchemaUserPrompt({ protocolText, samples });
  const promptHash = createHash('sha256').update(DRAFT_SCHEMA_SYSTEM_PROMPT, 'utf8').update(userPrompt, 'utf8').digest('hex');
  return { userPrompt, promptHash };
}

/** いまの版数・入力で取った記録か（違う記録は集計にも再開判定にも使わない） */
function isCurrent(record: ProbeRecord, prepared: Prepared): boolean {
  return record.promptVersion === DRAFT_SCHEMA_PROMPT_VERSION && record.promptHash === prepared.promptHash;
}

function recordPath(condition: string, repeat: number): string {
  return path.join(OUT_DIR, `${MODEL}__${condition}__r${repeat}.json`);
}

async function readRecord(condition: string, repeat: number): Promise<ProbeRecord | null> {
  try {
    return JSON.parse(await readFile(recordPath(condition, repeat), 'utf8')) as ProbeRecord;
  } catch {
    return null;
  }
}

/** キーを伏せたエラー文字列（fetch の例外メッセージには URL ごとキーが載ることがある） */
function describeError(error: unknown, apiKey: string): string {
  const base = error instanceof Error ? `${error.name}: ${error.message}` : String(error);
  const body = (error as { responseBody?: unknown } | null)?.responseBody;
  const detail = typeof body === 'string' && body !== '' ? ` / body=${body.slice(0, 400)}` : '';
  return `${base}${detail}`.split(apiKey).join('[KEY]');
}

async function runOne(
  apiKey: string,
  prepared: Prepared,
  condition: { name: string; papers: readonly string[] },
  repeat: number,
): Promise<ProbeRecord> {
  const { userPrompt, promptHash } = prepared;
  const provider = createProvider({
    apiKey,
    model: MODEL,
    fetch: (input, init) => fetch(input, { ...init, signal: AbortSignal.timeout(600_000) }),
  });
  const base = {
    model: MODEL,
    condition: condition.name,
    papers: condition.papers,
    repeat,
    promptVersion: DRAFT_SCHEMA_PROMPT_VERSION,
    promptChars: DRAFT_SCHEMA_SYSTEM_PROMPT.length + userPrompt.length,
    promptHash,
  };
  const t0 = Date.now();
  try {
    const response = await provider.chat(
      [
        { role: 'system', content: DRAFT_SCHEMA_SYSTEM_PROMPT },
        { role: 'user', content: userPrompt },
      ],
      { responseFormat: 'json', responseSchema: DRAFT_SCHEMA_RESPONSE_SCHEMA },
    );
    const elapsedMs = Date.now() - t0;
    const usage = {
      tokensIn: response.tokensIn ?? null,
      tokensOut: response.tokensOut ?? null,
      thoughtsTokensOut: response.thoughtsTokensOut ?? null,
    };
    try {
      const rows = parseDraftSchemaResponse(response.text);
      return {
        ...base, ...usage, outcome: 'success', fieldCount: rows.length, fieldNames: rows.map((r) => r.fieldName),
        elapsedMs, error: null, responseText: response.text, recordedAt: new Date().toISOString(),
      };
    } catch (error) {
      return {
        ...base, ...usage, outcome: 'format_error', fieldCount: null, fieldNames: null,
        elapsedMs, error: describeError(error, apiKey), responseText: response.text, recordedAt: new Date().toISOString(),
      };
    }
  } catch (error) {
    // HTTP 200 で届いた応答の打ち切り・本文なしは content_error（結果として確定）、HTTP 4xx・5xx は http_error、
    // 通信の例外・タイムアウトは結果不明。後ろの 2 つは応答を受け取れていないので次回に再実行する
    const isProviderError = error instanceof Error && error.name === 'LlmProviderError';
    const status = (error as { status?: unknown } | null)?.status;
    const usage = (error as { usage?: { tokensIn?: number | null; tokensOut?: number | null; thoughtsTokensOut?: number | null } | null } | null)?.usage;
    return {
      ...base,
      outcome: !isProviderError ? 'unknown' : status === 200 ? 'content_error' : 'http_error',
      fieldCount: null,
      fieldNames: null,
      tokensIn: usage?.tokensIn ?? null,
      tokensOut: usage?.tokensOut ?? null,
      thoughtsTokensOut: usage?.thoughtsTokensOut ?? null,
      elapsedMs: Date.now() - t0,
      error: describeError(error, apiKey),
      responseText: null,
      recordedAt: new Date().toISOString(),
    };
  }
}

function bodyTokens(record: ProbeRecord): number | null {
  if (record.tokensOut === null) return null;
  return record.tokensOut - (record.thoughtsTokensOut ?? 0);
}

async function report(protocolText: string): Promise<void> {
  console.log(`\n== 集計（モデル ${MODEL} / draft-schema プロンプト版数 ${DRAFT_SCHEMA_PROMPT_VERSION} / 各条件 ${REPEATS} 回）==`);
  console.log(['条件', '回', '結果', '項目数', '入力tok', '出力tok(本文)', '思考tok', '秒', 'エラー'].join('\t'));
  for (const condition of CONDITIONS) {
    const prepared = await prepare(protocolText, condition.papers);
    const counts: number[] = [];
    let recorded = 0;
    for (let repeat = 1; repeat <= REPEATS; repeat++) {
      const record = await readRecord(condition.name, repeat);
      if (record === null || !isCurrent(record, prepared)) {
        console.log([condition.name, repeat, record === null ? '未実行' : '版数か入力が違う記録（集計外）','-', '-', '-', '-', '-', ''].join('\t'));
        continue;
      }
      recorded += 1;
      if (record.outcome === 'success' && record.fieldCount !== null) counts.push(record.fieldCount);
      console.log(
        [
          condition.name, repeat, record.outcome, record.fieldCount ?? '-', record.tokensIn ?? '-',
          bodyTokens(record) ?? '-', record.thoughtsTokensOut ?? '-', (record.elapsedMs / 1000).toFixed(1),
          record.error ?? '',
        ].join('\t'),
      );
    }
    const range = counts.length > 0 ? `${Math.min(...counts)}〜${Math.max(...counts)}` : '-';
    console.log(`  → ${condition.name}: 記録 ${recorded}/${REPEATS} 回・うち成功 ${counts.length} 回・成功した回の項目数 ${range}`);
  }
}

async function main(): Promise<void> {
  if (!Number.isInteger(REPEATS) || REPEATS < 1) throw new Error('DRAFT_PROBE_REPEATS は 1 以上の整数にしてください');
  // GEMINI_API_KEY を別プロバイダへ送らない・記録ファイル名にパス区切りを入れないためのガード
  if (!/^gemini-[a-z0-9.-]+$/.test(MODEL)) throw new Error(`DRAFT_PROBE_MODEL は gemini- で始まるモデル ID にしてください: ${MODEL}`);
  const protocolText = await readFile(path.join(benchRoot, 'raw', 'draft-probe-protocol.txt'), 'utf8');
  if (process.argv[2] === 'report') {
    await report(protocolText);
    return;
  }
  const apiKey = process.env.GEMINI_API_KEY?.trim();
  if (!apiKey) throw new Error('GEMINI_API_KEY がありません');
  await mkdir(OUT_DIR, { recursive: true });
  let called = 0;
  for (const condition of CONDITIONS) {
    for (let repeat = 1; repeat <= REPEATS; repeat++) {
      // 再開: いまの版数・入力で、応答を受け取れた記録を完了とみなす（形式エラー・打ち切りも結果なので引き直さない）
      const prepared = await prepare(protocolText, condition.papers);
      const existing = await readRecord(condition.name, repeat);
      if (existing !== null && isCurrent(existing, prepared) && FINAL_OUTCOMES.includes(existing.outcome)) {
        console.log(`skip ${condition.name} r${repeat}（記録済み: ${existing.outcome}）`);
        continue;
      }
      console.log(`run  ${condition.name} r${repeat} ...`);
      const record = await runOne(apiKey, prepared, condition, repeat);
      // 全試行を追記ログに残してから、枠の記録を書き換える（再実行で前の試行が消えないように）
      await appendFile(path.join(OUT_DIR, '_attempts.jsonl'), JSON.stringify({ ...record, responseText: null }) + String.fromCharCode(10), 'utf8');
      await writeFile(recordPath(condition.name, repeat), JSON.stringify(record, null, 2), 'utf8');
      called += 1;
      console.log(`     → ${record.outcome} / 項目数 ${record.fieldCount ?? '-'} / ${(record.elapsedMs / 1000).toFixed(1)} 秒`);
    }
  }
  console.log(`API 呼び出し ${called} 回`);
  await report(protocolText);
}

await main();
