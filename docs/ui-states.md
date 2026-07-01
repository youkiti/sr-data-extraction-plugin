# UI 状態マトリクス（v0.1 — 全編 target spec）

- **作成日**: 2026-07-02
- **位置付け**: 各画面 × 各状態 × 受入基準を網羅し、目視レビューと AI レビューの共通スペックとする（sr-query-builder の [docs/ui-states.md](../sr-query-builder-plugin/docs/ui-states.md) と同じ運用）
- **本ドキュメントの status（重要）**: 実装未着手のため**全編 target spec** である。実装が始まったら sr-query-builder と同様に「現実装との乖離は ⚠️ drift 注記で管理し、spec と実装のどちらを正とするか明示してから両方直す」運用へ移行する
- **使い方**: 新規画面・新規状態を実装したら、必ずこの spec に状態を追加してから着手する
- **更新ルール**: 表示／非表示・ステータス文言・`hidden` 属性の真偽は画面ごとの章で 1 行 1 状態にし、後続の Playwright で `expect(locator).toBeVisible()` / `toBeHidden()` の根拠として参照する

## 0. 共通レイヤ

すべての画面で以下を満たすこと（sr-query-builder と同一規約）。

- `[hidden]` 属性が付いた要素は画面に出ない（`globals.css` の `[hidden] { display: none !important }` で固定）
- `chrome.*` API が未注入でも HTML 単体が読める（Playwright の `file://` + `addInitScript` 前提）
- ステータス領域（`#popup-status` / `#options-status` / `#app-status`）は空文字にしない

## 1. Popup (`src/popup/popup.html`)

sr-query-builder の Popup と同一パターン（未ログイン / ログイン済 ×最近のプロジェクト 0 / N 件、ログイン処理中、ログイン失敗）。相違点のみ記す：

- 新規作成フォームの説明文は「データ抽出プロジェクトを作成します（スプレッドシート + Drive フォルダを生成）」
- 既存 ID で開く場合、`Meta` タブの検証に加えて **`Documents` / `SchemaFields` タブの存在**を確認し、欠けていれば「sr-data-extraction のプロジェクトではありません」エラー

## 2. Options (`src/options/options.html`)

### 状態 A: 通常表示

- **可視**: Gemini API キー入力（`type="password"` + `autocomplete="off"`）/ 保存ボタン / 表示言語セレクタ（MVP は ja 固定・ディム）
- **`#options-status`**: `Gemini: 保存済み|未設定` 形式
- キーは `trim()` して保存、空文字は保存抑止（sr-query-builder で target のまま残った教訓を最初から実装する）

### 状態 B: 保存実行中 / 完了 / 失敗

- 保存中: `#save-keys.disabled = true` / 完了: `保存しました。` / 失敗: 赤系メッセージ + ボタン復帰

## 3. App / メインビュー (`src/app/app.html`)

共通レイアウト: `header.app__header`（タイトル + `#app-status` + `#app-context`〔`aria-live="polite"`〕）+ `aside.app__sidebar` + `section#app-content`。ルート遷移のスクリーンリーダ通知は `#app-context` の更新で検証する。

### 状態 A: プロジェクト未選択（不正アクセス）

- `currentProject` が無い状態で `app.html` を直接開いた場合、`#app-status` に未選択メッセージ + ポップアップへ戻る導線が 1 つ以上

### 状態 B: ガード未充足

- サイドバーの未充足ステップ（[ui-flow.md §4](ui-flow.md)）はディム表示。クリック時はトーストで前提条件を案内し、遷移しない

### 各ルートの主要状態

| ルート | 状態 | 可視要素 / 受入基準 |
|---|---|---|
| `#/home` | 通常 | プロジェクトメタ + 進捗サマリ（文献数 / schema version / 検証済み率）。0 文献でも崩れない |
| `#/documents` | 空 | 「Drive から PDF を取り込む」ボタン + 空状態説明。**著作権確認チェックが OFF の間、取り込み実行ボタンは disabled** |
| | 取り込み中 | ファイルごとの進捗行（コピー → テキスト抽出の 2 段階表示）。中断してもタブが落ちない |
| | 一覧 N 件 | `text_status` バッジ（`ok` 緑 / `partial` 黄 / `no_text_layer` 赤 + 「`pdf_native` 抽出のみ・ハイライト不可」注記）。study_label はインライン編集可 |
| `#/protocol` | — | sr-query-builder の protocol 画面と同一状態群（手入力 / file、再訪 3 モード分岐）を移植 |
| `#/schema` | ドラフト前 | 「AI にスキーマをドラフトさせる」ボタン + サンプル論文セレクタ（1〜3 本）。プロトコル未入力ならガード |
| | ドラフト生成中 | 進捗表示 + 経過時間。**LLM コスト集計の再描画で表示が消えない**（sr-query-builder `draftRun` の教訓を踏襲し store で管理） |
| | 編集中 | 表形式エディタ。行ごとに `field_name`（snake_case バリデーション、重複エラー）/ `data_type` / `entity_level` / `extraction_instruction`。未確定変更がある間「版として確定」ボタンが強調 |
| | 確定済み | 現行版の読み取り専用サマリ + 「新しい版を作る」導線 + 版履歴リスト |
| `#/pilot` | 未実行 | 対象文献セレクタ（既定 2〜3 本。`no_text_layer` は `pdf_native` モード時のみ選択可）+ コスト概算 + 実行ボタン |
| | 実行中 / 完了 | 進捗バー → 埋め込み検証 UI。完了後「スキーマを改訂して再パイロット」ボタンが常に可視 |
| `#/extract` | 未実行 | 対象選択（既定: 未抽出全件）+ モデル表示 + **コスト概算 → 確認ダイアログを経てから実行** |
| | 実行中 | document 単位の進捗リスト（done / running / queued / failed）。failed 行に「再試行」 |
| | partial_failure | 上部に黄バナー「n 件失敗。再試行できます」。成功分の検証へは進める |
| `#/verify` | 通常 | 2 ペイン + document セレクタ + entity タブ。**arm 未確定時は arm / outcome タブがディム + 「まず群構成を確定してください」** |
| | anchor failed 項目 | フォーム側に quote 全文 + 「本文内を検索」ボタン。ハイライトは描画しない |
| | `no_text_layer` document | PDF は表示するがハイライトなし。全項目が quote 全文 + ページヒント表示。「本文内を検索」ボタンは出さない（テキスト層がないため）。上部に「この PDF はテキスト層がないためハイライト検証は使えません」バナー |
| | 複数一致 | 「他 n 箇所に一致」リンク。クリックでハイライト切替 + PDF スクロール |
| | 保存失敗（オフライン） | 判定チップは楽観更新しつつ、トップバーに「オフライン: N 件キュー中」。復帰後の再送成功でキュー表示が消える |
| `#/dashboard` | 0 件 | 「まだ抽出がありません」+ `#/extract` への導線 |
| | 通常 | document × section マトリクス（セル = 検証済み/総数）+ anchor 失敗率 + not_reported 率。セルクリックで `#/verify?doc=...` へ |
| `#/export` | 通常 | 形式選択（wide / long / audit）+ プレビュー（先頭 10 行）+ 生成ボタン |
| | unreviewed 残存 | 警告ダイアログ「AI 値のままの項目が n 件あります」。続行 / 中止を選べる。audit.csv には status 列で明示 |
| | 生成完了 | Drive 保存 URL + ダウンロードリンク + `ExportLog` 追記済みの確認表示 |

## 4. キーボードショートカット

[ui-flow.md §7](ui-flow.md) のキー操作は `#/verify` がアクティブな時のみ反応する。入力フィールドにフォーカスがある間は判定キー（`a` / `x` / `n`）を発火させない（`e` で入った編集中に `a` と打って accept 誤爆しないこと）。

## 5. レビュー時のチェックリスト（人 + AI 共通）

1. 該当画面の章をこの spec から探す
2. 状態を 1 つずつ手元 / Playwright で再現できるか確認
3. `hidden` のものが本当に画面に見えていないか（bounding box または `getComputedStyle().display` で見る）
4. ステータス文言・エラーメッセージの文字列がここに書いてある通りか
5. `aria-live` / `<label for>` の書き忘れは目視でも見る

不一致を見つけたら、まずこの spec が正しいかを疑い、両者を一緒に直す。
