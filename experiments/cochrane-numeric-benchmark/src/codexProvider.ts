import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { mkdtemp, mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import type { ChatMessage, ChatOptions, ChatResponse } from '../../../src/lib/llm/LLMProvider';
import { codexTimeoutMs, type CodexEffort } from './config';

export const disabledFeatures = ['shell_tool', 'apps', 'browser_use', 'computer_use', 'image_generation', 'view_image',
  'multi_agent', 'plugins', 'skill_search', 'sleep_tool', 'tool_suggest', 'code_mode_host', 'shell_snapshot'];
export type SpawnCodex = (args: string[], cwd: string, env: NodeJS.ProcessEnv) => ChildProcessWithoutNullStreams;
const spawnDefault: SpawnCodex = (args, cwd, env) => {
  const js = process.env.BENCH_CODEX_JS || (process.platform === 'win32'
    ? path.join(process.env.APPDATA ?? '', 'npm', 'node_modules', '@openai', 'codex', 'bin', 'codex.js') : null);
  return spawn(js ? process.execPath : 'codex', js ? [js, ...args] : args, { cwd, env, shell: false, stdio: 'pipe' });
};
type Usage = { tokensIn: number | null; tokensOut: number | null; cachedTokensIn: number | null; thoughtsTokensOut: number | null };
const emptyUsage = (): Usage => ({ tokensIn: null, tokensOut: null, cachedTokensIn: null, thoughtsTokensOut: null });
function failure(detail: string, usage = emptyUsage(), timedOut = false, evidence = detail) {
  const limit = /usage limit|hit your .*limit|quota|insufficient_quota|purchase more credits|plan limit/i.test(evidence);
  const rateLimit = /rate limit|\b429\b/i.test(evidence);
  const auth = /\b401\b|not logged in|login/i.test(evidence);
  const invalid = /invalid_request_error|\b400\b|Invalid schema/i.test(evidence);
  const status = timedOut ? null : limit || rateLimit ? 429 : auth ? 401 : invalid ? 400 : Number(evidence.match(/\b5\d\d\b/)?.[0]) || null;
  const message = detail.slice(0, 2000);
  return Object.assign(new Error(message), { status, failureKind: timedOut ? 'timeout' : limit ? 'codex_usage_limit' : null,
    retryable: timedOut || (!limit && !auth && !invalid), responseBody: message, usage });
}
function runProcess(start: SpawnCodex, args: string[], cwd: string, input: string, timeoutMs: number) {
  return new Promise<{ stdout: string; stderr: string; code: number | null; timedOut: boolean }>((resolve, reject) => {
    let child: ChildProcessWithoutNullStreams;
    const env = { ...process.env };
    delete env.CODEX_API_KEY; delete env.OPENAI_API_KEY;
    try { child = start(args, cwd, env); } catch (error) { reject(failure(String(error))); return; }
    let stdout = '', stderr = '', timedOut = false;
    child.stdout.setEncoding('utf8'); child.stderr.setEncoding('utf8');
    child.stdout.on('data', (chunk: string) => { stdout += chunk; });
    child.stderr.on('data', (chunk: string) => { stderr = (stderr + chunk).slice(-16000); });
    const timer = setTimeout(() => {
      timedOut = true;
      if (process.platform === 'win32' && child.pid) {
        const killer = spawn('taskkill', ['/pid', String(child.pid), '/T', '/F'], { shell: false, stdio: 'ignore' });
        killer.on('error', () => child.kill());
      } else child.kill('SIGKILL');
    }, timeoutMs);
    child.on('error', (error) => { clearTimeout(timer); reject(failure(error.message)); });
    child.on('close', (code) => { clearTimeout(timer); resolve({ stdout, stderr, code, timedOut }); });
    child.stdin.on('error', () => { /* 終了時の EPIPE は終了コードとイベントで扱う。 */ });
    child.stdin.end(input);
  });
}
export async function codexPreflight(spawnCodex: SpawnCodex = spawnDefault): Promise<{ codexVersion: string }> {
  const cwd = await mkdtemp(path.join(os.tmpdir(), 'cochrane-codex-'));
  try {
    const version = await runProcess(spawnCodex, ['--version'], cwd, '', codexTimeoutMs());
    if (version.code !== 0 || version.timedOut || !version.stdout.trim()) throw new Error('codex の版を取得できません');
    const codexVersion = version.stdout.trim();
    if (/\b0\.162\.1\b/.test(codexVersion)) throw new Error('codex 0.162.1 は使用できません。動作確認済みの版を使ってください');
    const login = await runProcess(spawnCodex, ['login', 'status'], cwd, '', codexTimeoutMs());
    if (login.code !== 0 || login.timedOut || !/ChatGPT/.test(login.stdout + '\n' + login.stderr)) {
      throw new Error('codex は ChatGPT のサブスクリプションでログインしてください');
    }
    return { codexVersion };
  } finally { await rm(cwd, { recursive: true, force: true }); }
}
function contentText(content: ChatMessage['content']): string {
  if (typeof content === 'string') return content;
  return content.map((part) => {
    if (part.type !== 'text') throw failure('codex 経路は画像を受け付けません', emptyUsage(), false, '400');
    return part.text;
  }).join('');
}
export type CodexResponse = Omit<ChatResponse, 'sentSettings'> & { sentSettings: {
  route: 'codex'; model: string; reasoningEffort: CodexEffort; codexVersion: string; schemaWrappedAsObject: true;
  temperature: null; maxOutputTokens: null; disabledFeatures: string[]; codexNonMessageItems: number; codexRecoveredErrors: number;
} };
export function createCodexProvider({ effort, codexVersion, timeoutMs = codexTimeoutMs(), spawnCodex = spawnDefault }:
  { effort: CodexEffort; codexVersion: string; timeoutMs?: number; spawnCodex?: SpawnCodex }) {
  return { async chat(messages: readonly ChatMessage[], options: ChatOptions = {}): Promise<CodexResponse> {
    const dir = await mkdtemp(path.join(os.tmpdir(), 'cochrane-codex-'));
    try {
      const cwd = path.join(dir, 'work');
      await mkdir(cwd);
      const system = messages.filter((message) => message.role === 'system').map((message) => contentText(message.content)).join('\n');
      const user = messages.filter((message) => message.role === 'user').map((message) => contentText(message.content)).join('\n');
      if (messages.some((message) => message.role === 'model')) throw failure('codex 経路は会話履歴を受け付けません', emptyUsage(), false, '400');
      if (!options.responseSchema) throw failure('応答スキーマが必要です', emptyUsage(), false, '400');
      const instructions = path.join(dir, 'instructions.txt'), schema = path.join(dir, 'schema.json'), output = path.join(dir, 'output.txt');
      await writeFile(instructions, system, 'utf8');
      await writeFile(schema, JSON.stringify({ type: 'object', properties: { items: options.responseSchema }, required: ['items'], additionalProperties: false }), 'utf8');
      const args = ['exec', '-m', 'gpt-6.2-sol', '-c', `model_reasoning_effort=${effort}`, '-c',
        `model_instructions_file='${instructions.replace(/\\/g, '/')}'`, '-c', 'web_search=disabled',
        ...disabledFeatures.flatMap((feature) => ['--disable', feature]), '--ephemeral', '--ignore-user-config',
        '-s', 'read-only', '--skip-git-repo-check', '--output-schema', schema, '--json', '-o', output, '-'];
      const result = await runProcess(spawnCodex, args, cwd, user, timeoutMs);
      const usage = emptyUsage();
      const errors: string[] = [];
      let nonMessageItems = 0, failed = false, recoveredErrors = 0;
      let lastTurnEnd: string | null = null;
      for (const line of result.stdout.split('\n')) {
        let event;
        try { event = JSON.parse(line); } catch { continue; }
        if (event.type === 'turn.completed' && event.usage) {
          for (const [key, source] of [['tokensIn', 'input_tokens'], ['tokensOut', 'output_tokens'],
            ['cachedTokensIn', 'cached_input_tokens'], ['thoughtsTokensOut', 'reasoning_output_tokens']] as const) {
            const value = event.usage[source];
            if (typeof value === 'number' && Number.isFinite(value) && value >= 0) usage[key] = (usage[key] ?? 0) + value;
          }
        }
        if (event.type === 'item.completed' && event.item?.type !== 'agent_message') nonMessageItems++;
        if (event.type === 'turn.completed' || event.type === 'turn.failed') lastTurnEnd = event.type;
        if (event.type === 'turn.failed') failed = true;
        if (event.type === 'error' || event.type === 'turn.failed') {
          if (event.type === 'error') recoveredErrors++;
          const message = event.message ?? event.error?.message;
          if (typeof message === 'string') errors.push(message);
        }
      }
      const sentSettings: CodexResponse['sentSettings'] = { route: 'codex', model: 'gpt-6.2-sol', reasoningEffort: effort,
        codexVersion, schemaWrappedAsObject: true, temperature: null, maxOutputTokens: null,
        disabledFeatures: [...disabledFeatures], codexNonMessageItems: nonMessageItems, codexRecoveredErrors: recoveredErrors };
      let text = '';
      try { text = await readFile(output, 'utf8'); } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
      if (result.timedOut || result.code !== 0 || failed || lastTurnEnd !== 'turn.completed' || !text.trim()) {
        throw Object.assign(failure(errors.join('\n') || (result.timedOut ? 'codex が時間切れになりました' : 'codex が異常終了しました'),
          usage, result.timedOut, errors.join('\n') + '\n' + result.stderr), { sentSettings });
      }
      try { const parsed = JSON.parse(text); if (Array.isArray(parsed?.items)) text = JSON.stringify(parsed.items); } catch { /* 形式不正は runner に渡す。 */ }
      return { text, ...usage, sentSettings, responseModel: 'gpt-6.2-sol', raw: null };
    } finally { await rm(dir, { recursive: true, force: true }); }
  } };
}
