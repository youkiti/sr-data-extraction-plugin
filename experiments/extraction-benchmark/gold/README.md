# gold/ — ゴールドスタンダード正解表

- JSON スキーマ・作成規約は **README.md §6.3 が正典**（本ディレクトリでは複製しない）。
- `gold/{pdf_id}.json` を 1 論文 1 ファイルで置く。本ベンチマークの対象は `gold/udca.json` と `gold/thermocov.json` の 2 本（README.md §6.1）。
- 作成後は `npm run validate-gold` でフォーマットを検証すること（`src/validateGold.ts`）。違反があれば行番号付きで一覧表示される。
