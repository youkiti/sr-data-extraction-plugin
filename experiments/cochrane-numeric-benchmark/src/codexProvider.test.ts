import assert from 'node:assert/strict';
import test from 'node:test';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { readFile, readdir, writeFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { codexPreflight, createCodexProvider, disabledFeatures, type SpawnCodex } from './codexProvider';
import { classifyFailure, errorInfo, retryDecision } from './retry';
import { failureUsage } from './cost';

const schema = { type: 'array', items: { type: 'object' } };
const messages = [{ role: 'system' as const, content: '秘密の指示文' }, { role: 'user' as const,
  content: [{ type: 'text' as const, text: '入力' }, { type: 'text' as const, text: '本文' }] }];
function fake(options: { text?: string; events?: unknown[]; code?: number; version?: string; login?: string; loginStderr?: boolean; preflightCode?: number; hang?: boolean; stderr?: string } = {}) {
  const calls: { args: string[]; cwd: string; env: NodeJS.ProcessEnv; input: string; system?: string; schema?: unknown }[] = [];
  const start: SpawnCodex = (args, cwd, env) => {
    const child = Object.assign(new EventEmitter(), { stdin: new PassThrough(), stdout: new PassThrough(), stderr: new PassThrough(),
      kill: () => { child.emit('close', null); return true; } });
    const call: typeof calls[number] = { args, cwd, env, input: '' };
    calls.push(call);
    child.stdin.on('data', (chunk) => { call.input += chunk.toString(); });
    child.stdin.on('finish', () => {
      void (async () => {
        assert.deepEqual(await readdir(cwd), []);
        if (args[0] === '--version') {
          child.stdout.write(options.version ?? 'codex-cli 0.171.0');
        } else if (args[0] === 'login') {
          (options.loginStderr ? child.stderr : child.stdout).write(options.login ?? 'Logged in using ChatGPT');
        } else {
          const instruction = args.find((arg) => arg.startsWith('model_instructions_file='))!;
          call.system = await readFile(instruction.slice("model_instructions_file='".length, -1), 'utf8');
          call.schema = JSON.parse(await readFile(args[args.indexOf('--output-schema') + 1]!, 'utf8'));
          if (options.hang) return;
          await writeFile(args[args.indexOf('-o') + 1]!, options.text ?? '{"items":[{"value":"2"}]}');
          for (const event of options.events ?? [{ type: 'turn.completed' }]) child.stdout.write(JSON.stringify(event) + '\n');
          if (options.stderr) child.stderr.write(options.stderr);
        }
        child.emit('close', args[0] === 'exec' ? options.code ?? 0 : options.preflightCode ?? 0);
      })().catch((error) => child.emit('error', error));
    });
    return child as unknown as ReturnType<SpawnCodex>;
  };
  return { start, calls };
}
const completed = { type: 'turn.completed', usage: { input_tokens: 16643, cached_input_tokens: 10,
  cache_write_input_tokens: 99, output_tokens: 23, reasoning_output_tokens: 4 } };
const codexVersion = 'codex-cli 0.171.0';

test('codex の道具無効化・入力分離・スキーマ包装と一時ファイル削除', async () => {
  const { start, calls } = fake({ events: [completed, completed, { type: 'item.completed', item: { type: 'agent_message' } },
    { type: 'item.completed', item: { type: 'command_execution' } }] });
  const provider = createCodexProvider({ effort: 'low', codexVersion, spawnCodex: start });
  const response = await provider.chat(messages, { responseSchema: schema, temperature: 0 });
  assert.equal(response.text, '[{"value":"2"}]');
  assert.equal(response.tokensIn, 33286); assert.equal(response.cachedTokensIn, 20);
  assert.equal(response.tokensOut, 46); assert.equal(response.thoughtsTokensOut, 8);
  assert.equal(response.responseModel, 'gpt-6.2-sol');
  assert.deepEqual(response.sentSettings, { route: 'codex', model: 'gpt-6.2-sol', reasoningEffort: 'low',
    codexVersion: 'codex-cli 0.171.0', schemaWrappedAsObject: true, temperature: null, maxOutputTokens: null,
    disabledFeatures, codexNonMessageItems: 1, codexRecoveredErrors: 0 });
  assert.ok(disabledFeatures.includes('view_image'));
  const call = calls[0]!;
  for (const pair of [['-m', 'gpt-6.2-sol'], ['-c', 'model_reasoning_effort=low'], ['-s', 'read-only'],
    ['-c', 'web_search=disabled'], ...disabledFeatures.map((feature) => ['--disable', feature])]) {
    assert.ok(call.args.some((arg, i) => arg === pair[0] && call.args[i + 1] === pair[1]));
  }
  for (const arg of ['--ephemeral', '--ignore-user-config', '--skip-git-repo-check', '--output-schema', '--json']) assert.ok(call.args.includes(arg));
  assert.equal(call.args.at(-1), '-'); assert.equal(call.args.join(' ').includes('秘密の指示文'), false);
  assert.equal(call.args.join(' ').includes('入力本文'), false);
  assert.equal(call.system, '秘密の指示文'); assert.equal(call.input, '入力本文');
  assert.deepEqual(call.schema, { type: 'object', properties: { items: schema }, required: ['items'], additionalProperties: false });
  await assert.rejects(stat(path.dirname(call.cwd)), { code: 'ENOENT' });
  await provider.chat(messages, { responseSchema: schema });
  assert.equal(calls.filter((entry) => entry.args[0] === '--version').length, 0);
});

test('codex の形式不正はそのまま返し使用量欠落は null にする', async () => {
  for (const text of ['not json', '{"items":{}}', 'null']) {
    const { start } = fake({ text });
    const response = await createCodexProvider({ effort: 'medium', codexVersion, spawnCodex: start }).chat(messages, { responseSchema: schema });
    assert.equal(response.text, text); assert.equal(response.tokensIn, null); assert.equal(response.tokensOut, null);
    assert.equal(response.cachedTokensIn, null); assert.equal(response.thoughtsTokensOut, null);
  }
});

test('codex の使用量上限・認証・不正依頼・通信失敗を分類して使用量を保持する', async () => {
  for (const [message, kind, status] of [['Usage Limit reached', 'spend_cap', 429], ['RATE LIMIT', 'retryable', 429],
    ['quota', 'spend_cap', 429], ['429', 'retryable', 429], ['hit your weekly limit', 'spend_cap', 429],
    ['insufficient_quota', 'spend_cap', 429], ['purchase more credits', 'spend_cap', 429], ['plan limit', 'spend_cap', 429],
    ['not logged in: login 401', 'auth', 401],
    ['invalid_request_error 400 Invalid schema', 'other', 400], ['stream disconnected', 'retryable', null],
    ['503 server error', 'retryable', 503]] as const) {
    const { start, calls } = fake({ code: 1, events: [completed, { type: 'turn.failed', error: { message } }], stderr: '非公開の標準エラー全文' });
    await assert.rejects(createCodexProvider({ effort: 'low', codexVersion, spawnCodex: start }).chat(messages, { responseSchema: schema }), (error: unknown) => {
      const info = errorInfo(error);
      assert.equal(classifyFailure(info), kind); assert.equal(info.status, status);
      if (kind === 'retryable' && status === 429) {
        assert.equal(info.failureKind, null); assert.equal(info.retryable, true);
        assert.deepEqual(retryDecision(kind, 1, null), { retry: true, waitMs: 15000 });
      }
      assert.equal(info.message, message); assert.equal(info.responseBody, message);
      assert.deepEqual(failureUsage(error, 0), { tokensIn: 16643, tokensOut: 23, cachedTokensIn: 10, costBasis: 'measured_failure' });
      return true;
    });
    await assert.rejects(stat(path.dirname(calls[0]!.cwd)), { code: 'ENOENT' });
  }
});

test('codex の時間切れを再試行可能にして一時フォルダを消す', async () => {
  const { start, calls } = fake({ hang: true });
  await assert.rejects(createCodexProvider({ effort: 'low', codexVersion, timeoutMs: 100, spawnCodex: start }).chat(messages, { responseSchema: schema }), (error: unknown) => {
    assert.equal(errorInfo(error).failureKind, 'timeout'); assert.equal(classifyFailure(errorInfo(error)), 'retryable'); return true;
  });
  await assert.rejects(stat(path.dirname(calls[0]!.cwd)), { code: 'ENOENT' });
});

test('codex の壊れた版と画像を拒否する', async () => {
  const { start, calls } = fake({ version: 'codex-cli 0.162.1' });
  await assert.rejects(codexPreflight(start), /0\.162\.1/);
  assert.equal(calls.length, 1);
  await assert.rejects(stat(calls[0]!.cwd), { code: 'ENOENT' });
  await assert.rejects(createCodexProvider({ effort: 'low', codexVersion, spawnCodex: start }).chat([
    { role: 'user', content: [{ type: 'image', mimeType: 'image/png', dataBase64: 'x' }] },
  ], { responseSchema: schema }), /画像/);
});

test('codex のエラーイベント・空の最終出力・異常終了と長いエラー文を扱う', async () => {
  for (const options of [{ events: [{ type: 'error', message: 'stream disconnected' }] }, { text: '' }, { code: 2 }]) {
    const { start } = fake(options);
    await assert.rejects(createCodexProvider({ effort: 'low', codexVersion, spawnCodex: start }).chat(messages, { responseSchema: schema }),
      (error: unknown) => { assert.equal(classifyFailure(errorInfo(error)), 'retryable'); return true; });
  }
  const { start } = fake({ events: [{ type: 'error', message: 'x'.repeat(3000) }] });
  await assert.rejects(createCodexProvider({ effort: 'low', codexVersion, spawnCodex: start }).chat(messages, { responseSchema: schema }),
    (error: unknown) => { assert.equal(errorInfo(error).responseBody?.length, 2000); return true; });
});

test('codex は鍵を除いた環境で版と ChatGPT ログインを一度検査する', async () => {
  const previous = { CODEX_API_KEY: process.env.CODEX_API_KEY, OPENAI_API_KEY: process.env.OPENAI_API_KEY };
  try {
    process.env.CODEX_API_KEY = 'test-codex'; process.env.OPENAI_API_KEY = 'test-openai';
    const { start, calls } = fake({ loginStderr: true });
    const checked = await codexPreflight(start);
    const provider = createCodexProvider({ effort: 'low', ...checked, spawnCodex: start });
    await provider.chat(messages, { responseSchema: schema });
    await provider.chat(messages, { responseSchema: schema });
    assert.deepEqual(calls.map((call) => call.args[0]), ['--version', 'login', 'exec', 'exec']);
    for (const call of calls) {
      assert.equal(call.env.CODEX_API_KEY, undefined); assert.equal(call.env.OPENAI_API_KEY, undefined);
      assert.equal(call.env.PATH, process.env.PATH);
    }
    assert.equal(process.env.CODEX_API_KEY, 'test-codex'); assert.equal(process.env.OPENAI_API_KEY, 'test-openai');
  } finally {
    for (const key of ['CODEX_API_KEY', 'OPENAI_API_KEY'] as const) {
      if (previous[key] === undefined) delete process.env[key]; else process.env[key] = previous[key];
    }
  }
});

test('codex の事前検査失敗は chat を呼ばずに止まり失敗をキャッシュしない', async () => {
  for (const options of [{ login: 'Logged in using an API key' }, { login: 'Not logged in' },
    { version: '' }, { version: 'codex-cli 0.162.1' }, { preflightCode: 1 }]) {
    const { start, calls } = fake(options);
    await assert.rejects(async () => {
      const checked = await codexPreflight(start);
      await createCodexProvider({ effort: 'low', ...checked, spawnCodex: start }).chat(messages, { responseSchema: schema });
    });
    assert.equal(calls.some((call) => call.args[0] === 'exec'), false);
    await assert.rejects(codexPreflight(start));
    assert.equal(calls.filter((call) => call.args[0] === '--version').length, 2);
  }
  await assert.rejects(codexPreflight(() => { throw new Error('CLI が見つかりません'); }), /CLI/);
});

test('codex の途中のエラーは回復できるが失敗ターンと完了イベント欠落は拒否する', async () => {
  const { start } = fake({ events: [{ type: 'error', message: '429 rate limit' }, completed] });
  const response = await createCodexProvider({ effort: 'low', codexVersion, spawnCodex: start }).chat(messages, { responseSchema: schema });
  assert.equal(response.sentSettings.codexRecoveredErrors, 1);
  for (const events of [[], [completed, { type: 'turn.failed', error: { message: '失敗' } }],
    [{ type: 'turn.failed', error: { message: '失敗' } }, completed]]) {
    const failed = fake({ events });
    await assert.rejects(createCodexProvider({ effort: 'low', codexVersion, spawnCodex: failed.start }).chat(messages, { responseSchema: schema }));
  }
});
