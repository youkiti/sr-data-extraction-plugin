import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { SOURCE_FILES, collectModelIds, compareModelIds, fetchModelIds, checkModels } from './checkModelIds.mjs';

const sources = {
  settings: "export const FACTORY_DEFAULT_MODEL = 'gemini-default';",
  consult: `export const CONSULT_MODELS = {
    gemini: 'gemini-help', anthropic: 'claude-help', openrouter: 'org/help',
  } as const;`,
  pricing: `export const MODEL_PRICING: Readonly<Record<string, unknown>> = {
    // 'コメント内のモデル': {}
    'gemini-default': {}, 'claude-help': {}, 'org/priced': {},
  }; const OTHER = { '対象外': {} };`,
};
const response = body => ({ ok: true, json: async () => body });

test('既定・相談・単価表の ID を収集し、出典を残して重複をまとめる', () => {
  assert.deepEqual(collectModelIds(sources), [
    { id: 'gemini-default', provider: 'gemini', usedBy: ['FACTORY_DEFAULT_MODEL', 'MODEL_PRICING'] },
    { id: 'gemini-help', provider: 'gemini', usedBy: ['CONSULT_MODELS.gemini'] },
    { id: 'claude-help', provider: 'anthropic', usedBy: ['CONSULT_MODELS.anthropic', 'MODEL_PRICING'] },
    { id: 'org/help', provider: 'openrouter', usedBy: ['CONSULT_MODELS.openrouter'] },
    { id: 'org/priced', provider: 'openrouter', usedBy: ['MODEL_PRICING'] },
  ]);
});

test('実ソースからも収集でき、別の表の ID を拾わない', () => {
  const root = new URL('../../', import.meta.url);
  const actual = Object.fromEntries(Object.entries(SOURCE_FILES)
    .map(([name, file]) => [name, readFileSync(new URL(file, root), 'utf8')]));
  const models = collectModelIds(actual);
  assert.ok(models.some(model => model.usedBy.includes('FACTORY_DEFAULT_MODEL')));
  assert.equal(models.filter(model => model.usedBy.includes('MODEL_PRICING')).length, 13);
  assert.equal(models.filter(model => model.usedBy.some(place => place.startsWith('CONSULT_MODELS.'))).length, 3);
});

test('定数の書式変更や未対応 provider を黙って無視しない', () => {
  for (const settings of [
    '', 'const FACTORY_DEFAULT_MODEL;', 'const FACTORY_DEFAULT_MODEL = ;',
    "const FACTORY_DEFAULT_MODEL = 'gemini-a'; const FACTORY_DEFAULT_MODEL = 'gemini-b';",
    'const FACTORY_DEFAULT_MODEL = compute();', "const FACTORY_DEFAULT_MODEL = 'unknown';",
  ]) assert.throws(() => collectModelIds({ ...sources, settings }));
  for (const pricing of [
    'const MODEL_PRICING = [];', 'const MODEL_PRICING = {};',
    'const MODEL_PRICING = { ...other };', 'const MODEL_PRICING = { shorthand };',
    "const MODEL_PRICING = { ['gemini-a']: {} };",
  ]) assert.throws(() => collectModelIds({ ...sources, pricing }));
  assert.throws(() => collectModelIds({ ...sources, consult: "const CONSULT_MODELS = { local: 'x' };" }));
  assert.throws(() => collectModelIds({ ...sources, consult: 'const CONSULT_MODELS = { gemini: 123 };' }));
  assert.ok(collectModelIds({ ...sources, settings: "const FACTORY_DEFAULT_MODEL = ('gemini-a' satisfies string);" }));
});

test('同じ ID でも provider が異なれば別の点検対象にする', () => {
  const models = collectModelIds({ ...sources, consult: "const CONSULT_MODELS = { openrouter: 'gemini-default' };" });
  assert.equal(models.filter(model => model.id === 'gemini-default').length, 2);
});

test('完全一致で空一覧・欠落・余分な ID を扱う', () => {
  assert.deepEqual(compareModelIds(['a', 'b'], ['b', 'extra']), ['a']);
  assert.deepEqual(compareModelIds(['a'], []), ['a']);
  assert.deepEqual(compareModelIds([], ['a']), []);
  assert.deepEqual(compareModelIds(['claude-alias'], ['claude-alias-20260101']), ['claude-alias']);
});

test('Gemini はページを辿り、models/ 接頭辞を外す', async () => {
  let calls = 0;
  const ids = await fetchModelIds('gemini', 'fixture-key', async (url, init) => {
    assert.equal(url.origin, 'https://generativelanguage.googleapis.com');
    assert.equal(init.headers['x-goog-api-key'], 'fixture-key');
    assert.equal(url.searchParams.has('key'), false);
    assert.ok(init.signal);
    calls += 1;
    if (calls === 1) return response({ models: [{ name: 'models/gemini-a' }], nextPageToken: 'next' });
    assert.equal(url.searchParams.get('pageToken'), 'next');
    return response({ models: [{ name: 'models/gemini-b' }] });
  });
  assert.deepEqual(ids, ['gemini-a', 'gemini-b']);
  assert.equal(calls, 2);
});

test('Anthropic は has_more と after_id で全ページを集める', async () => {
  let calls = 0;
  assert.deepEqual(await fetchModelIds('anthropic', 'fixture-key', async (url, init) => {
    assert.equal(init.headers['x-api-key'], 'fixture-key');
    assert.equal(init.headers['anthropic-version'], '2023-06-01');
    calls += 1;
    if (calls === 1) return response({ data: [{ id: 'claude-a' }], has_more: true, last_id: 'claude-a' });
    assert.equal(url.searchParams.get('after_id'), 'claude-a');
    return response({ data: [{ id: 'claude-b' }], has_more: false });
  }), ['claude-a', 'claude-b']);
});

test('OpenRouter は能力によるフィルタをかけず取得する', async () => {
  assert.deepEqual(await fetchModelIds('openrouter', 'fixture-key', async (url, init) => {
    assert.equal(url.href, 'https://openrouter.ai/api/v1/models');
    assert.equal(init.headers.Authorization, 'Bearer fixture-key');
    return response({ data: [{ id: 'org/text-only', architecture: { input_modalities: ['text'] } }] });
  }), ['org/text-only']);
});

test('HTTP・JSON・ID・ページ送りの異常を失敗にする', async () => {
  await assert.rejects(fetchModelIds('gemini', 'key', async () => ({ ok: false, status: 401 })), /HTTP 401/);
  await assert.rejects(fetchModelIds('gemini', 'key', async () => ({ ok: true, json: async () => { throw new Error('JSON'); } })), /JSON/);
  for (const body of [{}, { data: [null] }, { data: [{ id: 1 }] }, { data: [{ id: '' }] },
    { data: [], has_more: true }, { data: [], has_more: true, last_id: 123 },
    { data: [], has_more: true, last_id: 'same' }]) {
    await assert.rejects(fetchModelIds('anthropic', 'key', async () => response(body)));
  }
  let page = 0;
  await assert.rejects(fetchModelIds('gemini', 'key', async () => response({ models: [], nextPageToken: String(++page) })), /上限/);
  assert.equal(page, 100);
});

test('キーなしを明記し、API を呼ばない', async () => {
  const logs = [];
  assert.equal(await checkModels(collectModelIds(sources), { GEMINI_API_KEY: '  ' },
    () => assert.fail('通信してはいけない'), line => logs.push(line)), 0);
  assert.equal(logs.length, 3);
  assert.ok(logs.every(line => line.includes('スキップ') && line.includes('未確認')));
  assert.equal(await checkModels([], {}, () => assert.fail('通信してはいけない')), 0);
});

test('成功・欠落を出典付きで報告し、欠落時は終了コード 1', async () => {
  const models = collectModelIds(sources).filter(model => model.provider === 'gemini');
  const logs = [];
  assert.equal(await checkModels(models, { GEMINI_API_KEY: 'key' },
    async () => response({ models: [{ name: 'models/gemini-default' }] }), line => logs.push(line)), 1);
  assert.ok(logs[0].includes('一覧に存在: gemini-default (FACTORY_DEFAULT_MODEL, MODEL_PRICING)'));
  assert.ok(logs[1].includes('見つからない: gemini-help'));
  assert.equal(await checkModels(models, { GEMINI_API_KEY: 'key' },
    async () => response({ models: models.map(model => ({ name: `models/${model.id}` })) }), () => {}), 0);
});

test('取得失敗は秘密をログに出さず報告し、次の provider も点検する', async () => {
  const logs = [];
  const env = { GEMINI_API_KEY: 'secret-gemini', ANTHROPIC_API_KEY: 'secret-anthropic', OPENROUTER_API_KEY: 'secret-router' };
  assert.equal(await checkModels(collectModelIds(sources), env, async url => {
    if (url.hostname.includes('googleapis')) throw new Error('secret-gemini');
    if (url.hostname.includes('anthropic')) return { ok: false, status: 403, text: async () => 'secret-anthropic' };
    return response({ data: [{ id: 'org/help' }, { id: 'org/priced' }] });
  }, line => logs.push(line)), 1);
  assert.ok(logs[0].includes('一覧取得失敗'));
  assert.ok(logs[1].includes('HTTP 403'));
  assert.ok(logs[2].includes('一覧に存在'));
  assert.equal(logs.join('\n').includes('secret-'), false);
  assert.equal(await checkModels(collectModelIds(sources), env, async () => { throw null; }, () => {}), 1);
});

test('Anthropic の一覧にない別名だけを個別取得し、200 なら正式 ID を報告して成功する', async () => {
  const alias = 'claude-haiku-4-5';
  const canonical = 'claude-haiku-4-5-20251001';
  const models = [canonical, alias, 'claude-alias/with?reserved#文字'].map(id => ({
    id, provider: 'anthropic', usedBy: ['MODEL_PRICING'],
  }));
  const logs = [];
  const urls = [];
  assert.equal(await checkModels(models, { ANTHROPIC_API_KEY: 'fixture-key' }, async (url, init) => {
    urls.push(url.href);
    assert.deepEqual(init.headers, { 'x-api-key': 'fixture-key', 'anthropic-version': '2023-06-01' });
    assert.ok(init.signal);
    assert.equal(url.href.includes('fixture-key'), false);
    if (url.pathname === '/v1/models') {
      return response({ data: [{ id: canonical }] });
    }
    return { status: 200, json: async () => ({ id: canonical }) };
  }, line => logs.push(line)), 0);
  assert.deepEqual(urls, [
    'https://api.anthropic.com/v1/models',
    `https://api.anthropic.com/v1/models/${alias}`,
    `https://api.anthropic.com/v1/models/${encodeURIComponent(models[2].id)}`,
  ]);
  assert.ok(logs[0].includes(`一覧に存在: ${canonical}`));
  assert.ok(logs[1].includes(`${alias} → ${canonical} (MODEL_PRICING)`));
  assert.equal(logs.join('\n').includes('fixture-key'), false);
});

test('Anthropic の個別取得が 404 なら欠落として失敗する', async () => {
  const logs = [];
  let calls = 0;
  const models = [{ id: 'claude-missing', provider: 'anthropic', usedBy: ['MODEL_PRICING'] }];
  assert.equal(await checkModels(models, { ANTHROPIC_API_KEY: 'fixture-key' }, async url => {
    calls += 1;
    if (url.pathname === '/v1/models') {
      return response({ data: [] });
    }
    return { status: 404 };
  }, line => logs.push(line)), 1);
  assert.equal(calls, 2);
  assert.deepEqual(logs, ['anthropic: 見つからない: claude-missing (MODEL_PRICING)']);
});

test('Anthropic の個別取得が 500・429・通信失敗・不正応答なら欠落とせず確認不能で失敗する', async () => {
  const models = [
    { id: 'claude-alias', provider: 'anthropic', usedBy: ['MODEL_PRICING'] },
    { id: 'org/priced', provider: 'openrouter', usedBy: ['MODEL_PRICING'] },
  ];
  for (const retrieve of [
    async () => ({ status: 500 }),
    async () => ({ status: 429 }),
    async () => { throw new Error('fixture-key'); },
    async () => { throw null; },
    async () => ({ status: 200, json: async () => { throw new Error('fixture-key'); } }),
    async () => ({ status: 200, json: async () => null }),
    async () => ({ status: 200, json: async () => ({ id: '' }) }),
  ]) {
    const logs = [];
    assert.equal(await checkModels(models, { ANTHROPIC_API_KEY: 'fixture-key', OPENROUTER_API_KEY: 'router-key' }, async url => {
      if (url.hostname === 'openrouter.ai') {
        return response({ data: [{ id: 'org/priced' }] });
      }
      if (url.pathname === '/v1/models') {
        return response({ data: [] });
      }
      return retrieve();
    }, line => logs.push(line)), 1);
    assert.ok(logs[0].includes('確認できなかった: claude-alias (MODEL_PRICING)'));
    assert.ok(logs[1].includes('openrouter: 一覧に存在'));
    assert.equal(logs.join('\n').includes('見つからない'), false);
    assert.equal(logs.join('\n').includes('fixture-key'), false);
    assert.equal(logs.join('\n').includes('router-key'), false);
  }
});
