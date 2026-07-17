# Chrome ウェブストア 提出物一式（docs/store/）

タスク E（[remaining-work-plan.md](../remaining-work-plan.md) タスク E）の提出物置き場。**2026-07-12 に Chrome ウェブストアで v0.1.0 を一般公開済み**（[掲載ページ](https://chromewebstore.google.com/detail/sr-data-extraction-plugin/ibpbkgffgkmdmflamhadbcfjgfljjgip)。当初は限定公開〔unlisted〕を想定していたが一般公開＝検索可能で掲載した）。

## このフォルダの中身

| ファイル | 用途 | 状態 |
|---|---|---|
| [privacy-policy.md](privacy-policy.md) | プライバシーポリシー（審査必須。公開 URL が要る → 下記参照） | ✅ 原稿完成 |
| [permissions-justification.md](permissions-justification.md) | 各権限の使用理由（審査フォームへ貼り付け。日英併記） | ✅ 原稿完成 |
| [screenshots/](screenshots/) | ストア掲載画像（1280×800、最低 1 枚） | ◐ 4 枚取得済み（S3 / S5 / S8 / S9）・S10 は任意で追加可（下記「必要な画像」） |

## ストア掲載メタ情報（登録フォームへ入力）

- **名称**: SR Data Extraction
- **概要（日本語・132 字以内）**: SR のデータ抽出工程を支援する拡張。AI 事前抽出 + 根拠ハイライト + 人間検証 + CSV エクスポート。
  - （出典: [src/_locales/ja/messages.json](../../src/_locales/ja/messages.json) の `appDescription`）
- **カテゴリ**: 仕事効率化（Productivity）
- **言語**: 日本語（`default_locale: "ja"`）
- **公開範囲**: 一般公開（public）— ストア検索・リンクのどちらからでも誰でもインストール可（2026-07-12 に一般公開で掲載）
- **プライバシーポリシー URL**: privacy-policy.md を公開ページ化して指定する。案: GitHub のファイル URL（`https://github.com/youkiti/sr-data-extraction-plugin/blob/master/docs/store/privacy-policy.md`）をそのまま指定するか、既存の GitHub Pages（`youkiti.github.io`）配下へ HTML 化して置く。

## 必要な画像

Chrome ウェブストアの掲載に必要な画像。**スクリーンショットは実データを含めない**（テスト用プロジェクトで撮る）。

| 画像 | 仕様 | 状態 |
|---|---|---|
| ストアアイコン | 128×128 PNG | ✅ 既存の [src/icons/icon128.png](../../src/icons/icon128.png) を流用可 |
| スクリーンショット | 1280×800、最低 1 枚（最大 5 枚） | ◐ [screenshots/](screenshots/) に 4 枚あり（下表）。S10 エクスポートは任意で追加 |
| 小型プロモタイル（任意） | 440×280 PNG | ⬜ 掲載の必須要件ではない（未設定で一般公開済み） |

### 取得済みスクリーンショット（[screenshots/](screenshots/)）

| ファイル | 画面 | 取得方法 |
|---|---|---|
| `s3-documents.png` | S3 文献取り込み | 実機（テスト用プロジェクト、2026-07-06） |
| `s5-schema.png` | S5 スキーマ設計 | 実機（テスト用プロジェクト、2026-07-06） |
| `s8-verify-highlight.png` | S8 検証（根拠ハイライト。パイロット埋め込み検証 UI） | 実機（テスト用プロジェクト、2026-07-06） |
| `s9-dashboard.png` | S9 ダッシュボード | Playwright E2E ハーネス（スタブ状態・実データ非含有、2026-07-09） |

- いずれも 1280×800・実データ非含有。ストア掲載時はこの中から選ぶ（4〜5 枚全掲載でも可）。
- `s9-dashboard.png` は実 Google 認証を要さない E2E ハーネス（[app-dashboard.spec.ts](../../tests/e2e/app-dashboard.spec.ts) と同じ stub 状態）で描画したもの。実機（Selenium ハーネス `--shots dashboard`）で撮り直しても内容は同等。

### スクリーンショットの撮り方（Selenium ハーネス）

[tools/selenium/manualCheck.mjs](../../tools/selenium/manualCheck.mjs) に `--shots` を付けると、各シーンの要所で **1280×800 ちょうど**（CDP `Emulation.setDeviceMetricsOverride` でツールバー影響を排除）のスクショを `docs/store/screenshots/` へ保存する。実データを含めないよう、ハーネスが作るテスト用プロジェクト + fixture PDF で撮ること。

```
npm run dev
node tools/selenium/manualCheck.mjs prepare                       # 初回のみ（dist 読込 + ログイン）
node tools/selenium/manualCheck.mjs --shots login project picker schema pilot dashboard export
```

出力される 5 枚: `s3-documents.png` / `s5-schema.png` / `s8-verify-highlight.png` / `s9-dashboard.png` / `s10-export.png`。この中から掲載分を選ぶ。

クリーンな Chrome プロファイルでの dist smoke（提出前チェックの 2 番目）は `--profile` で別プロファイルを指定して通す:

```
npm run build
node tools/selenium/manualCheck.mjs --profile .selenium-profile-clean prepare
node tools/selenium/manualCheck.mjs --profile .selenium-profile-clean login project picker schema pilot extract verify dashboard export
```

## 提出前チェック（タスク E チェックリストの実行記録）

- [x] 本番ビルド `npm run build` が通る（**2026-07-09 再確認**・現行 HEAD。成果物 = manifest / background / app / options / popup / icons / pdf.worker / _locales すべて emit。PDF.js バンドルサイズの performance 警告のみ）
- [x] manifest の permissions / OAuth スコープが requirements.md §6 と一致（→ [manifest レビュー結果](#manifest-レビュー結果)）
- [x] プライバシーポリシー原稿
- [x] 権限の使用理由原稿（日英）
- [x] Playwright E2E スモーク（**2026-07-09**・`npm run test:e2e` 49 passed）。`dist/` をスタブ Chrome へ読み込み S1（popup）〜S10（export）+ Options を全ルート駆動 + axe。実 Google 認証を要さない範囲での S1→S10 通し確認に相当
- [x] スクリーンショット取得（S3 / S5 / S8 は実機・S9 は E2E ハーネス。→ [取得済みスクリーンショット](#取得済みスクリーンショットscreenshots)）
- [x] **実 Google 認証つきのクリーンな Chrome プロファイルで dist smoke**（**2026-07-10 実施**。`.env` に `OAUTH_CLIENT_ID` を設定した本番ビルドで通過）
- [x] Chrome ウェブストア デベロッパーアカウントで提出（**2026-07-10 提出**。zip 作成手順は [.claude/skills/release-build/SKILL.md](../../.claude/skills/release-build/SKILL.md)。プライバシーポリシー URL は GitHub ファイル URL 方式を採用）
- [x] **審査通過 → 2026-07-12 に v0.1.0 を一般公開**（[掲載ページ](https://chromewebstore.google.com/detail/sr-data-extraction-plugin/ibpbkgffgkmdmflamhadbcfjgfljjgip)。拡張 ID `ibpbkgffgkmdmflamhadbcfjgfljjgip` 一致確認済み。タスク E 完了）

## manifest レビュー結果

[src/manifest.json](../../src/manifest.json) を requirements.md §6 と照合した結果（タスク E-3。v0.1.0 提出時点の記録）。

> **2026-07-18 更新（issue #129）**: OAuth スコープを `userinfo.email` + `drive.file` に変更（`spreadsheets` 廃止）。認証は `launchWebAuthFlow` + Web アプリケーション型クライアントとなり、manifest の `oauth2` ブロックは削除。`host_permissions` に `https://oauth2.googleapis.com/*`（revoke 用）を追加。次回ストア提出時は下記レビューではなく requirements.md §2.1〜2.2 と permissions-justification.md の最新版を正とする。

- **OAuth スコープ**: `spreadsheets` + `drive.file` のみ。requirements.md §6 と一致。✅（→ 2026-07-18 変更。上記注記参照）
- **permissions**: `identity` / `identity.email` / `storage` / `tabs` — いずれも [permissions-justification.md](permissions-justification.md) で説明済み。余計な権限なし。✅
- **host_permissions**: Sheets / Google APIs / Gemini / OpenRouter の 4 つ。すべて BYOK の API 通信 or Google API で正当。OpenAI 互換 API は `optional_host_permissions` とし、HTTPS または限定した loopback HTTP の scheme + hostname pattern だけを実行時に要求する。✅
- **`oauth2.client_id`（提出前に必須の確認）**: `src/manifest.json` は `__OAUTH_CLIENT_ID__` プレースホルダを持ち、webpack が `.env` の `OAUTH_CLIENT_ID` で置換する（[webpack.config.js](../../webpack.config.js) L19・L26）。**`.env` 未設定でビルドすると `client_id` が空文字になり OAuth が機能しない**。提出用パッケージのビルド前に、GCP で発行した Chrome アプリ種別の OAuth クライアント ID を `.env` の `OAUTH_CLIENT_ID` に設定すること（CI / この環境のビルドは空のまま = スモーク用途。⚠️ 要ユーザー作業）。
- **`key` フィールドの扱い（2026-07-10 の初回提出で確定）**: **Chrome Web Store は manifest に `key` フィールドがあるとアップロードを拒否する**（「マニフェストでは key フィールドを使用できません」）。正しい手順は「提出用 zip では manifest から `key` を除去し、**初回アップロードのみ**対応する秘密鍵を `key.pem` として zip ルートに同梱する」— Store が key.pem から同じ拡張 ID（`ibpbkgffgkmdmflamhadbcfjgfljjgip`）を導出するため、dev と Store の ID 一本化（remaining-work-plan.md タスク E の採用理由）はこの方式で達成される。`src/manifest.json` の `key` は dev（未パック読込）用に残したまま、提出時だけステージングで除去する。手順は [.claude/skills/release-build/SKILL.md](../../.claude/skills/release-build/SKILL.md) に定型化済み。2 回目以降の更新 zip に key.pem は不要（ID はアイテムに固定済み）。秘密鍵の置き場所はリポジトリ外（コミット禁止）。
  - Picker への影響は**なし**: picker.html は接続元の拡張 ID を URL パラメータ `extension_id` から動的に受け取る（[hosted/picker.html](../../hosted/picker.html) L46）ため、拡張 ID が変わっても `externally_connectable.matches`（`youkiti.github.io`）さえ合っていれば動く。
  - **提出前の要確認事項**: GCP の OAuth クライアント（Chrome アプリ種別）の「アプリケーション ID」が、この `key` から導出される拡張 ID と一致していること。一致していないと OAuth 同意画面が拒否される。ストア掲載後に表示される実際の拡張 ID とも突き合わせる。
