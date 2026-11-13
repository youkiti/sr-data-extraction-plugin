// ソースの定数から点検対象を収集し、推論を呼ばずにモデル一覧と照合する。
import { readFileSync, appendFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import ts from 'typescript';

export const SOURCE_FILES = {
  settings: 'src/lib/storage/settingsStore.ts',
  consult: 'src/lib/help/consult/model.ts',
  pricing: 'src/lib/llm/pricing.ts',
};
export const KEY_ENV = {
  gemini: 'GEMINI_API_KEY',
  anthropic: 'ANTHROPIC_API_KEY',
  openrouter: 'OPENROUTER_API_KEY',
};

function initializer(source, name) {
  const file = ts.createSourceFile('source.ts', source, ts.ScriptTarget.Latest, true);
  const declarations = file.statements.filter(ts.isVariableStatement)
    .flatMap(statement => [...statement.declarationList.declarations])
    .filter(declaration => declaration.name.getText(file) === name);
  if (file.parseDiagnostics.length || declarations.length !== 1 || !declarations[0].initializer) {
    throw new Error(`${name} の定義を読み取れません`);
  }
  let node = declarations[0].initializer;
  while (ts.isAsExpression(node) || ts.isSatisfiesExpression(node) || ts.isParenthesizedExpression(node)) {
    node = node.expression;
  }
  return node;
}

function literal(node) {
  if (!ts.isStringLiteral(node)) throw new Error('モデル ID は文字列リテラルで指定してください');
  return node.text;
}

function properties(source, name) {
  const node = initializer(source, name);
  if (!ts.isObjectLiteralExpression(node) || node.properties.length === 0) {
    throw new Error(`${name} は空でないオブジェクトで指定してください`);
  }
  return node.properties.map(property => {
    if (!ts.isPropertyAssignment(property)
      || !(ts.isIdentifier(property.name) || ts.isStringLiteral(property.name))) {
      throw new Error(`${name} のプロパティを読み取れません`);
    }
    return [property.name.text, property.initializer];
  });
}

function providerFor(id) {
  if (id.startsWith('gemini-')) return 'gemini';
  if (id.startsWith('claude-')) return 'anthropic';
  if (id.includes('/')) return 'openrouter';
  throw new Error(`モデル ID の接続先を判定できません: ${id}`);
}

export function collectModelIds(sources) {
  const models = new Map();
  const add = (id, provider, usedBy) => {
    if (!Object.hasOwn(KEY_ENV, provider)) throw new Error(`未対応の接続先: ${provider}`);
    const key = `${provider}:${id}`;
    if (!models.has(key)) models.set(key, { id, provider, usedBy: [] });
    models.get(key).usedBy.push(usedBy);
  };
  const factory = literal(initializer(sources.settings, 'FACTORY_DEFAULT_MODEL'));
  add(factory, providerFor(factory), 'FACTORY_DEFAULT_MODEL');
  for (const [provider, value] of properties(sources.consult, 'CONSULT_MODELS')) {
    add(literal(value), provider, `CONSULT_MODELS.${provider}`);
  }
  for (const [id] of properties(sources.pricing, 'MODEL_PRICING')) {
    add(id, providerFor(id), 'MODEL_PRICING');
  }
  return [...models.values()];
}

export function compareModelIds(expected, available) {
  const ids = new Set(available);
  return expected.filter(id => !ids.has(id));
}

export async function fetchModelIds(provider, key, fetchImpl) {
  const endpoint = {
    gemini: 'https://generativelanguage.googleapis.com/v1beta/models',
    anthropic: 'https://api.anthropic.com/v1/models',
    openrouter: 'https://openrouter.ai/api/v1/models',
  }[provider];
  const headers = provider === 'gemini' ? { 'x-goog-api-key': key }
    : provider === 'anthropic' ? { 'x-api-key': key, 'anthropic-version': '2023-06-01' }
      : { Authorization: `Bearer ${key}` };
  const ids = [];
  const cursors = new Set();
  let cursor;
  for (let page = 0; page < 100; page += 1) {
    const url = new URL(endpoint);
    if (cursor) url.searchParams.set(provider === 'gemini' ? 'pageToken' : 'after_id', cursor);
    const response = await fetchImpl(url, { headers, signal: AbortSignal.timeout(15000) });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const body = await response.json();
    const entries = provider === 'gemini' ? body.models : body.data;
    if (!Array.isArray(entries)) throw new Error('モデル一覧の形式が不正です');
    for (const entry of entries) {
      const id = provider === 'gemini' ? entry?.name : entry?.id;
      if (typeof id !== 'string' || !id) throw new Error('モデル ID の形式が不正です');
      ids.push(provider === 'gemini' ? id.replace(/^models\//, '') : id);
    }
    cursor = provider === 'gemini' ? body.nextPageToken
      : provider === 'anthropic' && body.has_more ? body.last_id : undefined;
    if (provider === 'anthropic' && body.has_more && !cursor) throw new Error('次ページの ID がありません');
    if (!cursor) return ids;
    if (typeof cursor !== 'string' || cursors.has(cursor)) throw new Error('ページ送りが進みません');
    cursors.add(cursor);
  }
  throw new Error('モデル一覧のページ数が上限を超えました');
}

export async function checkModels(models, env, fetchImpl = globalThis.fetch, log = console.log) {
  let failed = false;
  for (const [provider, keyName] of Object.entries(KEY_ENV)) {
    const expected = models.filter(model => model.provider === provider);
    if (!expected.length) continue;
    const key = (env[keyName] ?? '').trim();
    if (!key) {
      log(`${provider}: スキップ（${keyName} が未設定、${expected.length} 件は未確認）`);
      continue;
    }
    let available;
    try {
      available = await fetchModelIds(provider, key, fetchImpl);
    } catch (error) {
      // 通信例外・応答本文には鍵や URL が含まれうるため、HTTP 状態以外は出さない。
      const message = error?.message;
      const detail = /^HTTP \d{3}$/.test(message) ? message : '通信・応答形式・ページ送りを確認してください';
      log(`${provider}: 一覧取得失敗（${detail}）`);
      failed = true;
      continue;
    }
    const missing = new Set(compareModelIds(expected.map(model => model.id), available));
    for (const model of expected) {
      log(`${provider}: ${missing.has(model.id) ? '見つからない' : '一覧に存在'}: ${model.id} (${model.usedBy.join(', ')})`);
    }
    if (missing.size) failed = true;
  }
  return failed ? 1 : 0;
}

async function main() {
  const root = new URL('../../', import.meta.url);
  const sources = Object.fromEntries(Object.entries(SOURCE_FILES)
    .map(([name, file]) => [name, readFileSync(new URL(file, root), 'utf8')]));
  const lines = ['## AI モデル ID の生存確認', ''];
  process.exitCode = await checkModels(collectModelIds(sources), process.env, globalThis.fetch, line => {
    console.log(line);
    lines.push(`- ${line}`);
  });
  if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, `${lines.join('\n')}\n`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().catch(() => {
    console.error('モデル点検を実行できません。ソースの定数定義と実行環境を確認してください');
    process.exitCode = 1;
  });
}
