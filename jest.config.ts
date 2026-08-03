// jest 設定（docs/test-strategy.md §1）
// - jsdom + ts-jest。src/ 配下の行・分岐カバレッジ 100% を強制
// - エントリ（popup.ts / app.ts / options.ts / service-worker.ts）は起動フックのみのため
//   カバレッジ除外し、実処理は bootstrap.ts 側でテストする
import type { Config } from 'jest';

const config: Config = {
  testEnvironment: 'jsdom',
  // ビルド時に webpack DefinePlugin が注入する __BUILD_DATE__ / __DEV_NAME_SUFFIX__ を
  // テストにも与える（build-info.ts が参照。日付は任意の固定日でよい。サフィックスは
  // dev ビルド相当の値にし、ヘッダー / タブタイトルへの (dev) 付与を実挙動で検証する）
  globals: { __BUILD_DATE__: '2026-07-06', __DEV_NAME_SUFFIX__: ' (dev)' },
  roots: ['<rootDir>/src', '<rootDir>/tests'],
  testMatch: ['**/*.test.ts'],
  testPathIgnorePatterns: ['/node_modules/', '<rootDir>/tests/e2e/'],
  transform: {
    '^.+\\.ts$': [
      'ts-jest',
      {
        tsconfig: {
          module: 'commonjs',
          // TS 6 では node10 解決が deprecated 警告になるが、jest（CommonJS 実行）用の
          // 変換に限って許容する（ソース本体は tsconfig.json の bundler 解決で検査）
          moduleResolution: 'node10',
          ignoreDeprecations: '6.0',
        },
      },
    ],
  },
  setupFiles: ['<rootDir>/tests/setup/chrome-mock.ts'],
  clearMocks: true,
  collectCoverageFrom: [
    'src/**/*.ts',
    '!src/popup/popup.ts',
    '!src/app/app.ts',
    '!src/options/options.ts',
    '!src/background/service-worker.ts',
    // 動画収録用のデモビルド専用コード（src/demo/**）はカバレッジ対象外。
    // 実データ・実 API・OAuth 画面なしでスクリプト収録できる状態を作るためだけの
    // 収録専用コードで、Chrome ウェブストアで配布される dist/ には一切含まれない
    // （webpack.config.js の --env demo 分岐でのみ src/ の実装から差し替わる）。
    // 上記のエントリファイル除外と同じ「配布物ではない／起動フックのみ」という扱い
    '!src/demo/**',
  ],
  coverageThreshold: {
    global: {
      branches: 100,
      functions: 100,
      lines: 100,
      statements: 100,
    },
  },
};

export default config;
