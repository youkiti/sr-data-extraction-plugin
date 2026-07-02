# hosted/ — Drive Picker ホストページ

MV3 の remote hosted code 制約により、Google Picker（`apis.google.com/js/api.js`）は拡張ページで
読み込めない。そのため [picker.html](picker.html) を **HTTPS でホストして新規タブで開く**方式を採る
（プロトコルの正典は [src/lib/google/picker.ts](../src/lib/google/picker.ts) 冒頭コメント）。

## デプロイ手順（アルファ配布時）

1. GCP コンソールで **Google Picker API** を有効化し、ブラウザ用 API キーを発行する
2. `picker.html` 内の `__PICKER_API_KEY__`（API キー）と `__PICKER_APP_ID__`（GCP プロジェクト番号）を実値に書き換える
3. GitHub Pages（`https://youkiti.github.io/sr-data-extraction-plugin/picker.html`）へ配置する

デプロイ先 URL を変える場合は次の 2 箇所を一緒に直すこと:

- `src/lib/google/picker.ts` の `PICKER_PAGE_URL`
- `src/manifest.json` の `externally_connectable.matches`
