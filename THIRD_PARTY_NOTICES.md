# サードパーティライセンス表記

## 配布物（拡張パッケージ）に同梱されるライブラリ

現時点（スケルトン段階）で拡張パッケージに同梱される第三者ライブラリはありません。

今後の実装で以下の同梱を予定しています（追加時に本ファイルへライセンス全文または参照を追記します）:

| ライブラリ | 用途 | ライセンス |
|---|---|---|
| pdfjs-dist 6.5.438 | PDF 描画・テキスト層（legacy 本体・worker、CMap・標準フォント・wasm・ICC を同梱） | Apache-2.0（同梱資産の表記は下記） |
| mammoth | docx パース（プロトコル入力） | BSD-2-Clause |
| zod | AI 出力のランタイムバリデーション | MIT |

pdfjs-dist の画像デコーダ・色変換のライセンス表記は配布物の `wasm/LICENSE_*`、標準フォントは `standard_fonts/LICENSE_*`、CMap は `cmaps/LICENSE`、ICC プロファイル（CC0-1.0）は `iccs/LICENSE` に同梱しています。

## 開発時のみ使用するツール（配布物に含まれない）

webpack / ts-loader / copy-webpack-plugin / dotenv / jest / ts-jest / jest-environment-jsdom / Playwright / axe-core / ESLint / stylelint / Prettier / TypeScript（それぞれ MIT / Apache-2.0 系ライセンス）。
