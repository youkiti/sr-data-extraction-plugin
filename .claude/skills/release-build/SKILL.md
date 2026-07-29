---
name: release-build
description: Chrome Web Store 提出用のリリースビルドと zip 作成。`npm run release -- minor` 一発で 前提チェック → version バンプ → 本番ビルド → zip 化・検証 → push まで通す。「リリースビルド」「ストア用 zip」「提出用パッケージ」「Store 更新」で使用。
---

# リリースビルド（Chrome Web Store 提出用 zip 作成）

Chrome Web Store へ提出・更新する zip を作る手順。**Store は manifest に `key` フィールドがあると拒否する**（2026-07-10 の初回提出で実証）ため、提出時だけ `key` を除去する。拡張 ID の固定は初回アップロード時の `key.pem` 同梱で達成済み。

## まずこれ（通常のリリースはこの 1 行で終わる）

```bash
npm run release -- minor    # 機能追加を含む ／ patch = 修正のみ ／ major ／ 0.7.3 のような明示指定も可
```

[`tools/release/release.ps1`](../../../tools/release/release.ps1) が **前提チェック → version バンプ（3 ファイル）→ commit → `npm run build` → `pack.ps1`（key 除去・zip 化・検証）→ origin/master へ push** まで通す。所要 1 分弱。**どこかで NG が出れば非 0 終了する**ので、壊れた提出物も、検証を飛ばした push も発生しない。人間が判断するのは「どのバンプ種別か」と、出来た zip を Store へ出す（手順 3）ことだけ。

- **なぜ PR を経由しないか**: 差分が version 文字列 3 箇所だけで、直前の master が CI green であることをスクリプトが `gh run list` で機械チェックするため。**CLAUDE.md 作業原則 1（master で直接作業しない）の明示的な例外**であり、version バンプ commit にのみ適用する。機能変更を混ぜようとしても作業ツリーの汚れチェックで止まる。
- 主なオプション（`npm run release -- patch -NoPush` のように渡す）:
  - `-NoPush` — push せずローカル commit + zip まで
  - `-SkipCiCheck` — gh が無い / 未認証の環境
  - `-Force` — master 以外のブランチ・origin と不一致・CI が green でないときの停止を警告に落とす（作業ツリーの汚れチェックだけは解除されない）
  - `-IncludeKeyPem` — 初回アップロード専用（2026-07-10 に使用済み。通常は不要）
- **失敗時の後始末**: build / pack で落ちた場合、push はまだなので origin は無傷。ローカルのバンプ commit だけが残るので `git reset --hard HEAD~1` で戻せる（差分は version のみ）。

以下は、この一発コマンドが内部で何を確認しているか（＝手で追うときの手順）と、Store 提出の手順。パッケージング部分は [`tools/release/pack.ps1`](../../../tools/release/pack.ps1) 単体でも `npm run pack:release` として実行できる。

## 前提知識

- `src/manifest.json` の `key` は **dev（未パック読込）用に必須なので削除しない**。除去は提出用ステージングでのみ行う。
- 拡張 ID: `ibpbkgffgkmdmflamhadbcfjgfljjgip`（`key` / `key.pem` から決定的に導出。GCP の **Web アプリケーション型 OAuth クライアント**〔issue #129 で Chrome 拡張機能タイプから移行〕のリダイレクト URI `https://<拡張ID>.chromiumapp.org/` と一致していること）。
- 秘密鍵: `C:\Users\youki\codes\keys\sr-data-extraction-plugin-ext-key.pem`（**リポジトリ外・絶対にコミットや zip 以外へコピーしない**）。
  - **初回アップロードのみ** zip ルートへ `key.pem` として同梱する（Store が同じ拡張 ID を導出するため）。**初回提出は 2026-07-10 に完了済みなので、以後の更新では同梱しない**。
- OAuth クライアント ID は manifest ではなく**コードへ注入**される: 本番ビルドは `.env` の `WEBAUTH_CLIENT_ID` **のみ**を読み、DefinePlugin の `__WEBAUTH_CLIENT_ID__` として service worker の認証ブローカーへ入る（`LOCAL_WEBAUTH_CLIENT_ID` は dev 優先用。webpack.config.js 参照）。本番で未設定なら webpack が**エラーで停止する**ので、壊れた提出物は作れない。
- manifest に `oauth2` セクションは**無いのが正常形**（launchWebAuthFlow 移行後。スコープ `userinfo.email` + `drive.file` は認証ブローカー `src/background/authBroker.ts` の `OAUTH_SCOPES` が要求する）。
- `release/` は gitignore 済み。**過去のビルドは残さない**（`pack:release` が実行のたび `release/*.zip` を全削除してから作り直す。dev zip も対象）。手元の zip は常に最新の提出物 1 つだけになる。
- version は **`src/manifest.json` / `package.json` / `package-lock.json` の 3 箇所**を揃える。`release.ps1` が 3 箇所同時に上げ、`pack:release` が不一致を検出して止める。

## 手順

### 0. 前提チェック

`npm run release` が 1〜4 を自動で行う（NG なら停止）。手で追う場合は以下。

1. `master` が最新（`origin/master` と一致）で、リリース対象の変更がすべてマージ済みであることを確認する。
2. **version バンプ**: `src/manifest.json` / `package.json` / `package-lock.json` の `version` を**3 箇所とも**上げる（Store は既存と同じ version の再アップロードを拒否する。初回 = 0.1.0）。lock は手で書かず `npm version <new> --no-git-tag-version` で追随させる。
3. `.env` に `WEBAUTH_CLIENT_ID` が設定されていることを確認する（値は出力しない。キー名の存在確認のみ）:
   ```bash
   grep -c '^WEBAUTH_CLIENT_ID=.' .env   # 1 なら OK
   ```
4. 直前の master の CI が green であること（`gh run list --branch master --limit 5`）。ローカルで確かめるなら `npm run typecheck` / `npm test` / `npm run lint` / `npm run lint:css`。
5. **これだけは自動化されていない**: `hosted/picker.html` に変更が入ったリリースなら、gh-pages のデプロイ版が最新であることを確認する（新拡張は nonce echo を必須検証するため、古いページのままだと Picker 付与が失敗する。手順: hosted/README.md）:
   ```bash
   curl -s https://youkiti.github.io/sr-data-extraction-plugin/picker.html | grep -oE '[0-9]{4}-[0-9]{2}-[0-9]{2}[a-z]?'
   # 出力されたバージョンコメントが src 側 hosted/picker.html の最新コメントと一致すること
   ```

### 1. 本番ビルド

```bash
npm run build
```

既知の警告: PDF.js / mermaid / wasm のバンドルサイズ performance 警告のみ。それ以外の WARNING / ERROR が出たら停止して報告（`release.ps1` は `ERROR` で停止し、サイズ超過以外の `WARNING` を警告表示する）。

### 2. パッケージング + 検証

```bash
npm run pack:release
```

`release/sr-data-extraction-plugin-<version>.zip` が出来る。スクリプトが順に実行するのは:

1. **dist の事前検証** — 本番ビルドか（`name` に `(dev)` が無い）/ version が 3 ファイルで一致 / `oauth2` セクション不在 / `__WEBAUTH_CLIENT_ID__` のプレースホルダ残存なし・実 client_id 注入済み
2. **`release/*.zip` を全削除** — 過去ビルドは残さない
3. **ステージング + `key` 除去** — manifest は生テキストから `key` 行だけを削る（`ConvertTo-Json` 再シリアライズによる配列・順序の破損を避けるため）
4. **zip 化**
5. **zip を展開し直して検証** — `manifest.json` がルートにある / `key` フィールド無し / **key 以外が dist と完全一致**（破損検知）/ `key.pem` 未同梱 / 同梱物（`_locales` `app` `background` `cmaps` `icons` `options` `popup` `styles` `pdf.worker.min.mjs` `wasm` `standard_fonts` `iccs`）/ zip 内も client_id 注入済み

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
| 「マニフェストでは key フィールドを使用できません」 | manifest から `key` を除去し忘れ。`npm run release` / `npm run pack:release` を通していれば起きない（zip 検証が止める） |
| `dist が dev ビルドです` で停止 | 直前に `npm run dev` / `npm run watch` を回して dist が dev のまま。`npm run build` からやり直す |
| ビルドが `WEBAUTH_CLIENT_ID が未設定です` で停止 | `.env` の `WEBAUTH_CLIENT_ID` 未設定（`LOCAL_WEBAUTH_CLIENT_ID` だけでは production に入らない）。手順 0-3 を確認して 1 をやり直す。※旧 `OAUTH_CLIENT_ID`（getAuthToken 時代）は issue #129 で廃止済みで、いくら設定しても読まれない |
| `package.json の version が manifest と一致しません` で停止 | 3 箇所のバンプ漏れ。手順 0-2 |
| `作業ツリーが汚れています` で停止 | 未コミットの変更がある（前回の失敗で version 編集が残っている場合は `git checkout -- src/manifest.json package.json package-lock.json`）。機能変更を release コマンドで master へ持ち込ませないための停止なので、`-Force` でも解除されない |
| `master の CI がまだ実行中です` / `失敗しています` で停止 | CI の完了を待つ。急ぐなら `-Force`（自己責任）、gh が使えない環境なら `-SkipCiCheck` |
| `manifest の version 行を一意に特定できません` で停止 | `src/manifest.json` の整形が変わった（トップレベルのインデントは半角 2 個が前提）。`tools/release/release.ps1` の `$versionLinePattern` を追随させる |
| `manifest の key 行を一意に特定できません` で停止 | dist/manifest.json の整形が変わった（webpack の `transformManifest` は `JSON.stringify(manifest, null, 2)` 前提でトップレベルのインデントは半角 2 個）。webpack.config.js の変更を確認し、必要なら `tools/release/pack.ps1` の `$keyLinePattern` を追随させる |
| 同じ version でアップロード拒否 | version バンプ忘れ。手順 0-2 |
| 拡張 ID が変わった | 初回アップロードで `key.pem` を同梱し忘れた場合に起こる（初回は完了済みのため通常は起こらない）。GCP の OAuth クライアント設定と突き合わせて報告 |
