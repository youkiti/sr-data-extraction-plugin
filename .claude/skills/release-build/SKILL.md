---
name: release-build
description: Chrome Web Store 提出用のリリースビルドと zip 作成。version バンプ → 本番ビルド → `npm run pack:release`（過去 zip 削除・key 除去・zip 化・検証を自動実行）→ 提出。「リリースビルド」「ストア用 zip」「提出用パッケージ」「Store 更新」で使用。
---

# リリースビルド（Chrome Web Store 提出用 zip 作成）

Chrome Web Store へ提出・更新する zip を作る手順。**Store は manifest に `key` フィールドがあると拒否する**（2026-07-10 の初回提出で実証）ため、提出時だけ `key` を除去する。拡張 ID の固定は初回アップロード時の `key.pem` 同梱で達成済み。

パッケージング（key 除去・zip 化・検証）は [`tools/release/pack.ps1`](../../../tools/release/pack.ps1) に実装済みで、`npm run pack:release` で実行する。**検証 NG なら非 0 終了する**ので、壊れた提出物は作られない。人間が判断するのは手順 0（前提チェック）と手順 3（提出）だけ。

## 前提知識

- `src/manifest.json` の `key` は **dev（未パック読込）用に必須なので削除しない**。除去は提出用ステージングでのみ行う。
- 拡張 ID: `ibpbkgffgkmdmflamhadbcfjgfljjgip`（`key` / `key.pem` から決定的に導出。GCP の **Web アプリケーション型 OAuth クライアント**〔issue #129 で Chrome 拡張機能タイプから移行〕のリダイレクト URI `https://<拡張ID>.chromiumapp.org/` と一致していること）。
- 秘密鍵: `C:\Users\youki\codes\keys\sr-data-extraction-plugin-ext-key.pem`（**リポジトリ外・絶対にコミットや zip 以外へコピーしない**）。
  - **初回アップロードのみ** zip ルートへ `key.pem` として同梱する（Store が同じ拡張 ID を導出するため）。**初回提出は 2026-07-10 に完了済みなので、以後の更新では同梱しない**。
- OAuth クライアント ID は manifest ではなく**コードへ注入**される: 本番ビルドは `.env` の `WEBAUTH_CLIENT_ID` **のみ**を読み、DefinePlugin の `__WEBAUTH_CLIENT_ID__` として service worker の認証ブローカーへ入る（`LOCAL_WEBAUTH_CLIENT_ID` は dev 優先用。webpack.config.js 参照）。本番で未設定なら webpack が**エラーで停止する**ので、壊れた提出物は作れない。
- manifest に `oauth2` セクションは**無いのが正常形**（launchWebAuthFlow 移行後。スコープ `userinfo.email` + `drive.file` は認証ブローカー `src/background/authBroker.ts` の `OAUTH_SCOPES` が要求する）。
- `release/` は gitignore 済み。**過去のビルドは残さない**（`pack:release` が実行のたび `release/*.zip` を全削除してから作り直す。dev zip も対象）。手元の zip は常に最新の提出物 1 つだけになる。
- version は **`src/manifest.json` / `package.json` / `package-lock.json` の 3 箇所**を揃える。`pack:release` が不一致を検出して止める。

## 手順

### 0. 前提チェック

1. `master` が最新で、リリース対象の変更がすべてマージ済みであることを確認する。
2. **version バンプ**: `src/manifest.json` / `package.json` / `package-lock.json` の `version` を**3 箇所とも**上げる（Store は既存と同じ version の再アップロードを拒否する。初回 = 0.1.0）。lock は手で書かず `npm install --package-lock-only` で追随させる。バンプは変更なのでブランチ + PR を経由する（作業原則 1）。
3. `.env` に `WEBAUTH_CLIENT_ID` が設定されていることを確認する（値は出力しない。キー名の存在確認のみ）:
   ```bash
   grep -c '^WEBAUTH_CLIENT_ID=.' .env   # 1 なら OK
   ```
4. テスト・lint が通っていること（`npm run typecheck` / `npm test` / `npm run lint` / `npm run lint:css`。CI green の master ならスキップ可）。
5. `hosted/picker.html` に変更が入ったリリースなら、gh-pages のデプロイ版が最新であることを確認する（新拡張は nonce echo を必須検証するため、古いページのままだと Picker 付与が失敗する。手順: hosted/README.md）:
   ```bash
   curl -s https://youkiti.github.io/sr-data-extraction-plugin/picker.html | grep -oE '[0-9]{4}-[0-9]{2}-[0-9]{2}[a-z]?'
   # 出力されたバージョンコメントが src 側 hosted/picker.html の最新コメントと一致すること
   ```

### 1. 本番ビルド

```bash
npm run build
```

既知の警告: PDF.js / mermaid のバンドルサイズ performance 警告のみ。それ以外の WARNING / ERROR が出たら停止して報告。

### 2. パッケージング + 検証

```bash
npm run pack:release
```

`release/sr-data-extraction-plugin-<version>.zip` が出来る。スクリプトが順に実行するのは:

1. **dist の事前検証** — 本番ビルドか（`name` に `(dev)` が無い）/ version が 3 ファイルで一致 / `oauth2` セクション不在 / `__WEBAUTH_CLIENT_ID__` のプレースホルダ残存なし・実 client_id 注入済み
2. **`release/*.zip` を全削除** — 過去ビルドは残さない
3. **ステージング + `key` 除去** — manifest は生テキストから `key` 行だけを削る（`ConvertTo-Json` 再シリアライズによる配列・順序の破損を避けるため）
4. **zip 化**
5. **zip を展開し直して検証** — `manifest.json` がルートにある / `key` フィールド無し / **key 以外が dist と完全一致**（破損検知）/ `key.pem` 未同梱 / 同梱物（`_locales` `app` `background` `cmaps` `icons` `options` `popup` `styles` `pdf.worker.min.mjs`）/ zip 内も client_id 注入済み

**1 つでも NG なら非 0 終了する**。全行 `OK` で終わったら手順 3 へ。NG が出たら落とし穴の表を見る。

- 1 の事前検証で止まった場合は `release/` に一切手を付けていないので、既存 zip は失われない。
- 4 以降（zip 検証）で止まった場合は作りかけの zip が `release/` に残る。**その zip は提出しない**。原因を直して再実行すれば作り直される。

初回アップロードのときだけ `key.pem` を同梱する（Store に同じ拡張 ID を導出させるため。**初回提出は 2026-07-10 に完了済みなので通常は不要**）:

```bash
pwsh -NoProfile -File tools/release/pack.ps1 -IncludeKeyPem
```

### 3. 提出

- https://chrome.google.com/webstore/devconsole でアイテムを開き、新しい zip をアップロード → 審査へ提出。
- 掲載メタ情報・権限の使用理由・単一用途の原稿は [docs/store/README.md](../../../docs/store/README.md) と [docs/store/permissions-justification.md](../../../docs/store/permissions-justification.md) が正典。
- 「リモートコードを使用していますか」→ **いいえ**（全 script はローカルバンドル。Picker の Google JS は youkiti.github.io 側 = 拡張パッケージ外で実行）。
- 提出後、掲載ページの拡張 ID が `ibpbkgffgkmdmflamhadbcfjgfljjgip` と一致することを確認する。

## 落とし穴（過去の実績）

| 症状 | 原因と対処 |
|---|---|
| 「マニフェストでは key フィールドを使用できません」 | manifest から `key` を除去し忘れ。`npm run pack:release` を通していれば起きない（zip 検証が止める） |
| `dist が dev ビルドです` で停止 | 直前に `npm run dev` / `npm run watch` を回して dist が dev のまま。`npm run build` からやり直す |
| ビルドが `WEBAUTH_CLIENT_ID が未設定です` で停止 | `.env` の `WEBAUTH_CLIENT_ID` 未設定（`LOCAL_WEBAUTH_CLIENT_ID` だけでは production に入らない）。手順 0-3 を確認して 1 をやり直す。※旧 `OAUTH_CLIENT_ID`（getAuthToken 時代）は issue #129 で廃止済みで、いくら設定しても読まれない |
| `package.json の version が manifest と一致しません` で停止 | 3 箇所のバンプ漏れ。手順 0-2 |
| `manifest の key 行を一意に特定できません` で停止 | dist/manifest.json の整形が変わった（webpack の `transformManifest` は `JSON.stringify(manifest, null, 2)` 前提でトップレベルのインデントは半角 2 個）。webpack.config.js の変更を確認し、必要なら `tools/release/pack.ps1` の `$keyLinePattern` を追随させる |
| 同じ version でアップロード拒否 | version バンプ忘れ。手順 0-2 |
| 拡張 ID が変わった | 初回アップロードで `key.pem` を同梱し忘れた場合に起こる（初回は完了済みのため通常は起こらない）。GCP の OAuth クライアント設定と突き合わせて報告 |
