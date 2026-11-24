# Cochrane 数値抽出ベンチマーク

issue #356 の評価 A。[評価計画 §3–§5・§7–§9](../../docs/evaluation-plan.md) に従い、本番のプロンプト生成、応答検証、引用照合、プロバイダ、料金計算を直接利用する。対象は二値・連続の群ごとの数値。上流リポジトリは読み取り専用で、XML は入力しない。

## 実行順序

このフォルダで実行する。Node・依存パッケージは導入済みのものを使う。

1. `COCHRANE_BENCH_ROOT` に Cochrane-bench のルートの絶対パスを指定する。
2. `npm run extract-text` で PDF の文字層を抽出する。
3. `BENCH_DRY_RUN=1` を設定して `npm run run`。キー不要・書き込みなしで全依頼を組み立て、対象・除外・予定・スキップ件数、項目数、文書数、user プロンプト文字数だけを確認する。
4. dry run を解除し、`BENCH_STUDIES` に 3〜5 研究キーをカンマ区切りで指定して疎通確認する。`BENCH_RUN_LABEL=smoke` など本走と別のラベルを使う。実費と処理完了だけを確認し、この段階では採点しない。
5. 研究の限定を解除し、新しい本走ラベルと明示的な費用上限を設定して `npm run run`。同じ設定で再実行すると未確定 run だけを実行する。
6. cc-by-nc の裁定終了後、`npm run lock-gold`。表示された全桁ハッシュを REPORT に記録する。
7. `npm run score`。lock のハッシュ、入力 manifest、全ラベル、全 run の存在を確認してから採点する。

上流 abd2102 での参考値（コードは固定件数を仮定せず毎回数える）: cc-by は 2 レビュー・42 研究・223 項目・1,050 値、cc-by-nc は 15 レビュー・102 研究・924 項目・4,374 値。各 tier で 3 研究に PDF パスがない。640 項目の両群ラベルが空で比較名には群が書かれている。PDF の欠落・空の文字層による除外後の件数を実行時に出力する。

## 環境変数

| 名前 | 内容 |
|---|---|
| `COCHRANE_BENCH_ROOT` | 必須。上流ルートの絶対パス |
| `BENCH_MODELS` | モデル ID の部分集合。既定は gemini-3.8-flash と claude-sonnet-5-5 |
| `BENCH_TIERS` | cc-by / cc-by-nc の部分集合。既定は両方 |
| `BENCH_STUDIES` | `cc-by/REV1/S1` 形式の研究キーの部分集合 |
| `BENCH_RUN_LABEL` | 出力の版。既定 a-v1。英数字・_・- のみ |
| `BENCH_DRY_RUN` | 1 なら API 呼び出し・ファイル書き込みなし |
| `BENCH_COST_LIMIT_USD` | 実行時に必須の正数。既定値なし |
| `BENCH_COST_PAUSE_USD` | 正かつ上限以下。既定は上限 × 0.875 |
| `GEMINI_API_KEY` / `ANTHROPIC_API_KEY` | 本走に必要。環境変数、当フォルダ `.env`、リポジトリ `.env` の順で優先 |

未対応の部分集合は拒否する。キーはログに出さない。評価 B と同じキーを使う実行や拡張の利用を重ねない（キーごとの並列制約は当プロセス内で保証する）。入力 manifest は対象集合も固定するため、部分集合を変えるときも新しいラベルを使う。

## 変換と採点の確定事項

- **ハーネス設計**: 必要な upstream field の和集合を固定順の float / outcome_result フィールドにする。項目順に o1, o2, … を採番し、解析名と subgroup を outcomeLabel に、比較・両群・outcome・型・HTML 清掃済み脚注を description にする。review_context を protocolContext にする。gold・参照ラベル・provenance は渡さない。
- **本人決定 2026-11-24**: 群名は group_label → intervention → 比較で最初／二番目に書かれた介入、の順で補う。
- **本人決定 2026-11-24**: 同一 outcome と field の候補で異なる値が複数あれば multiple_values。一つが gold と一致しても不一致。arm・time は採点に使わない。同じ数値の表記差は重複扱い。
- **本人決定 2026-11-24**: 再試行は 429、5xx、通信／timeout、output_limit。プロバイダの retryable も尊重する。最大 4 試行、待機は 15/45/90 秒と Retry-After の大きい方、上限 120 秒。形式不正は再試行しない。spend cap・認証失敗では run と台帳を追加せず全体停止。
- **本人決定 2026-11-24**: 誤り分類に 0（run 失敗）を加え、1 を not_reported と not_returned に分ける。2（反対群）→3（同研究の別項目・同群・同じ値の種類）→4（その他）と優先。multiple_values は 4 の独立内訳。
- **ハーネス設計**: figureOnly は reported の値について、reported と判定した読み手が一人以上いて全員 source=figure なら true、text が一人でもいれば false。該当読み手なし・非 reported は null。
- **ハーネス設計**: レビューを reviewId 順、研究を研究キー順にし、mulberry32(20261122) でレビュー、その中の研究を復元抽出する。2,000 回で全モデルに同じ抽出を使う。reported 分母ゼロのレビュー抽出は平均から除き回数を記録し、全レビューがゼロの反復も記録する。95% 区間は type 7 分位数。対応差はモデル定義順の二番目−最初。
- **ハーネス設計**: 監視費用はキャッシュ割引なしの定価。報告費用は本番の日時別単価（Gemini の期間割引を含む）と Sonnet 補助単価。tokensOut は思考込みで追加加算しない。失敗は usage 実測を優先、出力打ち切りで usage がなければ入力文字数÷4 の切り上げと出力 65,536、それ以外は入力だけ見積もる。全試行を台帳へ先に書き、採点時の研究費用は再試行・中断前の試行も合算する。

主指標は reported のレビュー単位感度の単純平均。ゼロ reported レビューを列挙する。副指標は micro、誤値、二種類の無回答、本文なしへの回答、正確度、derivable 一致、全 gold 一致、引用照合、費用、応答時間、失敗割合。different_value は件数のみとし、ラベルを使わない全 gold 一致と全候補の引用照合には含む。層別も同じ主定義と micro・件数を出す。

本番との差は **1 研究の全項目を一つの依頼で送ること**（本番は分割する）。temperature・応答スキーマは本番を使い、出力上限や reasoning effort を上書きしない。入力は文字層だけなので図にだけある値の抽出には限界がある。

## 保存と公開

`outputs/textlayer/` は PDF ハッシュ付き文字層、`outputs/runs-<label>/` は `_inputs.json`・`_ledger.jsonl` と run JSON、`outputs/gold-lock.json` は gold 固定情報、`outputs/scores-<label>/` は summary.json と values.jsonl。これらと `.env` は git 対象外。破損 run は退避、確定した失敗は永久にスキップ、版数違い・入力ハッシュ違いでは新しいラベルが必要。

公開対象はコード・マニフェスト・この手順・後日の REPORT の集計値。本文、gold の複製、依頼、応答、引用原文は公開しない。values.jsonl は引用・raw response を含まないが、公開は上流 gold の公開範囲に従い、tier 別ライセンス・別レコードで扱う。未公開 gold 部分の値別採点は保留する（計画 §9）。

## ローカル検証

`npm run typecheck` と `npm test` は上流データ・ネットワーク不要。合成入力で結合、変換、再試行、費用、台帳、再開、採点、ブートストラップ、公開安全性を確認する。dry run は実データの文字層キャッシュを用意してから行う。
