// webpack ビルド設定（docs/architecture.md §3）
// - 4 エントリ（service-worker / popup / app / options）を dist/ へビルド
// - HTML / CSS / manifest / _locales / icons は copy-webpack-plugin で転写
// - OAuth クライアント ID（Web アプリケーション型。issue #129）は DefinePlugin の
//   __WEBAUTH_CLIENT_ID__ としてコードへ注入する。dev ビルドは拡張名に (dev) を付与
require('dotenv').config();
const path = require('path');
const webpack = require('webpack');
const CopyWebpackPlugin = require('copy-webpack-plugin');

// ビルド日（ローカル時刻の YYYY-MM-DD）。アプリ名の下に表示する
const now = new Date();
const buildDate = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(
  now.getDate(),
).padStart(2, '0')}`;

/**
 * 動画収録用のデモビルド（`npm run build:demo` = `webpack --mode development --env demo`）で
 * 実 fixture PDF が未取得の場合に、日本語エラーでビルドを止める。
 * `dist-demo/` 生成前に検知したいので CopyWebpackPlugin のパターン列挙前に同期チェックする
 * （実行時に fetchMock が chrome-extension:// 経由で読みに行くのは copy 後の dist-demo/fixtures/）。
 */
function assertDemoFixturePdfExists() {
  const fs = require('fs');
  const fixturePath = path.join(__dirname, 'video', 'fixtures', DEMO_FIXTURE_PDF_FILENAME);
  if (!fs.existsSync(fixturePath)) {
    throw new Error(
      `デモビルド用の PDF フィクスチャが見つかりません: ${fixturePath}\n` +
        'bash video/fixtures/fetch-fixtures.sh を実行してください。',
    );
  }
}

// src/demo/constants.ts の DEMO_FIXTURE_PDF_FILENAME と同じ値（webpack 設定は TS を import
// できないため、ここでは文字列として重複定義する。値を変える場合は両方直すこと）
const DEMO_FIXTURE_PDF_FILENAME = 'PMC10715657_plosone_udca_rct.pdf';

module.exports = (env, argv) => {
  const isProduction = argv && argv.mode === 'production';
  // デモビルド（Playwright 録画用。実 credentials / 実ネットワーク無しで UI を動かす）。
  // `npm run build:demo`（webpack --mode development --env demo）で有効になる。
  // 通常の dev / production ビルドの挙動は `isDemo` 分岐以外では一切変更しない
  const isDemo = Boolean(env && env.demo);
  // launchWebAuthFlow 用の Web アプリケーション型クライアント ID。
  // dev / 本番とも同一 GCP プロジェクト（hosted/picker.html の PICKER_APP_ID）で
  // 発行しないと Picker の drive.file 付与が拡張のトークンへ引き継がれない
  const webAuthClientId =
    (!isProduction && process.env.LOCAL_WEBAUTH_CLIENT_ID) || process.env.WEBAUTH_CLIENT_ID || '';
  if (isProduction && webAuthClientId === '') {
    // CI は dev ビルドしか走らないため、本番だけの設定漏れはここで止める（tiab の教訓）
    throw new Error('WEBAUTH_CLIENT_ID が未設定です（.env を確認してください）');
  }
  if (isDemo) {
    assertDemoFixturePdfExists();
  }

  // dev ビルドで拡張名・ヘッダー・タブタイトルへ付けるサフィックス（本番は空文字）。
  // manifest 名と画面表示（build-info.ts の withDevSuffix）の唯一の定義元。
  // デモビルドは " (dev)" ではなく " (demo)" でストア版・dev 版と区別する
  const devNameSuffix = isProduction ? '' : isDemo ? ' (demo)' : ' (dev)';

  const transformManifest = (content) => {
    const manifest = JSON.parse(content.toString());
    manifest.name = `${manifest.name}${devNameSuffix}`;
    if (manifest.action && manifest.action.default_title) {
      manifest.action.default_title = `${manifest.action.default_title}${devNameSuffix}`;
    }
    return JSON.stringify(manifest, null, 2);
  };

  return {
    mode: isProduction ? 'production' : 'development',
    // MV3 の CSP は eval を許可しないため、eval 系 devtool は使わない
    devtool: isProduction ? false : 'cheap-module-source-map',
    entry: {
      'background/service-worker': './src/background/service-worker.ts',
      'popup/popup': isDemo ? './src/demo/popup-entry.ts' : './src/popup/popup.ts',
      'app/app': isDemo ? './src/demo/app-entry.ts' : './src/app/app.ts',
      'options/options': isDemo ? './src/demo/options-entry.ts' : './src/options/options.ts',
    },
    output: {
      path: path.resolve(__dirname, isDemo ? 'dist-demo' : 'dist'),
      filename: '[name].js',
      // dynamic import の遅延チャンク（mermaid。issue #109 PR5）は dist/chunks/ へまとめる。
      // publicPath は既定の 'auto'（実行スクリプトの URL から出力ルートを逆算）のままにし、
      // 拡張ページ（chrome-extension://.../app/app.html）と E2E 静的配信の双方で
      // `<ルート>/chunks/*.js` として解決させる
      chunkFilename: 'chunks/[name].js',
      clean: true,
    },
    resolve: {
      extensions: ['.ts', '.js'],
    },
    module: {
      rules: [
        {
          test: /\.ts$/,
          loader: 'ts-loader',
          exclude: /node_modules/,
          options: {
            // ビルドは transpile のみ。型検査は `npm run typecheck` で別途行う
            transpileOnly: true,
          },
        },
      ],
    },
    plugins: [
      new webpack.DefinePlugin({
        __BUILD_DATE__: JSON.stringify(buildDate),
        __DEV_NAME_SUFFIX__: JSON.stringify(devNameSuffix),
        __WEBAUTH_CLIENT_ID__: JSON.stringify(webAuthClientId),
      }),
      ...(isDemo
        ? [
            // 各ページ（popup/app/options）の実装は `import { createChromeGoogleApiDeps } from
            // '../../lib/google/...'` のように既存 src/ のファイルをそのまま参照し続ける。
            // 既存ソースは 1 行も書き換えず、ビルド設定だけでモジュール解決先を差し替える。
            // 差し替え後もエクスポートの形（関数名・戻り値の形）は元モジュールと同じに保っている
            // （src/demo/googleDeps.ts 等の冒頭コメント参照）
            // NormalModuleReplacementPlugin は import 文に書かれた「解決前の相対パス文字列」
            // （呼び出し元ごとに ../ の深さが異なる）に対して正規表現を評価するため、
            // 深さに依存しない末尾一致で判定する（tiab-review-plugin/webpack.config.js の
            // `/platform\/chrome$/` と同じ方式）
            new webpack.NormalModuleReplacementPlugin(
              /services\/factories$/,
              path.resolve(__dirname, 'src/demo/googleDeps.ts'),
            ),
            new webpack.NormalModuleReplacementPlugin(
              /lib\/google\/auth$/,
              path.resolve(__dirname, 'src/demo/auth.ts'),
            ),
            new webpack.NormalModuleReplacementPlugin(
              /lib\/google\/identity$/,
              path.resolve(__dirname, 'src/demo/identity.ts'),
            ),
            new webpack.NormalModuleReplacementPlugin(
              /lib\/google\/picker$/,
              path.resolve(__dirname, 'src/demo/picker.ts'),
            ),
          ]
        : []),
      new CopyWebpackPlugin({
        patterns: [
          {
            from: 'src/manifest.json',
            to: 'manifest.json',
            transform: transformManifest,
          },
          { from: '**/*.html', context: 'src' },
          { from: '**/*.css', context: 'src' },
          { from: '_locales', to: '_locales', context: 'src' },
          { from: 'icons', to: 'icons', context: 'src' },
          // デモビルドのみ: #/verify のハイライト実演用の実 PDF フィクスチャ
          // （video/fixtures/fetch-fixtures.sh で取得。src/demo/fetchMock.ts が
          // chrome.runtime.getURL('fixtures/...') 経由で読み込む）
          ...(isDemo
            ? [{ from: `video/fixtures/${DEMO_FIXTURE_PDF_FILENAME}`, to: `fixtures/${DEMO_FIXTURE_PDF_FILENAME}` }]
            : []),
          {
            // PDF.js worker は拡張に同梱する（CDN 不可・MV3 CSP 準拠。architecture.md §3.1）。
            // 実行時は chrome.runtime.getURL('pdf.worker.min.mjs') で解決する
            from: 'node_modules/pdfjs-dist/build/pdf.worker.min.mjs',
            to: 'pdf.worker.min.mjs',
          },
          {
            // 既定 CMap（bcmap）も同梱する（issue #95: 和文 PDF の CID フォントの
            // テキスト抽出に必要）。実行時は chrome.runtime.getURL('cmaps/') で解決する
            from: 'node_modules/pdfjs-dist/cmaps',
            to: 'cmaps',
          },
          {
            // pdfjs 6.x は画像デコーダ（CCITTFax/JBIG2・JPEG2000・ICC）が wasm 実装なので同梱する。
            // 未同梱だとスキャン PDF の該当ページが白紙になる。実行時は chrome.runtime.getURL('wasm/') で解決する。
            // quickjs-eval.* は PDF 内 JavaScript の隔離実行（pdf.sandbox）用で本拡張は使わないため除外する
            from: 'node_modules/pdfjs-dist/wasm',
            to: 'wasm',
            globOptions: { ignore: ['**/quickjs-eval.js', '**/quickjs-eval.wasm'] },
          },
          {
            // 標準 14 フォント（非埋め込み PDF 用）
            from: 'node_modules/pdfjs-dist/standard_fonts',
            to: 'standard_fonts',
          },
          {
            // 既定 ICC プロファイル（qcms）
            from: 'node_modules/pdfjs-dist/iccs',
            to: 'iccs',
          },
        ],
      }),
    ],
  };
};
