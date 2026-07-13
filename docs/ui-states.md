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
| §2 Options | ✅ 状態 A / B とも実装済み（Gemini キーの trim 保存・空文字抑止・保存中無効化・完了/失敗表示）。既定モデル（保存 / 空文字で解除 / S5 への注入）も実装済み（2026-07-03）。OpenRouter キー節 + 既定モデルの select 化（モデルセレクタ共通ウィジェット）は 2026-07-04 実装。OpenAI 互換 API の接続設定と接続テストは Issue #27 で追加。レート制限 tier 節（一括抽出の 429 対策 = スロットル + リトライ強化）は 2026-07-10 実装 |
| §3 App 共通レイアウト・状態 A / B | ✅ 実装済み（ヘッダ / サイドバー / ガードのディム表示 + トースト / `#app-context` 通知） |
| §3 `#/home` | ✅ 実装済み（起動時に Sheets から進捗カウントを読込〔`values:batchGet` 1 呼び出し〕。読み込み中 / 失敗 + 再読み込み / 通常サマリ。ガードのディム判定も同カウントで実データ化。2026-07-03） |
| §3 `#/documents` | ✅ 実装済み（読み込み中 / 失敗 / 空 / 取り込み中の進捗行。2026-07-02）。**v0.10 グルーピング UI 実装済み**（2026-07-07: study 単位グループ表示 + study_label / registration_id / document_role インライン編集 + 統合ダイアログ + 統合候補バナー）。Drive Picker のホスト済みページは GitHub Pages へデプロイ済み（[hosted/README.md](../hosted/README.md)）で、2026-07-03 の実機通し確認（[manual-testing.md](manual-testing.md) §1）で Picker の動作を確認済み |
| §3 `#/protocol` | ✅ 実装済み（プロジェクト未選択 / 読み込み中 / 失敗 / 新規フォーム / 読み取り専用 + 版切替 / 再入力フォーム。2026-07-02） |
| §3 `#/schema` | ✅ 実装済み（ドラフト前 / 生成中 / 編集中 / 確定済みの 4 状態 + 読み込み中 / 失敗。2026-07-02）。プリセット挿入に「RoB 2（SQ 完全版）」`#schema-preset-rob2-sq`（issue #61。判定 + 根拠 + signaling question 22 問の計 24 項目）を追加（2026-07-12） |
| §3 `#/pilot` | ✅ 実装済み（未実行 / 実行中 / 完了 + 埋め込み検証 UI + 群構成の確定カード〔S8 と共有〕。2026-07-02） |
| §3 `#/verify` | ✅ 実装済み（一覧読み込み中 / 失敗 / 通常〔進捗チップ + ?study= 同期〕/ study 切替 / 複数文書の文書切替タブ + 出所 PDF 自動切替〔v0.10 フェーズ 3 = 2026-07-09〕/ 群構成の確定〔未確定タブディム → 確定 → `ArmStructures` 追記〕/ `?entity=` ディープリンク〔S9 と同時実装。2026-07-02〕）。RoB 2 SQ アルゴリズム提案バッジ（issue #61。2026-07-12）実装済み。with_ai レビューのセルカードに抽出指示の折りたたみ（issue #81）+ フォーカスモードのユニットヘッダに前後移動ボタン（issue #82）を追加（2026-07-12）。anchor failed 項目の「AI で再特定」ボタン（relocate-quote skill。issue #94）を 2026-07-13 追加 |
| §3 `#/extract` | ✅ 実装済み（読み込み中 / 失敗 / 未実行〔未抽出の既定選択 + 抽出済みバッジ + コスト概算 + 中断バナー = 2026-07-06〕/ 実行確認カード / 実行中〔**study 単位**進捗リスト〕/ 完了〔done / partial_failure + 再試行 = single_study run〕。2026-07-02。v0.10 フェーズ 2 で document 単位 → study 単位へ更新 = 2026-07-09） |
| §3 `#/dashboard` | ✅ 実装済み（読み込み中 / 失敗 / 0 件 / 通常〔サマリ + study × section マトリクス + セルの `?study=&entity=` ディープリンク〕。2026-07-02。v0.10 フェーズ 3 で study 単位へ = 2026-07-09） |
| §3 `#/export` | ✅ 実装済み（読み込み中 / 失敗 / 通常〔形式選択 + サマリ + プレビュー + 除外警告 + 論文 Methods 記載例カード〕/ 未検証セル警告ダイアログ / 生成中 / 失敗 / 生成完了〔Drive `exports/` 保存 + `ExportLog` 追記 + ローカル保存〕。2026-07-03。Methods 記載例カードは 2026-07-12 追加〔issue #67〕。**R セット（第 4 の形式）は 2026-07-12 追加〔issue #60 PR-B〕**: ファイル一覧 + ma.csv プレビュー + Drive `exports/rset_{YYYYMMDD-HHMMSS}/` への 8 ファイル保存 + BOM なし CSV の Excel/R 読み方案内文。§3 の詳細行を参照） |
| §4 キーボードショートカット | ✅ 検証パネル（`verificationPanel`）に実装済み。spec の「`#/verify` のみで有効」は「**検証パネルが表示されている画面**（`#/verify` と `#/pilot` の埋め込み）で有効」に読み替える（パネルの DOM 接続中のみ反応・入力フォーカス中は判定キー無効） |
| 独立二重レビュー（issue #44・v0.11） | ✅ 実装済み（2026-07-11）。`Reviewers` タブ + ロール解決（フェイルクローズ）+ reviewer 系シェル制限 + reviewer オンボーディング（フォルダアクセス付与）+ owner のレビュアー管理カード（Home）+ `#/verify` 独立入力モード + `#/adjudicate`（S12・裁定画面）。jest 144 suites / 2042 tests green・カバレッジ 100%・E2E 64 本（`app-reviewer.spec.ts` 5 / `app-independent.spec.ts` 2 / `app-adjudicate.spec.ts` ほか）green。**2 アカウントでの実機通し確認は未実施**（[docs/design-independent-dual-review.md](design-independent-dual-review.md) §13 参照） |
| レビュアー間一致度レポート（issue #66） | ✅ 実装済み（2026-07-12）。`#/adjudicate` 一覧画面にオンデマンド計算カード（純関数 `features/adjudication/agreement.ts`: 項目単位の一致率・Cohen's κ・不一致セル一覧。既存の `cellMatch.buildAdjudicationCells` をそのまま集計素材にする）+ サービス層 `loadAgreementReport` / `downloadAgreementCsv`（CSV 2 種のローカル保存）。jest green・カバレッジ 100%・E2E 1 本追加（`app-adjudicate.spec.ts`）。axe で一覧テーブルの空 `<th>` と見出し階層スキップ（h2 → h4）を検出し修正済み |
| 裁定画面の v1 簡略化 2 点の解消（issue #63） | ✅ 実装済み（2026-07-12）。PDF ペインの Evidence ハイライト（`features/verification/highlights.ts` の `buildDocumentHighlights` を再利用）+ セル一覧の「根拠を表示」ボタン → 該当文書へ切替 + ハイライトへジャンプ + 各レビュアーの `Decisions.note` 表示（A / B の値の下）+ 裁定書き込みのオフラインキュー退避（検証側と共有する 'decisions' キュー。失敗時退避 → 成功時に過去分もまとめて再送）。arm 並べ替えマッピング・3 人以上対応はオーナー判断が必要なため引き続きスコープ外。jest green・カバレッジ 100%・E2E 2 本追加（`app-adjudicate.spec.ts`）+ axe |
| quote 再特定（relocate-quote skill。issue #94） | ✅ 実装済み（2026-07-13）。`anchor_status = failed` の項目に「AI で再特定」ボタン（実行中 / 成功〔Evidence 追記済み新行へ差し替え + ハイライトへジャンプ〕/ not_found・失敗〔従来の本文内検索を案内〕）。Evidence は追記型のため新行を追記し `relocated_from` 列（新設）で元行を記録、`anchor_status` は実際の再アンカリング結果をそのまま持つ（詳細は [requirements.md](requirements.md) §3.2「quote の再特定」）。LLM 応答は既存のアンカリング中核で再検証し、fuzzy 以上のときだけ採用。jest green・カバレッジ 100%・E2E 2 本追加（LLM stub の成功 / not_found 経路） |
| 抽出対象フィールドの選択（issue #80・案 A） | ✅ フェーズ 2（UI 結線）実装済み（2026-07-12）。S6 / S7 の実行前画面に対象項目チェックリスト（既定 = 全選択・section 単位の折りたたみ + 全選択/全解除トグル・選択 0 件は実行ボタン disabled）を追加し、選択サブセットを `runExtraction` の `fieldIds` へ渡す（全選択時は null）。S7 の抽出済みバッジに「直近 run は n/m 項目」注記、実行確認カードに「対象項目: n/m」を追加。失敗 study の再試行は元 run と同じ選択を引き継ぐ（`lastRunFieldIds`）。選択は画面入場・対象再読込のたびに全選択へリセット（storage 永続化なし）。S10 の未検証セル警告ダイアログにサブセット抽出の注意書きを追加。詳細は §3 `#/pilot`・`#/extract`・`#/export` の該当行を参照 |

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
- 設定は `#open-options` からアプリ内ルート `app/app.html#/options` へ同一タブで遷移する（`chrome.tabs.update`。独立ページ `options/options.html` は拡張管理画面の「オプション」からのみ開く）
- プロジェクト選択（作成 / 既存 ID / 履歴クリック）成功で直ちに同一タブのままメインビューへ遷移する（`chrome.tabs.update`。S1 はフルページ表示のためタブを増やさない）。独立した「メインビューを開く」ボタンは持たない（スケルトン段階の `#open-app` ボタンは廃止）

## 2. Options (`src/options/options.html`)

### 状態 A: 通常表示

- **可視**: Gemini API キー入力（`type="password"` + `autocomplete="off"`）/ 保存ボタン / OpenRouter API キー入力（`#openrouter-api-key`。Gemini と同じトンマナ + 取得先リンク <https://openrouter.ai/settings/keys>）/ 保存ボタン `#save-openrouter-key` / 既定モデルセレクタ（下記「既定モデル」参照）/ 表示言語セレクタ（MVP は ja 固定・ディム）
- **「アプリを開く」リンク `#options-open-app`**（スタンドアロン options.html のみ。見出し行の右側から `../app/app.html` へ同一タブ遷移。アプリ内 `#/options` はサイドバーと「← 前の画面へ戻る」= `#/options` 進入直前のルート・無ければ `#/home` を持つため、このリンクは出さない — issue #31 B）
- **`#options-status`**: `Gemini: 保存済み|未設定` 形式 / **`#openrouter-status`**: `OpenRouter: 保存済み|未設定` 形式
- キーは `trim()` して保存、空文字は保存抑止（sr-query-builder で target のまま残った教訓を最初から実装する）
- **入力欄の placeholder で保存状態を可視化**（平文キーは再表示しない）: 保存済み → `保存済み（変更する場合のみ入力）` / 未設定 → `API キーを入力`。保存成功時に入力欄をクリアしたうえで placeholder を「保存済み」に切り替える
- **プロバイダ取り違えの検出**（確信できるときのみ弾く。取りこぼし優先で正規キーは弾かない）: Gemini 欄に `sk-or-` 始まり（OpenRouter キー）→ 保存抑止 + 赤系メッセージで別欄へ誘導 / OpenRouter 欄に `AIza` 始まり（Gemini キー）→ 同様に抑止。判定は `looksLikeGeminiApiKey` / `looksLikeOpenRouterApiKey`（`src/lib/storage/secretsStore.ts`）

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
| 未設定 | `#default-model-status` = `既定モデル: 未設定`（`options__status` と同じトンマナ）。モデルセレクタ `#default-model` はプレースホルダ option「未設定」を選択（上記「モデルセレクタ」参照。プルダウン = 単価表 `MODEL_PRICING` のモデル ID + その他で自由入力も可）。補足文「単価表にないモデルはコスト概算が表示されません」 |
| 保存済み | `#default-model-status` = `既定モデル: 保存済み` + 保存値をセレクタで復元（単価表のモデルは該当 option / それ以外は「その他」+ `#default-model-custom` に充填。API キーと違いマスク不要） |
| 保存中 | `#save-default-model.disabled = true` |
| 保存完了 | セレクタの値（その他は trim したテキスト）を保存 → `保存しました。`。**空（プレースホルダ選択 or その他の空文字）は「未設定に戻す」**（`settings.defaultModel` を削除）→ `未設定に戻しました。`（API キーと違い空での解除を許す） |
| 保存失敗 | 赤系メッセージ `保存に失敗しました。もう一度お試しください。` + ボタン復帰 |

### LLM 接続先（Issue #27）

接続方式は `gemini` / `openrouter` / `openai_compatible` の 3 種。保存キーは `settings.llmProvider`、OpenAI 互換 API の完全 URL は `settings.openAiCompatibleEndpoint`、API キーは `secrets.openAiCompatibleApiKey` とする。接続方式が未保存の既存環境だけは後方互換としてモデル ID の `/` の有無から Gemini / OpenRouter を解決し、接続方式を一度保存した後はモデル ID より設定値を優先する。

| 状態 | 受入基準 |
|---|---|
| 通常 | `#llm-provider` で Gemini / OpenRouter / OpenAI 互換 API を選択できる。OpenAI 互換 API 選択時だけ `#openai-compatible-endpoint`（完全 URL）と `#openai-compatible-api-key`（password）を表示する。API キーは loopback HTTP のときだけ任意とする |
| 読み込み済み | 保存済みの接続方式とエンドポイントを復元する。API キーの平文は復元せず、保存済みなら placeholder で示す |
| 保存 | `#save-llm-connection.disabled = true`。OpenAI 互換 API は URL を検証し、入力 URL の scheme + hostname pattern を `chrome.permissions.request` で利用者へ確認してから保存する。実際の API リクエストでは入力 URL のポートとパスを維持する。権限拒否時は保存しない |
| 保存完了 | `#llm-connection-status` = `保存しました。`。OpenAI 互換 API のキー入力はクリアし、placeholder を保存済みへ切り替える |
| 保存失敗 | URL 不正、API キー未設定、権限拒否、storage 失敗の理由を赤系メッセージで表示し、ボタンを復帰する |
| 接続テスト | `#test-llm-connection.disabled = true`。現在の入力値と既定モデルを使い、`json_schema + strict`、`json_schema`、`json_object` の順で最小リクエストを送る。互換性エラー時だけ次の方式へフォールバックし、JSON 応答を確認できれば `接続テストに成功しました。`、それ以外は理由を赤系で表示する |
| 接続方式切替 | Gemini または OpenRouter を保存したときは `settings.openAiCompatibleEndpoint` を削除する。OpenAI 互換 API キーは秘密情報として別管理し、接続方式の切り替えだけでは削除しない |

OpenAI 互換 API の URL は HTTPS を原則とし、HTTP は hostname が `localhost`、`127.0.0.1`、`[::1]` のいずれかと完全一致する場合だけ受け付ける。
非標準ポートは HTTPS と loopback HTTP の双方で許可する。
userinfo、query、fragment は拒否する。
loopback HTTP で API キーが空の場合は Authorization ヘッダーを送らず、リモート HTTPS では API キーを必須とする。
構造化出力のフォールバックは接続テストだけでなく、スキーマ生成、パイロット抽出、本番抽出へ共通適用する。
`json_object` へフォールバックした場合も既存の JSON パースと出力検証を維持する。
接続先へ論文本文と抽出プロンプトが送信される旨を設定画面に表示する。
任意ヘッダー、Bearer 以外の認証、Chat Completions 以外の API 形式は対象外とする。

### レート制限（一括抽出の 429 対策。docs/requirements.md §4.3）

一括抽出（S6 パイロット / S7 一括）で多数の study を連続処理すると、LLM API の 1 分あたりリクエスト上限（RPM）に達して HTTP 429（Too Many Requests）が出うる。対策は 2 本立て（`src/lib/llm/rateLimitPolicy.ts`）: **A. バッチ間スロットル**（`withThrottle`。RPM から最小リクエスト間隔 = `ceil(60000/RPM)` を導き、`executeRun` のバッチ連射を平準化）+ **B. リトライ強化**（`withRetry`。429/5xx を指数バックオフで再試行し、サーバ提示の `Retry-After` ヘッダ / 本文 `RetryInfo.retryDelay` を尊重、tier ごとに試行回数・バックオフ上限を変える）。合成は `withRetry(withThrottle(withLogging(provider)))`。

スループット対策として **C. バッチ並行実行** も持つ（2026-07-10。docs/handoff-20260710-throughput.md）: `RateLimitPolicy.maxConcurrency` で `executeRun` のバッチ（= 1 study）を同時に走らせる本数を決める。スロットル（A）は間隔だけを保証し同時実行数を絞らないため、並行数はこの値で別に制御する。**既定は全 tier で 1（＝逐次。従来と同一挙動 = 回帰の砦）**で、`custom` tier のときだけ Options で 2 以上に上げてスループット実験できる（`gemini-tier3` 等のプリセットの実値は実測後に確定する）。

保存キーは `settings.rateLimitTier`（tier ID）+ `settings.rateLimitCustomRpm`（カスタム tier の RPM。正の整数のみ・非正で削除）+ `settings.rateLimitCustomConcurrency`（カスタム tier の同時実行数。正の整数のみ・非正/未入力で削除 = 逐次）。`resolveRateLimitPolicy()` が実効ポリシーへ解決し、bootstrap が抽出・ドラフトのサービス層へ注入する（未注入時は `UNLIMITED_POLICY` = スロットル無し・リトライのみ・逐次 = 従来挙動）。tier プリセット: 無料枠 `gemini_free`（既定・RPM 8）/ `gemini_tier1`（120）/ `gemini_tier2`（900）/ `gemini_tier3`（1800）/ `custom`（RPM + 同時実行数を手入力）/ `unlimited`（スロットルしない）。RPM は保守的な目安で、実測に合わせ `custom` で上書きできる。

| 状態 | 受入基準 |
|---|---|
| 未設定 | `#rate-limit-status` = `レート制限: Gemini 無料枠（Free）`（既定 tier）。セレクタ `#rate-limit-tier` は `gemini_free` を選択。カスタム RPM 行 `#rate-limit-custom-row` / 同時実行数行 `#rate-limit-concurrency-row` は非表示。説明文 `#rate-limit-tier-desc` に選択 tier の補足 |
| 保存済み | 保存 tier を `#rate-limit-tier` で復元。`custom` のときだけ `#rate-limit-custom-row` / `#rate-limit-concurrency-row` を表示し `#rate-limit-custom-rpm` に保存 RPM・`#rate-limit-concurrency` に保存同時実行数を充填 |
| tier 変更 | `change` で説明文と RPM / 同時実行数行の表示を同期（`custom` のみ両入力を表示）。不正な select 値は既定 `gemini_free` へ倒す |
| 保存完了 | 非 custom = tier を保存しカスタム RPM / 同時実行数キーを削除 / custom = tier + RPM（1 以上の整数）+ 同時実行数（任意。空なら削除 = 逐次）を保存 → `保存しました。` |
| 保存不可 | custom で RPM が空・0 以下・非数値なら `RPM は 1 以上の数値を入力してください。` / 同時実行数が入力ありで 0 以下・非数値なら `同時実行数は 1 以上の数値を入力してください。`（いずれも赤系・保存しない） |
| 保存中 / 失敗 | `#save-rate-limit.disabled = true` / 赤系 `保存に失敗しました。もう一度お試しください。` + ボタン復帰 |

## 3. App / メインビュー (`src/app/app.html`)

共通レイアウト: `header.app__header`（タイトル + `#app-status` + 設定への歯車リンク `#app-open-options`〔`../options/options.html` への同一タブ遷移。`aria-label="設定を開く"`。issue #50: 歯車アイコン（装飾・`aria-hidden`）+「設定」テキストラベルを常時表示するボタン状の見た目〕+ `#app-context`〔`aria-live="polite"`〕）+ `aside.app__sidebar` + `section#app-content`。プロジェクト選択済みの `#app-status` はプロジェクト名自体が S1 プロジェクト選択ページへの同一タブ遷移リンク（`title="別のプロジェクトを開く"`）。ルート遷移のスクリーンリーダ通知は `#app-context` の更新で検証する。

### 状態 A: プロジェクト未選択（不正アクセス）

- `currentProject` が無い状態で `app.html` を直接開いた場合、`#app-status` に未選択メッセージ + プロジェクト選択ページへ戻る導線が 1 つ以上（`#app-open-popup` = `../popup/popup.html` への同一タブ遷移アンカー）

### 状態 B: ガード未充足

- サイドバーの未充足ステップ（[ui-flow.md §4](ui-flow.md)）はディム表示。クリック時はトーストで前提条件を案内し、遷移しない

### 状態 C: ロール未確定（v0.11・独立二重レビュー機能 issue #44）

プロジェクト選択済みでログイン email のロール（`owner` / `reviewer_with_ai` / `reviewer_independent` / `adjudicator` / `unregistered`）が確定していない間は、盲検のフェイルクローズとしてナビ（サイドバー）を出さず、以下のいずれかの全画面ブロックのみを表示する（ルートのローダも発火しない）。プロジェクト未選択の間はこの判定自体を行わない（状態 A のまま）。

| 状態 | 可視要素 / 受入基準 |
|---|---|
| 解決中 | `#app-role-resolving`「このプロジェクトでのロールを確認しています…」 |
| 解決失敗 | `#app-role-error`「このプロジェクトでのロールを確認できませんでした: {理由}」（`role="alert"`）+ 「盲検保護のため、ロールを確認できるまで画面を表示しません。」+ 再試行 `#app-role-retry`（一時的なエラーで owner 側の UI へフォールバックしない） |
| 未登録（`unregistered`） | `#app-role-blocked`「このプロジェクトのレビュアーとして登録されていません。プロジェクトのオーナーに登録を依頼してください。」（`role="alert"`） |

### 各ルートの主要状態

| ルート | 状態 | 可視要素 / 受入基準 |
|---|---|---|
| `#/home` | 読み込み中 | `#home-counts-loading`「進捗を読み込んでいます…」（起動時に Sheets の 7 範囲を `values:batchGet` 1 呼び出しで読む間。プロジェクト名は常時表示）。プロジェクト未選択時は読込自体を行わない（状態 A のまま） |
| | 読み込み失敗 | `#home-counts-error`「進捗を読み込めませんでした: {理由}」（`role="alert"`）+ 再読み込み `#home-counts-reload`（force 再取得）。失敗中のガードはシード値（全 0 = 全ステップディム）のまま |
| | 通常（owner） | プロジェクトメタ + プロジェクト切替リンク `#home-switch-project`「別のプロジェクトを開く」（S1 プロジェクト選択ページへの同一タブ遷移アンカー。全状態で常設）+ 進捗サマリ（文献数 / プロトコル版数 / 表のデザインの確定版数 / Evidence 行数 / データ行数）。0 文献でも崩れない。カウントの内訳: documents = `Documents` 行数 / protocolVersions = `Protocol` 行数 / schemaVersions = `SchemaVersions` 行数 / pilotRuns = `ExtractionRuns` の `run_type = pilot` 行数 / evidenceRows = `Evidence` 行数 / dataRows = `StudyData` + `ResultsData` 行数。読込成功後は各画面の操作（取り込み / 保存 / 確定 / run 完了）が増分更新する。E2E seam: `__E2E_PRELOADED_STATE__` に `counts` があれば読込済みとして扱い batchGet を行わない |
| | owner のレビュアー管理カード（v0.11） | `#home-reviewers`。読み込み中 `#home-reviewers-loading` / 失敗 `#home-reviewers-reload` + `#home-reviewers-error`（`role="alert"`）/ 空 `#home-reviewers-empty`「まだレビュアーが登録されていません。」/ 一覧 `#home-reviewers-list`（email・role・review_mode・解除ボタン `.reviewers__revoke`〔`revoked` 行は disabled〕）+ 追加フォーム `#reviewer-add-form`（email・role セレクタ `#reviewer-role`・review_mode セレクタ `#reviewer-mode`〔role='adjudicator' の間は disabled〕・送信 `#reviewer-add-submit`）。既存 reviewer のモード変更送信時は警告ダイアログ `#reviewer-mode-confirm`（`role="alertdialog"`。「変更する」`#reviewer-mode-confirm-ok` / 「キャンセル」`#reviewer-mode-confirm-cancel`）を経由してから追記。保存失敗は `#home-reviewers-save-error`（`role="alert"`） |
| | reviewer 系の縮退版 Home（v0.11） | `reviewer_with_ai` / `reviewer_independent` / `adjudicator` は進捗カウントを一切読み込まず、プロジェクト名 + プロジェクト切替リンクのみを表示。フォルダアクセス未付与のうちは `#home-folder-access`（案内文 + 「プロジェクトフォルダへのアクセスを付与」`#home-grant-folder-access`。確認中は `#home-folder-access-checking`「確認しています…」でボタン disabled、失敗は `#home-folder-access-error`〔`role="alert"`〕）。付与済みは `#home-folder-access-granted`「プロジェクトフォルダへのアクセスは付与済みです。」+ 「検証を開始する」`#home-go-verify`（`#/verify` リンク） |
| `#/documents` | 読み込み中 | `#documents-loading`「一覧を読み込んでいます…」（初回表示時に Documents タブを自動読込。再読み込みボタンで強制再取得） |
| | 読み込み失敗 | `#documents-load-error`「一覧を読み込めませんでした: {理由}」（赤系）。再読み込みボタンで復帰 |
| | 空 | 「Drive から PDF / フォルダを取り込む」ボタン + 空状態説明（`#documents-empty`）+ 画面上部に「取り込んだ PDF が外部へ送信されるのは LLM API への抽出リクエストのみです」の注意書き（常時表示） |
| | 取り込み中 | ファイルごとの進捗行（コピー → テキスト抽出の 2 段階表示。`#documents-progress`。待機中 / 完了 / 失敗〔段階 + 理由の赤バッジ〕も同じ行で表現）。取り込み・再読み込みボタンは無効化。中断してもタブが落ちない。フォルダを選択した場合は Picker 確定後にトースト「フォルダを展開中…」→ 直下 PDF を列挙して展開してから進捗行を表示（PDF 0 件・列挙失敗はトースト案内のみで進捗行は出さない） |
| | 一覧（試験ごとのグループ・v0.10） | アクティブ study（`Documents` から 1 件以上参照される study。作成順）ごとにグループ表示。study ヘッダ = 統合対象チェックボックス + `study_label` インライン編集（change / Enter で確定 → Studies 行の上書き。空は保存せず案内）+ `registration_id` インライン編集（空は null 解除）。配下文書は `document_role` セレクト（本論文 / 試験登録 / プロトコル / 学会抄録 / 付録・補遺 / その他）+ ファイル名 + `text_status` バッジ（`ok` 緑 / `partial` 黄 / `no_text_layer` 赤 + 「`pdf_native` 抽出のみ・ハイライト不可」注記）+ ページ数。取り込みは常に 1 PDF = 1 study を自動生成し、グルーピングはこの画面で後から行う（§4.5） |
| | 統合（複数 study 選択）| study を 2 件以上チェック → 「選択した試験を統合」（`#documents-merge`）で統合ダイアログ（`#merge-dialog` `role="alertdialog"`）。統合後の `study_label` / `registration_id`（既定 = 最初に取り込まれた study の値）を編集 → 「統合する」で新 study_id を発行して `Studies` へ追記 + `Documents.study_id` を付け替え。旧 study 行は監査用に残置（参照 0 = 非アクティブ = 一覧・集計に出ない）。抽出済みデータ（完了 run）がある study を含む統合は `#merge-warning`「統合後この試験は未抽出に戻る（判定履歴は Decisions に残る）」を表示して続行 / 中止 |
| | 統合候補バナー | 同一 `registration_id` のアクティブ study が複数あると `.documents__candidate`（`role="note"`）を上部に表示。「統合する」で統合ダイアログへ、「無視」で `chrome.storage.local` にペアを記録して再提案を抑止（シートには書かない）。**自動統合はしない**（AI は提案、人間が確定） |
| `#/protocol` | 読み込み中 | `#protocol-loading`「プロトコルを読み込んでいます…」（初回表示時に Protocol タブを自動読込） |
| | 読み込み失敗 | `#protocol-load-error`「プロトコルを読み込めませんでした: {理由}」（赤系）+ 再読み込みボタン |
| | 新規フォーム（0 版） | 入力方法ラジオ（手入力 / ファイル）+ 本文 textarea または file input（`.md` / `.markdown` / `.docx`）。空本文・ファイル未選択・未対応拡張子は `#protocol-error` にインラインエラー（**空本文は保存不可** — LLM 抽出を挟まないため空プロトコルで `#/schema` ガードが解除されるのを防ぐ） |
| | 保存中 | `#protocol-submit` 無効化 + `#protocol-status`「保存中…」。手入力の本文は保存失敗後の再描画でも復元される（`draftText`） |
| | 読み取り専用（1 版以上） | `#protocol-summary`（版 / 入力形式 / 本文 / 元ファイルの Drive リンク / 作成日時・者）+ 版切替 select（2 版以上のとき）+ 古い版選択時は `#protocol-old-note`。「新しい版を入力」で再入力フォームへ |
| | 再入力フォーム | 送信ボタンは「新しい版として保存」+ キャンセルで読み取り専用へ復帰。保存は常に追記（上書きなし） |
| | ※移植メモ | sr-query-builder の「未保存下書き復元」モードは、本拡張では送信 = 即保存（LLM 抽出 → blocks 承認の 2 段階が無い）ため存在しない |
| `#/schema` | 全状態共通 | 見出し「表のデザイン」直下に解説リード（`view__lead`）「抽出したい項目のリストをこのページで作成します。スプレッドシートでいえば 1 行目の見出し（列の名前）にあたります。例:「著者名」「出版年」「対象患者数」など。これを設計する工程を表のデザインと呼んでいます。」を常時表示（プロジェクト未選択時も。issue #31 ①） |
| | ドラフト前 | 「AI に表のデザインをドラフトさせる」ボタン + サンプル論文セレクタ（1〜3 本。テキスト層なしは選択不可）+ モデルセレクタ `#schema-model`（`requested_model`。§2「モデルセレクタ」の共通ウィジェット。プレースホルダ「選択してください」。既定モデルは Q8 確定まで固定しない）。プロトコル未入力ならガード。選択 0 本 / モデル未選択 / 選択モデルのプロバイダ（Gemini / OpenRouter）の API キー未設定は `#schema-draft-error` にインラインエラー |
| | ドラフト生成中 | 進捗表示 + 経過時間。**LLM コスト集計の再描画で表示が消えない**（sr-query-builder `draftRun` の教訓を踏襲し store で管理） |
| | 編集中 | 表形式エディタ。行ごとに `field_name`（snake_case バリデーション、重複・StudyData 固定列衝突エラー。**AI ドラフトが `study_id` 等の固定列名と衝突する `field_name` を提案した場合は応答パース時点で `<name>_reported`〔さらに重複するなら連番〕へ自動リネームするため、AI ドラフト由来の行はここで衝突エラーにならない — issue #48。手入力・手編集で固定列名を指定した場合は引き続きエラーになり、文言も「別名（例: "study_id_reported"）へ変更してください」と対処法を提示する**）/ `data_type` / `entity_level` / `extraction_instruction`（必須）ほか全列を編集可。エラーは一覧 + 該当セルの `aria-invalid` で表示し、ある間は確定不可。プリセット挿入（requirements.md §3.3。二値 `#schema-preset-binary` / 連続 `#schema-preset-continuous` / RoB 2 `#schema-preset-rob2` / ROBINS-I `#schema-preset-robins-i`）と行の追加 / 削除。ボタン下に `data_type` の凡例 `#schema-datatype-help`（text / integer / float / boolean / enum / date の説明 + 例。enum は許容値列の | 区切り指定を案内）。未確定変更がある間「版として確定」ボタンが強調 |
| | 確定済み | 現行版の読み取り専用サマリ（メタ + 項目テーブル）+ 「新しい版を作る」導線（現行版の field_id を維持してエディタへ）+ 版履歴リスト（2 版以上のとき） |
| `#/pilot` | 履歴・復元 | 入場時に過去のパイロット run（`ExtractionRuns` の `run_type='pilot'` 完了行のみ）を新しい順で読み込み、`#pilot-history` に列挙（各項目 = 日時 / モデル / 文献数 / status バッジ「完了」「一部失敗」）。読み込み中 `#pilot-history-loading` / 失敗 `#pilot-history-error` + 再読み込み `#pilot-history-reload`。**既存データがあれば起動後に最新 run を一度だけ自動読込**（Evidence を run で絞り + 版別 SchemaFields を解決 → 下の「完了」状態へ復元）し、パイロット済みなら「最初から」にしない。履歴項目クリックで別の run を読み込み（読み込み中は全項目を無効化・対象行に「読み込み中…」、表示中の run は無効化 + 「表示中」+ `aria-current`）。過去 run が無ければ（`history=[]`）履歴セクションは出さない。履歴から読み込んだ run は partial_failure の内訳を再構成できないため案内文のみ |
| | 未実行（新規パイロット） | 画面末尾の `.pilot__setup`（h3「新規パイロット」）。対象 **study** セレクタ `#pilot-documents`（既定 = テキスト層のある文書を含む先頭 3 study。各 study は study_label + 配下文書のロール + ファイル名を副次リスト表示。テキスト層のある文書が無い study も選択可（既定選択には含めない）+ 「テキスト層なし: ページ画像を LLM へ送信して抽出します（ハイライトなし・コスト増）」注記。v0.10 フェーズ 2 / §7.4 PR2）+ **対象項目チェックリスト `#pilot-fields`**（issue #80。**既定 = 全選択**。`SchemaField.section` 単位で `.pilot__field-section` に折りたたみ表示〔既定は全展開・見出し `.pilot__field-collapse` の `aria-expanded` で開閉状態を示す〕。section 見出しに「選択 n / 全 m」件数 + 全選択/全解除トグル `.pilot__field-section-toggle`〔section が充足済みなら「全解除」・未充足なら「全選択」〕、各項目はチェックボックス + `field_label` + `field_name`〔`<code>`〕。全体サマリ `#pilot-field-summary`「対象項目: n / m」〔全選択時は「全項目（m）」〕。**選択 0 件は `#pilot-field-error`〔role="alert"〕を出し実行ボタンを disabled** にする。スキーマ未読込・0 件時はチェックリスト自体を出さない）+ モデルセレクタ `#pilot-model`（§2「モデルセレクタ」の共通ウィジェット。プレースホルダ「選択してください」）+ コスト概算 `#pilot-estimate`（選択 0 本・対象項目 0 件は案内文 / 単価表にないモデルは「概算不可」/ planRun の warnings を列挙。**選択サブセットで絞り込んだ fields を渡すため概算も選択分だけになる**。プロトコル本文ぶんは含まない旨を注記）+ 実行ボタン `#pilot-run`。選択 0 本 / 対象項目 0 件 / モデル未選択 / 選択モデルのプロバイダの API キー未設定は `#pilot-run-error` にインラインエラー。**実行時は選択サブセットで絞り込んだ fields + `fieldIds`（全選択時は null）を `runExtraction` へ渡す**が、埋め込み検証 UI（`runFields`）は絞り込まず表のデザインの全項目のまま渡す（未抽出項目も人間が手動判定できるようにするため） |
| | 実行中 | `#pilot-progress`（`<progress>` + 「n / m バッチ完了（p% / 直近: study_label / section）」。document は study_label で表示し、未解決なら id にフォールバック）。履歴・setup は出さない |
| | 完了 | done は `#pilot-run-done`、partial_failure は `#pilot-partial-failure`（バッチ失敗の内訳 + 応答要素の破棄件数。履歴読込 run で内訳が無ければ案内文 1 行）。「表のデザインを改訂して再パイロット」`#pilot-revise-schema`（`#/schema` へのリンク）は完了後常に可視。検証文献セレクタ `#pilot-verify-doc` + 埋め込み検証パネル（下記 `#/verify` の 2 ペインと同一コンポーネント）。検証データの読み込み中 `#pilot-verify-loading` / 失敗 `#pilot-verify-error` + 再試行 `#pilot-verify-retry`。新規実行後は完了 run を履歴の先頭へ追加する |
| | 保存失敗（オフライン） | 判定はパネル内で楽観更新しつつ `#pilot-queued`「オフライン: N 件キュー中」。復帰後の保存成功時に自動再送（`lib/storage/offlineQueue` の 'decisions' キュー） |
| `#/extract` | 読み込み中 | `#extract-loading`「抽出対象を読み込んでいます…」（文献一覧 + `ExtractionRuns` の既抽出 document を読む間） |
| | 読み込み失敗 | `#extract-load-error`（理由）+ 再読み込み `#extract-reload` |
| | 未実行 | パイロット未実施なら黄バナー `#extract-pilot-warning`「パイロット抽出を推奨します」（`counts.pilotRuns = 0` の間。遷移自体は許可 — ui-flow.md §4）。中断された run の残り study（`ExtractionRuns` の running 行のみで完了行がなく、他 run でも未抽出）があれば黄バナー `#extract-interrupted-warning`「前回の抽出が途中で中断されています（未完了 n 件）。未完了の試験は対象の既定選択に含まれているため、そのまま実行すると再開できます。」（`role="status"`。実行中は出さず、全件再抽出されると消える）。対象 **study** チェックリスト `#extract-studies`（**既定 = 未抽出の全 study**。各 study は study_label + 配下文書のロール + ファイル名を副次リスト表示。既抽出は「抽出済み」バッジ `.extract__doc-extracted` 付きで既定オフ・再抽出のため選択は可。**直近の完了 run がサブセット（field_ids ≠ null）だった study はバッジに「（直近 run は n/m 項目）」を添える**〔issue #80。全項目 run が直近なら注記なし〕。テキスト層のある文書が無い study も選択可・既定選択にも含める（pdf_native）+ 「テキスト層なし: ページ画像を LLM へ送信して抽出します（ハイライトなし・コスト増）」注記。v0.10 フェーズ 2 / §7.4 PR2）+ **対象項目チェックリスト `#extract-fields`**（issue #80。`#/pilot` と共通コンポーネント `renderFieldSelectionChecklist`。**既定 = 全選択**。section 単位の折りたたみ + 全選択/全解除トグル + 全体サマリ `#extract-field-summary`。**選択 0 件は `#extract-field-error`〔role="alert"〕+ 実行ボタン disabled**）+ モデルセレクタ `#extract-model`（§2「モデルセレクタ」の共通ウィジェット。既定 = S6 / S5 の入力を引き継ぐ）+ コスト概算 `#extract-estimate`（`#/pilot` と同仕様: 選択 0 本・対象項目 0 件は案内文 / 単価表にないモデルは「概算不可」/ planRun warnings 列挙 / プロトコル本文ぶんは含まない旨の注記。選択サブセットで絞り込んだ fields を渡すため概算も選択分だけになる）+ 実行ボタン `#extract-run`。選択 0 本 / 対象項目 0 件 / モデル未選択 / 選択モデルのプロバイダの API キー未設定は `#extract-run-error` にインラインエラー |
| | 実行確認 | `#extract-run` クリックで確認カード `#extract-confirm`（`role="alertdialog"`）: 対象 n 試験 + **対象項目 `#extract-confirm-fields`「対象項目: n / m」〔全選択時は「全項目（m）」〕**（issue #80）+ コスト概算の再掲 + 「実行する」`#extract-confirm-run` / 「キャンセル」`#extract-confirm-cancel`。**確認を経ずに実行は始まらない** |
| | 実行中 | 全体進捗 `#extract-progress`（`<progress>` + 「n / m バッチ完了（p%）」）+ study 単位サマリ `#extract-doc-summary`（「試験: 完了 x / 失敗 y / 全 N 件」。失敗 0 件なら失敗は出さない）+ 処理中の試験 `#extract-current-doc`（「処理中: study_label（i 件目・バッチ c/t）」。running 行がない瞬間は出さない）+ **study 単位**の進捗リスト `#extract-study-list`（1 行 = 1 study: study_label + 状態バッジ 待機中 `queued` / 実行中 `running` / 完了 `done` / 失敗 `failed`。実行中行は `.extract__doc-row--running` で強調し「バッチ c/t」を併記、失敗行はバッチ失敗の内訳を併記）。setup は出さない |
| | 完了（done） | `#extract-run-done`「一括抽出が完了しました。」+ 進捗リスト（全行 完了）+ 「検証へ進む」`#extract-verify-link`（`#/verify` へのリンク）。setup も再表示し、続けて再実行できる（既抽出バッジは実行結果で更新） |
| | 完了（partial_failure） | 上部に黄バナー `#extract-partial-failure`「{n} 件の文献で失敗しました。再試行できます」+ 応答要素の破棄があれば件数を併記。失敗行に「再試行」`.extract__retry`（`run_type = single_document` で当該 1 本のみ再実行。再試行中は他の再試行・実行ボタンを無効化。**再試行は元 run と同じ field 選択〔`lastRunFieldIds`〕を引き継ぐ** — issue #80 A-2。現在のチェックリスト選択は無視する）。成功分の検証へは `#extract-verify-link` から進める |
| | arm 欠落警告（issue #106） | 実行結果（done / partial_failure とも）に arm completeness チェックの警告（応答に `arm:n` が現れる〔または `ArmStructures` 確定済み〕のに、その arm の arm レベル項目が揃っていない）があれば、黄バナー `#extract-arm-warnings`（`role="status"`）を表示: 「群（arm）の欠落の可能性が {n} 件検出されました（警告）」+ study ごとの欠落一覧（study_label + section + `arm_key × 項目名`）。**warning のみで run の status は `partial_failure` に倒さない**（正当な not_reported 等の過検出リスクを許容する設計判断）。警告は `ExtractionRuns.warnings` 列（JSON）と `LLMApiLog`（`error` 列に「警告（arm_completeness）: …」の行を追記）へも記録する。再試行（single_study run）の結果は当該 study の警告を差し替える |
| `#/verify` | 一覧読み込み中 | `#verify-loading`「検証対象を読み込んでいます…」。Evidence がある study 一覧 + Decisions を読む間 |
| | 一覧読み込み失敗 | `#verify-error`（メッセージ）+ 再試行 `#verify-retry` |
| | 独立入力モードの differences（v0.11・`reviewer_independent`。`annotator_type = human_independent`） | 対象一覧は `Evidence` 非依存（`Studies` × 最新確定スキーマ）で AI 抽出の実施状況を出さない。セルカードは quote・ハイライト・「他 n 箇所に一致」・AI 値のプレフィル・anchor failed バナーを描画せず、フィールドラベル + `extraction_instruction`（AI 抽出指示文。スキーマ由来のため表示可）を代わりに表示。判定操作は「入力して確定」（値入力 → `edit`）/ `not_reported` / `undo` の 3 種のみ（`accept` / `reject` は出さず、キーボード `a` / `x` も無効）。群構成カードの初期文言は「AI ドラフトを初期値に」ではなく「群を追加して名称・数を自分で確定します」に差し替え、AI ドラフトの arm 一覧は出さない（空行から追加）。それ以外（PDF ビューア・フォーカス / リストのレイアウト切替・キーボード j/k/h/l 等の移動）は mode① と共通 |
| | with_ai レビューの抽出指示（issue #81） | with_ai レビュー（`reviewer_with_ai` / `owner` の通常セルカード）は AI 値表示の直後に `.verify__instruction-toggle`（ネイティブ `<details>`/`<summary>`。サマリ文言「指示を表示」）を追加し、開くと `.verify__instruction`（独立入力モードと同じスタイル）で `extraction_instruction` を表示する。**既定は畳んだ状態**。リストモードのセルカード・フォーカスモードの詳細ストリップ `#verify-focus-detail`（`verificationCellCard.renderCell` を共有するため自動的に同じ挙動）の両方で機能する。独立入力モードは元から常時表示のため対象外（差し替えなし） |
| | 通常 | study セレクタ `#verify-study`（Evidence がある study のみ列挙。各行に進捗チップ「判定済み n / 総セル m」）+ 選択中 study の見出し（h3 = study_label。見出し階層 h2 → h3 → h4 を保つ）+ 2 ペイン検証パネル（`#/pilot` 埋め込みと同一コンポーネント）。URL は `#/verify?study={study_id}` と同期する — セレクタ切替で hash を書き換え、直リンク・リロードで該当 study を復元。study が複数文書のときは左ペイン上部に**文書切替タブ** `.verify__doc-tabs`（role バッジ + ファイル名。既定は role 固定順の先頭）。項目フォーカス / 根拠クリック / 判定後の自動送り時に `Evidence.document_id` の文書へ自動切替（`setDocument` で描画競合の連番ガードを維持） |
| | レイアウトモード（issue #38） | 右ペイン（フォーム）はタブ行の隣に切替トグル `#verify-layout-toggle` を持ち、**フォーカス / リスト** の 2 レイアウトを切替える。**既定はフォーカス**。トグルはボタン 1 個で切替先ラベルを表示（フォーカス表示中は「リスト表示に切替」）。設定は `settings.verifyLayoutMode`（`lib/storage/settingsStore`）に永続化し、検証データ束の読込のたびに読み直すため **S6 パイロット埋め込み / S8 `#/verify` 単独画面で共有**する。タブ行・判定進捗バー・群構成確定カード・outcome_result 追加フォーム・ロック中タブのディムはモードに関わらず共通。**フォーカスモード**時は「グループ一覧 + 判定済みブロック」の領域が下記のマトリクスカード `#verify-focus-card` に差し替わる（**リストモード時**は本節の他の行が示す従来の 1 セル 1 カード表示のまま）：<br>1. ユニットヘッダ `#verify-focus-position`「ユニット n / m（残り r）」+ 見出し（`entity_level` ごとの検証ユニット = study は section、arm/outcome_result はインスタンス横結合、rob_domain はドメインインスタンス）。位置表示の左右に前後移動ボタン `.focus-card__nav--prev` / `.focus-card__nav--next`（issue #82。`aria-label` / `title` に Shift+K / Shift+J のヒント）を配置し、キーボードの `Shift+J` / `Shift+K` と同じ着地ロジック（判定状況に関係なく隣接ユニットへ移動し、着地は最初の未判定セル → 無ければ先頭セル）をマウスでも実行できる。端（先頭 / 末尾ユニット）では該当ボタンが `disabled`（キーボードの「折り返さない」挙動と一致）<br>2. マトリクス `#verify-focus-matrix`（`<table>`。列ヘッダ = ユニットの列〔study/rob_domain は固定 1 列、arm/outcome_result は群〕、行ヘッダ = フィールドラベル。セルは表示値〔判定確定値 > AI 値 > 「—」〕+ 判定チップのボタン。クリックでそのセルへフォーカス。存在しないセル（null）は「—」のプレーン表示）<br>3. プリセット要約行（outcome_result の連続 / 二値プリセット認識時のみ）<br>4. 詳細ストリップ `#verify-focus-detail`（フォーカス中セル 1 件を通常のセルカードで表示。quote・判定操作・編集入力・anchor failed の本文内検索・複数一致切替・ハイライトへ移動が全部そのまま使える。カードの高さは判定のたびに大きく変わらない）<br>5. 直近判定バー `#verify-focus-recent`（直近判定 1 件をユニットをまたいで固定表示。「戻す (z)」ボタン）<br>**一括承認ボタンは置かない**（automation bias 対策: accept にも 1 操作必須という原則をフォーカスモードでも維持するため） |
| | 整合性チェックバッジ（issue #65） | LLM を使わない決定論的な数値整合性チェック（`features/verification/consistencyChecks.ts`。events ≤ total、SD/SE/CI/IQR/range の大小関係など 14 ルール）を outcome_result のセル値（判定確定値 > AI 値の優先順）に適用し、違反セルへ ⚠ バッジを付ける。フォーカスモードはマトリクスボタンにバッジ（`aria-label` / `title` に警告文）、詳細ストリップ / リストモードのセルカードには警告メッセージ一覧 `.verify__consistency-warnings`（`role="note"`。同時表示のうち最初の 1 件だけ `#verify-consistency-warning`）を表示する。float は報告小数桁に応じた ±0.5 単位、integer は正確値の区間演算で丸め起因の見かけの矛盾を誤検出しない設計（第 3 の独立検証系。AI と人間の相関した誤りを検出する目的で、判定操作は増やさずブロックしない）。判定・編集のたびに再計算される |
| | RoB 2 SQ アルゴリズム提案バッジ（issue #61） | rob_domain タブの判定セル（field_name が `_judgement` で終わる）に対し、`features/verification/robAlgorithm.ts`（Cochrane RoB 2 の signaling question 決定木。#65 と同様 LLM 非依存の純ロジック）が同一ドメインインスタンスの SQ 回答（判定確定値 > AI 値の優先順。overall は他 5 ドメインの現在判定値）からアルゴリズム提案を導出する。回答不足（未回答の SQ がある・overall は 5 ドメインが揃わない）のときは提案なし。判定操作は増やさない情報提示のみで 3 種を表示する: (1) 提案チップ `.verify__rob-suggestion`「アルゴリズム提案: {judgement}」（提案があれば常時表示）、(2) 不一致警告 `.verify__rob-mismatch-warnings`（`role="note"`。#65 と同じパターンで最初の 1 件だけ `#verify-rob-algorithm-warning`。提案とセルの現在値が食い違うときだけ表示。フォーカスモードのマトリクスボタンにも同時に `.verify__rob-badge` + `aria-label` / `title` 追記）、(3) AI 判定・未確認バッジ `.verify__rob-unconfirmed`「AI 判定・未確認（まだ人が確認していません）」（AI 値があり人間の判定が 0 件〔status='unverified'〕のときだけ表示。人間が判定すると消える）。ROBINS-I 等 SQ 未対応のドメイン（PR2 以降）は提案が常に null になり、未確認バッジだけが働く |
| | PDF 読み込み中（issue #28 案3） | 検証データ束の組み立て（Decisions / StudyData / ArmStructures + 全文書ぶんの `extracted_texts`）は PDF バイナリを 1 件も読まない。左ペインの PDF は**表示中の 1 文書だけ**を遅延読込し、解決するまで `.verify__pdf-loading`「PDF を読み込んでいます…」を表示する（右ペインのフォーム・判定操作・matchCount 表示は extracted_texts 基準のため PDF 読み込み中でも即使える）。直近 3 件（`PDF_CACHE_SIZE`）の PDF だけを保持する LRU キャッシュ（`features/verification/pdfViewCache`）を介するため、表示していない文書・4 件目以降にあふれた文書は都度読み直しになる。読み込みに失敗すると `.verify__pdf-error` + 「再試行」ボタン（キャッシュを捨てて読み直す）。高速な文書切替・ズーム変更では常に最新の要求だけが表示に反映される（連番ガード + pdfjs `RenderTask.cancel()`） |
| | `?entity=` ディープリンク | `#/verify?study={study_id}&entity={entity_key}`（S9 ダッシュボードのセルクリック）で該当 entity のタブへ切替 + 先頭セルへスクロール・フォーカス（[ui-flow.md §3](ui-flow.md)）。存在しない entity_key・群構成未確定でロック中のタブに属する entity は無視（通常表示のまま）。セレクタでの study 切替は `?study=` のみ書き戻す（entity は引き継がない） |
| | arm 欠落警告（issue #106） | 選択中 study の「表示する run」（最新完了 run）の `ExtractionRuns.warnings` に当該 study の arm_completeness 警告があれば、セレクタ直下に黄バナー `#verify-arm-completeness-warning`（`role="status"`）: 「直近の AI 抽出で群（arm）の欠落の可能性が検出されています。群構成の確定・検証時に本文と照合してください」+ 欠落一覧（section + `arm_key × 項目ラベル`）。独立入力モード（`reviewer_independent`）は AI 抽出情報を見せないため表示しない |
| | `?study=` が不正 | 存在しない study_id は `#verify-error`「study {id} が見つかりません」+ セレクタから選び直せる |
| | study 切替中 | `#verify-doc-loading`（検証データ束の読み込み。前の study の PDF キャッシュは丸ごと破棄してから読む） |
| | 群構成が未確定 | **arm / outcome_result タブがディム（`aria-disabled`）+ 「まず群構成を確定してください」**（rob_domain タブは群構成に依存しないためディムしない）。群構成確定カード `#verify-arm-card` を表示: AI ドラフトの arm 一覧（`arm_key` + 名称入力。初期値 = Evidence の arm 名フィールド値）+ 行の追加 / 削除 + 「群構成を確定」`#verify-arm-confirm`。名称が空の行があるうちは確定不可（インラインエラー `#verify-arm-error`）。arm / outcome_result レベル項目が 1 つもないスキーマ（= 群構成が要らない）ではカード自体を出さない（ディム対象タブも存在しない） |
| | 群構成が確定済み | カードは要約表示「群構成: n 群（version v）」+ 「改訂」`#verify-arm-revise` で再編集 → 確定で `ArmStructures` へ新 version を追記（監査証跡）。arm / outcome_result タブが有効化される。arm タブは `ArmStructures` の全 arm をインスタンス源に含め、AI Evidence がない arm でも `AI 抽出なし（手入力のみ）` の空セルを表示する |
| | outcome_result 追加 | 群構成が確定済み、かつ outcome_result 項目があるとき、アウトカムタブ上部に `#verify-outcome-add` を表示する。`#verify-outcome-key` は既存 `outcome_<n>` の次番号を既定値にし、`#verify-outcome-time` は任意。`#verify-outcome-add-button` で `outcome:<key>\|arm:<n>`（time 入力ありは `\|time:<time>` 付き）を確定 arm 全体に作り、`Decisions` へ予約 `field_id=__entity_instance__` の宣言イベントを追記する。追加直後は該当 outcome × arm の全 field が空セルとして表示され、進捗分母にも含まれる。既存キーと衝突、`:` / `\|` を含むキー、確定 arm なし、arm_key 不正の場合は保存せず `#verify-outcome-error`（`role="alert"`）を表示する |
| | 幽霊セルの進捗 | 非 study タブの「インスタンス × field」直積で生じる Evidence なしセルは、検証進捗・ダッシュボード・エクスポート警告の総セル数に含める。これは AI 未抽出セルも人間が `edit` / `reject` / `not_reported` で明示判定するためで、未判定のままなら残数として表示する |
| | anchor failed 項目 | フォーム側に quote 全文 + 「本文内を検索」ボタン。ハイライトは描画しない |
| | 「AI で再特定」（relocate-quote skill。issue #94） | anchor failed 項目に「本文内を検索」と並べて `.verify__quote-relocate` ボタンを出す（テキスト層が無い文書では出さない）。**実行中**: ボタン disabled + 文言「AI で再特定中…」。**成功**: quote アンカリング失敗行の代わりに Evidence 追記済みの新行（`relocated_from` に元行を記録。§3.2「quote の再特定」）へ差し替わり、通常のハイライト UI（ジャンプ / 複数一致切替）へ即座に切り替わってハイライトへスクロールする（テキストモード表示中は抽出テキストビューのスニペットを差し替える）。**not_found・失敗**: `.verify__quote-relocate-not-found`「AI でも見つかりませんでした。本文内検索をお試しください」を表示し、ボタンは再度有効に戻る（LLM が見つからなかった場合・応答が壊れている場合・再アンカリングに失敗した場合をまとめて同じ表示にする） |
| | `no_text_layer` document × bbox あり（§7.4 PR4・Q7 改訂） | 表示中文書がテキスト層なし、かつ当該文書を出所とする Evidence に bbox（`box_2d` 由来の座標）を持つ行が 1 件以上あるとき、PDF に AI が推定した座標ハイライトを描画する（`.pdf-viewer__hl`。クリックで対応セルへフォーカス、セルカードの「ハイライトへ移動」も有効になる）。左ペインに「この PDF はテキスト層がありません。AI が推定した座標ハイライト（bbox）を表示しています。位置は機械検証できないため、必ず quote 全文と照らして検証してください」バナー。bbox は機械検証できないため quote 全文表示・本文照合と必ず併用する。「本文内を検索」ボタンは出さない（テキスト層がないため） |
| | `no_text_layer` document × bbox なし | 表示中文書がテキスト層なし、かつ bbox を持つ Evidence が 1 件もないとき（非対応モデルの run・壊れた box 等）、PDF は表示するがハイライトなし。全項目が quote 全文 + ページヒント表示。「本文内を検索」ボタンは出さない（テキスト層がないため）。左ペインに「この PDF はテキスト層がないためハイライト検証は使えません」バナー（文書切替タブで別文書に移ると表示中文書に応じて出し分け） |
| | 左ペイン表示切替（PDF / 抽出テキスト。issue #28 案2） | 左ペイン上部に `.verify__view-toggle`（「PDF」/「抽出テキスト」ボタン。`aria-pressed` で状態表示）。パネル単位の状態で既定は PDF。表・段組み・脚注は PDF でしか確認できないため置き換えではなく切替。項目フォーカス / 根拠クリック（「ハイライトへ移動」・f キー）/ 判定自動送りのたびに、PDF モードは従来どおりページジャンプ、テキストモードは抽出テキストビュー（下記）のスニペットを当該 Evidence の文脈へ差し替える。文書自動切替（`Evidence.document_id` への切替）は両モードで従来どおり機能する。表示中文書に抽出テキストが無い（`no_text_layer` / 抽出失敗で全ページ空文字）ときは「抽出テキスト」ボタンを disabled（ツールチップ + 近傍注記で理由を表示）にし、テキストモード中にそのような文書へ自動切替した場合は PDF モードへ自動で戻す |
| | 抽出テキストビュー | 3 状態: (1) 根拠未選択（項目未選択、または AI 抽出のない項目にフォーカス中） — 案内文言のみ。(2) スニペット表示 — 出所文書（ファイル名 + role）/ ページ番号 / 引用前後の文脈（前後 400 字。`features/verification/textContext.ts`。ページ境界をまたいで連結しない）+ 引用箇所を `<mark>` で強調。(3) 再特定不能（quote が抽出テキスト上で見つからない） — 引用全文 + 「抽出テキスト上に根拠箇所を再特定できません」の案内 |
| | 複数一致 | 「他 n 箇所に一致」リンク。クリックでハイライト切替 + PDF スクロール |
| | 保存失敗（オフライン） | 判定チップは楽観更新しつつ、`#verify-queued`「オフライン: N 件キュー中」。復帰後の再送成功でキュー表示が消える |
| | 保存の競合検出（issue #64。楽観ロック） | annotator 行（StudyData / ResultsData）の `updated_at` を読み込み時の版として送り、書き込み直前にシート側と一致するか検証する（`upsertStudyDataRows` / `upsertResultsDataRows`。ai 転記・consensus 書き込み・オフラインキュー再送はチェックしない）。同一 annotator が別コンテキストで既に上書きしていた等の不一致を検出すると保存を中断し、キューへは退避せず `#verify-conflict-warning`（`role="alert"`）「読み込み後に別の場所で更新されています。再読み込みしてから判定し直してください」+ 「再読み込み」`#verify-conflict-reload`（表示中 study の検証データ束を読み直す）を表示する。`#/pilot` 埋め込み検証にも同じ id で表示する（同時に 1 画面しか出ないため共有可） |
| `#/dashboard` | 読み込み中 | `#dashboard-loading`「進捗を読み込んでいます…」（Evidence がある study 一覧 + Decisions を読む間。初回表示時に自動読込） |
| | 読み込み失敗 | `#dashboard-load-error`「進捗を読み込めませんでした: {理由}」（`role="alert"`）+ 再読み込み `#dashboard-reload` |
| | 0 件 | `#dashboard-empty`「まだ抽出がありません。」+ `#/extract` への導線リンク（AI 抽出済み study が 0 件のとき。ガードなしで遷移できるルートのための空状態） |
| | 通常 | サマリ `#dashboard-summary`（検証進捗 = 判定済み n / 総セル m + %、**AI 採用率 = accept n / 判定済みセル m + %**〔人が無修正で承認した割合。分母 = 判定済みセル〕、**AI 精度内訳** = 承認 / 修正 / 棄却 / 報告なしの件数〔人の判定 = AI 出力への変更を種別集計。undo 反映後の現在セル状態基準〕、anchor 失敗率 = failed n / アンカリング対象 m + %〔分母 = `anchor_status` 非 null の Evidence〕、not_reported 率 = n / Evidence 総数 m + %。分母 0 は「—」）+ マトリクス `#dashboard-matrix`（`<table>`。1 行 = 1 study〔`<th scope="row">` = study_label〕× 列 = section〔スキーマ登場順の和集合〕。セル = 「判定済み n / m」のリンク → `#/verify?study={study_id}&entity={entity_key}`〔entity = セクション先頭セルの entity_key。セル単位ディープリンク — ui-flow.md §3〕。当該 study のスキーマにない section / セル 0 件は「—」でリンクなし）+ 行末に study 別の **AI 採用率**〔`title` に精度内訳〕・anchor 失敗率・not_reported 率列。study の Evidence は配下の全文書ぶんを合算する。進捗・rate・精度の集計は自分の annotator 行基準（検証画面の進捗チップと同じセルモデル） |
| `#/export` | 読み込み中 | `#export-loading`「エクスポート素材を読み込んでいます…」（Documents / StudyData / ResultsData / Evidence / Decisions / ExtractionRuns / 最新版 SchemaFields を読み、3 形式の CSV をメモリ上で構築する間。初回表示時に自動読込） |
| | 読み込み失敗 | `#export-load-error`「エクスポート素材を読み込めませんでした: {理由}」（`role="alert"`）+ 再読み込み `#export-reload`。確定済みスキーマが 1 版もない場合もこの状態（ガード `dataRows ≥ 1` を満たす以上通常は起きない防御） |
| | 通常 | 形式選択ラジオ `#export-format`（study_wide / results_long / audit / **r_set**〔issue #60。R セット（推奨）。§3 の別行参照〕。各形式に 1 行の用途説明）+ **論文 Methods 記載例カード**`#export-methods`（issue #67。docs/methods-boilerplate.md 準拠。言語タブ `#methods-lang-en` / `#methods-lang-ja`〔既定 English〕× ワークフロートグル `#methods-workflow-single` / `#methods-workflow-dual`〔既定 単一レビュアー。二重独立も v0.11 実装済みのため両方有効〕+ 読み取り専用本文 `#methods-text`〔`{{tool_version}}` = manifest version、`{{model_id}}` / `{{provider}}` = `run_type=full` 完了 run の実績、`{{n_pilot}}` = `run_type=pilot` 対象 study 数、`{{n_scanned}}` = `no_text_layer` 文書数〔> 0 のときだけスキャン PDF のオプション文を連結〕を自動反映。`{{n_sample}}` / `{{reviewer_initials}}` / `{{adjudicator_initials}}` / `{{supplement_ref}}` は常にプレースホルダのまま〕+ 「コピー」`#methods-copy`（クリップボードへコピー + トースト「コピーしました」）+ 未反映プレースホルダが残る場合の注意書き `#methods-unresolved-note`「{{ }} の箇所はご自身の情報に置き換えてください」。素材未読込時はカード自体を出さない）+ 選択形式のサマリ `#export-summary`（`<dl>`: データ行数 / 対象文献数〔= CSV に行が出た文献数。`ExportLog.document_count` と同値〕/ 未検証セル数〔study_wide = 確定 annotator 行の空セル数・audit = 判定 0 件セルのプレースホルダ行数・results_long は概念がなく「—」〕）+ 除外警告（確定 annotator を特定できず除外した文献 `#export-skipped`〔study_label 列挙。0 件なら非表示〕/ field_id 不整合で除外した行数 `#export-dropped`〔0 件なら非表示〕）+ プレビュー `#export-preview`（`<table>`: ヘッダ + 先頭 10 データ行。11 行以上は「…他 {n} 行」注記 `#export-preview-more`）+ 生成ボタン `#export-generate`「CSV を生成して Drive に保存」。**データ行 0 件の形式は生成ボタンを無効化** + 案内文。形式切替でサマリ・プレビュー・警告が追随する |
| | 未検証セル残存（警告） | `#export-generate` クリック時、選択形式の未検証セル数 > 0 なら確認ダイアログ `#export-warning`（`role="alertdialog"`）「未検証の項目が {n} 件あります。」+ `.export__warning-note`「サブセット抽出（一部項目のみを対象にした実行）が行われている場合、未検証セルの中には意図的に未抽出のままの項目が含まれている可能性があります。」（issue #80 A-3。全形式共通・分母や集計ロジックは不変更）+ audit 形式では「audit.csv では未検証セルが判定列空のプレースホルダ行として明示されます」の注記 + 「続行して生成」`#export-warning-continue` / 「中止」`#export-warning-cancel`。**続行を経ずに生成は始まらない**（未検証 0 件なら即生成） |
| | 生成中 | `#export-generating`「CSV を生成して Drive に保存しています…」+ 生成ボタン・形式ラジオを無効化 |
| | 生成失敗 | `#export-generate-error`「エクスポートに失敗しました: {理由}」（`role="alert"`）。生成ボタンは復帰し再試行できる |
| | 生成完了 | 結果カード `#export-result`: 「{filename} を Drive に保存しました（ExportLog に記録済み）」+ Drive リンク `#export-result-link`（`webViewLink`。`target="_blank"`）+ ローカル保存 `#export-download`（Blob ダウンロード）。形式を切り替えて続けて生成できる（結果カードは次の生成開始まで残す）。Drive 保存先は プロジェクトフォルダ直下の `exports/`（初回生成時に作成）、ファイル名は `{format}_{YYYYMMDD-HHMMSS}.csv` |
| `#/export`（R セット。issue #60 PR-B・2026-07-12） | 通常（r_set 選択時） | 通常状態の形式選択ラジオ・Methods カードは共通のまま、選択形式の内容が差し替わる: サマリ `#export-rset-summary`（`<dl>`: ファイル数〔常に 8〕/ データ行数〔tab1 + ma + rob の合計〕/ 未検証セル数/ export_issues 件数）+ ファイル一覧 `#export-rset-files`（`<ul>`: ファイル名ごとの行数。`export_manifest.json` のみ行数概念なし）+ プレビュー `#export-rset-preview`（`<table>`: **ma.csv** のヘッダ + 先頭 10 行。8 ファイルのうち最も参照頻度が高い解析単位表を代表として表示）+ 生成ボタン `#export-generate`「8 ファイルを生成して Drive に保存」。**データ行 0 件（tab1 / ma / rob の合計）は生成ボタンを無効化** + 案内文「R セットで出力できるデータ行がありません。」 |
| | 未検証セル残存（警告） | `#export-generate` クリック時、`export_issues.csv` の `unverified_cell` 件数 > 0 なら確認ダイアログ `#export-warning`（`role="alertdialog"`。従来 3 形式と共通コンポーネント）「未検証の項目が {n} 件あります。」+ サブセット抽出の注意書き（issue #80 A-3。`#export-warning` 共通のため R セットにも出る）+「R セットでは未検証セルは値列を空にし、ステータス列（tab1_status.csv / ma_status.csv / rob.csv）と export_issues.csv に明示されます。」の注記 + 「続行して生成」/「中止」 |
| | 生成中 | `#export-generating`「8 ファイルを生成して Drive に保存しています…」+ 生成ボタン・形式ラジオを無効化 |
| | 生成失敗 | `#export-generate-error`「エクスポートに失敗しました: {理由}」（`role="alert"`）。生成ボタンは復帰し再試行できる |
| | 生成完了 | 結果カード `#export-rset-result`: 「{folderName} フォルダに 8 ファイルを Drive に保存しました（ExportLog に記録済み）。」+ Drive フォルダリンク `#export-rset-result-link`（`target="_blank"`）+ ファイル一覧 `#export-rset-result-files` + ローカル保存 `#export-rset-download`（8 ファイルを個別ダウンロード。zip 化はしない）+ UTF-8 案内文 `#export-rset-utf8-note`「CSV は UTF-8（BOM なし）で保存されます。Excel でダブルクリックで開くと日本語が文字化けすることがあります。Excel で開く場合は『データ > テキストまたは CSV から』で文字コード UTF-8 を指定してください。R の readr::read_csv() はそのまま読み込めます。」（D-6 の初心者向け説明）。Drive 保存先はプロジェクトフォルダ直下 `exports/` 配下のサブフォルダ `rset_{YYYYMMDD-HHMMSS}/`。`ExportLog` は既存列のみで表現（`format='r_set'` / `file_ref`=サブフォルダの `webViewLink` / `study_count`=tab1.csv の行数。design-r-export.md §13.3） |
| `#/adjudicate`（S12・v0.11。owner / adjudicator のみ到達可能） | 読み込み中 | `#adjudicate-loading`「裁定対象を読み込んでいます…」（human annotator 2 名の検証状況を読む間） |
| | 読み込み失敗 | `#adjudicate-error`（`role="alert"`）+ 再試行 `#adjudicate-retry` |
| | 一覧（空） | `#adjudicate-empty`「裁定対象となる研究がありません。#/documents で文献を取り込み、2 名のレビュアーによる検証が完了すると一覧に表示されます。」 |
| | 一覧（study ごと・ゲート付き） | `#adjudicate-list`（`<table>`。1 行 = 1 study）。対象 annotator が 2 名確定していない行（両者の検証待ち・annotator を一意に特定できない）は `.adjudicate__list-row--dimmed` で「両者の検証完了待ちです」/「対象 annotator を特定できません」を表示し裁定を開始できない。ゲート達成行のみ両者の完了状況「A（email）: n/m・B（email）: n/m」+ 「裁定を開始」ボタン（**内訳は完了状況の件数のみ。値・判定内容は一覧では見せない = 盲検の継続**） |
| | レビュアー間一致度カード（一覧画面のみ・`#adjudicate-agreement-card`。issue #66） | オンデマンド計算（画面入場時の自動読込はしない = Sheets 読み出しを増やさないため）。未計算: 説明文 + 「一致度を計算」`#agreement-load`。計算中: `#agreement-loading`「一致度を計算しています…」。失敗: `#agreement-error`（`role="alert"`）+ `#agreement-load` で再試行。対象なし（ready ペア 0 件 or 確定済みスキーマなし）: 計算は成功として扱い `#agreement-error`（`role` なし）で案内するのみ（**エラーではない** = `agreementError` は読み込み自体の失敗専用、対象なしは studyCount=0 の空レポートで表現する実装上の判断）。表示: サマリ行 `#agreement-summary-line`「対象研究 n 件・全体一致率 x.x%・全体 κ y.yy」+ 項目別 `#agreement-table`（項目 / 対象セル / 一致 (%) / κ。null は「—」）+ 不一致セル一覧 `#agreement-disagreements`（study / entity_key / 項目 / A 値 / B 値。未入力は「未入力」表示）+ CSV 保存ボタン `#agreement-csv-summary` / `#agreement-csv-disagreements`（ローカル Blob ダウンロード）+ 注記 2 本（分母は両者入力済みセルのみ・κ「—」の意味）。一致率・κ の対象は human annotator ちょうど 2 名の study（`resolveAnnotatorPair` の ready）のみで、study によってペアが異なっても項目単位で全 study をプールして集計する（`features/adjudication/agreement.ts`） |
| | 群構成の突き合わせ（裁定中・`adjudicate-arm-card`） | 未確定のとき: 両者の最新 `ArmStructures` を「A」「B」の 2 列で列挙（位置対応）。本数・名称が一致 → 一致注記 + 「このまま採用」`#adjudicate-arm-adopt`。不一致 → 警告文（`role="alert"`）+ 編集フォーム（群ごとの名称入力 + 削除、「群を追加」`#adjudicate-arm-add`、「確定」`#adjudicate-arm-confirm`）。確定済みのときはカードが要約表示（確定した群名一覧）に変わる。arm / outcome_result レベルのセルは群構成確定までロック（`.adjudicate__locked-note`「群構成の確定が必要です」）。`rob_domain` と study レベルのセルは群構成未確定でも裁定可 |
| | セル一覧（裁定中・`adjudicate-cells`） | 「不一致のみ表示」チェックボックス `#adjudicate-filter-mismatch`（既定 ON = 不一致のみ表示）+ 「一致セルを一括採用」`#adjudicate-accept-all` + サマリ `#adjudicate-summary`「一致 n 件 / 不一致 m 件」。表示するセルが 0 件（フィルタ適用時）は `#adjudicate-cells-empty`。各セル行 = 区分（section / entity ラベル）/ 項目（`schema_version` 不一致は警告バッジ併記）/ A の値 / B の値 / 状態チップ（一致 / 不一致 / 裁定済み〔採用・編集・棄却・未報告〕/ スキップ）/ 裁定操作。未裁定セルの操作は「A を採用」`.adjudicate__action--choose-a` / 「B を採用」`.adjudicate__action--choose-b` / 第 3 の値入力 + 「入力して確定」`.adjudicate__action--custom` / 「未報告」`.adjudicate__action--not-reported` / 「スキップ」`.adjudicate__action--skip`。裁定済みセルは確定値表示 + 「取り消し」（undo）。スキップ済みセルは「スキップを取り消す」 |
| | PDF 参照ペイン（issue #63 で Evidence ハイライト対応） | 表示 + ページ送り / ズーム / テキスト検索（`app/views/adjudicatePdfPane.ts`）に加え、表示中文書の AI 根拠（Evidence）を矩形ハイライト表示する（`features/verification/highlights.ts` の `buildDocumentHighlights` を検証画面と共通利用。色分けは検証画面と揃えず一律「未検証」相当の黄色に簡略化）。study に Evidence が 1 件も無い（独立入力のみのペア）ときは `.adjudicate__no-evidence-note` で案内する。セル一覧の「根拠を表示」`.adjudicate__evidence-button`（AI の Evidence があるセルのみ表示）をクリックすると、該当 Evidence の出所文書へ切替え（2 文書以上のときはタブも切替）+ ハイライトへジャンプする（`focusAdjudicateEvidence`。ロード中に呼ばれた場合はロード解決後に 1 回だけ適用） |
| | Decisions.note の表示（issue #63） | 各セル行の A / B の値の下に、該当 annotator の直近の `Decisions.note`（あれば）を `.adjudicate__cell-note`「A のメモ: …」/「B のメモ: …」の形で表示する（`features/adjudication/cellMatch.ts` の `buildAdjudicationCells` が study 内の該当 annotator の Decisions を decided_at 最新の 1 件へ畳み込む）。note が無ければ表示しない |
| | 書き込み | 裁定操作は consensus 行（`StudyData` / `ResultsData`）の upsert + `Decisions` 追記（`decided_by` = 裁定者）。即時保存に失敗した場合は検証側（S6/S8）と**共有する 'decisions' オフラインキュー**へ退避し（issue #63）、次回の裁定操作が成功したタイミングでキューに残る過去の退避分（判定・裁定どちらも）をまとめて再送する。キュー退避中でも人間の判断は確定済みとして扱い、セル状態は楽観反映する（`working.consensusDecisions` へ即時追加）。退避件数は作業画面ヘッダの `#adjudicate-queued`「オフライン: n 件キュー中」で示す。楽観ロック（issue #64）は consensus 書き込みには導入しないため、競合検出（conflict バナー）は無い |

## 4. キーボードショートカット・検証パネルのフォーカス挙動

[ui-flow.md §7](ui-flow.md) のキー操作は `#/verify` がアクティブな時のみ反応する。入力フィールドにフォーカスがある間は判定キー（`a` / `x` / `n`）を発火させない（`e` で入った編集中に `a` と打って accept 誤爆しないこと）。キー割当・「今判断すべき変数」を上に出す考え方はレイアウトモード共通だが、`j` / `k` / `h` / `l` の意味と `z` の対象セルはモードによって異なる（下記）。

**既定はフォーカスモード**（issue #38。`#verify-layout-toggle` でリストモードへ切替可・設定は S6 / S8 で共有）。**一括承認ボタンは置かない**（automation bias 対策: accept にも 1 操作必須という原則をユニット単位のマトリクス表示でも崩さない）。

### リストモード時

判定済みセルはタブ末尾へ送り、未判定セルが常に上に残る 1 セル 1 カードの一覧表示（現行の従来 UI）：

- **初期フォーカス = 最初の未判定セル**: 画面を開いた直後・タブ切替時のフォーカスは、そのタブで最初の未判定（`unverified`）セルへ当てる。判定済みセルから作業が始まらないようにする。全セル判定済みならタブ先頭セル、セルが無ければフォーカスなし
- **判定済みブロック**: 未判定セルはスキーマ順のまま上に残し、判定済みセルはタブ末尾の「判定済み（n）」セクション `.verify__group--decided` へ移す。判定済みセルはコンパクト行（判定チップ + 項目ラベル + グループ見出し + 確定値の 1 行 `.verify__cell--decided`。判定操作ボタンなし）で表示し、クリックまたは `j` / `k` での着地で通常カードに展開（「たたむ」`.verify__decided-collapse` でコンパクトへ戻す）。所属グループの全セルが判定済みになったらグループ見出しごと上から消える
- **直近判定の 1 件は元の位置に残す**: 判定直後の見直し・`z`（戻す）のため、最後に判定したセルだけは判定済みブロックへ送らず元の位置に通常カードのまま残す。次の判定で入れ替わりに判定済みブロックへ移る
- **判定後の自動遷移**: `a` / `e` / `x` / `n` の判定確定後、現在セルの次以降（末尾まで無ければ先頭へ回り込む）で最初の未判定セルへフォーカスを自動的に移す（`j` の手動送りが不要）。判定済みセルはスキップする。全セル判定済みなら現在セルに留まる。PDF ハイライトも遷移先へ追従する
- **`z`（戻す）は留まる**: undo は取り消し直後に同じセルで再判定するため、フォーカスを動かさない。取り消しでセルが未検証へ戻ると元のスキーマ順の位置（上のブロック）へ戻る
- **`j` / `k` / `↑` / `↓`**: 表示順（未判定 + 直近判定 → 判定済みブロック）で 1 セルずつ移動する
- **`h` / `l` / `←` / `→`**: リストモードでは無効（フォーカスモード専用キー）
- **スクロール位置の保持**: 判定のたびにフォームペインを作り直すが、スクロール位置を退避・復元して先頭へ飛ばさない。遷移先セルが画面外のときだけ最小移動で見せる

### フォーカスモード時

「検証ユニット」（マトリクスカード 1 枚。§3 `#/verify` の「レイアウトモード」行を参照）単位で移動する：

- **初期フォーカス = 最初の未判定ユニットの最初の未判定セル**: 画面を開いた直後・タブ切替時は、未判定セルを含む最初のユニットの、行優先で最初の未判定セルへ当てる。全ユニット判定済みなら先頭ユニットの先頭セル、ユニットが無ければフォーカスなし
- **判定後の自動遷移**: 判定確定後は同一ユニット内の次の未判定セル（行優先・折り返しなし）→ 無ければ次の未判定ユニットの最初の未判定セル（末尾まで無ければ先頭ユニットへ回り込む）→ それも無ければ現在セルに留まる
- **`j` / `k` / `↑` / `↓`**: ユニット内の**行**移動（同じ列を維持。端で停止。null セル〔存在しないセル〕はスキップ）
- **`h` / `l` / `←` / `→`**: ユニット内の**列**移動（同じ行を維持。端で停止。null セルはスキップ）
- **`Shift+J` / `Shift+K`**: **前後のユニットへ移動**（判定状況に関係なく移動し、着地はそのユニットの最初の未判定セル → 無ければ先頭セル）。端では停止する（折り返さない）。マウスではユニットヘッダの前後移動ボタン（issue #82。`.focus-card__nav--prev` / `.focus-card__nav--next`）が同じ着地ロジックを呼ぶ
- **`z`（戻す）は直近判定セルへ効く**: リストモードと異なり、フォーカス中セルではなく**直近判定セル**（`#verify-focus-recent` に固定表示）の undo を行う。ユニットをまたいでも効く。直近判定が無ければフォーカス中セルへの undo（無害）
- **`a` / `e` / `x` / `n` / `f`**: 現行どおりフォーカス中セルへ作用する
- 詳細ストリップ（マトリクス下の判定操作カード）は常に同じ構造で表示するため、判定のたびにカードの高さが大きく変わらない

## 5. レビュー時のチェックリスト（人 + AI 共通）

1. 該当画面の章をこの spec から探す
2. 状態を 1 つずつ手元 / Playwright で再現できるか確認
3. `hidden` のものが本当に画面に見えていないか（bounding box または `getComputedStyle().display` で見る）
4. ステータス文言・エラーメッセージの文字列がここに書いてある通りか
5. `aria-live` / `<label for>` の書き忘れは目視でも見る

不一致を見つけたら、まずこの spec が正しいかを疑い、両者を一緒に直す。
