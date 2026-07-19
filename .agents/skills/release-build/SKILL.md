---
name: release-build
description: Chrome Web Store 提出用のリリースビルドと zip 作成。本番ビルド → manifest から key 除去 → （初回のみ key.pem 同梱）→ release/ に zip 化 → 検証まで。「リリースビルド」「ストア用 zip」「提出用パッケージ」「Store 更新」で使用。
---

# リリースビルド（Chrome Web Store 提出用 zip 作成）

Chrome Web Store へ提出・更新する zip を作る手順。**Store は manifest に `key` フィールドがあると拒否する**（2026-07-10 の初回提出で実証）ため、提出時だけ `key` を除去する。拡張 ID の固定は初回アップロード時の `key.pem` 同梱で達成済み。

## 前提知識

- `src/manifest.json` の `key` は **dev（未パック読込）用に必須なので削除しない**。除去は提出用ステージングでのみ行う。
- 拡張 ID: `ibpbkgffgkmdmflamhadbcfjgfljjgip`（`key` / `key.pem` から決定的に導出。GCP の OAuth クライアント〔Chrome 拡張機能タイプ〕のアイテム ID と一致していること）。
- 秘密鍵: `C:\Users\youki\codes\keys\sr-data-extraction-plugin-ext-key.pem`（**リポジトリ外・絶対にコミットや zip 以外へコピーしない**）。
  - **初回アップロードのみ** zip ルートへ `key.pem` として同梱する（Store が同じ拡張 ID を導出するため）。**初回提出は 2026-07-10 に完了済みなので、以後の更新では同梱しない**。
- 本番ビルドは `.env` の `OAUTH_CLIENT_ID` **のみ**を読む（`LOCAL_OAUTH_CLIENT_ID` は dev 専用。webpack.config.js 参照）。未設定だと client_id が空になり OAuth が壊れた提出物ができる。
- `release/` は gitignore 済み。

## 手順

### 0. 前提チェック

1. `master` が最新で、リリース対象の変更がすべてマージ済みであることを確認する。
2. **version バンプ**: `src/manifest.json` の `version` を上げる（Store は既存と同じ version の再アップロードを拒否する。初回 = 0.1.0）。バンプは変更なのでブランチ + PR を経由する（作業原則 1）。
3. `.env` に `OAUTH_CLIENT_ID` が設定されていることを確認する（値は出力しない。キー名の存在確認のみ）:
   ```bash
   grep -c '^OAUTH_CLIENT_ID=.' .env   # 1 なら OK
   ```
4. テスト・lint が通っていること（`npm run typecheck` / `npm test` / `npm run lint` / `npm run lint:css`。CI green の master ならスキップ可）。

### 1. 本番ビルド

```bash
npm run build
```

既知の警告: PDF.js バンドルサイズの performance 警告のみ。それ以外の WARNING / ERROR が出たら停止して報告。

### 2. dist/manifest.json の検証

以下をすべて確認（1 つでも NG なら停止）:

- `oauth2.client_id` が実値（`__OAUTH_CLIENT_ID__` や空文字でない）
- `name` に `(dev)` サフィックスがない（= production ビルド）
- `version` が意図した値
- `oauth2.scopes` が `spreadsheets` + `drive.file` の 2 つのみ

### 3. ステージング + zip 化（PowerShell）

```powershell
Set-Location c:\Users\youki\codes\sr-data-extraction-plugin
$stage = "release\stage"
if (Test-Path $stage) { Remove-Item $stage -Recurse -Force }
Copy-Item dist $stage -Recurse

# manifest から key を除去（Store は key を拒否する）
$m = Get-Content "$stage\manifest.json" -Raw | ConvertFrom-Json
$m.PSObject.Properties.Remove('key')
$m | ConvertTo-Json -Depth 10 | Set-Content "$stage\manifest.json" -Encoding utf8NoBOM

# ★初回アップロードのときだけ（通常の更新ではこの行を実行しない）
# Copy-Item "C:\Users\youki\codes\keys\sr-data-extraction-plugin-ext-key.pem" "$stage\key.pem"

$version = $m.version
$zip = "release\sr-data-extraction-plugin-$version.zip"
if (Test-Path $zip) { Remove-Item $zip -Force }
Compress-Archive -Path "$stage\*" -DestinationPath $zip
Remove-Item $stage -Recurse -Force
Get-Item $zip
```

### 4. zip の検証

zip を開いて以下を確認（1 つでも NG なら停止）:

- `manifest.json` が **zip のルート**にある（`dist/manifest.json` のような入れ子は NG）
- manifest に `key` フィールドが**ない**
- `oauth2.client_id` が実値のまま（ConvertTo-Json での破損がないこと。scopes / permissions / host_permissions / externally_connectable も目視）
- 更新提出なら `key.pem` が**入っていない**こと（初回のみ同梱）
- 同梱物: `_locales` / `app` / `background` / `options` / `popup` / `icons` / `pdf.worker.min.mjs` / `styles`

### 5. 提出

- https://chrome.google.com/webstore/devconsole でアイテムを開き、新しい zip をアップロード → 審査へ提出。
- 掲載メタ情報・権限の使用理由・単一用途の原稿は [docs/store/README.md](../../../docs/store/README.md) と [docs/store/permissions-justification.md](../../../docs/store/permissions-justification.md) が正典。
- 「リモートコードを使用していますか」→ **いいえ**（全 script はローカルバンドル。Picker の Google JS は youkiti.github.io 側 = 拡張パッケージ外で実行）。
- 提出後、掲載ページの拡張 ID が `ibpbkgffgkmdmflamhadbcfjgfljjgip` と一致することを確認する。

## 落とし穴（過去の実績）

| 症状 | 原因と対処 |
|---|---|
| 「マニフェストでは key フィールドを使用できません」 | manifest から `key` を除去し忘れ。手順 3 をやり直す |
| OAuth が `bad client id` で失敗する提出物 | `.env` の `OAUTH_CLIENT_ID` 未設定のままビルドした（`LOCAL_OAUTH_CLIENT_ID` だけでは production に入らない）。手順 0-3 → 1 をやり直す |
| 同じ version でアップロード拒否 | `src/manifest.json` の version バンプ忘れ。手順 0-2 |
| 拡張 ID が変わった | 初回アップロードで `key.pem` を同梱し忘れた場合に起こる（初回は完了済みのため通常は起こらない）。GCP の OAuth クライアント設定と突き合わせて報告 |
