---
name: release-build
description: Chrome Web Store 提出用のリリースビルドと zip 作成。本番ビルド → manifest から key 除去 → （初回のみ key.pem 同梱）→ release/ に zip 化 → 検証まで。「リリースビルド」「ストア用 zip」「提出用パッケージ」「Store 更新」で使用。
---

# リリースビルド（Chrome Web Store 提出用 zip 作成）

Chrome Web Store へ提出・更新する zip を作る手順。**Store は manifest に `key` フィールドがあると拒否する**（2026-07-10 の初回提出で実証）ため、提出時だけ `key` を除去する。拡張 ID の固定は初回アップロード時の `key.pem` 同梱で達成済み。

## 前提知識

- `src/manifest.json` の `key` は **dev（未パック読込）用に必須なので削除しない**。除去は提出用ステージングでのみ行う。
- 拡張 ID: `ibpbkgffgkmdmflamhadbcfjgfljjgip`（`key` / `key.pem` から決定的に導出。GCP の **Web アプリケーション型 OAuth クライアント**〔issue #129 で Chrome 拡張機能タイプから移行〕のリダイレクト URI `https://<拡張ID>.chromiumapp.org/` と一致していること）。
- 秘密鍵: `C:\Users\youki\codes\keys\sr-data-extraction-plugin-ext-key.pem`（**リポジトリ外・絶対にコミットや zip 以外へコピーしない**）。
  - **初回アップロードのみ** zip ルートへ `key.pem` として同梱する（Store が同じ拡張 ID を導出するため）。**初回提出は 2026-07-10 に完了済みなので、以後の更新では同梱しない**。
- OAuth クライアント ID は manifest ではなく**コードへ注入**される: 本番ビルドは `.env` の `WEBAUTH_CLIENT_ID` **のみ**を読み、DefinePlugin の `__WEBAUTH_CLIENT_ID__` として service worker の認証ブローカーへ入る（`LOCAL_WEBAUTH_CLIENT_ID` は dev 優先用。webpack.config.js 参照）。本番で未設定なら webpack が**エラーで停止する**ので、壊れた提出物は作れない。
- manifest に `oauth2` セクションは**無いのが正常形**（launchWebAuthFlow 移行後。スコープ `userinfo.email` + `drive.file` は認証ブローカー `src/background/authBroker.ts` の `OAUTH_SCOPES` が要求する）。
- `release/` は gitignore 済み。

## 手順

### 0. 前提チェック

1. `master` が最新で、リリース対象の変更がすべてマージ済みであることを確認する。
2. **version バンプ**: `src/manifest.json` の `version` を上げる（Store は既存と同じ version の再アップロードを拒否する。初回 = 0.1.0）。バンプは変更なのでブランチ + PR を経由する（作業原則 1）。
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

既知の警告: PDF.js バンドルサイズの performance 警告のみ。それ以外の WARNING / ERROR が出たら停止して報告。

### 2. dist/manifest.json の検証

以下をすべて確認（1 つでも NG なら停止）:

- `name` に `(dev)` サフィックスがない（= production ビルド）
- `version` が意図した値
- `oauth2` セクションが**存在しない**（launchWebAuthFlow 移行後の正常形。あったら移行前の残骸なので停止）
- client_id がコードへ注入されていること:
  ```bash
  grep -rc '__WEBAUTH_CLIENT_ID__' dist/ | grep -v ':0'   # 何も出なければ OK（プレースホルダ残存なし）
  grep -c 'apps\.googleusercontent\.com' dist/background/service-worker.js   # 1 以上なら OK（実値が入っている）
  ```

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
- ConvertTo-Json での破損がないこと（`permissions` / `host_permissions` / `optional_host_permissions` / `externally_connectable` / `background` を目視。client_id は manifest ではなく `background/service-worker.js` 内なので、手順 2 と同じ grep を zip 展開先でも実行して確認）
- 更新提出なら `key.pem` が**入っていない**こと（初回のみ同梱）
- 同梱物: `_locales` / `app` / `background` / `cmaps` / `options` / `popup` / `icons` / `pdf.worker.min.mjs` / `styles`（`cmaps` は和文 PDF 用 CMap。issue #95 で同梱）

### 5. 提出

- https://chrome.google.com/webstore/devconsole でアイテムを開き、新しい zip をアップロード → 審査へ提出。
- 掲載メタ情報・権限の使用理由・単一用途の原稿は [docs/store/README.md](../../../docs/store/README.md) と [docs/store/permissions-justification.md](../../../docs/store/permissions-justification.md) が正典。
- 「リモートコードを使用していますか」→ **いいえ**（全 script はローカルバンドル。Picker の Google JS は youkiti.github.io 側 = 拡張パッケージ外で実行）。
- 提出後、掲載ページの拡張 ID が `ibpbkgffgkmdmflamhadbcfjgfljjgip` と一致することを確認する。

## 落とし穴（過去の実績）

| 症状 | 原因と対処 |
|---|---|
| 「マニフェストでは key フィールドを使用できません」 | manifest から `key` を除去し忘れ。手順 3 をやり直す |
| ビルドが `WEBAUTH_CLIENT_ID が未設定です` で停止 | `.env` の `WEBAUTH_CLIENT_ID` 未設定（`LOCAL_WEBAUTH_CLIENT_ID` だけでは production に入らない）。手順 0-3 を確認して 1 をやり直す。※旧 `OAUTH_CLIENT_ID`（getAuthToken 時代）は issue #129 で廃止済みで、いくら設定しても読まれない |
| 同じ version でアップロード拒否 | `src/manifest.json` の version バンプ忘れ。手順 0-2 |
| 拡張 ID が変わった | 初回アップロードで `key.pem` を同梱し忘れた場合に起こる（初回は完了済みのため通常は起こらない）。GCP の OAuth クライアント設定と突き合わせて報告 |
