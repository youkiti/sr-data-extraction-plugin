// flat config の層制約と、旧 recommended の検出範囲を確認する。
import test from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync } from 'node:fs';
import { posix } from 'node:path';
import { ESLint } from 'eslint';

const eslint = new ESLint();
const ruleId = 'normalized-imports/restricted-paths';

test('全層で静的・動的 import と再 export のパスを正規化して制約を適用する', async () => {
  const layers = ['utils', 'domain', 'lib', 'features'];
  for (const [index, layer] of layers.entries()) {
    const directories = new Set(readdirSync(`src/${layer}`, { recursive: true })
      .filter(path => path.endsWith('.ts'))
      .map(path => posix.dirname(`src/${layer}/${path.replaceAll('\\', '/')}`)));
    for (const directory of directories) {
      const prefix = '../'.repeat(directory.split('/').length - 1);
      for (const target of ['manifest.json', ...layers, 'app/app']) {
        const forbidden = !layers.slice(0, index + 1).includes(target);
        for (const source of [
          `${prefix}${target}`,
          `./${prefix}${target}`,
          `${prefix}utils/../${target}`,
          `${prefix}../src/${target}`,
          `src/utils/../${target}`,
        ]) {
          for (const code of [
            `import '${source}';`,
            `export const a = () => import('${source}');`,
            `export const a = () => import(\`${source}\`);`,
            `export { x } from '${source}';`,
            `export * from '${source}';`,
          ]) {
            const [result] = await eslint.lintText(code, { filePath: `${directory}/probe.ts` });
            assert.equal(result.messages.some(message => message.ruleId === ruleId), forbidden,
              `${directory}: ${code}`);
          }
        }
      }
    }
  }
});

test('同層・外部パッケージ・src 外への参照や source のない export は層違反にしない', async () => {
  for (const code of [
    "import './nested/../entityKey';",
    "import 'node:crypto';",
    "import '../../package.json';",
    'export const a = 1;',
    'const a = 1; export { a };',
    'export const a = (path: string) => import(path);',
    'export const a = (path: string) => import(`../${path}`);',
  ]) {
    const [result] = await eslint.lintText(code, { filePath: 'src/utils/probe.ts' });
    assert.equal(result.messages.some(message => message.ruleId === ruleId), false, code);
  }
});

test('recommended から外れた余分なセミコロンと空白・タブ混在も検出する', async () => {
  const [result] = await eslint.lintText('export const a = 1;;\n \texport const b = 2;\n', {
    filePath: 'src/utils/probe.ts',
  });
  assert.ok(result.messages.some(message => message.ruleId === 'no-extra-semi'));
  assert.ok(result.messages.some(message => message.ruleId === 'no-mixed-spaces-and-tabs'));
});
