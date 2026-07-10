# ハンドオフ: 一括抽出のスループット実験（Tier 3 の高速化 / 並列実行の可否）

2026-07-10 起票。前提ブランチ `fix/extraction-rate-limit-tiers-2`（429 対策 = レート制限 tier。docs/requirements.md §4.3 / docs/ui-states.md §2「レート制限」）。**実機テスト完了 → PR #30**。

> **2026-07-10 追記（実装ステータス）**: 並列化のコード足場（実験 2 の §3.1）を実装済み（ブランチ `feat/extraction-parallel`。`fix/extraction-rate-limit-tiers-2` 上に構築）。
> - `RateLimitPolicy.maxConcurrency` を追加（`src/lib/llm/rateLimitPolicy.ts`）。**全 tier プリセット既定 = 1（逐次 = 従来と同一挙動 = 回帰の砦）**。`custom` tier のみ Options で 2 以上に設定でき、スループット実験に使う。
> - `executeRun` を逐次 `for...of` → **同時実行数上限つきワーカープール `runWithConcurrency`** へ置換（`maxConcurrency=1` は 1 本のワーカーが index 順に逐次処理 = 従来と同一）。`loadDocument` を**値キャッシュ → Promise キャッシュ**へ変更し、並行 miss でも同一文書のロードを 1 回に抑える。共有アキュムレータ（evidence / tokens / modelVersion）は可換なので順不同でも同値。
> - サービス層は `policy.maxConcurrency` を executeRun へ渡すだけ（`extractionService.ts`）。pilot / extract は resolveRateLimitPolicy 経由で自動的に効く。
> - 設定: `settings.rateLimitCustomConcurrency`（settingsStore）+ Options の custom 節に同時実行数入力（`#rate-limit-concurrency`）。
> - jest 1527 green・カバレッジ 100%・tsc / eslint / webpack / E2E 50 green。**実機での並列スループット実測（同時実行数 1→2→4→8）と 429/TPM/Sheets クォータの観察はこれから**（下記 §4 の手順）。

## 0. TL;DR

- 今回の 429 対策（**A. バッチ間スロットル + B. リトライ強化**）で「多数 study を連続抽出すると 429」は解消した。ただし抽出は**依然として逐次（1 バッチずつ）**で、`executeRun` は並列化していない。
- 次の狙いは 2 つ:
  1. **Tier 3（高 RPM 帯）でどこまで速くできるか** — 逐次のままだと律速は RPM ではなく **1 リクエストのレイテンシ**。まずここを実測する。
  2. **並列実行できそうか** — 同時実行数を上げてスループットを稼げるか、そのとき 429 / TPM / Sheets クォータ / 順序性がどうなるかを検証する。
- 実験の足場は既にある: `LLMApiLog`（`latencyMs` / `tokensIn` / `tokensOut` / `timestamp` を 1 呼び出しごとに記録）+ `logs/llm/{log_id}.json`（フル payload）+ `ExtractionRuns`（run の `started_at` / `finished_at` / 実測トークン）。**計測用の新規配線はほぼ不要。**

## 1. 現状（実装済みのレート制限）

`src/lib/llm/` の合成: `withRetry(withThrottle(withLogging(provider)))`（`rateLimitPolicy.ts` の `applyRateLimitPolicy`）。

- **A. スロットル** `throttle.ts` `withThrottle`: RPM から最小間隔 `ceil(60000/RPM)` を導き、`nextAllowedAt` 方式で各 `chat` 呼び出しの発火時刻をずらす。**同時実行数は制限しない**（間隔だけを保証する。今は逐次呼び出しなので実質「前の呼び出しから N ms 空ける」）。
- **B. リトライ** `retry.ts` `withRetry`: 429/5xx を指数バックオフで再試行。サーバ提示の `Retry-After` ヘッダ・本文 `RetryInfo.retryDelay` を尊重し、`maxDelayMs` で頭打ち。
- **ポリシー** `rateLimitPolicy.ts`: tier プリセット（`gemini_free` 既定 = RPM 8 / `gemini_tier1` = 120 / `gemini_tier2` = 900 / `gemini_tier3` = 1800 / `custom` = RPM 手入力 / `unlimited` = スロットル無し）。**RPM 値は保守的な目安**で、Options の「カスタム」で実測に合わせ上書きできる。
- **設定** `settingsStore.ts`: `settings.rateLimitTier` / `settings.rateLimitCustomRpm` / `resolveRateLimitPolicy()`。bootstrap が抽出・ドラフトのサービス層へ注入する。

### 重要: 今の律速は RPM ではない

`executeRun`（`src/features/extraction/executeRun.ts:274` の `for (const batch of input.plan.batches)`）は**バッチ = 1 study を 1 件ずつ `await` で回す**。1 study 1 LLM 呼び出しなので、実効スループットは概ね:

```
throughput ≈ 1 / max(スロットル間隔, 1 リクエストのレイテンシ)
```

Tier 3（RPM 1800 → 間隔 33ms）ではスロットル間隔は無視できるほど小さく、**律速は 1 リクエストの実レイテンシ（フルテキスト抽出だと数秒〜十数秒）**。つまり Tier 3 で「もっと速く」したいなら、**RPM を上げるのではなく同時実行数を増やす（＝並列化する）**しかない。これが実験 2 の動機。

## 2. 実験 1: Tier 3 でどこまで速くできるか（まず逐次のまま実測）

目的: 「1 リクエストのレイテンシ」と「実際のスループット上限」を数値で押さえ、並列化の効果見積りの土台にする。

### 手順
1. Options のレート制限 tier を `custom` にし、RPM を十分大きく（例 600〜1000）設定して**スロットルを実質無効化**する（＝レイテンシ律速の素の速度を見る）。または一時的に `unlimited`。
2. テキスト層のある study を 10〜20 本用意し、`#/extract` で一括抽出を実行。
3. 実行後、以下を集計（すべて既存データから取れる）:
   - **1 呼び出しレイテンシ**: `LLMApiLog.latencyMs`（purpose = `extract_study`）の分布（p50 / p90 / max）。
   - **実効スループット**: `ExtractionRuns` の `finished_at - started_at` ÷ study 数 = 1 study あたり実時間。
   - **トークン**: `LLMApiLog.tokensIn` / `tokensOut` の分布。TPM（後述）の見積りに使う。
   - **429/5xx 発生**: `LLMApiLog.error` 非 null の件数（リトライされたぶんも 1 行ずつ残る）。
4. これで「逐次の理論上限 = 1 / p50レイテンシ [req/s]」が出る。並列化で狙える上限の当たりを付ける。

### 見積り例（要実測で置換）
- p50 レイテンシが 8s なら逐次は約 7.5 req/min。20 本で約 2.7 分。
- 同時 4 並列なら理論上 30 req/min（レイテンシ律速が解ければ）だが、TPM / 同時接続上限に当たる可能性あり（実験 2 で確認）。

## 3. 実験 2: 並列実行の可否

### 3.1 何を変える必要があるか（コード）

`executeRun` の逐次ループを**同時実行数上限つきの並行実行**に置き換える。関係するのは:

- **同時実行の制御**: `RateLimitPolicy` に `maxConcurrency?: number` を足し、`executeRun` に「セマフォ / p-limit 相当」の並行ランナーを入れる（バッチを `maxConcurrency` 本まで同時に走らせる）。`withThrottle` は間隔保証はするが同時数は絞らないので、**別途セマフォが要る**。
- **共有アキュムレータの取り扱い**: `executeRun` 内の `evidence[]` / `rejectedItems[]` / `batchFailures[]` / `tokensIn` / `tokensOut` / `modelVersion` / `completedBatches`。JS は単一スレッドなので `push` や加算自体は競合しないが、**`await` を跨ぐ read-modify-write（`tokensIn = addTokens(tokensIn, ...)` や `modelVersion ??= ...`）は各バッチの `await` 完了後に実行されるので、順序は非決定になる**。合算は可換なので問題ないが、テストは順序非依存で書くこと。
- **`loadDocument` のキャッシュ** `loadedDocuments`（Map）: 別 study は別文書なので競合しないが、同一 study が section 分割で複数バッチになるケースでは、同じ document を 2 バッチが同時に miss して二重ロードしうる（無害・冪等）。厳密にやるなら「ロード中 Promise をキャッシュ」に変える。
- **`onProgress` / 進捗表示**: `completedBatches` を並行更新すると進捗イベントの順序が乱れる。UI 側（`studyProgress.ts`）は study 単位の畳み込みなので順不同でも成立するはずだが、要確認。
- **Evidence 追記の順序**: 現状はバッチごとに `appendEvidence(rows)`。並列だと Sheets への追記が交互になる。追記型なので順序は問題ないが、**Sheets API のクォータに当たる**（3.2 参照）。

推奨: 既存の `executeRun` を壊さず、**`maxConcurrency` が 1 なら現行と同一挙動、2 以上で並行**になるよう実装する（既存テスト・E2E をそのまま通す安全策）。並行ランナーは小さな自前 `pLimit` で足りる（依存追加不要）。

### 3.2 並列化で当たる別の壁（重要）

1. **TPM（tokens per minute）**: フルテキスト抽出は 1 リクエストの入力トークンが大きい。RPM に余裕があっても **TPM 上限に先に当たる**可能性が高い。実験 1 で測った `tokensIn` × 同時実行数 ÷ レイテンシ で TPM を見積もり、Tier 3 の TPM 上限と比較する。429 の本文が `RESOURCE_EXHAUSTED` で `quotaMetric` に `..._input_token_count` を含むなら TPM 律速。
2. **同時接続 / 並行リクエスト上限**: モデル・tier によっては同時実行数そのものに上限があることがある。429 が増えるなら `maxConcurrency` を下げる。
3. **Google Sheets API クォータ**: 並列で `appendEvidence` / annotator 行 upsert / `ExtractionRuns` 追記が増えると **Sheets 側が 429（`RESOURCE_EXHAUSTED`, 60 write/min/user 等）**になりうる。LLM を並列化すると Sheets 書き込みも密になる点に注意。対策候補: Evidence 追記を study 横断でバッファして間引く / 書き込みにもスロットルを入れる。
4. **`RPD`（1 日上限）**: 大規模実行では日次上限も。長時間バッチでは意識する。

### 3.3 リトライとの相互作用

429 が出ると `withRetry` がバックオフする。並列時は「複数バッチが同時に 429 → 全員が同じ retryDelay 待ち → 同時に再送 → また 429」のサンダリングヘッド化がありうる。対策候補: バックオフに軽いジッタを足す（`retry.ts` の `sleep` 引数にランダム化）、または `maxConcurrency` を保守的にする。

## 4. 実験の進め方（推奨）

1. **まず実験 1（逐次・スロットル無効）**でレイテンシと TPM の素の数値を取る。並列の当たりを付ける。
2. `RateLimitPolicy.maxConcurrency` を足し、`executeRun` に並行ランナーを実装（`maxConcurrency=1` は現行同一挙動）。ユニットで「同時実行数を超えない」「結果は順不同でも同値」を検証（仮想クロックで）。
3. **同時実行数を 1 → 2 → 4 → 8 と上げて実測**。各水準で計測:
   - 実効スループット（`ExtractionRuns` の所要時間 ÷ study 数）
   - 429 / 5xx の発生率（`LLMApiLog.error`）と種別（TPM 由来か RPM 由来か = 本文の `quotaMetric`）
   - `partial_failure` 率（失敗 study が増えていないか）。**スループットを上げても失敗が増えれば実質後退**なので、完了率とのトレードオフで最適点を探す。
   - Sheets 側 429 の有無
4. **撤退条件**: 429 率が上がって `partial_failure` が増える／Sheets が詰まる水準の 1 つ手前を「安全な同時実行数」とする。Options に `custom` の RPM だけでなく **同時実行数の設定**を出すかは、この実験結果を見て判断。

## 5. 計測の足場（既存のまま使える）

- **`LLMApiLog`**（`src/domain/llmApiLog.ts`）: 1 呼び出し = 1 行。`latencyMs` / `tokensIn` / `tokensOut` / `timestamp` / `error` / `model` / `purpose`。リトライの各試行も `withLogging`（`apiLogger.ts`）が別行で残す。→ レイテンシ分布・429 率・TPM 見積りはここから。
- **`logs/llm/{log_id}.json`**（Drive）: リクエスト/レスポンスのフル payload。429 の本文（`quotaMetric` / `retryDelay`）を確認するならこれ。
- **`ExtractionRuns`**: `started_at` / `finished_at`（2 行プロトコル）/ `tokens_in` / `tokens_out` / `status`。run 全体の所要時間・完了率。
- 集計は Sheets を CSV で落として手元スクリプトで叩くのが早い（実験系は `experiments/` に置く運用。gitignore 済みの実データは別建て。CLAUDE.md 参照）。

## 6. 触るべきファイル早見

| 目的 | ファイル |
|---|---|
| 逐次 → 並行ランナー | `src/features/extraction/executeRun.ts`（`for...of` ループ:274 付近） |
| 同時実行数をポリシーに追加 | `src/lib/llm/rateLimitPolicy.ts`（`RateLimitPolicy` に `maxConcurrency` / tier プリセット / Options） |
| スロットル（同時数は絞らない点に注意） | `src/lib/llm/throttle.ts` |
| バックオフのジッタ検討 | `src/lib/llm/retry.ts` |
| Sheets 書き込みの間引き検討 | `src/features/extraction/evidenceRepository.ts` / `extractionService.ts`（`appendEvidence` 経路） |
| 進捗畳み込みの順不同耐性 | `src/features/extraction/studyProgress.ts` |
| 計測データ定義 | `src/domain/llmApiLog.ts` / `src/lib/llm/apiLogger.ts` |

## 7. メモ / 未確定

- 抽出**精度**は並列化で変わらない（1 呼び出しの内容は不変）。実験で見るのは**スループットと完了率**のトレードオフのみ。
- tier プリセットの RPM は目安値。Tier 3 の実 RPM/TPM は Google のドキュメント（AI Studio / Vertex のレート制限表）とアカウントの実測で確定する。実験 1 の結果で `gemini_tier3` の RPM を実値へ寄せてよい。
- 並列化を入れるなら `executeRun` は実質的な書き換えになるので、**`maxConcurrency=1` で現行 E2E（`app-extract.spec.ts` / `app-pilot.spec.ts`）が完全に一致することを回帰の砦にする**。
- 本ブランチは**実機テスト前**。まず現行（逐次 + スロットル + リトライ）を実機で通してから、並列化ブランチを分けるのが安全。
