// ESLint 設定（docs/architecture.md §2.1 / §5）
// - TypeScript strict 前提。any 禁止
// - レイヤ依存ルール（entries → views/ui → features → lib/domain → utils）を
//   import/no-restricted-paths で機械的に強制する
module.exports = {
  root: true,
  parser: '@typescript-eslint/parser',
  parserOptions: {
    ecmaVersion: 2022,
    sourceType: 'module',
  },
  plugins: ['@typescript-eslint', 'import'],
  extends: ['eslint:recommended', 'plugin:@typescript-eslint/recommended'],
  env: {
    browser: true,
    es2022: true,
    webextensions: true,
  },
  rules: {
    '@typescript-eslint/no-explicit-any': 'error',
    '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
    'import/no-restricted-paths': [
      'error',
      {
        zones: [
          // utils は最下層: 他レイヤを import できない
          {
            target: './src/utils',
            from: './src',
            except: ['./utils'],
            message: 'utils は他レイヤに依存できません（architecture.md §2.1）',
          },
          // domain は純粋型のみ: utils / domain 以外に依存できない
          {
            target: './src/domain',
            from: './src',
            except: ['./domain', './utils'],
            message: 'domain は lib / features / UI に依存できません（architecture.md §2.1）',
          },
          // lib は domain / utils まで
          {
            target: './src/lib',
            from: './src',
            except: ['./lib', './domain', './utils'],
            message: 'lib は features / UI に依存できません（architecture.md §2.1）',
          },
          // features は lib / domain / utils まで（UI に依存しない）
          {
            target: './src/features',
            from: './src',
            except: ['./features', './lib', './domain', './utils'],
            message: 'features は UI レイヤに依存できません（architecture.md §2.1）',
          },
        ],
      },
    ],
  },
  overrides: [
    {
      // src 配下は named export のみ（architecture.md §5）
      files: ['src/**/*.ts'],
      rules: {
        'import/no-default-export': 'error',
      },
    },
    {
      files: ['tests/**/*.ts'],
      env: { jest: true, node: true },
    },
  ],
  ignorePatterns: [
    'dist/',
    'node_modules/',
    'coverage/',
    'experiments/',
    'sr-query-builder-plugin/',
    'tiab-review-plugin/',
  ],
};
