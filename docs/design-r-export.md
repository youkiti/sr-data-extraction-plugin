# R 解析対応 CSV エクスポート 設計書（issue #60・確定版）

- **作成日**: 2026-07-12 / **ステータス**: **確定・PR-A（core）実装済み**。builder 純関数群 + golden fixture + jest テストまで完了。S10 UI 配線（Drive への複数ファイル出力・`ExportLog` 拡張・生成完了カードの案内文）は **PR-B のスコープ**で本 PR には含まない
- **対象 issue**: [#60 feat: R解析対応に向けたCSVエクスポート設計を確定する](https://github.com/youkiti/sr-data-extraction-plugin/issues/60)
- **前提**: issue #60 の設計ドラフト（コメント）と、オーナーとの合意メモ 2 件（2026-07-12）で D-1〜D-6 が確定済み。本書はその確定内容をそのまま実装可能な契約へ落とし込み、実装時に追加で必要になった判断（§7）を明記する

## 0. 背景と方針（再掲）

今後の後工程は原則として **R + AI** に委ねる。アプリ内でメタ解析・単位換算・可視化まで完結させるのではなく、研究者が目視でき、R/AI が安全に再利用できる自己記述的な CSV を出力することを目標とする。

- **値は原報告のまま**。単位換算・SD 換算は R + AI 側（requirements.md §3.3 の既存判断を踏襲）
- **join キーは安定 ID のみ**（`study_id` / `field_id` / `entity_key` 派生列）。`study_label` は表示専用で重複しうる
- **行を黙って落とさない**。除外（確定 annotator 不明・未知 field_id・重複キー）は必ず `export_issues.csv` に明示する
- **確定 annotator の選定規則は既存の `finalAnnotator.ts`**（consensus が 1 件ならそれ、なければ唯一の human 行）を変えずそのまま再利用する。規則自体は manifest にも記録する

## 1. D-1〜D-6 確定内容（オーナー合意メモ 2026-07-12）

| # | 内容 |
|---|---|
| D-1 | 既存 3 形式（`study_wide` / `results_long` / `audit`）は維持。**R セットを第 4 の形式として追加**。既存形式への変更は audit.csv への `study_id` 列追加のみ（列追加のみ・既存列不変更） |
| D-2 | ステータスのミラー表パターンを採用（`tab1_status.csv` / `ma_status.csv`） |
| D-3 | comparison ペア展開は**廃止**。`ma.csv` は **arm 単位の long**（1 行 = study × outcome × timepoint × arm）。comparison 生成は R 側の標準機能（`netmeta::pairwise()` 等）に委ねる |
| D-4 | unverified セルは値列空・ステータスのみ `unverified`。AI 生値の別ファイル（`ma_ai.csv` 等）は作らない |
| D-5 | `reported_unit` は v1 では出さない（[#76](https://github.com/youkiti/sr-data-extraction-plugin/issues/76) へ分離済み） |
| D-6 | 文字コードは UTF-8・**BOM なし**（R 最優先。Excel 向け案内は PR-B スコープ） |

既存 3 形式の builder（`buildStudyWideCsv.ts` / `buildResultsLongCsv.ts`）は本 PR で変更しない。`buildAuditCsv.ts` のみ `study_id` 列を追加する（§8）。

## 2. 出力ファイルセット

1 回の R セットエクスポート = 以下 8 ファイルを一括生成する（`buildRSet.ts` が返す `BuiltRSet.files`。実際の Drive 保存・フォルダ命名は PR-B）。

| ファイル | 1 行の単位 | 主キー |
|---|---|---|
| `tab1.csv` | 1 study | `study_id` |
| `tab1_status.csv` | tab1 と同形（値列をステータス語彙へ置換） | `study_id` |
| `ma.csv` | study × outcome × timepoint × arm | `study_id, outcome_id, timepoint, arm_id` |
| `ma_status.csv` | ma と同形（値列をステータス語彙へ置換） | 同上 |
| `rob.csv` | study × RoB ドメイン（long） | `study_id, tool, domain_id` |
| `data_dictionary.csv` | 1 スキーマ項目 | `field_id` |
| `export_issues.csv` | 1 除外/警告イベント | なし |
| `export_manifest.json` | メタデータ | — |

文字コードは UTF-8・BOM なし（`csvEncode.ts` の `buildCsv` は BOM を付けない。既存 3 形式が使う BOM 付きの表記〔`CSV_BOM`〕とは別経路）。改行は既存 3 形式と同じ CRLF（`buildCsv` 共通）。

## 3. ステータス語彙とミラー表パターン

数値列に `NR` 等のトークンを混ぜると R の `read_csv()` で型崩れするため、**値の表とまったく同形のステータス表**を対で出す。値列は「verified のときだけ実値・それ以外は空文字」で純粋にし、状態は必ずミラー側で判別する（D-4 を全ステータスへ一貫適用）。

| ステータス | 意味 | 値列 |
|---|---|---|
| `verified` | 人間が `accept` / `edit` / `reject` のいずれかで確定した値がある | 実値 |
| `not_reported` | 人間が `not_reported` と確定した | 空 |
| `unverified` | AI 値（Evidence）はあるが人間の判定が 0 件 | 空（automation bias 対策。AI 生値を解析用 CSV に流さない） |
| `no_data` | Evidence も判定もない | 空 |
| `not_applicable` | スキーマ上その study / インスタンスに適用されない（§5） | 空 |

`rob.csv` は元から long 形式のため `verification_status` を通常の値列として持つ（ミラー表は作らない）。

### 3.1 ステータス導出の実装（`rsetStatus.ts`）

`StudyData` / `ResultsData` の annotator 行は、判定のたびに書き込まれる「現在の確定値」をそのまま保持している（`values[field_name]` は未報告時に `NOT_REPORTED_TOKEN`〔`'NR'`〕、未検証時に `null`）。この規約は `verification/cellState.ts` が `Decisions` から折り畳む結果と等価であるため、本実装は **`Decisions` を再度畳み込まず、annotator 行の値をそのまま読む**（`resolveRSetStatus` / `resolveRSetValue`）。理由と根拠は §7.1 に記す。

```
resolveRSetStatus(rawValue, hasEvidence):
  rawValue === null            → hasEvidence ? 'unverified' : 'no_data'
  rawValue === NOT_REPORTED_TOKEN → 'not_reported'
  それ以外                      → 'verified'

resolveRSetValue(rawValue, status):
  status === 'verified' ? rawValue : ''
```

`accept` / `edit` / `reject` はいずれも「人間が確定した実値」を `annotator` 行へ書くため区別せず `verified` へ畳み込む（`reject` は AI 値棄却後の手入力だが、書き込まれる値の性質は `edit` と同じ）。

## 4. 各表の列契約

### 4.1 `tab1.csv` / `tab1_status.csv`（研究特性・全変数）

キー列: `study_id`, `study_label`, `registration_id`, `n_documents`, `schema_version`。以降は **study レベル全項目**を `field_name` 列で横持ち（`fieldIndex` 順。既存 `buildStudyWideCsv.ts` と同じ展開ロジック + join キー列を前置）。

- `n_documents`: Documents タブの当該 study 所属文書数（`documentStudyIds` 引数 = Documents 1 件 = 1 要素の study_id 配列を件数集計）
- `schema_version`: 確定 annotator 行（`StudyDataRow`）が実際に記録している版
- `registration_id`: 無ければ空文字
- 感度分析・サブグループ用の共変量は tab1 に study レベル全項目としてそろうため、R 側で `study_id` join して後付けする（合意メモの結論。`analysis_role` タグ付けは実装しない）

`tab1_status.csv` は同じ列名で、キー列（`study_id`〜`schema_version`）は値をそのまま複製し、`field_name` 列だけをステータス語彙へ置換する。

### 4.2 `ma.csv` / `ma_status.csv`（解析単位・arm 単位 long）

- **1 行の単位**: outcome_result レベルの entity インスタンス（entity_key `outcome:<slug>|arm:<slug>|time:<token>` をパース）。**arm セグメントの無い項目は `arm_id` / `arm_label` 空欄の行**として同表に出す（比較レベル報告の HR 等）
- **インスタンス列挙**: 検証画面と同じ `verification/cells.ts` の `entityInstances()`（Evidence / Decisions からの集合 + `ArmStructures` 確定済み arm への展開）を再利用しつつ、**確定 annotator の `ResultsData` に実在する entity_key を必ず合流**させる（§7.2 の防御的完全性）
- **キー列**: `study_id`, `study_label`, `outcome_id`（entity_key の `outcome:<slug>`）, `outcome_label`（§4.2.1）, `timepoint`（`time:` トークン原文）, `timepoint_value` / `timepoint_unit`（§6 の best-effort パース）, `arm_id`（arm slug）, `arm_label`（**ArmStructures の確定名**。未確定・未登録 arm は空）, `rob_tool` / `rob_overall_judgement`（study 単位で 1 回だけ解決し全 outcome 行へ複製。§4.2.2）, `schema_version`（そのインスタンスに実在する `ResultsData` 行の `schema_version` 最大値。データが無ければ空）
- **値列**: outcome_result レベルの全 `field_name` を列で横持ち（`fieldIndex` 順）
- **ソート**: study（入力順）→ `outcome_id`（文字列昇順）→ `timepoint`（文字列昇順。空は先頭）→ `arm_id`（`ArmStructures` の確定順、無ければ文字列昇順でタイブレーク）

#### 4.2.1 `outcome_label` の解決規約（v1 で新設）

outcome の slug（例 `mortality`）自体は人間可読な短い識別子である前提だが、より読みやすいラベルを別途持たせたい場合のために、**`outcome_name`（`field_name` 予約名。entity_level = `outcome_result`）という項目名の慣習を新設**する。スキーマにこの `field_name` の項目があれば、その verified 値を `outcome_label` へ複製する。無ければ空文字（`outcome_id` の slug で代用可能）。RoB テンプレートの `rob2_judgement` / `rob2_support` と同じ「予約 field_name による規約」方式であり、`draft-schema` / `extract-data` skill のプロンプト本文は変更しない。

#### 4.2.2 `rob_tool` / `rob_overall_judgement` の複製列

`rob.csv` の `rob:overall` ドメイン判定を、study 単位で 1 回だけ解決し、その study の全 outcome 行へ複製する（合意メモ「study 別 overall のみ」）。

- `rob_tool`: スキーマに挿入されている RoB テンプレート種別（`rob2` / `robins_i`）。**RoB テンプレート未挿入なら常に空文字**（ステータス語彙〔no_data 等〕は出さない = RoB という概念自体が存在しないことを表す）
- `rob_overall_judgement`: `rob:overall` ドメインの judgement 値（verified のときのみ）。`ma_status.csv` 側は対応する verification_status を持つ
- **v1 の割り切り**: 理論上 RoB 2 と ROBINS-I の両テンプレートが同一スキーマに同時挿入されうるが、その場合は `robFields.ts` の列挙順（RoB 2 優先）で先頭の 1 種類だけを複製列に使う。両立ロジックは実装しない（通常は 1 study に 1 デザイン = 1 ツールを想定するための割り切り）

### 4.3 `rob.csv`（robvis 派生元）

列: `study_id`, `study_label`, `tool`（`rob2` / `robins_i`）, `domain_id`（entity_key `rob:<domain_id>` から）, `domain_label`, `sq_id`（signaling question 行のみ。[#61](https://github.com/youkiti/sr-data-extraction-plugin/issues/61) 実装後まで常に空）, `outcome_id`（result-level RoB。v1 は常に空）, `entity_key`（原文・監査用）, `judgement`, `support`, `verification_status`, `schema_version`。

- **ドメイン列挙はスキーマ駆動**: `outcome_result` と異なり RoB ドメインは AI ドラフト非対応でテンプレート挿入が唯一の入口（requirements.md §3.3）のため、ドメイン一覧は `Evidence` / `Decisions` からのデータ駆動ではなく、`schema/presets/robTemplates.ts` の `ROB2_DOMAINS` / `ROBINS_I_DOMAINS` から**直接列挙**する。これにより、AI が抽出できていない・人間が未着手のドメインも `no_data` 行として必ず出現する（幽霊セルの分母と同じ思想。requirements.md §3.3 の追記）
- **tool 判別**: `field_name` の予約名規約（`rob2_judgement` / `rob2_support` / `robins_i_judgement` / `robins_i_support`）で判別する（`robFields.ts`）。この 4 命名以外の RoB 項目（利用者が手動で `field_name` を変更した場合）は v1 では `rob.csv` に出現しない既知の制約（§9）
- `verification_status` は **judgement 項目のセル状態を採用**する（judgement が RoB ドメインの主判定であり、`required=true` の項目のため）。`support` 列は support 項目自身が verified のときだけ値を出す（judgement とは独立に空になりうる）
- `judgement` / `support` が現行スキーマに存在しない（`support` を消したスキーマ等）ときは、その列を常に空にする

### 4.4 `data_dictionary.csv`

エクスポートに使う最新確定版 `SchemaFields` の全項目: `field_id`, `field_name`, `field_label`, `section`, `entity_level`, `data_type`, `unit`, `allowed_values`, `required`, `extraction_instruction`, `example`, `schema_version`（`field_label` は issue 本文の候補になかったが、可読性のため追加した）。`fieldIndex` 順。

**注記**: `ma.csv` の `rob_tool` / `rob_overall_judgement` は `SchemaFields` に実在しない複製列（§4.2.2）のため、`data_dictionary.csv` には出現しない。R 利用者はこの設計書（本節）を正典として参照する。

### 4.5 `export_issues.csv`（黙示的除外の防止）

列: `issue_type`, `study_id`, `field_id`, `entity_key`, `detail`。

| issue_type | 検出元 | 粒度 |
|---|---|---|
| `skipped_study_no_final_annotator` | `tab1.csv` / `ma.csv` / `rob.csv` の各 builder が**独立に**検出（§7.3） | study 単位。1 事象が複数ファイルに影響する場合は**ファイルごとに 1 行ずつ**出す |
| `dropped_unknown_field` | `issues.ts` の横断チェック（`StudyData` の値列キー・`ResultsData` の `field_id` が現行 `SchemaFields` に無い） | 値列キー / `field_id` 単位（重複は 1 件へ畳み込む） |
| `duplicate_key` | `issues.ts` の横断チェック（`StudyData` は `study_id × annotator × annotator_type`、`ResultsData` はそれに `entity_key × field_id` を加えた完全一致） | 重複キー単位 |
| `unverified_cell` | `tab1.csv` / `ma.csv`（`rob_overall_judgement` 含む）/ `rob.csv` の各 builder が自分の列構成に応じて積む | セル単位 |

方針は「**警告 + 明示行**」で、エクスポート自体はブロックしない（既存の警告ダイアログ `role=alertdialog` の続行/中止ゲートは PR-B で R セットにも適用する想定）。

### 4.6 `export_manifest.json`

```json
{
  "export_format_version": "1.0",
  "schema_version": 5,
  "exported_at": "2026-07-12T09:00:00Z",
  "app_version": "0.2.0",
  "review_mode": "single_with_ai",
  "final_annotator_rule": "consensus が 1 件ならそれ、なければ唯一の human 行",
  "files": { "tab1.csv": { "rows": 3 }, "ma.csv": { "rows": 12 }, "...": {} },
  "issues_summary": { "skipped_study_no_final_annotator": 3, "unverified_cell": 2 }
}
```

`buildExportManifest()` は**純関数**（`exported_at` / `app_version` / `review_mode` は呼び出し側が引数で渡す。`Date.now()` を内部で呼ばない）。`schema_version` は渡された `SchemaFields` の最大 `schemaVersion`（0 = 未確定スキーマ）。`export_format_version` は列の追加 = マイナー、意味変更/削除 = メジャーで運用する。

## 5. `not_applicable` 認識規則

「インスタンスが二値プリセット項目群にのみ値を持つ場合、連続プリセット専用項目は `not_applicable`。逆も同様。認識できない場合は `no_data`」の実装（`presetFields.ts`）:

1. 連続専用項目名の集合 `CONTINUOUS_ONLY_FIELD_NAMES` と二値専用項目名の集合 `BINARY_ONLY_FIELD_NAMES` を、`schema/presets/outcomeTemplates.ts` の `OUTCOME_TEMPLATE_CONTINUOUS` / `OUTCOME_TEMPLATE_BINARY` の `field_name` から**導出**する（ハードコードしない。プリセット定義が変わっても自動追従する）。2026-07-12 時点で連続専用 12 項目（`outcome_mean` / `outcome_sd` / `outcome_se` / `outcome_ci_lower` / `outcome_ci_upper` / `outcome_ci_level` / `outcome_median` / `outcome_q1` / `outcome_q3` / `outcome_min` / `outcome_max` / `outcome_n`）・二値専用 2 項目（`outcome_events` / `outcome_total`）で、両集合は互いに素
2. あるフィールドの基底ステータス（§3.1 の `resolveRSetStatus` の結果）が `no_data` のときだけ判定する（`verified` / `not_reported` / `unverified` は対岸判定をせずそのまま）
3. 対象フィールドが連続専用項目 かつ 同一インスタンスの二値専用項目のいずれかが `no_data` 以外 → `not_applicable`
4. 対象フィールドが二値専用項目 かつ 同一インスタンスの連続専用項目のいずれかが `no_data` 以外 → `not_applicable`
5. 対岸側も全滅（`no_data` のみ）、または対象がどちらのプリセットにも属さない項目（カスタム項目） → 元の `no_data` のまま（判断材料が無いため「認識できない」を安全側〔誤って `not_applicable` にしない〕へ倒す）

## 6. `timepoint` の best-effort パース

`extract-data` skill のプロンプト例（`|time:30d` 等）が示す「数値 + 英字単位」の緩い規約のみを対象にする。正式なフォーマット規定は無いため、規約外の自由記述（`baseline` / `術後6ヶ月` 等）は失敗として `timepoint_value` / `timepoint_unit` を空にし、`timepoint` 列（entity_key の time セグメント原文）から人間・R 側で読み取れることを最終防衛線にする。

```
pattern: /^(\d+(?:\.\d+)?)\s*([a-zA-Z]+)$/
"30d"     → { value: "30",  unit: "d" }
"12.5 W"  → { value: "12.5", unit: "w" }（単位は小文字化のみ。意味づけ〔日/週/月等〕はしない）
"baseline" → { value: "",   unit: "" }
```

## 7. 実装時の追加判断（issue 設計ドラフトからの発展）

issue 本文・設計ドラフトのコメントには明記されていなかったが、実装を通して確定させた判断を記録する。

### 7.1 ステータス導出に `Decisions` の再畳み込みを使わない

`verification/cellState.ts` の `deriveCellStates()` は `Decisions` を `decided_at` 昇順で畳み込んで現在状態を導く。当初はこれを R セットでも再利用する想定だったが、実装過程で **`StudyData` / `ResultsData` の annotator 行自体が、この畳み込み結果と常に一致する「現在値」を保持している**（判定のたびに annotator 行へ即時書き込みされる設計〔requirements.md §4.2〕であり、`undo` も「1 件戻した後の値」を annotator 行へ書き戻す）ことを確認した。そのため R セットでは annotator 行を直接読み、`NOT_REPORTED_TOKEN` の規約だけを共有する軽量な `resolveRSetStatus` / `resolveRSetValue`（`rsetStatus.ts`）を新設した。

- 既存 3 形式（`buildStudyWideCsv.ts` / `buildResultsLongCsv.ts`）も同じ前提で annotator 行を直接読んでおり、実装方針の一貫性が保てる
- `Decisions` の畳み込みロジックを 2 箇所（`cellState.ts` と R セット側）で独立に保守するリスクを避けられる
- `Decisions` / `Evidence` は「インスタンス列挙」（§4.2 の `entityInstances()`）と `hasEvidence` 判定のためだけに参照する

### 7.2 `ma.csv` のインスタンス列挙: `entityInstances()` と `ResultsData` 実在キーの union

`entityInstances()`（Evidence / Decisions 駆動）だけに頼ると、「`ResultsData` 行は存在するが対応する `Evidence` / `Decision` が無い」レアケース（データ移行時の欠落等）でインスタンスごと `ma.csv` から**黙って消えうる**ことが golden fixture 作成中に判明した。要望 6「黙示的なデータ除外を防ぐ」の趣旨に反するため、`buildMaCsv.ts` は確定 annotator の `ResultsData` に実在する `entity_key`（`outcome_result` レベルにパースできるもの）を必ず `entityInstances()` の結果へ合流させる。`rob.csv` は §4.3 のとおりスキーマ駆動列挙のため、この問題は発生しない。

### 7.3 `skipped_study_no_final_annotator` はファイルごとに個別計上する

`ma.csv` と `rob.csv` はどちらも `ResultsData` から確定 annotator を解決するため、同一 study の同一原因（例: human 行が 2 件で一意化できない）で **2 回**（`ma.csv` 向け・`rob.csv` 向け）issue が積まれる（`tab1.csv` は `StudyData` 側の解決のため独立に 1 回）。単一事象に対して複数行が出るのは冗長に見えるが、「どのファイルが影響を受けたか」を `detail` 文言で個別に特定できる利点を優先した（各 builder は他の builder の実行結果を知らない疎結合設計を保つため、事後の重複排除もしない）。`export_manifest.json` の `issues_summary.skipped_study_no_final_annotator` はこの行単位の件数をそのまま合計する。

### 7.4 arm レベルの `SchemaFields` は v1 の R セットに含まれない

`entity_level = 'arm'` のスキーマ項目（介入内容・群別 N 等）は、`tab1.csv`（study 単位）にも `ma.csv`（outcome_result 単位 + arm 列）にも現れない。これは issue #60 の合意メモ・設計ドラフトの `ma.csv` 列契約（「測定値列: outcome_result レベルの全項目を横持ち」）をそのまま実装した結果であり、**既知のスコープ制約**として次回機能追加の候補に残す（arm レベル項目を `ma.csv` の各 arm 行へ横持ち複製する等）。`results_long.csv`（既存形式）には arm レベル値も引き続き出力されるため、R 側で完全な生データが必要な場合はそちらを参照できる。

### 7.5 `buildLookup` の annotator 完全一致は `(annotator, annotator_type)` のペアで判定する

`annotator` の文字列が一致していても `annotator_type` が異なる行（例: `'ai'` 行、または `annotator='consensus'` だが `annotator_type` が誤って `human_with_ai` になっている壊れたデータ）は値解決の対象から除外する。`selectFinalAnnotator` の `consensus.length === 1` 判定は `annotator_type === 'consensus'` の行だけを見るため、`annotator` 文字列が同じでも `annotator_type` が異なる decoy 行が紛れ込んでいても確定 annotator の選定自体には影響しない（テストケースで確認済み）。

## 8. `audit.csv` への `study_id` 列追加（D-1）

既存 `AUDIT_HEADER` の `study_label` の直後に `study_id` を追加した（列追加のみ・既存列は不変更）。

```
旧: study_label, document_id, entity_key, field_id, ...(計 27 列)
新: study_label, study_id, document_id, entity_key, field_id, ...(計 28 列)
```

`study_id` は `study.studyId`（`Studies` 由来）をそのまま出す。`study_label` は編集・重複しうるため join キーには使えなかった問題（要望 1）をこれで解消する。既存テスト（`buildAuditCsv.test.ts`）の列インデックス期待値・`app-export.spec.ts` の列数アサーション（27 → 28）は本 PR で更新済み（意図した仕様変更としてオーナー合意済み）。

## 9. R 読み戻し例

```r
library(readr)

tab1  <- read_csv("tab1.csv")
stat  <- read_csv("tab1_status.csv")

# 未検証セルを NA 化する例（ミラー表 join。列順・行順は同一のため位置で対応可能）
verified_only <- tab1
value_cols <- setdiff(names(tab1), c("study_id", "study_label", "registration_id", "n_documents", "schema_version"))
for (col in value_cols) {
  verified_only[[col]][stat[[col]] != "verified"] <- NA
}

# ma.csv は study_id 経由で tab1.csv（共変量）と join できる
ma <- read_csv("ma.csv")
ma_with_covariates <- dplyr::left_join(ma, tab1, by = "study_id", suffix = c("", ".study"))

# audit.csv で任意の値の出所（PDF ページ・quote・判定履歴）まで遡れる
audit <- read_csv("audit.csv", na = c("", "."))
trace <- dplyr::filter(audit, study_id == "study-d", entity_key == "outcome:mortality|arm:1|time:30d")
```

`export_issues.csv` は `issue_type` 別に `dplyr::count()` すれば、エクスポートから除外・警告された行の全体像を把握できる。

## 10. golden fixture とテスト計画

`tests/unit/features/export/rset/__fixtures__/scenario.ts` に 4 study（`study-a`〜`study-d`）を持つ 1 プロジェクトの入力素材（TS）を定義し、`buildRSet.test.ts` で受け入れ条件の 8 シナリオを 1:1 で検証する。

| # | シナリオ | fixture 上の表現 | 検証内容 |
|---|---|---|---|
| ① | `study_label` 重複 | `study-a` / `study-b` が同じ `"Smith 2020"` | `tab1.csv` で `study_id` により行が区別される |
| ② | 未検証セル | `study-d` の `outcome:mortality\|arm:3\|time:30d` の `outcome_total` に Evidence のみ付与 | `ma.csv` 値列が空・`ma_status.csv` が `unverified`・`export_issues.csv` に `unverified_cell` 行 |
| ③ | `not_reported` | `study-d` の `outcome:mortality\|arm:2\|time:30d` の `outcome_events` | 値列が空・ステータスが `not_reported` |
| ④ | 3 群 + 複数 timepoint | `study-d` の `mortality` outcome。arm:1〜3 × `time:30d`/`90d` | `ma.csv` に 6 行（2 timepoint × 3 arm）、`arm_label` が `ArmStructures` の確定名 |
| ⑤ | result-level RoB | `study-d` の `rob2_judgement` / `rob2_support`（`rob:d1_randomization` + `rob:overall`） | `rob.csv` に RoB 2 の全 6 ドメイン行（実データ 2 件 + 幽霊セル 4 件）、`ma.csv` に `rob_overall_judgement` 複製 |
| ⑥ | カンマ・改行・日本語・引用符 | `study-d` の `note_with_special_chars` = `'Line1\nLine2, "quoted", 日本語です'` | RFC 4180 エスケープされ `parseCsv()` で原文に round-trip |
| ⑦ | 確定 annotator 不明 | `study-c` の `StudyData` / `ResultsData` に human 行が 2 件（email 違い） | `tab1` / `ma` / `rob` から除外され、`export_issues.csv` に 3 件（ファイルごと。§7.3） |
| ⑧ | 未知 field_id | `study-d` の `ResultsData` に `SchemaFields` 未掲載の `f-ghost-unknown` 行 | `export_issues.csv` に `dropped_unknown_field` 行 |

各 builder（`buildTab1Csv` / `buildMaCsv` / `buildRobCsv` / `buildDataDictionaryCsv` / `buildExportIssuesCsv` / `buildExportManifest` / `buildRSet`）と純ロジック層（`rsetStatus` / `presetFields` / `timepoint` / `robFields` / `annotatorPool` / `issues`）は個別の単体テストも持つ（`tests/unit/features/export/rset/*.test.ts`）。jest カバレッジは branches / functions / lines / statements すべて 100%（実行時に到達しえない防御分岐は `verification/cells.ts` 等の既存慣習に倣い `istanbul ignore` + 理由コメントで明示）。

## 11. モジュール構成

```
src/features/export/
  buildAuditCsv.ts          既存（study_id 列追加のみ変更）
  rset/
    buildTab1Csv.ts          tab1.csv / tab1_status.csv
    buildMaCsv.ts             ma.csv / ma_status.csv
    buildRobCsv.ts             rob.csv
    buildDataDictionaryCsv.ts  data_dictionary.csv
    buildExportIssuesCsv.ts    export_issues.csv
    buildExportManifest.ts     export_manifest.json（純関数。exported_at は引数）
    buildRSet.ts               8 ファイルをまとめて構築するオーケストレータ
    rsetStatus.ts              ステータス導出（§3.1）
    presetFields.ts            not_applicable 判定（§5）
    timepoint.ts                timepoint の best-effort パース（§6）
    robFields.ts                RoB tool 判別・ドメイン定義の参照（§4.3）
    annotatorPool.ts             distinct (annotator, annotator_type) 抽出
    issues.ts                    export_issues.csv の行型 + 横断チェック（§4.5）
```

## 12. スコープ外（PR-B 以降）

- S10 UI への「R セット」形式追加（Drive `exports/rset_{YYYYMMDD-HHMMSS}/` への複数ファイル保存・`ExportLog` 拡張）
- 生成完了カードの UTF-8（BOM なし）案内文（D-6 の初心者向け説明）
- `robvis` 互換出力（`rob.csv` からの派生。エクスポートオプション化は別途）
- `reported_unit`（[#76](https://github.com/youkiti/sr-data-extraction-plugin/issues/76)）
- `analysis_role`（感度分析共変量タグ付け。P2 の便利機能として保留）
- signaling question（`sq_id`）: [#61](https://github.com/youkiti/sr-data-extraction-plugin/issues/61) 実装後に `rob.csv` へ配線
