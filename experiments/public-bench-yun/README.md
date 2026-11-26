# Yun et al. 2024 公開ベンチ（評価 C）

[評価計画 §13](../../docs/evaluation-plan.md#13-計画外の追加評価-c-公開ベンチ-yun-et-al-20242026-11-27-の追加) に定義した、事前登録外の追加評価。評価 A の主結果を置き換えない。本番 extract-data プロンプト版数 17 で、1 RCT の全 TEST ICO を 1 依頼にまとめる。条件 M（`md`）は原著の Markdown、条件 P（`pdf`）は PMC PDF の文字層を使う。原著の ICO ごとの依頼とは異なる。

データは [hyesunyun/llm-meta-analysis](https://github.com/hyesunyun/llm-meta-analysis) の commit `1bc768d4d098c727c9866eeff909297c38a3e84c` に固定する。リポジトリは Apache-2.0、論文本文は各 PMC ライセンスに従う。上流データ・本文・PDF・依頼・応答・出力はコミットしない。出力先には、この評価 C 専用の git ツリー外のディレクトリを使う。

## 環境変数

| 変数 | 内容 |
|---|---|
| `YUN_ROOT` | 固定 commit の上流 clone の絶対パス（必須） |
| `PUBLIC_BENCH_OUT` | git ツリー外の出力先絶対パス（必須）。`pdf/`、`textlayer/`、`runs-<label>/` を保存 |
| `BENCH_CONDITION` | `md` / `pdf`（run で必須） |
| `BENCH_RUN_LABEL` | 英数字・`_`・`-` の実行ラベル（run で必須、既定なし） |
| `BENCH_MODELS` | カンマ区切り。既定は `gemini-3.8-flash,claude-haiku-5-5`。`gpt-6.2-sol` は明示選択のみ |
| `GEMINI_API_KEY` / `ANTHROPIC_API_KEY` | 環境変数だけから読む。dry run では不要 |
| `BENCH_PMCIDS` | smoke 用 PMCID 整数のカンマ区切り。未知の ID はエラー。fetch-pdf は常に TEST 全 RCT が対象 |
| `BENCH_DRY_RUN` | `1` で全依頼を構築して件数とユーザープロンプト文字数を表示。保存・API 呼び出しなし |
| `BENCH_COST_LIMIT_USD` | 非 dry run の必須上限。評価計画では評価 C 全体で `15` USD |
| `BENCH_COST_PAUSE_USD` | 停止閾値。既定は上限の 87.5%。各試行前に確認 |
| `BENCH_CODEX_EFFORT` | codex 使用時に必須。計画の実行では `medium`（共通設定関数は low / medium / high を受付） |
| `BENCH_CODEX_CONCURRENCY` | codex 並列数 1〜4、既定 1 |
| `BENCH_CODEX_TIMEOUT_MS` | codex の正整数タイムアウト、既定 1800000 ms |
| `BENCH_CODEX_JS` | 共通 codex プロバイダで使う CLI JavaScript のパス（任意） |

費用は `PUBLIC_BENCH_OUT` 直下の全 `runs-*` 台帳を合計する。smoke と両条件の費用も含み、評価 A の台帳とその他支出は加えない。API キーごとに並列 1 本、codex は最大 4 本。各 worker の前回試行終了から 2 秒空ける。費用・認証エラーは全体を停止する。台帳には全試行を run JSON より先に追記する。

## 実行手順

1. git ツリーの外に上流を clone し、上記 commit を checkout して `YUN_ROOT` を指定する。gold 全体の SHA256 を毎回検証し、TEST のみを使う。
2. このフォルダで `npm install`。本番コードと評価 A の共通部を相対 import するため、リポジトリルートの依存関係も導入しておく。
3. `PUBLIC_BENCH_OUT` を指定して `npm run fetch-pdf`。S3 の最大の数値版を取得し、MD5 を確認する。`pdf/manifest.json` は論文ごとに置換保存し、再実行時は一致する保存済み PDF を省略する。
4. `npm run extract-text`。PDF の SHA256 を照合して文字層をキャッシュする。失敗と空文字層を集計する。
5. 条件・ラベルを設定し、`BENCH_DRY_RUN=1 npm run run`。件数、除外理由、依頼文字数を確認する。件数を固定の期待値で断定せず毎回数える。
6. `BENCH_PMCIDS` に TEST の 3〜5 RCT を指定し、専用ラベル（例 `smoke-md`）で smoke run を行う。
7. `BENCH_PMCIDS` を解除し、新しい条件別ラベル（例 `main-md` / `main-pdf`）で本実行。codex を含めるときはモデルを明示し `BENCH_CODEX_EFFORT=medium` とする。

キーは環境変数から渡す。DGX Spark では、例えば次のように実行する（他の必須変数は事前に設定する）。`.env` は読み込まない。

```bash
spark-apikeys run --keys GEMINI_API_KEY,ANTHROPIC_API_KEY -- npm run run
```

同じラベルで再開する場合、`_inputs.json` の gold・本文・依頼ハッシュ、版数、除外一覧、条件、モデル、推論設定を照合する。ハーネス commit は記録するが比較しない（依頼内容は依頼ハッシュで固定するため）。通常実行・変換・採点（`--selftest-gpt4` を含む）では、上流チェックアウトが上記の固定 commit にあり、追跡対象ファイルに変更がないことを必須とする。入力や RCT 部分集合を変える場合は新しいラベルを使う。本文全体の改変を検出するため、依頼ハッシュも固定する。条件 P は取得不能・抽出不能・全ページ空白の RCT を理由付きで除外する。M と P の比較には後で共通 RCT の M の結果も併記する。

ローカル検証は `npm run typecheck` と `npm test`。テストは合成データと偽 fetch のみを使う。

## 採点

採点前に、変換・採点コードをレビューに回す。入力・run・採点 ICO の件数を突き合わせ、計画の条件 M（110 RCT・二値 171 / 連続 485 ICO）と条件 P（105 RCT・二値 164 / 連続 466 ICO）から違えば理由を記録してから数値を報告する。以下はこのフォルダから実行する。`PY` は上流依存を導入した venv の Python 3 とする（numpy、pyyaml、scikit-learn、statsmodels、jinja2、setuptools<81）。

1. 最初に上流 GPT-4 出力を上流の前処理経由で読み、本採点の gold レコード構築を通して、公開 metrics 辞書全体との一致を確認する。二値 total は約 0.655、連続は約 0.487。`FAIL` または例外なら先へ進まない。

   ```bash
   PY=/home/youki/wt/public-bench-yun-data/venv/bin/python
   "$PY" score/score_yun.py --yun-root "$YUN_ROOT" --selftest-gpt4
   ```

2. 実行時と同じ `BENCH_CONDITION`、`BENCH_RUN_LABEL`、`BENCH_MODELS`、codex 選択時は `BENCH_CODEX_EFFORT` を指定し、ラベルごとに `npm run convert`。smoke の部分集合なら実行時の `BENCH_PMCIDS` も合わせる。`_inputs.json` が存在し、現在の gold・本文・依頼・設定が一致し、全予定 run と各 run の台帳行が揃わなければ拒否する。`records-<label>/<model>.json` と `<model>.stats.json` を保存する。

3. 集合ごとに抽出添字を作る。条件 M 全体、条件 P、条件 P と共通の RCT に絞った条件 M はそれぞれ別名にする。同じ seed `20261127` から各 2,000 回、数値昇順の PMCID を RCT 単位で復元抽出する。runs ディレクトリでは `_inputs.json` の依頼計画から RCT を読む。配列ファイルからも作成できる。

   ```bash
   npm run draws -- --name M --pmcids-from "$PUBLIC_BENCH_OUT/runs-main-md"
   npm run draws -- --name P --pmcids-from "$PUBLIC_BENCH_OUT/runs-main-pdf"
   npm run draws -- --name M-common --pmcids-from "$PUBLIC_BENCH_OUT/runs-main-pdf"
   ```

   共通集合の `--pmcids` 用 JSON 配列は P の抽出添字から保存する（実測件数を確認する）。

   ```bash
   "$PY" -c 'import json,os,pathlib; p=pathlib.Path(os.environ["PUBLIC_BENCH_OUT"]); (p/"pmcids-common.json").write_text(json.dumps(json.loads((p/"draws-P.json").read_text())["pmcids"])+"\n")'
   ```

4. モデルごと・集合ごとに上流の `MetricsCalculator` で採点する。`--records` は複数回指定して同じ集合のモデルをまとめてもよい。gold と ICO id 集合、RCT、課題、抽出添字の集合・順序を照合する。点推定・指標は上流関数、95% 区間は RCT 復元抽出の total の numpy quantile（既定の線形補間）を使う。課題の ICO がゼロの反復は省略数を記録する。

   ```bash
   MODEL=gemini-3.8-flash
   "$PY" score/score_yun.py --yun-root "$YUN_ROOT" --records "$PUBLIC_BENCH_OUT/records-main-md/$MODEL.json" --draws "$PUBLIC_BENCH_OUT/draws-M.json" --out "$PUBLIC_BENCH_OUT/score-M-$MODEL.json"
   "$PY" score/score_yun.py --yun-root "$YUN_ROOT" --records "$PUBLIC_BENCH_OUT/records-main-pdf/$MODEL.json" --draws "$PUBLIC_BENCH_OUT/draws-P.json" --out "$PUBLIC_BENCH_OUT/score-P-$MODEL.json"
   "$PY" score/score_yun.py --yun-root "$YUN_ROOT" --records "$PUBLIC_BENCH_OUT/records-main-md/$MODEL.json" --pmcids "$PUBLIC_BENCH_OUT/pmcids-common.json" --draws "$PUBLIC_BENCH_OUT/draws-M-common.json" --out "$PUBLIC_BENCH_OUT/score-M-common-$MODEL.json"
   ```

   105 RCT の M 部分集合は **M の records を `--pmcids` で絞って**採点する。M を再実行・再変換して部分集合のラベルを作らない。

変換は前後の空白を除き、先頭の Unicode / 全角マイナスと正しい桁区切りカンマを直して、十進表記だけを JSON 数値にする。単位換算・丸め・指数表記の解釈はしない。複数候補は変換後の数値／文字列で重複を除き、異なる値が残れば `__multiple_values__`。失敗 run はその RCT の全 ICO・全フィールドを `__run_failed__` にする。両方とも不一致用であり、gold の `x` と一致させない。候補に値がなければ `x` とし、明示の未報告 `not_reported` と未返却 `not_returned` は状態別に残す。

通常採点は gold の空文字と null だけを `x` にし、`"1,525"` のような非空文字列をそのまま残す。感度分析は同じ採点コマンドに `--gold-comma-normalized` を加え、出力ファイル名を別にする。このときだけ gold の正しい桁区切り文字列を数値にする。状態数、`x_answers`、カンマ除去に依存した一致数をフィールド別・全体で記録する。`valueNoComma` はカンマを除かなかった場合の候補全体の判定で、競合すれば `__multiple_values__` となる。

副指標は stats に保存する。run 失敗率、全台帳試行・再試行・失敗分類、応答のある run（`format_error` を含む）の最終応答時間と台帳全試行の時間それぞれの平均・中央値、台帳全試行の時間・トークン・報告単価と定価による費用の合計および RCT 平均、引用の照合状態数と成功率を記録する。引用あり・未報告以外の候補を分母とし、`nonFailedRate` は failed 以外の割合、`successRate` は評価 A に合わせ null と failed を成功に含めない割合とする。codex の費用は null、`costNote` は `subscription_not_computable`。

検証コマンドは `npm run typecheck`、`npm test`、`"$PY" -m unittest score/test_score_yun.py`。Python の上流依存テストは `YUN_ROOT` 未設定なら省略し、純粋関数の検査だけを行う。実 API は呼ばない。
