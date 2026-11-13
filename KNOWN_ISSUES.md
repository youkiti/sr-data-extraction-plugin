[日本語](KNOWN_ISSUES.md) | [English](KNOWN_ISSUES.en.md)

# 値・集計・Methods に影響した既知の不具合

抽出値、判定、保存、一致度、費用、エクスポート、Methods 文案に影響した不具合と、修正後も確認が必要な過去データを示します。表示・操作だけの問題や機能追加は [CHANGELOG.md](CHANGELOG.md) と関連 PR を参照してください。この一覧は網羅性を保証するものではありません。

## 版と記録の見方

- 版の範囲は両端を含みます。修正版は修正を含む最初のリリースであり、修正コミットの作業中に付いていた package.json の版ではありません。ストアへの反映日は別です。
- origin/master のリリースマージ・版バンプと修正コミットを照合しました。開始版を導入時の実装から推定したものには「推定」と付けています。初期の v0.1.0 は公開前後に同じ版のまま変更があるため、個別の配布物の内容までは断定できません。
- シートはプロジェクトの Google スプレッドシートです。`SchemaFields.field_id` / `field_name` / `entity_level` / `section` で対象項目を確認します。`Evidence` は AI の原出力、`StudyData` / `ResultsData` は annotator ごとの値、`Decisions` は判定履歴です。
- 実行時の版は、記録があれば `ExtractionRuns.extension_version` を確認できます。並行して準備中の `app_version` 列がリリースされた後は、`Decisions.app_version` / `ExtractionRuns.app_version` も、その導入後に書かれた行の確認に使えます。古い行には存在することも埋まることも前提にしません。空欄は「影響なし」ではなく「不明」です。
- 版が不明なら `ExtractionRuns.started_at`、`Decisions.decided_at`、`LLMApiLog.timestamp`、`prompt_version`、保存してある zip や当時の作業記録を突き合わせてください。日時だけで版を確定できません。プロンプト版と拡張の版は別です。
- 更新だけでは過去の保存値・ログ・書き出した CSV・論文の文章は直りません。シートをバックアップし、修正版以降で再集計・再出力してください。値の再抽出が必要な項目では、原文と再照合して人の判定・裁定もやり直してください。監査用の旧行を一括削除することは勧めません。

## 一覧

| ID | 症状 | 影響する版 | 修正版 |
| --- | --- | --- | --- |
| KI-001 | 同じ結果が節ごとに別の行へ分裂 | v0.1.0（推定）〜v0.32.0 | v0.32.0 で軽減、v0.33.0 で分割を防止 |
| KI-002 | 結果の群キーに番号でなく名前が入る | v0.1.0（推定）〜v0.12.0 | v0.13.0 |
| KI-003 | 重複したデータ行で保存が止まり、エクスポートから漏れる | v0.1.0（推定）〜v0.8.0 | v0.9.0 |
| KI-004 | Sheets の部分書き込みを成功と扱う | v0.1.0（推定）〜v0.10.0 | v0.11.0 |
| KI-005 | キャッシュ済み入力も通常単価で概算 | v0.1.0（推定）〜v0.10.0 | v0.11.0 |
| KI-006 | Gemini の思考トークンが費用から漏れる | v0.1.0（推定）〜v0.10.0 | v0.11.0 |
| KI-007 | OpenRouter の実費より概算を優先 | v0.1.0（推定）〜v0.10.0 | v0.11.0 |
| KI-008 | 質問の費用が集計から漏れ、ログ保存失敗で応答も失われる | 質問: v0.11.0〜v0.19.1、保存失敗: v0.1.0（推定）〜v0.19.1 | v0.20.0 |
| KI-009 | 抽出で Options の推論の強さを使わない | v0.7.0〜v0.19.1 | v0.20.0 |
| KI-010 | Methods が未実施の手順や全件完了を記載 | v0.3.0〜v0.19.1 | v0.20.0 |
| KI-011 | 未入力・未完了を含めた一致度やパイロット集計 | 一致度・パイロット: v0.2.0（推定）〜v0.19.1 | v0.20.0 |
| KI-012 | 群の対応を直しても一致度に反映しない | v0.2.0（推定） | v0.3.0 |
| KI-013 | 抄録の結果・方法の設計項目が未報告になりうる | v0.23.0〜v0.32.0 | v0.33.0 |

## 項目ごとの確認と対処

### KI-001 同じ結果の行が節ごとに分かれる

- 症状: section 分割した別々の呼び出しが同じ結果に違う `entity_key` を付け、確認・エクスポートで別の行になり、多くの欄が空に見えます。
- 影響する版: v0.1.0（推定、初期の section 分割実装 `06e90ff9`）〜v0.32.0。v0.32.0 のプロンプト版 15 は先行キーの再利用を指示する軽減策です。v0.33.0 は outcome_result の全項目を一度に送り、節間の別呼び出しによる分裂を防ぎます。
- 確かめ方: `Evidence` の同じ `run_id` / `study_id` で、`SchemaFields` の複数の `section` に属する outcome_result 項目が、実際には同じ結果なのに違う `entity_key` になっていないか確認します。`ResultsData.study_id` / `field_id` / `entity_key` / `value` も照合します。異なる結果を誤ってまとめないでください。
- 直し方・回避策: v0.33.0 以降で該当研究の outcome_result 項目をまとめて再抽出し、原文と比較して検証・裁定・エクスポートをやり直します。過去の行は自動統合されません。
- 関連: [PR #473](https://github.com/youkiti/sr-data-extraction-plugin/pull/473)、[PR #476](https://github.com/youkiti/sr-data-extraction-plugin/pull/476)。

### KI-002 outcome_result だけのバッチで群キーが番号にならない

- 症状: arm 項目を含まないバッチに番号づけの指示がなく、群名をキーに使うと群の対応や結果行の突き合わせが崩れます。
- 影響する版: v0.1.0（推定、初期の結果キー指示）〜v0.12.0。v0.13.0 でプロンプト版 11 の番号規則と不正キーの破棄を導入しました。
- 確かめ方: `Evidence.entity_key` / `ResultsData.entity_key` の `arm:` の直後が正の整数か、`ArmStructures.arm_key` と同じ群を指すか、`study_id` を合わせて確認します。例: `arm:placebo` は不正です。
- 直し方・回避策: 更新後に対象の結果を再抽出し、原文と群構成を確認して再判定します。旧キーを文字列置換するだけでは群の対応を保証できません。
- 関連: [PR #302](https://github.com/youkiti/sr-data-extraction-plugin/pull/302)。

### KI-003 同時保存で重複行ができ、その後の保存や出力が失敗

- 症状: 同時の判定・裁定書き込みで同じキーの行が重複し、以後の転記・保存が止まります。StudyData の人の行が重複すると最終値のエクスポート対象から漏れる場合もありました。
- 影響する版: v0.1.0（推定、annotator 行の読み取り後に追記する実装）〜v0.8.0。修正版 v0.9.0 は書き込みの直列化と、読み取り時の重複解決を含みます。
- 確かめ方: `StudyData` の `study_id` / `annotator`、`ResultsData` の `study_id` / `annotator` / `entity_key` / `field_id` が同じ行を探し、`updated_at` と値を比較します。`Decisions` に期待した `action` / `value` が届いているかも確認します。
- 直し方・回避策: 更新後は `updated_at` が最大の行（同時刻なら下の行）を採用します。旧行は残ります。採用値と判定履歴を照合し、保存できなかった判定をやり直して再出力してください。同じブラウザの直列化は別端末間の同時編集を保証しません。
- 関連: [PR #238](https://github.com/youkiti/sr-data-extraction-plugin/pull/238)、[PR #240](https://github.com/youkiti/sr-data-extraction-plugin/pull/240)。

### KI-004 行が一部しか保存されていなくても抽出成功

- 症状: Sheets の応答が HTTP 2xx なら、要求した行数より少なくても成功と扱いました。実例では Evidence が 69 行中 1 行でも run が done でした。値・根拠・判定の欠落を見逃す可能性があります。
- 影響する版: v0.1.0（推定、append 応答の行数を未検査）〜v0.10.0。修正版 v0.11.0。
- 確かめ方: `ExtractionRuns.run_id` / `study_ids` / `field_ids` / `status` と `Evidence.run_id` / `study_id` / `field_id` を照合し、保存済みの `LLMApiLog.response_ref` の応答にある項目が欠けていないか確認します。Decisions の `study_id` / `field_id` / `action` も作業記録と照合します。旧行の `warnings` が空でも欠落なしとは言えません。
- 直し方・回避策: 更新して欠落分を再抽出・再検証します。修正版は部分保存を失敗として扱い、`ExtractionRuns.warnings` に `evidence_row_count` を記録します。部分保存後の無条件の再送は重複を生みうるため、先に保存済みの行を確認してください。
- 関連: [PR #250](https://github.com/youkiti/sr-data-extraction-plugin/pull/250)。

### KI-005 キャッシュの割引を概算に反映しない

- 症状: キャッシュ済みの入力トークンにも通常の入力単価を掛け、費用を過大に表示しました。旧版には割引計算に必要な記録がない場合があります。
- 影響する版: v0.1.0（推定、初期の概算）〜v0.10.0。修正版 v0.11.0。
- 確かめ方: `LLMApiLog.provider` / `model` / `tokens_in` / `cost_estimate_usd` と、`response_ref` の使用量・キャッシュ情報を照合します。`cached_tokens_in` は導入前の行では空または列なしです。
- 直し方・回避策: 過去の費用は残っている応答と当時の単価、プロバイダの請求記録で確かめます。更新しても古い `cost_estimate_usd` は書き換わりません。研究報告で概算と請求額を区別してください。
- 関連: [PR #257](https://github.com/youkiti/sr-data-extraction-plugin/pull/257)。

### KI-006 Gemini の思考トークンが出力費用から漏れる

- 症状: 出力を本文のトークンだけで数え、思考のある応答の費用・出力トークン数を過小に記録しました。実行前概算も思考分を見込みませんでした。
- 影響する版: v0.1.0（推定、初期の Gemini 使用量処理）〜v0.10.0。修正版 v0.11.0。
- 確かめ方: `LLMApiLog.provider=gemini` の `tokens_out` / `cost_estimate_usd` と `response_ref` の `usageMetadata.candidatesTokenCount` / `thoughtsTokenCount` を照合します。`ExtractionRuns.tokens_out` / `cost_estimate` の過去集計も対象です。
- 直し方・回避策: 元応答があれば本文と思考の合計から当時の単価で再計算し、請求記録とも比較します。応答が残っていなければ不足分の正確な復元はできません。修正版は以後の記録と概算に反映します。
- 関連: [PR #269](https://github.com/youkiti/sr-data-extraction-plugin/pull/269)。

### KI-007 OpenRouter の実費を使わず概算を記録

- 症状: 応答の `usage.cost` より静的単価表の概算を優先しました。deepseek-v4-flash で実費の半額の記録が確認されました。全モデルで同じ倍率とは限りません。
- 影響する版: v0.1.0（推定、初期の OpenRouter 概算）〜v0.10.0。修正版 v0.11.0。
- 確かめ方: `LLMApiLog.provider=openrouter` の `model` / `cost_estimate_usd` と、`response_ref` の `usage.cost` やプロバイダの請求を比較します。
- 直し方・回避策: 過去分は応答・請求記録から訂正して報告します。更新後は有限の非負の `usage.cost` があれば優先しますが、古い行は変わりません。
- 関連: [PR #272](https://github.com/youkiti/sr-data-extraction-plugin/pull/272)。

### KI-008 質問の費用が集計から漏れる、ログ保存失敗で応答も失われる

- 症状: 質問のログを参照 URL が空という理由で警告専用行と誤認し、費用・使用量から除外しました。別途、ログ payload の Drive 保存失敗で、課金済みの応答とログ行が失われ、抽出値も届かない場合がありました。
- 影響する版: 質問の集計は導入版 v0.11.0〜v0.19.1。payload 保存失敗は v0.1.0（推定、初期ロガー）〜v0.19.1。修正版 v0.20.0。
- 確かめ方: `LLMApiLog.purpose=ask_paper` で `prompt_ref` / `response_ref` が空でも `latency_ms` / `tokens_in` / `tokens_out` / `cost_estimate_usd` がある行を探し、当時の usage.csv・合計と比較します。失われたログ自体はシートだけで検出できず、`ExtractionRuns.status`、当時のエラー、請求記録との照合が必要です。
- 直し方・回避策: 更新後に質問分を再集計・再出力します。欠けた応答・費用は自動復元されません。保存失敗した抽出は原文と照合して再実行します。修正版は payload 保存失敗でも応答とログ行を残し、`prompt_summary` に `[payload_upload_failed]` を付けます。
- 関連: [PR #388](https://github.com/youkiti/sr-data-extraction-plugin/pull/388)。

### KI-009 抽出に推論の強さの設定が渡らない

- 症状: パイロット・本抽出・失敗分の再実行で Options の reasoning effort を渡さず、設定した条件と実際の抽出条件が違う場合がありました。抽出値と Methods の設定記述に影響します。
- 影響する版: 設定導入版 v0.7.0〜v0.19.1。修正版 v0.20.0。プロバイダが対応しない設定や既定値と同じ指定では差が生じないことがあります。
- 確かめ方: `ExtractionRuns.provider` / `requested_model` / `started_at` と、当時の Options の記録、`LLMApiLog.prompt_ref` に残る設定情報（送信値が記録されている場合のみ）を照合します。後から追加された `reasoning_effort` / `sent_settings` が古い行で空でも、送信値の証明にはなりません。当時の Options の値だけでは実際の送信値を確定できません。
- 直し方・回避策: Methods は確認できた実際の送信条件に合わせ、不明なら不明とします。指定条件での抽出が必要なら更新後にパイロットから再抽出・再検証してください。
- 関連: [PR #388](https://github.com/youkiti/sr-data-extraction-plugin/pull/388)。

### KI-010 Methods が記録に合わない手順を断定

- 症状: 草案作成・パイロット・改訂、全研究の全項目抽出、全セルの検証、独立抽出や裁定済みの記述が、実際の実施状況と合わない場合がありました。草案と抽出のモデルも区別できていませんでした。
- 影響する版: Methods カードの導入を最初に含むリリース v0.3.0〜v0.19.1。修正版 v0.20.0。
- 確かめ方: 以前コピーした文章を、`ExtractionRuns.run_type` / `status` / `study_ids` / `field_ids`、`LLMApiLog.purpose` / `model` / `error` / `prompt_summary`、`StudyData` / `ResultsData` の `annotator_type`、`Decisions.action` と比較します。特に `[batch_failed]` / `[transfer_failed]`、未判定セル、consensus 行の有無を確認します。
- 直し方・回避策: 更新後に文案を作り直し、研究で実際に行った手順と照合して論文を修正します。表示中の拡張版は過去の抽出時の版とは限りません。古い記録で確認できない手順を実施済みと書かないでください。
- 関連: [PR #390](https://github.com/youkiti/sr-data-extraction-plugin/pull/390)（`2b881c79` / `4eea8fcf`）。

### KI-011 未入力・未完了を含めて一致度やパイロットを集計

- 症状: 裁定で両者とも空のセルを一致・一括採用の対象にし、一致度レポートに検証未完了の研究を含めていました。パイロットの未判定を外れに混ぜ、AI も未報告だったセルへの人の未報告判定を承認に数えない問題もありました。
- 影響する版: 一致度・パイロットは導入を最初に含むリリース v0.2.0（推定）〜v0.19.1。裁定の両者空欄も v0.2.0 時点の実装に存在しました。修正版 v0.20.0。
- 確かめ方: `StudyData` / `ResultsData` の同じ study・項目・entity_key の二人の `annotator` / `value` と、`Decisions.action` / `annotator` / `field_id` を確認します。両方の空欄を「検証して未報告」と混同しないでください。`Evidence.not_reported` と人の `not_reported` 判定も照合し、過去の一致率・κ・パイロット CSV と再集計値を比較します。
- 直し方・回避策: 二人の検証を終えてから修正版で一致度・パイロット集計を再出力します。古い一括採用があれば `Decisions.annotator_type=consensus` の値と原文を確認し、必要な判定をやり直します。
- 関連: [PR #391](https://github.com/youkiti/sr-data-extraction-plugin/pull/391)。

### KI-012 群の対応を修正しても一致度は位置で比較

- 症状: 裁定で B の群を正しく対応づけても、一致度レポートが B の生キーで比較し、裁定画面では一致したセルを不一致として数える場合がありました。
- 影響する版: v0.2.0（推定、群マッピング・一致度導入後）。修正版 v0.3.0。
- 確かめ方: 同じ `study_id` の `ArmStructures.annotator` / `version` / `note` にある consensus の確定済みマッピングと、`ResultsData.annotator` / `entity_key` / `field_id` / `value` を比較します。群を並べ替えた研究の古い一致率・κが対象です。
- 直し方・回避策: 修正版で群の対応を確認して再集計・再出力します。consensus の群構成が未確定なら、先に対応を確定してください。
- 関連: [PR #146](https://github.com/youkiti/sr-data-extraction-plugin/pull/146)（`780f147c`）。

### KI-013 抄録の結果や方法の設計項目が欠落しうる

- 症状: outcome_result を研究自身の結果に限定する規則が、抄録にしかない結果や方法にある検査・尺度・閾値などにも強く適用され、未報告扱いになる場合がありました。すべての実行で起きるとは限りません。
- 影響する版: 規則導入版 v0.23.0〜v0.32.0（プロンプト版 13〜15）。修正版 v0.33.0（版 16）。
- 確かめ方: `LLMApiLog.prompt_version` と `Evidence.study_id` / `field_id` / `entity_key` / `not_reported` / `value` を確認し、outcome_result の設計項目と抄録だけにある結果を PDF の方法・抄録と比較します。`ResultsData.value` の欠落も対象です。列がない旧ログでは保存済み payload を確認してください。
- 直し方・回避策: v0.33.0 以降で該当項目を再抽出し、原文を見て再判定します。版 16 は抄録を研究自身の結果に含め、設計項目は方法・抄録からも抽出すると明示します。
- 関連: [PR #477](https://github.com/youkiti/sr-data-extraction-plugin/pull/477)、規則の導入 [PR #417](https://github.com/youkiti/sr-data-extraction-plugin/pull/417)。

## 版の根拠

主な修正版の版バンプを含むコミット: v0.3.0 `3cab8541`、v0.9.0 `7e3e95cc`、v0.11.0 `189a24b2`、v0.13.0 `be45c85f`、v0.20.0 `a486e0d8`、v0.32.0 `654b44bf`、v0.33.0 `878c6313`。Methods の導入は `fffeb545`、推論の強さの設定導入は `f4c2c845`、質問の導入は `66a08abe`。リリース境界と導入の照合による範囲であり、個々のストア配布物の検証結果ではありません。
