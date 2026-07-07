# UI 状態マトリクス（v0.2 — target spec + スケルトン drift 注記）

- **作成日**: 2026-07-02（v0.1）/ **更新**: 2026-07-02（v0.2: スケルトン実装開始に伴い drift 注記運用へ移行）
- **位置付け**: 各画面 × 各状態 × 受入基準を網羅し、目視レビューと AI レビューの共通スペックとする（sr-query-builder の [docs/ui-states.md](../sr-query-builder-plugin/docs/ui-states.md) と同じ運用）
- **本ドキュメントの status（重要）**: スケルトン実装が入ったため「現実装との乖離は ⚠️ drift 注記で管理し、spec と実装のどちらを正とするか明示してから両方直す」運用に**移行済み**
- **使い方**: 新規画面・新規状態を実装したら、必ずこの spec に状態を追加してから着手する
- **更新ルール**: 表示／非表示・ステータス文言・`hidden` 属性の真偽は画面ごとの章で 1 行 1 状態にし、後続の Playwright で `expect(locator).toBeVisible()` / `toBeHidden()` の根拠として参照する

## ⚠️ drift 注記（スケルトン段階のサマリ・2026-07-02）

spec が正。実装が追いついていない箇所は以下のとおり（実装が入り次第この注記を削る）:

| 章 | 実装状況 |
|---|---|
| §1 Popup | ✅ 実装済み（未ログイン / ログイン済 ×最近 0・N 件 / ログイン処理中・失敗 / 新規作成 / 既存 ID 検証。2026-07-02） |
| §2 Options | ✅ 状態 A / B とも実装済み（Gemini キーの trim 保存・空文字抑止・保存中無効化・完了/失敗表示）。既定モデル（保存 / 空文字で解除 / S5 への注入）も実装済み（2026-07-03）。OpenRouter キー節 + 既定モデルの select 化（モデルセレクタ共通ウィジェット）は 2026-07-04 実装 |
| §3 App 共通レイアウト・状態 A / B | ✅ 実装済み（ヘッダ / サイドバー / ガードのディム表示 + トースト / `#app-context` 通知） |
| §3 `#/home` | ✅ 実装済み（起動時に Sheets から進捗カウントを読込〔`values:batchGet` 1 呼び出し〕。読み込み中 / 失敗 + 再読み込み / 通常サマリ。ガードのディム判定も同カウントで実データ化。2026-07-03） |
| §3 `#/documents` | ✅ 実装済み（読み込み中 / 失敗 / 空 / 取り込み中の進捗行 / 一覧 + バッジ + study_label インライン編集。2026-07-02）。Drive Picker のホスト済みページは GitHub Pages へデプロイ済み（[hosted/README.md](../hosted/README.md)）で、2026-07-03 の実機通し確認（[manual-testing.md](manual-testing.md) §1）で Picker の動作を確認済み |
| §3 `#/protocol` | ✅ 実装済み（プロジェクト未選択 / 読み込み中 / 失敗 / 新規フォーム / 読み取り専用 + 版切替 / 再入力フォーム。2026-07-02） |
| §3 `#/schema` | ✅ 実装済み（ドラフト前 / 生成中 / 編集中 / 確定済みの 4 状態 + 読み込み中 / 失敗。2026-07-02） |
| §3 `#/pilot` | ✅ 実装済み（未実行 / 実行中 / 完了 + 埋め込み検証 UI + 群構成の確定カード〔S8 と共有〕。2026-07-02） |
| §3 `#/verify` | ✅ 実装済み（一覧読み込み中 / 失敗 / 通常〔進捗チップ + ?doc= 同期〕/ 文献切替 / 群構成の確定〔未確定タブディム → 確定 → `ArmStructures` 追記〕/ `?entity=` ディープリンク〔S9 と同時実装。2026-07-02〕） |
| §3 `#/extract` | ✅ 実装済み（読み込み中 / 失敗 / 未実行〔未抽出の既定選択 + 抽出済みバッジ + コスト概算〕/ 実行確認カード / 実行中〔document 単位進捗リスト〕/ 完了〔done / partial_failure + 再試行 = single_document run〕。2026-07-02） |
| §3 `#/dashboard` | ✅ 実装済み（読み込み中 / 失敗 / 0 件 / 通常〔サマリ + document × section マトリクス + セルの `?doc=&entity=` ディープリンク〕。2026-07-02） |
| §3 `#/export` | ✅ 実装済み（読み込み中 / 失敗 / 通常〔形式選択 + サマリ + プレビュー + 除外警告〕/ 未検証セル警告ダイアログ / 生成中 / 失敗 / 生成完了〔Drive `exports/` 保存 + `ExportLog` 追記 + ローカル保存〕。2026-07-03） |
| §4 キーボードショートカット | ✅ 検証パネル（`verificationPanel`）に実装済み。spec の「`#/verify` のみで有効」は「**検証パネルが表示されている画面**（`#/verify` と `#/pilot` の埋め込み）で有効」に読み替える（パネルの DOM 接続中のみ反応・入力フォーカス中は判定キー無効） |

## 0. 共通レイヤ

すべての画面で以下を満たすこと（sr-query-builder と同一規約）。

- `[hidden]` 属性が付いた要素は画面に出ない（`globals.css` の `[hidden] { display: none !important }` で固定）
- `chrome.*` API が未注入でも HTML 単体が読める（Playwright の `file://` + `addInitScript` 前提）
- ステータス領域（`#popup-status` / `#options-status` / `#app-status`）は空文字にしない

## 1. プロジェクト選択 S1 (`src/popup/popup.html`)

拡張アイコンのクリック時にアンカー型ポップアップとしては表示せず、新規タブのフルページとして開く（manifest に `default_popup` なし。service worker の `action.onClicked` がプロジェクト未選択時にこのページを、選択済み時はメインビューを開く）。画面の状態は sr-query-builder の Popup と同一パターン（未ログイン / ログイン済 ×最近のプロジェクト 0 / N 件、ログイン処理中、ログイン失敗。状態 A〜D とエッジ E-Popup-1〜4 は sr-query-builder の [docs/ui-states.md §1](../sr-query-builder-plugin/docs/ui-states.md) を参照）。相違点のみ記す：

- 新規作成フォームの説明文は「データ抽出プロジェクトを作成します（スプレッドシート + Drive フォルダを生成）。」
- 既存 ID で開く場合、`Meta` タブの検証に加えて **`Documents` / `SchemaFields` タブの存在**を確認し、欠けていれば `#popup-open-error` に「sr-data-extraction のプロジェクトではありません（Documents / SchemaFields タブが見つかりません）」
- 存在しないスプレッドシート ID（404）は「スプレッドシートが見つかりません。ID を確認してください」
- 設定画面はハッシュルートではなく独立ページのため、`#open-options` は `options/options.html` を新規タブで開く
- プロジェクト選択（作成 / 既存 ID / 履歴クリック）成功で直ちに同一タブのままメインビューへ遷移する（`chrome.tabs.update`。S1 はフルページ表示のためタブを増やさない）。独立した「メインビューを開く」ボタンは持たない（スケルトン段階の `#open-app` ボタンは廃止）

## 2. Options (`src/options/options.html`)

### 状態 A: 通常表示

- **可視**: Gemini API キー入力（`type="password"` + `autocomplete="off"`）/ 保存ボタン / OpenRouter API キー入力（`#openrouter-api-key`。Gemini と同じトンマナ + 取得先リンク <https://openrouter.ai/settings/keys>）/ 保存ボタン `#save-openrouter-key` / 既定モデルセレクタ（下記「既定モデル」参照）/ 表示言語セレクタ（MVP は ja 固定・ディム）
- **`#options-status`**: `Gemini: 保存済み|未設定` 形式 / **`#openrouter-status`**: `OpenRouter: 保存済み|未設定` 形式
- キーは `trim()` して保存、空文字は保存抑止（sr-query-builder で target のまま残った教訓を最初から実装する）

### 状態 B: 保存実行中 / 完了 / 失敗

- 保存中: `#save-keys.disabled = true`（OpenRouter は `#save-openrouter-key.disabled = true`）/ 完了: `保存しました。` / 失敗: 赤系メッセージ + ボタン復帰

### モデルセレクタ（共通ウィジェット。Options 既定モデル + S5 / S6 / S7 で共有）

`createModelSelect`（`src/app/ui/modelSelect.ts`）が生成する `<select>` + 直接入力テキストの複合部品。tiab-review のモデルプルダウンと同じ体験に揃える。

- `<select id={id}>` の構成: 先頭 option（`value=""` = プレースホルダ。画面ごとの文言）→ `<optgroup label="Gemini">` / `<optgroup label="OpenRouter">`（単価表 `MODEL_PRICING` のモデル ID を `/` の有無でグループ分け）→ `その他（直接入力）`（sentinel `__other__`。**state には漏らさない**）
- 「その他」を選ぶとテキスト入力 `#{id}-custom` が現れフォーカスされる（`aria-label` = `{ariaLabel}（直接入力）`）。テキストの change で trim 値を state へ。単価表にないモデルはコスト概算が「概算不可」になる（既存仕様のまま）
- **状態からの復元は決定的**: state の値が空 → プレースホルダ選択・テキスト非表示 / 単価表のモデル → 該当 option 選択・テキスト非表示 / それ以外 → その他選択 + テキスト表示・値充填（Options の保存値・S5→S6→S7 の引き継ぎ値が任意文字列でも正しく表示される）

### 既定モデル（S11・API キー行と同じトンマナ）

保存キーは `settings.defaultModel`（`chrome.storage.local`。秘密情報ではないため `secrets.*` とは分離）。保存値は S5 `#/schema` の**素材読込時**にモデル入力の初期値として注入される（**ユーザーが画面で入力済みの値は上書きしない** — 空のときだけ埋める）。S6 / S7 は S5 のモデルを引き継ぐため、ここで設定すれば下流すべてに効く。

| 状態 | 受入基準 |
|---|---|
| 未設定 | `#default-model-status` = `既定モデル: 未設定`（`options__status` と同じトンマナ）。モデルセレクタ `#default-model` はプレースホルダ option「未設定」を選択（上記「モデルセレクタ」参照。プルダウン = 単価表 `MODEL_PRICING` のモデル ID + その他で自由入力も可）。補足文「S5 スキーマ画面の初期値になります。単価表にないモデルはコスト概算が表示されません」 |
| 保存済み | `#default-model-status` = `既定モデル: 保存済み` + 保存値をセレクタで復元（単価表のモデルは該当 option / それ以外は「その他」+ `#default-model-custom` に充填。API キーと違いマスク不要） |
| 保存中 | `#save-default-model.disabled = true` |
| 保存完了 | セレクタの値（その他は trim したテキスト）を保存 → `保存しました。`。**空（プレースホルダ選択 or その他の空文字）は「未設定に戻す」**（`settings.defaultModel` を削除）→ `未設定に戻しました。`（API キーと違い空での解除を許す） |
| 保存失敗 | 赤系メッセージ `保存に失敗しました。もう一度お試しください。` + ボタン復帰 |

## 3. App / メインビュー (`src/app/app.html`)

共通レイアウト: `header.app__header`（タイトル + `#app-status` + 設定への歯車リンク `#app-open-options`〔`../options/options.html` への同一タブ遷移。`aria-label="設定を開く"`〕+ `#app-context`〔`aria-live="polite"`〕）+ `aside.app__sidebar` + `section#app-content`。プロジェクト選択済みの `#app-status` はプロジェクト名自体が S1 プロジェクト選択ページへの同一タブ遷移リンク（`title="別のプロジェクトを開く"`）。ルート遷移のスクリーンリーダ通知は `#app-context` の更新で検証する。

### 状態 A: プロジェクト未選択（不正アクセス）

- `currentProject` が無い状態で `app.html` を直接開いた場合、`#app-status` に未選択メッセージ + プロジェクト選択ページへ戻る導線が 1 つ以上（`#app-open-popup` = `../popup/popup.html` への同一タブ遷移アンカー）

### 状態 B: ガード未充足

- サイドバーの未充足ステップ（[ui-flow.md §4](ui-flow.md)）はディム表示。クリック時はトーストで前提条件を案内し、遷移しない

### 各ルートの主要状態

| ルート | 状態 | 可視要素 / 受入基準 |
|---|---|---|
| `#/home` | 読み込み中 | `#home-counts-loading`「進捗を読み込んでいます…」（起動時に Sheets の 7 範囲を `values:batchGet` 1 呼び出しで読む間。プロジェクト名は常時表示）。プロジェクト未選択時は読込自体を行わない（状態 A のまま） |
| | 読み込み失敗 | `#home-counts-error`「進捗を読み込めませんでした: {理由}」（`role="alert"`）+ 再読み込み `#home-counts-reload`（force 再取得）。失敗中のガードはシード値（全 0 = 全ステップディム）のまま |
| | 通常 | プロジェクトメタ + プロジェクト切替リンク `#home-switch-project`「別のプロジェクトを開く」（S1 プロジェクト選択ページへの同一タブ遷移アンカー。全状態で常設）+ 進捗サマリ（文献数 / プロトコル版数 / 確定スキーマ版数 / Evidence 行数 / データ行数）。0 文献でも崩れない。カウントの内訳: documents = `Documents` 行数 / protocolVersions = `Protocol` 行数 / schemaVersions = `SchemaVersions` 行数 / pilotRuns = `ExtractionRuns` の `run_type = pilot` 行数 / evidenceRows = `Evidence` 行数 / dataRows = `StudyData` + `ResultsData` 行数。読込成功後は各画面の操作（取り込み / 保存 / 確定 / run 完了）が増分更新する。E2E seam: `__E2E_PRELOADED_STATE__` に `counts` があれば読込済みとして扱い batchGet を行わない |
| `#/documents` | 読み込み中 | `#documents-loading`「一覧を読み込んでいます…」（初回表示時に Documents タブを自動読込。再読み込みボタンで強制再取得） |
| | 読み込み失敗 | `#documents-load-error`「一覧を読み込めませんでした: {理由}」（赤系）。再読み込みボタンで復帰 |
| | 空 | 「Drive から PDF を取り込む」ボタン + 空状態説明（`#documents-empty`）+ 画面上部に「取り込んだ PDF が外部へ送信されるのは LLM API への抽出リクエストのみです」の注意書き（常時表示） |
| | 取り込み中 | ファイルごとの進捗行（コピー → テキスト抽出の 2 段階表示。`#documents-progress`。待機中 / 完了 / 失敗〔段階 + 理由の赤バッジ〕も同じ行で表現）。取り込み・再読み込みボタンは無効化。中断してもタブが落ちない |
| | 一覧 N 件 | `text_status` バッジ（`ok` 緑 / `partial` 黄 / `no_text_layer` 赤 + 「`pdf_native` 抽出のみ・ハイライト不可」注記）。study_label はインライン編集可（change / Enter で確定 → 保存トースト。空文字は保存せず案内） |
| `#/protocol` | 読み込み中 | `#protocol-loading`「プロトコルを読み込んでいます…」（初回表示時に Protocol タブを自動読込） |
| | 読み込み失敗 | `#protocol-load-error`「プロトコルを読み込めませんでした: {理由}」（赤系）+ 再読み込みボタン |
| | 新規フォーム（0 版） | 入力方法ラジオ（手入力 / ファイル）+ 本文 textarea または file input（`.md` / `.markdown` / `.docx`）。空本文・ファイル未選択・未対応拡張子は `#protocol-error` にインラインエラー（**空本文は保存不可** — LLM 抽出を挟まないため空プロトコルで `#/schema` ガードが解除されるのを防ぐ） |
| | 保存中 | `#protocol-submit` 無効化 + `#protocol-status`「保存中…」。手入力の本文は保存失敗後の再描画でも復元される（`draftText`） |
| | 読み取り専用（1 版以上） | `#protocol-summary`（版 / 入力形式 / 本文 / 元ファイルの Drive リンク / 作成日時・者）+ 版切替 select（2 版以上のとき）+ 古い版選択時は `#protocol-old-note`。「新しい版を入力」で再入力フォームへ |
| | 再入力フォーム | 送信ボタンは「新しい版として保存」+ キャンセルで読み取り専用へ復帰。保存は常に追記（上書きなし） |
| | ※移植メモ | sr-query-builder の「未保存下書き復元」モードは、本拡張では送信 = 即保存（LLM 抽出 → blocks 承認の 2 段階が無い）ため存在しない |
| `#/schema` | ドラフト前 | 「AI にスキーマをドラフトさせる」ボタン + サンプル論文セレクタ（1〜3 本。テキスト層なしは選択不可）+ モデルセレクタ `#schema-model`（`requested_model`。§2「モデルセレクタ」の共通ウィジェット。プレースホルダ「選択してください」。既定モデルは Q8 確定まで固定しない）。プロトコル未入力ならガード。選択 0 本 / モデル未選択 / 選択モデルのプロバイダ（Gemini / OpenRouter）の API キー未設定は `#schema-draft-error` にインラインエラー |
| | ドラフト生成中 | 進捗表示 + 経過時間。**LLM コスト集計の再描画で表示が消えない**（sr-query-builder `draftRun` の教訓を踏襲し store で管理） |
| | 編集中 | 表形式エディタ。行ごとに `field_name`（snake_case バリデーション、重複・StudyData 固定列衝突エラー）/ `data_type` / `entity_level` / `extraction_instruction`（必須）ほか全列を編集可。エラーは一覧 + 該当セルの `aria-invalid` で表示し、ある間は確定不可。二値 / 連続アウトカムのプリセット挿入（requirements.md §3.3）と行の追加 / 削除。ボタン下に `data_type` の凡例 `#schema-datatype-help`（text / integer / float / boolean / enum / date の説明 + 例。enum は許容値列の | 区切り指定を案内）。未確定変更がある間「版として確定」ボタンが強調 |
| | 確定済み | 現行版の読み取り専用サマリ（メタ + 項目テーブル）+ 「新しい版を作る」導線（現行版の field_id を維持してエディタへ）+ 版履歴リスト（2 版以上のとき） |
| `#/pilot` | 未実行 | 対象文献セレクタ `#pilot-documents`（既定 = テキスト層ありの先頭 3 本。`no_text_layer` はチェック不可 + 「pdf_native モード時のみ選択可・P1」注記）+ モデルセレクタ `#pilot-model`（§2「モデルセレクタ」の共通ウィジェット。プレースホルダ「選択してください」）+ コスト概算 `#pilot-estimate`（選択 0 本は案内文 / 単価表にないモデルは「概算不可」/ planRun の warnings を列挙。プロトコル本文ぶんは含まない旨を注記）+ 実行ボタン `#pilot-run`。選択 0 本 / モデル未選択 / 選択モデルのプロバイダの API キー未設定は `#pilot-run-error` にインラインエラー |
| | 実行中 | `#pilot-progress`（`<progress>` + 「n / m バッチ完了（直近: doc / section）」）。setup は出さない |
| | 完了 | done は `#pilot-run-done`、partial_failure は `#pilot-partial-failure`（バッチ失敗の内訳 + 応答要素の破棄件数）。「スキーマを改訂して再パイロット」`#pilot-revise-schema`（`#/schema` へのリンク）は完了後常に可視。検証文献セレクタ `#pilot-verify-doc` + 埋め込み検証パネル（下記 `#/verify` の 2 ペインと同一コンポーネント）。検証データの読み込み中 `#pilot-verify-loading` / 失敗 `#pilot-verify-error` + 再試行 `#pilot-verify-retry` |
| | 保存失敗（オフライン） | 判定はパネル内で楽観更新しつつ `#pilot-queued`「オフライン: N 件キュー中」。復帰後の保存成功時に自動再送（`lib/storage/offlineQueue` の 'decisions' キュー） |
| `#/extract` | 読み込み中 | `#extract-loading`「抽出対象を読み込んでいます…」（文献一覧 + `ExtractionRuns` の既抽出 document を読む間） |
| | 読み込み失敗 | `#extract-load-error`（理由）+ 再読み込み `#extract-reload` |
| | 未実行 | パイロット未実施なら黄バナー `#extract-pilot-warning`「パイロット抽出を推奨します」（`counts.pilotRuns = 0` の間。遷移自体は許可 — ui-flow.md §4）。対象文献チェックリスト `#extract-documents`（**既定 = 未抽出の全件**。既抽出は「抽出済み」バッジ `.extract__doc-extracted` 付きで既定オフ・再抽出のため選択は可。`no_text_layer` はチェック不可 + 「pdf_native モード時のみ選択可・P1」注記）+ モデルセレクタ `#extract-model`（§2「モデルセレクタ」の共通ウィジェット。既定 = S6 / S5 の入力を引き継ぐ）+ コスト概算 `#extract-estimate`（`#/pilot` と同仕様: 選択 0 本は案内文 / 単価表にないモデルは「概算不可」/ planRun warnings 列挙 / プロトコル本文ぶんは含まない旨の注記）+ 実行ボタン `#extract-run`。選択 0 本 / モデル未選択 / 選択モデルのプロバイダの API キー未設定は `#extract-run-error` にインラインエラー |
| | 実行確認 | `#extract-run` クリックで確認カード `#extract-confirm`（`role="alertdialog"`）: 対象 n 件 + コスト概算の再掲 + 「実行する」`#extract-confirm-run` / 「キャンセル」`#extract-confirm-cancel`。**確認を経ずに実行は始まらない** |
| | 実行中 | 全体進捗 `#extract-progress`（`<progress>` + 「n / m バッチ完了」）+ document 単位の進捗リスト `#extract-doc-list`（1 行 = 1 document: study_label + 状態バッジ 待機中 `queued` / 実行中 `running` / 完了 `done` / 失敗 `failed`。失敗行はバッチ失敗の内訳を併記）。setup は出さない |
| | 完了（done） | `#extract-run-done`「一括抽出が完了しました。」+ 進捗リスト（全行 完了）+ 「検証へ進む」`#extract-verify-link`（`#/verify` へのリンク）。setup も再表示し、続けて再実行できる（既抽出バッジは実行結果で更新） |
| | 完了（partial_failure） | 上部に黄バナー `#extract-partial-failure`「{n} 件の文献で失敗しました。再試行できます」+ 応答要素の破棄があれば件数を併記。失敗行に「再試行」`.extract__retry`（`run_type = single_document` で当該 1 本のみ再実行。再試行中は他の再試行・実行ボタンを無効化）。成功分の検証へは `#extract-verify-link` から進める |
| `#/verify` | 一覧読み込み中 | `#verify-loading`「検証対象を読み込んでいます…」。Evidence がある document 一覧 + Decisions を読む間 |
| | 一覧読み込み失敗 | `#verify-error`（メッセージ）+ 再試行 `#verify-retry` |
| | 通常 | document セレクタ `#verify-doc`（Evidence がある document のみ列挙。各行に進捗チップ「判定済み n / 総セル m」）+ 選択中文献の見出し（h3 = study_label。見出し階層 h2 → h3 → h4 を保つ）+ 2 ペイン検証パネル（`#/pilot` 埋め込みと同一コンポーネント）。URL は `#/verify?doc={document_id}` と同期する — セレクタ切替で hash を書き換え、直リンク・リロードで該当文献を復元 |
| | `?entity=` ディープリンク | `#/verify?doc={document_id}&entity={entity_key}`（S9 ダッシュボードのセルクリック）で該当 entity のタブへ切替 + 先頭セルへスクロール・フォーカス（[ui-flow.md §3](ui-flow.md)）。存在しない entity_key・群構成未確定でロック中のタブに属する entity は無視（通常表示のまま）。セレクタでの文献切替は `?doc=` のみ書き戻す（entity は引き継がない） |
| | `?doc=` が不正 | 存在しない document_id は `#verify-error`「文献 {id} が見つかりません」+ セレクタから選び直せる |
| | 文献切替中 | `#verify-doc-loading`（検証データ束の読み込み。前の文献の PDF は破棄してから読む） |
| | 群構成が未確定 | **arm / outcome_result タブがディム（`aria-disabled`）+ 「まず群構成を確定してください」**。群構成確定カード `#verify-arm-card` を表示: AI ドラフトの arm 一覧（`arm_key` + 名称入力。初期値 = Evidence の arm 名フィールド値）+ 行の追加 / 削除 + 「群構成を確定」`#verify-arm-confirm`。名称が空の行があるうちは確定不可（インラインエラー `#verify-arm-error`）。arm / outcome_result レベル項目が 1 つもないスキーマ（= 群構成が要らない）ではカード自体を出さない（ディム対象タブも存在しない） |
| | 群構成が確定済み | カードは要約表示「群構成: n 群（version v）」+ 「改訂」`#verify-arm-revise` で再編集 → 確定で `ArmStructures` へ新 version を追記（監査証跡）。arm / outcome_result タブが有効化される |
| | anchor failed 項目 | フォーム側に quote 全文 + 「本文内を検索」ボタン。ハイライトは描画しない |
| | `no_text_layer` document | PDF は表示するがハイライトなし。全項目が quote 全文 + ページヒント表示。「本文内を検索」ボタンは出さない（テキスト層がないため）。上部に「この PDF はテキスト層がないためハイライト検証は使えません」バナー |
| | 複数一致 | 「他 n 箇所に一致」リンク。クリックでハイライト切替 + PDF スクロール |
| | 保存失敗（オフライン） | 判定チップは楽観更新しつつ、`#verify-queued`「オフライン: N 件キュー中」。復帰後の再送成功でキュー表示が消える |
| `#/dashboard` | 読み込み中 | `#dashboard-loading`「進捗を読み込んでいます…」（Evidence がある document 一覧 + Decisions を読む間。初回表示時に自動読込） |
| | 読み込み失敗 | `#dashboard-load-error`「進捗を読み込めませんでした: {理由}」（`role="alert"`）+ 再読み込み `#dashboard-reload` |
| | 0 件 | `#dashboard-empty`「まだ抽出がありません。」+ `#/extract` への導線リンク（AI 抽出済み document が 0 本のとき。ガードなしで遷移できるルートのための空状態） |
| | 通常 | サマリ `#dashboard-summary`（検証進捗 = 判定済み n / 総セル m + %、anchor 失敗率 = failed n / アンカリング対象 m + %〔分母 = `anchor_status` 非 null の Evidence〕、not_reported 率 = n / Evidence 総数 m + %。分母 0 は「—」）+ マトリクス `#dashboard-matrix`（`<table>`。1 行 = 1 document〔`<th scope="row">` = study_label〕× 列 = section〔スキーマ登場順の和集合〕。セル = 「判定済み n / m」のリンク → `#/verify?doc={document_id}&entity={entity_key}`〔entity = セクション先頭セルの entity_key。セル単位ディープリンク — ui-flow.md §3〕。当該 document のスキーマにない section / セル 0 件は「—」でリンクなし）+ 行末に document 別の anchor 失敗率・not_reported 率列。進捗・rate の集計は自分の annotator 行基準（検証画面の進捗チップと同じセルモデル） |
| `#/export` | 読み込み中 | `#export-loading`「エクスポート素材を読み込んでいます…」（Documents / StudyData / ResultsData / Evidence / Decisions / ExtractionRuns / 最新版 SchemaFields を読み、3 形式の CSV をメモリ上で構築する間。初回表示時に自動読込） |
| | 読み込み失敗 | `#export-load-error`「エクスポート素材を読み込めませんでした: {理由}」（`role="alert"`）+ 再読み込み `#export-reload`。確定済みスキーマが 1 版もない場合もこの状態（ガード `dataRows ≥ 1` を満たす以上通常は起きない防御） |
| | 通常 | 形式選択ラジオ `#export-format`（study_wide / results_long / audit。各形式に 1 行の用途説明）+ 選択形式のサマリ `#export-summary`（`<dl>`: データ行数 / 対象文献数〔= CSV に行が出た文献数。`ExportLog.document_count` と同値〕/ 未検証セル数〔study_wide = 確定 annotator 行の空セル数・audit = 判定 0 件セルのプレースホルダ行数・results_long は概念がなく「—」〕）+ 除外警告（確定 annotator を特定できず除外した文献 `#export-skipped`〔study_label 列挙。0 件なら非表示〕/ field_id 不整合で除外した行数 `#export-dropped`〔0 件なら非表示〕）+ プレビュー `#export-preview`（`<table>`: ヘッダ + 先頭 10 データ行。11 行以上は「…他 {n} 行」注記 `#export-preview-more`）+ 生成ボタン `#export-generate`「CSV を生成して Drive に保存」。**データ行 0 件の形式は生成ボタンを無効化** + 案内文。形式切替でサマリ・プレビュー・警告が追随する |
| | 未検証セル残存（警告） | `#export-generate` クリック時、選択形式の未検証セル数 > 0 なら確認ダイアログ `#export-warning`（`role="alertdialog"`）「未検証の項目が {n} 件あります。」+ audit 形式では「audit.csv では未検証セルが判定列空のプレースホルダ行として明示されます」の注記 + 「続行して生成」`#export-warning-continue` / 「中止」`#export-warning-cancel`。**続行を経ずに生成は始まらない**（未検証 0 件なら即生成） |
| | 生成中 | `#export-generating`「CSV を生成して Drive に保存しています…」+ 生成ボタン・形式ラジオを無効化 |
| | 生成失敗 | `#export-generate-error`「エクスポートに失敗しました: {理由}」（`role="alert"`）。生成ボタンは復帰し再試行できる |
| | 生成完了 | 結果カード `#export-result`: 「{filename} を Drive に保存しました（ExportLog に記録済み）」+ Drive リンク `#export-result-link`（`webViewLink`。`target="_blank"`）+ ローカル保存 `#export-download`（Blob ダウンロード）。形式を切り替えて続けて生成できる（結果カードは次の生成開始まで残す）。Drive 保存先は プロジェクトフォルダ直下の `exports/`（初回生成時に作成）、ファイル名は `{format}_{YYYYMMDD-HHMMSS}.csv` |

## 4. キーボードショートカット・検証パネルのフォーカス挙動

[ui-flow.md §7](ui-flow.md) のキー操作は `#/verify` がアクティブな時のみ反応する。入力フィールドにフォーカスがある間は判定キー（`a` / `x` / `n`）を発火させない（`e` で入った編集中に `a` と打って accept 誤爆しないこと）。

検証パネル（S6 / S8 共有）のフォーカスとスクロールは automation bias 対策と作業効率のため次のように振る舞う（セルの表示順はスキーマ順で固定・並び替えはしない）：

- **初期フォーカス = 最初の未判定セル**: 画面を開いた直後・タブ切替時のフォーカスは、そのタブで最初の未判定（`unverified`）セルへ当てる。判定済みセルから作業が始まらないようにする。全セル判定済みならタブ先頭セル、セルが無ければフォーカスなし
- **判定後の自動遷移**: `a` / `e` / `x` / `n` の判定確定後、現在セルの次以降（末尾まで無ければ先頭へ回り込む）で最初の未判定セルへフォーカスを自動的に移す（`j` の手動送りが不要）。判定済みセルはスキップする。全セル判定済みなら現在セルに留まる。PDF ハイライトも遷移先へ追従する
- **`z`（戻す）は留まる**: undo は取り消し直後に同じセルで再判定するため、フォーカスを動かさない
- **スクロール位置の保持**: 判定のたびにフォームペインを作り直すが、スクロール位置を退避・復元して先頭へ飛ばさない。遷移先セルが画面外のときだけ最小移動で見せる

## 5. レビュー時のチェックリスト（人 + AI 共通）

1. 該当画面の章をこの spec から探す
2. 状態を 1 つずつ手元 / Playwright で再現できるか確認
3. `hidden` のものが本当に画面に見えていないか（bounding box または `getComputedStyle().display` で見る）
4. ステータス文言・エラーメッセージの文字列がここに書いてある通りか
5. `aria-live` / `<label for>` の書き忘れは目視でも見る

不一致を見つけたら、まずこの spec が正しいかを疑い、両者を一緒に直す。
