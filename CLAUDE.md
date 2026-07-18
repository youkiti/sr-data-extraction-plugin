# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

> **注意**: 本ファイルは feature PR で編集しない（作業原則 9）。プロセスや正典ポインタの変更だけを、単独の PR で行う。

## 現在のフェーズ

**v0.1.0 を Chrome ウェブストアで一般公開済み**（2026-07-12。[掲載ページ](https://chromewebstore.google.com/detail/sr-data-extraction-plugin/ibpbkgffgkmdmflamhadbcfjgfljjgip)）。MVP（S1〜S10 + Options）に加え、P1 前倒し分（RoB テンプレート・独立二重レビュー + 裁定 S12・pdf_native・R セットエクスポート・数値整合性チェック・κ 一致度レポート・Methods 文案カード等）まで実装済み。

- **現行の作業指示**: [docs/remaining-work-plan.md](docs/remaining-work-plan.md) の「リリース後マイルストーン M1〜M4」。GitHub issue が作業単位で、各 issue が自己完結の指示（背景・方針・受け入れ条件）を持つ。
- **実装済み機能の履歴**: [docs/dev-log-mvp.md](docs/dev-log-mvp.md)（〜v0.1.0 の凍結アーカイブ）+ git log / マージ済み PR。
- **実機 / 実 API テストが必要な項目**: remaining-work-plan.md の同名一覧を参照（ローカルの jest / Playwright だけでは完了確認できないもの）。

ドキュメント一式が正典：

| ドキュメント | 内容 |
|---|---|
| [docs/requirements.md](docs/requirements.md) | 要件定義書 v0.12。データ設計（Sheets 15 タブ、study / document 分離、annotator 軸、ArmStructures、rob_domain）・機能要件（S1〜S12）・quote アンカリング方式・未決定事項の解決記録 |
| [docs/remaining-work-plan.md](docs/remaining-work-plan.md) | 現行の作業指示（M1〜M4 の issue index + 実機テスト要否一覧 + 不採用の記録） |
| [docs/architecture.md](docs/architecture.md) | `src/` 構成・ビルド・テスト方針 |
| [docs/ui-states.md](docs/ui-states.md) | UI 状態マトリクス（target spec。実装より先に spec を書く運用） |
| [docs/ui-flow.md](docs/ui-flow.md) | 画面遷移図（Popup / hash ルーティング / ガード条件） |
| [docs/test-strategy.md](docs/test-strategy.md) | テスト戦略。jest 100% + Playwright・E2E seam・PDF fixture 2 層運用・CI |
| [docs/manual-testing.md](docs/manual-testing.md) | 実機通し確認のシナリオと結果記録（Selenium 半自動ハーネス `tools/selenium/manualCheck.mjs`） |
| [docs/status-and-roadmap-20260711.md](docs/status-and-roadmap-20260711.md) | 現状整理とロードマップのスナップショット（レビュー済み。M1〜M4 の設計判断の経緯） |

## 目的（ゴール）

MIT ライセンスの OSS Chrome 拡張 **sr-data-extraction-plugin**。SR ツール群 3 部作（sr-query-builder → tiab-review → 本拡張）の 3 作目で、SR の**データ抽出工程**を支援する：

1. Drive 上の採用論文 PDF + プロトコルから、AI が抽出スキーマをドラフト
2. AI が各論文から抽出し、各値に **verbatim quote（根拠箇所）** を付与
3. PDF.js ビューア上で根拠箇所をハイライト表示
4. 人間が accept / edit / reject / not_reported で最終判定（全判断の監査証跡）
5. CSV エクスポート（long / wide / audit の 3 形式 + R セット）

サーバーレス（Sheets = DB、Drive = ファイル実体、BYOK の LLM API）。詳細は requirements.md。

## 技術スタック

[tiab-review-plugin](tiab-review-plugin/) / [sr-query-builder-plugin](sr-query-builder-plugin/) に準拠：

- Chrome Extension Manifest V3（メインビューは `chrome.tabs.create` で開くフルページ `app.html` + S1 プロジェクト選択ページ `popup.html`〔`default_popup` は持たず、アイコンクリックは service worker の `action.onClicked` が新規タブを開く: プロジェクト選択済み → `app.html` / 未選択 → `popup.html`〕+ Options）
- vanilla TypeScript（UI フレームワーク不使用）+ webpack
- Google OAuth 2.0（`chrome.identity.launchWebAuthFlow` + Web アプリケーション型クライアント。認証は service worker の認証ブローカー `src/background/authBroker.ts` に集約）+ Sheets / Drive API（スコープは `userinfo.email` + `drive.file` のみ。`spreadsheets` はセンシティブスコープの 100 人上限回避のため 2026-07-18 に廃止 — issue #128〜#132、requirements.md §2.1。他人作成の共有シートは初回のみ Picker 許可が必要）
- PDF 描画: `pdfjs-dist`（worker は拡張に同梱、CDN 不可）
- LLM: Gemini API + OpenRouter + 利用者指定の OpenAI 互換 Chat Completions API（`LLMProvider` 抽象経由。ローカル LLM = localhost エンドポイントも可。カスタムモデル一覧管理 UI は不採用 — remaining-work-plan.md「不採用（記録）」参照）
- テスト: jest（jsdom、カバレッジ 100% 強制）+ Playwright + axe
- Node.js ≥ 18

## 実装時に押さえる設計判断（requirements.md からの要点）

- **データ本体は 2 系統 + annotator 軸**: study レベルの Table 1 的内容は `StudyData`（wide）、arm 別のアウトカム・RoB は `ResultsData`（long）。全データ行に annotator / annotator_type（`ai` / `human_with_ai` / `human_independent` / `consensus`）を持ち、二重独立抽出（Q4）は annotator 行の複数化で表現。AI 根拠は `Evidence`、判定履歴は `Decisions`（追記型）
- **追記型・上書き禁止**: `StudyData` / `ResultsData` の annotator 行のみ上書き可。他タブは追記のみで、変更履歴は `Decisions` で監査
- **entity_level は 4 レベル**（study / arm / outcome_result / rob_domain）。`entity_key` の形式は requirements.md §3.3
- **quote アンカリング**（§5）が技術的中核: 正規化 → exact / normalized / fuzzy / failed の段階マッチ。`anchor_status` を計測対象にする
- **automation bias 対策**: human 行は空セル（未検証）から開始、accept にも 1 操作必須、未検証セル残存時のエクスポート警告
- **著作権**: 学術研究目的のデータ抽出（TDM）は著作権法上の権利制限規定（30 条の 4 等）により適法との整理（確認 UI・記録列・注意書きは持たない）。取り込み画面の注意書きは PDF の外部送信先（LLM API のみ）の説明だけを表示
- 既定 LLM モデル（Q8）: **工場出荷の既定は `gemini-3.5-flash`**（`src/lib/storage/settingsStore.ts` の `FACTORY_DEFAULT_MODEL`。Options 未設定時に S5 初期値へ注入 → S6/S7 へ伝播）。実データ抽出ベンチマーク（`experiments/extraction-benchmark-real/`、不眠 SR 実 gold・非公開）で最良の項目正確度だったため採用（初回 2026-07-06 REPORT.md: 成功 run 72%）。extract-data プロンプトはセクション並び替え（#89・版数 5）で暗黙 prefix キャッシュ ≈79% ヒットを実測、arm completeness 追記（#97・版数 6）で flash 72.3% / flash-lite 68.4%（v5 で悪化した lite の arm omission を解消。2026-07-13 REPORT-20260713-prompt-v5-ab.md / REPORT-20260713-prompt-v6-lite-fix.md）。事前登録ベンチ（`experiments/extraction-benchmark/`）は別建てで凍結保持

## サブモジュール

| パス | 役割 | 参照すべきドキュメント |
|---|---|---|
| [tiab-review-plugin/](tiab-review-plugin/) | 技術スタック・オフライン同期・判定 UI トンマナ・LLM ベンチマーク運用の参照実装 | [tiab-review-plugin/AGENTS.md](tiab-review-plugin/AGENTS.md) |
| [sr-query-builder-plugin/](sr-query-builder-plugin/) | メインビュー構成・プロトコル入力画面・Sheets/Drive データ設計の参照実装（アルファ配布は zip 運用だが本拡張は踏襲せず Chrome ウェブストア公開を採用。2026-07-12 に v0.1.0 を一般公開） | [sr-query-builder-plugin/CLAUDE.md](sr-query-builder-plugin/CLAUDE.md) |

サブモジュール内で作業するときは、そのサブモジュールの CLAUDE.md / AGENTS.md を最優先する。OAuth / Sheets / Drive クライアント・オフラインキュー・LLM 抽象は既存 2 拡張からコピー流用する（npm 切り出しは 3 拡張が揃ってから判断。architecture.md §7-3）。

## 作業上の原則（tiab-review-plugin/AGENTS.md より継承 + 並列開発の運用）

1. **ブランチ強制**: `main` / `master` / `develop` で直接作業しない。変更前に `origin/master` から作業ブランチを切る。
2. **日本語化**: ユーザー向けアーティファクト（計画書・要件書・コミットメッセージ・コード内コメント）は日本語で書く。思考プロセスだけ英語でよい。
3. **既存テスト保護**: 既存テストが落ちたら、まず実装のバグを疑う。テスト側を直す場合は「意図した仕様変更」であることをユーザーに確認する。
4. **ドキュメント同期**: 仕様や機能を変えたら、関連ドキュメント（README、docs/、コメント）も同時に更新する。特に ui-states.md は「実装より先に spec を書く」運用。
5. **機密情報**: API キー・OAuth トークン等はログ／アーティファクト／チャット応答に絶対出さない。トークンをログに出すときは `token.substring(0, 8) + '...'` で省略する。
6. **自動化の限界**: ツール実行が複数回失敗したら執拗に再試行せず、状況を報告する。
7. **テスト通過後の dev ビルド検証**: `npm test` が通ったら、完了報告前に必ず `npm run dev` で webpack の成功を確認する。
8. **UI 変更時は E2E も回す**: 画面・CSS・ルーティングに触れたら `npm run test:e2e` まで通す。
9. **CLAUDE.md は feature PR で編集しない**: 本ファイルは全並列 PR が衝突する競合源だったため、機能実装の記録先にしない。実装の記録は該当 issue / PR / git log と、関連 docs（requirements / ui-states 等）の更新で行う。本ファイル自体の変更（プロセス・正典ポインタ）は単独 PR で行う。
10. **実機 / 実 API テストの要否を PR 本文に明記**: 「実機不要（jest / E2E で完結）」か「実機確認が必要（何を・なぜ）」かを必ず書く。実機不要の PR は統合担当（ローカル環境の Claude）が CI green + code-review 後にマージする。実機が必要な確認は remaining-work-plan.md の一覧に集約し、まとめて実施する。
11. **共有ホットスポットの申告**: `src/app/store.ts` / `src/app/bootstrap.ts` / `src/app/app.css` / `src/app/views/types.ts` は全機能が触る競合源。これらに触る PR は変更を最小に保ち、PR 本文で該当ファイルを申告する（並列 PR の衝突解消は統合担当が行う）。
