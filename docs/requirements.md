# sr-data-extraction-plugin 要件定義書（v0.6）

- **作成日**: 2026-07-02（v0.1）/ **更新**: 2026-07-02（v0.2: 未決定事項を暫定確定に格上げ・関連ドキュメント整備 / v0.3: ユーザーレビュー反映 — Q1・Q4・Q6・Q7・Q9 確定、スキャン PDF 対応方針、規模想定の拡大、Q8 に CESAR 基準を追記 / v0.4: データ設計を再編 — `StudyData`（wide）+ `ResultsData`（long）+ annotator 軸で二重抽出に対応、著作権確認チェック機能を廃止し事前確認の運用へ / v0.5: 整合性レビュー反映 — `Documents` に `source_file_id` を追加しコピー ID と分離、`text_ref` を `no_text_layer` 時のみ空に、AI 出力 JSON を `field_id` 基準に変更、`StudyData` / `ResultsData` の更新キーを明文化、`Decisions` に `schema_version` / 対象 annotator を追加、二重抽出の MVP/P1 境界を明記 / v0.6: `audit.csv` の行形式を確定 — 判定中心デノーマライズ型（1 行 = 1 判定イベント + 未判定セルのプレースホルダ行）、Evidence 添付規則・列仕様・構造的欠損トークン `.` を §4.4 に明文化）
- **ステータス**: 要件定義フェーズ（実装未着手）。§10 の Q1〜Q9 はレビュー済み（Q8 の閾値のみベンチマーク設計時に最終確定）
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

1. Google Drive に保管された**著作権フリー（OA / パブリックドメイン）の採用論文フルテキスト**と**研究プロトコル**から、AI がデータ抽出スキーマ（コーディングシート）のドラフトを設計
2. AI が各論文からスキーマに沿ってデータを抽出し、**根拠となる本文箇所（verbatim quote）**を各値に付与
3. PDF ビューア上で AI の根拠箇所を**ハイライト表示**
4. 研究者がハイライトを目視確認しながら**人間による最終抽出（accept / edit / reject）**を実施
5. 確定データを **CSV としてエクスポート**（メタ解析・記述的統合の下流工程へ渡す）

初学者研究者が、方法論的に妥当な形（AI 事前抽出 + 人間検証、全判断の監査証跡）でデータ抽出を完遂できることを狙う。ブラウザ単体で完結し、外部サーバーを持たない（tiab-review-plugin と同じサーバーレス構成）。

### 1.3 ユーザーストーリー（ハイレベル）

```
研究者: プロジェクト作成（新規 or tiab-review プロジェクトからの引き継ぎ ※Q2）
  → Google Drive Picker で採用論文の PDF を選択して取り込み
  → 拡張が PDF からテキスト層を抽出し、Drive に監査用テキストを保存
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
| RoB / 質評価 | （P1: スキーマの一種として扱う） | 専用 UI は MVP 外 |
| メタ解析・統合 | CSV 出力まで | R / RevMan / STATA 等 |
| OCR（スキャン PDF） | 画像のみ PDF も `pdf_native` モードで AI 抽出対象（アンカリング / ハイライトは不可 ※Q7） | テキスト層の再建（OCR 処理そのもの） |

### 1.5 想定ユーザーと前提

- SRWS-PSG のメンティーを含む初学者〜中級者の SR 実施者
- 対象文献は**テキスト層を持つ born-digital PDF** が原則（OA 論文が中心想定）。くわえて**画像のみの PDF（スキャン PDF）にも対応**する: PDF のまま対応 AI に投げる `pdf_native` モードで抽出（アンカリング / ハイライトは不可 ※Q7）
- 1 プロジェクトの規模想定: 採用論文 5〜100 本、スキーマ項目 10〜200、エンティティ展開後の抽出セル数 最大 ~20,000（annotator 1 名あたり）
- 取り込む PDF が著作権フリー / 利用許諾済みであることは**ユーザーが取り込み前に確認する運用**とする。拡張内に確認チェック UI・記録列は設けず、取り込み画面に注意書きのみ表示する

---

## 2. 技術スタック

tiab-review-plugin / sr-query-builder-plugin の構成に準拠。

| 項目 | 採用技術 |
| --- | --- |
| プラットフォーム | Chrome Extension Manifest V3 |
| UI | **メインビュー**（`chrome.tabs.create` で開く拡張オリジンのフルページ `app.html`。sr-query-builder と同方式）+ Popup（プロジェクト選択）+ Options |
| 言語 | TypeScript / HTML / CSS |
| ビルド | webpack |
| 認証 | Google OAuth 2.0（`chrome.identity.getAuthToken`） |
| ストレージ | Google Sheets（主 DB）/ Google Drive（PDF 原本・抽出テキスト・LLM ログ実体）/ `chrome.storage`（API キー、ローカルキャッシュ、オフラインキュー） |
| PDF 描画 | `pdfjs-dist`（PDF.js）: canvas 描画 + テキスト層 + ハイライトオーバーレイ |
| docx パース | `mammoth.js`（プロトコル入力用） |
| LLM（MVP） | Gemini API（既定モデルは抽出精度ベンチマーク後に確定 ※Q8。tiab-review の固定バージョン ID 方針を踏襲） |
| LLM（将来） | OpenRouter（カスタムモデル手入力 + テスト保存の tiab-review 方式を移植） |
| Node.js | ≥ 18 |

### 2.1 OAuth スコープ

```
https://www.googleapis.com/auth/spreadsheets   # Sheets 読み書き
https://www.googleapis.com/auth/drive.file     # Drive Picker で選択したファイル + 拡張が作成したファイルのみ
```

- `drive.file` スコープにより、**ユーザーが Picker で明示的に選択した PDF** と拡張が作成したファイルにのみアクセス可能。Drive 全体を読むスコープは要求しない（プライバシー姿勢を README に明記）。
- メールアドレスは `chrome.identity.getProfileUserInfo()` で取得（sr-query-builder §2.1 と同方針）。

### 2.2 Manifest V3 要件

- `permissions`: `identity`, `identity.email`, `storage`, `tabs`
- `host_permissions`:
  - `https://sheets.googleapis.com/*`
  - `https://www.googleapis.com/*`
  - `https://generativelanguage.googleapis.com/*`（Gemini）
  - `https://openrouter.ai/*`（P1）
- `action.default_popup`: `popup.html`
- PDF.js の worker は拡張パッケージに同梱（CDN 参照不可、CSP 準拠）

---

## 3. データ設計

### 3.1 全体方針

- 1 プロジェクト = 1 スプレッドシート = 1 Drive フォルダ（`Meta` タブにフォルダ ID を保持。sr-query-builder と同一）
- **追記型・上書き禁止**: `Protocol` / `SchemaVersions` / `SchemaFields` / `ExtractionRuns` / `Evidence` / `Decisions` は追記のみ。`StudyData` / `ResultsData` の各 annotator 行のみ「現在値」として上書き更新を許可し、変更履歴は `Decisions` への追記で監査する
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

`Meta` / `Protocol` は sr-query-builder のスキーマをそのまま流用（`ProtocolBlocks` は不要）。以下は本拡張固有のタブ。

#### `Documents`

1 行 = 1 論文。

| 列 | 型 | 必須 | 説明 |
| --- | --- | --- | --- |
| document_id | string(uuid) | ✓ | |
| study_label | string | ✓ | 表示・CSV 用の研究ラベル（例: `Smith 2020`）。AI が書誌から提案、ユーザー編集可 |
| drive_file_id | string | ✓ | `documents/` 配下に作成した**プロジェクト内コピー**の Drive ファイル ID（凍結スナップショット ※Q9）。ビューア表示・AI 抽出・監査はすべてこの ID を参照する |
| source_file_id | string | ✓ | Picker で選択した**元 PDF** の Drive ファイル ID（出所の記録用。取り込み後に原本が移動・削除されても拡張の動作には影響しない） |
| filename | string | ✓ | |
| pmid / doi | string | | 任意。tiab-review 引き継ぎ時は自動転記（※Q2） |
| text_ref | string(url) | ✓* | `extracted_texts/{document_id}.txt` の Drive URL。**`text_status = no_text_layer` の場合のみ空**（テキスト層がなく抽出テキストが存在しないため。空ファイルは作らない） |
| text_status | enum | ✓ | `ok` / `partial`（一部ページ抽出不可）/ `no_text_layer`（スキャン PDF。`pdf_native` モードでのみ抽出可、アンカリング / ハイライト不可 ※Q7） |
| page_count / char_count | int | | |
| imported_at / imported_by | iso8601 / email | ✓ | |
| note | string | | |

#### `SchemaVersions`

スキーマの版管理。1 行 = 1 版。追記型。

| 列 | 型 | 必須 | 説明 |
| --- | --- | --- | --- |
| schema_version | int | ✓ | 1 から |
| parent_version | int | | 派生元 |
| protocol_version | int | ✓ | 依拠した `Protocol.version` |
| created_by_type | enum | ✓ | `ai_draft` / `user_edit` / `pilot_revision` |
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
| entity_level | enum | ✓ | `study` / `arm` / `outcome_result` / `rob_domain`（P1）（§3.3） |
| data_type | enum | ✓ | `text` / `integer` / `float` / `boolean` / `enum` / `date` |
| unit | string | | 期待単位（例: `mg/day`）。AI に単位変換をさせず「報告どおり + 単位別記」方針 |
| allowed_values | string | | `enum` 時の許容値（`\|` 区切り） |
| required | bool | ✓ | 未報告時に `not_reported` を明示させるか |
| extraction_instruction | string | ✓ | LLM への項目別抽出指示（自然言語）。スキーマ編集 UI から直接編集可能 |
| example | string | | few-shot 用の例 |
| ai_generated | bool | ✓ | 監査用（sr-query-builder `ProtocolBlocks.ai_generated` と同旨） |
| note | string | | |

#### `ExtractionRuns`

AI 一括抽出の実行単位。tiab-review の `LLM_Runs` に相当。

| 列 | 型 | 必須 | 説明 |
| --- | --- | --- | --- |
| run_id | string(uuid) | ✓ | |
| run_type | enum | ✓ | `pilot` / `full` / `single_document`（再抽出） |
| schema_version | int | ✓ | |
| document_ids | string | ✓ | カンマ区切り |
| provider / requested_model | enum / string | ✓ | tiab-review 準拠（`model_version` も応答から記録） |
| input_mode | enum | ✓ | `pdf_native`（PDF を直接 LLM へ）/ `text_only`（※Q3） |
| status | enum | ✓ | `queued` / `running` / `done` / `partial_failure` |
| started_at / finished_at | iso8601 | | |
| tokens_in / tokens_out / cost_estimate | int / int / float | | 実行前にコスト概算を UI 表示 |

#### データ本体タブの分割方針と annotator 軸（v0.4）

抽出データは「study レベルの Table 1 的内容」と「arm 別のアウトカム・RoB の結果」で性質が異なるため、**`StudyData`（wide）と `ResultsData`（long）にシートを分ける**。あわせて**すべてのデータ行に annotator（誰が抽出・検証したか）軸を持たせ**、二重独立抽出（Q4）は「同一 document に対する annotator 行の複数化」で表現する。

- **annotator**: 人間は email、AI 抽出行は `ai`（モデル・実行条件は `run_id` から `ExtractionRuns` を辿る）
- **annotator_type**: `ai` / `human_with_ai`（AI 出力を見ながら検証）/ `human_independent`（AI 出力を見ずに独立抽出）/ `consensus`（不一致解消後の確定行）— tiab-review の「AI / AI を見たヒト / AI なしのヒトを別レビュアー扱い」と同じ思想
- **MVP の運用**: `ai` 行 + `human_with_ai` 行の 2 行（単一検証）。**`human_independent` / `consensus` はデータ構造（annotator 軸・enum 値）としては MVP から対応するが、それらの行を作成・運用する UI（独立抽出モード・不一致解消 adjudication 画面）は P1**（§7、※Q4）
- **エクスポートの既定**: `consensus` 行（なければ唯一の human 行）を確定データとする

wide シートはセル単位のメタデータ（quote / anchor_status / 判定履歴）を保持できないため、AI の根拠情報は `Evidence`、人間判定の監査証跡は `Decisions`（いずれも追記型）に分離する。

#### `StudyData`（wide・study レベル）

1 行 = 1 document × 1 annotator。値列はスキーマの `entity_level = study` 項目から動的生成する（スキーマ版確定時に列を**追加のみ**行い、削除・改名はしない。改名は field_id で追跡）。

**更新キー**: `document_id` × `annotator`。書き込みは既存行を検索して上書き（なければ追記）し、`schema_version` / `updated_at` は書き込み時点の値へ更新する。同一キーの行が複数存在する状態はバリデーション違反として検出する。

| 列 | 型 | 必須 | 説明 |
| --- | --- | --- | --- |
| document_id | string(uuid) | ✓ | |
| annotator | string | ✓ | email または `ai` |
| annotator_type | enum | ✓ | `ai` / `human_with_ai` / `human_independent` / `consensus` |
| schema_version | int | ✓ | |
| run_id | string(uuid) | | `ai` 行のみ。生成元の実行 |
| updated_at | iso8601 | ✓ | |
| {field_name} … | string | | study レベル項目の値列（動的）。報告どおりの文字列で保持。未報告は `NR` トークン、未検証（human 行）は空セル |

#### `ResultsData`（long・arm / outcome_result / RoB レベル）

1 行 = 1 document × 1 annotator × 1 entity_key × 1 field（セル単位の long）。

**更新キー**: `document_id` × `annotator` × `entity_key` × `field_id`。書き込みは既存行を検索して上書き（なければ `result_id` を採番して追記）し、`schema_version` / `updated_at` は書き込み時点の値へ更新する。同一キーの重複行はバリデーション違反として検出する（`result_id` は行識別子であり、更新キーには使わない）。

| 列 | 型 | 必須 | 説明 |
| --- | --- | --- | --- |
| result_id | string(uuid) | ✓ | |
| document_id / field_id | string(uuid) | ✓ | |
| annotator / annotator_type | string / enum | ✓ | `StudyData` と同じ定義 |
| schema_version | int | ✓ | |
| entity_key | string | ✓ | arm レベルは `arm:1` 等、outcome_result は `outcome:mortality\|arm:1\|time:30d`、RoB（P1）は `rob:domain_1` 形式（§3.3） |
| run_id | string(uuid) | | `ai` 行のみ |
| value | string | | 報告どおりの文字列で保持（型検証はクライアント側） |
| not_reported | bool | | |
| updated_at | iso8601 | ✓ | |

#### `Evidence`（AI 根拠・追記型）

AI 抽出の根拠情報。ハイライト表示（§5）と audit.csv の素材。1 行 = 1 run × 1 document × 1 field × 1 entity_key。`ai` annotator 行（StudyData / ResultsData）の値はここから転記される。

| 列 | 型 | 必須 | 説明 |
| --- | --- | --- | --- |
| evidence_id | string(uuid) | ✓ | |
| run_id | string(uuid) | ✓ | |
| document_id / field_id | string(uuid) | ✓ | |
| entity_key | string | ✓ | study レベルは `-` |
| value | string | | AI 出力の原本 |
| not_reported | bool | | AI が「本文に報告なし」と判断 |
| quote | string | | **verbatim 引用（根拠箇所）**。ハイライトの元データ |
| page | int | | 1-indexed ページヒント |
| confidence | enum | | `high` / `medium` / `low`（プロンプトで自己申告させる） |
| anchor_status | enum | | quote アンカリング結果: `exact` / `normalized` / `fuzzy` / `failed`（§5） |

#### `Decisions`（判定監査ログ・追記型）

人間の判定操作を 1 操作 = 1 行で追記する。検証 UI の undo（直近判定の取り消し）も `undo` として残す。

| 列 | 型 | 必須 | 説明 |
| --- | --- | --- | --- |
| decided_at / decided_by | iso8601 / email | ✓ | decided_by は**判定操作を行った人間** |
| document_id / field_id | string(uuid) | ✓ | |
| entity_key | string | ✓ | |
| annotator / annotator_type | string / enum | ✓ | **判定対象の annotator 行**（`StudyData` / `ResultsData` のどの行への判定か）。MVP では decided_by 本人の `human_with_ai` 行。P1 の adjudication では decided_by（裁定者）が `consensus` 行へ判定する |
| schema_version | int | ✓ | 判定時点で対象行が依拠していたスキーマ版（スキーマ改訂 → 再抽出後の再検証を区別する） |
| action | enum | ✓ | `accept` / `edit` / `reject` / `not_reported` / `undo` |
| value | string | | 操作後の値 |
| note | string | | 検証時のメモ（例: Table 2 と本文で数値不一致、Table 2 を採用） |

#### `LLMApiLog` / `ExportLog`

- `LLMApiLog`: sr-query-builder のスキーマをそのまま流用。`purpose` enum は `draft_schema` / `suggest_study_label` / `extract_document` / `relocate_quote` / `other`
- `ExportLog`: `export_id` / `format`（`study_wide` / `results_long` / `audit`）/ `schema_version` / `document_count` / `file_ref`（Drive に保存した CSV の URL）/ `exported_at` / `exported_by`

### 3.3 エンティティモデル（entity_level）

SR のデータ抽出は「研究 → 群（arm）→ アウトカム × 時点の結果」という階層構造を持つ。完全な汎用化は UI もエクスポートも複雑化するため、MVP では study / arm / outcome_result の 3 レベルに限定する（RoB は P1 で `rob_domain` レベルとして追加）。

| entity_level | 例 | エンティティの定義方法 | 格納先 |
| --- | --- | --- | --- |
| `study` | 出版年、国、デザイン、総 N | 1 document に 1 インスタンス固定 | `StudyData`（wide） |
| `arm` | 群名、介入内容、群別 N | AI が arm 一覧をドラフト → 人間が検証画面冒頭で arm 数・名称を確定してから配下項目を検証 | `ResultsData`（long） |
| `outcome_result` | 効果推定値、群別イベント数 | スキーマで定義した outcome × 時点の組み合わせごとに 1 インスタンス | `ResultsData`（long） |
| `rob_domain`（P1） | RoB 2 / ROBINS-I のドメイン判定 + 根拠 | RoB テンプレートスキーマ（§7 P1）のドメインごとに 1 インスタンス | `ResultsData`（long） |

> **設計判断（案）**: 二値 / 連続アウトカムのメタ解析入力（2×2 表、mean/SD）を outcome_result 項目のテンプレートとしてプリセット提供する。RevMan 形式の直接出力は P2。

---

## 4. 機能要件（画面と主要フロー）

### 4.1 画面一覧

| # | 画面 | 概要 |
| --- | --- | --- |
| S1 | Popup | プロジェクト選択・新規作成・メインビュー起動 |
| S2 | プロジェクト作成ウィザード | スプレッドシート + Drive フォルダ生成、tiab-review 引き継ぎ選択（※Q2） |
| S3 | 文献取り込み | Drive Picker、テキスト層抽出とステータス表示。著作権フリー / 利用許諾済みは事前確認の運用（画面に注意書きのみ表示、チェック UI なし） |
| S4 | プロトコル入力 | 手入力 / md / docx（sr-query-builder S 系画面の UI を移植） |
| S5 | スキーマデザイン | AI ドラフト表示 → 表形式エディタで承認・編集。`extraction_instruction` を項目ごとに編集可 |
| S6 | パイロット抽出 | 2〜3 本で AI 抽出 → S8 と同じ検証 UI → 「スキーマを改訂して再パイロット」導線 |
| S7 | 一括抽出 | 対象文献選択、モデル選択、コスト概算表示、進捗バー、失敗リトライ（オフラインキュー tiab-review 準拠） |
| S8 | 検証（中核画面） | §4.2 |
| S9 | ダッシュボード | document × section 単位の検証進捗マトリクス、anchor 失敗率、not_reported 率 |
| S10 | エクスポート | 形式選択（study_wide / results_long / audit）、プレビュー、CSV 生成 + Drive 保存 |
| S11 | Options / 設定 | API キー、モデル管理（OpenRouter カスタムモデルは P1）、表示言語 |

### 4.2 検証画面（S8）の要件

- **2 ペイン構成**: 左 = PDF.js ビューア（ページ送り、ズーム、テキスト検索）、右 = 抽出フォーム（section ごとにグループ化、entity タブで arm / outcome を切替）
- **双方向ジャンプ**: 項目フォーカス → 該当ハイライトへスクロール + 強調 / ハイライトクリック → 対応項目へフォーカス
- **判定操作**: `accept`（AI 値をそのまま確定）/ `edit`（値修正して確定）/ `reject`（AI 値棄却、手入力）/ `not_reported`。キーボードショートカット必須（tiab-review の判定 UI に準拠した操作感）
- **anchor_status = failed の項目**: quote 全文をフォーム側に表示し、「本文内を検索」ボタンで PDF.js のテキスト検索に quote を投入するフォールバック
- **判定チップ**: 各項目の現在ステータスをチップ表示（tiab-review の文献カードチップと同トンマナ）
- **戻る挙動**: 直近の判定履歴を戻れる（tiab-review の「直近 5 件履歴」仕様を項目単位に読み替えて移植）
- **保存**: 判定ごとに自分の annotator 行（`StudyData` / `ResultsData`）へ即時書き込み + `Decisions` へ追記。失敗時はオフラインキュー退避

### 4.3 AI 抽出（extract-data skill）の要件

- 1 API 呼び出し = 1 document ×（スキーマ全項目 or section 単位分割 ※実装時にトークン量で判断）
- 出力は構造化 JSON を強制: `{ field_id, entity_key, value, not_reported, quote, page, confidence }` の配列。**対応付けは `field_id` 基準**: プロンプトに各項目の `field_id` を明示し、応答にそのまま返させる。`field_name` は改名されうる CSV 列名のため、応答に含める場合も補助情報（可読性・自己チェック用）扱いとし、`Evidence` / `StudyData` / `ResultsData` への突合には使わない。応答内の `field_id` が当該 `schema_version` の `SchemaFields` に存在しない場合、その要素は破棄して `partial_failure` として記録する
- **quote は本文からの verbatim 抜き出しを必須化**し、「言い換え禁止・原文どおり・最大 300 文字」をプロンプトで明示（アンカリング成功率に直結）
- 値と quote が矛盾する場合の扱い（例: quote に数値がない）は `confidence=low` を強制するバリデーションをクライアント側に実装
- 出力は `Evidence` に追記し、`ai` annotator 行（`StudyData` / `ResultsData`）へ値を転記する（§3.2）
- プロンプトは sr-query-builder と同様に **skills として管理**（`draft-schema` / `extract-data` / `relocate-quote`）し、プロンプト版数を `LLMApiLog` に残す

### 4.4 CSV エクスポート（S10）

シート構造（§3.2）をそのまま反映した 3 形式。既定では確定 annotator（`consensus`、なければ唯一の human）の行を出力する。

| 形式 | 構造 | 用途 |
| --- | --- | --- |
| `study_wide.csv` | 1 行 = 1 study（`StudyData` の確定 annotator 行。study_label + study レベル項目列） | Table 1 の下書き、Excel での目視確認 |
| `results_long.csv` | 1 行 = 1 結果セル（study_label, annotator, entity_key, field_name, value, unit, not_reported） | R でのメタ解析前処理（arm 別アウトカム・RoB）、柔軟性最優先 |
| `audit.csv` | `Evidence` + `Decisions` の結合（判定中心デノーマライズ型。行形式は下記） | 監査・投稿時の supplementary、抽出精度研究の素材 |

- 文字コードは UTF-8（BOM 付き、Excel 互換）
- 未検証セル（human 行の空セル）が残る場合は警告ダイアログ（「未検証の項目が n 件あります」）を出し、audit.csv には判定履歴の有無で明示

#### `audit.csv` の行形式（v0.6 確定）

**粒度**: 1 行 = 1 判定イベント（`Decisions` の 1 行。undo 含む）。各判定行に「その判定が見ていた AI 根拠（`Evidence`）」を横持ちで添付する。判定が 1 件も存在しないセル（document × field × entity_key）は、代表 Evidence + 判定列空の**プレースホルダ 1 行**として出力する（= 未検証セルの明示）。

**列**:

| 列 | 由来 | 説明 |
| --- | --- | --- |
| study_label / document_id | `Documents` | |
| entity_key / field_id / field_name | 共通キー | field_name は `SchemaFields` から解決 |
| schema_version | `Decisions`（プレースホルダ行は Evidence の run。run 不明なら `.`） | |
| annotator / annotator_type | `Decisions` | 判定対象の annotator 行。プレースホルダ行は `.` |
| run_id / evidence_id / ai_value / ai_not_reported / quote / page / confidence / anchor_status | `Evidence` | 添付 Evidence がない判定では `.`（下記規則 2） |
| decision_seq | 導出 | セル × annotator 内で decided_at 昇順の 1 始まり連番（undo も数える）。プレースホルダ行は `.` |
| action / decision_value / decided_by / decided_at / note | `Decisions` | プレースホルダ行は `.` |

**結合規則**:

1. **Evidence 添付**: 判定行には、同一セルの Evidence のうち「`run.schema_version` が `decision.schema_version` と一致する run」のものを添える。複数 run が該当する場合は `started_at` が最新の run を採用（`ExtractionRuns` を参照。run 不明の Evidence は候補外）
2. **Evidence 欠損は正常**: `human_independent` 行への判定（AI を見ない独立抽出）、AI 未抽出項目への手入力、一致する run がない場合は Evidence 列を空で出力する（エラー扱いしない）
3. **プレースホルダの代表 Evidence**: セルごとに「run の `started_at` が最新の Evidence」を代表とし、そのセルに判定が 0 件のときのみ 1 行出力する。**旧 run の未判定 Evidence は出力しない**（原本は `Evidence` タブに残るため、完全な生ログが必要な場合はシートを直接参照する）
4. **並び順**: document（取り込み順）→ entity_key → field_index → annotator → decided_at
5. **欠損表現**（R での下流処理を想定）: 結合の結果レコード自体が存在しない列ブロックは **`.`**（構造的欠損トークン。`NA` は実際の抽出値と衝突しうるため不採用）。レコードは存在するがセルが空（AI 出力の value / quote が null、note なし等）は**空文字のまま**とし、両者を区別する。R では `readr::read_csv(..., na = c("", "."))` で一括 NA 化でき、`.` の実値衝突が疑わしい場合も run_id / evidence_id（UUID 列）が `.` か否かでブロックの有無を機械判定できる

> **設計判断（v0.6）**: 検討した 3 案 — (A) セル・スナップショット型（1 行 = 1 セル × 1 annotator、最新判定の要約）/ (B) イベントログ型（Evidence と Decisions の縦積みユニオン）/ (C) 判定中心デノーマライズ型 — のうち C を採用。A は undo・複数判定の履歴が落ちて §6 の監査性と矛盾し、B は AI 値と判定の突合規則を利用者に委ねることになり精度研究の再現性を損なう。C は 1 行が「AI の主張 × 人間の判定」の自己完結ペアになり、3 用途（監査・supplementary・精度研究）を 1 形式で満たす。プレースホルダ行数はエクスポート警告の未検証件数と突合できる。

---

## 5. quote アンカリング（ハイライト位置決定）方式

本拡張の技術的な中核。LLM が返した verbatim quote を PDF.js テキスト層上の位置に対応付ける。

1. **正規化**: quote と各ページのテキスト層の双方に共通正規化を適用（空白圧縮、行末ハイフネーション結合 `exam-\nple → example`、リガチャ展開 `ﬁ → fi`、全角/半角統一、Unicode NFKC）
2. **段階的マッチング**:
   - `exact`: ai_page ± 1 ページ内で正規化後の完全一致
   - `normalized`: 全ページで正規化後の完全一致
   - `fuzzy`: スライディングウィンドウ + 編集距離（閾値: quote 長の 15% 以内）で最良一致
   - `failed`: 上記すべて不成立。ハイライトなし、S8 のフォールバック UI へ
3. **複数一致時**: ai_page に最も近い出現を採用し、UI に「他 n 箇所に一致」を表示して切替可能に
4. **ハイライト描画**: マッチした文字範囲をテキスト層の span 座標に写像し、CSS オーバーレイで描画（検証済み = 緑系 / 未検証 = 黄系 / low confidence = 橙系、実際の色はトンマナ確定時に）
5. アンカリング結果（`anchor_status`）は精度改善のための計測対象とし、S9 ダッシュボードで失敗率を可視化

> **リスク**: LLM が PDF を直接読む場合（`input_mode = pdf_native`）、LLM の内部テキスト認識と PDF.js テキスト層が不一致になりうる（表の読み順、2 段組みの結合順）。パイロットで anchor 失敗率を計測し、`text_only` モードとの比較で入力方式を確定する（※Q3）。

> **テキスト層なし PDF（`text_status = no_text_layer` ※Q7）**: アンカリングの対象外。抽出は `pdf_native` モードで可能だが、全項目がハイライトなし（`anchor_status = failed` 扱い）となり、S8 では quote 全文表示 + ページヒントのみで検証する（PDF.js のテキスト検索フォールバックも使えない点を UI に明示）。

---

## 6. 非機能要件

- **プライバシー**: 論文本文はユーザーの Drive と LLM API の間でのみ流通。開発者サーバーは存在しない。README にデータフロー図を明記（Chrome Web Store 審査対応も兼ねる）
- **監査性**: すべての AI 出力・人間判定・スキーマ改訂が Sheets + Drive 上に残り、`audit.csv` で一括出力可能
- **性能**: 100 documents × 200 fields × arm 展開 ≈ 40,000 行を想定（二重抽出時は annotator 数ぶん倍加）。Sheets への書き込みは batchUpdate、読み出しはタブ単位キャッシュ。検証画面の描画は document 単位読み込み
- **オフライン耐性**: 判定保存失敗時のキュー退避 + 再送（tiab-review の実装を共通ライブラリ化して流用）
- **多言語**: UI は日本語先行、en は P1。抽出対象論文は英語を主想定（プロンプトは英語論文前提で設計し、日本語論文対応は P2）
- **ライセンス・資金**: MIT。README に KAKENHI 25K13585 の funding 表記（tiab-review と同形式）

---

## 7. リリース計画

| フェーズ | 含むもの |
| --- | --- |
| **MVP** | 単独プロジェクト作成、PDF 取り込み（テキスト層あり + 画像のみ PDF。後者は `pdf_native` 抽出・ハイライトなし ※Q7）、プロトコル入力、AI スキーマドラフト + 編集、パイロット → 本抽出、単一レビュアー検証 UI（ハイライト付き）、long / wide / audit CSV、Gemini 固定モデル |
| **P1** | 二重独立抽出 + 不一致解決画面（tiab-review「担当セット」の思想を移植 ※Q4）、tiab-review プロジェクト引き継ぎ、OpenRouter カスタムモデル、RoB テンプレートスキーマ、UI 英語化 |
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
| 著作権のある PDF の取り込み | 著作権フリー / 利用許諾済みの事前確認をユーザー運用とする（取り込み画面に注意書きを表示。チェック UI・記録列は持たない）。拡張側で PDF を外部送信するのは LLM API のみである旨を README に明示 |
| Sheets 行数・レート制限 | batchUpdate、指数バックオフ、40,000 行規模（§6 性能想定）での負荷試験を MVP 完了条件に含める |

---

## 10. 未決定事項（レビュー済み）

> v0.2 で暫定確定に格上げ → v0.3 でユーザーレビューを反映して確定。Q8 の閾値のみベンチマーク設計時に最終確定する。

| # | 論点 | 決定 |
| --- | --- | --- |
| Q1 | プロダクト名 | **確定: `sr-data-extraction-plugin`** |
| Q2 | tiab-review プロジェクトとの連携 | (a) 同一スプレッドシートにタブ追加 (b) 別スプレッドシート + `Meta` 経由の相互参照 (c) MVP は完全独立。**暫定: (c) で開始し P1 で (b)**（タブ増加による読み出しコスト増を避ける sr-query-builder §11 の判断と同旨） |
| Q3 | LLM への入力方式 | (a) PDF を直接送信（表・レイアウト理解に強い）(b) 抽出テキストのみ（アンカリング一致率に強い）。**確定: 両対応で実装。キャリブレーション（パイロット）では両方式で実行し、anchor 失敗率と抽出精度を比較して残りをどちらでやるか決める** |
| Q4 | 二重抽出を MVP に含めるか | Cochrane 的には二重が原則だが、本拡張の設計思想は「AI 第一抽出者 + 人間検証者」。**確定: 二重独立 + adjudication。tiab-review-plugin と同じく、AI / AI を見たヒト / AI なしのヒトを別レビュアー（annotator）扱いにして不一致解消ができるようにする**（v0.4 で §3.2 を annotator 軸に再設計して反映済み。**MVP はデータ構造のみ対応**（`human_independent` / `consensus` の enum・行構造）。**独立抽出の UI・運用と adjudication 画面は P1**） |
| Q5 | entity_level の粒度 | study のみ / +arm / +outcome_result。**確定: 3 レベルすべて MVP に含める**（メタ解析入力を出せないと実用にならないため） |
| Q6 | エクスポート / データ保持の形 | **確定: study レベルの Table 1 的内容は wide（`StudyData` → study_wide.csv）、arm 別のアウトカム・RoB は long（`ResultsData` → results_long.csv）でシートを分けて保持する。完全 wide の列サフィックス展開は後のメタ解析での取り回しが大変になるため採らない**（v0.4 で §3.2 / §4.4 に反映済み） |
| Q7 | スキャン PDF（OCR） | **確定: 対応する。画像のみ PDF も `pdf_native` モード（PDF を直接 LLM へ送信）で抽出対象にする**。テキスト層がないためアンカリング / ハイライトは不可（§5 参照） |
| Q8 | 既定モデルと採用基準 | 抽出ベンチマークの主指標（項目正確度 / quote 忠実度）と閾値の事前設定が必要。**採用基準の参考として CESAR プロジェクトの中止境界（下表）を用いる** |
| Q9 | PDF 原本の扱い | (a) プロジェクトフォルダへコピー（凍結スナップショット、監査に強い）(b) 参照のみ（ユーザーが原本を移動すると壊れる）。**確定: (a) コピー**。取り込み時に `documents/` へコピーを作成し、`Documents.drive_file_id` にはコピーの ID を、元 PDF の ID は `source_file_id` に分けて記録する（§3.2） |

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

---

## 付記: 既存 2 拡張から流用・共通化する資産

- OAuth / Sheets / Drive クライアント層、オフラインキュー、LLM プロバイダ抽象化（Gemini / OpenRouter）、モデル ID マイグレーション機構 → 共通ライブラリ化を検討（3 拡張のモノレポ化 or npm パッケージ切り出しは別途判断）
- UI トンマナ: tiab-review のサイドパネル系コンポーネント（判定チップ、進捗表示）+ sr-query-builder のメインビュー / ウィザード構成
- ドキュメント構成: `docs/requirements.md`（本書）に加え、[docs/ui-flow.md](ui-flow.md) / [docs/architecture.md](architecture.md) / [docs/ui-states.md](ui-states.md) を sr-query-builder と同構成で整備（v0.2 で作成済み）
