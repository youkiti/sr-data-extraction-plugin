# 実装ハンドオフ: study / document モデル（複数報告文書の統合）v0.10

- **作成日**: 2026-07-07
- **対象読者**: 本機能の実装を担当するエンジニア（本リポジトリでの作業が初めての人を想定）
- **正典**: [docs/requirements.md](requirements.md) v0.10 — 特に **§3.2「study と document の分離」「`Studies`」「`Documents`」**、**§4.3（抽出の study 単位化）**、**§4.5（文献グルーピング）**、**§10 Q10（決定経緯）**。本書と requirements.md が食い違ったら requirements.md が勝ち（食い違いを見つけたら報告すること）
- **ステータス**: 要件確定済み・実装未着手

---

## 1. 何を作るのか（3 行で）

SR では 1 つの試験（trial）が複数の PDF（本論文・試験登録・プロトコル論文・学会抄録）で報告される。現状は「1 PDF = 1 研究」の暗黙前提で全タブが `document_id` キーだが、これを **study（試験）を抽出・検証・エクスポートの単位、document（PDF）を quote アンカリング・ハイライトの単位**に分離する。AI 抽出は 1 study の全文書を連結して 1 回で行い、検証画面では根拠クリックで出所 PDF に自動で切り替わる。

## 2. 着手前に必ず読むもの

| 順 | ドキュメント | 読む箇所 |
| --- | --- | --- |
| 1 | [CLAUDE.md](../CLAUDE.md) | 全部（作業原則 1〜8 は強制） |
| 2 | [docs/requirements.md](requirements.md) | §3.2 / §3.3 / §4.2 / §4.3 / §4.5 / §5 / §10 Q10 |
| 3 | [docs/architecture.md](architecture.md) | `src/` の層構成（domain → features → app/services → app/views） |
| 4 | [docs/test-strategy.md](test-strategy.md) | jest 100% 強制・E2E seam（`__E2E_PRELOADED_STATE__` / stub 配信） |
| 5 | [docs/ui-states.md](ui-states.md) | S3 / S8 の現状 spec（**実装前に v0.10 分の状態マトリクスを追記してから**画面を書くこと。spec-first 運用） |

## 3. 設計の要点（実装判断の根拠になる不変条件）

1. **キーの改名**: `StudyData` / `ResultsData` / `ArmStructures` / `Decisions` の `document_id` 列は `study_id` へ**改名**（列追加ではない）。`ExtractionRuns.document_ids` → `study_ids`、`run_type: single_document` → `single_study`、`LLMApiLog.purpose: extract_document` → `extract_study`、`ExportLog.document_count` → `study_count`。**未リリースのため後方互換・マイグレーションは一切不要**（旧形式のシートを読めなくてよい。開発用プロジェクトは作り直す）
2. **`Evidence` だけは `document_id` を持ち続ける**（quote は特定 PDF の中にある）。`study_id` を併記する 2 キー構成
3. **1 PDF 取り込み = 1 study 自動生成**。グルーピングは取り込み後の S3 で行う
4. **グルーピング変更（統合・分離・所属変更）= 影響 study を新 study_id で作り直す**。旧 study のデータ行は書き換えず残置（追記型の監査原則）。新 study はどの `ExtractionRuns` 完了行にも現れない → 自動的に「未抽出」扱いに戻る。これが再抽出導線を兼ねる（requirements.md §4.5「統合・分離の意味論」）
5. **アクティブ study = `Documents` から 1 件以上参照されている study**。参照 0 の `Studies` 行は非アクティブ（一覧・集計・エクスポートに出さない。削除もしない）
6. **登録番号による自動グルーピングはしない**。候補バナー → ユーザーがワンクリック確定。無視は `chrome.storage.local` に記録（シートを汚さない）
7. AI 応答の各要素に `document_index`（プロンプト内文書一覧の 1 始まり連番）を必須化。quote があるのに欠落・範囲外 → その要素は破棄して `partial_failure`（`field_id` 不明時と同じ扱い）。`not_reported=true` の要素は不要

## 4. 実装フェーズ

requirements.md §4.5 末尾の段階分割に従い、**3 フェーズ = 3 PR** に分ける。各フェーズ完了時に `npm test`（カバレッジ 100%）→ `npm run dev` → UI に触れたら `npm run test:e2e` を通してから PR を出すこと。

> **注意（着手時の作業ツリー）**: 2026-07-07 時点で作業ツリーに未コミットの別作業（v0.9 RoB テンプレート）が載っている可能性がある。`git status` を確認し、先行作業がコミット / マージされてから新ブランチ（例: `feat/study-document-model`）を切ること。

---

### フェーズ 1: データモデル + キー改名 + S3 グルーピング UI

**ゴール**: `Studies` タブが存在し、S3 で統合・分離・ロール編集ができる。抽出〜検証は「1 文書 study」のまま今までどおり動く（キー名だけ変わる）。

#### 1-a. domain 層

| ファイル | やること |
| --- | --- |
| `src/domain/study.ts`（新規） | `StudyRecord`（studyId / studyLabel / registrationId / createdAt / createdBy / note）。requirements.md §3.2 `Studies` の写し |
| `src/domain/document.ts` | `DocumentRecord` に `studyId: string` / `documentRole: DocumentRole` を追加、`studyLabel` を**削除**（Studies へ移設）。`DocumentRole = 'article' \| 'registration' \| 'protocol' \| 'abstract' \| 'supplement' \| 'other'` |
| `src/domain/sheetsSchema.ts` | `SHEET_TABS` に `'Studies'`（14 タブ）。`SHEET_HEADERS` を §3.2 のとおり全面改訂: Studies 新設 / Documents（study_id・document_role 追加、study_label 削除）/ ExtractionRuns（study_ids）/ `STUDY_DATA_FIXED_HEADERS`（study_id）/ ResultsData・ArmStructures・Decisions（study_id）/ Evidence（study_id 追加。document_id は残す）/ ExportLog（study_count）。冒頭コメントの「13 タブ」も更新 |
| `src/domain/evidence.ts` / `annotation.ts` / `decision.ts` / `armStructure.ts` / `extractionRun.ts` / `exportLog.ts` / `llmApiLog.ts` | 型のフィールド改名を機械的に反映（`documentId` → `studyId` 等。Evidence は `studyId` 追加 + `documentId` 維持） |

#### 1-b. リポジトリ層（キー改名の一括対応）

対象: `features/documents/documentRepository.ts`、`features/extraction/annotationRepository.ts` / `evidenceRepository.ts` / `runRepository.ts`、`features/verification/decisionRepository.ts` / `armStructureRepository.ts`、`features/export/*Csv.ts` / `exportLogRepository.ts`、`features/project/progressCounts.ts` / `createProject.ts`（14 タブ生成）。

新規: `features/documents/studyRepository.ts` — Studies 行の追記・行内編集（study_label / registration_id / note）・全件読出・「アクティブ study」の解決（Documents との突合）。

**方針**: 改名は grep で機械的に潰せる（`document_id` / `documentId` / `documentIds` / `readRunDocumentCoverage` 等）。ただし **Evidence と Documents タブ自身、`extracted_texts/{document_id}.txt`、`loadDocumentPages` は document のまま**が正しいので、盲目的な一括置換はしないこと。1 ファイルずつ「これは study の話か document の話か」を判断する。

#### 1-c. グルーピングのドメインロジック

| ファイル | やること |
| --- | --- |
| `features/documents/detectRegistrationId.ts`（新規） | extracted text から登録番号を正規表現検出。対応レジストリ: NCT\d{8} / ISRCTN\d+ / UMIN\d{9} / jRCT[a-z]?\d+ / JPRN-\w+ / ChiCTR\d+ / EudraCT（\d{4}-\d{6}-\d{2}）/ ACTRN\d{14}。複数ヒット時は最頻出 → 先頭出現の順で 1 件を返す（曖昧なら null でよい。**過検出より取りこぼしが安全**） |
| `features/documents/groupStudies.ts`（新規） | 統合・分離・所属変更の意味論（§3 要点 4）。入力 = 対象 study / document、出力 = 「新 Studies 行 + Documents の study_id 付け替えリスト」。抽出済みデータの有無判定（ExtractionRuns 完了行の study_ids に載っているか）もここ |
| `features/documents/importDocuments.ts` | 取り込みフローで study 自動生成（label 提案ロジックは既存流用、role 既定 `article`、registration_id は検出結果）。Studies 追記 → Documents 追記の順（Documents.study_id が必ず解決できる不変条件） |

#### 1-d. S3 UI（`app/services/documentsService.ts` + `app/views/documentsView.ts`）

requirements.md §4.5 のとおり。状態は先に [ui-states.md](ui-states.md) へ追記してから実装する。

- study 単位のグループ表示（配下文書に role バッジ + text_status）。study_label / registration_id / role のインライン編集
- 複数 study 選択 → 「同一試験としてまとめる」→ 統合ダイアログ（`role="alertdialog"` は既存 S7/S10 の確認カード実装を参考に）
- 統合候補バナー（registration_id 一致のアクティブ study が複数）。「統合」「無視」。無視ペアは `lib/storage/chromeStorage.ts` 経由で storage.local に永続化
- 抽出済みデータがある study を含む統合 → 警告文言（§4.5）を出して続行 / 中止
- `AppState.documents` スライス（`app/store.ts`）に studies / 候補 / ダイアログ状態を追加

#### 1-e. フェーズ 1 の受け入れ条件

- [ ] 新規プロジェクトが 14 タブで生成される
- [ ] PDF 3 本取り込み → study 3 件が自動生成され、S3 が study 単位で表示される
- [ ] 2 study を統合 → Studies に新行が追記され、旧 2 行は残置、Documents の study_id が付け替わる。統合後の一覧・進捗カウントに旧 study が出ない
- [ ] 同じ NCT 番号を含む 2 文書で候補バナーが出る。無視 → リロード後も再提案されない
- [ ] パイロット → 検証 → エクスポートの既存 E2E が（キー改名適応後）全部通る
- [ ] `tests/e2e/app-documents.spec.ts` に統合シナリオ + axe を追加

---

### フェーズ 2: 抽出の study 単位化

**ゴール**: 1 API 呼び出し = 1 study。複数文書がプロンプトに連結され、Evidence に出所文書が記録される。

| ファイル | やること |
| --- | --- |
| `features/extraction/planRun.ts` | バッチ単位を document → study へ。トークン予算は **study の全文書合計**で評価して全項目 or section 分割を判断。text_only で `no_text_layer` 文書を入力から除外し、除外情報を計画に含める（UI 表示用） |
| `features/extraction/skills/extractData.ts` | プロンプト: 文書をロール付き区切りで連結（`=== Document 2/3 [registration] NCT01234567.pdf ===`）。並び順は role 固定順（article → registration → protocol → abstract → supplement → other）→ 取り込み順。文書間矛盾時の指示（§4.3: article 優先 + confidence low + quote は読み取った文書から）。構造化出力スキーマに `document_index`（int）追加。**プロンプト版数を上げ、`withLogging` の記録に反映**（既存の版数管理に倣う） |
| `features/extraction/validateAiOutput.ts` | `document_index` 検証: quote がある要素で欠落・範囲外 → 要素破棄 + partial_failure。`not_reported=true` は不要。zod スキーマ更新 |
| `features/extraction/executeRun.ts` | study の各文書の extracted text を読み（`loadDocumentPages` は document 単位のまま複数回呼ぶ）、アンカリングは **document_index が指す文書のテキスト**に対して実行。Evidence に studyId + documentId を書く。`pdf_native` は全文書の PDF を添付（添付順 = document_index） |
| `features/extraction/docProgress.ts` | document 単位進捗 → study 単位進捗へ改名・畳み込み変更（`studyProgress.ts` にリネーム推奨） |
| `app/services/extractService.ts` / `pilotService.ts` | 対象選択・既定選択（未抽出の全 study）・失敗 study の再試行（`run_type='single_study'`）・S6 既定選択 = テキスト層あり先頭 3 study。コスト概算は study 合計トークンで |

**受け入れ条件**:

- [ ] 2 文書の study で抽出 → Evidence の各行に正しい document_id が入り、登録 PDF 由来の quote は登録 PDF 側でアンカリングされる
- [ ] document_index 欠落応答（jest でモック）→ 要素破棄 + partial_failure 記録
- [ ] text_only run で no_text_layer 文書が連結から除外され、UI にその旨が出る
- [ ] `tests/e2e/app-extract.spec.ts` / `app-pilot.spec.ts` を study 単位に更新して通す

---

### フェーズ 3: 検証の複数文書ビューア + 下流の study 単位化

**ゴール**: `#/verify?study=` で study を開き、根拠クリックで出所 PDF へ自動切替。ダッシュボード・CSV も study 単位。

| ファイル | やること |
| --- | --- |
| `app/router.ts` / `app/bootstrap.ts` | `docQueryOf` → `studyQueryOf`（`?doc=` → `?study=`）。`?entity=` ディープリンクは既存仕様のまま |
| `app/services/verifyService.ts` / `verificationService.ts` | 検証データ束を study 単位で組み立て（複数 PDF + 各文書のテキスト層。**PDF バイナリは文書切替時の遅延読込**にする — §6 性能）。判定永続化は study_id キーへ（offlineQueue 'decisions' のペイロード型も更新） |
| `app/ui/pdfViewer.ts` / `app/views/verificationPanel.ts` | 文書切替タブ（role バッジ + filename）。項目フォーカス / ハイライトジャンプ時に Evidence.document_id の文書へ自動切替してからスクロール。**描画競合の連番ガード（既存実装）を文書切替でも維持**すること |
| `features/verification/cells.ts` / `highlights.ts` / `progress.ts` | セルモデルは study 単位に（highlights は document 別に構築し、セル → 出所文書の対応を持たせる） |
| `features/verification/dashboard.ts` + `app/services/dashboardService.ts` + `dashboardView.ts` | マトリクスを study × section へ。セルリンクは `#/verify?study=&entity=` |
| `features/export/buildStudyWideCsv.ts` / `buildResultsLongCsv.ts` / `buildAuditCsv.ts` | study_label / study_id は Studies 由来。audit.csv に document_id 列（Evidence 由来。判定に Evidence 添付がなければ `.`）。並び順は study 作成順。非アクティブ study は出力しない。`ExportLog.study_count` |

**受け入れ条件**:

- [ ] 2 文書 study で、article 由来の項目 → registration 由来の項目の順にフォーカスすると、ビューアが自動で文書切替してハイライトする
- [ ] 群構成確定 → ArmStructures に study_id で追記され、`#/pilot` 側の共有パネルでも動く
- [ ] audit.csv の各行に quote 出所の document_id が出る
- [ ] `app-verify.spec.ts` 2 本 + `app-dashboard.spec.ts` + `app-export.spec.ts` を更新して通す（axe 込み。E2E は最小実 PDF stub を 2 本配信する形へ拡張）

---

## 5. 横断的な注意点（ハマりどころ）

1. **`extracted_texts/{document_id}.txt` は変えない**。テキストは文書単位が正しい（アンカリングの対象だから）。「study 単位に統合したテキストファイル」を作りたくなるが、作らないこと
2. **Sheets 書き込みの範囲指定**: `lib/google/sheets.ts` の `updateRow` / `getSheetValues` は全列対応へ一般化済み（StudyData の動的値列が Z 列超えするため）。列を増やすとき A1 範囲のハードコードを新たに書かないこと
3. **ExtractionRuns の 2 行プロトコル**（running 行 → 完了行。§3.2）を壊さない。「抽出済み」判定は常に**完了行の study_ids** で行う。`runRepository.readRunDocumentCoverage` の改名時にこの規約を維持
4. **entity_key の study レベルは `-`**（`utils/entityKey.ts`）。study_id と混同しない
5. **E2E seam**: 画面 E2E は `__E2E_PRELOADED_STATE__` 注入と Sheets/Drive/LLM の stub 配信で動く（[test-strategy.md](test-strategy.md)）。state 形が変わるので、preload fixture の更新漏れがあると「実装は正しいのにテストだけ落ちる」状態になる。落ちたらまず fixture を疑ってよい（ただし作業原則 3: 仕様変更でテストを直すときはユーザーに確認）
6. **jest カバレッジ 100% 強制**: 新規ファイルは分岐網羅まで書く。既存テストの改名追随は `tests/unit/` 配下の対応ディレクトリ構成に従う
7. **a11y**: 過去の E2E で見出し階層スキップ（h2 → h4）と非アクティブタブのコントラストで axe 違反を出した実績がある。文書切替タブ・統合ダイアログでも同じ轍を踏まない
8. **UI 文言・コミットメッセージ・コメントは日本語**（作業原則 2）
9. **document_role の並び順定数**はプロンプト連結（フェーズ 2）と S3 表示（フェーズ 1）で共有するので、domain 層に 1 箇所で定義する

## 6. 完了の定義（全フェーズ共通）

- `npm test`（カバレッジ 100%）/ `npm run dev` / `npm run test:e2e` がすべて通る
- requirements.md との齟齬がない（齟齬を見つけたら実装を曲げる前に報告）
- [ui-states.md](ui-states.md)（対象画面の状態マトリクス）・[CLAUDE.md](../CLAUDE.md)（現在フェーズの実装済みリスト）・[ui-flow.md](ui-flow.md)（`?study=` クエリ）を同期
- 実機確認: [docs/manual-testing.md](manual-testing.md) の運用に倣い、最低 1 回は実 Google アカウントで「2 文書統合 → 抽出 → 検証（文書切替）→ エクスポート」を通す（Selenium 半自動ハーネス `tools/selenium/manualCheck.mjs` が使える）

## 7. 実装者の裁量に委ねる点

- 統合ダイアログ・候補バナーの細かいレイアウト（トンマナは tiab-review 準拠。既存の警告バナー / alertdialog 実装に合わせる）
- `groupStudies.ts` の関数分割・命名
- フェーズ 1 内のコミット分割（ただし「domain + repository 改名」と「S3 UI」は分けると差分が読みやすい）

判断に迷う点・requirements.md の解釈が割れる点が出たら、**実装で勝手に確定せず** issue / PR コメントで質問すること。
