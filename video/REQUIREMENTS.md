# 操作解説動画 要件定義書

作成日: 2026-08-03
ステータス: PR1（基盤 + スモークシーン1本）完了。実チャプター（14本）・デモビルド層は後続 PR。

## 1. 背景とゴール

[ヘルプページ](https://youkiti.github.io/sr-data-extraction-plugin/help.html) の内容をもとに、
SR Data Extraction Plugin の操作解説動画を制作する。姉妹リポジトリ
[tiab-review-plugin](https://github.com/youkiti/tiab-review-plugin) で実績のある
「Playwright 収録 → VOICEVOX で TTS → ffmpeg で合成」パイプラインを移植し、本拡張向けに
適応させる（同一著者・MIT ライセンスのため移植可）。

### ゴール

1. **1本の動画を YouTube にアップロードし、各操作ごとに頭出し（チャプター）できる状態**にする
2. **機能追加に応じて随時更新が可能な状態**にする（該当セクションのみ再収録して再構成できる）

## 2. 確定した要件（tiab-review-plugin/video のヒアリング結果を踏襲）

| 項目 | 決定内容 | 理由・補足 |
| --- | --- | --- |
| 制作方式 | **実拡張を `--load-extension` + xvfb で収録**（Playwright） | 操作をシーンスクリプトとしてリポジトリ管理。機能追加時はスクリプト修正+再実行で該当シーンだけ再収録できる |
| ナレーション | **AI 音声（VOICEVOX による TTS）** | 原稿（テキスト）をリポジトリ管理し、更新時は該当部分のみ再生成 |
| 言語 | **日本語ナレーション + 英語字幕** | 動画は日本語 1 本。英語は YouTube の字幕トラック（.srt）で対応 |
| カバー範囲 | **全機能**（準備〜アウトロの全 14 チャプター、下表参照） | ヘルプページの全セクションに対応 |
| デモ環境 | **後続 PR でデモビルド層（`dist-demo/`）を追加**。本 PR（基盤）はデモビルドが無いため、素の `dist/`（プロジェクト未選択状態）で撮れるスモークシーン1本のみ | PR1 はパイプライン基盤の疎通確認が目的。実チャプターの収録にはデモ専用プロジェクト・シードデータが必要（後続 PR） |
| 動画の長さ | **標準 15〜16 分**（詳細は§3のチャプター表） | 各機能 1〜2 分半。詳細はヘルプページに誘導 |
| 更新時の公開運用 | **新規公開 + リンク自動更新** | YouTube は動画本体の差し替えが不可のため、更新のたびに新規動画を公開。`hosted/help.html` 等のリンクとチャプター情報を同じ PR で更新し、旧版は非公開化。ユーザーは常にヘルプページ経由で最新版に到達する |
| アップロード方法 | **手動アップロード** | パイプラインは「動画ファイル + チャプター付き説明文 + サムネイル」までを生成し、アップロードと公開設定は手動で実施 |

## 3. チャプター構成

ヘルプページ（`hosted/help.html`）のセクション構成に対応させる。各チャプター = 1 シーンスクリプト
= 1 ナレーション原稿。**PR1 時点ではチャプター01〜14 は未実装**（後続 PRで追加。本表は設計として先に確定させる）。

| # | チャプター | 目安 | help.html 対応 |
| --- | --- | --- | --- |
| 1 | イントロ（ツール概要・SR 3 部作での位置づけ） | 0:40 | 冒頭 |
| 2 | 準備（インストール・BYOK・ログイン） | 1:20 | `#setup` |
| 3 | プロジェクトを作る・開く | 1:00 | `#project` |
| 4 | 文献を取り込む | 1:20 | `#documents` |
| 5 | プロトコルを登録する | 0:50 | `#protocol` |
| 6 | 表のデザイン（抽出項目） | 1:40 | `#schema` |
| 7 | パイロット抽出 | 1:10 | `#pilot` |
| 8 | 一括抽出 | 1:00 | `#extract` |
| 9 | 検証（中核の工程） | 2:30 | `#verify` |
| 10 | ダッシュボード | 0:50 | `#dashboard` |
| 11 | 独立二重レビューと裁定 | 1:30 | `#dual-review` |
| 12 | エクスポート | 1:10 | `#export` |
| 13 | 設定（BYOK・接続方式・レート制限） | 0:50 | `#options` |
| 14 | アウトロ | 0:30 | — |

合計目安: 約 16 分

## 4. 制作パイプラインの構成（設計方針）

```
video/
├── REQUIREMENTS.md          # 本書
├── README.md                 # 使い方
├── scenes/                   # Playwright シーンスクリプト
│   ├── examples/00-smoke.mjs # PR1: パイプライン疎通確認用（実チャプターは後続 PR で追加）
│   └── lib/                  # gestures.mjs / pacing.mjs / cursor.mjs（共通ヘルパー）
├── narration/                 # ナレーション原稿（チャプターごとに1ファイル、日本語）
├── subtitles/                 # 英語字幕ソース（原稿から作成・レビューして確定）
├── assets/                    # サムネイル / タイトルカード / エンドカードのテンプレート
├── build/                     # 生成物（git 管理外）: シーン動画 / TTS 音声 / 最終 mp4 / chapters.txt / .srt
├── tools/                     # ffmpeg / VOICEVOX の実体（git 管理外。setup.sh が展開）
└── scripts/                   # ビルドスクリプト（収録→TTS→合成→チャプター生成）
```

### 処理フロー

1. **収録**: Playwright（`launchPersistentContext` + `--load-extension`）で拡張を読み込み、シーンごとに
   操作を実行して録画する。本拡張は `app/app.html`（hash ルーティング）・`popup/popup.html`・
   `options/options.html` の複数ページ構成のため、シーン側が `ctx.openExtensionPage()` でどのページ・
   hash を開くかを明示する（§5-2 参照）
2. **音声生成**: ナレーション原稿から VOICEVOX で音声ファイルを生成（チャプター単位）
3. **合成**: ffmpeg でシーン動画 + 音声を結合し、1 本の mp4 に連結。
   各シーンの実測尺から **YouTube 説明欄用チャプタータイムスタンプ（chapters.txt）を自動生成**
4. **字幕**: ナレーション原稿と対になる英語 .srt ソースから、タイムスタンプ付き字幕を生成
5. **アップロード（手動）**: mp4 / chapters.txt 入り説明文 / サムネイル / .srt を YouTube Studio から手動アップロード
6. **リンク更新**: 新しい動画 URL とチャプター情報を `hosted/help.html`（および必要箇所）に反映する
   PR を作成。旧動画は非公開化

### 更新ワークフロー（機能追加時）

1. 該当シーンスクリプトとナレーション原稿だけを修正
2. パイプラインを再実行（変更のないシーンは既存収録を再利用可能な設計とする）
3. 新規動画としてアップロードし、リンク更新 PR を出す

## 5. tiab-review-plugin/video からの適応点（PR1）

移植元 [tiab-review-plugin/video](https://github.com/youkiti/tiab-review-plugin/tree/main/video)
との差分。同一著者・MIT ライセンスのため実装をベースに流用しているが、本拡張固有の事情で
以下の点を変更している。

### 5-1. 収録対象ディレクトリの解決（`scripts/config.mjs`）

tiab は `dist-demo/`（デモ専用ビルド）に固定していた。本拡張はまだデモビルド層を持たないため、
`resolveExtensionDir()` 関数で **環境変数 `EXT_DIST_DIR` → `<repo>/dist-demo`（存在すれば）→
`<repo>/dist`** の優先順位で解決する。いずれも見つからなければ `npm run dev` の実行を促す
日本語エラーで落とす。デモビルド層が後続 PR で追加されれば、`dist-demo/` が自動的に優先される。

### 5-2. 拡張のページ構成（`scripts/record.mjs` の `ctx.openExtensionPage()`）

tiab はサイドパネル（`sidepanel.html`）1枚構成で、`pageQuery` オプションによる決め打ちの
goto で足りた。本拡張は
- `app/app.html` … メインビュー（hash ルーティング。`#/home` `#/documents` `#/verify` 等）
- `popup/popup.html` … プロジェクト選択
- `options/options.html` … 設定

の複数ページ構成のため、`pageQuery` 方式ではなく、シーンから
`ctx.openExtensionPage('app/app.html#/home')` のように拡張内ページを明示的に開ける API を
`RecordContext` に追加した。`ctx.newSegment(page)` / `ctx.cue(n)` / `ctx.sleep(ms)` / `ctx.page` /
`ctx.extId` は tiab と同じ契約を維持している。

### 5-3. 可視マウスカーソル（`scenes/lib/cursor.mjs`。tiab には無い新機能）

Playwright の `page.mouse.*` は CDP イベントの合成であり、画面上に実カーソルが描画されない。
操作解説動画としては致命的なため、`browserContext.addInitScript()` で全ページに擬似カーソル
DOM 要素を注入し、`mousemove` に追従・`mousedown` でリップルアニメーションを出す方式で解決した
（`cursor.mjs` 冒頭のコメントに CSP との関係を含めた詳細を記載）。

### 5-4. ffmpeg / VOICEVOX の取得元

tiab と同じ手順（`setup.sh`）を踏襲。本 PR の実行環境ではあらかじめ
`video/tools/ffmpeg-master-latest-linux64-gpl/` と `video/tools/voicevox/` に展開済みのため、
`setup.sh` はダウンロードをスキップして冪等に完走する。

### 5-5. 説明文・カード類のリンク・配色

- ヘルプ: `https://youkiti.github.io/sr-data-extraction-plugin/help.html`
- Chrome Web Store: `https://chromewebstore.google.com/detail/sr-data-extraction-plugin/ibpbkgffgkmdmflamhadbcfjgfljjgip`
- GitHub: `https://github.com/youkiti/sr-data-extraction-plugin`
- VOICEVOX クレジット表記（`ナレーション: VOICEVOX:四国めたん`）は必須のため維持
- カード類（`assets/*.html`）の配色は `hosted/style.css` のトンマナ（`--primary: #1b5e4a` /
  `--primary-light: #2f8f6d` の緑グラデーション、フォントは Hiragino Sans / Noto Sans JP 系）に
  合わせた（tiab は青系グラデーションだった）

### 5-6. スモークシーン（`scenes/examples/00-smoke.mjs`）

デモビルドが無いため、素の `dist/`（プロジェクト未選択状態）で撮れる内容にした。
`app/app.html#/home` を開いて全景 → サイドナビ（文献取り込み〜裁定）をゆっくりホバー →
ヘッダーの「ヘルプ」「設定」ボタンをホバー、という約20〜30秒・cue3本の構成。可視カーソルの
動作確認を兼ねるため、必ずマウス移動を伴う操作にしている。

## 6. 未決事項（後続 PR で決定・実装）

| 項目 | 選択肢 | 備考 |
| --- | --- | --- |
| デモビルド層（`dist-demo/`） | プロジェクト作成 + サンプル文献のシードデータを含む専用ビルド | チャプター03（プロジェクト作成）以降の収録に必要。tiab の `build:demo` 相当を本拡張向けに設計する |
| デモ専用 Google アカウント / スプレッドシート | デモ専用アカウント + デモ用プロジェクト | 個人情報の映り込みを防ぎ、常に同じ状態から再収録できるようにする |
| 実チャプター 01〜14 のシーン・原稿・字幕 | `scenes/NN-slug.mjs` として追加（`examples/00-smoke.mjs` を土台にしてよい） | 本 PR（PR1）のスコープ外 |
| デモ用サンプル PDF・プロトコル | チャプター04（文献取り込み）・05（プロトコル登録）向けに用意 | 著作権に配慮したダミー/オープンアクセス文献を選定する |

## 7. 受け入れ基準

PR1（本 PR）の受け入れ基準:

- [x] `bash video/scripts/setup.sh` が既存の ffmpeg / VOICEVOX / 起動中エンジンを検出して
      ダウンロードをスキップする（冪等）
- [x] `xvfb-run -a -s "-screen 0 1920x1080x24" node video/scripts/record.mjs 00-smoke` で
      `video/build/scenes/00-smoke/segment-0.webm` と cue 時刻入り `meta.json` が生成される
- [x] `node video/scripts/tts.mjs 00-smoke` で音声が生成され、2 回目の実行ではハッシュ一致で
      スキップされる
- [x] `node video/scripts/assemble.mjs` で `video/build/final.mp4` 等の生成物一式が
      h264 + aac / 1920x1080 / 30fps で生成される
- [x] 可視カーソルが `final.mp4` に実際に映っている（PNG 切り出しで目視確認済み）
- [x] 既存 CI 相当（typecheck / lint / lint:css / jest / dev ビルド）が緑のまま

後続 PR（デモビルド層 + 実チャプター01〜14）の受け入れ基準は、実装着手時に本書へ追記する。
