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

  // dev ビルドで拡張名・ヘッダー・タブタイトルへ付けるサフィックス（本番は空文字）。
  // manifest 名と画面表示（build-info.ts の withDevSuffix）の唯一の定義元
  const devNameSuffix = isProduction ? '' : ' (dev)';

  const transformManifest = (content) => {
    const manifest = JSON.parse(content.toString());
    manifest.name = `${manifest.name}${devNameSuffix}`;
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
