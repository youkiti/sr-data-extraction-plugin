# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## 現在のフェーズ

**フェーズ 1 実装中**（2026-07 時点）。scaffolding（package.json / webpack / jest / Playwright / CI-1）と `src/` の骨格（popup / app シェル〔router / store / guards / views 雛形〕 / options〔API キー保存は実装済み〕 / anchoring 中核〔スパイクから移植〕）に加え、`lib/google/`（OAuth + Sheets + Drive。sr-query-builder からコピー流用）・プロジェクト生成（`features/project/`: 12 タブ + Drive フォルダ 4 種）・Popup S1（ログイン / 新規作成 / 既存 ID / 最近のプロジェクト）・CSV エクスポートビルダー・extraction の AI 応答バリデーション（`validateAiOutput`: zod + 値/quote 矛盾 → confidence=low 強制）・extract-data skill のプロンプト管理（`skills/extractData.ts`: プロンプト構築 + 構造化出力スキーマ + 応答パース）・一括抽出の実行計画（`planRun.ts`: document × スキーマのバッチ分割〔全項目 or section 単位をトークン予算で判断〕+ トークン / コスト概算）・`lib/llm/` 一式（sr-query-builder から移植: `LLMProvider` 抽象 + `GeminiProvider`〔nullable union → Gemini 方言変換を追加〕+ `withRetry` + `withLogging`〔プロンプト版数記録を追加〕+ `providerFactory`〔model 必須・OpenRouter は P1 エラー〕+ 単価表 `pricing.ts`）・一括抽出の実行（`executeRun.ts`: planRun の計画を消費してバッチごとに LLM 呼び出し → 応答検証 → quote アンカリング確定 → Evidence 生成。進捗通知と partial_failure〔バッチ失敗 4 種 + 要素破棄〕の記録）・extraction のサービス層配線（リポジトリ 3 種〔`evidenceRepository`: Evidence バッチ追記 / `annotationRepository`: StudyData・ResultsData の upsert + 重複キー検出 + 値列の追加のみ拡張 / `runRepository`: ExtractionRuns 追記〕+ `aiAnnotationRows.ts`〔Evidence → ai annotator 行の転記素材〕+ `lib/llm/apiLogRepository.ts`〔LLMApiLog 行追記〕+ `app/services/extractionService.ts`〔runExtraction: planRun → withRetry(withLogging(provider)) で executeRun → ai 行転記 → ExtractionRuns 追記。extracted_texts の読込 loadDocumentPages は S3 実装が提供するまで注入〕。あわせて `lib/google/sheets.ts` に `appendRows` を追加し、`updateRow` / `getSheetValues` の範囲指定を全列対応へ一般化〔StudyData の動的値列が Z 列 = 26 列を超えうるため〕）・documents 機能コア（`lib/pdf/`〔pdfjs-dist 6.1.200 固定 + worker 同梱。anchor-spike の抽出ロジックを正式化〕+ `features/documents/`: extracted_texts 形式確定〔form feed 区切り。`extractedText.ts` が正典〕・`detectTextStatus`〔実質テキスト閾値 30 字/頁〕・`documentRepository`・`importDocuments`〔コピー → 抽出 → txt 保存 → Documents 追記。ファイル単位の失敗継続〕・`loadDocumentPages`〔extractionService へ注入する実装〕。Drive に `copyFile` / `getFileBinary` を追加）・S3 画面の UI 結線（`lib/google/picker.ts`〔MV3 の remote code 制約により hosted/picker.html + externally_connectable 方式。**Picker ページのデプロイと API キー設定は未実施** → hosted/README.md〕+ `AppState.documents` スライス + `app/services/documentsService.ts`〔一覧読込 / Picker 取り込み / study_label 保存〕+ documentsView 本実装〔読み込み中・失敗・空・進捗行 2 段階・text_status バッジ・インライン編集〕+ view の `render(state, ctx)` 化〔`views/types.ts` の ViewContext〕+ ルート別 E2E `app-documents.spec.ts`）まで実装済み。ドキュメント一式が正典：

| ドキュメント | 内容 |
|---|---|
| [docs/requirements.md](docs/requirements.md) | 要件定義書 v0.5。データ設計（Sheets 12 タブ、annotator 軸）・機能要件（S1〜S11）・quote アンカリング方式・未決定事項 Q1〜Q9（レビュー済み） |
| [docs/ui-flow.md](docs/ui-flow.md) | 画面遷移図モック（Popup / メインビュー hash ルーティング / ガード条件） |
| [docs/architecture.md](docs/architecture.md) | `src/` 構成案・ビルド・テスト方針（実装着手時に承認を取る起案） |
| [docs/ui-states.md](docs/ui-states.md) | UI 状態マトリクス（target spec。**スケルトン段階の実装状況は冒頭の drift 注記を参照**） |
| [docs/test-strategy.md](docs/test-strategy.md) | テスト戦略。jest 100% + Playwright の流用構成・E2E seam（worker 解決 / 状態注入）・PDF fixture 2 層運用・フェーズ計画・CI 段階導入 |

次のステップ: protocol（S4。sr-query-builder の protocol 画面 UI 移植）→ schema → … の画面実装（test-strategy.md §3。画面完成ごとにルート別 E2E + axe）と app シェルの Sheets 読込（進捗カウント）。あわせて hosted/picker.html のデプロイ（GitHub Pages + Picker API キー。hosted/README.md）と実機での Picker 動作確認を行う。テストは jest（カバレッジ 100% 強制）+ Playwright smoke + CI-1 が稼働済みのため、作業原則 7・8 は**有効**。

## 目的（ゴール）

MIT ライセンスの OSS Chrome 拡張 **sr-data-extraction-plugin**。SR ツール群 3 部作（sr-query-builder → tiab-review → 本拡張）の 3 作目で、SR の**データ抽出工程**を支援する：

1. Drive 上の著作権フリー採用論文 PDF + プロトコルから、AI が抽出スキーマをドラフト
2. AI が各論文から抽出し、各値に **verbatim quote（根拠箇所）** を付与
3. PDF.js ビューア上で根拠箇所をハイライト表示
4. 人間が accept / edit / reject / not_reported で最終判定（全判断の監査証跡）
5. CSV エクスポート（long / wide / audit の 3 形式）

サーバーレス（Sheets = DB、Drive = ファイル実体、BYOK の Gemini API）。詳細は requirements.md。

## 技術スタック

[tiab-review-plugin](tiab-review-plugin/) / [sr-query-builder-plugin](sr-query-builder-plugin/) に準拠：

- Chrome Extension Manifest V3（メインビューは `chrome.tabs.create` で開くフルページ `app.html` + Popup + Options）
- vanilla TypeScript（UI フレームワーク不使用）+ webpack
- Google OAuth 2.0（`chrome.identity`）+ Sheets / Drive API（スコープは `spreadsheets` + `drive.file` のみ）
- PDF 描画: `pdfjs-dist`（worker は拡張に同梱、CDN 不可）
- LLM: Gemini API（`LLMProvider` 抽象経由。OpenRouter は P1）
- テスト: jest（jsdom、カバレッジ 100% 強制）+ Playwright + axe
- Node.js ≥ 18

## 実装時に押さえる設計判断（requirements.md からの要点）

- **データ本体は 2 系統 + annotator 軸**: study レベルの Table 1 的内容は `StudyData`（wide）、arm 別のアウトカム・RoB は `ResultsData`（long）。全データ行に annotator / annotator_type（`ai` / `human_with_ai` / `human_independent` / `consensus`）を持ち、二重独立抽出（Q4）は annotator 行の複数化で表現。AI 根拠は `Evidence`、判定履歴は `Decisions`（追記型）
- **追記型・上書き禁止**: `StudyData` / `ResultsData` の annotator 行のみ上書き可。他タブは追記のみで、変更履歴は `Decisions` で監査
- **entity_level は 3 レベル**（study / arm / outcome_result）。`entity_key` の形式は requirements.md §3.3
- **quote アンカリング**（§5）が技術的中核: 正規化 → exact / normalized / fuzzy / failed の段階マッチ。`anchor_status` を計測対象にする
- **automation bias 対策**: human 行は空セル（未検証）から開始、accept にも 1 操作必須、未検証セル残存時のエクスポート警告
- **著作権**: 著作権フリー / 利用許諾済みの確認はユーザーの事前運用（チェック UI・記録列は持たない。取り込み画面に注意書きのみ）。PDF の外部送信は LLM API のみ
- 既定 LLM モデルは**抽出精度ベンチマーク**（`experiments/`、tiab-review の運用踏襲）で確定してから固定（Q8）

## サブモジュール

| パス | 役割 | 参照すべきドキュメント |
|---|---|---|
| [tiab-review-plugin/](tiab-review-plugin/) | 技術スタック・オフライン同期・判定 UI トンマナ・LLM ベンチマーク運用の参照実装 | [tiab-review-plugin/AGENTS.md](tiab-review-plugin/AGENTS.md) |
| [sr-query-builder-plugin/](sr-query-builder-plugin/) | メインビュー構成・プロトコル入力画面・Sheets/Drive データ設計・アルファ配布運用の参照実装 | [sr-query-builder-plugin/CLAUDE.md](sr-query-builder-plugin/CLAUDE.md) |

サブモジュール内で作業するときは、そのサブモジュールの CLAUDE.md / AGENTS.md を最優先する。OAuth / Sheets / Drive クライアント・オフラインキュー・LLM 抽象は既存 2 拡張からコピー流用する（npm 切り出しは 3 拡張が揃ってから判断。architecture.md §7-3）。

## 作業上の原則（tiab-review-plugin/AGENTS.md より継承）

1. **ブランチ強制**: `main` / `master` / `develop` で直接作業しない。変更前に作業ブランチを切る。
2. **日本語化**: ユーザー向けアーティファクト（計画書・要件書・コミットメッセージ・コード内コメント）は日本語で書く。思考プロセスだけ英語でよい。
3. **既存テスト保護**: 既存テストが落ちたら、まず実装のバグを疑う。テスト側を直す場合は「意図した仕様変更」であることをユーザーに確認する。
4. **ドキュメント同期**: 仕様や機能を変えたら、関連ドキュメント（README、docs/、コメント）も同時に更新する。特に ui-states.md は「実装より先に spec を書く」運用。
5. **機密情報**: API キー・OAuth トークン等はログ／アーティファクト／チャット応答に絶対出さない。トークンをログに出すときは `token.substring(0, 8) + '...'` で省略する。
6. **自動化の限界**: ツール実行が複数回失敗したら執拗に再試行せず、状況を報告する。
7. **テスト通過後の dev ビルド検証**: `npm test` が通ったら、完了報告前に必ず `npm run dev` で webpack の成功を確認する（実装フェーズ開始後）。
8. **UI 変更時は E2E も回す**: 画面・CSS・ルーティングに触れたら `npm run test:e2e` まで通す（実装フェーズ開始後）。
