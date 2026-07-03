// webpack ビルド設定（docs/architecture.md §3）
// - 4 エントリ（service-worker / popup / app / options）を dist/ へビルド
// - HTML / CSS / manifest / _locales / icons は copy-webpack-plugin で転写
// - manifest.json の __OAUTH_CLIENT_ID__ を .env の値で置換。dev ビルドは拡張名に (dev) を付与
require('dotenv').config();
const path = require('path');
const CopyWebpackPlugin = require('copy-webpack-plugin');

module.exports = (_env, argv) => {
  const isProduction = argv && argv.mode === 'production';
  const clientId =
    (!isProduction && process.env.LOCAL_OAUTH_CLIENT_ID) || process.env.OAUTH_CLIENT_ID || '';

  const transformManifest = (content) => {
    const manifest = JSON.parse(content.toString());
    if (!isProduction) {
      manifest.name = `${manifest.name} (dev)`;
    }
    return JSON.stringify(manifest, null, 2).replace('__OAUTH_CLIENT_ID__', clientId);
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
        ],
      }),
    ],
  };
};
