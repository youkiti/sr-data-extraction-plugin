import { readdirSync } from 'node:fs';
import { sep } from 'node:path';
import js from '@eslint/js';
import globals from 'globals';
import tsParser from '@typescript-eslint/parser';
import tsPlugin from '@typescript-eslint/eslint-plugin';

// ESLint 設定（docs/architecture.md §2.1 / §5）
export default [
  {
    ignores: [
      '**/.*', '**/*.js', '**/*.mjs', '**/*.cjs',
      'dist/**', 'node_modules/**', 'coverage/**', 'experiments/**',
      'sr-query-builder-plugin/**', 'tiab-review-plugin/**',
    ],
  },
  {
    files: ['**/*.ts'],
    linterOptions: { reportUnusedDisableDirectives: 'off' },
    languageOptions: {
      parser: tsParser,
      ecmaVersion: 2022,
      sourceType: 'module',
      globals: { ...globals.browser, ...globals.es2022, ...globals.webextensions },
    },
    plugins: { '@typescript-eslint': tsPlugin },
    rules: {
      ...js.configs.recommended.rules,
      ...tsPlugin.configs['eslint-recommended'].overrides[0].rules,
      ...tsPlugin.configs.recommended.rules,
      // ESLint 8.57 の recommended に無かった規則。移行では検出範囲を変えない。
      'no-constant-binary-expression': 'off',
      'no-empty-static-block': 'off',
      'no-unassigned-vars': 'off',
      'no-unused-private-class-members': 'off',
      'no-useless-assignment': 'off',
      'preserve-caught-error': 'off',
      // ESLint 8 と同じく、ブロック内の関数宣言も検出する。
      'no-inner-declarations': ['error', 'functions', { blockScopedFunctions: 'disallow' }],
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
    },
  },
  {
    // src 配下は named export のみ（architecture.md §5）
    files: ['src/**/*.ts'],
    rules: {
      'no-restricted-syntax': [
        'error',
        { selector: 'ExportDefaultDeclaration', message: 'default export は禁止です（architecture.md §5）' },
        {
          selector: 'ExportNamedDeclaration > ExportSpecifier[exported.name="default"], ExportNamedDeclaration > ExportSpecifier[exported.value="default"], ExportAllDeclaration[exported.name="default"], ExportAllDeclaration[exported.value="default"]',
          message: 'default export は禁止です（architecture.md §5）',
        },
      ],
    },
  },
  ...[
    {
      layer: 'utils',
      allowed: ['utils'],
      message: 'utils は他レイヤに依存できません（architecture.md §2.1）',
    },
    {
      layer: 'domain',
      allowed: ['domain', 'utils'],
      message: 'domain は lib / features / UI に依存できません（architecture.md §2.1）',
    },
    {
      layer: 'lib',
      allowed: ['lib', 'domain', 'utils'],
      message: 'lib は features / UI に依存できません（architecture.md §2.1）',
    },
    {
      layer: 'features',
      allowed: ['features', 'lib', 'domain', 'utils'],
      message: 'features は UI レイヤに依存できません（architecture.md §2.1）',
    },
  ].flatMap(({ layer, allowed, message }) => {
    // ファイルの深さごとに src へ戻る ../ の数を固定する。
    // 下位ディレクトリの types などを、src 直下の別レイヤと誤認しない。
    const paths = readdirSync(new URL(`./src/${layer}/`, import.meta.url), { recursive: true });
    const maxDepth = Math.max(0, ...paths.map(path => path.split(sep).length - 1));
    return Array.from({ length: maxDepth + 1 }, (_, depth) => ({
      files: [`src/${layer}/${'*/'.repeat(depth)}*.ts`],
      rules: {
        'no-restricted-imports': ['error', {
          patterns: [{
            regex: `^(?:(?:\\.\\./){${depth + 1}}|(?:\\./)?src/)(?!(?:${allowed.join('|')})(?:/|$))(?!(?:\\.\\.?)(?:/|$))[^/]`,
            message,
          }],
        }],
      },
    }));
  }),
  {
    files: ['tests/**/*.ts'],
    languageOptions: { globals: { ...globals.jest, ...globals.node } },
  },
];
