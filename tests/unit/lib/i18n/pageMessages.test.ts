import { existsSync, readFileSync } from 'node:fs';
import { dirname, relative, resolve, sep } from 'node:path';
import ts from 'typescript';
import { ja } from '../../../../src/lib/i18n/ja';
import { jaPages } from '../../../../src/lib/i18n/ja.pages';

const root = resolve(__dirname, '../../../..');
const srcRoot = resolve(root, 'src');
const allKeys = new Set(Object.keys(ja));

/** 型専用の依存は出力に含まれないため除外し、実行時の相対 import / export をたどる。 */
function collectModules(entry: string): Map<string, ts.SourceFile> {
  const modules = new Map<string, ts.SourceFile>();
  function visit(file: string): void {
    if (modules.has(file)) return;
    const source = ts.createSourceFile(file, readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true);
    modules.set(file, source);
    for (const statement of source.statements) {
      if (!ts.isImportDeclaration(statement) && !ts.isExportDeclaration(statement)) continue;
      if (ts.isImportDeclaration(statement) && statement.importClause?.isTypeOnly) continue;
      if (ts.isExportDeclaration(statement) && statement.isTypeOnly) continue;
      const specifier = statement.moduleSpecifier;
      if (!specifier || !ts.isStringLiteral(specifier) || !specifier.text.startsWith('.')) continue;
      const base = resolve(dirname(file), specifier.text);
      const target = [base + '.ts', resolve(base, 'index.ts')].find(existsSync);
      if (target && target.startsWith(srcRoot + sep)) visit(target);
    }
  }
  visit(resolve(root, entry));
  return modules;
}

describe.each(['popup', 'options'])('%s の文言の取りこぼし検査', (page) => {
  test('参照キーがページ共通群に収まり、利用側の t に動的な引数がない', () => {
    const modules = collectModules('src/' + page + '/' + page + '.ts');
    const references = new Map<string, Set<string>>();
    const dynamicCalls: string[] = [];
    const addKey = (key: string, file: string): void => {
      const files = references.get(key) ?? new Set<string>();
      files.add(relative(root, file));
      references.set(key, files);
    };
    for (const [file, source] of modules) {
      // 翻訳基盤自身の localizeDom は下で HTML 属性を検査する。
      // 利用側の t は別名 import と名前空間 import も含めて検査する。
      const names = new Set<string>(['t']);
      const namespaces = new Set<string>();
      for (const statement of source.statements) {
        if (!ts.isImportDeclaration(statement)) continue;
        const bindings = statement.importClause?.namedBindings;
        if (bindings && ts.isNamedImports(bindings)) {
          for (const binding of bindings.elements) {
            if ((binding.propertyName ?? binding.name).text === 't') names.add(binding.name.text);
          }
        }
        if (bindings && ts.isNamespaceImport(bindings)) namespaces.add(bindings.name.text);
      }
      const walk = (node: ts.Node): void => {
        if (ts.isStringLiteralLike(node) && allKeys.has(node.text)) addKey(node.text, file);
        if (ts.isCallExpression(node) && file !== resolve(srcRoot, 'lib/i18n/index.ts')) {
          const expression = node.expression;
          const isTranslation = (ts.isIdentifier(expression) && names.has(expression.text))
            || (ts.isPropertyAccessExpression(expression) && expression.name.text === 't'
              && ts.isIdentifier(expression.expression) && namespaces.has(expression.expression.text));
          if (isTranslation && (!node.arguments[0] || !ts.isStringLiteralLike(node.arguments[0]))) {
            const { line } = source.getLineAndCharacterOfPosition(node.getStart(source));
            dynamicCalls.push(relative(root, file) + ':' + (line + 1));
          }
        }
        ts.forEachChild(node, walk);
      };
      walk(source);
    }
    const htmlFile = resolve(srcRoot, page, page + '.html');
    const html = readFileSync(htmlFile, 'utf8');
    let htmlKeyCount = 0;
    for (const match of html.matchAll(/\bdata-i18n(?:-placeholder|-title|-aria-label)?=["']([^"']+)["']/g)) {
      addKey(match[1]!, htmlFile);
      htmlKeyCount++;
    }
    const missing = [...references]
      .filter(([key]) => !(key in jaPages))
      .map(([key, files]) => key + ': ' + [...files].join(', '));
    expect(htmlKeyCount).toBeGreaterThanOrEqual(2);
    expect(modules.size).toBeGreaterThanOrEqual(10);
    expect(references.size).toBeGreaterThanOrEqual(30);
    expect(missing).toEqual([]);
    expect(dynamicCalls).toEqual([]);
  });
});
