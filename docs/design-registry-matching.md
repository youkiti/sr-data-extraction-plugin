# 試験登録情報との突き合わせの設計案

- 作成日: 2026-11-13
- 状態: **設計レビュー済み（2026-11-13）**。所有者の決定事項を反映済み。取得経路の未確認事項と正式な保存列は実装 issue A で確定する。
- 目的: 論文と登録情報を出所付きで並べ、選択的報告と RoB 2 D5 の人間による判断を支援する。
- 進め方: 末尾の実装 issue A〜E を起票する。初回は CT.gov の自動取得と WHO ICTRP / jRCT の登録 PDF による比較を対象とし、CT.gov の実呼び出し・各経路の比較と保存復元・日英の公開説明同期を終えて一つのリリースにまとめる。WHO / jRCT の書面許諾の確認は所有者が並行して進め、許諾後の自動取得は後続 issue F とする。許諾待ちは初回公開を妨げない。

## 1. 調査範囲と既存の設計

初稿では本リポジトリとローカルの参照実装を調査した。今回 Codex が 3 登録先の公式資料を Web で調査し、次節に出典と確認日を記録した。実 API 呼び出しは行っていない。資料の確認と、実装後に所有者がインストール済み拡張から行う実呼び出しの確認は区別する。

| 根拠 | 確認した現状と設計への制約 |
| --- | --- |
| [requirements.md](requirements.md) §3.1〜3.3 | study が抽出・検証の単位、document は PDF と引用の単位。`Studies.registration_id` は単一文字列で手動編集可。`Documents.document_role=registration` は既にある。大きな本文は Drive 実体と Sheets の参照に分離する。 |
| [requirements.md](requirements.md) §3.2、§4.4、§5 | `Evidence` は AI の値・逐語引用・出所 `document_id`・`run_id` を保存し、引用は出所 PDF 一つのテキストへ照合する。`Decisions.seen_evidence_ids` は判定時の AI 根拠の識別子。人が編集した PDF 引用は `QuoteSets` に別保存し、audit.csv は判定時の AI 根拠を出す。 |
| [requirements.md](requirements.md) §3.3、§4.2、§4.6 | `rob_domain` の base は `rob:<domain_id>`。結果単位の `rob:<domain_id>\|outcome:<key>[\|arm:<n>][\|time:<t>]` も宣言可能。AI 抽出は base のみ、結果単位は人間が追加・判定する。annotator 軸と独立入力の盲検を保つ必要がある。 |
| [detectRegistrationId.ts](../src/features/documents/detectRegistrationId.ts)、[importDocuments.ts](../src/features/documents/importDocuments.ts)、[documentsView.ts](../src/app/views/documentsView.ts) | 取り込み時に PDF 抽出テキストから番号を検出済み。NCT / ISRCTN / UMIN / jRCT / JPRN / ChiCTR / EudraCT / ACTRN を扱い、最頻出、同数なら先頭の一件を選ぶ。S3 に `registration_id` の編集がある。検出対応と外部取得対応は区別する。 |
| [robTemplates.ts](../src/features/schema/presets/robTemplates.ts) | RoB 2 D5 は `d5_reporting`。SQ は `rob2_sq5_1`〜`rob2_sq5_3`、値は `y / py / pn / n / ni / na`。現行の指示は記事の明示的報告に限定している。登録情報を既存抽出へ暗黙に混ぜる変更は避ける。 |
| [status-and-roadmap-20260711.md](status-and-roadmap-20260711.md) §4 提案4 | registration 文書だけのミニスキーマ抽出と論文との並列表を提案している。本案では、API 原本の保存も必要になるため PDF 文書と登録スナップショットを区別する。 |

参照実装は `/home/user/youkiti/tiab-review-plugin` の次のファイルを読んだ。

- `src/lib/ctg-parser.ts`: **CSV 入力**であり API v2 のパーサではない。`NCT Number`、`Study Title`、`Study URL` を扱う。`Primary Outcome Measures`、`Secondary Outcome Measures`、`Other Outcome Measures`、`Enrollment`、`Primary Completion Date`、`Completion Date`、`First Posted`、`Results First Posted`、`Last Update Posted` などを抄録文字列へ連結する。`Start Date` は年へ変換し、NCT を `pmid` に格納する。本機能では日付精度・項目別原文・登録 ID 専用の型が必要なので、この変換をそのまま流用しない。
- `docs/help.html` の「登録レコードの連携」: ClinicalTrials.gov CSV / ICTRP XML を登録レコードとして扱い、HTML スナップショットを Drive に保存する説明がある。取得経路・スナップショット・手動の採否を利用者へ明示する書き方を参考にする。結果論文探索の機能は本案の範囲外。
- `docs/privacy-policy.html` §5: 任意操作に応じた送信先として ClinicalTrials.gov を明記し、Google・AI・書誌サービスを目的別に説明している。これを参考に、本拡張でも登録照会の送信内容と保存先を独立して説明する。参照先の記述は各登録先の現行 API 仕様の裏付けにはしない。

## 登録先 API の調査結果（2026-11-13）

確認担当は Codex。公式資料と公式サイトの検索結果を Web で確認した日を各行に記す。実 API で試験レコードを取得する操作は行っていない。公式の項目定義や公開画面で項目が見えることと、API / エクスポートがその項目を返すことは区別する。厳密な JSON / XML パスの未確認箇所は issue A で確定する。二次資料から URL・認証・制限値を補完しない。

ClinicalTrials.gov の API 説明・構造表などは閲覧ツールに本文が現れず、OpenAPI 資料 `https://clinicaltrials.gov/api/oas/v2` も YAML がツール非対応で読めなかった。jRCT の規約・検索・詳細ページの直接閲覧は HTTP 403 だったため、公式ページの検索結果で確認できた範囲だけを記録した。これは拡張での疎通結果ではない。履歴情報も未取得を「履歴なし」と読み替えない。

### ClinicalTrials.gov（API v2）

| 調査項目 | 確認結果と実装への制約 | 公式出典 URL | 確認日 |
| --- | --- | --- | --- |
| 公開 API / エクスポート | REST API v2 は JSON を主な応答とする。画面から単一試験を CSV / JSON / RIS、試行的な FHIR で出力可能。 | [NLM の API v2 解説](https://www.nlm.nih.gov/pubs/techbull/ma24/ma24_clinicaltrials_api.html)、[ダウンロード手順](https://clinicaltrials.gov/data-api/how-download-study-records) | 2026-11-13 |
| 基底 URL と登録番号による 1 件取得 | 公式の単一試験取得例から基底パスは `https://clinicaltrials.gov/api/v2`、リクエストは `GET https://clinicaltrials.gov/api/v2/studies/{NCT番号}`。公式例は `GET https://clinicaltrials.gov/api/v2/studies/NCT02993146`。本調査では実行していない。 | [NLM の単一試験 API 利用手順](https://www.nlm.nih.gov/pubs/techbull/ja25/ja25_clinical_trials_screen-scraping.html) | 2026-11-13 |
| 認証 / レート制限 | 公式は公開 API と説明し、単一試験の GET 例に API キーや認証ヘッダーはない。認証なしの公開取得を想定するが、インストール済み拡張での確認は未実施。レート制限の数値・単位は **要確認（公式資料で確認できず）**。無制限とは扱わない。 | [NLM の公開 API 説明・GET 例](https://www.nlm.nih.gov/pubs/techbull/ja25/ja25_clinical_trials_screen-scraping.html)、[API 説明（本文取得不能）](https://clinicaltrials.gov/data-api/api) | 2026-11-13 |
| 利用 / 再利用条件 | 無償。配布時は ClinicalTrials.gov を出典にし、最新性・処理日・改変内容を示す。独占的権利の主張やメールアドレスの販促利用は禁止。第三者の権利がある情報にも注意する。固定した過去スナップショットの監査保存・別添配布と最新性の条件の整合は issue A で確認する。 | [Terms and Conditions](https://clinicaltrials.gov/terms-conditions) | 2026-11-13 |
| 主要 / 副次アウトカム | 両区分に名称（Title）、説明（Description）、評価期間 / 時点（Time Frame）の定義がある。名称と説明の省略・未記載を分離する。API の配列パス・各キーは **要確認（公式資料で確認できず）**。画面の登録項目定義だけでパーサを確定しない。 | [登録項目定義（検索結果で本文確認）](https://clinicaltrials.gov/policy/protocol-definitions?trk=article-ssr-frontend-pulse_little-text-block)、[API 構造表（本文取得不能）](https://clinicaltrials.gov/data-api/about-api/study-data-structure) | 2026-11-13 |
| 症例数（予定 / 実績） | Enrollment は予定の総数または実際に登録した総数。Estimated / Actual を区別する定義がある。同一の最新値から当初の予定数を復元しない。API の数値・区分キーは **要確認（公式資料で確認できず）**。 | [公式 FAQ の Enrollment 定義](https://clinicaltrials.gov/policy/faq)、[用語集](https://clinicaltrials.gov/study-basics/glossary) | 2026-11-13 |
| 初回提出 / 初回公開 / 最終更新 | First Submitted（初回提出）、First Posted（初回公開）、Last Update Submitted（最終更新提出）、Last Update Posted（最終更新公開）を区別する。提出と QC 後の公開には時間差がある。API の各キーは **要確認（公式資料で確認できず）**。 | [公式用語集](https://clinicaltrials.gov/study-basics/glossary) | 2026-11-13 |
| 開始 / 主要完了 | Study Start Date は最初の参加者登録、Primary Completion Date は主要アウトカムの最終収集に関する日付で、予定 / 実績を区別する。公式 API 解説の応答例には `statusModule.startDateStruct` と `statusModule.primaryCompletionDateStruct` の `date` / `type` がある。 | [登録項目定義](https://clinicaltrials.gov/policy/protocol-definitions?trk=article-ssr-frontend-pulse_little-text-block)、[公式 FAQ](https://clinicaltrials.gov/policy/faq)、[NLM の応答例](https://www.nlm.nih.gov/pubs/techbull/ja25/ja25_clinical_trials_screen-scraping.html) | 2026-11-13 |
| 過去版 / 履歴 | 公式は各版を恒久的に閲覧可能と説明する。履歴画面の URL パターンは `https://clinicaltrials.gov/study/{NCT番号}?tab=history`、提出日から版を開く。公開 API v2 の過去版取得・版一覧エンドポイントは **要確認（公式資料で確認できず）**。`/api/int/` 等の内部用 URL を公開契約と仮定しない。最新レコードの取得と履歴の API 取得は別に扱う。 | [データベースの説明](https://clinicaltrials.gov/about-site/about-ctg)、[公式履歴画面の例](https://clinicaltrials.gov/study/NCT07859527?tab=history)、[NLM の API 説明](https://www.nlm.nih.gov/pubs/techbull/ja25/ja25_clinical_trials_screen-scraping.html) | 2026-11-13 |
| 拡張の接続先ホスト | 単一試験 API の URL から `clinicaltrials.gov`、要求候補は `https://clinicaltrials.gov/*`。履歴リンクを別タブで開くだけなら追加の取得権限を要求しない。`www` や CDN への追加権限は、この調査から必要とは断定しない。 | [公式の API URL](https://www.nlm.nih.gov/pubs/techbull/ja25/ja25_clinical_trials_screen-scraping.html) | 2026-11-13 |

### WHO ICTRP

| 調査項目 | 確認結果と実装への制約 | 公式出典 URL | 確認日 |
| --- | --- | --- | --- |
| 公開 API / エクスポート | 現行の公式紹介は研究用途の JSON Web Service を案内する。検索ポータルは CSV / XML ダウンロードに対応し、XML は選択レコードも出力できる。一方、紹介ページからリンクする 2014 年の Web Service 条件は XML と記述しており、形式・条件の整合は未確認。 | [Web Service 紹介](https://www.who.int/tools/clinical-trials-registry-platform/the-ictrp-search-portal/ictrp-search-portal-web-service)、[出力形式とデータ利用条件](https://www.who.int/tools/clinical-trials-registry-platform/network/who-data-set/downloading-records-from-the-ictrp-database) | 2026-11-13 |
| 基底 URL / 登録番号による 1 件取得 | 公開検索ポータルは `https://trialsearch.who.int/`。これは API 基底 URL の確認ではない。API 基底 URL、番号指定のメソッド・パラメータ・1 件応答の契約、直接の CSV / XML 取得 URL は **要確認（公式資料で確認できず）**。検索画面の URL を API として推測しない。 | [公式ダウンロード案内とポータルへのリンク](https://www.who.int/tools/clinical-trials-registry-platform/network/who-data-set/downloading-records-from-the-ictrp-database)、[Web Service 紹介](https://www.who.int/tools/clinical-trials-registry-platform/the-ictrp-search-portal/ictrp-search-portal-web-service) | 2026-11-13 |
| 認証 / レート制限 | リンク先の 2014 年 Web Service 条件は利用者名・パスワード等による認証と認証情報の共有禁止を定める。公式検索案内も crawling には利用者名・パスワードの申請を要求。JSON サービスの現行認証方式、レート制限の数値は **要確認（公式資料で確認できず）**。ポータルの無償出力と Web Service の利用条件を混同しない。 | [Web Service 条件 PDF](https://cdn.who.int/media/docs/default-source/medicines/regulatory-updates/gbt/2021-fair-pricing-forum/web_service_conditions_of_use6723ca30-e833-4d32-a20f-792cb1717352.pdf?download=true&sfvrsn=6d28f4a8_3)、[公式検索案内](https://www.who.int/tools/clinical-trials-registry-platform/the-ictrp-search-portal/search-tips) | 2026-11-13 |
| 利用 / 再利用条件 | ポータル出力は無償で、出典・最新性・WHO 処理日の表示、独占権主張の禁止、販促・商業利用等の禁止を定める。Web Service の公式リンク先条件はローカル保存および複製・配布・改変等を禁止し、利用費は照会が必要。本設計の Drive 原本保存・添付出力と衝突するため、現行 JSON サービスにも適用されるか、保存可能な経路・許諾があるかを所有者が確認するまで利用可能としない。 | [ポータル出力の条件](https://www.who.int/tools/clinical-trials-registry-platform/network/who-data-set/downloading-records-from-the-ictrp-database)、[公式リンク先の Web Service 条件](https://cdn.who.int/media/docs/default-source/medicines/regulatory-updates/gbt/2021-fair-pricing-forum/web_service_conditions_of_use6723ca30-e833-4d32-a20f-792cb1717352.pdf?download=true&sfvrsn=6d28f4a8_3) | 2026-11-13 |
| 主要 / 副次アウトカム | WHO TRDS 1.3.1 は Primary Outcome(s) / Key Secondary Outcomes に名称、測定方法、評価時点を要求する。登録データの最小要件であり、API / XML / CSV の独立した名称・説明・時点フィールドや実際の充足は **要確認（公式資料で確認できず）**。自由記述を AI で分割しない。 | [WHO Trial Registration Data Set](https://www.who.int/tools/clinical-trials-registry-platform/network/who-data-set) | 2026-11-13 |
| 症例数（予定 / 実績） | TRDS の Sample Size は予定総数と登録済み総数を含む。取得経路ごとの列・区分・欠損時の表現は **要確認（公式資料で確認できず）**。単一の数値を当初予定数とみなさない。 | [TRDS の Sample Size](https://www.who.int/tools/clinical-trials-registry-platform/network/who-data-set) | 2026-11-13 |
| 初回提出 / 初回公開 / 最終更新 | TRDS に原登録先の Date of Registration があるが、初回提出日・初回公開日とは同一視しない。これら 2 日付とレコードの最終更新日が API / エクスポートで得られるかは **要確認（公式資料で確認できず）**。データベースの週次更新は個別レコードの最終変更日ではない。 | [TRDS の登録日](https://www.who.int/tools/clinical-trials-registry-platform/network/who-data-set)、[ICTRP データの更新説明](https://www.who.int/tools/clinical-trials-registry-platform/network/who-data-set/downloading-records-from-the-ictrp-database) | 2026-11-13 |
| 開始 / 主要完了 | TRDS に Date of First Enrollment（予定 / 実績）と Completion date（最終データ収集）がある。主要完了日として独立したフィールドの提供は **要確認（公式資料で確認できず）**。全体の完了日を主要完了日に置換しない。API 項目パスも未確認。 | [TRDS の開始・完了日](https://www.who.int/tools/clinical-trials-registry-platform/network/who-data-set) | 2026-11-13 |
| 過去版 / 履歴 | 過去レコードの API 取得・版一覧・履歴ページの URL パターンはいずれも **要確認（公式資料で確認できず）**。TRDS ページの過去版アーカイブはデータセット定義の履歴であり、各試験の履歴ではない。公式検索は原登録全文へのリンクを提供するため、原登録先の履歴を人が確認する導線を用意する。 | [公式検索案内](https://www.who.int/tools/clinical-trials-registry-platform/the-ictrp-search-portal/search-tips)、[TRDS](https://www.who.int/tools/clinical-trials-registry-platform/network/who-data-set) | 2026-11-13 |
| 拡張の接続先ホスト | 公式がリンクするポータルは `trialsearch.who.int`。API ホストは **要確認（公式資料で確認できず）**。`https://trialsearch.who.int/*` は取得経路の確定後に限る権限候補であり、`*.who.int` を一括要求しない。資料配布の `www.who.int` / `cdn.who.int` は、試験取得に必要なホストと断定しない。 | [公式ポータルへのリンク](https://www.who.int/tools/clinical-trials-registry-platform/network/who-data-set/downloading-records-from-the-ictrp-database)、[Web Service 紹介](https://www.who.int/tools/clinical-trials-registry-platform/the-ictrp-search-portal/ictrp-search-portal-web-service) | 2026-11-13 |

### jRCT（Japan Registry of Clinical Trials）

| 調査項目 | 確認結果と実装への制約 | 公式出典 URL | 確認日 |
| --- | --- | --- | --- |
| 公開 API / エクスポート | 検索結果画面に利用規約確認付きの「研究検索結果ダウンロード」がある。機械可読形式・列定義と公開 API の存在は **要確認（公式資料で確認できず）**。登録者用の提出 PDF / XML 出力の説明を、一般利用者向けの試験取得 API の証拠としない。 | [公式検索結果画面](https://jrct.mhlw.go.jp/search?kanguage=en)、[登録者用の提出様式出力手順](https://jrct.mhlw.go.jp/pages/manual/register_manual) | 2026-11-13 |
| 基底 URL / 登録番号による 1 件取得 | 現行サイトは `https://jrct.mhlw.go.jp/`。公式公開画面のパターンは `https://jrct.mhlw.go.jp/latest-detail/{jRCT番号}`。これは HTML 詳細画面であり、機械可読 API の基底 URL・番号指定リクエストは **要確認（公式資料で確認できず）**。旧 `jrct.niph.go.jp` を新規取得先にしない。 | [公式の URL 変更告知](https://jrct.mhlw.go.jp/)、[公開詳細画面の例](https://jrct.mhlw.go.jp/latest-detail/jRCTs052220011) | 2026-11-13 |
| 認証 / レート制限 | 公開詳細画面を検索結果で確認したが、API / 出力の認証要否とレート制限の数値は **要確認（公式資料で確認できず）**。今回の HTTP 403 は閲覧ツールの結果であり、全利用者に認証必須という証拠ではない。 | [公式検索結果画面](https://jrct.mhlw.go.jp/search?kanguage=en)、[公式詳細画面](https://jrct.mhlw.go.jp/latest-detail/jRCTs052220011)、[公式規約](https://jrct.mhlw.go.jp/agreement) | 2026-11-13 |
| 利用 / 再利用条件 | 原則 PDL1.0 に準拠するが、研究者・委員会関係者の氏名・連絡先等は適用外。網羅的な収集には許可申請が必要で、自動巡回による収集は控えるよう規定。トップにもプログラムによる意図的な大量収集を控える告知がある。利用者が指定した 1 件の自動取得と原本保存が許されるかは **要確認（公式資料で確認できず）**。PDL の適用だけで自動取得を許可済みにしない。 | [jRCT 利用規約](https://jrct.mhlw.go.jp/agreement)、[公式トップのデータ利用告知](https://jrct.mhlw.go.jp/) | 2026-11-13 |
| 主要 / 副次アウトカム | 公開画面に主たる評価項目 / 副次的な評価項目がある。名称・説明・時点が一つの記述に含まれる例があり、API / 出力で 3 要素が独立した構造として得られるかは **要確認（公式資料で確認できず）**。自由記述から時点を補完しない。 | [主要評価項目に時点を含む公式例](https://jrct.mhlw.go.jp/latest-detail/jRCT2051240131)、[主要・副次の公式例](https://jrct.mhlw.go.jp/latest-detail/jRCTs051190095) | 2026-11-13 |
| 症例数（予定 / 実績） | 公開画面で目標症例数（Target Sample Size）を確認。実績数の独立項目・予定実績の型区分・API / 出力列は **要確認（公式資料で確認できず）**。目標数だけから実績を推定しない。 | [目標症例数の公式例](https://jrct.mhlw.go.jp/latest-detail/jRCT2080225322) | 2026-11-13 |
| 初回提出 / 初回公開 / 最終更新 | 公開画面に初回公表日と最終公表日がある。初回提出日の取得と API / 出力での各日付の提供は **要確認（公式資料で確認できず）**。公表日を提出日と置換しない。 | [公表日の公式例](https://jrct.mhlw.go.jp/latest-detail/jRCTs052220011) | 2026-11-13 |
| 開始 / 主要完了 | 症例登録開始予定日と第 1 症例登録日の表示例がある。観察期間終了日（Completion date）の例もあるが、主要完了日に対応する独立項目と API / 出力列は **要確認（公式資料で確認できず）**。FAQ は移行した年 / 年月のみの日付を 1 月 1 日 / 月初で補う場合を説明しており、表示上の日付を原登録の日精度と断定しない。 | [開始予定日の例](https://jrct.mhlw.go.jp/detail/104117/jRCT/1)、[初症例登録日の例](https://jrct.mhlw.go.jp/detail/99089/jRCT/1)、[完了日の例](https://jrct.mhlw.go.jp/latest-detail/jRCT2031210399)、[公式 FAQ の日付移行仕様](https://jrct.mhlw.go.jp/faq) | 2026-11-13 |
| 過去版 / 履歴 | 公開詳細画面内に変更履歴（種別・公表日・詳細・変更内容）があり、`https://jrct.mhlw.go.jp/latest-detail/{jRCT番号}` から参照する。過去の詳細画面に `/detail/{内部ID}/{区分}/{値}` という例はあるが、内部 ID 等の意味や登録番号から版 URL を作る規則は **要確認（公式資料で確認できず）**。版一覧・過去版の API 取得も未確認。サイト全体の `/history` を試験履歴と混同しない。 | [変更履歴の公式例](https://jrct.mhlw.go.jp/latest-detail/jRCT1071220082)、[過去詳細の公式例](https://jrct.mhlw.go.jp/detail/104117/jRCT/1)、[サイト更新履歴](https://jrct.mhlw.go.jp/history) | 2026-11-13 |
| 拡張の接続先ホスト | 公開画面のホストは `jrct.mhlw.go.jp`。`https://jrct.mhlw.go.jp/*` は許可された取得経路が確定した場合の権限候補。公開 API の別ホストやリダイレクト先の必要性は **要確認（公式資料で確認できず）**。PDF 手動取り込みだけなら登録先の fetch 権限は要求しない。 | [公式 URL 変更告知](https://jrct.mhlw.go.jp/)、[公式詳細画面](https://jrct.mhlw.go.jp/latest-detail/jRCTs052220011) | 2026-11-13 |

**調査からの設計上の判断**: CT.gov は公式の単一試験 GET を実装の起点にできる。WHO ICTRP は Web Service と出力の条件差、jRCT は API 契約の未確認と自動収集制約がある。これを受けた所有者の範囲決定（2026-11-13）により、初回は CT.gov の自動取得と WHO ICTRP / jRCT の登録 PDF 取り込みによる比較を実装する。WHO / jRCT の自動取得は初回に含めず、所有者が各運営者へ利用者操作による単一レコード取得と利用者自身の Drive への保存の可否を問い合わせる。登録先ごとの書面許諾後に後続 issue F で追加し、許諾の取得は初回リリースの条件にしない。

## 2. 対象登録先と登録番号の拾い方

### 対象登録先

**所有者の範囲決定（2026-11-13）**: 初回リリースでは ClinicalTrials.gov API v2 の NCT 番号指定による単一試験 GET を自動取得として提供する。WHO ICTRP / jRCT は登録 PDF の取り込みを正式な対応経路とし、同じ比較カードで論文と突き合わせる。両登録先への自動取得は初回に含めない。

| 登録先 | 初回の対応経路 | 候補一覧と公開ページ |
| --- | --- | --- |
| ClinicalTrials.gov | `GET https://clinicaltrials.gov/api/v2/studies/{NCT番号}` で取得し、JSON 原本を保存する。取得不能なら理由を表示し、登録 PDF の取り込みも可能にする。 | NCT 番号候補から取得操作へ進む。公開ページは `https://clinicaltrials.gov/study/{NCT番号}`。 |
| WHO ICTRP | 利用者が登録レコードを PDF として取り込む。自動照会・取得は行わない。 | 番号候補は検出し、「自動取得は未対応（PDF で取り込む）」と [ICTRP 公開検索ページ](https://trialsearch.who.int/) へのリンクを示す。番号指定の公開ページ URL は推測しない。 |
| jRCT | 利用者が登録レコードを PDF として取り込む。自動照会・取得は行わない。 | 番号候補は検出し、「自動取得は未対応（PDF で取り込む）」と `https://jrct.mhlw.go.jp/latest-detail/{jRCT番号}` へのリンクを示す。 |

PDF は既存の `document_role=registration` として取り込み、出所 URL・登録番号・対象版・取得日を人が確認して関連付ける。WHO ICTRP / jRCT の PDF でも、同じ S8 比較カードの項目表示・手動対応・確認 / 保留・D5 支援・保存 / 再読込を利用できるようにする。比較項目は人が原文・引用を参照し、出所は PDF の文書・ページ・引用として保持する。新規 LLM 呼び出しや汎用 CSV / XML インポータは追加しない。Web Service の保存禁止を PDF 化で回避せず、利用条件を満たす公開登録資料を利用する。

CT.gov の取得は利用者が NCT 番号を選んで「登録情報を取得」を押したときだけ行う。取り込み・画面表示・番号検出をきっかけに自動照会しない。WHO ICTRP / jRCT の公開ページリンクは利用者が別タブで開くためのもので、拡張がリンク先を fetch しない。タイトル検索や外部への抄録送信は初回リリースに含めない。

**所有者タスク**: 初回実装と並行して、WHO の ICTRP Web Service 担当と jRCT 運営者（厚生労働省）へ、利用者が操作したときの単一レコード取得と利用者自身の Drive への保存が許されるかを問い合わせ、回答日・対象登録先・許諾範囲を含む書面を記録する。登録先ごとに書面許諾が得られた後だけ、後続 issue F で自動取得を追加する。問い合わせ・許諾待ちは初回リリースの条件にしない。

### 登録番号候補

**決定**: 既存の検出を取り込み時の初期値として維持し、突き合わせでは study 配下の本文・取り込み済み抄録 PDF の抽出テキストから候補一覧をローカルで作る。候補ごとに正規化 ID、出所文書、出現位置・周辺文を示す。抄録が独立した文字列として利用可能な経路は実装時に確認し、存在しない素材を外部から自動取得しない。テキスト層がない PDF は自動検出不能と表示し、手入力を許可する。

- 選択前は `Studies.registration_id` を第一候補として示す。複数候補がある場合も自動的に同一試験と確定しない。参考文献内の番号や多試験の報告を人が除外できるようにする。
- 一つの study に複数登録がある場合は登録ごとの関連付けを持ち、`registration_id` に連結して保存しない。主番号の変更は既存の S3 編集を使い、取得だけでは上書きしない。
- 異なるレジストリ間の別名関係は人が確認する。形式一致は実在や同一試験の保証ではない。ID から許可済みホストの照会 URL を構築し、入力 URL や登録レコード内の任意 URL を自動 fetch しない。

候補一覧と手動確認を採用し、既存の一件検出だけに限定する案と LLM による番号推定は採用しない。番号検出に LLM は追加しない。

## 3. 突き合わせる項目と比較の規則

**決定**: 登録側の項目と、現在の annotator が確認する論文側の値・引用を並べる。アウトカムの対応は人が確定し、名称の完全一致だけを対応候補として提示する。時点・症例数・日付の比較は対応確定と分離する。登録側を正解として論文側の値を書き換えない。

| 項目 | 表示・比較案 | 限界と代替案 |
| --- | --- | --- |
| 主要・副次アウトカム | 登録の区分・名称・定義・尺度と論文側の報告を並べ、一対多・多対一を許す対応表で確認する。区分の変更、未対応、追加報告を区別する | 名称の完全一致のみでは尺度変更を見落とすため、候補は人が原文とともに確認する。意味対応の LLM は採用しない。各登録先の提供項目と API 上の対応は調査結果を使い issue A で確定する。 |
| 評価時点 | 原文の期間、起点、単位を残し、同じ起点の明白な単位変換は比較表示だけに使い、名称が完全一致しないアウトカムの対応候補にはしない | 「12 weeks」と「3 months」は自動一致させない。時点がない側は「情報不足」。自由記述のみの並列表も代替だが、構造化できる範囲は比較する。 |
| 予定症例数 | 登録原文と予定 / 実績の区分を保存し、論文の目標数・無作為化数・解析数を別々に表示する | `Enrollment` の数字だけから予定数と決めない。予定と実績を直接不一致にしない。区分の提供状況は調査結果を参照し、過去の予定値を取得できない場合は不明とする。数字だけの差分表示は不採用。 |
| 登録日と試験開始日 | 初回提出日、初回公開日、開始日、主要完了日、更新日を意味別に保持し、存在する項目だけ表示する | 登録先ごとの提供可否は調査結果を参照し、API 項目パスは issue A で確定する。公開日を登録日と同一視しない。開始日のみとの比較で事前登録と断定しない。 |

日付は原文と精度（年 / 月 / 日）を保持する。精度が違う場合は可能な期間として比較し、期間が重なると「前後不明」、完全に分離するときだけ順序を示す。不正値・未記載・取得不能を区別し、日付を補完して確定値にしない。

比較結果は「一致候補」「差異候補」「対応未確定」「片側に記載なし」「比較不能」と、人の「確認済み / 保留」を別に持つ。「片側に記載なし」は取り込んだ資料内での状態であり、研究全体の未報告や選択的報告の証明ではない。論文のスキーマに比較項目がない場合は追加を案内し、登録側の値でセルを自動生成・確定しない。

**版の選択**: 取得日時、登録側の更新情報、取得できた版の識別子を表示する。最新版しか取得できない場合は、その最新版と比較し、常に「事前の指定は確認できていない」と示す。「現在の登録」を「試験前の登録」と呼ばない。API が過去版を返せる場合は、利用者が版を選び、選択した版を固定する。履歴ページがあるだけでは過去版を API 取得できると扱わない。

画面には比較中の版とは別に、登録レコードの履歴の存在と確認状況を示す。確認できた版数・最終変更日と履歴ページへのリンクを表示する。版数を取得できない場合も「版数未取得」と履歴リンクを示し、1 版しかないと推定しない。履歴の提供自体を公式資料で確認できない登録先は「履歴の有無未確認」とし、原登録ページでの確認へ誘導する。更新日は版数の代用にしない。登録 PDF・プロトコル・SAP の確認への導線も残し、自動的に開始日前の版へ切り替えない。

## 4. RoB 2 D5 と根拠の提示

**決定**: S8 に「登録情報との突き合わせ」カードを設け、対象結果を明示して SQ 5.1〜5.3 ごとの根拠と不足情報を表示する。SQ 回答と D5 判定は自動入力しない。既存テンプレート・抽出プロンプト・RoB の決定ロジックは初回リリースでは変更しない。

| 既存 SQ | 提示する根拠 | 自動では決められない点 |
| --- | --- | --- |
| `rob2_sq5_1` | 選択した登録版、日付、プロトコル・SAP の論文側引用と参照先 | 解析計画が非盲検アウトカムデータ利用前に確定したか。単に登録が古い、主要アウトカムが一致、だけでは Yes にしない。 |
| `rob2_sq5_2` | 対象結果に対応する尺度・定義・時点、登録内の他の測定候補と論文の引用 | 複数候補から結果に基づいて選択したか。差異があるだけで Yes にしない。 |
| `rob2_sq5_3` | 登録や SAP に明示された解析候補と、論文で報告した解析の引用 | 初回の比較項目だけでは複数解析からの結果に基づく選択を確認できない。記載がなければ情報不足を示す。 |

`rob:d5_reporting` は study 全体の base。結果が異なる場合は、既存の結果単位オーバーライド（例: `rob:d5_reporting|outcome:insomnia|time:12w`）を人が宣言し、その結果だけに根拠を関連付ける。カードの対象結果と判定先が一致することを保存時にも確認する。SQ テンプレートがなければ比較だけ利用でき、導入案内を出して自動挿入はしない。

### PDF 引用と登録スナップショットの境界

- 論文側は既存 `Evidence` / 有効な `QuoteSets` の引用を参照し、出所 PDF へのハイライトを使う。独立入力では自分の引用だけを使う。
- API 側は保存した原本中の項目位置（内部の項目パスと配列位置）、逐語文字列、スナップショット ID を持つ。原本の該当箇所へ移動して表示し、現在の外部ページへのリンクは補助にする。表示テキストは HTML として実行しない。
- API データには架空の `document_id`・ページ・PDF の `anchor_status` を付けない。登録文字列の原本内検証は別の状態（確認済み / 該当なし / 原本なし）にし、PDF の `exact / normalized / fuzzy / failed` とダッシュボードの失敗率へ混ぜない。
- 人が既存 SQ を判定するときに、見ていた比較版・登録スナップショット・項目の識別子を追記記録する。API の識別子を `seen_evidence_ids` に入れず、`Decisions` の末尾への専用参照列を追加する。正式な列は issue A で確定する。undo を含めて既存履歴を残し、再取得で以前の判定根拠を差し替えない。

代替案は「登録 JSON を PDF に変換し既存 Evidence に一本化」（原本の項目位置と PDF の照合結果が混同される）と「LLM に登録と論文を渡して SQ を自動提案」（新しい AI 入力と妥当性検証が必要）。出所を分けた人の判定支援を採用し、両代替案は採用しない。

## 5. Sheets と Drive の保存設計案

**決定**: `Evidence` の対象を広げず、`RegistrySnapshots` / `RegistryLinks` / `RegistryComparisons` の三つの追記型タブを設ける。原本は Drive、判定参照は `Decisions` の専用列、出力は audit 末尾列と別添ファイルに保存する。以下の列は候補であり、正式な列・完了印・冪等規則は実装 issue A で確定する。現行のタブ構成は [sheetsSchema.ts](../src/domain/sheetsSchema.ts) を根拠とし、古い文書のタブ総数を前提にしない。

| 新タブ | 粒度と主な列 | 更新・読み取り規則 |
| --- | --- | --- |
| `RegistrySnapshots` | 一行 = 一取得原本。`snapshot_id`, `registry`, `registration_id`, `source_url`, `retrieved_at/by`, `source_version`, `source_updated_at`, `raw_ref`, `raw_hash`, `parser_version` | 原本は Drive の専用配下に保存し、大きな応答を Sheets の一セルへ詰めない。解析用データにも原本の項目パスを残す。再取得は新 ID で追記し、旧原本は不変。外部の版情報がなければ空とし、取得日時を版の日時に代用しない。 |
| `RegistryLinks` | 一行 = study と登録の関連付けイベント。`link_id`, `study_id`, `registry`, `registration_id`, `snapshot_id`, `action`（関連付け / 解除）, `created_at/by`, `note` | 複数登録を許容し、解除は追記する。`Studies.registration_id` と独立して保持する。グルーピングで新 study_id になったら関連付けを自動転記せず、旧履歴を示して再確認する。 |
| `RegistryComparisons` | 一行 = 対応表の版に属する比較項目。`comparison_id`, `set_id`, `study_id`, `annotator/type`, `schema_version`, `snapshot_ids`, 論文側 `field_id/entity_key` と値・引用の参照、登録側の項目パス・逐語文字列、候補状態、人の確認、理由、規則版、`created_at` | 一対多は項目参照の配列で表現する。論文側の参照だけでなく閲覧時の値・引用も固定し、再抽出後の表示を再現できるようにする。対応変更は新しいセットの追記。空にしたことも明示的に記録する。 |

比較セットは本文を Drive に保存して参照する方式も許容し、セル上限に達しうる配列を無制限に保存しない。完全に保存できたセットだけが有効になるよう完了印と冪等キーを定め、途中失敗したセットで旧セットを置き換えない。原本保存だけ成功しシート参照保存に失敗した場合は、同じ原本を使って再保存できるようにし、画面では未保存と表示する。失敗のたびに外部へ再照会しない。

`Decisions` の専用参照列は `registry_comparison_ids`（見ていた `comparison_id` の配列）を候補とし、判定時点を固定する。値がない旧行は参照なしとして読む。既存 audit.csv への末尾列追加と、登録比較の別添ファイル（原本参照・項目パスを含む）を実装範囲に含め、PDF の Evidence 列は維持する。登録情報だけで `StudyData` / `ResultsData` を書き換えない。

新タブがない既存プロジェクトは未利用として読めるようにする。初回保存でタブを追加する方式と旧拡張が追加列を読めるかを fixture で検証する。未利用プロジェクトに強制移行を要求しない。登録原本はプロジェクト内の共有資料となるが、比較の対応付け・メモ・確認結果は annotator ごとに分離する。独立入力では他者や AI の対応表を表示・初期値に利用せず、自分の未確認から始める。裁定で他者の対応を表示する場合は既存の裁定開始条件を守る。

代替案は「Evidence に source_type / URL / registry 列を追加して統合」（PDF のビューア・引用解決・監査出力など全読取側の再設計が必要）と「Studies.note に JSON を保存」（小さいが複数版・annotator・判定時点の追跡に不向き）。三つの新タブを採用し、両代替案は採用しない。

## 6. 外部送信・権限・同意の影響

確認した現状は次のとおり。

- [manifest.json](../src/manifest.json) の `host_permissions` は Google API と Gemini / OpenRouter / Anthropic。登録先の固定権限はない。`optional_host_permissions` に `https://*/*` があるが、これ自体は個別ホストへのアクセス許可ではない。
- [aiDataConsent.ts](../src/lib/llm/aiDataConsent.ts)、[aiDataConsentDialog.ts](../src/app/ui/aiDataConsentDialog.ts)、[aiDataConsentStore.ts](../src/lib/storage/aiDataConsentStore.ts) は LLM 呼び出し前の同意を扱い、現在の版は 3。送信内容の説明は [ja.pages.ts](../src/lib/i18n/ja.pages.ts) にあり、AI の送信先と保存を説明している。
- [hosted/privacy-policy.html](../hosted/privacy-policy.html) は冒頭・概要で Google と BYOK LLM の間の流通を説明し、データ表、Google データの第三者への送信、保存・削除も記述している。登録照会を加えると「3 者のみ」などの限定表現を同期する必要がある。

**決定**: 初回の登録照会は CT.gov だけとし、LLM 同意と独立した告知・操作にする。初めて利用者が「登録情報を取得」を押したときだけ、`https://clinicaltrials.gov/*` への optional ホスト権限を要求する。拒否しても保存済み資料と既存機能を使えるようにする。Chrome の権限許可と送信内容の説明を分け、NCT 番号だけを送ることを明示する。初回は WHO / jRCT のホスト権限を要求せず、PDF 取り込みや公開ページへの別タブリンクにも fetch 権限を要求しない。追加ホストを必要とするリダイレクトを無条件に許可しない。

| 経路 | 送信・保存の方針 |
| --- | --- |
| ブラウザ → ClinicalTrials.gov | 選択した NCT 番号だけを照会内容として送る。論文本文・抄録・プロトコル・メール・シート ID・Google OAuth トークン・LLM キーは送らない。接続元 IP 等の通常の通信情報は相手へ届く旨を説明する。 |
| ClinicalTrials.gov → ブラウザ → 利用者の Drive / Sheets | 公開登録の原本、取得時刻、比較・確認履歴をプロジェクトへ保存する。共有相手からも参照可能であること、削除方法を説明する。開発者のサーバーは設けない。 |
| 利用者 → ブラウザ → 利用者の Drive / Sheets | WHO ICTRP / jRCT の登録 PDF は利用者が取り込み、文書・引用・比較・確認履歴をプロジェクトへ保存する。この経路では拡張から WHO / jRCT への照会を行わない。 |
| ブラウザ → LLM | 取得・比較には新しい LLM 呼び出しを加えない。登録原文を新たに AI へ送る機能は今回の対象外。 |

WHO / jRCT の自動取得に必要な権限と告知は、所有者が該当登録先から単一レコード取得と利用者の Drive への保存について書面許諾を得た後、後続 issue F で取得経路とともに定義する。初回の権限や公開説明に、両登録先への自動照会を含めない。

`aiDataConsent` の対象となる AI 入力を増やさないため、同意の版は上げない。登録照会の告知と権限許可を AI 同意へ統合しない。Google の OAuth スコープも増やさない。

実装時は `hosted/privacy-policy.html` の日英の概要・表・第三者送信・保存削除・データフロー説明と図、`hosted/help.html` の日英、取り込み画面の外部送信先の注意も同期する。今回これらは変更せず、実装 issue E に含める。

## 7. ui-states.md への追加仕様の草案

以下は [ui-states.md](ui-states.md) へ実装 issue A で、画面実装より先に移す行の案。ID と文言は仮。今回は同ファイルを編集しない。

| 画面 / 要素 | 状態 | 受入基準案 |
| --- | --- | --- |
| S3 `#/documents` 登録情報カード | 未取得・番号なし | 自動通信なし。`#registry-id-candidates` に出所付き候補と手入力への導線。空・不正な番号は取得不可。候補なしとテキスト層なしを区別する。 |
| 同カード | 複数候補・登録 PDF の取り込み | 3 登録先の出所付き番号候補と複数関連付けを表示する。CT.gov は人の取得操作前に照会せず、取得で主番号を上書きしない。WHO ICTRP / jRCT は「自動取得は未対応（PDF で取り込む）」と公開ページへのリンク・PDF 取り込みへの導線を示し、拡張から照会しない。 |
| 同カード | 取得前の告知・権限未許可 | `#registry-fetch-disclosure` に送信先・登録番号・保存先を示す。初回の CT.gov 取得操作から独立告知へ進み、「取得して保存」で `https://clinicaltrials.gov/*` の権限だけを要求。キャンセル・拒否ではネットワーク要求ゼロ。AI 同意を照会の許可に流用しない。 |
| 同カード | 取得中・保存中 | `#registry-fetch-status` を読み上げ通知。二重実行を無効化し、中止を用意する。中止後の遅い応答で画面や関連付けを更新しない。 |
| 同カード | 取得失敗・未該当・保存失敗 | `#registry-fetch-error`（`role=alert`）。未該当、通信失敗、制限、応答不正、保存失敗を区別する。既存スナップショットは維持し、自動再試行はしない。保存失敗は取得済み原本の再保存を可能にする。 |
| 同カード | 取得済み・再取得 | 登録名、番号、取得時刻、版情報の有無を表示。「再取得」は明示操作だけで、旧版を保持する。関連付け解除は原本削除と区別する。 |
| S8 `#/verify` 突き合わせカード | 読込中・空・失敗 | `#registry-compare-status` に状態を表示。登録未取得・スキーマに項目なし・論文値なしを区別して対応する導線を出す。比較に失敗しても既存の検証を継続できる。 |
| 同カード | 通常・対応編集 | `#registry-comparison` に項目・登録原文・論文値と引用・候補状態・人の確認を並べる。CT.gov の API 原本と WHO ICTRP / jRCT の登録 PDF のどちらでも同じカードを使う。PDF は文書・ページ・引用へ参照でき、手動対応・D5 支援・保存 / 再読込を利用できる。対象登録版と対象結果を常時表示し、対応変更や保留理由は保存操作で新しい版にする。 |
| 同カード | 最新版のみ・履歴・版選択 | 最新版と比較する場合は「事前の指定は確認できていない」を表示する。確認済みの履歴は版数（未取得ならその旨）・最終変更日・履歴ページリンクを示す。履歴自体が未確認なら「履歴の有無未確認」と原登録確認への導線を示す。API で過去版を取得できる場合だけ選択 UI を有効にし、選択版を保存・再表示できる。 |
| 同カード | 根拠の表示 | 論文側は出所 PDF の引用へ、登録側は保存原本の項目へ移動。外部原本へのリンクは別タブ。日付・登録履歴が不十分なら事前指定を断定する文言を出さない。 |
| 同カード | D5 支援・SQ なし | SQ 5.1〜5.3 ごとの根拠と不足を示す。SQ の回答や D5 判定は自動入力しない。SQ なしはテンプレート導入の案内にとどめる。結果単位 D5 オーバーライドへ誘導し、対象結果と保存先を一致させる。 |
| 同カード | 独立入力・裁定 | 独立入力は公開原本と自分の比較・引用だけを表示。他者と AI の対応付け・判定は出さない。他者の対応付けは裁定開始条件を満たして裁定が開いた後のみ表示する。閲覧だけでは自分の確認を記録しない。 |
| 同カード | 再抽出・登録再取得・study 再編後 | 既存の確認は当時の版に固定する。新しい資料があることを注記し、再比較で別版を作る。別 study への引継ぎは人に確認し、過去判定を書き換えない。 |
| 新カード共通 | キーボード・ヘルプ・表示言語 | 見出しは `headingWithHelp` と topics 対応表へ追加。日英ヘルプを用意し、ボタン・対応表をキーボード操作可能にする。ダイアログを採る場合はフォーカス移動・復帰・Esc 取消を定義し、背後の判定キーを止める。 |

## 8. 決定事項（2026-11-13）

1. 所有者の範囲決定（2026-11-13）: 初回は ClinicalTrials.gov の NCT 番号指定による単一試験 GET を自動取得とする。WHO ICTRP / jRCT は自動取得せず、既存の `document_role=registration` で登録 PDF を取り込み、同じ比較カードで突き合わせる。番号候補は引き続き検出し、「自動取得は未対応（PDF で取り込む）」と公開ページのリンクを表示する。所有者が WHO と jRCT 運営者（厚生労働省）へ単一レコード取得・利用者自身の Drive への保存の許諾を問い合わせ、登録先ごとの書面許諾後に後続 issue F で自動取得を追加する。
2. Codex が公式資料を Web 調査し、API の事実・出典 URL・確認日を本書へ記録する。実装後、所有者がインストール済み拡張から CT.gov の実呼び出しと WHO ICTRP / jRCT の PDF による比較を確認する。
3. 最新版しか取得できない場合は最新版と比較し、「事前の指定は確認できていない」と表示する。履歴の存在、取得可能な版数・最終変更日と履歴ページのリンクを可視化する。API で過去版を取得できる場合は利用者が版を選べる。
4. 一つの study に出所付き候補一覧と複数登録の関連付けを持たせる。S3 の `registration_id` は主番号として維持し、取得では上書きしない。
5. AI は使わず、主要・副次アウトカム、評価時点、予定症例数、登録日と開始日を比較する。対応付けは人が決め、名称完全一致だけを候補として提示する。新規 LLM 呼び出しを加えず、`aiDataConsent` は変更しない。
6. D5 の SQ 5.1〜5.3 ごとに根拠と不足を示し、結果単位 D5 オーバーライドへ誘導する。SQ 回答と D5 判定は自動入力しない。
7. 追記型の `RegistrySnapshots` / `RegistryLinks` / `RegistryComparisons`、Drive の原本、`Decisions` の専用参照列、audit CSV の末尾列と別添出力を採用する。正式な列は実装 issue A で確定する。
8. 取得と関連付けは S3、比較表と D5 支援は S8 のカードに置く。独立入力では公開登録原本と本人の比較だけを示し、他者の対応付けは裁定が開いた後に限る。
9. 初回の取得ボタン操作で `https://clinicaltrials.gov/*` だけの optional ホスト権限を要求し、NCT 番号だけを送る旨を独立告知する。WHO / jRCT のホスト権限は要求しない。AI 同意とは分離し、`aiDataConsent` の版は上げない。
10. 所有者の公開条件の更新（2026-11-13）: CT.gov の実呼び出し、WHO ICTRP / jRCT の PDF による比較、各経路の保存・再読込、日英ヘルプとプライバシーポリシー更新の完了後、一つのリリースにする。WHO / jRCT の自動取得に関する問い合わせ・書面許諾は並行する所有者タスクとし、許諾待ちは初回リリースを妨げない。

## 9. 実装 issue の分割案

設計レビューと範囲決定（2026-11-13）は完了しており、以下を自己完結した実装 issue として起票する。初回の依存順は A → B → C → D → E とし、CT.gov の自動取得と WHO ICTRP / jRCT の登録 PDF 比較を E の確認後に一つのリリースとして公開する。所有者は書面許諾の問い合わせを並行して進める。F は初回の完了条件に含めず、該当登録先の書面許諾後に着手する後続 issue とする。

| 仮題 | 範囲 | 受け入れ条件 |
| --- | --- | --- |
| A: CT.gov と登録 PDF の項目対応・UI・保存仕様の確定 | 本書の公式調査を基に CT.gov API の項目・取得契約・利用条件・ホスト・履歴取得可否と、WHO ICTRP / jRCT の PDF 上の比較項目・引用参照を確定し、requirements と ui-states へ移す。三つの新タブ・Drive 原本・Decisions 参照・audit 末尾列・別添の正式な列を決める | 比較項目ごとに CT.gov の項目パス、WHO ICTRP / jRCT の PDF 原文・文書 / ページ / 引用の参照方法、欠損時の扱いを記録する。CT.gov の単一 GET・制限・保存再利用条件の未確認を解消するか制約として明示し、初回の取得権限を `https://clinicaltrials.gov/*` に限定する。履歴・版選択、正式な列・完了印・冪等規則が画面実装前に定義されている。WHO / jRCT の API 契約・書面許諾の確認は F に残し、A の完了条件にしない。 |
| B: CT.gov の取得と 3 登録先の候補・PDF 関連付け・原本保存 | CT.gov の NCT 番号指定 GET、独立告知と任意ホスト権限、3 登録先の出所付き候補一覧・複数関連付け、WHO ICTRP / jRCT の登録 PDF 取り込み、Drive 原本と追記型タブ、再取得・解除 | CT.gov の正常系・未該当・制限・不正応答・拒否・中止・通信失敗・部分保存を固定 fixture / fake で検証。WHO ICTRP / jRCT は「自動取得は未対応（PDF で取り込む）」と公開ページリンクを表示し、登録先への fetch・権限要求はゼロ。候補なし・複数・手入力を検証し、取得や PDF 関連付けで主番号を上書きしない。両登録先の PDF を `document_role=registration` として関連付けられ、旧プロジェクトを開け、再取得や関連付け変更でも旧原本と履歴を保持する。 |
| C: API 原本と登録 PDF に共通の S8 比較カード | 主要 / 副次アウトカムと時点・予定症例数・登録 / 開始日、項目別原文、手動対応、日付精度、予定と実績の分離、版選択、annotator 別保存 | CT.gov の API 原本と WHO ICTRP / jRCT の登録 PDF の両方で同じ比較カードを利用できる。完全一致名だけを候補とし、新規 LLM 呼び出しを行わない。一対多・多対一・欠落・スキーマ不足・期間の重なりと、PDF の文書 / ページ / 引用への参照を検証。最新版のみの注意、履歴の確認状態・版数 / 未取得・更新日・リンクを表示し、CT.gov の API で取得可能な過去版は人が選択できる。各経路の手動対応・確認 / 保留を保存・再読込でき、再抽出・再取得・PDF 追加・study 再編でも旧比較版を保持する。独立入力に他者の対応を出さず、裁定開始後だけ表示する。 |
| D: API 原本・登録 PDF の D5 支援と監査出力 | SQ 5.1〜5.3 別の資料と不足、結果単位 D5 オーバーライドへの誘導、判定時参照、原本項目 / PDF 引用表示、audit と別添出力 | CT.gov の API 原本と WHO ICTRP / jRCT の PDF の両方で SQ ごとの根拠・不足を示し、SQ 回答・D5 判定を自動入力しない。対象結果と保存先の一致、API と PDF の参照の区別、判定・undo 後の当時資料の復元、原本欠損の明示を検証。audit は既存列を維持して末尾へ参照を追加し、別添から比較版と各経路の原本参照をたどれる。API 原本は PDF の anchor 集計へ混入しない。 |
| E: 初回範囲の公開説明同期とリリース前検証 | CT.gov の照会・任意権限と WHO ICTRP / jRCT の PDF 経路、日英ヘルプとプライバシーポリシー・図・ツアー影響確認、ローカルと所有者の実機通し確認 | 公開前に CT.gov の送信内容・任意権限・拒否 / 取消を揃え、WHO / jRCT へ自動照会しないことを説明し、AI 同意版は据え置く。所有者が CT.gov の実呼び出し、WHO ICTRP / jRCT それぞれの PDF による比較・D5 支援、全経路の保存 / 再読込と出力を確認し記録する。jest 100%、型・lint・dev ビルド、統合担当の E2E が完了し、日英ヘルプとプライバシーポリシーが実際の送信・保存に一致した後、一つのリリースにする。WHO / jRCT の書面許諾待ちは公開を妨げない。 |
| F: 書面許諾後の WHO ICTRP / jRCT 自動取得 | 所有者が各運営者へ利用者操作による単一レコード取得と利用者自身の Drive への保存の可否を問い合わせる。該当登録先の書面許諾後に、取得契約・項目対応・履歴・保存再利用条件・必要ホスト・独立告知を確定し、自動取得を追加する | 登録先ごとに回答元・回答日・許諾対象の操作 / 保存・制約を記録した書面があり、その登録先の実装着手条件を満たす。未回答・不許可なら自動取得を追加せず PDF 経路を維持する。許諾範囲内で fake / fixture の正常・失敗系を検証し、所有者の実呼び出しと Drive 保存 / 再読込を確認する。日英ヘルプ・プライバシーポリシー・任意権限の説明を同期して後続リリースへ追加する。片方の許諾を他方へ流用せず、初回リリースの条件へ戻さない。 |

公式資料の確認担当は Codex、CT.gov の実呼び出し・各登録先の PDF 比較の確認と、WHO / jRCT への問い合わせ・書面許諾の記録担当は所有者とする。実装者のローカル検証は固定 fixture と fake を使い、実 API 呼び出しを unit / E2E に混ぜない。B の途中で取得機能だけを公開せず、E の説明同期と一緒に出す。F は登録先ごとに書面許諾を条件として進め、初回リリースと切り離す。

## 10. 実機 / 実 API 確認の計画

公式資料の Web 調査は実施済みだが、実 API 呼び出しは未実施。初回実装後、所有者がインストール済み拡張から CT.gov の自動取得と WHO ICTRP / jRCT の登録 PDF による比較を確認する。WHO / jRCT への実呼び出しや書面許諾は初回の確認条件に含めない。

1. CT.gov の NCT 番号指定による単一試験 GET が拡張オリジンから実行できること。任意権限は `https://clinicaltrials.gov/*` だけで、拒否・取消・再許可と、送信内容が NCT 番号に限定されていることを確認する。
2. WHO ICTRP / jRCT それぞれの登録 PDF を `document_role=registration` として取り込み、出所付き番号候補・「自動取得は未対応（PDF で取り込む）」の表示と公開ページリンクを確認する。各 PDF を同じ S8 比較カードで論文と並べ、手動対応・確認 / 保留・SQ ごとの根拠と不足・結果単位 D5 への誘導を利用できることを確認する。この操作で WHO / jRCT への照会やホスト権限要求が発生しないことを確かめる。
3. CT.gov の取得原本と登録 PDF の両経路で、主要・副次アウトカム、時点、予定 / 実績、日付と精度を照合する。最新版のみなら「事前の指定は確認できていない」、履歴の存在・版数 / 未取得・更新日・履歴リンクが見えることを確認する。履歴不明を区別し、CT.gov の API で取得できる過去版は選択・保存・再読込も確認する。PDF では対象版と文書 / ページ / 引用を参照できることを確かめる。
4. CT.gov の未該当、通信制限・失敗、応答仕様変更時に古い資料を維持し、明示操作で再試行できることを確認する。PDF 原本や保存の失敗も含め、障害は可能な範囲を fake で再現し、実サービスへ負荷を掛けて作らない。
5. 全経路の Drive / Sheets 保存、再入場・別端末・共有時の復元、比較の再読込、独立入力の分離、D5 判定時の原本参照と出力を確認する。
6. 本番に相当する日英の告知・ヘルプ・プライバシーポリシーと、CT.gov の送信先・保存先、WHO ICTRP / jRCT の PDF 取り込み経路を照合する。

実装 issue の起票時に [remaining-work-plan.md](remaining-work-plan.md) の「実機 / 実 API テストが必要な項目」へ本計画を登録し、確認結果を得るまでは設計やローカルテストだけで確認済みにしない。今回は本設計書のみを更新する。CT.gov の実呼び出し、WHO ICTRP / jRCT の PDF 比較、保存 / 再読込、日英ヘルプとプライバシーポリシーの同期を終えて一つのリリースにまとめる。

所有者は WHO（ICTRP Web Service）と jRCT 運営者（厚生労働省）への許諾問い合わせを並行して進める。未回答や許諾待ちは初回公開を妨げない。F で追加する登録先の実呼び出し・Drive 保存 / 再読込の確認は、その登録先について書面許諾を得て実装した後に行い、後続リリースの条件として別に管理する。
