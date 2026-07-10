# ハンドオフ: 一括抽出の Sheets 書き込み 429 対策（バッチ化 + リトライ）

2026-07-10 起票。想定読者 = **ジュニア SE**（この拡張のコードに初めて触れる人）。
前提の並列化ハンドオフ [docs/handoff-20260710-throughput.md](handoff-20260710-throughput.md) の続き。

---

## 0. 3 行まとめ（TL;DR）

- 一括抽出を**並列実行（同時実行数を上げる）**したら、**Google Sheets API が HTTP 429（書き込みクォータ超過）**を返した。
- 原因は「**Sheets の書き込みが 60 回/分/ユーザーの上限**」に対して、**study ごとに 1 回書き込んでいる**ため、並列だと短時間に集中して超過するから。Gemini（AI）側の 429 ではない。
- 対策は 2 本立て: **① Evidence の書き込みを N study ごとにまとめる（バッチ化）** + **② `googleFetch` に 429 リトライを足す**。このドキュメントを読めば、なぜそうするか・どこを直すかが分かる。

---

## 1. 前提知識: この拡張の「DB は Google Sheets」

まずここを理解しないと話が始まらない。

- この拡張はサーバーを持たない。**Google スプレッドシートを DB 代わり**に使い、**Drive をファイル置き場**に使う。
- 抽出した結果は、スプレッドシートの各タブ（`Evidence` / `StudyData` / `ResultsData` / `ExtractionRuns` など全 14 タブ）に**行を追記**して保存する。
- 保存 = **Google Sheets API へのネットワークリクエスト**。ここにレート上限がある。

### 用語

| 用語 | 意味 |
|---|---|
| study | 1 つの臨床試験。抽出・検証の単位。1 study = 1 つ以上の PDF 文書 |
| batch（バッチ） | 抽出計画（`planRun`）が作る処理単位。基本 **1 batch = 1 study**（1 回の AI 呼び出し） |
| Evidence | AI が抽出した各値の「根拠（verbatim quote）」。study ごとに複数行できる |
| 一括抽出 | S7 `#/extract` 画面。採用文献をまとめて AI 抽出する機能。S6 パイロットも同じ実行系 |

---

## 2. 何が起きたか（バグの再現）

1. Options → レート制限 → **カスタム** tier にして **同時実行数（maxConcurrency）を 4〜8** に上げた（＝並列化。[docs/handoff-20260710-throughput.md](handoff-20260710-throughput.md) の実験）。
2. `#/extract` で複数 study を一括抽出。
3. 途中で `Google API failed: HTTP 429` が発生し、一部 study が `save_failed`（partial_failure）になった＝**抽出はできたが Sheets に保存できていない**。

### これは Gemini の 429 ではない

同じ 429 でも 2 種類ある。混同しないこと。

| | Gemini（AI）API | **Google Sheets API（今回）** |
|---|---|---|
| 何のリクエスト | 本文を送って抽出結果をもらう | 抽出結果を**スプレッドシートに書く** |
| 上限 | RPM（Tier 3 = 1800/分）/ TPM | **書き込み 60 回/分/ユーザー** |
| 既存の対策 | `withThrottle` + `withRetry`（[rateLimitPolicy.ts](../src/lib/llm/rateLimitPolicy.ts)）で対策済み | **対策なし**（← ここが穴） |

エラー文言 `Google API failed: HTTP 429` は Sheets/Drive 共通ラッパ [src/lib/google/types.ts:43](../src/lib/google/types.ts#L43) の `googleFetch` が投げる。**このラッパには 429 リトライが一切ない**（非 2xx を即 throw する）。

---

## 3. 根本原因: Sheets の書き込みクォータ

### Sheets API v4 の既定クォータ（2026-07 時点）

| 種別 | per プロジェクト | **per ユーザー / プロジェクト（実効ボトルネック）** |
|---|---|---|
| **書き込み**リクエスト / 分 | 300 | **60** |
| 読み取りリクエスト / 分 | 300 | **60** |

- **1 日あたりの上限は現在なし**。効くのは「分あたり」だけ。
- カウント単位は「**API リクエスト回数**」。1 回のリクエストで**何行書いても 1 とカウント**（行数は無関係）。
- スコープは **スプレッドシート単位ではなく (ユーザー × Cloud プロジェクト) 単位**。この拡張から出る全 Sheets 呼び出しが同じ 60/分バケットを共有する。→ **シートを分けても回避にならない。**
- クォータは Google Cloud Console → APIs & Services → Sheets API → Quotas で確認・増枠申請できるが、BYOK/OSS 配布では各ユーザーのプロジェクト依存になるので、**コード側で 60/分前提に作る**のが正解。

### 1 回の run で Sheets に何回書いているか

コードを追うと、1 回の抽出 run でこれだけ書いている（[src/app/services/extractionService.ts](../src/app/services/extractionService.ts)）:

| # | 書き込み | 回数 | 実行タイミング | コード |
|---|---|---|---|---|
| ① | `appendExtractionRun`（running 行） | 1 | run 開始時 | extractionService.ts:172 |
| ② | **`appendEvidence`** | **study ごとに 1** | executeRun 中（**並列部分**） | executeRun.ts:397 付近 |
| ③ | `upsertStudyDataRows` / `upsertResultsDataRows` | 初回は追記でまとめて 1、**既存行の再抽出は行ごとに `updateRow` 逐次** | run 完了後 | annotationRepository.ts:206, 334 |
| ④ | `appendExtractionRun`（完了行） | 1 | run 完了時 | extractionService.ts:224 |

**②が今回の主犯。** 逐次なら study を 1 本ずつ処理するので `appendEvidence` も 1 本ずつだったが、**並列（同時実行数 8）にしたことで短時間に②が集中**し、60/分を超えた。

`executeRun` の該当箇所（[src/features/extraction/executeRun.ts](../src/features/extraction/executeRun.ts)）:

- バッチ処理関数 `processBatch` の末尾で **バッチごとに `await deps.appendEvidence(rows)`**（executeRun.ts:397 付近）。
- ループ本体は逐次 `for...of` ではなく、同時実行数上限つきワーカープール `runWithConcurrency(input.plan.batches, concurrency, processBatch)`（executeRun.ts:409-410）。`concurrency = deps.maxConcurrency`。**1 なら従来どおり逐次、2 以上で並列。**

### ③にも小さい穴がある

[annotationRepository.ts:206-215](../src/features/extraction/annotationRepository.ts#L206) / [:334-348](../src/features/extraction/annotationRepository.ts#L334) を見ると、upsert は**既存行を「1 行ずつ `updateRow`」**で更新する（新規行は `appendRows` でまとめて 1 回）。

- **初回抽出**（新規行）→ `appendRows` でまとめて書く＝軽い。
- **再抽出 / 再試行**（既存行あり）→ 行数ぶん `updateRow` を逐次で叩く＝ study 数に比例して書き込みが増える。

③は run 完了後に逐次実行なので②ほど急には集中しないが、**再試行を繰り返すと単体でも 60/分に触れうる**。だから②のバッチ化だけでは塞ぎきれず、②のリトライ保険（後述②）が要る。

---

## 4. なぜ「5 study ごと」で 5 倍さばけるのか

いまは **study ごとに 1 回**書いている（20 study → `appendEvidence` 20 回）。

これを **5 study ぶんメモリに貯めて、まとめて 1 回**書けば → 書き込みは **4 回**（20 ÷ 5）。

書き込み回数が **1/5** になるので、同じ 60/分の枠で **約 5 倍の study** をさばける。`values.append` は**何行書いても 1 リクエスト**なので、まとめても保存内容は同じ。

```
今:   [study1 書く][study2 書く][study3 書く][study4 書く][study5 書く] … 20 回
後:   study1〜5 の Evidence をメモリに貯める → まとめて 1 回書く … 4 回
```

**重要な誤解ポイント**: これは **AI（Gemini）リクエストをまとめる話ではない**。AI は今まで通り study ごとに呼ぶ。変わるのは「**抽出できた結果を Sheets にいつ・何回に分けて書くか**」だけ。

- **AI 並列化（既存 PR #34）** = Gemini を速く回してスループットを上げる
- **Sheets バッチ化（本タスク）** = 書き込み回数を減らして 429 を出さない土台

の役割分担。

---

## 5. 対策の設計

### ① Evidence 書き込みのバッチ化（本タスクの主目的）

`executeRun` を「バッチごとに即書き」から「**貯めて N study ごと + 最後にまとめて書く**」へ変える。

- Evidence 行を**メモリバッファ**に貯める。
- **N（既定 5）study 分たまったら**、または**全 study 完了時**に `appendEvidence` でまとめて書く。
- **フラッシュ失敗時**は、そのフラッシュに含まれる study を **全部 `save_failed`** にして partial_failure に記録 → S7 の再試行で拾えるようにする。
- N は将来チューニングできるよう**パラメータ化**（サービス層から注入。既定 5）。

**設計上の注意（並列との整合）**:
- 共有バッファへの `push` は JS が単一スレッドなので競合しない。ただし「N たまったらフラッシュ」の判定とフラッシュ実行が `await` を跨ぐので、**複数ワーカーが同時にフラッシュ条件を満たす**ケースを考慮する（二重フラッシュ防止 or 素直に「フラッシュ中フラグ / 直列化」する）。迷ったら**フラッシュ処理自体は直列化**（1 度に 1 フラッシュ）でよい。書き込みを減らすのが目的なので、フラッシュが直列でも問題ない。

**耐中断性への影響（結論: 問題なし）**:
- 「中断された run の study は未抽出に戻して再抽出する」のが現行モデル（`ExtractionRuns` の 2 行プロトコル。完了行のあ--run だけが「抽出済み」と数えられる。[docs/requirements.md](requirements.md) §4.3）。
- つまり**中断時は Evidence を per-study で保存していようがいまいが、その run の study は全部やり直す**。→ per-study 保存に耐中断メリットは元々ない。**貯めて最後に書いても後退しない。**

### ② `googleFetch` に 429 / 503 リトライを足す（保険 & ③対策）

[src/lib/google/types.ts](../src/lib/google/types.ts) の `googleFetch` に、指数バックオフのリトライを入れる。

- 対象ステータス: **429**（クォータ）と **503**（一時的な不可用）。
- サーバ提示の **`Retry-After` ヘッダ**があれば尊重する（Gemini 側の `retry.ts` と同じ考え方 → [src/lib/llm/retry.ts](../src/lib/llm/retry.ts) の `parseServerRetryDelayMs` が参考になる）。
- 指数バックオフ + **上限（maxDelayMs）** + できれば軽いジッタ（並列時のサンダリングヘッド緩和）。
- 400/401/403/404 など**リトライしても無駄なエラーは即 throw**（今の挙動を維持）。
- これで **② の取りこぼしも ③ の per-row updateRow も、全 Sheets 呼び出しがまとめてカバー**される。

**なぜ両方やるか**: ①だけだと③の穴が残る。②だけだと「待てば通る」を自動化できるが、書き込み回数自体は減らないので**根本的にクォータが厳しい時に弱い**。**①で回数を減らし、②で瞬間的な超過を吸収**する、の合わせ技が堅い。

---

## 6. 実装の進め方（推奨手順）

> 作業原則（[CLAUDE.md](../CLAUDE.md) / tiab-review-plugin/AGENTS.md）: **master で直接作業しない**・**日本語でコミット/コメント**・**jest カバレッジ 100% 必須**・**テスト後に `npm run dev` で webpack 確認**・**UI/ルーティングに触れたら `npm run test:e2e`**。

1. **ブランチを切る**: `git switch -c feat/sheets-write-batching`。
2. **② から先に**（小さくて独立・すぐ効く）: `googleFetch` にリトライを追加。
   - `googleFetch` は `fetch` を注入できる（`GoogleApiDeps.fetch`）ので、**テストは仮想の fetch で 429 → 200 の順に返す**ように書ける。`sleep` も注入できるようにして仮想クロックで待たずにテストする（`retry.ts` のテストが参考になる）。
   - `Retry-After` あり/なし、429/503/400 の分岐、最大試行到達で throw、の各ケースを網羅（100% 必須）。
3. **① Evidence バッチ化**: `executeRun` にバッファ + フラッシュを実装。
   - `deps` に `flushEveryNStudies`（既定 5）を追加し、`extractionService` から注入。
   - 既存の `appendEvidence` 呼び出しを「バッファへ push」に変え、閾値到達 + 最終フラッシュで実書き込み。
   - **フラッシュ失敗 → 含まれる study を `save_failed`**。`RunProgress` / `BatchFailure` の扱いは既存の `save_failed` を踏襲。
   - **既存テストが落ちたら、まず実装のバグを疑う**（作業原則 3）。仕様変更でテストを直す場合はユーザーに確認。
   - テストは**順序非依存**で書く（並列で順不同になるため）。
4. **確認**: `npm test`（100%）→ `npm run dev`（webpack 成功）→ 画面/ルーティングに触れていれば `npm run test:e2e`。executeRun 系の既存ユニット・`app-extract` / `app-pilot` の E2E が緑のままか。
5. **ドキュメント同期**（作業原則 4）: 挙動を変えたら [docs/requirements.md](requirements.md) §4.3 と [docs/handoff-20260710-throughput.md](handoff-20260710-throughput.md) の関連記述を更新。

### 触るファイル（見取り図）

| ファイル | 何をする |
|---|---|
| [src/lib/google/types.ts](../src/lib/google/types.ts) | `googleFetch` に 429/503 リトライ追加（②） |
| [src/features/extraction/executeRun.ts](../src/features/extraction/executeRun.ts) | Evidence バッファ + フラッシュ（①）。`deps.flushEveryNStudies` |
| [src/app/services/extractionService.ts](../src/app/services/extractionService.ts) | `flushEveryNStudies` を executeRun へ注入 |
| （参考）[src/lib/llm/retry.ts](../src/lib/llm/retry.ts) | リトライ実装の手本。`parseServerRetryDelayMs` を流用検討 |
| （参考）[src/features/extraction/annotationRepository.ts](../src/features/extraction/annotationRepository.ts) | ③ per-row updateRow の場所。②のリトライで救われる |

---

## 7. やってはいけない / 注意

- **AI リクエストをまとめようとしない**。今回の対策は Sheets 書き込みの話。AI は study ごとの呼び出しのまま。
- **フラッシュ失敗を握りつぶさない**。失敗した study は必ず `save_failed` にして再試行できるようにする（automation bias 対策の一貫: 保存できていないのに「済み」に見せない）。
- **リトライ対象を広げすぎない**。400/401/403/404 はリトライしても無駄。429/503（+必要なら 500）だけ。
- **機密情報をログに出さない**（作業原則 5）。トークンは `token.substring(0, 8) + '...'`。
- **カバレッジ 100% は CI で強制**。新規分岐は必ずテストする。
- **`flushEveryNStudies` の既定値**は 5 で着手してよいが、最終値は §8 の実測で決める。大きすぎるとメモリ・1 リクエストのセル数上限に近づくので、極端に大きくはしない（数百 study 規模なら途中フラッシュを挟む）。

---

## 8. 完了の定義 / 実測での確認

1. Options → カスタム tier → **同時実行数 4〜8** + RPM 高め（1800）で **10〜20 study を一括抽出**。
2. **Sheets 429（`Google API failed: HTTP 429`）が出ない / 出ても自動回復して `save_failed` にならない**ことを確認。
3. `#/extract` 完了カードが `done`（partial_failure なし）になること。
4. 集計ツールで裏取り: Sheets の `LLMApiLog` / `ExtractionRuns` を CSV 書き出し → `node experiments/throughput/aggregate.mjs`（[experiments/throughput/README.md](../experiments/throughput/README.md)）で 429 率・partial_failure がゼロ付近か。
5. **回帰確認**: 同時実行数 1（逐次）で従来と同じ結果になること（`appendEvidence` の呼び出し回数が減るだけで、書かれる Evidence 行は同じ）。

---

## 9. 参考リンク

- 並列化ハンドオフ（本タスクの前段）: [docs/handoff-20260710-throughput.md](handoff-20260710-throughput.md)
- レート制限ポリシー（Gemini 側 429 対策）: [src/lib/llm/rateLimitPolicy.ts](../src/lib/llm/rateLimitPolicy.ts) / [src/lib/llm/retry.ts](../src/lib/llm/retry.ts) / [src/lib/llm/throttle.ts](../src/lib/llm/throttle.ts)
- 要件（データ設計・2 行プロトコル）: [docs/requirements.md](requirements.md) §3〜§4
- スループット集計ツール: [experiments/throughput/README.md](../experiments/throughput/README.md)

---

## 10. 追補（2026-07-10 続き）: `flushEveryNStudies` の tier 連動 + 1 フラッシュ最大行数キャップ

§7 で「`flushEveryNStudies` の既定値は 5 で着手してよいが、最終値は §8 の実測で決める」としていたが、実測前に**まず tier ごとに固定値を割り当てる形へ発展させた**（実測はまだ実施していない。値は「並列数・RPM が大きい tier ほど書き込みも集中しやすい」という定性的な理屈からの初期値で、実測で調整する前提）。あわせて、study 数だけでなく**バッファの行数にも上限（安全弁）**を設けた。

### A. `flushEveryNStudies` を `RateLimitPolicy` の一部にした

`src/lib/llm/rateLimitPolicy.ts` の `RateLimitPolicy` インターフェイスに `flushEveryNStudies: number` を追加し、tier プリセットごとに値を持たせた:

| tier | flushEveryNStudies |
|---|---|
| `gemini_free` | 5 |
| `gemini_tier1` | 8 |
| `gemini_tier2` | 12 |
| `gemini_tier3` | 15 |
| `custom`（ベース。並列数未指定時） | 5 |
| `unlimited`（`UNLIMITED_POLICY`） | 15 |

**カスタム tier で同時実行数（`maxConcurrency`）を指定した場合**（`editableConcurrency` かつ `customConcurrency` が正の整数）は、`resolvePolicyForTier` が並列数から逆算して上書きする: `flushEveryNStudies = clamp(round(maxConcurrency × 2), 5, 15)`。並列数が書き込み集中の実ドライバなので、そこから決め打ちの N を離れて動かす設計。並列数を指定しない（既定 1）ときはベース値 5 のまま。

`src/app/services/extractionService.ts` の注入値は**優先順位付き 3 段フォールバック**にした:

```ts
flushEveryNStudies:
  deps.flushEveryNStudies ?? policy.flushEveryNStudies ?? DEFAULT_FLUSH_EVERY_N_STUDIES,
```

1. `deps.flushEveryNStudies`（明示注入。主にテスト用）
2. `policy.flushEveryNStudies`（`resolveRateLimitPolicy` が解決した tier のポリシー値。本番はこちらが常用される）
3. `DEFAULT_FLUSH_EVERY_N_STUDIES`（= 5。`policy` 自体が無い/不正なときの最終防波堤。型上は `RateLimitPolicy.flushEveryNStudies` が必須のため通常到達しないが、テストでは型キャストで到達させてブランチカバレッジを確保している）

### B. 1 フラッシュあたりの行数キャップ（安全弁）

`flushEveryNStudies` は「study 数」しか見ないため、1 study の抽出項目数（= 1 バッチの Evidence 行数）が多い場合、バッファが際限なく育みうる。`src/features/extraction/executeRun.ts` の `ExecuteRunDeps` に `maxRowsPerFlush?: number`（既定 `DEFAULT_MAX_ROWS_PER_FLUSH` = 500）を追加し、`maybeFlush` の発火条件を OR に変更した:

```
distinct study 数 >= flushEveryNStudies  または  バッファの総行数 >= maxRowsPerFlush
```

**これは発火トリガーであり、1 フラッシュを厳密に 500 行以下へ分割するものではない**（1 study が 500 行を超えていても、その study 単位では割らずに丸ごと 1 回で書く）。各バッチの push のたびにこの条件を再評価するため、実際にバッファが膨らむ上限は「キャップ + 直近に push された 1 study ぶん」程度に頭打ちになる。二重フラッシュ防止ガード（`flushPromise`）はそのまま維持（`flushPromise !== null` が最優先で早期 return）。

### 迷った点 / 今後

- **tier ごとの値（5/8/12/15）は実測前の初期値**。§8 の完了条件（10〜20 study の一括抽出で 429 が出ない）を tier ごとに回して調整する余地がある。
- **`Math.round` は現状の呼び出し経路では実質 no-op**（`maxConcurrency` は `positiveInt` で必ず整数に floor されてから 2 倍されるため、`clampRound` に渡る値は常に偶数）。将来 concurrency を実数で渡す経路ができた場合に備えた防御的実装として残した。
- **行キャップの既定 500 は未実測**。Sheets 1 リクエストのセル数上限（1 リクエストあたり最大 10M セル、`Evidence` は 1 行あたり 10 列前後）には遠く及ばないため妥当な範囲だが、実データでの調整余地は残る。
