# Cochrane 数値抽出ベンチマーク

issue #356 の評価 A（結果は [REPORT.md](REPORT.md)）。[評価計画 §3–§5・§7–§9](../../docs/evaluation-plan.md) に従い、本番のプロンプト生成、応答検証、引用照合、プロバイダ、料金計算を直接利用する。対象は二値・連続の群ごとの数値。上流リポジトリは読み取り専用で、XML は入力しない。

## 実行順序

このフォルダで実行する。Node・依存パッケージは導入済みのものを使う。

1. `COCHRANE_BENCH_ROOT` に Cochrane-bench のルートの絶対パスを指定する。
2. `npm run extract-text` で PDF の文字層を抽出する。
3. `BENCH_DRY_RUN=1` を設定して `npm run run`。キー不要・書き込みなしで全依頼を組み立て、対象・除外・予定・スキップ件数、項目数、文書数、user プロンプト文字数だけを確認する。
4. dry run を解除し、`BENCH_STUDIES` に 3〜5 研究キーをカンマ区切りで指定して疎通確認する。`BENCH_RUN_LABEL=smoke` など本走と別のラベルを使う。実費と処理完了だけを確認し、この段階では採点しない。
5. 研究の限定を解除し、新しい本走ラベルと明示的な費用上限を設定して `npm run run`。同じ設定で再実行すると未確定 run だけを実行する。
6. cc-by-nc の裁定終了後、下記の再チェックを終えて `npm run lock-gold`。表示された全桁ハッシュを REPORT に記録する。
7. `npm run score`。lock のハッシュ、入力 manifest、全ラベル、全 run の存在を確認してから採点する。

上流 abd2102 での参考値（コードは固定件数を仮定せず毎回数える）: cc-by は 2 レビュー・42 研究・223 項目・1,050 値、cc-by-nc は 15 レビュー・102 研究・924 項目・4,374 値。各 tier で 3 研究に PDF パスがない。640 項目の両群ラベルが空で比較名には群が書かれている。PDF の欠落・空の文字層による除外後の件数を実行時に出力する。

task gold が trim 後に空の値は参照行の検索・整合性検査・採点から除き、全値が空の項目は依頼からも除いて残りを o1 から採番する。項目が残らない研究は `no_gold` で除外し、空 gold の項目・値数を tier 別に表示・保存する（文字層抽出では PDF パスなしを `no_pdf_path`、読み込み・解析エラーを `failed` として分ける）。

## 環境変数

| 名前 | 内容 |
|---|---|
| `COCHRANE_BENCH_ROOT` | 必須。上流ルートの絶対パス |
| `BENCH_MODELS` | モデル ID の部分集合で限定できる。既定は `MODELS` の全件（gemini-3.8-flash、claude-sonnet-5-5、claude-haiku-5-5） |
| `BENCH_CODEX_EFFORT` | codex 選択時は dry run でも必須。low / medium / high。既定値なし |
| `BENCH_CODEX_CONCURRENCY` | codex の並列数。1〜4 の整数、既定 1 |
| `BENCH_CODEX_TIMEOUT_MS` | codex の時間上限（ミリ秒）。正の整数、既定 1800000（30 分） |
| `BENCH_CODEX_JS` | codex.js のパス。指定時は Node 経由で起動。未指定の Windows は APPDATA 配下の npm の導入先、他の OS は PATH の codex |
| `BENCH_TIERS` | cc-by / cc-by-nc の部分集合。既定は両方 |
| `BENCH_STUDIES` | `cc-by/REV1/S1` 形式の研究キーの部分集合 |
| `BENCH_RUN_LABEL` | 出力の版。既定 a-v1。英数字・_・- のみ |
| `BENCH_DRY_RUN` | 1 なら API 呼び出し・ファイル書き込みなし |
| `BENCH_COST_LIMIT_USD` | 実行時に必須の正数。既定値なし |
| `BENCH_COST_PAUSE_USD` | 正かつ上限以下。既定は上限 × 0.875 |
| `BENCH_OTHER_SPEND_USD` | 0 以上の数値、既定 0。評価 B と、同じ予算から使ったその他の費用 |
| `GEMINI_API_KEY` / `ANTHROPIC_API_KEY` | 本走に必要。環境変数、当フォルダ `.env`、リポジトリ `.env` の順で優先 |

未対応の部分集合は拒否する。キーはログに出さない。評価 B と同じキーを使う実行や拡張の利用を重ねない（キーごとの並列制約は当プロセス内で保証する）。入力 manifest は対象集合も固定するため、部分集合を変えるときも新しいラベルを使う。

## 渡した文書に基づく再チェック

利用可能な PDF または文字層がなく文書を一部省いた研究では、上流が reported / derivable で、同じラベルを付けた読み手の根拠文書が一つも依頼に含まれない値を再判定する。全資料を渡す研究は対象外。`npm run recheck-list` が解析名・比較・群・subgroup・清掃済み脚注・gold と文書 ID を `outputs/recheck-needed.jsonl` に書く。拡張の出力を見ない読み手が、渡した文書だけを読み、`outputs/recheck-labels.jsonl` に `{ "rowId": "行 ID", "field": "フィールド", "label": "not_in_documents" }` 形式で記録する。label は reported / derivable / different_value / not_in_documents。必要なラベルが揃うまで lock-gold と score は拒否し、確定時にはファイルの sha256 も固定する。run は再チェック前にも実行できる。

2 人の独立の読み手（Opus と gpt-6-astra）に、拡張の出力を見せずに下読みさせる。`npm run recheck-readers -- freeze` で入力を固定し、読み手が `outputs/recheck-readers/responses/<名前>/<タスク ID>.json` に応答を書く。`ingest --reader <名前>` を各読み手に実行し、`summarize --reader-a <名前> --reader-b <名前>` で合議する。本人が `owner-queue.json` の値を判定し、`labels --adjudications <file>` で全値のラベルを書き出す（各コマンドは `npm run recheck-readers --` に続ける）。本人の判定は `{ rowId, field, label, note? }` の JSON 配列または JSONL とし、Artifact の `{key, value}` 形式も受け付ける。全コマンドで `--outputs <dir>` を指定できる。上流と異なり reported と derivable の割れと single_valid は自動で採らず、引用に数がなく reported から derivable に読み替えた判定も、両者の照合後ラベルが一致していても本人に回す。図は使わない。

## 変換と採点の確定事項

- **ハーネス設計**: 必要な upstream field の和集合を固定順の float / outcome_result フィールドにする。項目順に o1, o2, … を採番し、解析名と subgroup を outcomeLabel に、比較・両群・outcome・型・HTML 清掃済み脚注を description にする。review_context を protocolContext にする。gold・参照ラベル・provenance は渡さない。
- **本人決定 2026-11-24**: 群名は group_label → intervention → 比較で最初／二番目に書かれた介入、の順で補う。
- **本人決定 2026-11-24**: 同一 outcome と field の候補で異なる値が複数あれば multiple_values。一つが gold と一致しても不一致。arm・time は採点に使わない。同じ数値の表記差は重複扱い。
- **本人決定 2026-11-24**: 再試行は 429、5xx、通信／timeout、output_limit。プロバイダの retryable も尊重する。最大 4 試行、待機は 15/45/90 秒と Retry-After の大きい方、上限 120 秒。形式不正は再試行しない。spend cap・認証失敗では run と台帳を追加せず全体停止。
- **本人決定 2026-11-24**: 誤り分類に 0（run 失敗）を加え、1 を not_reported と not_returned に分ける。2（反対群）→3（同研究の別項目・同群・同じ値の種類）→4（その他）と優先。multiple_values は 4 の独立内訳。
- **ハーネス設計**: figureOnly は reported の値について、reported と判定した読み手が一人以上いて全員 source=figure なら true、text が一人でもいれば false。該当読み手なし・非 reported は null。
- **ハーネス設計**: レビューを reviewId 順、研究を研究キー順にし、mulberry32(20261122) でレビュー、その中の研究を復元抽出する。2,000 回で全モデルに同じ抽出を使う。reported 分母ゼロのレビュー抽出は平均から除き回数を記録し、全レビューがゼロの反復も記録する。95% 区間は type 7 分位数。対応差は、選んだモデルのうち定義順で最初のもの（既定では gemini-3.8-flash。各差の `base` に基準のモデルを残す）を基準に、2番目以降の各モデル − 最初を同じ再抽出の中で求める（`differences`。`difference` は従来どおり 2番目 − 最初）。
- **ハーネス設計**: 監視費用はキャッシュ割引なしの定価で、claude-haiku-5-5 は常に高い長文脈単価（100万トークンあたり入力 0.50 / 出力 2.50 USD）で数える。定価の指標はリクエストごとに単価を選ぶ（入力 100,000 トークン以下は入力 0.10 / 出力 0.50 USD、超過は入力 0.50 / 出力 2.50 USD。いずれも100万トークンあたり）。報告費用は本番の日時・トークン数別単価（Gemini の期間割引と Haiku 5.5 の長文脈単価を含む）と Sonnet 補助単価。tokensOut は思考込みで追加加算しない。失敗は usage 実測を優先、出力打ち切りで usage がなければ入力文字数÷4 の切り上げと出力 65,536、それ以外は入力だけ見積もる。全試行を台帳へ先に書き、採点時の研究費用は再試行・中断前の試行も合算する。

成功応答でも入力トークン数が null なら文字数÷4 を切り上げ、費用基準を `estimated_input_tokens` とする。run の費用欄は最後の試行分で、`attemptsGuardCostUsd` は今回の実行内の全試行分（過去の中断分を除く）；累計監視費用が停止値に達すると理由と再開方法を stderr に一度表示して終了コード 1 で停止する。計画の 80 USD は疎通・本走・評価 B の共通予算で、全 `outputs/runs-*/_ledger.jsonl` の監視費用と `BENCH_OTHER_SPEND_USD` を合算し、開始時にラベル別とその他の内訳を表示する。再開後も run ごとの台帳行数から次の試行番号を復元し、4 試行済みなら追加依頼せず失敗を確定する。

主指標は reported のレビュー単位感度の単純平均。ゼロ reported レビューを列挙する。副指標は micro、誤値、二種類の無回答、本文なしへの回答、正確度、derivable 一致、全 gold 一致、引用照合、費用、応答時間、失敗割合。different_value は件数のみとし、ラベルを使わない全 gold 一致と全候補の引用照合には含む。層別も同じ主定義と micro・件数を出す。

正確度で本文なしの正答に数えるのは明示的な not_reported のみ。not_returned は別件数にする。応答時間は台帳の全試行の依頼単位と、従来の応答が得られた run 単位を明示的な別名で保存する。台帳には HTTP status と失敗分類も記録し、集計に分類別試行数・再試行数を含める。再チェック済み件数とラベル遷移は tier 別に、relabelled は層別にも保存する。

本番との差は **1 研究の全項目を一つの依頼で送ること**（本番は分割する）。temperature・応答スキーマは本番を使い、出力上限や reasoning effort を上書きしない。入力は文字層だけなので図にだけある値の抽出には限界がある。

## 保存と公開

`outputs/textlayer/` は PDF ハッシュ付き文字層、`outputs/runs-<label>/` は `_inputs.json`・`_ledger.jsonl` と run JSON、`outputs/gold-lock.json` は gold 固定情報、`outputs/scores-<label>/` は summary.json と values.jsonl。これらと `.env` は git 対象外。破損 run は退避、確定した失敗は永久にスキップ、版数違い・入力ハッシュ違いでは新しいラベルが必要。

`_inputs.json` は空 gold の件数も保存し、`summary.json` の `inputs` は採点日時、ハーネス commit、プロンプト版数、run ラベル、モデル・tier、gold lock 全体、tier 別のレビュー・研究・項目・値・ラベル別値数、理由別除外数と空 gold 件数を記録する。実行・採点の開始時にもハーネス commit とプロンプト版数を表示する。

入力 manifest は全予定 run の messages・chatOptions の sha256 と既存のファイルハッシュを含む。両 tier の task gold と cc-by の final は既定接頭辞も検証し、全桁を保存する。裁定中の cc-by-nc final は manifest に含めない。既存 run または台帳がある場合、manifest 欠落では実行を拒否する。採点には manifest・台帳が必須で、台帳行のない run も拒否する。

公開対象はコード・マニフェスト・この手順・後日の REPORT の集計値。本文、gold の複製、依頼、応答、引用原文は公開しない。values.jsonl は引用・raw response を含まないが、公開は上流 gold の公開範囲に従い、tier 別ライセンス・別レコードで扱う。未公開 gold 部分の値別採点は保留する（計画 §9）。

## ローカル検証

`npm run typecheck` と `npm test` は上流データ・ネットワーク不要。合成入力で結合、変換、再試行、費用、台帳、再開、採点、ブートストラップ、公開安全性を確認する。dry run は実データの文字層キャッシュを用意してから行う。

## codex 経路（gpt-6.2-sol、計画外の追加解析）

事前登録に無い追加解析として、片岡本人が 2026-11-26 に依頼した。既定の選択は従来の 3 モデルのままで、`BENCH_MODELS=gpt-6.2-sol` と明示したときに codex CLI を使う。`BENCH_CODEX_EFFORT=low` または `medium` を指定し、それぞれ別の `BENCH_RUN_LABEL` で比較する（high も指定可能）。同じラベルで effort を変えると入力ハッシュの検査で停止する。codex はログイン済みの動作確認済み版を用意する。0.162.1 はシェル準備処理の不具合のため拒否する。

`BENCH_CODEX_CONCURRENCY` は既定 1、最大 4。`BENCH_CODEX_TIMEOUT_MS` は既定 30 分で、超過時はプロセスを終了して既存の再試行処理へ渡す。`BENCH_CODEX_JS` で起動する codex.js を指定できる。使用量の上限と認証失敗では台帳に追加せず全体を停止し、同じコマンドで再開できる。API キーは不要だが、費用の見張りの `BENCH_COST_LIMIT_USD` は引き続き必須。

`npm run pick-pilot` は、評価集合からレビューを非復元に 10 件選び、各レビューから 1 研究を選ぶ。レビューは reviewId 順、研究は studyKey 順に並べ、mulberry32 を使う。既定の種は 20261126。`npm run pick-pilot -- --seed 20261126 --n 10` で変更できる。`BENCH_TIERS` は有効、`BENCH_STUDIES` は無視する。標準出力の最初の行を `BENCH_STUDIES` に貼り付けられ、内訳と抽出方法は `outputs/pilot-seed<seed>-n<n>.json` にも保存する。

本番との差:

- codex の固定の上乗せがある。道具を切った状態の短い依頼で入力 6,347 トークンを実測した。本番の API 呼び出しには無い。
- システムプロンプトは `model_instructions_file` で codex 自身の指示文と置き換える。user 本文は標準入力で渡す。依頼ごとに空の一時作業フォルダを使い、道具・アプリ・プラグイン等を無効化する。
- 応答スキーマは根を object の `items` に包み、受け取り後に剥がして本番と同じ応答検証へ渡す。
- temperature は codex では渡せないので送らない。本番は `EXTRACT_DATA_TEMPERATURE` を使う。
- 出力上限は本番と同じく上書きしない。
- reasoning effort は既存の 3 モデルと違い明示的に指定する。low と medium の比較のためである。
- 費用はサブスクリプション経由で算出できず、トークン数だけを記録する。監視単価は 0、採点の費用 2 欄は null とし、`costNote: subscription_not_computable` を付ける。台帳の全試行の入出力トークン数を研究あたりで集計し、取得できた run の思考トークン数も平均する。
