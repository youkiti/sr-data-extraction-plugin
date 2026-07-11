# 一括抽出スループット実測（並列化の効果検証）

`feat/extraction-parallel`（PR #34 マージ済み）で入った **バッチ並行実行（`maxConcurrency`）** の効果を実機で測るための集計ツールと手順。
背景・設計は [docs/handoff-20260710-throughput.md](../../docs/handoff-20260710-throughput.md)。

## 何を測るか

同時実行数を **1 → 2 → 4 → 8** と上げたとき、

- **実効スループット**（study/分）がどれだけ伸びるか
- **429 の発生**（種別 = TPM 由来か RPM 由来か）
- **`partial_failure` 率**（速くしても失敗が増えれば実質後退）
- 入力 **TPM**（フルテキスト抽出は TPM に先に当たりやすい）

を見て、「速いが 429/失敗が増える水準の 1 つ手前」＝**安全な同時実行数**を決める。

## 実機手順

1. **Options → レート制限** を `カスタム（RPM を手動指定）` にする。
   - RPM は十分大きく（例 600〜1000）してスロットルを実質無効化 → **レイテンシ律速の素の速度**を見る。
   - **同時実行数** を測りたい値に設定（まず `1`）。
2. `#/extract` でテキスト層のある study を **10〜20 本**選び、一括抽出を実行する。
3. 実行が終わったら、**同時実行数を 2 に変えて**同じ規模で再実行。以降 4、8 と繰り返す。
   - 各 run の `run_id` と使った同時実行数をメモしておく（後で `labels.json` に使う）。
4. Sheets の **`LLMApiLog`** タブと **`ExtractionRuns`** タブをそれぞれ CSV で書き出す
   （ファイル → ダウンロード → カンマ区切り）。`data/` に置く（`data/` は gitignore 済み）。

## 集計

```sh
node experiments/throughput/aggregate.mjs \
  --llmlog data/llmapilog.csv \
  --runs   data/extractionruns.csv \
  --labels data/labels.json
```

- `--llmlog`（必須）: `LLMApiLog` の CSV。`purpose = extract_study` の行だけを対象にする。
- `--runs`（任意）: `ExtractionRuns` の CSV。完了行（`finished_at` あり）を run として扱い、
  `[started_at, finished_at]` の**時間窓**で LLMApiLog の行を run へ割り当てる
  （LLMApiLog には run_id 列が無いため）。省略時は全 extract_study の分布だけ出す。
- `--labels`（任意）: `{"<run_id>": "concurrency=4"}` の JSON。各 run にラベルを付けると読みやすい。

`data/labels.json` の例:

```json
{
  "＜同時実行1のrun_id＞": "concurrency=1",
  "＜同時実行2のrun_id＞": "concurrency=2",
  "＜同時実行4のrun_id＞": "concurrency=4",
  "＜同時実行8のrun_id＞": "concurrency=8"
}
```

## 動作確認（サンプル）

実データが無くても、同梱のサンプルで出力形式を確認できる:

```sh
node experiments/throughput/aggregate.mjs \
  --llmlog experiments/throughput/sample-llmapilog.csv \
  --runs   experiments/throughput/sample-extractionruns.csv \
  --labels experiments/throughput/sample-labels.json
```

サンプルは「concurrency=1 は 3 study/分・429 ゼロ / concurrency=4 は 9 study/分だが 429 + partial_failure」という、
まさに見たいトレードオフを模したダミーデータ。

## 出力の読み方

| 列 | 意味 |
|---|---|
| `study/分` | 実効スループット = study数 ÷ 所要時間。並列化で伸びる主指標 |
| `p50/p90/max ms` | 当該 run 窓内の 1 リクエストのレイテンシ分布。逐次の律速要因 |
| `入力TPM` | 窓内の入力トークン合計 ÷ 所要分。Gemini の TPM 上限と比べる |
| `429` | 窓内の 429 応答数（リトライされた試行も 1 行ずつ残る） |
| `status` | `partial_failure` が出たら失敗が混じった run |

**判断**: `study/分` が頭打ちになる・`429` や `partial_failure` が増え始める同時実行数の **1 つ手前**を採用値にする。
その値を `src/lib/llm/rateLimitPolicy.ts` の該当 tier プリセット（`gemini_tier3` など）の `maxConcurrency` に反映する。

## 注意

- 実データ（`data/` と `*.local.*`）は gitignore 済み。スクリプト・`sample-*`・本 README のみ追跡する。
- 抽出**精度**は並列化で変わらない（1 呼び出しの内容は不変）。ここで見るのはスループットと完了率だけ。
