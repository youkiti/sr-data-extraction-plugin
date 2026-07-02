# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## 現在のフェーズ

**要件定義完了・実装未着手**（2026-07 時点）。`src/` はまだ存在しない。ドキュメント一式が正典：

| ドキュメント | 内容 |
|---|---|
| [docs/requirements.md](docs/requirements.md) | 要件定義書 v0.5。データ設計（Sheets 12 タブ、annotator 軸）・機能要件（S1〜S11）・quote アンカリング方式・未決定事項 Q1〜Q9（レビュー済み） |
| [docs/ui-flow.md](docs/ui-flow.md) | 画面遷移図モック（Popup / メインビュー hash ルーティング / ガード条件） |
| [docs/architecture.md](docs/architecture.md) | `src/` 構成案・ビルド・テスト方針（実装着手時に承認を取る起案） |
| [docs/ui-states.md](docs/ui-states.md) | UI 状態マトリクス（**全編 target spec**。実装開始後は drift 注記で管理） |
| [docs/test-strategy.md](docs/test-strategy.md) | テスト戦略。jest 100% + Playwright の流用構成・E2E seam（worker 解決 / 状態注入）・PDF fixture 2 層運用・フェーズ計画・CI 段階導入 |

次のステップ: docs/architecture.md §7 のチェックポイント 1（スケルトン PR での方針承認）→ プロジェクト scaffolding（package.json / webpack / jest / manifest）→ 画面実装。

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
