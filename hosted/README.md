# hosted/ — Drive Picker ホストページ

MV3 の remote hosted code 制約により、Google Picker（`apis.google.com/js/api.js`）は拡張ページで
読み込めない。そのため [picker.html](picker.html) を **HTTPS でホストして新規タブで開く**方式を採る
（プロトコルの正典は [src/lib/google/picker.ts](../src/lib/google/picker.ts) 冒頭コメント）。

## デプロイ手順（初回セットアップ時）

1. GCP コンソールで **Google Picker API** を有効化し、ブラウザ用 API キーを発行する
2. `picker.html` 内の `__PICKER_API_KEY__`（API キー）と `__PICKER_APP_ID__`（GCP プロジェクト番号）を実値に書き換える
3. GitHub Pages（`https://youkiti.github.io/sr-data-extraction-plugin/picker.html`）へ配置する

デプロイ先 URL を変える場合は次の 2 箇所を一緒に直すこと:

- `src/lib/google/picker.ts` の `PICKER_PAGE_URL`
- `src/manifest.json` の `externally_connectable.matches`

## フォルダ単位の取り込み（要再デプロイ）

`picker.html` はマイドライブビューで `setSelectFolderEnabled(true)` を有効化し、PDF に加えて
**フォルダそのものを選択**できる。選択結果の各 doc には `mimeType` を含めて拡張へ返し、拡張は
フォルダ（`application/vnd.google-apps.folder`）なら [drive.ts](../src/lib/google/drive.ts) の
`listFolderPdfs` で直下 PDF を列挙して一括取り込みする（`drive.file` スコープでも選択フォルダ配下は
列挙できる）。この挙動を有効にするには **本ページを GitHub Pages へ再デプロイ**する必要がある
（旧ページのままだと `mimeType` が返らず、フォルダ選択が効かない＝従来どおり個別ファイルのみ）。

## 実機での動作確認

デプロイ後の実機確認手順（チェックリスト + トラブルシューティング）は
[docs/manual-testing.md](../docs/manual-testing.md) を参照。
