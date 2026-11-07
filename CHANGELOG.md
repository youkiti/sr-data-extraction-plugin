# 変更履歴 / Changelog

この拡張の公開の変更履歴です。AI の出力（抽出値・引用・スキーマのドラフト・回答）や、その集計の結果を変えうる変更は、必ず「AI の結果に影響する変更」に載せます。対象は、既定モデル、プロンプトとその版数、推論の強さなどの既定値、引用の照合と一致度などの集計方法です。プロンプトの版数は、各 AI 呼び出しのログ（プロジェクトのシートの LLMApiLog タブの prompt_version 列）に記録されます（この列を足す前の行は空です）。

This is the public changelog of this extension. Any change that can alter AI output (extracted values, quotes, schema drafts, answers) or the way those results are counted is always listed under "Changes that affect AI output". This covers the default model, prompts and their version numbers, defaults such as reasoning effort, and counting methods such as quote anchoring and agreement statistics. The prompt version is recorded in the log of each AI call (the prompt_version column of the LLMApiLog tab in the project sheet; rows written before that column was added are empty).

- v0.27.0 以前は、AI の結果に影響する変更だけを、git の履歴と PR からさかのぼって載せています。それ以外の変更は [GitHub の PR](https://github.com/youkiti/sr-data-extraction-plugin/pulls?q=is%3Apr+is%3Amerged) を参照してください。  
  Up to v0.27.0, only changes that affect AI output are listed, reconstructed from the git history and pull requests. For other changes, see the [merged pull requests](https://github.com/youkiti/sr-data-extraction-plugin/pulls?q=is%3Apr+is%3Amerged).
- 版は、その変更が最初に入ったリポジトリの版です。Chrome ウェブストアへの反映は審査の後になるため、ストアの公開版が少し遅れることがあります。  
  The version is the first repository version that contains the change. The Chrome Web Store version can lag behind because of store review.
- 日付は変更がマージされた日です。  
  Dates are the dates the change was merged.

## 未リリース / Unreleased

### その他の変更 / Other changes
- 同意画面の Gemini の無料枠の説明を Gemini API 追加利用規約の原文の範囲にそろえました。同意済みの方にも、次の AI 機能の実行前に 1 回だけ確認を出し直します（2026-11-07、#381）。  
  Aligned the Gemini free tier explanation in the consent notice with the scope of the Gemini API Additional Terms of Service. Users who already agreed will see the notice once again before their next AI feature (2026-11-07, #381).
- 文献取り込みで Drive からのコピーに失敗したとき、進捗の表示に Google が返した理由（例 `appNotAuthorizedToFile`）を添え、診断ログ（ApiErrorLog タブ）にも記録するようにしました（2026-11-07、issue #279）。  
  When copying from Drive fails during document import, the progress display now includes the reason returned by Google (e.g. `appNotAuthorizedToFile`), and the failure is also recorded in the diagnostic log (ApiErrorLog tab) (2026-11-07, issue #279).
- 公開の変更履歴（このファイル）を作り、利用規約とヘルプから変更の告知先として案内するようにしました。リリースの手順で、既定モデル・プロンプトの版数・推論の強さの既定が前回のリリースから変わったのにこのファイルが更新されていなければ止まるようにしました。  
  Added this public changelog and named it in the terms of service and the help page as the place where changes are announced. The release procedure now stops when the default model, a prompt version or the default reasoning effort has changed since the previous release and this file has not been updated.

- 最初のログインの前に、メールアドレスの用途と自分の Drive・Sheets への保存を告知し、同意を記録するようにしました。ログイン済みの方には、次にプロジェクト選択ページを開いたときに 1 回だけ確認を出します（2026-11-07、#381）。  
  Before the first sign-in, a notice explains how your email address is used and that data is saved in your own Drive and Sheets, and your consent is recorded. Users who are already signed in will see the notice once when they next open the project page (2026-11-07, #381).

## v0.23.0（2026-10-26）

### AI の結果に影響する変更 / Changes that affect AI output
- extract-data プロンプトを版数 13 にしました。アウトカムの抽出を、その研究自身の結果に限る規則を足しました（2026-10-26、#417）。  
  extract-data prompt version 13: added a rule that limits outcome extraction to the study's own results (2026-10-26, #417).

## v0.21.0（2026-10-21）

### AI の結果に影響する変更 / Changes that affect AI output
- draft-schema プロンプトを版数 3 にしました。表のデザインの AI ドラフトで、カテゴリ集計の項目を選択肢（enum、unclear 付き）で提案させます（2026-10-21、#402）。  
  draft-schema prompt version 3: the AI schema draft proposes categorical items as enums with an "unclear" option (2026-10-21, #402).
- draft-schema プロンプトを版数 4 にしました。プロトコルとサンプル論文から群間比較と群別の数値データの有無を判断し、どちらも無ければ群（arm）と結果（outcome_result）の項目を作りません（2026-10-21、#412）。  
  draft-schema prompt version 4: the draft decides from the protocol and sample papers whether there are group comparisons and per-arm numeric data, and creates no arm or outcome_result items when there are none (2026-10-21, #412).
- suggest-enum プロンプト（版数 1）を追加しました。自由記述の項目を、AI の提案する選択肢に変えられます（2026-10-21、#406）。  
  Added the suggest-enum prompt (version 1), which proposes allowed values to turn a free-text item into a choice list (2026-10-21, #406).

## v0.20.0（2026-10-21）

### AI の結果に影響する変更 / Changes that affect AI output
- 集計方法: 裁定（S12）で、両者とも空のセルを一致に数えないようにしました。一致度レポートは、2 名とも検証を終えた研究だけを数え、外した件数を示します。パイロットの「未判定の論文」の数え方も直しました（2026-10-21、#391）。  
  Counting: in adjudication (S12), cells left empty by both reviewers are no longer counted as agreement. The agreement report counts only studies that both reviewers have finished verifying and shows how many were left out. The count of unreviewed papers in the pilot was also corrected (2026-10-21, #391).

## v0.18.0（2026-10-16）

### AI の結果に影響する変更 / Changes that affect AI output
- 推論の強さ: Gemini 3 系のモデルへ推論の強さ（thinkingLevel）を送るようにし、Options で未設定のときの既定を low にしました。それまで Gemini には推論の強さを送らず、モデル側の既定で動いていました（2026-10-16、#370）。  
  Reasoning effort: Gemini 3 models are now sent a reasoning effort (thinkingLevel), and the default when Options leaves it unset is low. Before this, no reasoning effort was sent to Gemini and the model's own default applied (2026-10-16, #370).
- 費用の見積もり: 単価表に無いモデルの費用を、OpenRouter から取得した単価で見積もるようにしました（2026-10-16、#371）。  
  Cost estimates: the cost of models missing from the price table is now estimated from prices fetched from OpenRouter (2026-10-16, #371).

## v0.13.0（2026-10-05）

### AI の結果に影響する変更 / Changes that affect AI output
- extract-data プロンプトを版数 11 にしました。outcome_result だけのバッチでも、群のキーを番号にします（2026-10-04、#302）。  
  extract-data prompt version 11: arm keys are numbered even in batches that contain only outcome_result items (2026-10-04, #302).
- extract-data プロンプトを版数 12 にしました。複数選択の項目を選択肢ごとの引用つきで抽出し、すべての引用に節の見出しを持たせます（2026-10-04、#308）。  
  extract-data prompt version 12: multi-select items are extracted with a quote per selected option, and every quote carries its section heading (2026-10-04, #308).
- 集計方法: 一致率と κ のカテゴリに複数選択の正準化を掛け、一致の判定と数え方をそろえました（2026-10-04、#308）。  
  Counting: agreement rates and kappa now normalize multi-select answers, so they count agreement the same way the cell comparison does (2026-10-04, #308).

## v0.12.0（2026-10-04）

### AI の結果に影響する変更 / Changes that affect AI output
- 既定モデル: 工場出荷の既定モデルを `gemini-3.5-flash` から `gemini-3.8-flash` に切り替えました。実データ抽出ベンチマーク（2026-09-21 の run、各 1 反復）で、項目正確度 75.4% 対 72.5%（差は誤差の範囲）、1 論文の費用 0.07 対 0.23 USD、応答時間 32 対 75 秒でした（2026-10-04、#296）。Options で既定モデルを設定済みの利用者には影響しません。  
  Default model: the factory default changed from `gemini-3.5-flash` to `gemini-3.8-flash`. In the real-data extraction benchmark (run of 2026-09-21, one replicate each), item accuracy was 75.4% vs 72.5% (within noise), cost per paper USD 0.07 vs 0.23, and response time 32 vs 75 seconds (2026-10-04, #296). Users who set a default model in Options are not affected.
- 引用の照合: 引用全体の照合に失敗したとき、改行や省略記号で断片に分け、すべての断片が照合できれば複数の引用として保存するようにしました。照合の成否（anchor_status）の集計が変わります。プロンプトと版数は変えていません（2026-10-04、#296）。  
  Quote anchoring: when a whole quote fails to anchor, it is split at line breaks and ellipses, and saved as several quotes if every fragment anchors. This changes anchor_status counts. The prompt and its version were not changed (2026-10-04, #296).

## v0.11.0（2026-09-30）

### AI の結果に影響する変更 / Changes that affect AI output
- extract-data プロンプトを版数 10 にしました。最大引用数（max_quotes）を持つ項目で、複数の引用を返せるようにしました（2026-09-30、#276）。  
  extract-data prompt version 10: items with max_quotes can return several quotes (2026-09-30, #276).
- ask-paper プロンプト（版数 1）を追加しました。論文への質問パネルで、1 研究の本文だけを文脈に、照合済みの引用つきで回答します（2026-09-30、#273）。  
  Added the ask-paper prompt (version 1), used by the question panel to answer from one study's full text with anchored quotes (2026-09-30, #273).
- 費用の見積もり: プロンプトキャッシュのヒット分を費用の概算に反映し、同じ研究のバッチを順に送るようにしました（2026-09-03、#257）。  
  Cost estimates: prompt-cache hits are reflected in the cost estimate, and batches of the same study are sent one after another (2026-09-03, #257).

## v0.7.0（2026-08-03）

### AI の結果に影響する変更 / Changes that affect AI output
- extract-data プロンプトを版数 9 にしました。版数 8 で入れた図表の高精度読み取りモードを撤去しました。実データのベンチマークで正確度の改善がほぼ無く（全体 +0.2 ポイント）、入力トークンが 56%、費用が 14% 増えたためです（2026-07-29、#206）。  
  extract-data prompt version 9: removed the high-accuracy figure and table reading mode added in version 8. In the real-data benchmark it barely improved accuracy (+0.2 points overall) while raising input tokens by 56% and cost by 14% (2026-07-29, #206).
- 推論の強さ: Options で既定の推論の強さを設定できるようにしました。未設定のときは各プロバイダの従来の挙動のままです（2026-08-02、#213）。  
  Reasoning effort: a default reasoning effort can be set in Options. When it is unset, each provider behaves as before (2026-08-02, #213).

## v0.5.0（2026-07-23）

### AI の結果に影響する変更 / Changes that affect AI output
- extract-data プロンプトを版数 8 にしました。図表の高精度読み取りモード（ページ画像の添付）を追加しました（2026-07-22、#178）。v0.7.0 で撤去しています。  
  extract-data prompt version 8: added a high-accuracy figure and table reading mode that attaches page images (2026-07-22, #178). Removed in v0.7.0.

## v0.4.0 まで / Up to v0.4.0（2026-07-21 以前 / before 2026-07-21）

v0.1.0（ストアでの一般公開は 2026-07-12）から v0.3.0 までの各版の境目は記録がそろっていないため、ここでは日付で示します。いずれも v0.4.0（2026-07-21）には入っています。

The boundaries between v0.1.0 (publicly released on the store on 2026-07-12) and v0.3.0 are not fully recorded, so these changes are listed by date. All of them are included in v0.4.0 (2026-07-21).

### AI の結果に影響する変更 / Changes that affect AI output
- extract-data プロンプト版数 1: 最初の版（2026-07-03、#7）。  
  extract-data prompt version 1: first version (2026-07-03, #7).
- 既定モデル: 工場出荷の既定モデルを `gemini-3.5-flash` に決めました。それまでは工場出荷の既定が無く、Options か画面でモデルを指定していました。実データ抽出ベンチマーク（2026-07-06）で項目正確度が最良だったためです（2026-07-06、#9）。  
  Default model: the factory default was set to `gemini-3.5-flash`. Before this there was no factory default, and the model had to be chosen in Options or on screen. It had the best item accuracy in the real-data extraction benchmark of 2026-07-06 (2026-07-06, #9).
- extract-data プロンプト版数 2: 抽出を研究（study）単位にしました（2026-07-09、#23）。  
  extract-data prompt version 2: extraction became per study (2026-07-09, #23).
- extract-data プロンプト版数 3 と 4: スキャン PDF を画像として読む経路（pdf_native）と、座標によるハイライトを追加しました（2026-07-12、#57）。  
  extract-data prompt versions 3 and 4: added the pdf_native path that reads scanned PDFs as images, and coordinate-based highlights (2026-07-12, #57).
- extract-data プロンプト版数 5: プロンプトの並びを変え、論文をまたいで共有できる前半（キャッシュが効く部分）を作りました（2026-07-12、#91）。  
  extract-data prompt version 5: reordered the prompt so that a shared prefix can be cached across papers (2026-07-12, #91).
- extract-data プロンプト版数 6: 群（arm）の取りこぼしを防ぐため、末尾に網羅の指示を足しました（2026-07-13、#104）。  
  extract-data prompt version 6: added a completeness instruction at the end to prevent missed arms (2026-07-13, #104).
- relocate-quote プロンプト版数 1: 照合できなかった引用を AI で探し直す機能を追加しました（2026-07-13、#101）。  
  relocate-quote prompt version 1: added AI re-location of quotes that failed to anchor (2026-07-13, #101).
- draft-schema プロンプト版数 2: スキーマのドラフトをレビューの種類に合わせるようにしました（2026-07-19、#157）。  
  draft-schema prompt version 2: the schema draft adapts to the review type (2026-07-19, #157).
- extract-data プロンプト版数 7 と relocate-quote プロンプト版数 2: 原文の言語を保つ指示を足しました（日本語の論文への対応）（2026-07-20、#160・#162）。  
  extract-data prompt version 7 and relocate-quote prompt version 2: added instructions to keep the source language, for Japanese papers (2026-07-20, #160 and #162).
