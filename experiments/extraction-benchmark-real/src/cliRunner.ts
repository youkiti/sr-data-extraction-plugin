// CLI 経由の抽出（2026-10-18）。Gemini API の代わりに、claude CLI（Claude Code の利用枠）または
// codex CLI でモデルを呼び、本番と同じプロンプト・応答検証・アンカリングで run JSON を書く。
// 採点は score-models / scoreEntityLevel にそのまま渡せる形（src/runner.ts の RunRecord と同じ主な列）。
//
// コンテクスト汚染を防ぐため、1 論文ごとに新しいプロセスを起動し、空のフォルダ（CLEAN_DIR）を作業場所にする。
// - claude: --setting-sources "" で CLAUDE.md・設定を読まず、--tools "" で道具を無効にし、
//   --strict-mcp-config で MCP を読まない。システムプロンプトは本番の EXTRACT_DATA_SYSTEM_PROMPT で置き換える
// - codex: --ignore-user-config・--ephemeral・-s read-only。システムプロンプトの指定が無いので、本番の
//   システムプロンプトを入力の先頭に置く
//
// 環境変数:
//   BENCH_CLI_BACKEND = claude | codex（必須）
//   BENCH_CLI_MODEL   = モデル ID（必須。例: claude-sonnet-5-5 / gpt-6.1-sol）
//   BENCH_CLI_EFFORT  = reasoning effort（任意。codex は既定 medium、claude は未指定なら CLI の既定）
//   BENCH_RUN_LABEL   = 出力先 outputs/runs-{label}（必須。既定ラベルの run を上書きしないため）
//   BENCH_TARGETS     = 対象論文の限定（任意。config.ts と同じ）
import { spawn, spawnSync } from 'node:child_process';
import { mkdir, readdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { loadLocalConfig } from './localConfig';
import {
  buildExtractDataUserContent,
  EXTRACT_DATA_PROMPT_VERSION,
  EXTRACT_DATA_RESPONSE_SCHEMA,
  EXTRACT_DATA_SYSTEM_PROMPT,
  parseExtractDataResponse,
  type ExtractDataPage,
} from '../../../src/features/extraction/skills/extractData';
import { normalizeText } from '../../../src/features/anchoring/normalizeText';
import { anchorQuote } from '../../../src/features/anchoring/anchorQuote';
import type { NormalizedPage } from '../../../src/domain/anchor';
import { benchRoot, runsDir, selectedTargets } from './config';
import { loadBenchmarkSchema, schemaFileName } from './loadSchema';

// 子プロセスの cwd もこのフォルダにするので、相対パスはベンチのフォルダを基準に絶対パスへ直す
const CLEAN_DIR = path.resolve(benchRoot, loadLocalConfig().cleanDir);
const CALL_TIMEOUT_MS = 30 * 60_000;
const MAX_ATTEMPTS = 2;

const backend = process.env.BENCH_CLI_BACKEND;
const model = process.env.BENCH_CLI_MODEL?.trim();
const effort = process.env.BENCH_CLI_EFFORT?.trim() || (backend === 'codex' ? 'medium' : undefined);
if (backend !== 'claude' && backend !== 'codex') throw new Error('BENCH_CLI_BACKEND は claude か codex');
if (!model) throw new Error('BENCH_CLI_MODEL が必要です');
if (!process.env.BENCH_RUN_LABEL?.trim()) throw new Error('BENCH_RUN_LABEL が必要です（既定ラベルの run を上書きしないため）');

/** claude の --json-schema と codex の --output-schema は最上位が object である必要があるので、配列を包む */
const WRAPPED_SCHEMA = {
  type: 'object',
  properties: { items: EXTRACT_DATA_RESPONSE_SCHEMA },
  required: ['items'],
  additionalProperties: false,
};
const OUTPUT_NOTE =
  '\n\n# Output\nReturn a JSON object of the form {"items": [...]}, where the array holds the extraction items described above. ' +
  'Answer from the text in this message only. Do not run commands or open files.';

interface CliResult {
  text: string | null; // 抽出項目の配列の JSON 文字列（包みを外したもの）
  error: string | null;
  elapsedMs: number;
  tokensIn: number | null;
  tokensOut: number | null;
  thoughtsTokens: number | null;
  costUsd: number | null;
  raw: unknown;
}

function runProcess(command: string, args: string[], stdin: string): Promise<{ code: number | null; stdout: string; stderr: string }> {
  return new Promise((resolve) => {
    // codex は npm の .cmd なので shell 経由で起動する（引数は固定値とこのスクリプトが作るパスだけで、空白も引用符も無い）。
    // claude は .exe なので shell を通さず、空文字や JSON の引数をそのまま渡す
    const child = spawn(command, args, { cwd: CLEAN_DIR, shell: command === 'codex', windowsHide: true });
    let stdout = '';
    let stderr = '';
    // shell 経由だと child.kill() は cmd.exe しか止めないので、プロセスの木ごと止める
    const timer = setTimeout(() => {
      if (child.pid !== undefined) spawnSync('taskkill', ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true });
      else child.kill();
    }, CALL_TIMEOUT_MS);
    child.stdout.on('data', (d: Buffer) => { stdout += d.toString('utf8'); });
    child.stderr.on('data', (d: Buffer) => { stderr += d.toString('utf8'); });
    child.on('close', (code) => { clearTimeout(timer); resolve({ code, stdout, stderr }); });
    child.stdin.end(stdin, 'utf8');
  });
}

function unwrap(text: string): string {
  const parsed = JSON.parse(text) as unknown;
  if (Array.isArray(parsed)) return JSON.stringify(parsed);
  if (parsed !== null && typeof parsed === 'object' && Array.isArray((parsed as { items?: unknown }).items)) {
    return JSON.stringify((parsed as { items: unknown[] }).items);
  }
  throw new Error('応答が {"items": [...]} の形ではありません');
}

async function callClaude(userText: string, work: string): Promise<CliResult> {
  const systemFile = path.join(work, 'system.txt');
  const schemaFile = path.join(work, 'schema.json');
  await writeFile(systemFile, EXTRACT_DATA_SYSTEM_PROMPT, 'utf8');
  await writeFile(schemaFile, JSON.stringify(WRAPPED_SCHEMA), 'utf8');
  const args = [
    '-p', '--model', model!, '--setting-sources', '', '--strict-mcp-config', '--tools', '',
    '--system-prompt-file', systemFile.replace(/\\/g, '/'), '--json-schema', JSON.stringify(WRAPPED_SCHEMA),
    '--no-session-persistence', '--output-format', 'json',
    ...(effort ? ['--effort', effort] : []),
  ];
  const t0 = Date.now();
  const { code, stdout, stderr } = await runProcess('claude', args, userText + OUTPUT_NOTE);
  const elapsedMs = Date.now() - t0;
  let envelope: Record<string, unknown>;
  try {
    envelope = JSON.parse(stdout) as Record<string, unknown>;
  } catch {
    return { text: null, error: `exit ${code}: ${(stderr || stdout).slice(0, 500)}`, elapsedMs, tokensIn: null, tokensOut: null, thoughtsTokens: null, costUsd: null, raw: stdout.slice(0, 2000) };
  }
  const usage = (envelope.usage ?? {}) as Record<string, unknown>;
  const tokensIn = ['input_tokens', 'cache_creation_input_tokens', 'cache_read_input_tokens']
    .reduce((s, k) => s + (typeof usage[k] === 'number' ? (usage[k] as number) : 0), 0);
  const thoughts = (usage.output_tokens_details as Record<string, unknown> | undefined)?.thinking_tokens;
  const base = {
    elapsedMs,
    tokensIn,
    tokensOut: typeof usage.output_tokens === 'number' ? usage.output_tokens : null,
    thoughtsTokens: typeof thoughts === 'number' ? thoughts : null,
    costUsd: typeof envelope.total_cost_usd === 'number' ? envelope.total_cost_usd : null,
    raw: { ...envelope, result: undefined, structured_output: undefined },
  };
  if (envelope.is_error === true) return { ...base, text: null, error: `is_error: ${String(envelope.result ?? envelope.subtype).slice(0, 500)}` };
  try {
    const structured = envelope.structured_output;
    const text = structured !== undefined ? JSON.stringify(structured) : String(envelope.result ?? '');
    return { ...base, text: unwrap(text), error: null };
  } catch (error) {
    return { ...base, text: null, error: `応答の解析に失敗: ${error instanceof Error ? error.message : String(error)}` };
  }
}

async function callCodex(userText: string, work: string): Promise<CliResult> {
  const schemaFile = path.join(work, 'schema.json').replace(/\\/g, '/');
  const outFile = path.join(work, 'last.txt').replace(/\\/g, '/');
  await writeFile(schemaFile, JSON.stringify(WRAPPED_SCHEMA), 'utf8');
  const args = [
    'exec', '-m', model!, '-c', `model_reasoning_effort=${effort}`, '-s', 'read-only',
    '--skip-git-repo-check', '--ephemeral', '--ignore-user-config', '--json',
    '-C', CLEAN_DIR, '--output-schema', schemaFile, '-o', outFile, '-',
  ];
  const prompt = `# System instructions\n${EXTRACT_DATA_SYSTEM_PROMPT}\n\n# Task\n${userText}${OUTPUT_NOTE}`;
  const t0 = Date.now();
  const { code, stdout, stderr } = await runProcess('codex', args, prompt);
  const elapsedMs = Date.now() - t0;
  // --json の事件列から使用量と、道具を使ったかを拾う（道具を使った run は汚染の疑いとして記録する）
  let tokensIn: number | null = null;
  let tokensOut: number | null = null;
  let thoughtsTokens: number | null = null;
  const commandEvents: string[] = [];
  for (const line of stdout.split('\n')) {
    if (!line.trim().startsWith('{')) continue;
    try {
      const ev = JSON.parse(line) as Record<string, unknown>;
      const usage = (ev.usage ?? (ev.type === 'turn.completed' ? ev.usage : undefined)) as Record<string, number> | undefined;
      if (usage) {
        // ターンが複数になったときに備えて合算する
        tokensIn = (tokensIn ?? 0) + (usage.input_tokens ?? 0);
        tokensOut = (tokensOut ?? 0) + (usage.output_tokens ?? 0);
        if (typeof usage.reasoning_output_tokens === 'number') thoughtsTokens = (thoughtsTokens ?? 0) + usage.reasoning_output_tokens;
      }
      const item = ev.item as Record<string, unknown> | undefined;
      if (item && typeof item.type === 'string' && item.type !== 'agent_message' && item.type !== 'reasoning') commandEvents.push(item.type);
    } catch { /* 事件列以外の行は無視 */ }
  }
  let last: string | null = null;
  try {
    last = await readFile(outFile, 'utf8');
  } catch {
    last = null;
  }
  const base = {
    elapsedMs, tokensIn, tokensOut, thoughtsTokens, costUsd: null,
    raw: { exitCode: code, commandEvents, stderrTail: stderr.slice(-500), lastMessageHead: last?.slice(0, 2000) ?? null },
  };
  // 道具を使った応答は、ディスク上の gold や過去の run を読んだ可能性があるので、採点に入れない
  if (commandEvents.length > 0) return { ...base, text: null, error: `道具を使ったため汚染の疑い: ${[...new Set(commandEvents)].join(', ')}` };
  if (last === null) return { ...base, text: null, error: `exit ${code}: 最終メッセージが無い。${stderr.slice(-500)}` };
  try {
    return { ...base, text: unwrap(last), error: null };
  } catch (error) {
    return { ...base, text: null, error: `応答の解析に失敗: ${error instanceof Error ? error.message : String(error)}` };
  }
}

async function main(): Promise<void> {
  const fields = await loadBenchmarkSchema();
  const outDir = runsDir();
  await mkdir(outDir, { recursive: true });
  await mkdir(CLEAN_DIR, { recursive: true });
  const modelTag = model!.replace(/[^0-9A-Za-z.-]/g, '_');
  let done = 0, skipped = 0, failed = 0;

  for (const target of selectedTargets()) {
    const runId = `${modelTag}__text_only__${target.pdfId}__r1`;
    const runPath = path.join(outDir, `${runId}.json`);
    const existing = await readFile(runPath, 'utf8').then((t) => JSON.parse(t) as { error: unknown; formatError: unknown }).catch(() => null);
    if (existing && existing.error === null && existing.formatError === null) { skipped += 1; console.log(`${runId}: 完了済み`); continue; }
    // 失敗の記録が既に 1 本退避されていれば（= 2 回の起動で失敗）、これ以上呼ばない
    const priorFailures = (await readdir(outDir)).filter((n) => n.startsWith('_failed-') && n.endsWith(`__${runId}.json.bak`)).length;
    if (existing && priorFailures >= 1) { failed += 1; console.log(`${runId}: 再試行の上限のためスキップ`); continue; }
    if (existing) await rename(runPath, path.join(outDir, `_failed-${Date.now()}__${runId}.json.bak`));

    const pages = (JSON.parse(await readFile(path.join(benchRoot, 'outputs', 'textlayer', `${target.pdfId}.json`), 'utf8')) as { pages: ExtractDataPage[] }).pages;
    const normPages: NormalizedPage[] = pages.map((p) => ({ page: p.page, text: normalizeText(p.text) }));
    const userContent = buildExtractDataUserContent({ fields, documents: [{ role: 'article', filename: target.file, mode: 'text', pages }] });
    if (typeof userContent !== 'string') throw new Error('テキストのみの入力で ChatContentPart[] が返りました');

    let result: CliResult | null = null;
    let formatError: string | null = null;
    let items: unknown[] = [];
    let rejected: unknown[] = [];
    let attempts = 0;
    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
      attempts = attempt;
      items = [];
      rejected = [];
      const work = path.join(CLEAN_DIR, `work-${runId}`);
      await mkdir(work, { recursive: true });
      result = backend === 'claude' ? await callClaude(userContent, work) : await callCodex(userContent, work);
      await rm(work, { recursive: true, force: true });
      formatError = null;
      if (result.text !== null) {
        try {
          const parsed = parseExtractDataResponse(result.text, fields, 1);
          rejected = parsed.rejected;
          items = parsed.items.map((item) => {
            const q = item.quote ? normalizeText(item.quote) : '';
            return { ...item, anchor: q ? anchorQuote(q, normPages, item.page) : null };
          });
        } catch (error) {
          formatError = error instanceof Error ? error.message : String(error);
        }
      }
      if (result.error === null && formatError === null) break;
      console.warn(`${runId}: 試行 ${attempt} 失敗: ${result.error ?? formatError}`);
    }

    const record = {
      runId, model: model!, inputMode: 'text_only', pdfId: target.pdfId, repeat: 1,
      promptVersion: EXTRACT_DATA_PROMPT_VERSION, schemaFile: schemaFileName(), executedAt: new Date().toISOString(),
      backend, effort: effort ?? 'cli-default', outputNote: OUTPUT_NOTE, attempts,
      elapsedMs: result!.elapsedMs, tokensIn: result!.tokensIn, tokensOut: result!.tokensOut,
      thoughtsTokens: result!.thoughtsTokens, cachedTokensIn: null,
      costUsd: result!.costUsd, costSource: backend === 'claude' ? 'claude_cli_reported' : 'unknown', costBasis: 'measured',
      error: result!.error, errorBody: null, formatError, rejected, items, rawResponse: result!.raw,
    };
    await writeFile(runPath, JSON.stringify(record, null, 1), 'utf8');
    if (record.error !== null || formatError !== null) failed += 1; else done += 1;
    console.log(`${runId}: items=${items.length} rejected=${rejected.length} ${Math.round(result!.elapsedMs / 1000)}s out=${result!.tokensOut ?? 'n/a'} cost=${result!.costUsd ?? 'n/a'}${record.error || formatError ? ' FAILED' : ''}`);
  }
  console.log(`完了 ${done} / スキップ ${skipped} / 失敗 ${failed}`);
}

await main();
