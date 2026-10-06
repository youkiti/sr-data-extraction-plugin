# sr-data-extraction-plugin 要件定義書（v0.36）

- **作成日**: 2026-07-02（v0.1）/ **更新**: 2026-07-02（v0.2: 未決定事項を暫定確定に格上げ・関連ドキュメント整備 / v0.3: ユーザーレビュー反映 — Q1・Q4・Q6・Q7・Q9 確定、スキャン PDF 対応方針、規模想定の拡大、Q8 に CESAR 基準を追記 / v0.4: データ設計を再編 — `StudyData`（wide）+ `ResultsData`（long）+ annotator 軸で二重抽出に対応、著作権確認チェック機能を廃止し事前確認の運用へ / v0.5: 整合性レビュー反映 — `Documents` に `source_file_id` を追加しコピー ID と分離、`text_ref` を `no_text_layer` 時のみ空に、AI 出力 JSON を `field_id` 基準に変更、`StudyData` / `ResultsData` の更新キーを明文化、`Decisions` に `schema_version` / 対象 annotator を追加、二重抽出の MVP/P1 境界を明記 / v0.6: `audit.csv` の行形式を確定 — 判定中心デノーマライズ型（1 行 = 1 判定イベント + 未判定セルのプレースホルダ行）、Evidence 添付規則・列仕様・構造的欠損トークン `.` を §4.4 に明文化 / v0.7: 群構成の確定を永続化する `ArmStructures` タブを追加（12 → 13 タブ）— 検証画面冒頭の arm 確定 UI（§4.2）の保存先。1 行 = 1 arm・確定/改訂のたびに全 arm 行を新 version で追記する追記型。`entity_key`（`arm:n`）で `ResultsData` と join でき、メタ解析前処理での流用を想定 / v0.8: 著作権への配慮に関する文言を UI から削除 — 学術研究目的のデータ抽出（テキスト・データマイニング）は著作権法上の権利制限規定（30 条の 4 等）の範囲内であり適法との整理。「著作権フリーのみ対象」という前提記述も廃止。取り込み画面の注意書きは PDF の外部送信先（LLM API のみ）の説明だけを残す / v0.9: RoB テンプレートスキーマを P1 から MVP へ前倒し（2026-07-07）— `rob_domain` レベルを MVP の 4 レベル目として確定し、RoB 2 / ROBINS-I の 2 テンプレートを S5 のプリセット挿入で提供（判定 enum + 根拠 text × 固定ドメイン）。entity_key は可読な `rob:<domain_id>` 形式（例 `rob:d1_randomization`）とし、AI ドラフト（draft-schema）は RoB 項目を出さない = テンプレート挿入が唯一の入口。群構成の確定ゲートは arm / outcome_result タブのみに適用（rob_domain タブは arm 未確定でも検証可） / v0.10: 複数報告文書（multiple reports）を 1 試験へ統合する study / document モデルを導入（2026-07-07）— 1 つの試験（trial）は本論文・試験登録・プロトコル論文・学会抄録など複数の PDF を持ちうるため、**study を抽出・検証・エクスポートの単位、document を quote アンカリング・ハイライトの単位**に分離。`Studies` タブ新設（13 → 14 タブ。study_label は Documents から移設 + registration_id 追加）、`Documents` に `study_id` / `document_role` を追加。データ行のキーを document_id → study_id へ改名（`StudyData` / `ResultsData` / `ArmStructures` / `Decisions`、`ExtractionRuns.document_ids` → `study_ids`、`run_type: single_document` → `single_study`、`LLMApiLog.purpose: extract_document` → `extract_study`、`ExportLog.document_count` → `study_count`）。`Evidence` のみ quote の出所文書を特定するため document_id を保持したまま study_id を併記。抽出は 1 study = 1 抽出単位（全文書をロール付き区切りで連結、応答要素に `document_index` を必須化 §4.3）。S3 にグルーピング UI（§4.5: 取り込みは 1 PDF = 1 study 自動生成 → 後から統合。試験登録番号の自動検出は候補提案 → ユーザー確認で自動統合はしない）。グルーピング変更は常に新 study_id を発行して当該試験を「未抽出」へ戻す（旧データ行は監査用に残置）。未リリースのため後方互換は持たない） / v0.11: 独立二重レビュー機能を追加（2026-07-11・issue #44）— 第 2 の human reviewer による盲検レビューと、ヒトの不一致を裁定する `consensus` 確定を導入。`Reviewers` タブ新設（14 → 15 タブ。email / role〔`reviewer` / `adjudicator` / `revoked`〕/ review_mode〔`with_ai` / `independent`〕/ assigned_by / assigned_at）、annotator の予約値に `consensus`（裁定確定行）を追加、S8 検証画面に独立入力モード（AI 出力を見せず人間が直接入力）、S12 裁定画面（`#/adjudicate`）を新設。ロール（owner / reviewer_with_ai / reviewer_independent / adjudicator / unregistered）はメインビュー起動時に 1 回解決し、未解決・解決失敗・未登録はフェイルクローズで全画面ブロックする。§7 の P1「二重独立抽出 + 不一致解決画面」（Q4）を実装済みへ更新（2 アカウントでの実機通し確認は未実施。詳細設計は [docs/design-independent-dual-review.md](design-independent-dual-review.md)） / v0.12: リリース後ロードマップの確定（2026-07-12）— (1) pdf_native モード（スキャン PDF のページ画像抽出 + bbox 座標ハイライト）を実装済みへ更新し、Q3 の入力方式は text_status による自動判定（`no_text_layer` → `pdf_native` / それ以外 → `text_only`）で確定（born-digital を画像入力へ回す比較トグルは実装せず `experiments/` に委譲）。(2) Q2（tiab-review 連携）を「tiab の Sheet を直読みして最終判定 include の Reference を study 化・study_label / DOI / PMID を自動付与」で再定義（issue #68。旧 §4 提案6 の study_label 自動化も同時充足）。(3) カスタムモデル一覧管理 UI（旧 P1）はクローズ — OpenAI 互換 + ローカル LLM + 直接入力で実需をカバー。(4) 40,000 行規模の負荷試験を実施（§9・ローカル実測）— ai 行転記の appendRows にチャンク制御が無い非対称性を発見（issue #69）。(5) R 解析向け CSV エクスポート契約を issue #60 で設計中。残タスクは issue #60〜#69 と [docs/remaining-work-plan.md](remaining-work-plan.md) を参照 / v0.13: run 単位のフィールド選択（案 A・issue #80。2026-07-12）を実装済みへ更新 — `ExtractionRuns` に `field_ids` 列を追加（§3.2。フェーズ 1）し、S6 / S7 の実行前画面に対象項目チェックリスト（既定 = 全選択・section 単位の折りたたみ + 全選択/全解除トグル・選択 0 件は実行不可）を追加（フェーズ 2）。選択サブセットは `runExtraction` の `fields` を絞り込み、記録用 `fieldIds`（全選択時は null）を渡す。検証・ダッシュボードは field_id 単位で「その field を対象に含む最新の完了 run」の Evidence を採用する合成ビューへ切替済み（フェーズ 1）。S7 の抽出済みバッジにサブセット run の「n/m 項目」注記、実行確認カードに対象項目数、失敗 study の再試行は元 run と同じ選択を引き継ぐ（A-2）、選択は画面入場・対象再読込のたびに全選択へリセット（A-4・storage 永続化なし）、S10 の未検証セル警告にサブセット抽出の注意書きを追加（A-3。分母は不変更）。詳細は §4.3 参照 / v0.14: 図表の高精度読み取りモード（issue #176・実装 PR。2026-07-21）を追加 — `text_only` が表・図のレイアウト構造（列位置・セル境界）を保持しないという実務上の課題に対処するため、`input_mode` に高精度読み取り用の値を新設。テキスト層のある文書についても本文に加えて全ページのレンダリング画像を併用添付できる run 単位のオプトインを S6 / S7 に追加した（既定 OFF・選択中プロバイダが画像入力非対応なら disabled）。`planRun.estimateBatch` に画像トークンの見積もりを算入、`extractData` は `ExtractDataDocument` に画像併用モードを追加しプロンプト版数を v8 へ（quote は添付テキスト基準を維持する規約を追記）。Q3 の「born-digital を比較目的で画像入力へ回すトグルは実装しない」という 2026-07-12 確定は維持しつつ、本モードは「比較実験」ではなく「テキスト構造欠落の実務上の救済」として区別する。**ベンチマークによる効果測定・採否判断は本 PR のスコープ外**で別 PR に委ね、issue #176 は実装完了後もクローズしない（**2026-07-29 追記**: 実 gold ベンチで効果が誤差範囲だったため不採用と決定し、v0.16 で撤去） / v0.15: プロトコル改訂後の AI 再ドラフト導線（issue #197。2026-07-24）を追加 — S5 確定済み画面に陳腐化バナー（現行スキーマ版の `protocol_version` が最新プロトコル版より古いときに表示）+ 再ドラフト導線を追加し、現行版が 1 件以上あるときの draft-schema skill 実行結果はエディタへ直行させず差分承認画面（追加 / 変更 / 削除候補 / 変更なし + RoB テンプレートの保持）を経由させる。field_id は field_name 一致で継承し（§3.2）、`created_by_type` は差分選択が既定のままなら `ai_draft`・1 つでも変更していれば `user_edit`。`protocol_version` は確定時に常に最新プロトコル版を刻む（親版継承はしない）方針を明記した（§3.3） / v0.16: 図表の高精度読み取りモード（issue #176）を不採用に変更し、実装ごと撤去（2026-07-29）— 実 gold ベンチ（不眠 SR 10 論文・gemini-3.5-flash）で表由来項目正確度 +0.1pp・全体 +0.2pp と効果が誤差範囲、入力トークン +56%・コストが +14% だったため、事前基準（v0.14 の「ベンチマークによる効果測定・採否判断は別 PR」）に従い v0.14 で追加した機能一式（`input_mode` の値・`extractData` v8 の画像併用規約・S6/S7 のトグル UI）を撤去した。Q3 の入力方式は v0.12 確定（text_status による自動判定 = `pdf_native` / `text_only` の 2 値）のまま。記録は issue #176 コメント（2026-07-29）と非公開ベンチ REPORT-20260729 / v0.17: §4.6（S12 裁定画面）と Q4 の記述を実装実態へ同期（2026-08-05・仕様変更なし）— 「v1 の簡略化」として列挙していた 5 点（PDF ペインの Evidence ハイライト・`Decisions.note` 表示・裁定書き込みのオフラインキュー退避・arm 並べ替えマッピング・3 人以上の reviewer 対応）はいずれも 2026-07-12〜07-13 の issue #63 で解消済み、一致率・Cohen's κ 統計は issue #66 で実装済みであるにもかかわらず未対応と書かれたままだったため是正した。あわせて「2 アカウントでの実機通し確認は未実施」も 2026-07-19 に完了済み（[docs/manual-testing.md](manual-testing.md) §5-6-2 に全項目 OK の記録あり）へ更新し、残る未実施は 3 アカウント目のペア選択確認のみであることを明記した / v0.18: Google API 失敗の診断ログ機能（issue #249。2026-08-09）を追加 — 「特定の文献だけ PDF が表示されない・判定しても記録が残らない」という問い合わせで原因（403/429 クォータ・503 過負荷・401 トークン・404 未許可・ネットワーク遮断のいずれか）を特定できなかった反省から、Google API 呼び出しの失敗を新設 `ApiErrorLog` タブ（15 → 16 タブ）へ記録する。記録経路は PDF 読み込み（`pdf_load`）・Evidence 追記（`evidence_append`）・判定保存（`decision_save`）・StudyData/ResultsData の annotator 行 upsert（`annotation_upsert`。判定保存と ai 転記の共通経路）の 4 経路。Sheets への書き込みが失敗している間は `chrome.storage.local` のリングバッファ（上限件数超過で古い順に破棄）へ退避し、次に同経路の呼び出しが成功したタイミングでフラッシュする（失敗時刻を保持。フラッシュ時刻で上書きしない）。`ApiErrorLog` タブ自体への書き込み失敗は再帰的に記録しない。トークン・認可ヘッダ・リクエストボディは記録しない（`message` 列は `GoogleApiError.responseBody` を含みうるが定数長で打ち切る）。既存プロジェクトはタブを持たないため `Reviewers` と同じく書き込み時に自動作成する。`GoogleApiError` に `retryCount`（`googleFetch` の再試行回数）を追加 / v0.19: `ExtractionRuns.warnings` に `evidence_row_count` 警告種別を追加（issue #247・2026-08-09）— `src/lib/google/sheets.ts` の `appendRows` が `values.append` のレスポンス（`updates.updatedRows` / `updates.updatedRange`）から実際に書けた行数を判別できるようになり、要求行数と不一致なら `SheetsPartialAppendError` を投げるようにした（判別できない場合は従来どおり検証しない残存ギャップを明記）。これに加えて `executeRun` が run 終了時に「生成した Evidence 行数 vs 実際に保存できた行数」を突き合わせ、不一致なら `evidence_row_count` 警告（`expectedRows` / `savedRows`）を記録する（status には影響しない監査記録の二重化）。UI 表示は未実装（S7/S8 の `armWarnings` 型は `arm_completeness` 専用のまま据え置き） / v0.20: enum 項目の値入力を許容値からの選択にする（issue #254・2026-08-11）— `data_type = enum` かつ `allowed_values` を持つ項目の `edit` / `reject` 入力欄を、自由入力から**許容値チップ列 + 「その他（自由入力）」**へ変更（§4.2）。確定値が許容値外のセルには情報提示のみの警告と `#/schema` 導線（owner のみ）を出し、**保存はブロックしない**。S12 裁定の「第 3 の値」入力・独立入力モードにも同じ選択 UI を適用する。許容値の追加・編集を判定画面から行わない理由（旧版 `schema_version` へ紐づく run / Evidence / Decisions には反映されない・二重独立抽出の途中で選択肢集合が変わると κ の比較可能性が崩れる）を §4.2 に明記 / v0.21: レビューモード変更のハードブロック（issue #255・2026-09-29）— 同一 email が `with_ai` ↔ `independent` を変えると、読み出し側と `StudyData` / `ResultsData` の更新キーが `annotator`（email）だけで絞るため、`with_ai` 時代に accept した AI 値が独立入力画面へ持ち越される盲検の穴があった。`Reviewers` への登録時に、その email を `annotator` とする判定・データ行・群構成の `annotator_type` と、登録しようとする行の実効 annotator_type が 1 件でも食い違えば追記を拒否する（案 C）。着手前（実データ 0 件）のモード変更は従来どおり警告ダイアログを経て許可する。着手後の誤登録の訂正手段が無くなること・既に混在したプロジェクトを救済しないこと（検出表示も持たない）は割り切りとして受け入れた（§3.2 `Reviewers`・[design-independent-dual-review.md](design-independent-dual-review.md) §2.1） / v0.22: 判定メモの入力と再パイロットの既定選択（issue #266・2026-09-29）— S8（パイロットの検証を含む）の修正・棄却時に任意の判定メモ（`Decisions.note`）を入力できるようにし、再パイロットでは過去のパイロットで使っていない study を優先して選択する。改訂案の作成は、実 API で非パイロット論文の正確度が下がったため issue #277 へ持ち越す。 / v0.23: 費用集計・予算警告・使用量 CSV（issue #267・2026-09-30）を追加し、バッチ失敗と中断・未割当の支出も集計する。予算 3 列だけを更新し、設定中は旧版拡張で開けないが解除でヘッダと値を消去して互換性を戻す。OpenRouter の応答費用を優先記録し、単価表も確認済みの値に更新する。旧 Gemini の過少計上判定は思考トークン修正と本機能が同じリリースに含まれる前提とする。 / v0.24: 論文への質問パネル（issue #264・2026-09-29）— S8 / S12 に、表示中の 1 study 配下の全文書の本文とスキーマ定義だけを文脈にした質問パネルを追加（新 skill `ask-paper`・`LLMApiLog.purpose = ask_paper`）。回答は構造化出力 `{answer, citations[{document_index, quote, page}], found}` で、引用は relocate-quote と同じ verbatim 規約。引用はすべて既存のアンカリングで照合し、fuzzy 以上だけをハイライト付きで出し、照合できない引用には警告を付ける。**Evidence・StudyData / ResultsData・他の人の Decisions は文脈に入れない**。reviewer_independent には出さない（盲検）。回答を値へ反映するボタンは置かない。`LLMApiLog` にはメタデータ（トークン数・費用・purpose）だけを残し、質問と回答の本文は Drive にも `prompt_summary` にも残さない。質問した study の以後の判定には `Decisions.note` の先頭に `[chat-assist]` を付け、audit.csv と Methods 文案（オプション文）で開示する（§3.2 `LLMApiLog` / `Decisions`・§4.2・§4.6・[methods-boilerplate.md](methods-boilerplate.md)。v0.22 は issue #266） / v0.25: 担当セット（issue #263・2026-09-30）— tiab-review と同じ「担当セット」を導入。`Studies` の末尾に `review_set` 列（`calibration` / `group-n` / 空 = 未割当）、追記型の新タブ `ReviewSets`（16 → 17 タブ。`set_id` / `reviewer_emails` / `seed` / `updated_by` / `updated_at` / `study_ids`。`set_id` ごとに最新行が有効・`updated_by` が `Meta.created_by` と違う行は無視して警告）を追加。owner がキャリブレーション本数とグループ数を指定して一括で分け（シャッフルの乱数種を記録）、各グループの担当者を編集する。owner 以外のロールには担当セットと calibration の study だけを表示し、Picker で許可を求めるファイルもその範囲に絞る（adjudicator は裁定のため全件）。担当ペアが決まった study は 3 人目の判定があっても担当ペアで裁定・κ の対象にし、担当外の判定は警告付きで除外する。calibration セットの一致度は全ペアで出す。study の統合・分離でセットを引き継ぐ。統合では文書の付け替え完了後に所属を保存し、個別割当・統合の所属保存直前には最新の owner 行を再取得する。所属の正を owner の `ReviewSets.study_ids` に置き、`Studies.review_set` と食い違うアクティブ study の件数を owner に警告する。**担当セットを使わないプロジェクト（`study_ids` にアクティブ study が無い、または `ReviewSets` が無い）は従来どおり**（全件表示・実データからの推定ペア）。§3.2 `Studies` / `ReviewSets`・§4.6・[design-independent-dual-review.md](design-independent-dual-review.md) §14。v0.22 = issue #266、v0.23 = issue #267、v0.24 = issue #264 / v0.26: 1 項目から複数箇所の quote を抽出する（issue #275・案 A。2026-09-30）— 質的研究のテーマ抽出（「課題」を 1 論文あたり最大 12 テーマほど、テーマごとに 1 箇所ずつ引用したい）という利用者の要望に対し、**1 セルに複数の quote を許す**。`SchemaFields` に `max_quotes` 列を追加し（空 = 従来どおり 1 quote。`text` 型の項目だけが 2〜20 を持てる。S5 で項目ごとに ON、既定 OFF）、ON の項目では AI が同じ `field_id` × `entity_key` の要素を最大 `max_quotes` 件返し、各要素に短いテーマ名（`theme`）を付ける。セルの値はテーマ名を `; ` で連結して組み立てる。`Evidence` に `quote_theme` / `quote_seq` 列を追加し、1 セル = 同じ run の複数行（`quote_seq` = 1, 2, …）で表す。S8 の判定はセル単位のまま（引用ごとの採否・人による引用の追加は持たない）で、引用は一覧表示 + クリックでハイライトへジャンプする。質的研究の引用形態（ブロック引用・本文埋め込み・単語レベル）や参加者の語りと著者の記述の区別はシステムプロンプトで扱わず、利用者が `extraction_instruction` に書く（書き方の例はヘルプ）。extract-data プロンプト版数を 10 へ。audit.csv に `quotes_json` 列を末尾追加 / v0.27: 全体照合に失敗した引用の断片照合（issue #294・2026-10-04）を追加 — 改行・省略記号でつないだ引用を全断片成功時だけ quote_seq 付き Evidence に保存し、S8 の引用一覧・S9 の集計・audit.csv で扱う。値とプロンプト版数は変更しない / v0.28: 工場出荷の既定モデルを gemini-3.8-flash に切り替え（issue #295・2026-10-04） / v0.29: AI 応答の entity_key の群を正の整数に限定し、outcome_result の規約にも番号づけを含めた（issue #293・2026-10-04）。extract-data プロンプト版数を 11 へ / v0.30: enum 項目の複数選択と、全引用の節の見出し（issue #307・2026-10-04）— `SchemaFields` に `multi_select` / `exclusive_values` / `free_text_values`、`Evidence` に `section` を追加。複数選択の項目は選択肢ごとに 1 要素を返させ、値は選択肢を許容値の並び順に `|` でつないだ 1 文字列で保存する。S8 / S12 は付け外し式のチップで入力し、`study_wide.csv` に選択肢ごとの 1/0 列を足す。extract-data プロンプト版数を 12 へ / v0.31: 引用の一覧を人が直せるようにした（issue #307・2026-10-05）— 追記型の `QuoteSets` タブ（17 → 18 タブ）に、セル × annotator 単位の引用一覧のスナップショットを保存する。S8 で引用の削除・選択肢／テーマの付け替え・「AI の引用に戻す」ができ、書き出しに `evidence_quotes.csv`（1 行 = 1 引用）を追加。§4.2 の「人が引用を直す機能は持たない」を改めた（PDF から文を選んで足す操作と、裁定での最終の根拠の選択は後続） / v0.32: PDF で文を選んで根拠に追加（issue #307・2026-10-05）— PDF ビューアに pdf.js のテキスト層を重ねて文字を選べるようにし、選んだ文をフォーカス中のセルの引用として `QuoteSets` に保存する。独立入力モードでは、本人が足した引用だけを表示する / v0.33: 裁定で最終の根拠を選ぶ（issue #307・2026-10-05）— S12 のセルごとに両レビュアーの有効な引用を並べ、裁定者が採用する引用にチェックを入れる（PDF から足すこともできる）。結果は `QuoteSets` に `consensus` のスナップショットとして保存し、`evidence_quotes.csv` の `is_final` に反映する / v0.34: 共同研究者との相談用ドキュメント（issue #315・2026-10-05）— S5 確定済み画面から、選んだスキーマ版の項目・パイロットでの AI の抽出例・項目別の判定内訳・RoB 等の事前設定をまとめた Google ドキュメントをプロジェクトの Drive フォルダに作成する。Drive の HTML→ドキュメント変換を使うため OAuth スコープは `drive.file` のまま。毎回新しいファイルを作り、共有設定には触れない。判定メモ・アンカリング結果・独立二重レビューの行は載せない（§4.1 S5） / v0.35: スキーマを前の版の内容に戻す（issue #318・2026-10-05）— S5 確定済み画面に「前の版の内容に戻す」カードを追加。最新版以外の過去の版を選ぶと、その版の項目と最新版の差分を field_id で突き合わせて差分承認画面（#197 の部品を流用）に出し、承認後にエディタへ流し込んで「版として確定」で新しい版（最新 + 1）を追記する。版の番号は巻き戻さず、過去の版も消さない。note（RoB 等の事前設定）の違いも変更として示し（項目名は戻さず、共通する項目は最新版の `field_name` のまま。StudyData は項目名の列に値を持ち書き出しも項目名で値を引くため、旧名へ戻すと旧名の列の古い値が出てしまう）、既定は追加・変更・削除をすべて採用（AI 再ドラフトと違い削除候補も既定で削除）。反映後の並び順は戻し元の版に合わせ、採用しなかった変更は最新版の値のまま、残した削除候補は末尾に置く。確定した版の `parent_version` は戻し元の版、`created_by_type` は `user_edit`（新しい値を足すと旧版の拡張でシートを読めなくなるため足さない）、`note` の初期値は「v{n} の内容に戻す」。後の版で足した項目を消したときのデータの扱いは、エディタで項目を削除して確定したときと同じ（シートの行は残り、書き出しには出ない。S8 は直近の抽出 run の版の項目を表示するため、新しい版で抽出し直すまでは表示が残る） / v0.36: スキーマのファイル（JSON）の書き出しと読み込み（issue #316・2026-10-05）— S5 確定済み画面のカードで、選んだ版を JSON 1 ファイル（形式名 `sr-data-extraction-schema`・形式の版数 1）としてダウンロードし、別のプロジェクトで読み込めるようにした。ファイルには項目の設定（`SchemaFields` の列のうち section〜note・`max_quotes`・複数選択の設定。`field_id`・`schema_version`・`ai_generated` は含めない）と、出所の記録（プロジェクト名・版・書き出し日時・書き出した人・抽出プロンプトの版数・拡張の版）を入れる。論文のデータ・判定・パイロットの AI 出力例・プロトコル本文は含めない。読み込みは手元のファイル選択（1 MB まで）で、版が無いプロジェクトではエディタへ直接、版があるプロジェクトでは差分承認画面（#197 / #318 の部品）を経てエディタへ入れる。既存の項目とは field_name で突き合わせ、一致すれば既存の field_id を引き継ぎ、新しい項目には確定時に新しい field_id を振る。RoB テンプレート由来の項目も通常の項目として比べ、note（事前設定）の違いも示す。既定は追加・変更を採用し削除候補は残す。確定時は `created_by_type = user_edit`・`parent_version` = 最新版（版が無ければ null）で、改訂理由の初期値に出所を入れる。形式違い・新しすぎる形式・項目の検証エラーのファイルは全体を拒否して理由を出す（一部だけ読み込むことはしない）。Drive には保存せず、スコープも増えない
- **ステータス**: **2026-07-12 に Chrome ウェブストアで v0.1.0 を一般公開**（[掲載ページ](https://chromewebstore.google.com/detail/sr-data-extraction-plugin/ibpbkgffgkmdmflamhadbcfjgfljjgip)）。S1〜S10 実装済み・実機通し確認完了（2026-07-03）。残タスクは [docs/remaining-work-plan.md](remaining-work-plan.md) を参照。§10 の Q1〜Q10 はレビュー済み（Q8 の閾値のみベンチマーク設計時に最終確定）。**v0.10（study / document モデル）は全 3 フェーズ実装済み・実機通し確認済み（2026-07-09）**。実装済み機能と残タスクの全体像は [docs/status-and-roadmap-20260711.md](status-and-roadmap-20260711.md) を参照
- **関連ドキュメント**:
  - [docs/ui-flow.md](ui-flow.md) — 画面遷移図モック
  - [docs/architecture.md](architecture.md) — ディレクトリ構造案 / アーキテクチャ概要
  - [docs/ui-states.md](ui-states.md) — UI 状態マトリクス（target spec）
- **参照リポジトリ**:
  - [tiab-review-plugin](https://github.com/youkiti/tiab-review-plugin)（技術スタック・UI トンマナ・オフライン同期・LLM ベンチマーク運用の参照元）
  - [sr-query-builder-plugin](https://github.com/youkiti/sr-query-builder-plugin)（要件定義書フォーマット・メインビュー構成・Sheets/Drive データ設計の参照元）

---

## 1. プロジェクト概要

### 1.1 プロダクト名

**sr-data-extraction-plugin**（仮称。MIT ライセンス・OSS の Chrome 拡張）

> 命名は Q1（§10）で確定。SR ツール群 3 部作（sr-query-builder → tiab-review → 本拡張）の位置づけ。

### 1.2 目的

システマティックレビュー（SR）／スコーピングレビューの**データ抽出工程**を、以下の一気通貫フローで支援する。

1. Google Drive に保管された**採用論文フルテキスト**と**研究プロトコル**から、AI がデータ抽出スキーマ（コーディングシート）のドラフトを設計
2. AI が各論文からスキーマに沿ってデータを抽出し、**根拠となる本文箇所（verbatim quote）**を各値に付与
3. PDF ビューア上で AI の根拠箇所を**ハイライト表示**
4. 研究者がハイライトを目視確認しながら**人間による最終抽出（accept / edit / reject）**を実施
5. 確定データを **CSV としてエクスポート**（メタ解析・記述的統合の下流工程へ渡す）

初学者研究者が、方法論的に妥当な形（AI 事前抽出 + 人間検証、全判断の監査証跡）でデータ抽出を完遂できることを狙う。ブラウザ単体で完結し、外部サーバーを持たない（tiab-review-plugin と同じサーバーレス構成）。

### 1.3 ユーザーストーリー（ハイレベル）

```
研究者: プロジェクト作成（新規 or tiab-review プロジェクトからの引き継ぎ ※Q2）
  → Google Drive Picker で採用論文の PDF を選択して取り込み（PDF 個別選択に加え、フォルダ選択で直下 PDF を一括取り込み。tiab-review の fulltext フォルダ流用向け）
  → 拡張が PDF からテキスト層を抽出し、Drive に監査用テキストを保存
  → 同一試験の複数文書（本論文・試験登録・プロトコル論文・学会抄録）を 1 study に統合
    （試験登録番号の自動検出候補を確認 or 手動選択で統合。各文書にロールを付与 ※v0.10）
  → プロトコルを入力（手入力 or md / docx アップロード。sr-query-builder と同一 UI 慣行）
  → AI（draft-schema skill）がプロトコル＋サンプル論文 1〜3 本を読み、
    抽出スキーマのドラフトを提示（項目名・型・単位・許容値・抽出指示）
  → 研究者がスキーマを承認 or 編集（項目の追加 / 削除 / 型変更 / 抽出指示の修正）
  → パイロット抽出: 少数論文（2〜3 本）で AI 抽出 → 人間検証 → スキーマ改訂
    （tiab-review の「キャリブレーション」に相当）
  → 本抽出: AI（extract-data skill）が全論文を一括抽出。各値に verbatim quote と
    ページヒントを付与。オフラインキュー・再送は tiab-review 準拠
  → 検証画面: 左ペインに PDF ビューア（根拠箇所ハイライト）、右ペインに抽出フォーム。
    項目クリック → 該当ハイライトへジャンプ / ハイライトクリック → 項目フォーカス。
    研究者が accept / edit / reject / not reported を判定
  → 全項目確定後、CSV エクスポート（wide / long / 監査用の 3 形式）
```

### 1.4 スコープ境界

| カテゴリ | 本拡張の責務 | 責務外（他ツールに委譲） |
| --- | --- | --- |
| 検索式作成・検証 | — | sr-query-builder-plugin |
| TiAb / 全文スクリーニング | — | tiab-review-plugin |
| 全文 PDF の**取得** | — | ユーザーが手動で Drive に配置 |
| 抽出スキーマ設計 | AI ドラフト + 対話的編集 | — |
| データ抽出 | AI 事前抽出 + 人間検証 UI | — |
| 根拠箇所ハイライト | quote アンカリング + PDF 上表示 | — |
| RoB / 質評価 | スキーマの一種として扱う（RoB 2 / ROBINS-I テンプレートを S5 でプリセット挿入 → S8 の RoB タブで検証） | 専用 UI（トラフィックライト図等の可視化は他ツールに委譲） |
| メタ解析・統合 | CSV 出力まで | R / RevMan / STATA 等 |
| OCR（スキャン PDF） | 画像のみ PDF も `pdf_native` モードで AI 抽出対象（アンカリングは不可。bbox 対応モデルの run は AI 推定の座標ハイライトを表示 ※Q7） | テキスト層の再建（OCR 処理そのもの） |

### 1.5 想定ユーザーと前提

- SRWS-PSG のメンティーを含む初学者〜中級者の SR 実施者
- 対象文献は**テキスト層を持つ born-digital PDF** が原則（OA 論文が中心想定）。くわえて**画像のみの PDF（スキャン PDF）にも対応**する: PDF のまま対応 AI に投げる `pdf_native` モードで抽出（アンカリングは不可だが、bbox 対応モデルの run は AI 推定の座標ハイライトを表示 ※Q7）
- 1 プロジェクトの規模想定: 採用 study 5〜100 件（1 study あたり文書 1〜5 本）、スキーマ項目 10〜200、エンティティ展開後の抽出セル数 最大 ~20,000（annotator 1 名あたり。セルは study 単位）
- 学術研究目的のデータ抽出（テキスト・データマイニング）は**著作権法上の権利制限規定（30 条の 4 等）の範囲内であり適法**との整理。拡張内に著作権確認の UI・記録列・注意書きは設けない。取り込み画面には PDF の外部送信先が LLM API のみである旨の説明を常時表示する

---

## 2. 技術スタック

tiab-review-plugin / sr-query-builder-plugin の構成に準拠。

| 項目 | 採用技術 |
| --- | --- |
| プラットフォーム | Chrome Extension Manifest V3 |
| UI | **メインビュー**（`chrome.tabs.create` で開く拡張オリジンのフルページ `app.html`。sr-query-builder と同方式）+ Popup（プロジェクト選択）+ Options |
| 言語 | TypeScript / HTML / CSS |
| ビルド | webpack |
| 認証 | Google OAuth 2.0（`chrome.identity.launchWebAuthFlow` + Web アプリケーション型クライアント。認証は service worker の認証ブローカーに集約し、各ページはメッセージで取得【issue #129。2026-07-18】） |
| ストレージ | Google Sheets（主 DB）/ Google Drive（PDF 原本・抽出テキスト・LLM ログ実体）/ `chrome.storage`（API キー、ローカルキャッシュ、オフラインキュー） |
| PDF 描画 | `pdfjs-dist`（PDF.js）: canvas 描画 + テキスト層 + ハイライトオーバーレイ |
| docx パース | `mammoth.js`（プロトコル入力用） |
| LLM（MVP） | Gemini API（工場出荷の既定モデル = `gemini-3.8-flash`。実データ抽出ベンチマークで確定 ※Q8。tiab-review の固定バージョン ID 方針を踏襲） |
| LLM（MVP 追加） | OpenRouter（OpenAI 互換 API。`OpenRouterProvider` を sr-query-builder から移植・2026-07-04）+ 利用者指定の OpenAI 互換 Chat Completions API（Issue #27。HTTPS を原則とし、HTTP は `localhost` / `127.0.0.1` / `[::1]` のみ許可。非標準ポート、loopback の認証なし接続、構造化出力の互換性フォールバックに対応）。モデルセレクタの「その他（直接入力）」で任意モデル ID を指定可。カスタムモデルの一覧管理 UI は P1 |
| LLM（接続方式・issue #127） | 上記に加え **Anthropic ネイティブ**（Messages API。`AnthropicProvider`。固定エンドポイント `https://api.anthropic.com/v1/messages` + `x-api-key` / `anthropic-version` 認証。PR1 で provider 層のみ実装・PR2 で Options 配線）+ **Azure OpenAI**（PR3 で実装済み。新規 provider クラスは作らず `OpenAICompatibleProvider` を `api-key` 認証で流用。利用者が入力するクエリ文字列付き完全 URL + デプロイメント名をモデル欄に入力）。§10 Q11 のとおり、これらに限って「独自認証は投機実装しない」の不採用宣言を明示的に覆す（実需 — 公開ユーザーが持っているキーの 2 大勢力のため。プロバイダごとに**固定の**認証方式を実装し、利用者が自由にヘッダーを追加できる汎用の任意ヘッダー入力 UI は引き続き不採用） |
| Node.js | ≥ 18 |

### 2.1 OAuth スコープ

```
https://www.googleapis.com/auth/userinfo.email  # サインイン中アカウントのメール（annotator / created_by の記録に使用）
https://www.googleapis.com/auth/drive.file      # Drive Picker で選択したファイル + 拡張が作成したファイルのみ（Sheets API もこのスコープで呼ぶ）
```

- `drive.file` スコープにより、**ユーザーが Picker で明示的に選択した PDF（またはフォルダ）** と拡張が作成したファイルにのみアクセス可能。フォルダを選択した場合はその直下 PDF の列挙・取り込みまでを許可（配下ファイルへは選択フォルダ経由でアクセス可）。Drive 全体を読むスコープは要求しない（プライバシー姿勢を README に明記）。
- **`spreadsheets` スコープは要求しない**【issue #128〜#132。2026-07-18】。センシティブスコープのため OAuth 未検証アプリは同意 100 人で打ち止めになる（tiab-review が実際に到達）。Sheets API は `drive.file` で「拡張が作成したシート + Picker で許可されたシート」に対して呼べるため機能損失はなく、他人が作成した共有シートを開くときだけ初回 1 回の Picker 許可が必要（issue #130 のフォールバック導線）。
- メールアドレスは認可アカウントの userinfo（`https://www.googleapis.com/oauth2/v3/userinfo`）から取得し、`storage.local` に保持して `login_hint` にも使う。旧 `getProfileUserInfo()`（Chrome プロファイル固定）は「初回認可の login_hint シード」と「プロファイルと別アカウントでログイン中」表示の比較にのみ残す。
- **implicit flow（`response_type=token`）採用の記録**: Google は新規のブラウザ実装にコードフローを推奨するが、拡張は client secret を保持できず、参照実装 tiab-review で運用実績がある。トークンは URL フラグメントからのみ取得し、ログ・永続ストレージへは出さない（`storage.session` のみ。作業原則 5）。認可応答の `scope` を検証し、部分同意（2 スコープ不揃い）はサインイン失敗として扱う。Google が implicit を廃止する場合は GIS / PKCE へ移行する。

### 2.2 Manifest V3 要件

- `permissions`: `identity`（launchWebAuthFlow 用）, `identity.email`（初回 login_hint シード + 別アカウント表示の比較用。§2.1）, `storage`, `tabs`
- `host_permissions`:
  - `https://sheets.googleapis.com/*`
  - `https://www.googleapis.com/*`
  - `https://oauth2.googleapis.com/*`（ログアウト時のトークン revoke）
  - `https://generativelanguage.googleapis.com/*`（Gemini）
  - `https://openrouter.ai/*`（OpenRouter）
  - `https://api.anthropic.com/*`（Anthropic ネイティブ。issue #127。エンドポイントが固定 URL のため恒久的な `host_permissions` として登録する）
- **Azure OpenAI**（issue #127・PR3）はテナントごとにエンドポイント URL が異なるため `host_permissions` へ固定登録できない。§2.2 の `optional_host_permissions`（`https://*/*` 等）と同じ `chrome.permissions.request` 経路で足りる（OpenAI 互換 API の完全 URL 入力と同じ扱い。新規のホスト定義は不要）
- `oauth2` ブロック（manifest）は持たない。クライアント ID（Web アプリケーション型、リダイレクト URI = `https://<拡張ID>.chromiumapp.org/`）はビルド時に DefinePlugin の `__WEBAUTH_CLIENT_ID__` として注入する（.env の `WEBAUTH_CLIENT_ID` / dev は `LOCAL_WEBAUTH_CLIENT_ID`。hosted/picker.html の `PICKER_APP_ID` と同一 GCP プロジェクトで発行すること）
- `optional_host_permissions`: `https://*/*`、`http://localhost/*`、`http://127.0.0.1/*`、`http://[::1]/*`。OpenAI 互換 API の設定保存時に、入力 URL の scheme + hostname pattern だけを `chrome.permissions.request` で利用者へ提示・要求する。権限 pattern はポートを含めず、実際の API リクエスト URLでは入力されたポートとパスを維持する
- `action.default_popup`: `popup.html`
- PDF.js の worker は拡張パッケージに同梱（CDN 参照不可、CSP 準拠）
- **Drive Picker は MV3 の remote hosted code 制約により拡張ページ内で動かせない**ため、
  ホスト済み HTTPS ページ（`hosted/picker.html`。GitHub Pages へデプロイ）を新規タブで開き、
  `externally_connectable`（デプロイ先オリジンのみ許可）で選択結果を受け取る
  【決定 2026-07-02。OAuth トークンは URL に載せず、ページからの ready メッセージへの応答で渡す】

---

## 3. データ設計

### 3.1 全体方針

- 1 プロジェクト = 1 スプレッドシート = 1 Drive フォルダ（`Meta` タブにフォルダ ID を保持。sr-query-builder と同一）
- **追記型・上書き禁止**: `Protocol` / `SchemaVersions` / `SchemaFields` / `ExtractionRuns` / `ArmStructures` / `Evidence` / `Decisions` は追記のみ。`StudyData` / `ResultsData` の各 annotator 行のみ「現在値」として上書き更新を許可し、変更履歴は `Decisions` への追記で監査する。`Studies` / `Documents` は行の追加 + メタデータ（study_label / registration_id / document_role / study_id の付け替え / note）の行内編集を許可する（グルーピング変更時の study 作り直しは §3.2）
- セル 50,000 文字上限を超える可能性があるデータ（抽出テキスト、LLM プロンプト / レスポンス）は Drive 実体 + シートに URL 参照（既存 2 拡張と同方針）
- Drive フォルダ構成:

```
{project_folder}/
├── documents/            # 取り込んだ PDF のコピー（原本は動かさない ※Q9）
├── extracted_texts/      # {document_id}.txt（PDF.js で抽出したテキスト層、監査・アンカリング用）
├── raw_protocols/        # プロトコル元テキスト（sr-query-builder 準拠）
└── logs/llm/             # LLM プロンプト / レスポンス JSON
```

### 3.2 Google Sheets スキーマ（タブ一覧）

`Meta` の基本 7 列 / `Protocol` は sr-query-builder のスキーマを流用（`ProtocolBlocks` は不要）。

`Meta` の末尾には予算設定時だけ `budget_usd` / `budget_updated_by` /
`budget_updated_at` を追加する（初期ヘッダは基本 7 列のまま）。予算は正の有限数、空欄は解除。
**上書きの例外はこの予算 3 列だけ**とし、ヘッダもデータも予算範囲だけを書き込む
（基本 7 列のとき `Meta!H1:J1` / `Meta!H2:J2`）。先に読んだ基本列を再保存しないため、
他ユーザーによる基本列の同時編集を巻き戻さない。最新の更新者・日時を列に記録し、
それ以前の値は Google Sheets の版履歴でのみ復元する。設定すると旧版の拡張ではプロジェクトを
開けないが、解除すると予算ヘッダと値（基本 7 列のとき `Meta!H1:J2`）を空にし、再び開ける。
予算ヘッダがない状態の解除は書き込まない。再設定時はヘッダを追加する。解除時の監査情報も
Google Sheets の版履歴に残る。新拡張は先頭 7 列だけを検証し、予算などの後続列を許容する。
予算の読み取りは列名で行い、基本 7 列だけの Meta は予算なしとして扱う。

#### study と document の分離（v0.10）

SR では 1 つの試験（trial）が複数の報告文書を持ちうる（本論文・試験登録・プロトコル論文・学会抄録・二次出版。Cochrane Handbook の *study vs report* の区別）。本拡張は **study を抽出・検証・エクスポートの単位**、**document を quote アンカリング・ハイライトの単位**とする。

- **study**: `Studies` タブの 1 行 = 1 試験。`StudyData` / `ResultsData` / `ArmStructures` / `Decisions` のキーは study_id
- **document**: `Documents` タブの 1 行 = 1 PDF。`Evidence` は「**どの文書の**どこに根拠があるか」を表すため document_id を保持する（study_id も併記）
- 取り込み時は常に **1 PDF = 1 study を自動生成**し、S3 のグルーピング UI（§4.5）で後から統合する
- グルーピング変更（統合・分離・所属変更）は、文書集合が変化した study を**新 study_id で作り直す**（`Studies` へ新行を追記し `Documents.study_id` を付け替える）。旧 study のデータ行（StudyData / ResultsData / Evidence / Decisions / ArmStructures）は監査用にそのまま残るが、新 study はどの `ExtractionRuns` 完了行にも現れないため自動的に「未抽出」へ戻る（§4.5）
- **アクティブな study** = `Documents` から 1 件以上参照されている study。参照が 0 になった行は非アクティブ（履歴として残置し、一覧・集計・エクスポートには出さない）

#### `Studies`（v0.10 新設）

1 行 = 1 試験（trial）。グルーピング変更のたびに新しい study_id の行を追記し、旧行は残置する（上記）。`study_label` / `registration_id` / `note` は行内編集可。

| 列 | 型 | 必須 | 説明 |
| --- | --- | --- | --- |
| study_id | string(uuid) | ✓ | |
| study_label | string | ✓ | 表示・CSV 用の研究ラベル（例: `Smith 2020`）。AI が書誌から提案、ユーザー編集可（v0.10 で `Documents` から移設） |
| registration_id | string | | 試験登録番号（例: `NCT01234567`）。取り込み時の自動検出（§4.5）を初期値にユーザー編集可 |
| created_at / created_by | iso8601 / email | ✓ | |
| note | string | | |
| review_set | string | | 担当セット（v0.25・issue #263）。`calibration` / `group-1` / `group-2` … / 空 = 未割当。末尾追加の列で、列が無い旧プロジェクトは全件空として読む。所属判定の正は `ReviewSets.study_ids` とする。owner が一括分割・個別選択で上書き更新する（`Studies` は追記型の対象外）。統合・分離で新しい study_id を発行するときは元の study の値を引き継ぐ |

#### `Documents`

1 行 = 1 文書（PDF）。試験への所属は `study_id` で表す。

| 列 | 型 | 必須 | 説明 |
| --- | --- | --- | --- |
| document_id | string(uuid) | ✓ | |
| study_id | string(uuid) | ✓ | 所属する試験（`Studies`）。取り込み時は自動生成した 1 文書 study を指し、統合で付け替わる（§4.5） |
| document_role | enum | ✓ | `article`（本論文）/ `registration`（試験登録）/ `protocol`（プロトコル論文・SAP）/ `abstract`（学会抄録）/ `supplement`（付録・補遺）/ `other`。取り込み時の既定は `article`、S3 で編集可 |
| drive_file_id | string | ✓ | `documents/` 配下に作成した**プロジェクト内コピー**の Drive ファイル ID（凍結スナップショット ※Q9）。ビューア表示・AI 抽出・監査はすべてこの ID を参照する |
| source_file_id | string | ✓ | Picker で選択した**元 PDF** の Drive ファイル ID（出所の記録用。取り込み後に原本が移動・削除されても拡張の動作には影響しない） |
| filename | string | ✓ | |
| pmid / doi | string | | 任意。tiab-review 引き継ぎ時は自動転記（※Q2） |
| text_ref | string(url) | ✓* | `extracted_texts/{document_id}.txt` の Drive URL。**`text_status = no_text_layer` の場合のみ空**（テキスト層がなく抽出テキストが存在しないため。空ファイルは作らない） |
| text_status | enum | ✓ | `ok` / `partial`（一部ページ抽出不可）/ `no_text_layer`（スキャン PDF。`pdf_native` モードでのみ抽出可、アンカリングは不可。bbox 対応モデルの run は AI 推定の座標ハイライトを表示 ※Q7）。判定は各ページ実質 30 字以上で「テキストあり」とするが、**全ページの過半数に繰り返す定型行（複写スタンプ・走りヘッダ / フッタ）は本文から除外してから数える**（例: 全ページ上下に "Reproduced with permission of the copyright owner..." が本物のテキストとして載るスキャン論文 PDF を、正しく `no_text_layer` と判定するため） |
| page_count / char_count | int | | |
| imported_at / imported_by | iso8601 / email | ✓ | |
| note | string | | |
| excluded | boolean | | 抽出候補からの除外フラグ（S3・文献除外機能。issue #181）。`true` の文書は S6 パイロット / S7 一括抽出の対象一覧から外れる（全文書が除外された study は候補に出ない。一部除外の study は残り文書で対象になる。検証 S8/S9・裁定 S12・エクスポート S10・S3 一覧の表示には除外済みも出す）。既定 `false`。`document_role` / `study_id` と同じ「その場で上書き」方式（追記型の `Decisions` とは別系統）。既存プロジェクトはこの列を持たないため末尾に追加し後方互換を取る（§3.1・`ensureDocumentExclusionColumns`） |
| exclusion_reason | enum | | 直近の除外理由。`ineligible`（対象外と判明・不適格）/ `duplicate`（重複）/ `mis_imported`（誤って取り込んだ）/ `on_hold`（保留）/ `other`（その他・自由記述で補足）。**study 単位の除外は選択必須、document 単位は任意**（§4.5）。除外解除後も直近値を残す |
| exclusion_note | string | | 除外時の自由記述（任意）。除外解除後も残す |
| excluded_at | iso8601 | | 直近の除外操作日時。除外解除後も残す |

#### `SchemaVersions`

スキーマの版管理。1 行 = 1 版。追記型。

| 列 | 型 | 必須 | 説明 |
| --- | --- | --- | --- |
| schema_version | int | ✓ | 1 から |
| parent_version | int | | 派生元。通常の改訂は確定時点の最新版、「前の版の内容に戻す」（v0.35・issue #318）は戻し元の版 |
| protocol_version | int | ✓ | 依拠した `Protocol.version` |
| created_by_type | enum | ✓ | `ai_draft` / `user_edit` / `pilot_revision`（パイロット改訂版の読み取りを維持。作成経路は issue #277 へ持ち越し） |
| created_at / created_by | iso8601 / email | ✓ | |
| note | string | | 改訂理由（例: パイロットで単位の揺れが判明） |

#### `SchemaFields`

1 行 = 1 抽出項目 ×（schema_version）。

| 列 | 型 | 必須 | 説明 |
| --- | --- | --- | --- |
| schema_version | int | ✓ | |
| field_id | string(uuid) | ✓ | 版をまたいで同一項目は同じ ID を維持（改名追跡用） |
| field_index | int | ✓ | 表示順 |
| section | string | ✓ | グルーピング（`identification` / `methods` / `population` / `intervention` / `outcomes` / 自由文字列） |
| field_name | string | ✓ | CSV 列名になる snake_case 識別子（例: `sample_size_total`） |
| field_label | string | ✓ | 表示名（例: `総サンプルサイズ`） |
| entity_level | enum | ✓ | `study` / `arm` / `outcome_result` / `rob_domain`（§3.3） |
| data_type | enum | ✓ | `text` / `integer` / `float` / `boolean` / `enum` / `date` |
| unit | string | | 期待単位（例: `mg/day`）。AI に単位変換をさせず「報告どおり + 単位別記」方針 |
| allowed_values | string | | `enum` 時の許容値（`\|` 区切り） |
| required | bool | ✓ | 未報告時に `not_reported` を明示させるか |
| extraction_instruction | string | ✓ | LLM への項目別抽出指示（自然言語）。スキーマ編集 UI から直接編集可能 |
| example | string | | few-shot 用の例 |
| ai_generated | bool | ✓ | 監査用（sr-query-builder `ProtocolBlocks.ai_generated` と同旨） |
| note | string | | |
| max_quotes | int | | 2026-09 追加（issue #275）。**複数の引用を許す上限件数**。空 = OFF（従来どおり 1 セル 1 quote）。`data_type = text` の項目だけが 2〜20 の整数を持てる（それ以外の型・範囲外は S5 の検証エラー）。ON の項目の抽出規約は §4.3「複数の引用」。既存プロジェクトはこの列を持たないため、この列に値を持つ版を確定するときにヘッダ末尾へ追加する（`Evidence` の bbox 列と同じ方式）。列が無い・空のシートは全項目 OFF として読む。AI ドラフト（draft-schema skill）はこの列を提案しない。再ドラフトの差分承認では field_name が一致した現行項目の値を引き継ぐ |
| multi_select | bool | | 2026-10 追加（issue #307）。**複数選択**（当てはまる選択肢をすべて選ぶ）。`data_type = enum` かつ `allowed_values` を持つ項目だけが TRUE にできる。空 = 従来どおり単一選択。`data_type` を増やさず列で表すのは、未知の `data_type` を `text` として読む旧版のビルドで項目の型が変わるのを避けるため。この列と次の 2 列は、複数選択の項目を含む版を確定するときにヘッダ末尾へ追加する（`max_quotes` と同じ方式。`max_quotes` だけを使う版では 16 列止まり）。列が無い・空のシートは全項目 OFF として読む。AI ドラフトは提案しない。再ドラフトの差分承認では、field_name が一致し提案が enum のとき現行項目の設定を引き継ぐ（次の 2 列は提案側の許容値に残っている選択肢だけ）。**旧版の拡張で版を確定し直すと、この 3 列の設定は引き継がれない**（`max_quotes` と同じ既知の制約） |
| exclusive_values | string | | 2026-10 追加（issue #307）。**ほかの選択肢と同時に選べない選択肢**（`\|` 区切り。例: `NA\|unclear`）。`allowed_values` の部分集合で、`multi_select` が TRUE のときだけ指定できる |
| free_text_values | string | | 2026-10 追加（issue #307）。**自由記述を付けられる選択肢**（`\|` 区切り。例: `Other`）。`allowed_values` の部分集合で、`multi_select` が TRUE のときだけ指定できる。`exclusive_values` と同じ選択肢は指定できない |

> **複数選択の値の保存形式（issue #307）**: 1 セル 1 文字列のまま、選んだ選択肢を **`allowed_values` の並び順**に `|` でつなぐ（例: `Students|Records themselves`）。自由記述付きは `選択肢: 説明`（例: `Other: Standardized patients`。説明の中の `|` は `/` に、改行は空白に置き換える）。許容値に無い要素は既知の要素の後ろに文字列の昇順で残す（保存は許容値でブロックしない。§4.2）。並び順を固定するので、同じ集合は必ず同じ文字列になり、S12 の一致判定と κ は従来の文字列一致のまま働く（選択肢の集合全体が 1 カテゴリ。部分一致は数えない）。読み書きは `src/domain/multiSelect.ts` に集約する。検証（S5）: `NR` は「未報告」操作で付けるため複数選択の項目の許容値に入れられない／許容値は「自由記述付きの選択肢 + `: `」で始められない（保存形式を一意に読み戻すため）

> **AI 再ドラフト時の field_id 継承（issue #197・2026-07-24）**: プロトコル改訂後に draft-schema skill を再実行して現行版と突き合わせる際（§4.3 参照）、**field_name の一致で既存 field_id を継承する**規約とする。突き合わせは trim 済みの field_name で行い、AI 提案（`field_id` を持たない）と現行項目が同名なら承認時にその項目の `field_id` を引き継ぎ、版をまたいだ改名追跡（`field_id` 一致 = 同一項目）を再ドラフト後も保つ。新規提案（現行に同名が無い）は通常の新規行と同じく確定時に UUID を採番する

#### `ExtractionRuns`

AI 一括抽出の実行単位。tiab-review の `LLM_Runs` に相当。

**2 行プロトコル（v0.8）**: run 1 件につき、(1) 実行開始時に `status='running'` の行を **Evidence の追記より先に**追記し、(2) 実行完了時に確定 status（`done` / `partial_failure`）の行を同じ `run_id` でもう 1 行追記する（追記型の原則は維持）。これにより「`Evidence` の `run_id` は必ず `ExtractionRuns` で解決できる」不変条件が立ち、タブを閉じる・クラッシュ等で実行が中断しても running 行が残るため中断を検出できる。読み手の規約: run の完了 / 中断は「完了 status の行があるか」で判別し、抽出済み study の集計（S7 の既定選択・進捗カウントの pilot 実行数）には完了行のみを数える。中断 run の study は「未抽出」に戻るため、S7 の既定選択（未抽出の全件）がそのまま再開手段になる。

| 列 | 型 | 必須 | 説明 |
| --- | --- | --- | --- |
| run_id | string(uuid) | ✓ | |
| run_type | enum | ✓ | `pilot` / `full` / `single_study`（再抽出） |
| schema_version | int | ✓ | |
| study_ids | string | ✓ | カンマ区切り（v0.10 で document_ids から改名。抽出単位 = study） |
| provider / requested_model | enum / string | ✓ | tiab-review 準拠（`model_version` も応答から記録） |
| input_mode | enum | ✓ | `pdf_native`（PDF を直接 LLM へ）/ `text_only`（※Q3） |
| status | enum | ✓ | `queued` / `running` / `done` / `partial_failure` |
| started_at / finished_at | iso8601 | | |
| tokens_in / tokens_out / cost_estimate | int / int / float | | 実行前にコスト概算を UI 表示 |
| field_ids | string | | 2026-07 追加（issue #80: run 単位のフィールド選択）。対象 `field_id` をカンマ区切りで記録する。**空 = 全項目**（後方互換規約。既存プロジェクトはこの列を持たないため、書き込み前にヘッダを拡張する）。検証・ダッシュボード・エクスポートの表示は、セル（field_id 単位）ごとに「その field を対象に含む最新の完了 run」の `Evidence` を採用する合成ビューへ切り替わる（サブセット run が最新でも、対象外の field は過去 run の値が見え続ける） |
| warnings | string(json) | | 2026-07 追加（issue #106: arm completeness チェック）。完了行にのみ書く run 単位の警告（`RunWarning[]` の JSON。`kind='arm_completeness'` / `kind='evidence_row_count'`〔issue #247・2026-08〕の 2 種）。`arm_completeness` は応答に `arm:n` が現れる（または `ArmStructures` 確定済み）のに当該 arm の arm レベル項目が揃っていないバッチを機械検出した記録。**warning のみで status は `partial_failure` に倒さない**（正当な not_reported 等の過検出リスクとのバランス）。逆に **`ArmStructures` 未確定で応答に当該 arm が一切現れない場合は検出不能**（応答内の自己整合を基準にする設計上の限界）。`evidence_row_count`（issue #247）は `values.append` が HTTP 2xx を返しつつ実際には要求より少ない行しか書けていなかった「部分書き込み」（`SheetsPartialAppendError`。`src/lib/google/sheets.ts` の `appendRows` がレスポンスの `updates.updatedRows` / `updates.updatedRange` から判別）を、run 終了時に「生成した Evidence 行数 vs 実際に保存できた行数」の突き合わせで二重に検知した記録（`expectedRows` / `savedRows`）。通常は不一致が起きた時点で既に `save_failed` の `BatchFailure` により `partial_failure` になっているため、この警告自体は status を左右しない監査記録。空 = 警告なし。既存プロジェクトはこの列を持たないため field_ids と同じ方式でヘッダを拡張する。直列化は 40,000 字へ切り詰める（Sheets のセル 5 万字制限を超えると完了行の追記自体が失敗し run が「中断」扱いへ転落するため。超過時は各警告の missingItems を先頭 5 件 + 打ち切りマーカー `truncated` / `missingItemsTotal` へ縮約し〔`evidence_row_count` は missingItems を持たないため対象外〕、なお超える間は末尾の警告から削る。それでも完了行の追記に失敗した場合は warnings なしで 1 回だけ再試行し、完了行の成立を警告の記録より優先する）。S7 実行結果・S8 検証画面のバナー表示の素材（`evidence_row_count` の UI 表示は未実装。監査記録のみ） |

`tokens_out` は思考・推論トークンを含む課金対象出力の合計（Gemini は provider で `candidatesTokenCount + thoughtsTokenCount` に正規化）。実行前のコスト概算では応答本文の出力推定にモデル別思考倍率を掛けるが、表示トークン数・バッチ分割は本文のみを使う。倍率は 3.5 Flash = (10,758 + 11,628) / 10,758 ≈ 2.08、3.8 Flash = (12,348 + 2,688) / 12,348 ≈ 1.22、3.1 / 3.5 Flash Lite・2.0 Flash・Qwen Instruct-2507・Haiku 4.5 = 1。未測定モデルは最大実測値（3.5 Flash）を既定とする。出典: issue #261、2026-09-21 の `experiments/extraction-benchmark-real`、プロンプト v9 再実行（不眠 SR 10 論文、テキスト入力、各論文 1 呼び出し、10 回平均）。

`ExtractionRuns.tokens_in` / `tokens_out` は各バッチの最終試行と、最終エラーが返した使用量を
集計する。途中で再試行された呼び出しの使用量は `LLMApiLog` だけに残る。
S9 / usage.csv / 予算の費用集計は `LLMApiLog` を基にするため、途中の再試行費用も含む。
OpenRouter は応答の `usage.cost` が有限の非負数なら `LLMApiLog.cost_estimate_usd` に優先記録する。
欠落・非数値・負数・非有限値の場合は単価表で概算する。他プロバイダと実行前の見積もりは従来どおり。

#### データ本体タブの分割方針と annotator 軸（v0.4）

抽出データは「study レベルの Table 1 的内容」と「arm 別のアウトカム・RoB の結果」で性質が異なるため、**`StudyData`（wide）と `ResultsData`（long）にシートを分ける**。あわせて**すべてのデータ行に annotator（誰が抽出・検証したか）軸を持たせ**、二重独立抽出（Q4）は「同一 study に対する annotator 行の複数化」で表現する。

- **annotator**: 人間は email、AI 抽出行は `ai`（モデル・実行条件は `run_id` から `ExtractionRuns` を辿る）。**consensus 行（裁定確定）は annotator にリテラル `consensus` を使う**（`ai` と同格の予約値。更新キー `study_id × annotator` の一意性を裁定者交代によらず保証するため。誰が裁定したかは `Decisions.decided_by` が監査する。v0.11）
- **annotator_type**: `ai` / `human_with_ai`（AI 出力を見ながら検証）/ `human_independent`（AI 出力を見ずに独立抽出）/ `consensus`（不一致解消後の確定行）— tiab-review の「AI / AI を見たヒト / AI なしのヒトを別レビュアー扱い」と同じ思想
- **MVP の運用**: `ai` 行 + `human_with_ai` 行の 2 行（単一検証）。`human_independent` / `consensus` はデータ構造（annotator 軸・enum 値）としては MVP から対応。**それらの行を作成・運用する UI（独立抽出モード・不一致解消 adjudication 画面）は v0.11 で実装済み**（S8 独立入力モード + S12 裁定画面。§4.2・§4.6・§7・※Q4。2 アカウントでの実機通し確認も 2026-07-19 に完了済み）
- **エクスポートの既定**: `consensus` 行（なければ唯一の human 行）を確定データとする

wide シートはセル単位のメタデータ（quote / anchor_status / 判定履歴）を保持できないため、AI の根拠情報は `Evidence`、人間判定の監査証跡は `Decisions`（いずれも追記型）に分離する。

#### `StudyData`（wide・study レベル）

1 行 = 1 study × 1 annotator。値列はスキーマの `entity_level = study` 項目から動的生成する（列は**追加のみ**行い、削除・改名はしない。改名は field_id で追跡）。

列の同期は 2 経路ある。**主経路はスキーマ版の確定時**（`app/services/schemaService.ts` の `confirmSchema` が `annotationRepository.ts` の `ensureStudyDataColumns` を呼ぶ）で、確定した `entity_level = study` 項目の列をヘッダへ即座に反映する（ヘッダ行だけを読み、不足列だけを末尾へ追加する no-op 可能な処理。全行読み込みは行わない）。この同期はベストエフォートであり、失敗してもスキーマ確定そのものは失敗させない（版は `SchemaVersions` / `SchemaFields` へ既に追記済みで、ヘッダは派生物にすぎないため）。**副経路として、`upsertStudyDataRows`（annotator 行の書き込み）内の遅延拡張が保険として残る**: 行の書き込み時にヘッダへ無い `field_name` があれば、その場でヘッダ末尾へ追加する。主経路より前に作られたプロジェクトや、主経路の同期が失敗したケースでも、annotator 行が実際に書かれた時点で最終的にヘッダが追いつく。

**更新キー**: `study_id` × `annotator`。書き込みは既存行を検索して上書き（なければ追記）し、`schema_version` / `updated_at` は書き込み時点の値へ更新する。シート側に同一キーの行が複数存在する状態（重複）は致命エラーにせず、`updated_at` が最新の行を有効行として自己修復する（同着はシート上でより下の行を優先）。古い重複行は読み書きの対象から外れるだけで物理削除はしない。upsert 呼び出しの**入力側**に同一キーの行が複数ある場合は、従来どおり呼び出し契約違反として検出する。

| 列 | 型 | 必須 | 説明 |
| --- | --- | --- | --- |
| study_id | string(uuid) | ✓ | |
| annotator | string | ✓ | email または `ai` / `consensus`（裁定確定行。v0.11） |
| annotator_type | enum | ✓ | `ai` / `human_with_ai` / `human_independent` / `consensus` |
| schema_version | int | ✓ | |
| run_id | string(uuid) | | `ai` 行のみ。生成元の実行 |
| updated_at | iso8601 | ✓ | |
| {field_name} … | string | | study レベル項目の値列（動的）。報告どおりの文字列で保持。未報告は `NR` トークン、未検証（human 行）は空セル |

#### `ResultsData`（long・arm / outcome_result / RoB レベル）

1 行 = 1 study × 1 annotator × 1 entity_key × 1 field（セル単位の long）。

**更新キー**: `study_id` × `annotator` × `entity_key` × `field_id`。書き込みは既存行を検索して上書き（なければ `result_id` を採番して追記）し、`schema_version` / `updated_at` は書き込み時点の値へ更新する（`result_id` は行識別子であり、更新キーには使わない）。シート側の重複行は `StudyData` と同じ規則（`updated_at` 最大の行が有効、同着は下の行、古い重複行は物理削除しない）で自己修復する。入力側の重複は従来どおり呼び出し契約違反として検出する。

| 列 | 型 | 必須 | 説明 |
| --- | --- | --- | --- |
| result_id | string(uuid) | ✓ | |
| study_id / field_id | string(uuid) | ✓ | |
| annotator / annotator_type | string / enum | ✓ | `StudyData` と同じ定義 |
| schema_version | int | ✓ | |
| entity_key | string | ✓ | arm レベルは `arm:1` 等、outcome_result は `outcome:mortality\|arm:1\|time:30d`、RoB は `rob:<domain_id>` 形式（例 `rob:d1_randomization`）。estimate（result）単位の RoB オーバーライド行は `rob:<domain_id>\|outcome:<key>` 等の複合形式（§3.3。issue #109） |
| run_id | string(uuid) | | `ai` 行のみ |
| value | string | | 報告どおりの文字列で保持（型検証はクライアント側） |
| not_reported | bool | | |
| updated_at | iso8601 | ✓ | |

#### `ArmStructures`（群構成の確定・追記型）

検証画面（S8）冒頭の「群構成の確定」（§3.3 の arm レベル、§4.2）の保存先。1 行 = 1 arm。確定・改訂のたびに**その study の全 arm 行を新しい version で追記**する（追記型 = 監査証跡を兼ねる）。study × annotator の最新 version が現在の確定内容で、**行が 1 件もない study は「arm 未確定」**（検証画面で arm / outcome_result タブをディム表示）。`arm_key` は `ResultsData.entity_key`（`arm:n` およびその複合キー）と join できる。群構成は試験に対して 1 つであり（登録・論文で報告が食い違う場合も確定するのは 1 つ）、study 単位のキーが v0.10 でむしろ自然になる。

| 列 | 型 | 必須 | 説明 |
| --- | --- | --- | --- |
| study_id | string(uuid) | ✓ | |
| version | int | ✓ | study × annotator ごとに 1 から採番。確定・改訂のたびに全 arm 行を新 version で追記 |
| arm_key | string | ✓ | `arm:1` 形式（§3.3）。ResultsData / Evidence の entity_key との join キー |
| arm_name | string | ✓ | 人間が確定した群の名称（例: `介入群（アスピリン）`）。AI ドラフト（Evidence の arm 名フィールド値）を初期値にユーザーが編集 |
| annotator / annotator_type | string / enum | ✓ | 確定操作を行った annotator（MVP では確定者本人の `human_with_ai`。v0.11 で裁定画面 S12 の consensus 版〔`annotator='consensus'`〕を追加） |
| confirmed_at | iso8601 | ✓ | |
| note | string | | |

#### `Evidence`（AI 根拠・追記型）

AI 抽出の根拠情報。ハイライト表示（§5）と audit.csv の素材。1 行 = 1 run × 1 study × 1 field × 1 entity_key（+ quote の出所 document）。**例外: `max_quotes` を持つ項目（issue #275）と、全体照合失敗後に分割した断片（issue #294・§5）は 1 セル = 同じ run の複数行**で、`quote_seq`（1, 2, …）で区別する。読み手は「セルの代表行を後勝ちで選び、代表行と同じ run の `quote_seq` 付きの行を `quote_seq` ごとに後勝ちで束ねる」。`quote_seq` を持つ行は「AI で再特定」（relocate-quote skill）の対象外とする（アンカリングに失敗した引用も一覧に残し、「本文内を検索」で手動確認する）。束ねた行は `quote_seq` 昇順に並べ、先頭をセルの代表として値・confidence の表示に使う。`ai` annotator 行（StudyData / ResultsData）の値はここから転記される。**16 タブ中このタブだけが document_id を持ち続ける**（quote は特定の PDF の中に存在するため。§3.2「study と document の分離」）。

| 列 | 型 | 必須 | 説明 |
| --- | --- | --- | --- |
| evidence_id | string(uuid) | ✓ | |
| run_id | string(uuid) | ✓ | |
| study_id / field_id | string(uuid) | ✓ | |
| document_id | string(uuid) | | **quote の出所文書**。AI 応答の `document_index` から解決（§4.3）。ビューアはこの文書を開いてハイライトする。not_reported で quote がない場合は空可 |
| entity_key | string | ✓ | study レベルは `-` |
| value | string | | AI 出力の原本 |
| not_reported | bool | | AI が「全文書に報告なし」と判断 |
| quote | string | | **verbatim 引用（根拠箇所）**。ハイライトの元データ |
| page | int | | 出所文書内の 1-indexed ページヒント。分割した断片では AI ヒントではなく、その断片が照合されたページ（ページをまたぐ場合もある） |
| confidence | enum | | `high` / `medium` / `low`（プロンプトで自己申告させる） |
| anchor_status | enum | | quote アンカリング結果: `exact` / `normalized` / `fuzzy` / `failed`（§5） |
| bbox_page | int | | quote の bounding box が乗るページ（1-indexed）。`pdf_native`（画像入力）の run で Gemini が返した `box_2d` 由来。bbox_ymin 等が空なら本列も空 |
| bbox_ymin / bbox_xmin / bbox_ymax / bbox_xmax | int | | quote の bounding box（0–1000 正規化・画像左上原点・回転適用後の表示フレーム基準）。`anchor_status` とは別軸で、**機械検証はできない**（value/quote が正しくても box がずれる場合がある。人手判定に委ねる）。壊れた box（範囲外・順序逆等）は 5 列とも空へ落とす。box_2d を返さない run（text_only・非対応プロバイダ）は常に空 |
| relocated_from | string(uuid) | | **relocate-quote skill（issue #94）で再特定した行が指す、元の（アンカリング失敗）evidence_id**。通常の抽出行・独立入力の手入力行は空。詳細は下記「quote の再特定（relocate-quote skill）」参照 |
| quote_theme | string | | 2026-09 追加（issue #275）。`max_quotes` を持つ項目で、その quote が支えるテーマ名（AI 応答の `theme`）。通常の行・分割した断片は空 |
| quote_seq | int | | 2026-09 追加（issue #275）。同じセル内の quote の 1 始まり連番（AI 応答での出現順、分割した断片は元引用内の出現順）。**空 = 通常の 1 セル 1 quote の行**。`value` は同じセルの全行で同じ（`max_quotes` 項目はテーマ名の連結、分割した断片は元の item の値を置き換えず保持）。既存プロジェクトはこの 2 列を持たないため、`quote_seq` を持つ行を初めて追記するときにヘッダ末尾へ追加する |
| section | string | | 2026-10 追加（issue #307・プロンプト版数 12）。**quote がある節の見出し**（AI 応答の `section`。原文の表記どおり。分からなければ空）。分割した断片は元の引用の値を引き継ぎ、再特定（relocate-quote）で追記する行は空にする（引用箇所が変わるため）。機械検証はしない。既存プロジェクトはこの列を持たないため、`section` を持つ行を初めて追記するときにヘッダ末尾へ追加する（`quote_seq` だけを持つ行なら 20 列止まり） |

分割した断片を採用するときは全体の引用の行を書かず、断片ごとに新しい `evidence_id` を付ける。`bbox` / `bbox_page` / `relocated_from` / `quote_theme` は空。照合の状態は断片ごとの実際の結果（`exact` / `normalized` / `fuzzy`）をそのまま持ち、分割を表す新しい `anchor_status` は足さない。再特定の記録方式と同じく、マッチ品質を失わず既存のハイライト描画・失敗率集計を使うためである。

#### quote の再特定（relocate-quote skill。issue #94）

`anchor_status = failed`（quote アンカリング失敗）の Evidence 1 件を、検証画面の「AI で再特定」ボタンから LLM で再特定する（1 クリック = 1 Evidence。BYOK 課金のため一括再特定はスコープ外）。

- **記録方式（設計判断）**: 再特定に成功したら**新しい Evidence 行を追記**する（Evidence は追記型のため、元の失敗行は上書きせず監査残置）。新行は `run_id` / `study_id` / `field_id` / `entity_key` / `document_id` を元行と同一に保ち、`relocated_from` に元の `evidence_id` を記録する。`anchor_status` は「`relocated` という新種別」ではなく、**実際の再アンカリング結果（`exact` / `normalized` / `fuzzy` のいずれか。`failed` は採用しないため relocated_from が付く行には現れない）をそのまま持つ**。
  - 検討した代替案（`anchor_status` に `relocated` を追加する）は不採用: 実際のマッチ品質情報が失われ、ハイライト描画（§5）・S9 ダッシュボードの anchor 失敗率集計（いずれも `anchor_status` の実値を見る）に手を入れる必要が生じる。`relocated_from` 列を新設する方式なら両方とも無改修で動く
  - run_id/study_id/field_id/entity_key/document_id を元行と同一に保つ設計により、「同一セルは追記順で後勝ち」という既存の畳み込み規約（cells.ts のセルモデル構築、S8 検証画面が最新 run の Evidence を選ぶ規約）がそのまま新行を採用する。audit.csv の「同一 schema_version の run が複数あるとき started_at 最新の Evidence を添付する」規約（§4.4）は、再特定行が元行と同じ run_id ゆえ started_at が同値になるため、同値時は追記順で後の行を優先するように取り扱う
- **入力**: 失敗した quote / 対象項目の `extraction_instruction` 等 / 出所文書の `extracted_texts`（元 page ヒントの前後 ±10 ページに絞ってトークンを節約。ヒントが無い、またはヒント周辺に該当が無ければ全ページにフォールバック）
- **出力**: 修正した verbatim quote + page、見つからなければ `found: false`
- **無検証で信用しない**: LLM の応答 quote は、既存のアンカリング中核（§5）でそのまま再アンカリングし、**fuzzy 以上で成功したときだけ**採用する。LLM が `found: false` を返した場合・応答が壊れている場合・再アンカリングが `failed` だった場合は、いずれも「見つからなかった」として扱い、Evidence へは何も書かない（従来の quote 全文表示 + 本文内検索の手動導線を案内する）
- モデル / API キー / レート制限は既存のサービス層パターン（`withRetry(withLogging(provider))` 相当の `applyRateLimitPolicy(withLogging(...))` + Options のレート制限設定）に乗せ、`LLMApiLog.purpose = 'relocate_quote'` で記録する（成功・not_found を問わず呼び出しごとに記録）

#### `QuoteSets`（v0.31 新設。17 → 18 タブ・人が直した引用の一覧・追記型）

人が引用（ハイライト）の一覧を直した結果を、**セル × annotator 単位のスナップショット**として追記する（issue #307）。`Evidence` タブには人の編集を書かない — `Evidence` は「AI の出力」である前提が、ダッシュボードの照合失敗率・パイロットの集計・R セットの状態・audit.csv の未検証行に入っているため。

| 列 | 型 | 必須 | 説明 |
| --- | --- | --- | --- |
| set_id | string(uuid) | ✓ | 1 回の保存（= 1 スナップショット）ごとの ID。1 スナップショットの行は 1 回の追記でまとめて書く |
| saved_at / saved_by | iso8601 / email | ✓ | 保存操作をした人 |
| annotator / annotator_type | string / enum | ✓ | 一覧の持ち主（`StudyData` と同じ定義。裁定は `consensus`） |
| study_id / field_id / entity_key | string | ✓ | セル |
| schema_version | int | ✓ | 保存時点のスキーマ版 |
| kind | enum | ✓ | `quote`（引用 1 件）/ `empty`（引用をすべて外した）/ `reset`（AI の引用に戻した）。`empty` と `reset` は 1 スナップショット 1 行で、以降の列は空 |
| seq | int | | 一覧の中の 1 始まりの順番 |
| quote_id | string | | **引用ごとに変わらない ID**。AI 由来は元の `Evidence.evidence_id`、人が足した引用は新しい UUID |
| source | enum | | `ai` / `human` |
| evidence_id | string(uuid) | | `source = ai` のとき元の Evidence 行。スキャン PDF の座標（bbox）と confidence は、表示のたびにこの行から復元する（スナップショットには写さない） |
| origin_annotator | string | | 裁定（`consensus`）の一覧で、どのレビュアーの一覧から採った引用か。それ以外は空 |
| document_id / quote / page / section | | | 引用の出所文書・本文・頁・節 |
| theme | string | | 複数選択の選択肢・複数引用のテーマ。通常の項目は空 |
| anchor_status | enum | | 保存時点の照合結果 |
| base_run_id | string(uuid) | | このセルの一覧を最初に人が直した時点の、AI の引用の run_id（AI の引用が無ければ空） |

- **読み方**: (study_id, field_id, entity_key, annotator, annotator_type) ごとに、シート上もっとも後ろにある行の `set_id` のスナップショットを採る（後勝ち。時刻ではなく行順）。`reset` は「スナップショットなし」と同じに扱う
- **有効な引用の一覧**（S8・書き出しが共通で使う。`src/features/verification/cellQuotes.ts`）: スナップショットがあればそれ（`empty` は 0 件で、**AI の引用へ戻さない**）、無ければ AI の引用（その annotator が AI の出力を見てよい場合だけ）
- **再抽出後**: 人が直した一覧はそのまま残す。いまの AI の引用が 1 件以上あり、その run が `base_run_id` と違えば、S8 に「あとから抽出された AI の引用があります」と注記し、「AI の引用に戻す」で切り替えられる。AI の引用が無いセル（未報告など）では注記を出さない
- **タブの追加**: 新規プロジェクトは作成時に作る。既存プロジェクトは初回の保存時に作る（`ReviewSets` と同じ方式。プロジェクト選択の必須タブには入れない）。タブが無い・空のプロジェクトは「スナップショットなし」として読む
- **盲検**: S8 は `annotator` と `annotator_type` の両方が自分と一致する行だけを読む。独立入力モードでも自分の行だけを読み、AI の引用とは合成しない（`design-independent-dual-review.md` §3）
- **保存**: 判定と同じスプレッドシート単位の排他区間で追記する。失敗したら画面の一覧を元に戻してエラーを出す（オフラインキューには入れない）。別の画面・別の端末から同じセルを直した場合は後勝ち

#### `Decisions`（判定監査ログ・追記型）

人間の判定操作を 1 操作 = 1 行で追記する。検証 UI の undo（直近判定の取り消し）も `undo` として残す。

| 列 | 型 | 必須 | 説明 |
| --- | --- | --- | --- |
| decided_at / decided_by | iso8601 / email | ✓ | decided_by は**判定操作を行った人間** |
| study_id / field_id | string(uuid) | ✓ | |
| entity_key | string | ✓ | |
| annotator / annotator_type | string / enum | ✓ | **判定対象の annotator 行**（`StudyData` / `ResultsData` のどの行への判定か）。MVP では decided_by 本人の `human_with_ai` 行。**v0.11 で実装した裁定画面（S12）**では decided_by（裁定者）が `consensus` 行へ判定する |
| schema_version | int | ✓ | 判定時点で対象行が依拠していたスキーマ版（スキーマ改訂 → 再抽出後の再検証を区別する） |
| action | enum | ✓ | `accept` / `edit` / `reject` / `not_reported` / `undo` |
| value | string | | 操作後の値 |
| note | string | | 検証時のメモ（例: Table 2 と本文で数値不一致、Table 2 を採用）。論文への質問パネル（v0.24・issue #264）で質問した study の以後の判定・裁定は、先頭に印 `[chat-assist]` が自動で付く（メモがあれば `[chat-assist] メモ`） |

> **インスタンス宣言イベント（2026-07-09 追記）**: AI が丸ごと見落とした outcome_result を人間が追加する操作は、`Decisions` に予約 `field_id = __entity_instance__` の行として追記する。`entity_key` には追加した outcome_result キー、`annotator` は操作した人間、`annotator_type` は宣言者のロールに応じた値（`human_with_ai`。独立入力モードでは `human_independent`。v0.11）、`action = edit`、`value = entity_key`、`note = outcome_instance_declared` を入れる。この行はセル判定ではなく「entity インスタンスを人間が宣言した」監査イベントなので、`StudyData` / `ResultsData` の annotator 行は更新しない。検証 UI のセル生成はこの宣言行をインスタンス源として読むが、audit.csv の判定行からは除外する（原本の `Decisions` には残る）。

#### `LLMApiLog` / `ExportLog`

- `LLMApiLog`: sr-query-builder のスキーマを基に拡張。`purpose` enum は `draft_schema` / `suggest_study_label` / `extract_study` / `relocate_quote` / `ask_paper`（v0.24。論文への質問パネル。**この purpose の行は `prompt_ref` / `response_ref` / `prompt_summary` を空にし、`error` にもプロバイダの応答本文を含めず、質問と回答の本文を残さない**）/ `other`（v0.10 で `extract_document` → `extract_study` へ改名）
  `cached_tokens_in` の後ろに `run_id` / `study_id` / `section` / `prompt_version` /
  `thoughts_tokens_out` をこの順で追加する（旧行の追加列は空 = 不明）。抽出開始前に先頭 13 列を
  検証してヘッダを拡張し、空・欠落セルは補完する（空でない列名の競合だけを拒否）。
  既存のデータ行は変更しない。抽出ログには run と呼び出し対象の study /
  section を記録する。抽出以外の `run_id` は空、根拠再特定では対象の `study_id` を記録する。
  プロンプト版数は列と Drive の prompt payload の両方に残す。
  `tokens_out` は思考・推論を含む課金対象出力の合計、`thoughts_tokens_out` はその思考分の内数で、
  個別の報告がなければ空とする。Gemini は usageMetadata があれば未報告の思考分を 0 とする。
  応答内容エラー（出力上限等）でもプロバイダが使用量を返せば、トークン数・概算費用を記録し、
  抽出実行の失敗バッチも返された使用量を実行合計に加算する。HTTP エラー・解析不能な応答の
  使用量は不明とする。警告専用行は旧行にも適用できる
  `prompt_ref === '' && response_ref === ''` で識別する。警告行には run と、対象があれば study /
  section を記録し、`prompt_version` / `thoughts_tokens_out` は空とする。
  費用集計では警告専用行を呼び出し数・使用量・費用のすべてから除外し、
  予算の累積費用は **全 purpose の既知費用の合計**とする。費用不明かつ入出力のいずれかが既知の
  行は `unknownPriceCalls` に数え、価格不明の除外件数を表示する。エラー行の既知費用は失敗費用にも
  計上する。全バッチ失敗（本文取得・API・形式・保存の失敗、応答要素の全破棄）は `[batch_failed]` prefix と
  空の prompt / response 参照を持つ警告専用行へ run・study・section と種別・詳細を記録する
  （監査の記録失敗は実行を妨げない）。同じ run・study・section の失敗が記録された
  非エラー call の既知費用も失敗費用に含め、エラー call と二重計上しない。キャッシュ率は
  入力とキャッシュ内訳が両方既知の行だけで合計同士を割る（分母 0 は不明）。
  Gemini・思考内訳が空・出力使用量が非空の非警告行は過小計上として件数と既知費用を示す
  （思考計上の修正と本機能が同じリリースに含まれる前提）。
  抽出費用は記録された run ID を完了 run または完了行のない running（中断）に結合し、
  ID のない旧行だけを呼び出し時刻を含む完了 run に推定割り当てする
  （両端含む。重複時は開始が最も遅い run）。ID のない中断 run への時刻割当は行わず、
  未一致は未割り当てとし、
  推定・未割り当ての件数と費用を区別する。成功 study は同じ run ID を記録した非エラー call が
  1 回以上あり、同じ run・study の batch_failed 警告がない study の重複を除いて数える。
  study 情報がなく、割当済み非エラー call がある旧 run だけ対象 study 一覧で成功数を推定する
  （API 呼出前に全バッチが失敗した run や、エラー call だけの run は成功 0）。
  中断 run はアプリの未抽出扱いに合わせ、study 情報や非エラー call があっても成功数は 0 とする。
  全体の study 当たり費用は **未割当・中断を含む全抽出費用（再実行込み）** / 重複しない
  成功 study 数とし、`pilot` / `full` / `single_study` 別は各種別に割当できた費用だけを
  分子に含める（分母 0 は不明。未割当費用は種別へ割当できない旨を UI に注記）。
  中断は S9 の状態列に表示し、usage.csv の `status` 列にも記録する。月別は UTC の ISO 時刻の
  先頭 7 文字でまとめる。予算判定は累積費用 + 次回見積もりが予算を超えるかで行い、
  見積もり不明時は累積費用だけの判定と明示する。
- `ExportLog`: `export_id` / `format`（`study_wide` / `results_long` / `audit` / `r_set` / `usage`。`usage` は使用量 CSV）/ `schema_version` / `study_count`（CSV に行が出た study 数。v0.10 で `document_count` から改名）/ `file_ref`（Drive に保存した CSV の URL）/ `exported_at` / `exported_by`

#### `Reviewers`（v0.11 新設。14 → 15 タブ）

独立二重レビュー機能（issue #44）のレビュアー割り当て置き場。追記型・email ごとに最新行が有効（latest-wins。上書きしない方針は他タブと同じ）。owner 自身は登録不要（`Meta.created_by` で解決）。旧プロジェクトにはタブが無く、書き込み時に自動作成する（`ArmStructures` 導入時と同じパターン）。

| 列 | 型 | 必須 | 説明 |
| --- | --- | --- | --- |
| email | string | ✓ | レビュアーの Google アカウント |
| role | enum | ✓ | `reviewer` / `adjudicator` / `revoked`（解除も追記で表現） |
| review_mode | enum | | `with_ai` / `independent`。`role = reviewer` のとき必須（`adjudicator` / `revoked` 行は空） |
| assigned_by | email | ✓ | 割り当て操作を行った owner の email |
| assigned_at | iso8601 | ✓ | |

**ロール解決**（メインビュー起動時に 1 回）: ログイン email が `Meta.created_by` と一致 → `owner`。`Reviewers` の有効行に一致 → `role = adjudicator` ならそのまま、`role = reviewer` なら `review_mode` により `reviewer_with_ai` / `reviewer_independent` に分岐。どちらにも該当しない（`revoked` 含む）→ `unregistered`（全画面ブロックで以降の読み込みを中断。フェイルクローズ — 解決中・解決失敗も同様にブロックする）。詳細設計は [docs/design-independent-dual-review.md](design-independent-dual-review.md) を参照。

**レビューモード変更のハードブロック**（v0.21・issue #255）: 登録しようとする行の実効 annotator_type（`reviewer` × `independent` → `human_independent`、`reviewer` × `with_ai` と `adjudicator` → `human_with_ai`。`revoked` は対象外）が、その email を `annotator` とする既存の `Decisions` / `StudyData` / `ResultsData` / `ArmStructures` 行の `annotator_type` と 1 件でも食い違えば、追記を拒否する（登録時に 4 タブを読み直す。読めなければ登録しない）。実データ 0 件の email は警告ダイアログを経て変更できる。着手後の誤登録は訂正できず（別モードで作業させるなら別アカウントで登録する）、本決定以前に既に混在した email・プロジェクトは救済しない（解除のみ可。データは書き換えない）。読み出し側やデータキーに `annotator_type` を加える案は採らない。

#### `ReviewSets`（v0.25 新設。16 → 17 タブ）

担当セット（issue #263）とその担当者の置き場。追記型・`set_id` ごとに最新行が有効（latest-wins）。旧プロジェクトにはタブが無く、書き込み時に自動作成する（`Reviewers` と同じ）。タブが無い・行が無いときは「担当セットを使わない」。

| 列 | 型 | 必須 | 説明 |
| --- | --- | --- | --- |
| set_id | string | ✓ | `calibration` / `group-1` / `group-2` … |
| reviewer_emails | string | | 担当者の email を `;` 区切りで。グループは 2 名が既定（同じ人が複数のグループに入ってよい）。`calibration` は全員が入力するため空でよい |
| seed | string | | 一括分割で使ったシャッフルの乱数種（同じ分割で作った行はすべて同じ値）。担当者だけの編集行は空 |
| updated_by | email | ✓ | 書き込んだ owner の email |
| updated_at | iso8601 | ✓ | |
| study_ids | string | | 所属 study_id を `;` 区切りで記録する。空セル（`null`）は直前の同じセットの所属を引き継ぐ（メールのみの編集など）。空集合は `;` と記録する。一括分割・個別割当・統合で影響するセットに更新後の所属を追記する |

- **担当の正**: owner の行の `study_ids` を表示対象・裁定ペア・一致度・進捗の根拠とする。`Studies.review_set` は併記し、食い違うアクティブ study の件数を owner の Home に警告する。記録が食い違う場合は `ReviewSets` を優先する。
- **所属更新の失敗と競合**: 統合は全対象文書の付け替えが成功してから所属を置換する。付け替え途中の失敗では元の所属を保持し、所属保存だけが失敗した場合は新 study を未割当として owner が再読込後の個別割当で復旧する。個別割当・統合では保存直前に ReviewSets と Meta.created_by を再取得し、owner の最新所属へ変更を重ねる。再取得から追記までの競合は残る。一括分割・分け直しは意図した全体更新として扱う。
- **改ざんへの限界**: `updated_by` が `Meta.created_by` と違う行は無視し、owner に警告する。ただし `updated_by` は行の値で、Sheets の値にはセルの書き手の記録がない。reviewer が owner のメールを記入すれば迂回できる。確実に防ぐには reviewer が閲覧のみのファイルに担当を置く必要がある。

#### `ApiErrorLog`（v0.18 新設。15 → 16 タブ）

Google API 呼び出しの失敗を記録する診断ログ（issue #249）。「特定の文献だけ PDF が表示されない・判定しても記録が残らない」という問い合わせで、シートの実データからは「その時間帯に判定が書けていない」ことまでしか分からず原因（403/429 クォータ・503 過負荷・401 トークン・404 未許可・ネットワーク遮断のいずれか）を特定できなかった反省から、プロジェクト管理者がレビュアーの端末に触れずシートだけで原因を確定できるようにする。旧プロジェクトにはタブが無く、`Reviewers` と同じく書き込み時に自動作成する。

| 列 | 型 | 必須 | 説明 |
| --- | --- | --- | --- |
| log_id | string(uuid) | ✓ | |
| occurred_at | iso8601 | ✓ | **失敗が発生した時刻**（シートへ書き込んだ時刻ではない。ローカル退避 → 復旧後フラッシュでも保持する） |
| logged_by | email | ✓ | サインイン中のメール（annotator と同じ値）。未設定時は空 |
| context | enum | ✓ | 失敗した操作の種別: `pdf_load`（PDF バイナリ取得）/ `evidence_append`（Evidence 追記）/ `decision_save`（Decisions 追記）/ `annotation_upsert`（StudyData・ResultsData の annotator 行 upsert。判定保存と ai 転記の共通経路） |
| api | string | ✓ | `drive.files.get` / `sheets.values.append` のような短い API 名。URL そのものは記録しない（クエリにファイル ID が入るため） |
| http_status | int | | ネットワーク層の失敗（fetch 自体が reject）は空 |
| message | string | ✓ | 打ち切り済みのエラーメッセージ（`GoogleApiError.responseBody` を含みうるが定数長で打ち切る。トークン・認可ヘッダ・リクエストボディは含まない） |
| study_id / document_id | string(uuid) | | 分かる範囲で（空可） |
| retry_count | int | ✓ | `googleFetch` が最終的に諦めるまでに行った再試行回数 |
| app_version | string | | `chrome.runtime.getManifest().version`。取得できない環境では空 |

**実装方針**: `lib/` は `features/` を import できない（architecture.md §2.1）ため、計装対象の `getFileBinary`（`lib/google/drive.ts`）を含む本機能は `lib/diagnostics/apiErrorLog.ts` に実装する（`reviewerRepository.ts` と同じ「タブが無ければ書き込み時に自動作成」パターンをそちらに複製）。Sheets への書き込みが失敗している間は `chrome.storage.local` のリングバッファ（上限件数超過で古い順に破棄）へ退避し、次に同経路の呼び出しが成功したタイミングでフラッシュする（fire-and-forget。ログの失敗・遅延で本業の判定保存・PDF 表示を止めない）。`ApiErrorLog` タブ自体への書き込み失敗は再帰的に記録しない（無限ループ・キュー膨張の防止）。1 回のフラッシュで書く行数にも上限を設け、1 プロジェクトあたりの行数が無制限に増えないようにする。

### 3.3 エンティティモデル（entity_level）

SR のデータ抽出は「研究 → 群（arm）→ アウトカム × 時点の結果」という階層構造を持つ。完全な汎用化は UI もエクスポートも複雑化するため、study / arm / outcome_result / rob_domain の 4 レベルに限定する（`rob_domain` は v0.9 で P1 から MVP へ前倒し）。

| entity_level | 例 | エンティティの定義方法 | 格納先 |
| --- | --- | --- | --- |
| `study` | 出版年、国、デザイン、総 N | 1 study に 1 インスタンス固定 | `StudyData`（wide） |
| `arm` | 群名、介入内容、群別 N | AI が arm 一覧をドラフト → 人間が検証画面冒頭で arm 数・名称を確定（`ArmStructures` へ保存）してから配下項目を検証 | `ResultsData`（long）。確定した群構成は `ArmStructures` |
| `outcome_result` | 効果推定値、群別イベント数 | スキーマで定義した outcome × 時点の組み合わせごとに 1 インスタンス | `ResultsData`（long） |
| `rob_domain` | RoB 2 / ROBINS-I のドメイン判定 + 根拠 | RoB テンプレート（S5 プリセット挿入）が抽出指示に明示列挙する固定ドメインごとに 1 インスタンス。AI ドラフト（draft-schema）は RoB 項目を出さない = テンプレート挿入が唯一の入口。群構成の確定には依存しない（arm 未確定でも RoB タブは検証可）。estimate（result）単位のオーバーライドインスタンスは S8 の宣言操作で追加（issue #109。下の注記） | `ResultsData`（long） |

`arm` タブのインスタンス源は、Evidence / Decisions に現れた `arm:n` に加えて、`ArmStructures` の最新確定版に含まれる `arm_key` とする。これにより、群構成カードで人間が追加・確定した arm は、AI の Evidence がなくても空セル（`AI 抽出なし（手入力のみ）`）として表示される。

`outcome_result` タブのインスタンス源は、Evidence / Decisions に現れた outcome_result キーに加えて、上記のインスタンス宣言イベントを含める。既存 outcome が一部の arm にしか現れていない場合は、同じ outcome / time を確定済み arm 全体へ展開し、見落とし値を人間が明示的に `edit` / `reject` / `not_reported` できる空セルを作る。人間が新規 outcome を追加する UI は、`entityKey.ts` の `makeOutcomeEntityKey` / 次番号採番ヘルパで `outcome:<key>|arm:<n>|time:<time>`（time は任意）を生成し、既存キーと衝突する場合は保存しない。

> **群のキーは番号（issue #293・プロンプト版数 11）**: AI が返す entity_key の群は `arm:<正の整数>`（初出順に 1, 2, …。arm レベルと outcome_result レベルで同じ番号）。番号づけの規則は arm レベルと outcome_result レベルの両方の規約に書く（arm レベルの項目が無いバッチ — arm レベルの項目を持たないスキーマ、または section 単位分割でできる outcome_result だけのバッチ — でも規則が出るようにするため）。人が検証画面で確定・追加する群のキーにはこの制約をかけない。

> **幽霊セルの分母（2026-07-09 追記）**: 非 study タブで「既存インスタンス × 全 field」の直積として作られる Evidence なしセルは、進捗の総セル数に含める。これは AI が値を出さなかったセルも「未報告」なのか「AI の取りこぼし」なのかを人間が明示判定するための automation bias 対策である。未判定のまま残ると検証進捗・ダッシュボード・エクスポート警告の分母に残る。

> **設計判断（案）**: 二値 / 連続アウトカムのメタ解析入力（2×2 表、mean/SD）を outcome_result 項目のテンプレートとしてプリセット提供する。RevMan 形式の直接出力は P2。
>
> **連続アウトカムの散布度代替報告（issue #43・2026-07-11）**: SD が未報告で SE や信頼区間しか載っていない論文、および median + IQR / range で報告する論文（skewed data で頻出）に対応するため、連続テンプレートは mean / SD / n に加えて `outcome_se` / `outcome_ci_lower` / `outcome_ci_upper` / `outcome_ci_level` / `outcome_median` / `outcome_q1` / `outcome_q3` / `outcome_min` / `outcome_max`（いずれも float・required=false）を持つ。報告された統計量を**そのまま**構造化して抽出し（verbatim quote 原則を維持）、SD への換算はツール内では行わず解析段階に委ねる（SE / CI は Cochrane Handbook §6.5.2: SD = SE×√n、SD = √n×(upper−lower)/3.92 等。median 系は Wan 2014 / Luo 2018 / Shi 2020 法の入力素材となる）。`outcome_sd` の抽出指示は「SD そのものが報告されたときだけ抽出・SE / CI / IQR / range からの計算禁止」、`outcome_mean` は「median のみ報告時は `outcome_median` へ」とし、群間差の CI を群別 CI と取り違えないよう抽出指示で明示する。IQR は四分位値（Q1 / Q3）として報告された場合のみ抽出し、幅（IQR = 2.3 等）のみの報告は not_reported とする。
>
> **報告単位の捕捉（issue #76・2026-07-13）**: R セット（#60）の設計要望「`reported_unit` の出力」に応えるため、連続テンプレートへ `outcome_unit_reported`（text・required=false）を追加する。論文が測定値をどの単位で報告したか（例: mmHg, mg/dL, points）を原文表記のまま構造化して取るだけの項目で、単位換算そのものは行わない（換算は R + AI 後工程に委ねる本節冒頭の設計判断を踏襲）。`SchemaField.unit`（スキーマ設計者がフィールド定義時に書く期待単位のメモ。`data_dictionary.csv` の `unit` 列）とは別物であり、両者を混同しないことを data dictionary 側の説明（design-r-export.md §4.4）に明記する。二値プリセット（イベント数・例数）は無次元のため対象外。extract-data skill のプロンプト本文・版数は変更しない（項目追加は `extraction_instruction` 内で完結する既存パターンを踏襲）。
>
> **RoB テンプレート（v0.9 確定）**: RoB 2（D1〜D5 + overall。判定 `low` / `some_concerns` / `high`）と ROBINS-I（D1〜D7 + overall。判定 `low` / `moderate` / `serious` / `critical` / `no_information`）を各「判定（enum）+ 根拠（text）」の 2 項目 × ドメイン共通のテンプレートとして提供する。entity_key（`rob:d1_randomization` 等）は項目の `extraction_instruction` に明示列挙し、extract-data skill のプロンプト本文は変更しない（プロンプト版数据え置き）。対象デザインでない文献（例: RoB 2 に対する非ランダム化研究）は全ドメイン `not_reported` とするよう抽出指示に含める。
>
> **draft-schema のレビュータイプ適応（2026-07-19・プロンプト版数 2）**: 従来の draft-schema プロンプトは PICO・比較研究前提（arm 別介入 + アウトカム別 outcome_result の網羅）を無条件に指示しており、scoping review・診断精度（DTA）・予後レビューのプロトコルでも介入比較型の項目構成を提案しがちだった。版数 2 では、プロトコルからレビュータイプを推定し、タイプに応じた entity_level 構成で提案するよう変更した: 介入比較 = 従来どおり／DTA = index test ごとの outcome_result（TP / FP / FN / TN・感度・特異度 + 閾値が変動する場合の閾値項目。arm は群比較があるときのみ）／予後 = 予後因子 × アウトカム（× 時点）ごとの効果推定値（HR / OR / RR + CI・調整変数）を outcome_result で提案／scoping・mapping = プロトコルが挙げる概念を study レベルで chart し、群・結果の数値構造がなければ arm / outcome_result を作らない。DTA / 予後の結果インスタンスは arm セグメントなしの outcome_result キー（extract-data の entity_key 規約で `|arm:<n>` は arm 固有時のみ付与）としてエンティティモデル変更なしに格納でき、検証画面のタブは entity_level 項目が 0 件のレベルを表示しないため（`availableTabs`）、study のみのスキーマでは study タブだけになる。
>
> **estimate（result）単位の RoB オーバーライド（issue #109・2026-07-20 確定）**: QUADAS-3 v1.2 の Phase 3〜6（flow 図・評価対象 estimate の特定・**selected estimate ごと**の RoB / applicability / overall）に対応するため、rob_domain の entity_key を複合キー文法へ拡張する。
> - **キー形式**: study 単位の `rob:<domain_id>`（現行 = **base 評価**）に加え、`rob:<domain_id>|outcome:<key>[|arm:<n>][|time:<t>]`（= **estimate 単位のオーバーライド**）を許容する。estimate の同定は **outcome_result インスタンスキーの流用**であり、独立の estimate 台帳・選定 UI は作らない（原典 Phase 4 の「レビューに含める estimate の選定はデータ抽出の一部」= スキーマ定義 + 抽出 + 検証を通過した outcome_result インスタンスがそのまま selected estimate、という整理）
> - **解決規則**: estimate × ドメインの評価 = オーバーライド行があればそれ、なければ base 行（原典 Table 5 脚注 "After the first estimate, only domains where characteristics are different between estimates need to be assessed" の直訳）。全 estimate × 全ドメインの自動直積はしない（幽霊セルの分母はオーバーライドの宣言分だけ増える）
> - **AI 抽出は base のみ**: extract-data プロンプト・entity_key 規約・コスト概算は無変更。オーバーライドは人間が S8 で宣言して手動判定する専用（判定 + 根拠 + 当該ドメインの SQ 行を含む）。宣言は `Decisions` のインスタンス宣言イベント（outcome_result の「アウトカムを追加」と同型）
> - **全 RoB ツール共通**: 宣言 UI・キー文法・解決規則は QUADAS-3 特例にせず、RoB 2 / ROBINS-I の result 単位評価（例: outcome ごとの D5）も同一機構で可能とする
> - **QUADAS-3 テンプレートの拡張**: Phase 3 の flow 図として study レベルの `quadas3_flow_diagram`（**mermaid `flowchart TD` ソースを値とする text 項目**。複数分岐〔複数 index test・経路・サブグループ〕を表現するため。S8 のセルカードで同梱 mermaid による描画プレビュー = CDN 不可のため pdfjs worker と同じ同梱方式・`securityLevel: 'strict'`・構文エラー時はテキスト表示へフォールバック）+ 構造化数値 5 項目（`quadas3_flow_enrolled` / `quadas3_flow_index_tested` / `quadas3_flow_reference_standard` / `quadas3_flow_analyzed` / `quadas3_flow_exclusions`。主要数値のマシンリーダブルな監査・R 側利用）を追加する。Phase 4 Table 5 の estimate 記述列は outcome_result レベルの `quadas3_est_*` 7 項目（participants / index_test / threshold / target_condition / reference_standard / unit / analysis。いずれも text・required=false）として追加する。全て AI 抽出可能（verbatim quote 付き）+ 人間検証の通常フローに乗り、不要な項目は S5 エディタで行削除できる
> - **エクスポート**: rob.csv の予約列 `outcome_id` にオーバーライド行のインスタンスキーを充填し、ma.csv の `rob_overall_judgement` はオーバーライド優先で解決する（design-r-export.md §4.2.2 / §4.3）。results_long / audit は entity_key 素通しで無変更
> - 設計の経緯・影響範囲・PR 分割は issue #109 の設計コメントと決定記録（2026-07-20）を参照
>
> **プロトコル改訂後の AI 再ドラフト（issue #197・2026-07-24 確定）**: S5 確定済み画面にプロトコル改訂の陳腐化バナー（現行スキーマ版の `protocol_version` が最新プロトコル版より古いときに表示）+ 「新しいプロトコルで AI に再ドラフトさせる」導線を追加した。**現行版（`SchemaFields` の項目）が 1 件以上あるときは draft-schema skill の実行結果をエディタへ直行させず、差分承認画面を経由する**（0 版のときは従来どおりエディタへ直行）。差分は現行版と AI 提案を field_name 一致で突き合わせ、追加 / 変更 / 削除候補 / 変更なしに分類する。**RoB テンプレート項目（`entity_level = rob_domain` または `section` が `risk_of_bias` で始まる項目）は draft-schema skill の system prompt が明示的に提案対象から除外している前提のため、差分（追加 / 変更 / 削除候補）には出さず常時保持する**（保護行と同名の AI 提案があっても捨てる）。ユーザーは追加 / 変更を承認（既定チェック済み）・削除候補を承認（既定は未チェック = 削除しない）してからエディタへ反映する。反映時の `created_by_type` は、**差分の選択が既定のまま（追加・変更を全承認かつ削除候補を全て非承認）なら `ai_draft`、1 つでも既定から変更していれば `user_edit`** として確定される（`isRedraftSelectionPristine` で判定）。field_id の継承は上記 `SchemaFields` 節の注記のとおり field_name 一致で行う
>
> **`protocol_version` の刻印方針**: 版の確定時は常に「その時点の最新プロトコル版」を刻む（親版の `protocol_version` を継承しない）。継承すると `SchemaVersions.protocol_version` が単調でなくなり、監査で「どのプロトコルの下で確定された版か」が読めなくなるため。現行版が古いプロトコルに基づく状態は、上記の陳腐化バナーで通知し、再ドラフト（差分承認を経由したエディタ反映）へ誘導する運用とする

---

## 4. 機能要件（画面と主要フロー）

### 4.1 画面一覧

| # | 画面 | 概要 |
| --- | --- | --- |
| S1 | Popup | プロジェクト選択・新規作成・メインビュー起動 |
| S2 | プロジェクト作成ウィザード | スプレッドシート + Drive フォルダ生成、tiab-review 引き継ぎ選択（※Q2） |
| S3 | 文献取り込み・グルーピング | Drive Picker（PDF 個別選択 + フォルダ選択で直下 PDF を一括取り込み）、テキスト層抽出とステータス表示、study 単位のグループ表示と統合 UI（§4.5: 登録番号検出の統合候補バナー・文書ロール編集）、tiab-review 採用リストの取り込み（§4.5・issue #68: study_label 自動生成 + DOI / PMID 転記）。画面に PDF の外部送信先（LLM API のみ）の説明を常時表示 |
| S4 | プロトコル入力 | 手入力 / md / docx（sr-query-builder S 系画面の UI を移植） |
| S5 | スキーマデザイン（UI 表記は「表のデザイン」） | AI ドラフト表示 → 表形式エディタで承認・編集。`extraction_instruction` を項目ごとに編集可。**相談用ドキュメント**（v0.34・issue #315）: 確定済み画面で版を選び、共同研究者と相談するための Google ドキュメントを Drive に作成する（owner のみ。毎回新規ファイル・共有設定は変更しない）。内容は項目一覧、項目別の詳細（許容値・複数選択の単独 / 自由記述の選択肢・引用の上限・抽出指示・例）、その版のパイロット run があれば項目別の判定内訳（採用 / 修正 / 棄却 / 未報告 / 未判定）と論文ごとの AI の値・根拠の引用・人の判定との差、項目の note にある RoB 2 / ROBINS-I / QUADAS-3 / QUIPS の事前設定。本人の `human_with_ai` の判定だけを使い、`Decisions.note`・`anchor_status`・`human_independent` の行は載せない。Drive の `text/html` → Google ドキュメント変換で作る（`drive.file` スコープのまま）。本文は UI の表示言語に関わらず日本語のみ。**前の版の内容に戻す**（v0.35・issue #318）: 確定済み画面で過去の版（最新版以外）を選び、最新版との差分を承認してから、その内容を新しい版として確定する（版の番号は巻き戻さない。`parent_version` = 戻し元）。**スキーマのファイル（JSON）**（v0.36・issue #316）: 確定済みの版を JSON でダウンロードし、別のプロジェクトで読み込む（版が無ければエディタへ直接、あれば最新版との差分を承認してから。field_name で突き合わせて既存の field_id を引き継ぐ。出所を改訂理由の初期値に残す） |
| S6 | パイロット抽出 | 2〜3 件の study で AI 抽出 → S8 と同じ検証 UI（修正・棄却時に任意の判定メモを入力・保存）→ 「表のデザインを改訂して再パイロット」導線。再パイロットの既定は過去のパイロットで使っていない study を優先する（v0.22・issue #266）。**対象項目チェックリスト**（既定 = 全選択。issue #80 §4.3） |
| S7 | 一括抽出 | 対象 study 選択、モデル選択、コスト概算表示、進捗バー、失敗リトライ（オフラインキュー tiab-review 準拠）。**対象項目チェックリスト**（既定 = 全選択。issue #80 §4.3） |
| S8 | 検証（中核画面） | §4.2 |
| S9 | ダッシュボード | study × section 単位の検証進捗マトリクス、anchor 失敗率、not_reported 率（複数の引用・分割した断片を持つセル〔issue #275・#294〕は、anchor 失敗率では引用 1 件ずつを数え、not_reported 率ではセルを 1 件と数える）、費用集計とプロジェクト予算設定 |
| S10 | エクスポート | 形式選択（study_wide / results_long / audit）、プレビュー、CSV 生成 + Drive 保存、usage.csv（全体 / run / 月の費用・使用量）、論文 Methods 記載例のコピー |
| S11 | Options / 設定 | API キー（Gemini / OpenRouter / OpenAI 互換 API / **Anthropic**〔issue #127 PR2〕/ **Azure OpenAI**〔PR3〕）、接続方式、OpenAI 互換 API の完全 URL + origin 権限要求 + JSON Schema 接続テスト（Azure OpenAI も同様にクエリ文字列付き完全 URL を入力）、既定モデル（プルダウン + その他で直接入力。**カスタムモデル一覧管理 UI は不採用〔v0.12〕** — OpenAI 互換 + ローカル LLM〔localhost〕+ 直接入力で実需をカバー。モデル一覧の自動取得〔PR4〕で補う）、reasoning effort の既定値（未設定可。PR5）、表示言語。**独自認証は投機実装しないの不採用宣言を Anthropic ネイティブ・Azure OpenAI に限って明示的に覆す〔v0.16・issue #127〕**: 両者はプロバイダごとに固定の認証方式を実装する実需（公開ユーザーが持っているキーの 2 大勢力）であり、投機実装ではない。引き続き不採用のまま維持するのは①利用者が自由にヘッダー名/値を追加する汎用の任意ヘッダー入力 UI、②カスタムモデル一覧の手動管理 UI（→ モデル一覧自動取得で代替） |
| S12 | 裁定画面（v0.11） | owner / adjudicator が、human annotator 2 名（reviewer_with_ai / reviewer_independent 等）の検証が揃った study について群構成の突き合わせ・セル単位の一致判定 / 個別裁定を行い `consensus` 行を確定（※Q4） |

### 4.2 検証画面（S8）の要件

- **検証の単位は study**: 画面上部のセレクタ・URL クエリ（`?study=`）・進捗チップはすべて study 単位
- **2 ペイン構成**: 左 = PDF.js ビューア（ページ送り、ズーム、テキスト検索）、右 = 抽出フォーム（section ごとにグループ化、entity タブで arm / outcome を切替）
- **複数文書ビューア（v0.10）**: 左ペイン上部に study 内の文書切替タブ（`document_role` バッジ + filename）。手動切替に加え、項目フォーカス / ハイライトジャンプ時は**対応 Evidence の出所文書（`Evidence.document_id`）へ自動で切り替えて**からハイライトへスクロールする。登録と論文の記載を突き合わせる selective reporting の確認が文書タブの往復でできることを狙う
- **双方向ジャンプ**: 項目フォーカス → 該当ハイライトへスクロール + 強調（必要なら文書切替を伴う）/ ハイライトクリック → 対応項目へフォーカス
- **判定操作**: `accept`（AI 値をそのまま確定）/ `edit`（値修正して確定）/ `reject`（AI 値棄却、手入力）/ `not_reported`。キーボードショートカット必須（tiab-review の判定 UI に準拠した操作感）
- **anchor_status = failed の項目**: quote 全文をフォーム側に表示し、「本文内を検索」ボタンで PDF.js のテキスト検索に quote を投入するフォールバック。加えて「AI で再特定」ボタン（relocate-quote skill。issue #94）を並べて出し、クリック 1 回で LLM に再特定させる。状態は 3 通り: 実行中（ボタン disabled + 「AI で再特定中…」表示）/ 成功（Evidence 追記済みの新行へ差し替わり、通常のハイライト UI へジャンプする。§3.2「quote の再特定」参照）/ not_found・失敗（「AI でも見つかりませんでした。本文内検索をお試しください」を案内し、従来の手動検索導線へ誘導。ボタンは再度有効に戻る）
- **複数の引用を持つセル（issue #275・#294）**: `max_quotes` を持つ項目と分割した断片のセルは、AI 値（前者はテーマ名の連結、後者は元の抽出値）の下に**引用の一覧**を出す（各行 = quote 全文 + 「ハイライトへ」。テーマ名は `max_quotes` を持つ項目だけに出す）。行をクリックするとその引用の出所文書へ切り替えてハイライトへスクロールし、PDF 上の各ハイライトをクリックすると対応セルへフォーカスする（双方向ジャンプを引用単位で行う）。アンカリングに失敗した引用は一覧に「本文内を検索」を添え、ハイライトは描かない。**判定はセル単位のまま**（`accept` / `edit` / `reject` / `not_reported` をセルに 1 回）。AI が拾えなかったテーマは人が `edit` で値に書き足し、根拠は note に書く。引用ごとの採否判定は持たないが、**引用の一覧は人が直せる**（次の 2 項）。独立入力モードでは従来どおり引用を一切出さない。S12 裁定画面の「根拠を表示」はセルの代表（先頭）の引用へ移動する（両レビュアーの引用の一覧と最終の根拠の選択は §4.6）
- **引用の一覧の編集（issue #307・v0.31）**: with_ai のレビュアーは、S8 でセルの引用の一覧を直せる。各引用に「削除」、複数選択の項目には選択肢の付け替え（セレクト）、複数引用の項目にはテーマの書き換え（入力欄）を出す。直した結果は `QuoteSets` へスナップショットとして保存する（§3.2）。一度直したセルは、引用が 1 件でも一覧形式で表示し、「AI の引用に戻す」を出す。**すべて外したセルは「引用はすべて外されています」と表示し、AI の引用もハイライトも出さない**（未編集と「空にした」を区別する）。カードの引用一覧・PDF 上のハイライト・「ハイライトへ」・出所文書への切替は、同じ有効な引用の一覧から作る。引用を直したセルでは、引用ごとの選択状態（強調中の引用・「他 n 箇所に一致」の位置）を破棄する。**引用の編集は判定ではない** — 値・判定の状態・`Decisions` は変わらず、判定の前でも後でもできる。AI の値（`accept` で確定する値）と AI の代表行は変わらない。人が直したセルには「AI で再特定」を出さない（再特定は `Evidence` へ追記する操作のため）。S6（パイロットの埋め込み検証）には編集 UI を出さない。独立入力モードは次項
- **PDF で文を選んで根拠に追加（issue #307・v0.32）**: PDF ビューアは canvas の上に pdf.js のテキスト層（透明な文字）を重ね、文字を選択できる（ハイライトのボタンはその上にあり、今までどおりクリックできる。スキャン PDF などテキストの無いページは選択できない）。S8 で文を選ぶと、ビューアの上に**追加バー**が出る: 選んだ文の抜粋、対象（フォーカス中のセル）、複数選択の項目なら選択肢のセレクト（必須）、複数引用の項目ならテーマの入力（任意）、節の入力（任意）、「追加」「取り消し」。追加すると、選んだ文を既存の照合（§5）に通して `anchor_status` と頁を決め、そのセルの有効な引用の一覧の末尾に `source = human` の引用として足して `QuoteSets` へ保存する（照合に失敗した文も保存はするが、ハイライトは出ない）。AI の引用が無いセル・AI が抽出しなかったセルにも足せる。追加できないのは、フォーカス中のセルが無い・値の入力中・そのセルが保存中・1,000 文字を超える・同じ文書の同じ文が既に一覧にある・複数選択で選択肢が未選択のとき。人が足した引用は一覧に「人が追加」と表示し、AI の引用と同じ仕組みでハイライトする。**独立入力モード**でも同じ操作ができ、**本人が足した引用だけ**を一覧とハイライトに出す（AI の引用・AI の値・再抽出の注記・「AI の引用に戻す」は出さない。盲検は維持する）。テキストだけのビューア（PDF を開けない文書）と S6 には追加の操作を出さない
- **複数選択の項目（issue #307）**: `multi_select` の項目は、AI が選んだ選択肢ごとの引用を**引用の一覧**に出す（各行 = 選択肢名 + quote 全文 + 「ハイライトへ」。複数の引用を持つセルと同じ一覧）。`edit` / `reject` の入力は**付け外し式のチップ**にする: チップは許容値の並び順、クリック・Space・数字キー `1`〜`9` で付け外し、Enter で確定する。単独選択肢（`exclusive_values`）を選ぶとほかがすべて外れ、通常の選択肢を選ぶと単独選択肢が外れる。自由記述付きの選択肢を選ぶと説明の入力欄が出る。1 件も選ばれていなければ確定できない（既定選択は置かない。独立入力モードでは AI の値で初期選択しない）。現在値に許容値外の要素があれば、外せるチップとして出す。`accept` は AI の値（正準の連結文字列）をそのまま確定する。**判定はセル単位のまま**で、選択肢ごとの採否判定は持たない。引用に節（`Evidence.section`）があれば引用文の下に出す
- **判定チップ**: 各項目の現在ステータスをチップ表示（tiab-review の文献カードチップと同トンマナ）
- **enum 項目の値入力は許容値から選ぶ（issue #254）**: `data_type = enum` かつ `allowed_values` を持つ項目は、`edit` / `reject` の入力欄を自由入力ではなく **S5 で設定済みの許容値チップ列**にする（クリックまたは数字キー `1`〜`9` で確定。既定選択は置かず、automation bias 対策の「1 操作必須」を維持）。許容値外の記述に出会ったときの退避口として末尾に「その他（自由入力）」を置き、従来と同じ自由入力へ落とす。**保存は許容値でブロックしない**が、確定値が許容値に無いセルには「許容値外」の情報提示（#65 の整合性チェック警告と同じ「判定操作を増やさない」パターン）と、スキーマを直す導線（`#/schema`。owner のみ）を出す。狙いは表記ゆれ（`low` / `Low` / `low risk` の混在）の抑止と、`extraction_instruction` に許容値を手書きする回避運用の解消（`allowed_values` は自動でプロンプトに載るため、手書きは同じ情報の二重掲載になる）。**許容値の追加・編集は判定画面から行わない** — 許容値の変更はスキーマの新 `schema_version` を切ることであり（§3.2 の追記型バージョン管理）、その場で足しても目の前のセル（旧版 `schema_version` に紐づく run / Evidence / Decisions）には反映されず、二重独立抽出の途中で選択肢集合が変わると annotator 間で見ていた候補が食い違い κ 一致度の比較可能性が崩れるため。独立入力モードでも許容値は表示する（許容値はスキーマ由来であり AI 出力ではない）
- **論文への質問パネル（v0.24・issue #264）**: 表示中の 1 study の本文とスキーマ定義だけを文脈に、LLM へ自由に質問できる（`ask-paper` skill）。回答の引用は既存のアンカリングで照合し、fuzzy 以上だけをクリックでハイライトできる。照合できない引用には警告を付ける。**回答を値へ反映するボタンは置かない**（値は人が PDF を確認して入力する）。reviewer_independent には出さない（盲検）。質問と回答の本文は残さず（`LLMApiLog` はメタデータのみ）、質問した study の以後の判定の `Decisions.note` に `[chat-assist]` を付けて開示する。S12 裁定画面にも同じパネルを置く
- **群構成の確定**: arm レベル項目の検証前に、AI ドラフト（Evidence の arm 名フィールド値 + entity_key）を初期値として arm 数・名称を確定する（名称編集・行追加・削除）。確定内容は `ArmStructures` へ新 version として追記し、未確定のうちは arm / outcome_result タブをディム表示。確定後の改訂も同 UI から可能（新 version の追記 = 監査証跡）
- **AI 未抽出インスタンスの追加**: 群構成が確定済みのとき、arm タブは `ArmStructures` の全 arm をセル化する。outcome_result タブには「アウトカムを追加」フォームを出し、アウトカムキー（既定は既存 `outcome_<n>` の次番号）と任意の時点を入力して、確定 arm 全体に outcome_result インスタンスを追加する。追加操作は `Decisions` のインスタンス宣言イベントとして追記し、追加直後から `AI 抽出なし（手入力のみ）` の空セル群を表示する
- **estimate 別 RoB 評価の追加（issue #109）**: rob_domain タブは base グループ（`rob:<domain_id>`）を先頭に、estimate 別オーバーライドグループを estimate ごとに表示する。「estimate 別の評価を追加」フォームで対象 estimate（= その study の outcome_result インスタンス）とドメインを選ぶと、当該ドメインの判定 + 根拠 + SQ セルを estimate スコープで宣言する（`Decisions` のインスタンス宣言イベント。AI 値・quote は存在しない手入力専用セル）。全 RoB ツール共通（§3.3 の注記）
- **flow 図（mermaid）のプレビュー（issue #109）**: 値が mermaid ソースの項目（QUADAS-3 テンプレートの `quadas3_flow_diagram`。予約 field_name 規約）はセルカードに描画プレビューを持つ（同梱 mermaid・`securityLevel: 'strict'`・構文エラー時はテキスト表示へフォールバック + `mermaid.parse` の保存前チェック〔警告のみ・保存はブロックしない〕）。同梱する mermaid はフロー図（flowchart）に必要な実装に絞り、他の図種や数式（`$$…$$`）を含むラベルは未対応として表示する。
- **戻る挙動**: 直近の判定履歴を戻れる（tiab-review の「直近 5 件履歴」仕様を項目単位に読み替えて移植）
- **保存**: 判定ごとに自分の annotator 行（`StudyData` / `ResultsData`）へ即時書き込み + `Decisions` へ追記。失敗時はオフラインキュー退避
  - **同一スプレッドシートへの判定・裁定書き込みは直列化する**: annotator 行（`StudyData` / `ResultsData`）の upsert はシート単位のロックを持たない read-modify-write（シートを読む → 既存の annotator 行を探す → 無ければ append）であるため、同じキー（`study_id` × `annotator`）への書き込みが同時に 2 本走ると、双方の読み取りが互いの追記を見落として重複行を生みうる。対策として、S6（パイロット埋め込み検証）・S8（本画面）・S12（裁定）の判定・裁定保存は `spreadsheetId` をキーにした排他区間で直列化する（同一シートへの書き込みだけを順番待ちさせ、別シートは互いに待たない）。**楽観ロックの期待値（保存直前に読む対象行の現在の `updated_at`）のストア読み取りも、この排他区間の内側で行う**必要がある — 排他の外で先に読んでしまうと、直列化で順番待ちしている間に先行操作がシート側の `updated_at` を進めてしまい、自分は古いトークンを握ったまま保存することになり、本来ぶつかっていないのに偽の競合が起きる
- **独立入力モード（v0.11・`annotator_type = human_independent`）**: `reviewer_independent` ロール向けに AI 出力を一切見せない入力モードをパネルに追加する。quote・ハイライト・「他 n 箇所に一致」・AI 値のプレフィル・anchor failed バナーは描画せず、PDF ビューア（ページ送り / ズーム / テキスト検索）とフィールドラベル + `extraction_instruction`（スキーマ由来のため表示可）のみを残す。操作は `入力`（値を直接入力 → `edit`）/ `not_reported` / `undo` の 3 種（`accept` / `reject` は AI 値が無いため出さない）。群構成・outcome_result インスタンスも AI ドラフトを見せず自分で確定する。対象一覧は `Evidence` 非依存（`Studies` × 最新確定スキーマ）とし、AI 抽出の実施状況自体も盲検対象として見せない（詳細は [docs/design-independent-dual-review.md](design-independent-dual-review.md) §5）

### 4.3 AI 抽出（extract-data skill）の要件

- 1 API 呼び出し = 1 study ×（スキーマ全項目 or section 単位分割 ※トークン量で判断。複数文書の連結で入力が肥大しやすいため、分割閾値は study の全文書合計トークンで評価する）
- **複数文書の入力（v0.10）**: study の全文書をロール付きの区切りで連結して渡す（例: `=== Document 2/3 [registration] NCT01234567.pdf ===`）。文書の並び順は role の固定順（article → registration → protocol → abstract → supplement → other）→ 取り込み順。`pdf_native` モードでは全文書の PDF を添付し、添付順 = document_index とする。**`text_only` run では `text_status = no_text_layer` の文書を連結から除外**し、除外があった旨を UI と run の記録に明示する（当該文書由来の根拠は得られない）。プロンプトには「複数文書は同一試験の報告である。値が文書間で矛盾する場合は本論文（article）を優先しつつ confidence を下げ、quote は実際に値を読み取った文書から取ること」を明示する
- 出力は構造化 JSON を強制: `{ field_id, entity_key, value, not_reported, quote, page, document_index, confidence }` の配列。**対応付けは `field_id` 基準**: プロンプトに各項目の `field_id` を明示し、応答にそのまま返させる。`field_name` は改名されうる CSV 列名のため、応答に含める場合も補助情報（可読性・自己チェック用）扱いとし、`Evidence` / `StudyData` / `ResultsData` への突合には使わない。応答内の `field_id` が当該 `schema_version` の `SchemaFields` に存在しない場合、その要素は破棄して `partial_failure` として記録する
- **`document_index`（v0.10）**: プロンプトに列挙した文書一覧の 1 始まり連番。クライアントが `document_id` へ解決して `Evidence.document_id` に記録し、quote アンカリングはその文書の extracted_text に対して行う（§5）。quote があるのに document_index が欠落・範囲外の要素は破棄して `partial_failure` として記録する（field_id 不明時と同じ扱い）。`not_reported = true` の要素は document_index 不要（全文書を見た上での「報告なし」判断のため）
- **quote は本文からの verbatim 抜き出しを必須化**し、「言い換え禁止・原文どおり・最大 300 文字」をプロンプトで明示（アンカリング成功率に直結）
- **複数の引用（issue #275・プロンプト版数 10）**: 応答要素に `theme`（文字列 | null）を加える。`max_quotes` を持つ項目はプロンプトの項目定義に `max_quotes: N` を載せ、「根拠となる原文の箇所が複数あるときは、同じ `field_id` × `entity_key` の要素を最大 N 件返し、各要素の `theme` にその箇所が支える内容の短い見出しを付け、`quote` はその箇所だけを verbatim で抜き出す」ことを指示する。それ以外の項目は従来どおり 1 要素で `theme = null`。**質的研究の引用形態（ブロック引用・本文埋め込み・単語レベル）の扱い、参加者の語りと著者の記述の区別、候補が複数あるときの選択基準はシステムプロンプトに書かない** — 利用者が項目の `extraction_instruction` に書く（書き方の例はヘルプ）。クライアント側の検証: `max_quotes` を持つ項目の要素を `field_id` × `entity_key` で束ね、(1) 報告ありの要素が 1 件でもあれば `not_reported = true` の要素は捨てる、(2) 出現順に先頭 N 件だけを残す（超過分は破棄件数に数えるが `partial_failure` にはしない）、(3) 値 = 各要素の `theme`（空なら `value`）を `; ` で連結した文字列を全要素に入れ、`quote_seq` = 1 始まりの出現順を振る。`max_quotes` を持たない項目では `theme` を無視する（従来の挙動を変えない）。`planRun` の出力トークン概算は `max_quotes` を持つ項目を N 要素ぶんで見積もる
- **複数選択（issue #307・プロンプト版数 12）**: `multi_select` の項目はプロンプトの項目定義に `multi_select: true`・`exclusive_values`・`free_text_values` を載せ、「当てはまる許容値 1 つにつき 1 要素を、同じ `field_id` × `entity_key` で返す。`value` は許容値 1 つだけ（連結しない）、`quote` はその値を支える箇所、自由記述付きの値は説明を `theme` に入れる。単独選択肢はその項目で唯一の要素にする。どれも報告が無ければ `not_reported = true` の要素を 1 つ返す」ことを指示する。クライアント側の検証は `field_id` × `entity_key` で束ね、(1) 報告あり（未報告でなく値がある）の要素が無ければ先頭の 1 要素だけを残す、(2) あれば報告ありでない要素は捨てる、(3) 各要素の値を許容値に照らして解釈する（完全一致 → `自由記述付きの選択肢: 説明` → 大文字小文字を無視した一致 → 許容値外。指示に反して 1 要素に連結してきた値も落とさず拾う）、(4) 先行する要素と選択肢がすべて重複する要素は破棄する（`duplicate_option`。破棄件数に数えるが `partial_failure` にはしない）、(5) 単独選択肢とそれ以外が併存したら単独選択肢を取り除き、単独選択肢どうしの併存は許容値の並びで先のものを残す（どちらも `confidence = low` を強制）、(6) 値 = 残った全選択肢の正準の連結文字列を全要素に入れ、`quote_seq` を許容値の並び順に振り、`quote_theme` に選択肢を入れる（選択肢が 1 つだけのセルでも `quote_seq = 1`）、(7) セル内の `confidence` は最も低い値にそろえる。`planRun` の出力トークン概算は、単独選択肢でない許容値の個数ぶんで見積もる
- **節の見出し（issue #307・プロンプト版数 12）**: 応答の全要素に `section`（文字列 | null）を加え、「quote がある節の見出しを原文どおりに。quote の直上の見出しを使い、quote が無い・見出しが分からないときは null」と指示する。`Evidence.section` に保存し、S8 の引用・`audit.csv` に出す。実データ抽出ベンチ（不眠 SR 10 本・gemini-3.8-flash・1 反復）で版数 9 と比べ、項目正確度 76.6% 対 75.5%（非劣化）、費用 0.079 対 0.072 USD/論文、応答時間 43.5 対 32.1 秒、引用のある要素の 98.8% で節が返った（2026-10-04。版数 10 の `theme` キーのぶんも差に含まれる）
- **崩れた応答要素の破棄（issue #275 の実 API 確認で発見。2026-09-30）**: 構造化出力でも、要素の文字列の中に以降の要素がエスケープされたまま飲み込まれる崩れが起きる（Gemini 3.5 Flash・ブロック引用を含む質的研究の論文で 3 回中 2 回）。`JSON.parse` は通るため、study レベルの `entity_key` を `-` に置き換える処理と欠けたキーの既定値で「未報告」として素通しし、run が警告なしで done になっていた。そこで、`entity_key` に `"` または改行を含む要素と、`value` / `quote` / `not_reported` の 3 キーがいずれも無い要素は `invalid_shape` として破棄し、`partial_failure`（S7 から再試行できる）にする。キーがあって値が `null` の要素（正当な未報告）は従来どおり通す
- クライアント側の検証で、entity_key の群の部分が正の整数でない要素（`arm:dcbt_i`、`outcome:isi|arm:dcbt_i` など）は破棄し、`partial_failure` として記録する（entity_level と整合しない entity_key と同じ扱い）。
- 値と quote が矛盾する場合の扱い（例: quote に数値がない）は `confidence=low` を強制するバリデーションをクライアント側に実装
- 出力は `Evidence` に追記し、`ai` annotator 行（`StudyData` / `ResultsData`）へ値を転記する（§3.2）
- **転記失敗時も run を中断扱いにしない**: `Evidence` への保存が済んだあとの `ai` annotator 行への転記（`StudyData` / `ResultsData` の upsert）は、失敗しても後続の完了行追記まで必ず到達させる。転記が失敗して LLM 呼び出しの成果（`Evidence`）まで「中断」扱いで不可視化するのは損失が大きすぎるため。`StudyData` / `ResultsData` の転記は独立に試行し（片方が失敗してももう片方は試みる）、1 件でも失敗があれば `ExtractionRuns` の完了行の status は `partial_failure` で確定する（AI 抽出自体〔`executeRun`〕が既に `partial_failure` ならそのまま）。転記失敗は `LLMApiLog` にも 1 行残す（`purpose='extract_study'`・`error` 列に「転記失敗: …」。このログ書き込み自体の失敗は無視し、完了行の成立を優先する）。S6 / S7 の UI は AI 抽出自体の失敗（study 単位の partial_failure）と混同させないよう、転記失敗専用の文言・トーストで案内する
- **実行の耐中断性**: 実行開始時に `ExtractionRuns` へ `status='running'` 行を先行追記してから `Evidence` を書き始め、完了時に確定 status の行を追記する（2 行プロトコル。§3.2 `ExtractionRuns`）。検証画面は `ExtractionRuns` に無い `run_id` の Evidence（プロトコル導入前の中断で生じた孤児）をエラーにせず未抽出扱いで除外し、S7 は中断 run の残り study をバナーで案内する（既定選択に含まれるため、そのまま実行 = 再開）
- **レート制限対策（429 対策・v0.10。2026-07-10）**: 一括抽出は study ごとにバッチを逐次実行するが、多数の study を連続処理すると LLM API の 1 分あたりリクエスト上限（RPM）に達して HTTP 429（Too Many Requests）が返る。対策は 2 本立て（`src/lib/llm/rateLimitPolicy.ts`）: **A. バッチ間スロットル**（`withThrottle`。RPM から最小リクエスト間隔 = `ceil(60000/RPM)` を導き、`executeRun` のバッチ連射を平準化）+ **B. リトライ強化**（`withRetry`。429/5xx を指数バックオフで再試行し、サーバ提示の `Retry-After` ヘッダ・本文 `RetryInfo.retryDelay` を尊重、バックオフ上限で頭打ち）。合成順は `withRetry(withThrottle(withLogging(provider)))` で、リトライの各再送もスロットル間隔で間引く。ポリシーは Options の **レート制限 tier**（無料枠 / Tier 1〜3 / カスタム RPM / 制限なし）で切り替える（tier ごとに RPM・試行回数・バックオフ上限が異なる。docs/ui-states.md §2「レート制限」）。BYOK ゆえアカウントの課金帯は拡張側から知り得ないため、既定は最も制約の強い無料枠に倒し、実測に合わせカスタムで上書きできるようにする
- **Sheets 書き込みの 429 対策（v0.10。2026-07-10）**: 一括抽出の並列実行（同時実行数 2 以上。上記のスループット対策）は LLM 側の RPM だけでなく、**Google Sheets API の書き込みクォータ（60 回/分/ユーザー。read と write は別バケット）**にも触れうる。原因は study ごとに `Evidence` を都度 `appendEvidence`（1 回の API リクエスト）していたため、並列化で短時間に集中すると 60/分を超えること。対策は 2 本立て: **A. Evidence 書き込みのバッチ化**（`executeRun.ts`: study ごとの即時書き込みをやめ、メモリバッファに貯めて `flushEveryNStudies` study ぶんたまるか全 study 完了時にまとめて `appendEvidence` する。フラッシュは直列化し二重フラッシュを防ぐ。フラッシュ失敗時は含まれる study を全部 `save_failed` として partial_failure に記録し、S7 の再試行で拾えるようにする〔握りつぶさない〕）+ **B. `googleFetch` の 429/503 リトライ**（`src/lib/google/types.ts`: Sheets/Drive 共通の fetch ラッパに 429・503 のみ対象の指数バックオフ + サーバ提示 `Retry-After` 尊重 + `maxDelayMs` 上限での再送を追加。400/401/403/404 等の入力・認可エラーは従来どおり即 throw）。中断された run の study はもともと「未抽出」に戻って再実行するモデル（2 行プロトコル）なので、per-study 保存をバッチ化しても耐中断性は後退しない。詳細は [docs/handoff-20260710-sheets-write-batching.md](handoff-20260710-sheets-write-batching.md)
  - **`flushEveryNStudies` の tier 連動（2026-07-10）**: 並列数・RPM が大きい tier ほど書き込みも集中しやすいため、`flushEveryNStudies` は `RateLimitPolicy` の一部として tier ごとに決め打ちする（`src/lib/llm/rateLimitPolicy.ts`）: 無料枠 = 5 / Tier 1 = 8 / Tier 2 = 12 / Tier 3 = 15 / 制限なし = 15 / カスタムのベース = 5。**カスタム tier で同時実行数（`maxConcurrency`）を指定した場合**は、並列数が書き込み集中の実ドライバであるため `flushEveryNStudies = clamp(round(maxConcurrency × 2), 5, 15)` で上書きする（`resolvePolicyForTier`。並列数未指定＝既定 1 のままなら 5 のまま）。`extractionService.ts` が executeRun へ渡す値の優先順は **明示注入（テスト用）> tier のポリシー値 > 既定値（`DEFAULT_FLUSH_EVERY_N_STUDIES` = 5）**
  - **1 フラッシュの行数キャップ（安全弁。2026-07-10）**: study 数だけを発火条件にすると、1 study あたりの抽出項目が多い場合にバッファが際限なく育みうる。そのため `executeRun.ts` の `maybeFlush` は「distinct study 数が `flushEveryNStudies` 以上」**または**「バッファの総行数が `maxRowsPerFlush`（既定 `DEFAULT_MAX_ROWS_PER_FLUSH` = 500）以上」のどちらかで発火する。これは発火トリガーであって 1 フラッシュを厳密に 500 行以下へ分割するものではない（1 study が 500 行を超えていてもその study 単位では割らない）。各 push のたびに条件を再評価するため、バッファは「キャップ + 直近 1 study ぶん」程度で頭打ちになる
- プロンプトは sr-query-builder と同様に **skills として管理**（`draft-schema` / `extract-data` / `relocate-quote`）し、プロンプト版数を `LLMApiLog` に残す
- **run 単位のフィールド選択（issue #80・案 A。2026-07-12）**: S6 / S7 の実行前画面に対象項目チェックリストを置き、**既定は全選択**。section（`SchemaField.section`）単位で折りたたみ + 全選択/全解除トグルを持ち、選択 0 件は実行不可（実行ボタン disabled + 理由表示）。選択サブセットは fields の絞り込みで実現し、`runExtraction` の `fields` 引数へ絞った項目を渡す（トークン / コスト概算 = `planRun` も同じ絞り込み fields を受けるため自動的に選択分だけになる）と同時に `ExtractionRuns.field_ids`（§3.2）へ記録する `fieldIds`（**全選択時は null**）を渡す。**S6 の埋め込み検証 UI（`runFields`）は絞り込まない** — 表のデザインの全項目のまま渡し、AI が対象にしなかった項目も人間が手動で `edit` / `not_reported` 判定できるようにする（ghost cell と同じ扱い）。S7 の study 一覧では、直近の完了 run がサブセットだった study の「抽出済み」バッジに「直近 run は n/m 項目」を添える（n = 直近 run の対象項目数、m = その run の schema_version の全項目数）。失敗 study の再試行（`run_type=single_study`）は**元 run と同じ field 選択を引き継ぐ**（現在のチェックリスト選択ではなく、実行直前に確定させた値を保持して使う）。選択状態は画面入場・対象再読込のたびに全選択へリセットする（storage への永続化はしない = 毎回の実行意図を明示させる設計）。S10 の未検証セル警告ダイアログには「サブセット抽出で意図的に未抽出のままの項目が含まれる可能性がある」旨の注意書きを追加する（分母・集計ロジックは不変更 = サブセット run で対象外にした項目も引き続き「未検証セル」として数える。除外はしない）

### 4.4 CSV エクスポート（S10）

シート構造（§3.2）をそのまま反映した 3 形式と、引用の一覧を出す `evidence_quotes.csv`。既定では確定 annotator（`consensus`、なければ唯一の human）の行を出力する。

| 形式 | 構造 | 用途 |
| --- | --- | --- |
| `study_wide.csv` | 1 行 = 1 study（`StudyData` の確定 annotator 行。study_label + study レベル項目列。複数選択の項目は、項目の列の直後に選択肢ごとの 1/0 列を足す — 下記） | Table 1 の下書き、Excel での目視確認 |
| `results_long.csv` | 1 行 = 1 結果セル（study_label, annotator, entity_key, field_name, value, unit, not_reported） | R でのメタ解析前処理（arm 別アウトカム・RoB）、柔軟性最優先 |
| `audit.csv` | `Evidence` + `Decisions` の結合（判定中心デノーマライズ型。行形式は下記） | 監査・投稿時の supplementary、抽出精度研究の素材 |
| `evidence_quotes.csv` | 1 行 = 1 引用（AI の引用 + 各 annotator が直した一覧。v0.31・issue #307。列と `is_final` の決め方は下記） | 根拠の表（文・頁・節）。投稿時の supplementary |

- 文字コードは UTF-8（BOM 付き、Excel 互換）
- 未検証セル（human 行の空セル）が残る場合は警告ダイアログ（「未検証の項目が n 件あります」）を出し、audit.csv には判定履歴の有無で明示
- **複数選択の項目の 1/0 列（issue #307）**: `study_wide.csv` では、複数選択の study レベル項目の列（保存値そのまま）の直後に、許容値の並び順で `<field_name>__<slug>` の列を足す（選ばれていれば `1`、いなければ `0`）。自由記述付きの選択肢は、その直後に説明の列 `<field_name>__<slug>_text` を足す。`slug` は選択肢を小文字にして英数字以外を `_` にまとめたもの（空になる選択肢は `opt<n>`）。列名はヘッダ全体で一意にし、衝突したら `_2`、`_3`… を付ける。**未検証のセルと `NR` のセルは、足した列をすべて空にする**。単独選択肢（`NA`・`unclear` など）が選ばれた論文は、ほかの選択肢の列が `0` になる（割合を出すときは集計側で除く）。許容値外の要素には列を作らない。`results_long.csv` と R セットは連結した値のまま出す（データ辞書には `multi_select` / `exclusive_values` / `free_text_values` の 3 列を足す）
- **`evidence_quotes.csv`（issue #307・v0.31）**: 列は `study_label` / `study_id` / `field_name` / `field_id` / `entity_key` / `annotator` / `annotator_type` / `source`（`ai` / `human`）/ `origin_annotator` / `theme` / `quote` / `page` / `section` / `document_id` / `document_filename` / `anchor_status` / `is_final`。行の集合は、(1) 各セルの AI の引用（`annotator = ai`。S8 が表示するのと同じ run のもの）と、(2) 各 annotator の最新スナップショットの引用（`empty`・`reset` は行を出さない）。**`is_final`**: study ごとに確定 annotator（既存の規則: `consensus`、なければ唯一の human）を決め、セル単位で、確定 annotator が `consensus` なら consensus のスナップショットの行、人ならその人のスナップショットの行（すべて外していれば TRUE の行は無い）を `TRUE` にする。その人がそのセルを直していない場合、`human_with_ai` なら AI の行を `TRUE` にし、`human_independent` なら TRUE の行は無い。確定 annotator を決められない study はすべて `FALSE`。並びは study → entity_key → 項目の順 → annotator（`ai` が先頭）→ 一覧の順。`audit.csv` は従来どおり「判定が見ていた AI の根拠」を出す形式のままで、人が直した引用は載せない
- **論文 Methods 記載例のコピー**: エクスポート画面に、本ツールを用いたデータ抽出を論文の Methods にどう記載するかのサンプル（英 / 日 × 単一レビュアー / 二重独立の 4 変種。PRISMA 2020 item 9 対応）をカード表示し、ワンクリックでコピーできるようにする。ツール版数・モデル・パイロット本数等はプロジェクトの実績値をプレースホルダに自動反映する。文案の正典は [docs/methods-boilerplate.md](methods-boilerplate.md)

#### `audit.csv` の行形式（v0.6 確定）

**粒度**: 1 行 = 1 判定イベント（`Decisions` の 1 行。undo 含む）。各判定行に「その判定が見ていた AI 根拠（`Evidence`）」を横持ちで添付する。判定が 1 件も存在しないセル（study × field × entity_key）は、代表 Evidence + 判定列空の**プレースホルダ 1 行**として出力する（= 未検証セルの明示）。

**列**:

| 列 | 由来 | 説明 |
| --- | --- | --- |
| study_label / study_id | `Studies` | |
| entity_key / field_id / field_name | 共通キー | field_name は `SchemaFields` から解決 |
| schema_version | `Decisions`（プレースホルダ行は Evidence の run。run 不明なら `.`） | |
| annotator / annotator_type | `Decisions` | 判定対象の annotator 行。プレースホルダ行は `.` |
| run_id / evidence_id / document_id / ai_value / ai_not_reported / quote / page / confidence / anchor_status / bbox_page / bbox_ymin / bbox_xmin / bbox_ymax / bbox_xmax | `Evidence` | document_id は quote の出所文書（v0.10）。bbox 列は pdf_native の box_2d 由来（§3.2 参照）。添付 Evidence がない判定では `.`（下記規則 2） |
| decision_seq | 導出 | セル × annotator 内で decided_at 昇順の 1 始まり連番（undo も数える）。プレースホルダ行は `.` |
| action / decision_value / decided_by / decided_at / note | `Decisions` | プレースホルダ行は `.` |
| quotes_json | `Evidence` | 2026-09 追加（issue #275。**末尾列**なので既存の列位置は変わらない）。添付 Evidence が複数の引用・分割した断片を持つセル（`quote_seq` 付き。断片の `theme` は null）のとき、束ねた全引用を `quote_seq` 昇順の JSON 配列 `[{"seq","theme","quote","page","document_id","anchor_status"}]` で出す。このとき run_id〜bbox 列には代表（先頭）の引用を出す。通常の 1 quote のセルは空文字、添付 Evidence がない行は `.` |
| section | `Evidence` | 2026-10 追加（issue #307。**末尾列**）。添付 Evidence の代表（先頭）の引用の節の見出し。節が無ければ空文字、添付 Evidence がない行は `.`。`quotes_json` の各要素にも `section` キーを足す |

**結合規則**:

1. **Evidence 添付**: 判定行には、同一セルの Evidence のうち「`run.schema_version` が `decision.schema_version` と一致する run」のものを添える。複数 run が該当する場合は `started_at` が最新の run を採用（`ExtractionRuns` を参照。run 不明の Evidence は候補外）
2. **Evidence 欠損は正常**: `human_independent` 行への判定（AI を見ない独立抽出）、AI 未抽出項目への手入力、一致する run がない場合は Evidence 列を空で出力する（エラー扱いしない）
3. **プレースホルダの代表 Evidence**: セルごとに「run の `started_at` が最新の Evidence」を代表とし、そのセルに判定が 0 件のときのみ 1 行出力する。**旧 run の未判定 Evidence は出力しない**（原本は `Evidence` タブに残るため、完全な生ログが必要な場合はシートを直接参照する）
4. **並び順**: study（`Studies` の作成順）→ entity_key → field_index → annotator → decided_at
5. **欠損表現**（R での下流処理を想定）: 結合の結果レコード自体が存在しない列ブロックは **`.`**（構造的欠損トークン。`NA` は実際の抽出値と衝突しうるため不採用）。レコードは存在するがセルが空（AI 出力の value / quote が null、note なし等）は**空文字のまま**とし、両者を区別する。R では `readr::read_csv(..., na = c("", "."))` で一括 NA 化でき、`.` の実値衝突が疑わしい場合も run_id / evidence_id（UUID 列）が `.` か否かでブロックの有無を機械判定できる

> **設計判断（v0.6）**: 検討した 3 案 — (A) セル・スナップショット型（1 行 = 1 セル × 1 annotator、最新判定の要約）/ (B) イベントログ型（Evidence と Decisions の縦積みユニオン）/ (C) 判定中心デノーマライズ型 — のうち C を採用。A は undo・複数判定の履歴が落ちて §6 の監査性と矛盾し、B は AI 値と判定の突合規則を利用者に委ねることになり精度研究の再現性を損なう。C は 1 行が「AI の主張 × 人間の判定」の自己完結ペアになり、3 用途（監査・supplementary・精度研究）を 1 形式で満たす。プレースホルダ行数はエクスポート警告の未検証件数と突合できる。

### 4.5 文献グルーピング（S3・v0.10）

複数報告文書を 1 study へ統合する UI とその意味論。§3.2「study と document の分離」のデータモデルに対応する。

- **自動生成**: 取り込みは常に 1 PDF = 1 study を自動生成する（`document_role = article` 既定、`study_label` は従来どおり AI 提案 or ファイル名由来）。取り込みフロー自体は所属先を尋ねない — 大量取り込みを 1 本ずつの選択で止めないため、グルーピングは取り込み後の操作に寄せる
- **重複取り込みの防止（issue #102）**: 取り込み開始時に既存 `Documents` と突き合わせ、重複 PDF の新規レコード発生を防ぐ（既存レコードの上書き・削除はしない = 追記型の原則を維持）。判定は 2 段階 — ①同一 Drive ファイル（`source_file_id` 一致）の再取り込みはスキップ ②ファイル ID は異なるが内容が同一（既存の凍結コピーの `md5Checksum` と一致。ローカル取り込みはブラウザ内で MD5 を計算）もスキップし、進捗行に理由を表示する。同一バッチ内の内容重複も 2 件目以降をスキップ。`Documents` にチェックサム列は追加せず、取り込み時に Drive API から都度取得する（`Documents` 行から参照される凍結コピーのみを突き合わせ対象にする = save 失敗で `documents/` に残った孤児コピーは対象外となり、再取り込みによる復旧経路〔※Q9〕を壊さない）。重複判定の API 失敗時は重複発生の防止を優先して取り込み全体を中断する（フェイルクローズ）
- **study 単位のグループ表示**: S3 一覧は study ごとにグループ化し、配下の文書に role バッジと text_status を表示。role・study_label・registration_id はインライン編集可
- **手動統合**: 複数 study をチェック →「同一試験としてまとめる」。統合ダイアログで統合後の `study_label` / `registration_id`（既定 = 統合元のうち最初に取り込まれた study の値）と各文書の role を確認・編集して確定
- **分離・所属変更**: study から文書を外して独立させる / 別の study へ移す操作も同画面から行う
- **文献除外（issue #181）**: 取り込み後に「この文献は使わない」と分かった study / document を、**理由を付けて抽出候補から除外する**（PDF 実体・`Documents` 行は削除せず残す = 監査証跡重視。統合の「非アクティブ化して残置」の延長）。S3 に (a) study 単位の除外（配下の全文書をまとめて除外）と (b) 文書行ごとの除外（1 study に複数文書があるとき一部だけ除外）の両方を持つ。データは `Documents.excluded` / `exclusion_reason` / `exclusion_note` / `excluded_at` の上書き（§3.2。`document_role` と同じその場上書き。追記型 `Decisions` とは別系統）。**理由は粒度で必須/任意を分ける** — study 単位はプリセット理由の選択が必須（丸ごと除外は追跡可能性が重要）、document 単位は理由・自由記述とも未入力で確定可（誤って別 PDF を添付した等の単純な取り違えも多いため）。**抽出候補からの除外**: 配下の全文書が除外済みになった study は S6 パイロット / S7 一括抽出の対象一覧から外れる（`buildExtractionCandidates` = 除外文書を除いた上で `buildStudySelection`。一部除外の study は残り文書で通常どおり対象）。検証 S8/S9・裁定 S12・エクスポート S10・S3 一覧は除外済みも見せる（`resolveActiveStudies` / `buildStudySelection` は無変更）。**取り消し**: 「除外を解除」で `excluded` を `false` へ戻す（直近の理由・日時は列に残す。多重イベントを追う `Decisions` 相当ログは持たない = MVP scope）。**S3 の表示**: 除外済みの文書は study グループ内の折りたたみセクション（既定折りたたみ）に理由込みで表示し、通常の一覧を圧迫しない（理由未入力の文書はその旨を表示）
- **試験登録番号の自動検出**: 取り込み時に extracted_texts から登録番号を正規表現で検出（NCT / ISRCTN / UMIN / jRCT / JPRN / ChiCTR / EudraCT / ACTRN 等の主要レジストリ）し、`Studies.registration_id` の初期値に設定する。同一番号を持つアクティブ study が複数あるときは S3 上部に**統合候補バナー**を表示し、ワンクリックで統合ダイアログへ、または「無視」できる。**自動統合はしない** — 本文が他試験の登録番号を引用しているだけの誤検出は人間にしか弾けない（automation bias 対策と同じ「AI は提案、人間が確定」の思想）。無視した候補ペアは `chrome.storage.local` に記録して再提案を抑止する（シートには書かない）
- **統合・分離の意味論（重要）**: 文書集合が変化した study は**常に新 study_id で作り直す**（`Studies` へ新行追記 + `Documents.study_id` 付け替え。§3.2）。分離・所属変更では「外された側の残り」「移動先」も文書集合が変わるため同様に新 study_id となる。対象 study に抽出済みデータ（完了 run / 判定）がある場合は、確認ダイアログで「統合後この試験は未抽出に戻る（過去の判定履歴は `Decisions` に残る）」ことを明示して続行 / 中止を選ばせる。新 study はどの `ExtractionRuns` 完了行にも載っていないため S7 の既定選択（未抽出の全件）に自然に含まれ、**再抽出がそのまま復旧手段**になる。旧 study 宛のデータ行は書き換えず監査用に残置する（追記型の原則。audit.csv には非アクティブ study の行は出力しない）
- **tiab-review 採用リストの取り込み（issue #68・※Q2）**: S3 に「tiab-review から採用リストを読み込む」導線を持つ。tiab-review のスプレッドシート（URL / ID 指定）の `References` / `Decisions` タブを Sheets API で直読みし（同一 Google アカウント・追加スコープ不要。列位置はヘッダ行の列名から解決）、**最終判定 include** の Reference から `study_label`（「著者 (year)」）を自動生成して既存 study へ反映し、DOI / PMID を `Documents.pmid / doi` へ自動転記する（§3.2 の「tiab-review 引き継ぎ時は自動転記」）。include 抽出は fulltext 相の判定があれば fulltext 相の OR 合議（誰か 1 人でも include。`llm:` 判定は tiab の `Config.fulltext_ai_active_round` の採用ラウンドのみ集計）、fulltext 相の判定が無いシートは TiAb 相の OR 合議（`llm:` 判定は集計しない）。取り込んだ PDF との突き合わせは (1) `fulltext_url` の Drive ファイル ID = `Documents.source_file_id`（fulltext フォルダから取り込んだ場合に一致） (2) ファイル名の `[ref_id 先頭 8 桁]` タグ（tiab-review の fulltext キャッシュ命名） (3) DOI / PMID 一致、の 3 規則。**study 行の新規追記はしない** — アクティブ study（= `Documents` から参照される study。§3.2）の規約上、文書を持たない study 行は一覧・集計に現れないため、PDF 未取り込みの include は「PDF 未取り込み」として件数と一覧で示し、PDF 取り込み後の再実行で反映する（取り込みは冪等。反映済みの文献は「適用済み」になる）。実行はプレビュー（include 件数・反映内容の一覧）→ ユーザー確定の 2 段階。**S1 引き継ぎ導線（2026-07-19 追加）**: S1 プロジェクト選択ページに「tiab-review から引き継いで作成」を持つ。tiab シートを Picker で選択（= drive.file 付与。tiab-review は別 OAuth クライアント作成のため所有者本人でも Picker 許可が必要）→ References / Decisions を直読みして include を検証 → プロジェクト自動作成（タイトル既定 = シート名、編集可）→ S3 の引き継ぎパネルが include の `fulltext_url` から Drive ファイル ID を列挙し、ファイル許可モード Picker（reviewer オンボーディングと同じ全選択方式）経由で一括取り込み → 本項の反映プレビューを自動実行する（確定は従来どおり手動。ドラフト時点の残る手動操作 = Picker 2 回 + 確定 1 クリック）

> **実装の段階分割（案）**: (1) データモデル + S3 グルーピング UI + 登録番号検出（抽出以下は 1 文書 study のままでも動く）→ (2) 抽出の study 単位化（複数文書連結 + document_index + Evidence 拡張）→ (3) 検証の複数文書ビューア + ダッシュボード / エクスポートの study 単位化。ただしキー改名（document_id → study_id）は全層を貫くため、(1) の時点でリポジトリ層の改名を一括で済ませる。

### 4.6 裁定画面（S12・v0.11。独立二重レビューのモード③）

owner / adjudicator が human annotator 間の不一致を裁定し、`consensus` 行を確定する画面。詳細設計は [docs/design-independent-dual-review.md](design-independent-dual-review.md) を参照。

- **対象と単位**: study 単位。human annotator がちょうど 2 名（`reviewer_with_ai` / `reviewer_independent` / owner の組み合わせ）いる study は自動でペアが確定する。**3 名以上の study はペア選択方式で対応する**（2026-07-13・issue #63。裁定者が一覧のセレクトで 2 名の組を選ぶ。選択はセッション内のみ保持）。annotator の人数は `Reviewers` タブの登録数ではなく、その study に実際に判定行を残した email を実データ（`StudyData` / `ResultsData` / `Decisions`）で数える。**担当セット（v0.25・issue #263）を使うプロジェクトでは、担当者がちょうど 2 名のグループに属する study はその 2 名を担当ペアとして固定する**（3 人目の判定があっても担当ペアで ready、片方が未入力なら waiting。担当外の人の判定は裁定と一致率 / κ から除外して警告する）。calibration・未割当・担当者が 2 名でないグループの study は従来どおり実データから推定する。calibration セットの一致度は全ペアについて別に出す。両者の検証が 100% 完了した study のみ裁定を開始でき、未完了 study は完了状況（n / m）のみを見せて内容は隠す（盲検の継続）
- **群構成の突き合わせ**: 両者の最新 `ArmStructures` を「A の各群に対応する B の群」のマッピングテーブルで対応づける。既定マッピングは**名称一致（trim）→ 位置対応 → 残り物同士**の順で自動対応し、裁定者はセレクトで手動変更できる（2026-07-13・issue #63 で v1 の「`arm:1` ↔ `arm:1` 位置対応固定」を解消）。確定時に `ArmStructures` へ `annotator='consensus'` の版として追記し、**マッピング辞書は同タブの note へ `arm_mapping:{...}` 形式で直列化して永続化**する（再入場時に復元。辞書の無い旧データは既定マッピングへフォールバック）。`rob_domain` と study レベルは群構成に依存しないため未確定でも裁定可（既存の arm 依存判定と同じ規約）
- **セル突き合わせ**: `StudyData` / `ResultsData` の owner 行 vs reviewer 行の**現在値**を entity_key の和集合で突き合わせる。一致判定は trim 後の完全文字列一致（数値表記ゆれの同一視は v1 では行わない）。`schema_version` が両者で異なるセルは警告バッジ付きで不一致側に列挙
- **裁定操作**: 一致セルは「一致セルを一括採用」で 1 操作確定。不一致セルは A を採用 / B を採用 / 第 3 の値を入力 / `not_reported` / スキップ（consensus セルを作らない）から選ぶ
- **複数選択の項目（issue #307）**: 一致判定は、両者の値を正準形（許容値の並び順）にそろえてから行う。「第 3 の値を入力」は S8 と同じ付け外し式のチップで、consensus 行と `Decisions` へは正準形で書く
- **最終の根拠の選択（issue #307・v0.33）**: 裁定中のセルごとに、レビュアー A・B の**有効な引用**（§3.2 `QuoteSets` の解決規則。with_ai の人は未編集なら AI の引用、independent の人は本人が足した引用だけ）を並べる。同じ引用（同じ `quote_id`、または同じ文書の同じ文）は 1 行にまとめ、誰の一覧にあるか（A / B / A・B）を示す。B の引用は、セル突き合わせと同じ群のマッピングで `entity_key` を読み替えてからセルに結び付ける。裁定者は各行のチェックで「最終の根拠に採用する / 外す」を選び、「PDF から追加」でそのセルを対象にしてから PDF で文を選ぶと、裁定者自身の引用を足せる（追加バーの規則は S8 と同じ）。結果は `QuoteSets` に `annotator = consensus` のスナップショットとして保存する（採用した引用は元の `quote_id` を保ち、`origin_annotator` に持ち主を入れる。A・B 両方が持つ引用は A）。最初の操作までは consensus のスナップショットを作らない（A・B の引用を自動では採用しない）。すべて外した場合は「最終の根拠 0 件」（`kind = empty`）として、未選択と区別する。**値の裁定とは独立** — 値が未裁定でも裁定済みでも操作でき、`Decisions`・consensus 行は変わらない。A・B のスナップショットは書き換えない。各引用の「ハイライトへ」は、出所文書へ切り替えて一時的にハイライトする（論文への質問パネルの引用と同じ仕組み）。引用を見せるのは、既存の規則で裁定を開始できる study だけ（一覧画面には出さない）
- **書き込み**: consensus 行の upsert（`StudyData` / `ResultsData`。`annotator='consensus'` / `annotator_type='consensus'`）+ `Decisions` 追記（`decided_by` = 裁定者 email、`annotator='consensus'`。「一括採用」= `accept`、「A・B のどちらか採用・第 3 の値」= `edit`、「not_reported 裁定」= `not_reported`、取り消し = `undo`）。エクスポートは変更不要（`selectFinalAnnotator` が consensus を優先する既存実装のまま有効）
- **v1 の簡略化（当初挙げた 5 点は 2026-07-13 時点で全て解消済み）**: ① PDF ペインの Evidence ハイライト + セル一覧の「根拠を表示」ボタン + 各レビュアーの `Decisions.note` 表示（2026-07-12・issue #63）② 裁定の書き込み失敗時のオフラインキュー退避（同上。検証側と共有する 'decisions' キュー）③ 一致率・**Cohen's κ 統計**（2026-07-12・issue #66。`#/adjudicate` 一覧のオンデマンド計算カード + 不一致一覧 + CSV 2 種の保存。対象はちょうど 2 名の study のみで、3 名以上は κ がペア統計のため除外）④ arm の並べ替えマッピング（2026-07-13・issue #63。2026-07-18・issue #117 で残エッジ 4 件も修正）⑤ 3 人以上の reviewer 対応（同 issue #63。ペア選択方式）。詳細は [docs/design-independent-dual-review.md](design-independent-dual-review.md) §13
- **実機確認**: 2 アカウント（owner + reviewer）での共有 → 検証（with_ai / independent 両モード）→ arm マッピング → 裁定 → エクスポート（consensus 優先）の通し確認は **2026-07-19 に完了**（全項目問題なし。issue #62 の通し成立）。3 アカウント目を使ったペア選択（3 人以上の reviewer）の実機確認のみ未実施（[docs/manual-testing.md](manual-testing.md) §5-6-2 / §5-6-3 参照）

---

## 5. quote アンカリング（ハイライト位置決定）方式

本拡張の技術的な中核。LLM が返した verbatim quote を PDF.js テキスト層上の位置に対応付ける。**アンカリングの対象は quote の出所文書 1 本**（`Evidence.document_id` の extracted_text / テキスト層。v0.10）であり、study 内の他文書は探索しない。`page` ヒントも当該文書内のページ番号。

1. **正規化**: quote と各ページのテキスト層の双方に共通正規化を適用（空白圧縮、行末ハイフネーション結合 `exam-\nple → example`、リガチャ展開 `ﬁ → fi`、全角/半角統一、Unicode NFKC）。和文対応（issue #95 層 1）として、波ダッシュ U+301C を `~` へ折り畳み（全角チルダ U+FF5E は NFKC が畳む）、和文文字（漢字・かな・CJK 記号）に隣接する空白は行折り返し由来のノイズとして空白ごと除去する（和文は語間空白を持たないため。英文のみのテキストは従来どおり）
2. **段階的マッチング**:
   - `exact`: ai_page ± 1 ページ内で正規化後の完全一致
   - `normalized`: 全ページで正規化後の完全一致
   - `fuzzy`: スライディングウィンドウ + 編集距離（閾値: quote 長の 15% 以内）で最良一致
   - 全体が `failed` かつ `quote_seq` が空の通常抽出だけ、**断片照合（issue #294）**を試す（quote なし・テキスト層なし・既存の複数引用は対象外）。PDF の行の折り返しの改行は、正規化の空白圧縮で引用全体の照合の段階で吸収される。同じ応答に同じセルの通常項目が複数あるときは、セルの代表値と引用が同じ応答に属するように、最後の 1 件だけを断片照合の対象にする。
     - 生の quote を `/\r\n|\n|\r|\.{3,}|…/` で分割し、各断片を trim して空を捨てる。1 個以下なら分割しない。
     - 左から右へ貪欲に、直前グループ + 半角スペース 1 個 + 次の断片を正規化し、いずれかの正規化済みページに `includes` で含まれる場合だけ結合する（fuzzy は使わない）。長短を問わず同じ規則で、結合しない断片は次のグループを開始する。保存する quote はメンバーを半角スペース 1 個でつないだ文字列。
     - 結合後が 1 グループ、または正規化後 8 文字未満のグループが残る場合は分割しない。
     - 各グループを既存の exact → normalized → fuzzy で照合し、**全グループ成功のときだけ採用**する。同じ文書内でページをまたいでよい。元の出現順に `quote_seq` を付け、照合ページと実際の `anchor_status` を持つ Evidence 行として保存する（§3.2）。プロンプトとその版数は変えない。
   - `failed`: 全体も断片照合も不成立なら従来どおり元の引用の 1 行（`quote_seq` 空）を保存する。ハイライトなし、S8 のフォールバック UI・「AI で再特定」の対象。再特定・askPaper の照合経路には断片照合を加えない。
3. **複数一致時**: ai_page に最も近い出現を採用し、UI に「他 n 箇所に一致」を表示して切替可能に
4. **ハイライト描画**: マッチした文字範囲をテキスト層の span 座標に写像し、CSS オーバーレイで描画（検証済み = 緑系 / 未検証 = 黄系 / low confidence = 橙系）。塗りは `mix-blend-mode: multiply` で下地の文字と合成し、濃さに関わらず文字が読めるようにする（枠は通常合成のまま残し、暗地 = 反転表ヘッダ等の上でも枠が視認できるようにする）。**選択中セルのハイライト = 青（塗りのみ）**、**検索ヒット = 青（塗り）+ 破線枠**で区別する。選択中に実線枠は持たない — ハイライトは行ごとの矩形に分割して描画されるため、矩形ごとの枠が引用文の文字を横切る線として重なり読みづらくなる（2026-07-25 に実機のスクリーンショットで確認し撤去）。抽出テキスト表示（S8 の text モード）の根拠マークも「選択中 = 青」に合わせる（2026-07-10 issue #31 で確定）
5. アンカリング結果（`anchor_status`）は精度改善のための計測対象とし、S9 ダッシュボードで失敗率を可視化

> **`failed` の再特定（relocate-quote skill。issue #94）**: `anchor_status = failed` の Evidence は、検証画面の「AI で再特定」ボタンから LLM に quote を再特定させられる（§3.2「quote の再特定」）。LLM の応答 quote は、ここで述べた段階的マッチング（1〜3）にそのまま通して再アンカリングし、`fuzzy` 以上で成功したときだけ新しい Evidence 行として採用する（LLM の返答を無検証で信用しない）。再アンカリングは出所文書の全ページに対して行う（プロンプトへ渡す文書テキストはトークン節約のため元 page ヒント周辺に絞るが、検証はそれとは独立に文書全体で行う）。

> **リスク（Q3 確定）**: LLM が PDF を直接読む場合（`input_mode = pdf_native`）、LLM の内部テキスト認識と PDF.js テキスト層が不一致になりうる（表の読み順、2 段組みの結合順）。**入力方式の既定選択は text_status で自動判定する**（`no_text_layer` → `pdf_native` = ページ画像添付、それ以外 → `text_only`）。born-digital PDF を「画像入力 vs テキスト入力の比較検証目的」で手動トグルする機能は実装しない（研究上の計測ニーズは `experiments/` のベンチに委ねる。ここまでは 2026-07-12 時点の確定を維持）。**2026-07-21〜2026-07-29（issue #176）**: 一時、born-digital 文書にもページ画像を「本文に追加して」併用添付できる高精度読み取りモードを実務上の救済として追加したが、実 gold ベンチで効果が誤差範囲だったため不採用と決定し実装ごと撤去した（v0.16 changelog 参照）。born-digital での抽出精度そのものの比較実験（研究目的）は引き続き `experiments/` のベンチに委ねる。

> **テキスト層なし PDF（`text_status = no_text_layer` ※Q7 改訂）**: アンカリングの対象外（`anchor_status = null`）。抽出は `pdf_native` モードで可能で、bbox（box_2d）を返せるモデル（Gemini 系）の run では、**その文書を出所とする Evidence** に AI 推定の座標ハイライト（§3.2 の bbox 列）を表示する。機械検証はできないため、quote 全文表示・本文照合と必ず併用する。bbox が無い場合（非対応モデルの run・壊れた box 等）は quote 全文 + ページヒントのみで検証する（PDF.js のテキスト検索フォールバックは使えない点を UI に明示）。study 内の他文書がテキスト層を持つ場合、そちらを出所とする Evidence は通常どおりアンカリングされてハイライトされる。

---

## 6. 非機能要件

- **プライバシー**: 論文本文はユーザーの Drive と LLM API の間でのみ流通。開発者サーバーは存在しない。README にデータフロー図を明記（Chrome Web Store 審査対応も兼ねる）
- **監査性**: すべての AI 出力・人間判定・スキーマ改訂が Sheets + Drive 上に残り、`audit.csv` で一括出力可能
- **性能**: 100 studies（文書 100〜300 本）× 200 fields × arm 展開 ≈ 40,000 行を想定（二重抽出時は annotator 数ぶん倍加）。Sheets への書き込みは batchUpdate、読み出しはタブ単位キャッシュ。検証画面の描画は study 単位読み込み（PDF は文書切替時に遅延読込）
- **オフライン耐性**: 判定保存失敗時のキュー退避 + 再送（tiab-review の実装を共通ライブラリ化して流用）
- **多言語**: UI は日本語先行、en は P1。抽出対象論文は英語を主想定（プロンプトは英語論文前提で設計し、日本語論文対応は P2）
- **ライセンス・資金**: MIT。README に KAKENHI 25K13585 の funding 表記（tiab-review と同形式）

---

## 7. リリース計画

> **リリース状況**: MVP は **2026-07-12 に Chrome ウェブストアで v0.1.0 として一般公開済み**（[掲載ページ](https://chromewebstore.google.com/detail/sr-data-extraction-plugin/ibpbkgffgkmdmflamhadbcfjgfljjgip)）。P1 は主要項目（独立二重レビュー・OpenRouter・RoB テンプレート）を前倒し実装済み。

| フェーズ | 含むもの |
| --- | --- |
| **MVP**（v0.1.0 公開済み） | 単独プロジェクト作成、PDF 取り込み（テキスト層あり + 画像のみ PDF。後者は `pdf_native` 抽出・ハイライトなし ※Q7）、**複数報告文書の study 統合（v0.10・§4.5）**、プロトコル入力、AI スキーマドラフト + 編集、パイロット → 本抽出（study 単位）、単一レビュアー検証 UI（ハイライト付き・文書切替）、long / wide / audit CSV、Gemini / OpenRouter / 利用者指定 OpenAI 互換 API（BYOK） |
| **P1** | 二重独立抽出 + 不一致解決画面（tiab-review「担当セット」の思想を移植 ※Q4。**2026-07-11 に実装済み** — `Reviewers` タブ・ロールモデル・S8 独立入力モード・S12 裁定画面。§4.6 / [docs/design-independent-dual-review.md](design-independent-dual-review.md) 参照。一致率・κ レポート〔issue #66〕・arm 並べ替えマッピング・3 人以上のペア選択〔issue #63〕まで実装済み。2 アカウントでの実機通し確認は 2026-07-19 に完了）、tiab-review プロジェクト引き継ぎ、OpenRouter カスタムモデルの管理 UI（プロバイダ実装 + モデルセレクタは 2026-07-04 に MVP へ前倒し済み）、RoB テンプレートスキーマ（2026-07-07 に MVP へ前倒し済み ※v0.9）、UI 英語化 |
| **P2** | RevMan / メタ解析パッケージ直結形式、PMC OA XML 取り込み（アンカリング精度向上）、日本語論文、表の画像認識抽出 |

---

## 8. 検証・評価計画（研究としての位置づけ）

- tiab-review の LLM ベンチマーク運用（`experiments/` 配下、採用基準の事前設定、固定バージョン ID 採用）を踏襲し、**抽出精度ベンチマーク**を実施してから既定モデルを確定する
- 評価指標（案）: 項目レベル正確度（人間ゴールドスタンダード比）、not_reported 判定の感度 / 特異度、quote アンカリング成功率、検証所要時間（AI 支援あり vs なし）
- ベンチマーク用データセットは進行中の LLM 評価ベンチマーク構築と接続可能（既存の抽出済み SR データを再利用）

---

## 9. リスクと対応

| リスク | 対応 |
| --- | --- |
| quote アンカリング失敗率が高い | §5 の段階的マッチング + フォールバック検索 UI + パイロットでの入力方式比較 |
| 表内数値の抽出精度が低い | パイロットで表由来項目の精度を分離計測。低ければ「表由来項目は必ず人間入力」の運用ガイドを UI に組み込み |
| AI 値の鵜呑み（automation bias） | human 行は空セル（未検証）から開始し、accept にも必ず 1 操作を要求（`Decisions` に記録）。未検証セル残存時のエクスポート警告 |
| 取り込む PDF の著作権 | 学術研究目的のデータ抽出は著作権法上の権利制限規定（30 条の 4 等）の範囲内であり適法との整理（確認 UI・記録列・注意書きは持たない）。拡張側で PDF を外部送信するのは LLM API のみである旨を UI と README に明示 |
| Sheets 行数・レート制限 | batchUpdate、指数バックオフ、レート制限 tier + スロットル + 429 リトライ（2026-07-10）。**40,000 行規模の負荷試験は実施済み（2026-07-12・ローカル実測）**: CSV エクスポートは audit.csv が最大（51,600 行=約 0.8s / 103,200 行=約 1.6s。study_wide / results_long は一瞬）、cellState 畳み込みは 103,200 判定=約 66ms で、いずれも実用域（MVP バー「数秒以内」クリア）。ただし ai 行転記（`upsertStudyData/ResultsDataRows`）の appendRows にチャンク制御が無く、全 study 一括抽出で最大 ~40k 行を 1 リクエストに詰めうる非対称性を発見 → issue #69（Evidence 側の flush/上限パターンを横展開して対処） |

---

## 10. 未決定事項（レビュー済み）

> v0.2 で暫定確定に格上げ → v0.3 でユーザーレビューを反映して確定。Q8 の閾値のみベンチマーク設計時に最終確定する。

| # | 論点 | 決定 |
| --- | --- | --- |
| Q1 | プロダクト名 | **確定: `sr-data-extraction-plugin`** |
| Q2 | tiab-review プロジェクトとの連携 | **確定（v0.12・2026-07-12）: 「読むほう」= tiab-review の Sheet を直読みする**（同一 Google アカウント・Sheets API・追加スコープ不要）。最終判定 `include` の `Reference`（title / authors / year / doi / pmid）を study として生成し、study_label を「著者 (year)」で自動付与・DOI / PMID を識別子化。fulltext フォルダから取り込んだ PDF と DOI / PMID で突き合わせて紐付ける（study_label 自動化 = 旧 §4 提案6 も同時充足）。設計・実装は issue #68。スプレッドシートを統合する (a)/(b) 案は不採用（独立性の維持とタブ増加による読み出しコスト増の回避） |
| Q3 | LLM への入力方式 | (a) PDF を直接送信（表・レイアウト理解に強い）(b) 抽出テキストのみ（アンカリング一致率に強い）。**確定（v0.12・2026-07-12）: 両対応を実装済み。入力方式の既定選択は text_status で自動判定する**（`no_text_layer` → `pdf_native` = ページ画像添付、それ以外 → `text_only`）。実装は planRun / executeRun / extractData v3・bbox 座標ハイライトまで含む（§5・[docs/handoff-scanned-pdf-native-highlight.md](handoff-scanned-pdf-native-highlight.md)）。born-digital を**比較実験目的**で画像入力へ回す手動トグルは実装しない（研究上の計測ニーズは `experiments/` のベンチに委ねる）。**2026-07-21〜2026-07-29（issue #176）**: text_only の表・図レイアウト構造欠落への実務上の救済として高精度読み取りモードを一時実装したが、実 gold ベンチで効果が誤差範囲（表由来 +0.1pp・全体 +0.2pp）だったため不採用と決定し撤去した（2026-07-29・v0.16 changelog 参照） |
| Q4 | 二重抽出を MVP に含めるか | Cochrane 的には二重が原則だが、本拡張の設計思想は「AI 第一抽出者 + 人間検証者」。**確定: 二重独立 + adjudication。tiab-review-plugin と同じく、AI / AI を見たヒト / AI なしのヒトを別レビュアー（annotator）扱いにして不一致解消ができるようにする**（v0.4 で §3.2 を annotator 軸に再設計して反映済み。**MVP はデータ構造のみ対応**（`human_independent` / `consensus` の enum・行構造）。**独立抽出の UI・運用と adjudication 画面は P1**）。**2026-07-11 追記（v0.11）: 実装済み** — `Reviewers` タブ・ロール解決・S8 独立入力モード・S12 裁定画面（§3.2・§4.2・§4.6・[docs/design-independent-dual-review.md](design-independent-dual-review.md)）。**2026-07-12〜07-13 追記**: 一致率・κ レポート（issue #66）・arm 並べ替えマッピング・3 人以上のペア選択・裁定書き込みのオフラインキュー退避（issue #63）まで実装済み。**2026-07-19 追記: 2 アカウントでの実機通し確認は完了**（3 アカウント目のペア選択のみ未実施） |
| Q5 | entity_level の粒度 | study のみ / +arm / +outcome_result。**確定: 3 レベルすべて MVP に含める**（メタ解析入力を出せないと実用にならないため） |
| Q6 | エクスポート / データ保持の形 | **確定: study レベルの Table 1 的内容は wide（`StudyData` → study_wide.csv）、arm 別のアウトカム・RoB は long（`ResultsData` → results_long.csv）でシートを分けて保持する。完全 wide の列サフィックス展開は後のメタ解析での取り回しが大変になるため採らない**（v0.4 で §3.2 / §4.4 に反映済み） |
| Q7 | スキャン PDF（OCR） | **確定（2026-07-11 改訂）: 対応する。画像のみ PDF も `pdf_native` モード（ページ画像を LLM へ送信）で抽出対象にする**。テキスト層がないため quote アンカリングは不可だが、**bbox（box_2d）を返せるモデル（Gemini 系）の run では AI 推定の座標ハイライトを表示する**（機械検証不能のため quote 全文表示・本文照合と必ず併用 = §5。壊れた box は座標なしへフォールバック。回転ページの bbox は実験的扱い〔grounding 精度未確定〕）。PoC・追試の証跡は docs/handoff-scanned-pdf-native-highlight.md §6 とスパイク REPORT |
| Q8 | 既定モデルと採用基準 | **確定: 工場出荷の既定モデル = `gemini-3.8-flash`（2026-10-04 に `gemini-3.5-flash` から切り替え。issue #295）**。経緯: 2026-07-06 に、実データ抽出ベンチマーク（`experiments/extraction-benchmark-real/REPORT.md`。不眠 SR 10 論文の人手 gold）で項目正確度が最良（成功 run 72%・anchor 92.5%）だった `gemini-3.5-flash` を採用した。2026-09-21 の run（プロンプト版数 9・10 本・各 1 反復。2026-10-04 に gold の群の重複を直して再採点）では、項目正確度は 3.8-flash 75.4% / 3.5-flash 72.5%（数として一致なら 78.7% / 73.9%。1 反復どうしで、過去の反復間 SD 1.6 ポイントに照らして差は誤差の範囲）、1 論文の費用は 0.07 USD / 0.23 USD（3.8-flash は 2026-12-31 までの割引単価。2027-01-01 以降は 0.14 USD）、応答時間は 32 秒 / 75 秒だった。3.8-flash の引用の照合成功率は 83.9% と低かったが、断片照合（issue #294・§5）を入れて同じ run を照合し直すと 92.3% になり（3.5-flash は 94.7%）、差が 2.4 ポイントまで縮んだため切り替えた。**3 反復での比べ直しと、抽出以外の skill（draft-schema 等）での確認は行っていない**。Options に保存済みの既定モデルは変わらない（工場出荷の既定は未設定時の初期値）。採用基準の参考は CESAR プロジェクトの中止境界（下表）。事前登録ベンチ（`experiments/extraction-benchmark/`）は別建てで凍結保持し、正式な再確認に使える |
| Q9 | PDF 原本の扱い | (a) プロジェクトフォルダへコピー（凍結スナップショット、監査に強い）(b) 参照のみ（ユーザーが原本を移動すると壊れる）。**確定: (a) コピー**。取り込み時に `documents/` へコピーを作成し、`Documents.drive_file_id` にはコピーの ID を、元 PDF の ID は `source_file_id` に分けて記録する（§3.2） |
| Q10 | 複数報告文書（multiple reports）の扱い | **確定（v0.10・2026-07-07）: study / document を分離し、study を抽出・検証・エクスポートの単位にする**。検討 3 案 — (a) study 第一級エンティティ化 (b) primary document 方式（主文書の document_id を study キーに流用）(c) 抽出は文書単位のまま検証で人間が統合 — のうち (a) を採用（(b) は主文書差し替えでキーが揺れ、(c) は文書横断コンテキストを LLM に与えられず目的を達しない）。付随決定: ① study メタデータは新設 `Studies` タブ（14 タブ目）② 取り込みは 1 PDF = 1 study 自動生成 → S3 で後から統合 ③ 登録番号の自動検出は候補提案 → ユーザー確認（自動統合しない）④ 抽出後のグルーピング変更は可 — 新 study_id 発行で「未抽出」に戻して再抽出を促す（旧データ行は監査用に残置）。未リリースのため後方互換なし（§3.2 / §4.5） |
| Q11 | Anthropic ネイティブ / Azure OpenAI 対応（issue #127） | **方針確定（PR0）: provider 層はプロバイダごとに固定の認証方式で実装する（任意ヘッダー入力 UI・カスタムモデル一覧管理 UI は引き続き不採用）**。**PR2 で Anthropic の Options 配線（`#llm-provider` に `anthropic` を追加 + `#anthropic-api-key` + 接続テスト + `createProvider` / `resolveProviderId` / 単価表 3 モデル）まで実装完了**。**PR3 で Azure OpenAI の Options 配線（`#llm-provider` に `azure_openai` を追加 + `#azure-openai-endpoint` / `#azure-openai-api-key` + 接続テスト。新規 provider クラスは作らず `OpenAICompatibleProvider` を `authMode: 'azure_api_key'` で流用）まで実装完了**。実 API 確認が必要な未決事項として記録していた 3 点のうち: **①拡張オリジン（`chrome-extension://`）から `api.anthropic.com` への疎通は解消・確認済み**（2026-07-30 の実 API プローブで、`Origin` ヘッダー付きリクエストが `anthropic-dangerous-direct-browser-access` ヘッダー無しだと本文検査前に HTTP 401 で拒否されると判明 → `AnthropicProvider` に同ヘッダーを常時付与する修正〔#210〕で 200 + `access-control-allow-origin: *` を確認済み。詳細は `src/lib/llm/AnthropicProvider.ts` の `BROWSER_ACCESS_HEADER` コメント）。**②構造化出力のルート `type:'array'` スキーマの受理も同プローブで確認済み**（`toAnthropicSchema` のパススルー実装のとおり、Anthropic 側がオブジェクト以外のルート型を拒否しないことを確認）。**③ Azure OpenAI の実テナントでの疎通は未確認のまま残す**（本 PR〔PR3〕はテナントを持たないため実施できない。実施時は疎通そのものに加えて、拡張オリジンからの `Origin` ヘッダー付きリクエストの挙動も併せて確認すること — ①で判明したとおり、プロバイダによっては `Origin` ヘッダーの有無だけで本文検査前に拒否され得るため、Azure 側も同種の挙動が無いか要確認）。③は docs/remaining-work-plan.md の「実機 / 実 API テストが必要な項目」へ合流させる。**PR4 でモデル一覧の自動取得（Anthropic `GET /v1/models` / OpenRouter / OpenAI 互換 API。Gemini / Azure OpenAI は対象外）まで実装完了**（`src/lib/llm/modelListFetcher.ts`）。Anthropic の `GET /v1/models` が `POST /v1/messages` と同じ `anthropic-dangerous-direct-browser-access` ヘッダー制約を受けるかは実機未確認のまま remaining-work-plan.md へ合流させている。**PR5 で reasoning effort の設定化まで実装完了**: `ChatOptions` に advisory な `reasoningEffort`（`'low' | 'medium' | 'high'`）を追加し、Options `#default-reasoning-effort` セレクタ（保存キー `settings.defaultReasoningEffort`。未設定 = null）から `lib/llm/providerFactory.ts`（`ProviderConfig.reasoningEffort` → `createProvider`）経由で各 provider の construction 時点の既定値へ注入する（`resolveProviderConfig` / Options 接続テストの `resolveFormConfig` の 2 箇所が読み出す唯一の起点）。**未設定（既定）は各 provider の従来挙動を 1 バイトも変えない**という制約が最重要の受け入れ条件: Anthropic ネイティブは未設定でも従来どおり `output_config.effort = 'low'`（`DEFAULT_EFFORT`）を送り続け、`MODELS_WITHOUT_EFFORT_SUPPORT`（`claude-haiku-4-5`）の deny list は明示設定時も優先する。OpenRouter / OpenAI 互換（Azure OpenAI 含む）は設定時のみ `reasoning_effort` を送り、未設定なら一切送らない。**issue #127 §4-4 は「プロバイダが受けなければ無視されるか 400。400 は既存の非互換フォールバックで縮退させる」ことを要求していたが、実装レビューで `OpenAICompatibleProvider` の構造化出力フォールバック `isStructuredOutputCompatibilityError`（判定は応答本文に `response_format`/`json_schema`/`strict`/`structured_output` のいずれかを含む場合に限られる）は `reasoning_effort` という語にマッチせず、この要求を満たせていないと判明した**。そのため `isReasoningEffortRejection`（応答本文に `reasoning_effort` を含む 400/422 を判定）+ `chat()` 内の一度きりの縮退フォールバック（`reasoningEffortDropped`）を別枠で新設し、`reasoning_effort` 拒否時は 1 回だけ同じ構造化出力 `mode` のままフィールドを落として再送する形で要求を満たした（構造化出力の `mode` カスケードとは独立に動作させ、両者が互いを再トリガーし合わないよう `reasoningEffortDropped` は一方向にしか変化しない設計にしてある。詳細は `OpenAICompatibleProvider.ts` の `chat()` 内コメント）。**`OpenRouterProvider` は元々どんな HTTP エラーにも再試行構造（cascade）自体を持たないため、同種の縮退フォールバックは追加していない**（OpenRouter は既知の単一サービスであり任意の利用者指定エンドポイントとはリスク特性が異なるため、要否は別途判断する）。Gemini は未対応のまま据え置き（thinking budget 相当の設計には実データベンチマークに基づく数値選定が要るため、本 PR では推測で決めない）。**Anthropic の既定値 `'low'` はスループット防御のための選択であり精度計測に基づかない**ため、`experiments/extraction-benchmark-real/` での妥当性検証は remaining-work-plan.md へ未実施のまま合流させている |

### Q8 参考: CESAR プロジェクトの中止境界と判断ルール（中間解析）

| Performance metrics | Futility boundaries (point estimate) | Non-inferiority margins (Upper limit of 95% CI) | Decision rules |
| --- | --- | --- | --- |
| **Screening** | | | |
| Sensitivity | <80% | <95% | Stop if either boundary is crossed |
| Specificity (for full-text screening only) | <50% | <60% | Stop if either boundary is crossed |
| **Data extraction** | | | |
| Sensitivity | <92% | <97% | Stop if either boundary is crossed |
| Major error proportion | >3% | >2% | Stop if either boundary is crossed |

本拡張のベンチマーク（§8）ではデータ抽出側の行（Sensitivity futility <92% / NI margin <97%、Major error futility >3% / NI margin >2%）を採用基準の出発点とする。

### Q11 参考: `MODEL_PRICING` / `MODEL_IMAGE_CAPABILITY` の Anthropic 3 モデルの数値（PR2 で転記済み）

issue #127 PR1 時点では `createProvider()` / `settingsStore.LLM_PROVIDERS` が `'anthropic'` を解決できず、モデルセレクタに出しても選択すると誤って Gemini へ送信されてしまうため、単価表への追加を見送っていた。**PR2 で `src/lib/llm/pricing.ts` の `MODEL_PRICING` / `MODEL_IMAGE_CAPABILITY` へ以下の数値をそのまま転記済み**（再調査は行っていない）。

| モデル ID | 入力 USD/1M | 出力 USD/1M | 画像入力 | 備考 |
| --- | --- | --- | --- | --- |
| `claude-opus-5` | 5.00 | 25.00 | 対応（ネイティブ base64） | コンテキスト長 1M |
| `claude-sonnet-5` | 2.00 | 10.00 | 対応（ネイティブ base64） | コンテキスト長 1M。**2026-08-31 に公式料金ページで再確認し $2.00 / $10.00 へ修正**。当初「2026-08-31 までの導入価格」とされていた $2/$10 は**標準価格として恒久化**され、予定されていた $3/$15 への改定は行われないと明記された。旧記述は「導入価格終了後に単価表を直さずに済むよう通常価格 $3/$15 を載せる」という判断だったが前提が失効し、逆に 1.5 倍の過大表示になっていた |
| `claude-haiku-4-5` | 1.00 | 5.00 | 対応（ネイティブ base64） | **コンテキスト長 200K**（他の 2 モデルは 1M）。全文 PDF 抽出という本用途では長尺文書で haiku だけ収まらないケースが起こりうる点に注意 |

---

## 付記: 既存 2 拡張から流用・共通化する資産

- OAuth / Sheets / Drive クライアント層、オフラインキュー、LLM プロバイダ抽象化（Gemini / OpenRouter / OpenAI 互換 API）、モデル ID マイグレーション機構 → 共通ライブラリ化を検討（3 拡張のモノレポ化 or npm パッケージ切り出しは別途判断）
- UI トンマナ: tiab-review のサイドパネル系コンポーネント（判定チップ、進捗表示）+ sr-query-builder のメインビュー / ウィザード構成
- ドキュメント構成: `docs/requirements.md`（本書）に加え、[docs/ui-flow.md](ui-flow.md) / [docs/architecture.md](architecture.md) / [docs/ui-states.md](ui-states.md) を sr-query-builder と同構成で整備（v0.2 で作成済み）
