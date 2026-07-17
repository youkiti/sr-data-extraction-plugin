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

module.exports = (_env, argv) => {
  const isProduction = argv && argv.mode === 'production';
  // launchWebAuthFlow 用の Web アプリケーション型クライアント ID。
  // dev / 本番とも同一 GCP プロジェクト（hosted/picker.html の PICKER_APP_ID）で
  // 発行しないと Picker の drive.file 付与が拡張のトークンへ引き継がれない
  const webAuthClientId =
    (!isProduction && process.env.LOCAL_WEBAUTH_CLIENT_ID) || process.env.WEBAUTH_CLIENT_ID || '';
  if (isProduction && webAuthClientId === '') {
    // CI は dev ビルドしか走らないため、本番だけの設定漏れはここで止める（tiab の教訓）
    throw new Error('WEBAUTH_CLIENT_ID が未設定です（.env を確認してください）');
  }

  const transformManifest = (content) => {
    const manifest = JSON.parse(content.toString());
    if (!isProduction) {
      manifest.name = `${manifest.name} (dev)`;
    }
    return JSON.stringify(manifest, null, 2);
  };

  return {
    mode: isProduction ? 'production' : 'development',
    // MV3 の CSP は eval を許可しないため、eval 系 devtool は使わない
    devtool: isProduction ? false : 'cheap-module-source-map',
    entry: {
      'background/service-worker': './src/background/service-worker.ts',
      'popup/popup': './src/popup/popup.ts',
      'app/app': './src/app/app.ts',
      'options/options': './src/options/options.ts',
    },
    output: {
      path: path.resolve(__dirname, 'dist'),
      filename: '[name].js',
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
        __WEBAUTH_CLIENT_ID__: JSON.stringify(webAuthClientId),
      }),
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
        ],
      }),
    ],
  };
};
