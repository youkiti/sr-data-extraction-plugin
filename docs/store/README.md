# Chrome ウェブストア 提出物一式（docs/store/）

タスク E（[remaining-work-plan.md](../remaining-work-plan.md) タスク E）の提出物置き場。**Chrome Web Store の限定公開（unlisted）** での掲載を前提にまとめる。

## このフォルダの中身

| ファイル | 用途 | 状態 |
|---|---|---|
| [privacy-policy.md](privacy-policy.md) | プライバシーポリシー（審査必須。公開 URL が要る → 下記参照） | ✅ 原稿完成 |
| [permissions-justification.md](permissions-justification.md) | 各権限の使用理由（審査フォームへ貼り付け。日英併記） | ✅ 原稿完成 |
| （スクリーンショット） | ストア掲載画像（1280×800 または 640×400、最低 1 枚） | ⬜ 未取得（下記「必要な画像」） |

## ストア掲載メタ情報（登録フォームへ入力）

- **名称**: SR Data Extraction
- **概要（日本語・132 字以内）**: SR のデータ抽出工程を支援する拡張。AI 事前抽出 + 根拠ハイライト + 人間検証 + CSV エクスポート。
  - （出典: [src/_locales/ja/messages.json](../../src/_locales/ja/messages.json) の `appDescription`）
- **カテゴリ**: 仕事効率化（Productivity）
- **言語**: 日本語（`default_locale: "ja"`）
- **公開範囲**: 限定公開（unlisted）— リンクを知っている人のみインストール可
- **プライバシーポリシー URL**: privacy-policy.md を公開ページ化して指定する。案: GitHub のファイル URL（`https://github.com/youkiti/sr-data-extraction-plugin/blob/master/docs/store/privacy-policy.md`）をそのまま指定するか、既存の GitHub Pages（`youkiti.github.io`）配下へ HTML 化して置く。

## 必要な画像（未取得 — 実機での取得が必要）

Chrome ウェブストアの掲載に必要な画像。**スクリーンショットは実データを含めない**（テスト用プロジェクトで撮る）。

| 画像 | 仕様 | 推奨内容 |
|---|---|---|
| ストアアイコン | 128×128 PNG | 既存の [src/icons/icon128.png](../../src/icons/icon128.png) を流用可 |
| スクリーンショット | 1280×800 または 640×400、最低 1 枚（最大 5 枚） | S3 ドキュメント取り込み / S5 スキーマ / S8 検証（ハイライト付き PDF）/ S9 ダッシュボード / S10 エクスポート |
| 小型プロモタイル（任意） | 440×280 PNG | 限定公開では必須ではない |

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

- [x] 本番ビルド `npm run build` が通る（2026-07-06 確認。PDF.js バンドルサイズの performance 警告のみ）
- [x] manifest の permissions / OAuth スコープが requirements.md §6 と一致（→ [manifest レビュー結果](#manifest-レビュー結果)）
- [x] プライバシーポリシー原稿
- [x] 権限の使用理由原稿（日英）
- [ ] スクリーンショット取得（実機・要ユーザー作業）
- [ ] `npm run build` の `dist/` をクリーンな Chrome プロファイルで読み込み S1→S10 smoke（manual-testing.md 流用・要ユーザー作業）
- [ ] Chrome ウェブストア デベロッパーアカウントで限定公開提出（要ユーザー作業）

## manifest レビュー結果

[src/manifest.json](../../src/manifest.json) を requirements.md §6 と照合した結果（タスク E-3）。

- **OAuth スコープ**: `spreadsheets` + `drive.file` のみ。requirements.md §6 と一致。✅
- **permissions**: `identity` / `identity.email` / `storage` / `tabs` — いずれも [permissions-justification.md](permissions-justification.md) で説明済み。余計な権限なし。✅
- **host_permissions**: Sheets / Google APIs / Gemini / OpenRouter の 4 つ。すべて BYOK の API 通信 or Google API で正当。✅
- **`key` フィールドの扱い（提出前に確認）**: manifest 先頭の `"key"` は拡張 ID を固定するためのもの。**この `key` を提出パッケージにも残すのが推奨**。理由は、拡張 ID = OAuth クライアントの許可対象なので、`key` を残して dev と Store で拡張 ID を一本化すれば、OAuth クライアント設定を 2 系統面倒見なくて済む（remaining-work-plan.md タスク E の採用理由そのもの）。
  - Picker への影響は**なし**: picker.html は接続元の拡張 ID を URL パラメータ `extension_id` から動的に受け取る（[hosted/picker.html](../../hosted/picker.html) L46）ため、拡張 ID が変わっても `externally_connectable.matches`（`youkiti.github.io`）さえ合っていれば動く。
  - **提出前の要確認事項**: GCP の OAuth クライアント（Chrome アプリ種別）の「アプリケーション ID」が、この `key` から導出される拡張 ID と一致していること。一致していないと OAuth 同意画面が拒否される。ストア掲載後に表示される実際の拡張 ID とも突き合わせる。
