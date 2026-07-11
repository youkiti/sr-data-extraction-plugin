# sr-data-extraction-plugin 要件定義書（v0.11）

- **作成日**: 2026-07-02（v0.1）/ **更新**: 2026-07-02（v0.2: 未決定事項を暫定確定に格上げ・関連ドキュメント整備 / v0.3: ユーザーレビュー反映 — Q1・Q4・Q6・Q7・Q9 確定、スキャン PDF 対応方針、規模想定の拡大、Q8 に CESAR 基準を追記 / v0.4: データ設計を再編 — `StudyData`（wide）+ `ResultsData`（long）+ annotator 軸で二重抽出に対応、著作権確認チェック機能を廃止し事前確認の運用へ / v0.5: 整合性レビュー反映 — `Documents` に `source_file_id` を追加しコピー ID と分離、`text_ref` を `no_text_layer` 時のみ空に、AI 出力 JSON を `field_id` 基準に変更、`StudyData` / `ResultsData` の更新キーを明文化、`Decisions` に `schema_version` / 対象 annotator を追加、二重抽出の MVP/P1 境界を明記 / v0.6: `audit.csv` の行形式を確定 — 判定中心デノーマライズ型（1 行 = 1 判定イベント + 未判定セルのプレースホルダ行）、Evidence 添付規則・列仕様・構造的欠損トークン `.` を §4.4 に明文化 / v0.7: 群構成の確定を永続化する `ArmStructures` タブを追加（12 → 13 タブ）— 検証画面冒頭の arm 確定 UI（§4.2）の保存先。1 行 = 1 arm・確定/改訂のたびに全 arm 行を新 version で追記する追記型。`entity_key`（`arm:n`）で `ResultsData` と join でき、メタ解析前処理での流用を想定 / v0.8: 著作権への配慮に関する文言を UI から削除 — 学術研究目的のデータ抽出（テキスト・データマイニング）は著作権法上の権利制限規定（30 条の 4 等）の範囲内であり適法との整理。「著作権フリーのみ対象」という前提記述も廃止。取り込み画面の注意書きは PDF の外部送信先（LLM API のみ）の説明だけを残す / v0.9: RoB テンプレートスキーマを P1 から MVP へ前倒し（2026-07-07）— `rob_domain` レベルを MVP の 4 レベル目として確定し、RoB 2 / ROBINS-I の 2 テンプレートを S5 のプリセット挿入で提供（判定 enum + 根拠 text × 固定ドメイン）。entity_key は可読な `rob:<domain_id>` 形式（例 `rob:d1_randomization`）とし、AI ドラフト（draft-schema）は RoB 項目を出さない = テンプレート挿入が唯一の入口。群構成の確定ゲートは arm / outcome_result タブのみに適用（rob_domain タブは arm 未確定でも検証可） / v0.10: 複数報告文書（multiple reports）を 1 試験へ統合する study / document モデルを導入（2026-07-07）— 1 つの試験（trial）は本論文・試験登録・プロトコル論文・学会抄録など複数の PDF を持ちうるため、**study を抽出・検証・エクスポートの単位、document を quote アンカリング・ハイライトの単位**に分離。`Studies` タブ新設（13 → 14 タブ。study_label は Documents から移設 + registration_id 追加）、`Documents` に `study_id` / `document_role` を追加。データ行のキーを document_id → study_id へ改名（`StudyData` / `ResultsData` / `ArmStructures` / `Decisions`、`ExtractionRuns.document_ids` → `study_ids`、`run_type: single_document` → `single_study`、`LLMApiLog.purpose: extract_document` → `extract_study`、`ExportLog.document_count` → `study_count`）。`Evidence` のみ quote の出所文書を特定するため document_id を保持したまま study_id を併記。抽出は 1 study = 1 抽出単位（全文書をロール付き区切りで連結、応答要素に `document_index` を必須化 §4.3）。S3 にグルーピング UI（§4.5: 取り込みは 1 PDF = 1 study 自動生成 → 後から統合。試験登録番号の自動検出は候補提案 → ユーザー確認で自動統合はしない）。グルーピング変更は常に新 study_id を発行して当該試験を「未抽出」へ戻す（旧データ行は監査用に残置）。未リリースのため後方互換は持たない） / v0.11: 独立二重レビュー機能を追加（2026-07-11・issue #44）— 第 2 の human reviewer による盲検レビューと、ヒトの不一致を裁定する `consensus` 確定を導入。`Reviewers` タブ新設（14 → 15 タブ。email / role〔`reviewer` / `adjudicator` / `revoked`〕/ review_mode〔`with_ai` / `independent`〕/ assigned_by / assigned_at）、annotator の予約値に `consensus`（裁定確定行）を追加、S8 検証画面に独立入力モード（AI 出力を見せず人間が直接入力）、S12 裁定画面（`#/adjudicate`）を新設。ロール（owner / reviewer_with_ai / reviewer_independent / adjudicator / unregistered）はメインビュー起動時に 1 回解決し、未解決・解決失敗・未登録はフェイルクローズで全画面ブロックする。§7 の P1「二重独立抽出 + 不一致解決画面」（Q4）を実装済みへ更新（2 アカウントでの実機通し確認は未実施。詳細設計は [docs/design-independent-dual-review.md](design-independent-dual-review.md)）
- **ステータス**: S1〜S10 実装済み・実機通し確認完了（2026-07-03）。残タスクは [docs/remaining-work-plan.md](remaining-work-plan.md) を参照。§10 の Q1〜Q10 はレビュー済み（Q8 の閾値のみベンチマーク設計時に最終確定）。**v0.10（study / document モデル）は要件確定のみで実装未着手** — 実装は §4.5 の注記の段階分割に従う
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
| OCR（スキャン PDF） | 画像のみ PDF も `pdf_native` モードで AI 抽出対象（アンカリング / ハイライトは不可 ※Q7） | テキスト層の再建（OCR 処理そのもの） |

### 1.5 想定ユーザーと前提

- SRWS-PSG のメンティーを含む初学者〜中級者の SR 実施者
- 対象文献は**テキスト層を持つ born-digital PDF** が原則（OA 論文が中心想定）。くわえて**画像のみの PDF（スキャン PDF）にも対応**する: PDF のまま対応 AI に投げる `pdf_native` モードで抽出（アンカリング / ハイライトは不可 ※Q7）
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
| 認証 | Google OAuth 2.0（`chrome.identity.getAuthToken`） |
| ストレージ | Google Sheets（主 DB）/ Google Drive（PDF 原本・抽出テキスト・LLM ログ実体）/ `chrome.storage`（API キー、ローカルキャッシュ、オフラインキュー） |
| PDF 描画 | `pdfjs-dist`（PDF.js）: canvas 描画 + テキスト層 + ハイライトオーバーレイ |
| docx パース | `mammoth.js`（プロトコル入力用） |
| LLM（MVP） | Gemini API（工場出荷の既定モデル = `gemini-3.5-flash`。実データ抽出ベンチマークで確定 ※Q8。tiab-review の固定バージョン ID 方針を踏襲） |
| LLM（MVP 追加） | OpenRouter（OpenAI 互換 API。`OpenRouterProvider` を sr-query-builder から移植・2026-07-04）+ 利用者指定の OpenAI 互換 Chat Completions API（Issue #27。HTTPS を原則とし、HTTP は `localhost` / `127.0.0.1` / `[::1]` のみ許可。非標準ポート、loopback の認証なし接続、構造化出力の互換性フォールバックに対応）。モデルセレクタの「その他（直接入力）」で任意モデル ID を指定可。カスタムモデルの一覧管理 UI は P1 |
| Node.js | ≥ 18 |

### 2.1 OAuth スコープ

```
https://www.googleapis.com/auth/spreadsheets   # Sheets 読み書き
https://www.googleapis.com/auth/drive.file     # Drive Picker で選択したファイル + 拡張が作成したファイルのみ
```

- `drive.file` スコープにより、**ユーザーが Picker で明示的に選択した PDF（またはフォルダ）** と拡張が作成したファイルにのみアクセス可能。フォルダを選択した場合はその直下 PDF の列挙・取り込みまでを許可（配下ファイルへは選択フォルダ経由でアクセス可）。Drive 全体を読むスコープは要求しない（プライバシー姿勢を README に明記）。
- メールアドレスは `chrome.identity.getProfileUserInfo()` で取得（sr-query-builder §2.1 と同方針）。

### 2.2 Manifest V3 要件

- `permissions`: `identity`, `identity.email`, `storage`, `tabs`
- `host_permissions`:
  - `https://sheets.googleapis.com/*`
  - `https://www.googleapis.com/*`
  - `https://generativelanguage.googleapis.com/*`（Gemini）
  - `https://openrouter.ai/*`（OpenRouter）
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

`Meta` / `Protocol` は sr-query-builder のスキーマをそのまま流用（`ProtocolBlocks` は不要）。以下は本拡張固有のタブ。

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
| text_status | enum | ✓ | `ok` / `partial`（一部ページ抽出不可）/ `no_text_layer`（スキャン PDF。`pdf_native` モードでのみ抽出可、アンカリング / ハイライト不可 ※Q7）。判定は各ページ実質 30 字以上で「テキストあり」とするが、**全ページの過半数に繰り返す定型行（複写スタンプ・走りヘッダ / フッタ）は本文から除外してから数える**（例: 全ページ上下に "Reproduced with permission of the copyright owner..." が本物のテキストとして載るスキャン論文 PDF を、正しく `no_text_layer` と判定するため） |
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
| entity_level | enum | ✓ | `study` / `arm` / `outcome_result` / `rob_domain`（§3.3） |
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

#### データ本体タブの分割方針と annotator 軸（v0.4）

抽出データは「study レベルの Table 1 的内容」と「arm 別のアウトカム・RoB の結果」で性質が異なるため、**`StudyData`（wide）と `ResultsData`（long）にシートを分ける**。あわせて**すべてのデータ行に annotator（誰が抽出・検証したか）軸を持たせ**、二重独立抽出（Q4）は「同一 study に対する annotator 行の複数化」で表現する。

- **annotator**: 人間は email、AI 抽出行は `ai`（モデル・実行条件は `run_id` から `ExtractionRuns` を辿る）。**consensus 行（裁定確定）は annotator にリテラル `consensus` を使う**（`ai` と同格の予約値。更新キー `study_id × annotator` の一意性を裁定者交代によらず保証するため。誰が裁定したかは `Decisions.decided_by` が監査する。v0.11）
- **annotator_type**: `ai` / `human_with_ai`（AI 出力を見ながら検証）/ `human_independent`（AI 出力を見ずに独立抽出）/ `consensus`（不一致解消後の確定行）— tiab-review の「AI / AI を見たヒト / AI なしのヒトを別レビュアー扱い」と同じ思想
- **MVP の運用**: `ai` 行 + `human_with_ai` 行の 2 行（単一検証）。`human_independent` / `consensus` はデータ構造（annotator 軸・enum 値）としては MVP から対応。**それらの行を作成・運用する UI（独立抽出モード・不一致解消 adjudication 画面）は v0.11 で実装済み**（S8 独立入力モード + S12 裁定画面。§4.2・§4.6・§7・※Q4。2 アカウントでの実機通し確認は未実施）
- **エクスポートの既定**: `consensus` 行（なければ唯一の human 行）を確定データとする

wide シートはセル単位のメタデータ（quote / anchor_status / 判定履歴）を保持できないため、AI の根拠情報は `Evidence`、人間判定の監査証跡は `Decisions`（いずれも追記型）に分離する。

#### `StudyData`（wide・study レベル）

1 行 = 1 study × 1 annotator。値列はスキーマの `entity_level = study` 項目から動的生成する（スキーマ版確定時に列を**追加のみ**行い、削除・改名はしない。改名は field_id で追跡）。

**更新キー**: `study_id` × `annotator`。書き込みは既存行を検索して上書き（なければ追記）し、`schema_version` / `updated_at` は書き込み時点の値へ更新する。同一キーの行が複数存在する状態はバリデーション違反として検出する。

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

**更新キー**: `study_id` × `annotator` × `entity_key` × `field_id`。書き込みは既存行を検索して上書き（なければ `result_id` を採番して追記）し、`schema_version` / `updated_at` は書き込み時点の値へ更新する。同一キーの重複行はバリデーション違反として検出する（`result_id` は行識別子であり、更新キーには使わない）。

| 列 | 型 | 必須 | 説明 |
| --- | --- | --- | --- |
| result_id | string(uuid) | ✓ | |
| study_id / field_id | string(uuid) | ✓ | |
| annotator / annotator_type | string / enum | ✓ | `StudyData` と同じ定義 |
| schema_version | int | ✓ | |
| entity_key | string | ✓ | arm レベルは `arm:1` 等、outcome_result は `outcome:mortality\|arm:1\|time:30d`、RoB は `rob:<domain_id>` 形式（例 `rob:d1_randomization`。§3.3） |
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

AI 抽出の根拠情報。ハイライト表示（§5）と audit.csv の素材。1 行 = 1 run × 1 study × 1 field × 1 entity_key（+ quote の出所 document）。`ai` annotator 行（StudyData / ResultsData）の値はここから転記される。**14 タブ中このタブだけが document_id を持ち続ける**（quote は特定の PDF の中に存在するため。§3.2「study と document の分離」）。

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
| page | int | | 出所文書内の 1-indexed ページヒント |
| confidence | enum | | `high` / `medium` / `low`（プロンプトで自己申告させる） |
| anchor_status | enum | | quote アンカリング結果: `exact` / `normalized` / `fuzzy` / `failed`（§5） |

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
| note | string | | 検証時のメモ（例: Table 2 と本文で数値不一致、Table 2 を採用） |

> **インスタンス宣言イベント（2026-07-09 追記）**: AI が丸ごと見落とした outcome_result を人間が追加する操作は、`Decisions` に予約 `field_id = __entity_instance__` の行として追記する。`entity_key` には追加した outcome_result キー、`annotator` は操作した人間、`annotator_type` は宣言者のロールに応じた値（`human_with_ai`。独立入力モードでは `human_independent`。v0.11）、`action = edit`、`value = entity_key`、`note = outcome_instance_declared` を入れる。この行はセル判定ではなく「entity インスタンスを人間が宣言した」監査イベントなので、`StudyData` / `ResultsData` の annotator 行は更新しない。検証 UI のセル生成はこの宣言行をインスタンス源として読むが、audit.csv の判定行からは除外する（原本の `Decisions` には残る）。

#### `LLMApiLog` / `ExportLog`

- `LLMApiLog`: sr-query-builder のスキーマをそのまま流用。`purpose` enum は `draft_schema` / `suggest_study_label` / `extract_study` / `relocate_quote` / `other`（v0.10 で `extract_document` → `extract_study` へ改名）
- `ExportLog`: `export_id` / `format`（`study_wide` / `results_long` / `audit`）/ `schema_version` / `study_count`（CSV に行が出た study 数。v0.10 で `document_count` から改名）/ `file_ref`（Drive に保存した CSV の URL）/ `exported_at` / `exported_by`

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

### 3.3 エンティティモデル（entity_level）

SR のデータ抽出は「研究 → 群（arm）→ アウトカム × 時点の結果」という階層構造を持つ。完全な汎用化は UI もエクスポートも複雑化するため、study / arm / outcome_result / rob_domain の 4 レベルに限定する（`rob_domain` は v0.9 で P1 から MVP へ前倒し）。

| entity_level | 例 | エンティティの定義方法 | 格納先 |
| --- | --- | --- | --- |
| `study` | 出版年、国、デザイン、総 N | 1 study に 1 インスタンス固定 | `StudyData`（wide） |
| `arm` | 群名、介入内容、群別 N | AI が arm 一覧をドラフト → 人間が検証画面冒頭で arm 数・名称を確定（`ArmStructures` へ保存）してから配下項目を検証 | `ResultsData`（long）。確定した群構成は `ArmStructures` |
| `outcome_result` | 効果推定値、群別イベント数 | スキーマで定義した outcome × 時点の組み合わせごとに 1 インスタンス | `ResultsData`（long） |
| `rob_domain` | RoB 2 / ROBINS-I のドメイン判定 + 根拠 | RoB テンプレート（S5 プリセット挿入）が抽出指示に明示列挙する固定ドメインごとに 1 インスタンス。AI ドラフト（draft-schema）は RoB 項目を出さない = テンプレート挿入が唯一の入口。群構成の確定には依存しない（arm 未確定でも RoB タブは検証可） | `ResultsData`（long） |

`arm` タブのインスタンス源は、Evidence / Decisions に現れた `arm:n` に加えて、`ArmStructures` の最新確定版に含まれる `arm_key` とする。これにより、群構成カードで人間が追加・確定した arm は、AI の Evidence がなくても空セル（`AI 抽出なし（手入力のみ）`）として表示される。

`outcome_result` タブのインスタンス源は、Evidence / Decisions に現れた outcome_result キーに加えて、上記のインスタンス宣言イベントを含める。既存 outcome が一部の arm にしか現れていない場合は、同じ outcome / time を確定済み arm 全体へ展開し、見落とし値を人間が明示的に `edit` / `reject` / `not_reported` できる空セルを作る。人間が新規 outcome を追加する UI は、`entityKey.ts` の `makeOutcomeEntityKey` / 次番号採番ヘルパで `outcome:<key>|arm:<n>|time:<time>`（time は任意）を生成し、既存キーと衝突する場合は保存しない。

> **幽霊セルの分母（2026-07-09 追記）**: 非 study タブで「既存インスタンス × 全 field」の直積として作られる Evidence なしセルは、進捗の総セル数に含める。これは AI が値を出さなかったセルも「未報告」なのか「AI の取りこぼし」なのかを人間が明示判定するための automation bias 対策である。未判定のまま残ると検証進捗・ダッシュボード・エクスポート警告の分母に残る。

> **設計判断（案）**: 二値 / 連続アウトカムのメタ解析入力（2×2 表、mean/SD）を outcome_result 項目のテンプレートとしてプリセット提供する。RevMan 形式の直接出力は P2。
>
> **連続アウトカムの散布度代替報告（issue #43・2026-07-11）**: SD が未報告で SE や信頼区間しか載っていない論文、および median + IQR / range で報告する論文（skewed data で頻出）に対応するため、連続テンプレートは mean / SD / n に加えて `outcome_se` / `outcome_ci_lower` / `outcome_ci_upper` / `outcome_ci_level` / `outcome_median` / `outcome_q1` / `outcome_q3` / `outcome_min` / `outcome_max`（いずれも float・required=false）を持つ。報告された統計量を**そのまま**構造化して抽出し（verbatim quote 原則を維持）、SD への換算はツール内では行わず解析段階に委ねる（SE / CI は Cochrane Handbook §6.5.2: SD = SE×√n、SD = √n×(upper−lower)/3.92 等。median 系は Wan 2014 / Luo 2018 / Shi 2020 法の入力素材となる）。`outcome_sd` の抽出指示は「SD そのものが報告されたときだけ抽出・SE / CI / IQR / range からの計算禁止」、`outcome_mean` は「median のみ報告時は `outcome_median` へ」とし、群間差の CI を群別 CI と取り違えないよう抽出指示で明示する。IQR は四分位値（Q1 / Q3）として報告された場合のみ抽出し、幅（IQR = 2.3 等）のみの報告は not_reported とする。
>
> **RoB テンプレート（v0.9 確定）**: RoB 2（D1〜D5 + overall。判定 `low` / `some_concerns` / `high`）と ROBINS-I（D1〜D7 + overall。判定 `low` / `moderate` / `serious` / `critical` / `no_information`）を各「判定（enum）+ 根拠（text）」の 2 項目 × ドメイン共通のテンプレートとして提供する。entity_key（`rob:d1_randomization` 等）は項目の `extraction_instruction` に明示列挙し、extract-data skill のプロンプト本文は変更しない（プロンプト版数据え置き）。対象デザインでない文献（例: RoB 2 に対する非ランダム化研究）は全ドメイン `not_reported` とするよう抽出指示に含める。

---

## 4. 機能要件（画面と主要フロー）

### 4.1 画面一覧

| # | 画面 | 概要 |
| --- | --- | --- |
| S1 | Popup | プロジェクト選択・新規作成・メインビュー起動 |
| S2 | プロジェクト作成ウィザード | スプレッドシート + Drive フォルダ生成、tiab-review 引き継ぎ選択（※Q2） |
| S3 | 文献取り込み・グルーピング | Drive Picker（PDF 個別選択 + フォルダ選択で直下 PDF を一括取り込み）、テキスト層抽出とステータス表示、study 単位のグループ表示と統合 UI（§4.5: 登録番号検出の統合候補バナー・文書ロール編集）。画面に PDF の外部送信先（LLM API のみ）の説明を常時表示 |
| S4 | プロトコル入力 | 手入力 / md / docx（sr-query-builder S 系画面の UI を移植） |
| S5 | スキーマデザイン（UI 表記は「表のデザイン」） | AI ドラフト表示 → 表形式エディタで承認・編集。`extraction_instruction` を項目ごとに編集可 |
| S6 | パイロット抽出 | 2〜3 件の study で AI 抽出 → S8 と同じ検証 UI → 「表のデザインを改訂して再パイロット」導線 |
| S7 | 一括抽出 | 対象 study 選択、モデル選択、コスト概算表示、進捗バー、失敗リトライ（オフラインキュー tiab-review 準拠） |
| S8 | 検証（中核画面） | §4.2 |
| S9 | ダッシュボード | study × section 単位の検証進捗マトリクス、anchor 失敗率、not_reported 率 |
| S10 | エクスポート | 形式選択（study_wide / results_long / audit）、プレビュー、CSV 生成 + Drive 保存、論文 Methods 記載例のコピー |
| S11 | Options / 設定 | API キー（Gemini / OpenRouter / OpenAI 互換 API）、接続方式、OpenAI 互換 API の完全 URL + origin 権限要求 + JSON Schema 接続テスト、既定モデル（プルダウン + その他で直接入力。カスタムモデルの一覧管理 UI は P1）、表示言語 |
| S12 | 裁定画面（v0.11） | owner / adjudicator が、human annotator 2 名（reviewer_with_ai / reviewer_independent 等）の検証が揃った study について群構成の突き合わせ・セル単位の一致判定 / 個別裁定を行い `consensus` 行を確定（※Q4） |

### 4.2 検証画面（S8）の要件

- **検証の単位は study**: 画面上部のセレクタ・URL クエリ（`?study=`）・進捗チップはすべて study 単位
- **2 ペイン構成**: 左 = PDF.js ビューア（ページ送り、ズーム、テキスト検索）、右 = 抽出フォーム（section ごとにグループ化、entity タブで arm / outcome を切替）
- **複数文書ビューア（v0.10）**: 左ペイン上部に study 内の文書切替タブ（`document_role` バッジ + filename）。手動切替に加え、項目フォーカス / ハイライトジャンプ時は**対応 Evidence の出所文書（`Evidence.document_id`）へ自動で切り替えて**からハイライトへスクロールする。登録と論文の記載を突き合わせる selective reporting の確認が文書タブの往復でできることを狙う
- **双方向ジャンプ**: 項目フォーカス → 該当ハイライトへスクロール + 強調（必要なら文書切替を伴う）/ ハイライトクリック → 対応項目へフォーカス
- **判定操作**: `accept`（AI 値をそのまま確定）/ `edit`（値修正して確定）/ `reject`（AI 値棄却、手入力）/ `not_reported`。キーボードショートカット必須（tiab-review の判定 UI に準拠した操作感）
- **anchor_status = failed の項目**: quote 全文をフォーム側に表示し、「本文内を検索」ボタンで PDF.js のテキスト検索に quote を投入するフォールバック
- **判定チップ**: 各項目の現在ステータスをチップ表示（tiab-review の文献カードチップと同トンマナ）
- **群構成の確定**: arm レベル項目の検証前に、AI ドラフト（Evidence の arm 名フィールド値 + entity_key）を初期値として arm 数・名称を確定する（名称編集・行追加・削除）。確定内容は `ArmStructures` へ新 version として追記し、未確定のうちは arm / outcome_result タブをディム表示。確定後の改訂も同 UI から可能（新 version の追記 = 監査証跡）
- **AI 未抽出インスタンスの追加**: 群構成が確定済みのとき、arm タブは `ArmStructures` の全 arm をセル化する。outcome_result タブには「アウトカムを追加」フォームを出し、アウトカムキー（既定は既存 `outcome_<n>` の次番号）と任意の時点を入力して、確定 arm 全体に outcome_result インスタンスを追加する。追加操作は `Decisions` のインスタンス宣言イベントとして追記し、追加直後から `AI 抽出なし（手入力のみ）` の空セル群を表示する
- **戻る挙動**: 直近の判定履歴を戻れる（tiab-review の「直近 5 件履歴」仕様を項目単位に読み替えて移植）
- **保存**: 判定ごとに自分の annotator 行（`StudyData` / `ResultsData`）へ即時書き込み + `Decisions` へ追記。失敗時はオフラインキュー退避
- **独立入力モード（v0.11・`annotator_type = human_independent`）**: `reviewer_independent` ロール向けに AI 出力を一切見せない入力モードをパネルに追加する。quote・ハイライト・「他 n 箇所に一致」・AI 値のプレフィル・anchor failed バナーは描画せず、PDF ビューア（ページ送り / ズーム / テキスト検索）とフィールドラベル + `extraction_instruction`（スキーマ由来のため表示可）のみを残す。操作は `入力`（値を直接入力 → `edit`）/ `not_reported` / `undo` の 3 種（`accept` / `reject` は AI 値が無いため出さない）。群構成・outcome_result インスタンスも AI ドラフトを見せず自分で確定する。対象一覧は `Evidence` 非依存（`Studies` × 最新確定スキーマ）とし、AI 抽出の実施状況自体も盲検対象として見せない（詳細は [docs/design-independent-dual-review.md](design-independent-dual-review.md) §5）

### 4.3 AI 抽出（extract-data skill）の要件

- 1 API 呼び出し = 1 study ×（スキーマ全項目 or section 単位分割 ※トークン量で判断。複数文書の連結で入力が肥大しやすいため、分割閾値は study の全文書合計トークンで評価する）
- **複数文書の入力（v0.10）**: study の全文書をロール付きの区切りで連結して渡す（例: `=== Document 2/3 [registration] NCT01234567.pdf ===`）。文書の並び順は role の固定順（article → registration → protocol → abstract → supplement → other）→ 取り込み順。`pdf_native` モードでは全文書の PDF を添付し、添付順 = document_index とする。**`text_only` run では `text_status = no_text_layer` の文書を連結から除外**し、除外があった旨を UI と run の記録に明示する（当該文書由来の根拠は得られない）。プロンプトには「複数文書は同一試験の報告である。値が文書間で矛盾する場合は本論文（article）を優先しつつ confidence を下げ、quote は実際に値を読み取った文書から取ること」を明示する
- 出力は構造化 JSON を強制: `{ field_id, entity_key, value, not_reported, quote, page, document_index, confidence }` の配列。**対応付けは `field_id` 基準**: プロンプトに各項目の `field_id` を明示し、応答にそのまま返させる。`field_name` は改名されうる CSV 列名のため、応答に含める場合も補助情報（可読性・自己チェック用）扱いとし、`Evidence` / `StudyData` / `ResultsData` への突合には使わない。応答内の `field_id` が当該 `schema_version` の `SchemaFields` に存在しない場合、その要素は破棄して `partial_failure` として記録する
- **`document_index`（v0.10）**: プロンプトに列挙した文書一覧の 1 始まり連番。クライアントが `document_id` へ解決して `Evidence.document_id` に記録し、quote アンカリングはその文書の extracted_text に対して行う（§5）。quote があるのに document_index が欠落・範囲外の要素は破棄して `partial_failure` として記録する（field_id 不明時と同じ扱い）。`not_reported = true` の要素は document_index 不要（全文書を見た上での「報告なし」判断のため）
- **quote は本文からの verbatim 抜き出しを必須化**し、「言い換え禁止・原文どおり・最大 300 文字」をプロンプトで明示（アンカリング成功率に直結）
- 値と quote が矛盾する場合の扱い（例: quote に数値がない）は `confidence=low` を強制するバリデーションをクライアント側に実装
- 出力は `Evidence` に追記し、`ai` annotator 行（`StudyData` / `ResultsData`）へ値を転記する（§3.2）
- **実行の耐中断性**: 実行開始時に `ExtractionRuns` へ `status='running'` 行を先行追記してから `Evidence` を書き始め、完了時に確定 status の行を追記する（2 行プロトコル。§3.2 `ExtractionRuns`）。検証画面は `ExtractionRuns` に無い `run_id` の Evidence（プロトコル導入前の中断で生じた孤児）をエラーにせず未抽出扱いで除外し、S7 は中断 run の残り study をバナーで案内する（既定選択に含まれるため、そのまま実行 = 再開）
- **レート制限対策（429 対策・v0.10。2026-07-10）**: 一括抽出は study ごとにバッチを逐次実行するが、多数の study を連続処理すると LLM API の 1 分あたりリクエスト上限（RPM）に達して HTTP 429（Too Many Requests）が返る。対策は 2 本立て（`src/lib/llm/rateLimitPolicy.ts`）: **A. バッチ間スロットル**（`withThrottle`。RPM から最小リクエスト間隔 = `ceil(60000/RPM)` を導き、`executeRun` のバッチ連射を平準化）+ **B. リトライ強化**（`withRetry`。429/5xx を指数バックオフで再試行し、サーバ提示の `Retry-After` ヘッダ・本文 `RetryInfo.retryDelay` を尊重、バックオフ上限で頭打ち）。合成順は `withRetry(withThrottle(withLogging(provider)))` で、リトライの各再送もスロットル間隔で間引く。ポリシーは Options の **レート制限 tier**（無料枠 / Tier 1〜3 / カスタム RPM / 制限なし）で切り替える（tier ごとに RPM・試行回数・バックオフ上限が異なる。docs/ui-states.md §2「レート制限」）。BYOK ゆえアカウントの課金帯は拡張側から知り得ないため、既定は最も制約の強い無料枠に倒し、実測に合わせカスタムで上書きできるようにする
- **Sheets 書き込みの 429 対策（v0.10。2026-07-10）**: 一括抽出の並列実行（同時実行数 2 以上。上記のスループット対策）は LLM 側の RPM だけでなく、**Google Sheets API の書き込みクォータ（60 回/分/ユーザー。read と write は別バケット）**にも触れうる。原因は study ごとに `Evidence` を都度 `appendEvidence`（1 回の API リクエスト）していたため、並列化で短時間に集中すると 60/分を超えること。対策は 2 本立て: **A. Evidence 書き込みのバッチ化**（`executeRun.ts`: study ごとの即時書き込みをやめ、メモリバッファに貯めて `flushEveryNStudies` study ぶんたまるか全 study 完了時にまとめて `appendEvidence` する。フラッシュは直列化し二重フラッシュを防ぐ。フラッシュ失敗時は含まれる study を全部 `save_failed` として partial_failure に記録し、S7 の再試行で拾えるようにする〔握りつぶさない〕）+ **B. `googleFetch` の 429/503 リトライ**（`src/lib/google/types.ts`: Sheets/Drive 共通の fetch ラッパに 429・503 のみ対象の指数バックオフ + サーバ提示 `Retry-After` 尊重 + `maxDelayMs` 上限での再送を追加。400/401/403/404 等の入力・認可エラーは従来どおり即 throw）。中断された run の study はもともと「未抽出」に戻って再実行するモデル（2 行プロトコル）なので、per-study 保存をバッチ化しても耐中断性は後退しない。詳細は [docs/handoff-20260710-sheets-write-batching.md](handoff-20260710-sheets-write-batching.md)
  - **`flushEveryNStudies` の tier 連動（2026-07-10）**: 並列数・RPM が大きい tier ほど書き込みも集中しやすいため、`flushEveryNStudies` は `RateLimitPolicy` の一部として tier ごとに決め打ちする（`src/lib/llm/rateLimitPolicy.ts`）: 無料枠 = 5 / Tier 1 = 8 / Tier 2 = 12 / Tier 3 = 15 / 制限なし = 15 / カスタムのベース = 5。**カスタム tier で同時実行数（`maxConcurrency`）を指定した場合**は、並列数が書き込み集中の実ドライバであるため `flushEveryNStudies = clamp(round(maxConcurrency × 2), 5, 15)` で上書きする（`resolvePolicyForTier`。並列数未指定＝既定 1 のままなら 5 のまま）。`extractionService.ts` が executeRun へ渡す値の優先順は **明示注入（テスト用）> tier のポリシー値 > 既定値（`DEFAULT_FLUSH_EVERY_N_STUDIES` = 5）**
  - **1 フラッシュの行数キャップ（安全弁。2026-07-10）**: study 数だけを発火条件にすると、1 study あたりの抽出項目が多い場合にバッファが際限なく育みうる。そのため `executeRun.ts` の `maybeFlush` は「distinct study 数が `flushEveryNStudies` 以上」**または**「バッファの総行数が `maxRowsPerFlush`（既定 `DEFAULT_MAX_ROWS_PER_FLUSH` = 500）以上」のどちらかで発火する。これは発火トリガーであって 1 フラッシュを厳密に 500 行以下へ分割するものではない（1 study が 500 行を超えていてもその study 単位では割らない）。各 push のたびに条件を再評価するため、バッファは「キャップ + 直近 1 study ぶん」程度で頭打ちになる
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
| run_id / evidence_id / document_id / ai_value / ai_not_reported / quote / page / confidence / anchor_status | `Evidence` | document_id は quote の出所文書（v0.10）。添付 Evidence がない判定では `.`（下記規則 2） |
| decision_seq | 導出 | セル × annotator 内で decided_at 昇順の 1 始まり連番（undo も数える）。プレースホルダ行は `.` |
| action / decision_value / decided_by / decided_at / note | `Decisions` | プレースホルダ行は `.` |

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
- **study 単位のグループ表示**: S3 一覧は study ごとにグループ化し、配下の文書に role バッジと text_status を表示。role・study_label・registration_id はインライン編集可
- **手動統合**: 複数 study をチェック →「同一試験としてまとめる」。統合ダイアログで統合後の `study_label` / `registration_id`（既定 = 統合元のうち最初に取り込まれた study の値）と各文書の role を確認・編集して確定
- **分離・所属変更**: study から文書を外して独立させる / 別の study へ移す操作も同画面から行う
- **試験登録番号の自動検出**: 取り込み時に extracted_texts から登録番号を正規表現で検出（NCT / ISRCTN / UMIN / jRCT / JPRN / ChiCTR / EudraCT / ACTRN 等の主要レジストリ）し、`Studies.registration_id` の初期値に設定する。同一番号を持つアクティブ study が複数あるときは S3 上部に**統合候補バナー**を表示し、ワンクリックで統合ダイアログへ、または「無視」できる。**自動統合はしない** — 本文が他試験の登録番号を引用しているだけの誤検出は人間にしか弾けない（automation bias 対策と同じ「AI は提案、人間が確定」の思想）。無視した候補ペアは `chrome.storage.local` に記録して再提案を抑止する（シートには書かない）
- **統合・分離の意味論（重要）**: 文書集合が変化した study は**常に新 study_id で作り直す**（`Studies` へ新行追記 + `Documents.study_id` 付け替え。§3.2）。分離・所属変更では「外された側の残り」「移動先」も文書集合が変わるため同様に新 study_id となる。対象 study に抽出済みデータ（完了 run / 判定）がある場合は、確認ダイアログで「統合後この試験は未抽出に戻る（過去の判定履歴は `Decisions` に残る）」ことを明示して続行 / 中止を選ばせる。新 study はどの `ExtractionRuns` 完了行にも載っていないため S7 の既定選択（未抽出の全件）に自然に含まれ、**再抽出がそのまま復旧手段**になる。旧 study 宛のデータ行は書き換えず監査用に残置する（追記型の原則。audit.csv には非アクティブ study の行は出力しない）

> **実装の段階分割（案）**: (1) データモデル + S3 グルーピング UI + 登録番号検出（抽出以下は 1 文書 study のままでも動く）→ (2) 抽出の study 単位化（複数文書連結 + document_index + Evidence 拡張）→ (3) 検証の複数文書ビューア + ダッシュボード / エクスポートの study 単位化。ただしキー改名（document_id → study_id）は全層を貫くため、(1) の時点でリポジトリ層の改名を一括で済ませる。

### 4.6 裁定画面（S12・v0.11。独立二重レビューのモード③）

owner / adjudicator が human annotator 間の不一致を裁定し、`consensus` 行を確定する画面。詳細設計は [docs/design-independent-dual-review.md](design-independent-dual-review.md) を参照。

- **対象と単位**: study 単位。human annotator がちょうど 2 名（`reviewer_with_ai` / `reviewer_independent` / owner の組み合わせ）いる study が対象。両者の検証が 100% 完了した study のみ裁定を開始でき、未完了 study は完了状況（n / m）のみを見せて内容は隠す（盲検の継続）
- **群構成の突き合わせ**: 両者の最新 `ArmStructures` を位置対応（`arm:1` ↔ `arm:1`）で並べ、本数・名称が一致すれば 1 クリックで採用、不一致なら裁定者が編集して確定 → `ArmStructures` へ `annotator='consensus'` の版として追記。`rob_domain` と study レベルは群構成に依存しないため未確定でも裁定可（既存の arm 依存判定と同じ規約）
- **セル突き合わせ**: `StudyData` / `ResultsData` の owner 行 vs reviewer 行の**現在値**を entity_key の和集合で突き合わせる。一致判定は trim 後の完全文字列一致（数値表記ゆれの同一視は v1 では行わない）。`schema_version` が両者で異なるセルは警告バッジ付きで不一致側に列挙
- **裁定操作**: 一致セルは「一致セルを一括採用」で 1 操作確定。不一致セルは A を採用 / B を採用 / 第 3 の値を入力 / `not_reported` / スキップ（consensus セルを作らない）から選ぶ
- **書き込み**: consensus 行の upsert（`StudyData` / `ResultsData`。`annotator='consensus'` / `annotator_type='consensus'`）+ `Decisions` 追記（`decided_by` = 裁定者 email、`annotator='consensus'`。「一括採用」= `accept`、「A・B のどちらか採用・第 3 の値」= `edit`、「not_reported 裁定」= `not_reported`、取り消し = `undo`）。エクスポートは変更不要（`selectFinalAnnotator` が consensus を優先する既存実装のまま有効）
- **v1 の簡略化**: PDF ペインは表示 + 検索のみ（Evidence ハイライト・`Decisions.note` 表示は省略）/ arm の並べ替えマッピングなし（位置対応固定）/ 一致率・κ 統計の表示なし / 3 人以上の reviewer には非対応 / 裁定の書き込み失敗時はオフラインキューへ退避しない（トースト表示のみ）
- **実機確認**: 2 アカウントでの共有 → 検証 → 裁定 → エクスポート（consensus 優先）の通し確認は未実施（[docs/manual-testing.md](manual-testing.md) 参照）

---

## 5. quote アンカリング（ハイライト位置決定）方式

本拡張の技術的な中核。LLM が返した verbatim quote を PDF.js テキスト層上の位置に対応付ける。**アンカリングの対象は quote の出所文書 1 本**（`Evidence.document_id` の extracted_text / テキスト層。v0.10）であり、study 内の他文書は探索しない。`page` ヒントも当該文書内のページ番号。

1. **正規化**: quote と各ページのテキスト層の双方に共通正規化を適用（空白圧縮、行末ハイフネーション結合 `exam-\nple → example`、リガチャ展開 `ﬁ → fi`、全角/半角統一、Unicode NFKC）
2. **段階的マッチング**:
   - `exact`: ai_page ± 1 ページ内で正規化後の完全一致
   - `normalized`: 全ページで正規化後の完全一致
   - `fuzzy`: スライディングウィンドウ + 編集距離（閾値: quote 長の 15% 以内）で最良一致
   - `failed`: 上記すべて不成立。ハイライトなし、S8 のフォールバック UI へ
3. **複数一致時**: ai_page に最も近い出現を採用し、UI に「他 n 箇所に一致」を表示して切替可能に
4. **ハイライト描画**: マッチした文字範囲をテキスト層の span 座標に写像し、CSS オーバーレイで描画（検証済み = 緑系 / 未検証 = 黄系 / low confidence = 橙系）。塗りは `mix-blend-mode: multiply` で下地の文字と合成し、濃さに関わらず文字が読めるようにする（枠は通常合成のまま残し、暗地 = 反転表ヘッダ等の上でも選択枠が視認できるようにする）。**選択中セルのハイライト = 青（塗り + 実線枠）**、**検索ヒット = 青（塗り）+ 破線枠**で区別する。抽出テキスト表示（S8 の text モード）の根拠マークも「選択中 = 青」に合わせる（2026-07-10 issue #31 で確定）
5. アンカリング結果（`anchor_status`）は精度改善のための計測対象とし、S9 ダッシュボードで失敗率を可視化

> **リスク**: LLM が PDF を直接読む場合（`input_mode = pdf_native`）、LLM の内部テキスト認識と PDF.js テキスト層が不一致になりうる（表の読み順、2 段組みの結合順）。パイロットで anchor 失敗率を計測し、`text_only` モードとの比較で入力方式を確定する（※Q3）。

> **テキスト層なし PDF（`text_status = no_text_layer` ※Q7）**: アンカリングの対象外。抽出は `pdf_native` モードで可能だが、**その文書を出所とする Evidence** はハイライトなし（`anchor_status = failed` 扱い）となり、S8 では quote 全文表示 + ページヒントのみで検証する（PDF.js のテキスト検索フォールバックも使えない点を UI に明示）。study 内の他文書がテキスト層を持つ場合、そちらを出所とする Evidence は通常どおりハイライトされる。

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

| フェーズ | 含むもの |
| --- | --- |
| **MVP** | 単独プロジェクト作成、PDF 取り込み（テキスト層あり + 画像のみ PDF。後者は `pdf_native` 抽出・ハイライトなし ※Q7）、**複数報告文書の study 統合（v0.10・§4.5）**、プロトコル入力、AI スキーマドラフト + 編集、パイロット → 本抽出（study 単位）、単一レビュアー検証 UI（ハイライト付き・文書切替）、long / wide / audit CSV、Gemini / OpenRouter / 利用者指定 OpenAI 互換 API（BYOK） |
| **P1** | 二重独立抽出 + 不一致解決画面（tiab-review「担当セット」の思想を移植 ※Q4。**2026-07-11 に実装済み** — `Reviewers` タブ・ロールモデル・S8 独立入力モード・S12 裁定画面。§4.6 / [docs/design-independent-dual-review.md](design-independent-dual-review.md) 参照。2 アカウントでの実機通し確認は未実施）、tiab-review プロジェクト引き継ぎ、OpenRouter カスタムモデルの管理 UI（プロバイダ実装 + モデルセレクタは 2026-07-04 に MVP へ前倒し済み）、RoB テンプレートスキーマ（2026-07-07 に MVP へ前倒し済み ※v0.9）、UI 英語化 |
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
| Sheets 行数・レート制限 | batchUpdate、指数バックオフ、40,000 行規模（§6 性能想定）での負荷試験を MVP 完了条件に含める |

---

## 10. 未決定事項（レビュー済み）

> v0.2 で暫定確定に格上げ → v0.3 でユーザーレビューを反映して確定。Q8 の閾値のみベンチマーク設計時に最終確定する。

| # | 論点 | 決定 |
| --- | --- | --- |
| Q1 | プロダクト名 | **確定: `sr-data-extraction-plugin`** |
| Q2 | tiab-review プロジェクトとの連携 | (a) 同一スプレッドシートにタブ追加 (b) 別スプレッドシート + `Meta` 経由の相互参照 (c) MVP は完全独立。**暫定: (c) で開始し P1 で (b)**（タブ増加による読み出しコスト増を避ける sr-query-builder §11 の判断と同旨） |
| Q3 | LLM への入力方式 | (a) PDF を直接送信（表・レイアウト理解に強い）(b) 抽出テキストのみ（アンカリング一致率に強い）。**確定: 両対応で実装。キャリブレーション（パイロット）では両方式で実行し、anchor 失敗率と抽出精度を比較して残りをどちらでやるか決める** |
| Q4 | 二重抽出を MVP に含めるか | Cochrane 的には二重が原則だが、本拡張の設計思想は「AI 第一抽出者 + 人間検証者」。**確定: 二重独立 + adjudication。tiab-review-plugin と同じく、AI / AI を見たヒト / AI なしのヒトを別レビュアー（annotator）扱いにして不一致解消ができるようにする**（v0.4 で §3.2 を annotator 軸に再設計して反映済み。**MVP はデータ構造のみ対応**（`human_independent` / `consensus` の enum・行構造）。**独立抽出の UI・運用と adjudication 画面は P1**）。**2026-07-11 追記（v0.11）: 実装済み** — `Reviewers` タブ・ロール解決・S8 独立入力モード・S12 裁定画面（§3.2・§4.2・§4.6・[docs/design-independent-dual-review.md](design-independent-dual-review.md)）。2 アカウントでの実機通し確認は未実施 |
| Q5 | entity_level の粒度 | study のみ / +arm / +outcome_result。**確定: 3 レベルすべて MVP に含める**（メタ解析入力を出せないと実用にならないため） |
| Q6 | エクスポート / データ保持の形 | **確定: study レベルの Table 1 的内容は wide（`StudyData` → study_wide.csv）、arm 別のアウトカム・RoB は long（`ResultsData` → results_long.csv）でシートを分けて保持する。完全 wide の列サフィックス展開は後のメタ解析での取り回しが大変になるため採らない**（v0.4 で §3.2 / §4.4 に反映済み） |
| Q7 | スキャン PDF（OCR） | **確定: 対応する。画像のみ PDF も `pdf_native` モード（PDF を直接 LLM へ送信）で抽出対象にする**。テキスト層がないためアンカリング / ハイライトは不可（§5 参照） |
| Q8 | 既定モデルと採用基準 | **確定: 工場出荷の既定モデル = `gemini-3.5-flash`（2026-07-06）**。実データ抽出ベンチマーク（`experiments/extraction-benchmark-real/REPORT.md`。不眠 SR 10 論文の人手 gold）で項目正確度が最良（成功 run 72%・anchor 92.5%）だったため採用。採用基準の参考は CESAR プロジェクトの中止境界（下表）。事前登録ベンチ（`experiments/extraction-benchmark/`）は別建てで凍結保持し、正式な再確認に使える |
| Q9 | PDF 原本の扱い | (a) プロジェクトフォルダへコピー（凍結スナップショット、監査に強い）(b) 参照のみ（ユーザーが原本を移動すると壊れる）。**確定: (a) コピー**。取り込み時に `documents/` へコピーを作成し、`Documents.drive_file_id` にはコピーの ID を、元 PDF の ID は `source_file_id` に分けて記録する（§3.2） |
| Q10 | 複数報告文書（multiple reports）の扱い | **確定（v0.10・2026-07-07）: study / document を分離し、study を抽出・検証・エクスポートの単位にする**。検討 3 案 — (a) study 第一級エンティティ化 (b) primary document 方式（主文書の document_id を study キーに流用）(c) 抽出は文書単位のまま検証で人間が統合 — のうち (a) を採用（(b) は主文書差し替えでキーが揺れ、(c) は文書横断コンテキストを LLM に与えられず目的を達しない）。付随決定: ① study メタデータは新設 `Studies` タブ（14 タブ目）② 取り込みは 1 PDF = 1 study 自動生成 → S3 で後から統合 ③ 登録番号の自動検出は候補提案 → ユーザー確認（自動統合しない）④ 抽出後のグルーピング変更は可 — 新 study_id 発行で「未抽出」に戻して再抽出を促す（旧データ行は監査用に残置）。未リリースのため後方互換なし（§3.2 / §4.5） |

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

- OAuth / Sheets / Drive クライアント層、オフラインキュー、LLM プロバイダ抽象化（Gemini / OpenRouter / OpenAI 互換 API）、モデル ID マイグレーション機構 → 共通ライブラリ化を検討（3 拡張のモノレポ化 or npm パッケージ切り出しは別途判断）
- UI トンマナ: tiab-review のサイドパネル系コンポーネント（判定チップ、進捗表示）+ sr-query-builder のメインビュー / ウィザード構成
- ドキュメント構成: `docs/requirements.md`（本書）に加え、[docs/ui-flow.md](ui-flow.md) / [docs/architecture.md](architecture.md) / [docs/ui-states.md](ui-states.md) を sr-query-builder と同構成で整備（v0.2 で作成済み）
