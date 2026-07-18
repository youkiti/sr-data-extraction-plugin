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

## ページ先行デプロイの原則 + page_version ハンドシェイク（issue #141）

`picker.html` と拡張はメッセージプロトコルで結合しているため、**プロトコルを拡張する変更は
必ず本ページを先にデプロイしてから拡張をリリースする**（ページが未対応のまま新拡張が先に
出回ると、ready 応答の形が合わずに壊れる）。

この原則を機械的に強制するため、ページは ready メッセージへ `page_version`（整数。現在値は
`picker.html` 内の `PAGE_VERSION` 定数）を含めて送る。拡張は files モード（下記「プロジェクト
ファイル許可モード」）でこの値を検査し、拡張が要求する最低版数に届かない場合（`page_version`
が無い旧ページ、または値が古い場合）は **OAuth トークンを渡さずに** 明示エラー
（「Picker ページの更新がまだ反映されていません。数分待ってからもう一度お試しください」）を出す。
spreadsheet / pdf モードは `page_version` を検査しない（ready 応答は従来どおり `{ token }` のみで
足りるため、旧ページでも動く）。

`PAGE_VERSION` を上げる変更（= ready 応答の形やプロトコルを拡張側が要求するように変える変更）を
行うときは、本ページのデプロイ → 拡張の `minPageVersion` 引き上げ → 拡張リリース、の順を守ること。

## スプレッドシート許可モード（issue #130・要再デプロイ）

`picker.html` は URL フラグメントの `view=spreadsheet` で**共有スプレッドシートの drive.file
許可モード**になる（S1「既存 ID で開く」のアクセス拒否時と、メインビュー再入場時の誘導が使う）:

- `file_id=<スプレッドシート ID>` があれば `setFileIds` で対象シートだけを表示する。
  **setFileIds は表示フィルタであり事前フォーカスではない** — Drive 側で共有されていない
  シートは表示されないため、ページに「Drive で共有を確認」の注意書きと
  「すべてのスプレッドシートから選ぶ」フォールバックリンクを常設している
- `nonce=<乱数>` を受け取ったら全メッセージ（ready / picked / cancelled）へ echo する。
  拡張側はこの echo と `sender.url` を照合してからトークンを応答する（トークン受け渡し境界の防御）。
  旧拡張は nonce を付けてこないため echo しない（後方互換）。**逆に新拡張は echo を必須検証する
  ため、拡張のリリース前に本ページを先行デプロイすること**

## プロジェクトファイル許可モード（issue #139・要再デプロイ）

`picker.html` は URL フラグメントの `view=files` で **reviewer オンボーディングのファイル許可
モード**になる（Home の「プロジェクトファイルへのアクセスを付与」が使う）:

- 対象ファイル ID（Documents タブ由来の PDF + 抽出テキスト）を `setFileIds` で列挙する。
  抽出テキストを含むため mime フィルタは掛けない。ユーザーには **全選択**してもらい、
  ファイル単位で drive.file を付与する
- ID 一覧は **ready 応答（`sendMessage` のコールバックで受け取る `response.file_ids`）経由**で
  渡す（issue #141）。新拡張は URL フラグメントへ `file_ids` を載せない — 数百文献規模だと
  URL / Picker 内部リクエストの実用上限に当たり得るうえ、ID 一覧をブラウザ履歴に残さないため。
  旧拡張との後方互換として、`response.file_ids` が無いときは従来どおりフラグメントの
  `file_ids=<カンマ区切りのファイル ID>` を使う
- この方式を採るのは、**他人所有の共有フォルダでは Picker のフォルダ選択が配下ファイルに
  drive.file の読み取りを付与しない**ことが実機で確定したため（issue #62 / #139。
  自分所有フォルダの直下列挙〔下記「フォルダ単位の取り込み」〕は引き続き成立する）

## デプロイ手順（更新時）

1. `picker.html` の HTML 冒頭コメントの `version:` を更新日に書き換える（デプロイ版の識別用）
2. `gh-pages` ブランチの `picker.html` を本ファイルの内容で上書きして push
3. デプロイ後、`https://youkiti.github.io/sr-data-extraction-plugin/picker.html` をブラウザで開き、
   ページソースの `version:` コメントが一致することを確認する

## フォルダ単位の取り込み（要再デプロイ）

`picker.html` はマイドライブビューで `setSelectFolderEnabled(true)` を有効化し、PDF に加えて
**フォルダそのものを選択**できる。選択結果の各 doc には `mimeType` を含めて拡張へ返し、拡張は
フォルダ（`application/vnd.google-apps.folder`）なら [drive.ts](../src/lib/google/drive.ts) の
`listFolderPdfs` で直下 PDF を列挙して一括取り込みする（`drive.file` スコープでも選択フォルダ配下は
列挙できる。ただし実機で成立を確認できているのは**自分所有フォルダ**のケースのみ。他人所有の
共有フォルダでは配下ファイルへの付与が効かない — issue #139 のファイル許可モードを使うこと）。この挙動を有効にするには **本ページを GitHub Pages へ再デプロイ**する必要がある
（旧ページのままだと `mimeType` が返らず、フォルダ選択が効かない＝従来どおり個別ファイルのみ）。

## 実機での動作確認

デプロイ後の実機確認手順（チェックリスト + トラブルシューティング）は
[docs/manual-testing.md](../docs/manual-testing.md) を参照。
