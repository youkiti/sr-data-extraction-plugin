# 残実装計画書（v0.1.0 公開後の作業指示）

- **作成日**: 2026-07-03（タスク A〜E）/ **更新**: 2026-07-12（v0.1.0 公開後のマイルストーン M1〜M4 を追加）・2026-07-18（#62 実機検証の §7.3 決着 = フォルダ付与不成立 → ファイル単位付与への設計変更〔#138/#139 = PR #140〕と進捗を反映）・2026-07-19（#62 実機通し完了 = 検証 → 裁定 → consensus エクスポートまで全項目 OK。#62 クローズ・#63/#141 の残確認を更新。#142 Picker 許可導線の実機確認完了 → クローズを #68 行へ反映）
- **対象読者**: 本リポジトリで作業する実装者
- **構成**: **前半 = 現行の作業指示**（リリース後マイルストーン M1〜M4。GitHub issue の index）。**後半 = 付録**（MVP 完了までの計画タスク A〜E。全消化済み・履歴として保持）。
- **正典**: 仕様の根拠は必ず [requirements.md](requirements.md)（v0.12）/ [architecture.md](architecture.md) / [test-strategy.md](test-strategy.md) / [ui-states.md](ui-states.md) に当たること。本書は「何をどの順でやるか」の作業指示であり、仕様は複製しない（各 issue が自己完結の作業指示を持つ）。

## 0. 作業を始める前に（全タスク共通）

1. **ブランチを切る**。`master` で直接作業しない（作業原則 1）。ブランチ名は `feature/<タスク略称>`（例: `feature/ci-2-e2e`）。
2. コミットメッセージ・コード内コメント・ドキュメントは**日本語**（作業原則 2）。
3. jest は**カバレッジ 100% 強制**。実装を足したら同じ PR でテストも書かないと `npm test` が落ちる。
4. 完了報告前の定型フロー: `npm run typecheck` → `npm test` → `npm run test:e2e` → `npm run lint` → `npm run lint:css` → `npm run dev`（作業原則 7・8。CI は安全網であって代替ではない）。
5. UI に触るタスク（タスク C）は、**先に [ui-states.md](ui-states.md) の該当セクションを更新してから**実装する（作業原則 4「spec が先」）。
6. API キー・トークンをログ・チャット・コミットに出さない（作業原則 5）。

### タスク一覧と推奨順序

| 順 | タスク | 内容 | 依存 | 規模感 |
|---|---|---|---|---|
| A | ドキュメント整合の修正 | 古いステータス記述 3 箇所の更新 | なし | ✅ 完了（2026-07-03） |
| B | CI-2 | Playwright E2E を GitHub Actions へ追加 | なし | ✅ 完了（2026-07-03） |
| C | S11 Options 拡充 | 既定モデル設定の追加 | なし | ✅ 完了（2026-07-03） |
| D | 抽出精度ベンチマーク（Q8） | `experiments/` でモデル比較 → 既定モデル確定 | C があると楽 | ✅ 完了（2026-07-06。`gemini-3.5-flash` 確定） |
| E | リリース準備 | README 仕上げ・Store 提出物・Store 公開 | D の結果を反映 | ✅ 完了（2026-07-12。v0.1.0 一般公開） |

**タスク A〜E は全消化済み**（MVP 完了までの計画）。詳細は「付録」を参照。v0.1.0 公開後の現行の作業指示は次章「リリース後マイルストーン（M1〜M4）」。

---

## リリース後マイルストーン（M1〜M4・現行の作業指示）

- **位置づけ**: v0.1.0 一般公開（2026-07-12）後の残作業。以降は GitHub issue を作業単位とし、本章がその index。各 issue が自己完結の作業指示（背景・方針・受け入れ条件）を持つため、本書に仕様は複製しない。§0 の共通ルール（ブランチ・日本語・カバレッジ 100%・定型フロー・spec 先行）はそのまま適用する。
- **設計判断の経緯**: [status-and-roadmap-20260711.md](status-and-roadmap-20260711.md)（レビュー済み）。仕様の正典は [requirements.md](requirements.md)（v0.12）。

### M1 リリース品質（公開後の運用担保）

| issue | 内容 |
|---|---|
| [#62](https://github.com/youkiti/sr-data-extraction-plugin/issues/62) | 独立二重レビューの 2 アカウント実機通し確認（**✅ 完了・クローズ済み（2026-07-19）**。§7.3 はファイル単位付与〔#138/#139 = PR #140〕で決着し、検証〔with_ai / independent〕→ arm マッピング → 裁定 → consensus エクスポートの通しまで全項目問題なし。記録は [manual-testing.md](manual-testing.md) §5-6） |
| [#63](https://github.com/youkiti/sr-data-extraction-plugin/issues/63) | 独立二重レビュー v1 簡略化の解消（裁定ハイライト・offlineQueue・arm 並べ替え・3 人以上） |
| [#64](https://github.com/youkiti/sr-data-extraction-plugin/issues/64) | StudyData/ResultsData upsert の楽観ロック（複数人運用の後勝ち上書き防止） |
| [#69](https://github.com/youkiti/sr-data-extraction-plugin/issues/69) | ai 行転記 appendRows のチャンク制御（40k 行一発 append の非対称性。負荷試験で発見） |
| [#141](https://github.com/youkiti/sr-data-extraction-plugin/issues/141) | ファイル単位付与の残課題（**課題 1・2・4 は 2026-07-19 に実装済み**: 付与済み ID セット永続化 + 差分付与 + スキップ導線 = PR #150 / hosted ページ整理 + `page_version` ハンドシェイク + files モードの file_ids を ready 応答経由へ = PR #149・picker.html 2026-07-19a を gh-pages デプロイ済み。**残り** = 実機確認〔差分付与の収束・スキップ・件数上限観察〕とバンドルファイル方式の要否判断） |

### M2 方法論の質

| issue | 内容 |
|---|---|
| [#65](https://github.com/youkiti/sr-data-extraction-plugin/issues/65) | 決定論的な数値整合性チェック（非 LLM の第 3 独立検証） |
| [#66](https://github.com/youkiti/sr-data-extraction-plugin/issues/66) | レビュアー間一致度（Cohen's κ・一致率・不一致一覧） |
| [#67](https://github.com/youkiti/sr-data-extraction-plugin/issues/67) | Methods 文案カードの S10 実装（PRISMA 2020 item 9） |
| [#61](https://github.com/youkiti/sr-data-extraction-plugin/issues/61) | RoB2 / ROBINS-I の signaling question 対応 + QUADAS-2 / QUIPS（出力トークン制約で複数回コール検討） |

### M3 上流・下流接続

| issue | 内容 |
|---|---|
| [#60](https://github.com/youkiti/sr-data-extraction-plugin/issues/60) | R 解析向け CSV エクスポート契約（tab1 / ma / rob + data_dictionary。**v1 は analysis_role 抜き** = tab1 に全変数・R で join） |
| [#68](https://github.com/youkiti/sr-data-extraction-plugin/issues/68) | tiab-review 採用リスト読み込み → study 自動生成（study_label / DOI / PMID。旧 §4 提案6 を同時充足） |

### M4 差別化・国際化（着手時に issue を起こす）

| 項目 | 位置づけ |
|---|---|
| 登録情報との突き合わせ（selective reporting・RoB2 D5 支援） | 差別化の本命。規模大（status-and-roadmap §4 提案4） |
| UI 英語化・表示言語切替 | 海外テスター / 論文発表を見据える場合に優先度↑ |
| 日本語論文対応（プロンプト多言語化） | requirements §6 P2 |
| relocate-quote skill（アンカリング失敗 quote の LLM 再特定） | `LLMApiLog.purpose` に enum 予約済み |

### 実機 / 実 API テストが必要な項目（見落とし防止）

M1〜M4 のうち、**ローカルの jest / Playwright だけでは完了確認できない**もの。実装完了 ≠ 検証完了なので、各 issue の受け入れ条件とは別にここで一覧化する。

| 対象 | 種別 | 何を確認するか |
|---|---|---|
| #62 | **実機（実 Google アカウント 2 つ）** | **✅ 完了（2026-07-19）**: §7.3 の設計成立条件は「共有フォルダの Picker 選択では配下ファイルが読めない」= 不成立が確定（2026-07-18）→ ファイル単位付与（issue #139・PR #140。hosted picker `view=files` + `setFileIds` 全選択）へ設計変更して決着。招待 → Drive 自動共有 → シート許可 → ファイルアクセス付与 → `#/verify` 読出し（2026-07-18）に続き、検証（with_ai / independent）→ arm マッピング → 裁定 → consensus エクスポートの通しも全項目問題なし（2026-07-19。記録は [manual-testing.md](manual-testing.md) §5-6-1・§5-6-2） |
| #63 | 実機（2 アカウント） | 裁定フローの通し・arm 並べ替えマッピング（note `arm_mapping:{...}` の永続化 → 再入場復元）は **2026-07-19 の #62 通し（§5-6-2）で確認済み**。**残り**: 3 名以上のペア選択（§5-6-3。3 アカウント目が必要）と v1 簡略化解消の実装残（裁定ハイライト・offlineQueue 等） |
| #141 | 実機（多数文献プロジェクト） | 実装済み分（PR #150 差分付与・スキップ導線 / PR #149 file_ids の ready 応答経由 + ページハンドシェイク。2026-07-19）の実機確認: ①差分付与の収束（2 回に分けた選択 → 不足件数表示 → 残りだけ再提示）②スキップ導線（Drive 側で削除したファイルがあるプロジェクトでゲートが開き、検証画面で該当文書だけ個別エラー）③別端末での自己修復プローブ ④新ページ（picker.html 2026-07-19a デプロイ済み）での files モード付与 ⑤`setFileIds` の件数上限（数百 ID で Picker の一覧表示が欠けないか）。⑤の観察後にチャンク分割 / バンドルファイル方式の要否を判断 |
| #68 | 実機（実 tiab-review Sheet + 実データ） | tiab の Sheet 直読み・include 抽出・取り込み PDF との DOI / PMID 突き合わせ（URL 形式 DOI・OA 直リンク fulltext_url・`fulltext_ai_active_round` 実値・fulltext スクリーニング途中のシートを含める）。**Picker 許可導線（issue #142）は ✅ 実機確認済み（2026-07-19）**: 初回 403/404 → 「Google で許可する」→ Picker 付与 → プレビュー自動リトライ成功を実 tiab-review シートで確認し、#142 はクローズ済み（実装は PR #145）。残りは Sheet 直読み〜突き合わせの上記項目 |
| tiab-review 引き継ぎ（S1「tiab-review から引き継いで作成」+ S3 引き継ぎパネル。※Q2） | 実機（実 tiab-review Sheet + 実 Drive） | **✅ 完了（2026-07-19。実装 = PR #158）**: ①S1 の全シート選択 Picker（`view=spreadsheet`・`file_id` なし）での tiab シート選択 = drive.file 付与 → References / Decisions 直読み ②プロジェクト自動作成 → `#/documents` 直接遷移 → 引き継ぎパネル表示 ③include の `fulltext_url` 由来 ID での files モード Picker（全選択）→ 一括取り込み → 反映プレビュー自動表示 → 確定、の通しを実機確認し問題なし。据え置きの見た目課題（機能影響なし・必要になったら対応）: 全シート選択時も hosted picker のタイトルが「プロジェクトのスプレッドシートを選択」のまま（ページ側の文言分岐は未実装・要デプロイ） |
| #102 | 実 API（実 Drive・`drive.file` スコープ） | 重複取り込み判定が使う `md5Checksum` が実スコープで取得できるか（`files.list` / `files.get?fields=md5Checksum`。stub では担保不能）。同じ PDF を再選択 / 再ドロップ → 進捗行に「スキップ（理由）」が出ること |
| #69 | 実 API（実 Sheets・数万行） | 一括 append で 429 / リクエストサイズ超過が実際に出るか（ローカルはコード確認 + チャンク実装まで。**バグ発見自体は 2026-07-12 のローカル負荷試験で完了**、実 API 再現は未） |
| #61 | 実 API（実 LLM） | signaling question を全出力させたときに出力トークン制約へ当たるか → 1 study 複数回コール（キャッシュあり）の要否判断 |
| #80 | 実 API（実 Sheets・既存プロジェクト） | `ExtractionRuns` が旧 14 列ヘッダの既存プロジェクトで抽出を実行し、`ensureRunFieldIdsColumn` がヘッダを `field_ids` 込みの 15 列へ自動拡張すること（E2E はモックが最初からフルヘッダを返すため PUT 経路は unit テストのみ）。あわせてサブセット抽出 → S8 で「対象外 field は過去 run の値が残る」合成表示の目視確認。**✅ 実機確認済み（2026-07-13）** |
| #95 層 1 | 実機（拡張の実インストール） | 同梱 CMap（`dist/cmaps/`）が MV3 実機で `chrome-extension://` URL 経由でロードされること = 和文 PDF（fixture の J-STAGE 論文）の取り込みで `text_status = ok` になり、S8 でハイライトが出ること（jest は `getDocument` をモック、E2E の合成 PDF は CMap を要求しないため実機のみで確認可能） |
| #95 層 2 | 実 API（実 LLM） | 和文論文 1〜2 本での抽出 smoke（quote が原文（日本語）のまま返り、exact / normalized でアンカリングされること）+ 英語論文の非劣化確認（`experiments/extraction-benchmark-real` でプロンプト v6 → v7 の比較。issue #95 層 2 のベンチゲート = マージ前に統合担当がローカル実施し、結果を PR に記録する） |
| #106 | 実 API（v0.1.0 で作成した 15 列プロジェクト） | 抽出実行で `ExtractionRuns` ヘッダが `warnings` 込みの 16 列へ自動拡張され（`ensureRunOptionalColumns`。#80 と同じく E2E モックはフルヘッダを返すため 15→16 列の PUT 経路は unit テストのみ）、既存 run 行の読み出し（S8/S9 の合成表示・S6 履歴）が壊れないこと。v0.1.0 一般公開後の全実ユーザープロジェクトが次回 run でこの移行を踏む |
| draft-schema プロンプト版数 2（レビュータイプ適応） | 実 API（実 LLM） | scoping / DTA / 予後の実プロトコル + サンプル論文でドラフトを実行し、①scoping で arm / outcome_result 項目を出さないこと ②DTA で index test ごとの TP/FP/FN/TN・閾値項目が outcome_result（arm なし）で出ること ③予後で因子 × アウトカムの効果推定値 + CI が outcome_result で出ること ④介入比較プロトコルの提案品質が版数 1 から劣化していないこと（jest はプロンプト文言の固定のみで、実モデルの提案挙動は担保できない） |
| #128〜#131（OAuth スコープ移行） | 実機（実 Google アカウント 2 つ + 実 Drive 共有） | **✅ 完了・#128 クローズ済み（2026-07-19）**: v0.2.0 をストア公開（release-build スキル。zip 検証 + gh-pages picker.html 2026-07-19a 版確認込み）→ 新同意画面が `userinfo.email` + `drive.file` の 2 権限のみになることを実機確認 → **GCP 同意画面から `spreadsheets` を削除**し、削除後も認証・動作に問題なしを実機確認（100 人上限・未検証警告の対象外に到達）。判定基準の浸透待ち（目安 2 週間）と共同研究者確認は **v0.1.0 の既存ユーザー不在のため省略**と判断。Picker 誘導系（共有シート URL → 誘導 → Picker 付与 → 再接続、既存コラボレータ再入場）は #62 / #142 の実機通し（2026-07-18〜19、[manual-testing.md](manual-testing.md) §5-6）で確認済み。旧一覧 ①〜⑪ の個別消化記録は #128 本文とコメント参照 |
| #109（QUADAS-3 flow 図 mermaid の遅延チャンク） | 実機（拡張の実インストール）＝**リスクはほぼ解消・残りは形式確認** | **CSP リスクは検証済み（2026-07-20）**: 主要リスク = MV3 デフォルト CSP（`script-src 'self'; object-src 'self'` = eval / `new Function` 禁止）下で mermaid が描画できるか、だった。①静的解析: mermaid バンドル全体で eval 系は d3-dsv の `objectConverter`（CSV パース）1 箇所のみで、flowchart 描画経路では呼ばれない。②実弾検証: dist を **MV3 と同一の CSP ヘッダを注入した配信**で実 Chromium に載せ、mermaid の E2E 2 本（遅延チャンクロード → SVG 描画 / 構文エラーのフォールバック）が pass。同 CSP 下で実ページスクリプトの `new Function` が `EvalError` でブロックされること（= CSP が実効）も確認済み。**残り = 形式確認のみ**: 実際の `chrome-extension://` オリジン + 実インストールで、実データの `quadas3_flow_diagram` セルの「図をプレビュー」を開き SVG 描画 + DevTools Network で `chunks/mermaid.js` 取得を目視（webpack publicPath の `chrome-extension://` 解決は PR5 で `__webpack_require__.p` を静的確認済み）。#128 の release-build 実機確認とまとめて実施可能。**留意**: プレビューは flowchart 限定のため安全だが、mermaid は d3-dsv を使う図種（sankey / xychart 等）だと同 CSP 下で `new Function` が落ちる潜在制約あり（現行スコープ外） |

**ローカルで完了確認できる（実機不要）**: #64 楽観ロック（2 コンテキストは jest で再現）・#65 数値整合性・#66 κ・#67 Methods カード（unit + E2E、#67 は軽い smoke 程度）・#60 CSV 契約（golden fixture + R 読み戻し確認。R は手作業だが拡張の実機は不要）。

> なお MVP（S1〜S10）の実機通しは [manual-testing.md](manual-testing.md) にシナリオ化済み。上記のうち #62 / #63 は同ドキュメントに二重レビュー版シナリオとして追記するのが素直。

### 不採用（記録）

| 項目 | 理由 |
|---|---|
| RevMan 直結 | R + AI の後工程へ委譲（#60 の CSV 契約で代替） |
| カスタムモデル一覧管理 UI・任意ヘッダー・独自認証 | OpenAI 互換 + ローカル LLM（localhost）+ 直接入力で実需カバー（requirements v0.12・S11） |
| pdf_native の born-digital 画像入力トグル | 入力方式は自動判定で確定・比較は experiments に委譲（requirements Q3） |
| 検証所要時間のアプリ内計測 / 同項目横断ビュー / R 雛形生成 / プロジェクトバックアップ / PMC OA XML / 表画像認識 | status-and-roadmap §4 提案3・7・9・11 / §3.3 で不要判断（Drive 履歴・pdf_native 等で代替） |

---

## 付録: MVP 完了までの計画（タスク A〜E・全消化済み）

> 以下は v0.1.0 公開（2026-07-12）までの計画。タスク A〜E はすべて消化済み。履歴として保持する。

## タスク A: ドキュメント整合の修正

### 目的

実装が進んだのにドキュメント上のステータス記述が「実装未着手」のまま残っており、新規参加者が混乱する。3 箇所を実態に合わせる。

### 変更対象と修正内容

1. **[requirements.md](requirements.md) 冒頭（4 行目付近）** — `**ステータス**: 要件定義フェーズ（実装未着手）` を「S1〜S10 実装済み・実機通し確認完了（2026-07-03）。残タスクは docs/remaining-work-plan.md」の趣旨に更新。Q8 の注記（閾値はベンチマーク設計時に最終確定）は残す。
2. **[README.md](../README.md) 冒頭（5 行目付近）** — `> **開発ステータス**: スケルトン段階（要件定義完了・画面実装はこれから）` を「MVP 機能実装済み（S1〜S10）・リリース準備中」の趣旨に更新。
3. **[CLAUDE.md](../CLAUDE.md) の Picker 注記** — 「**GitHub Pages（gh-pages ブランチ）へデプロイ済みだが実機での Picker 動作確認は未実施**」という記述は、2026-07-03 の通し確認（§1 Picker OK）と矛盾する古い記述。実機確認済みに書き換える。[hosted/README.md](../hosted/README.md) にも同様の注記があれば同時に更新する。

### 完了条件

- [ ] 上記 3（+1）箇所が更新され、他に「実装未着手」「これから」系の古い記述が grep（`実装未着手|画面実装はこれから|動作確認は未実施`）で出てこない
- [ ] コード変更なしのため CI-1 が通ればよい

---

## タスク B: CI-2（Playwright E2E を CI へ追加）

### 目的

[test-strategy.md](test-strategy.md) §4 で「CI-2: フェーズ 2〜3（E2E spec が安定してから）」と決めた段階導入の後半。ルート別 E2E spec は全画面分（`tests/e2e/` の 11 本）揃い、実機確認も終わったので着手条件を満たしている。

### 背景知識

- E2E は `npm run test:e2e`（= `playwright test`）で動く。[playwright.config.ts](../playwright.config.ts) の `webServer` が **`npm run dev` で dist/ をビルドしてから** `tools/playwright-server.js` で `http://localhost:4400` に静的配信する。つまり CI 側で別途ビルド手順は不要。
- 実 PDF fixture（pilot / verify spec が使う）はリポジトリにコミットされておらず、[tests/fixtures/pdf/fetch-pdfs.ps1](../tests/fixtures/pdf/fetch-pdfs.ps1) で PMC からダウンロードする。ubuntu ランナーには pwsh が同梱されているので ps1 がそのまま動く（test-strategy.md §4 の想定どおり）。
- `.env` は不要（dev ビルドは `OAUTH_CLIENT_ID` 空で通る。CI-1 が現に `npm run dev` を .env なしで回している）。

### 実装手順

1. [.github/workflows/ci.yml](../.github/workflows/ci.yml) に `e2e` ジョブを追加する。既存 `check` ジョブとは独立に並列実行させる（`needs:` は付けない。lint 失敗と E2E 失敗は別々に見えたほうがデバッグしやすい）:

   ```yaml
   e2e:
     runs-on: ubuntu-latest
     steps:
       - uses: actions/checkout@v4
       - uses: actions/setup-node@v4
         with:
           node-version: 22
           cache: npm
       - name: 依存関係のインストール
         run: npm ci
       - name: Playwright ブラウザの取得
         run: npx playwright install --with-deps chromium
       - name: PDF fixture の取得
         run: pwsh -NoProfile -File tests/fixtures/pdf/fetch-pdfs.ps1
       - name: Playwright E2E
         run: npm run test:e2e
   ```

2. ファイル冒頭のコメント（「Playwright E2E は CI-2 で追加する」）を「CI-2 導入済み」に更新する。
3. PR を出して Actions 上で green になることを確認する。**flaky（再実行で通る失敗）が出たら握りつぶさず、spec 側の待ち条件を直すか報告する**（作業原則 3・6）。

### 落とし穴

- fetch-pdfs.ps1 は外部（PMC）へのダウンロードなので、まれに落ちる。落ちた場合は再実行でよいが、恒常的に落ちるなら URL 切れを疑い README（[tests/fixtures/pdf/README.md](../tests/fixtures/pdf/README.md)）の選定基準に従って対処を報告する。
- `--with-deps` を忘れると ubuntu で chromium の共有ライブラリ不足で落ちる。

### 完了条件

- [ ] push / PR で `check` と `e2e` の両ジョブが green
- [ ] [test-strategy.md](test-strategy.md) §4 の表に「CI-2 導入済み（日付）」を追記（ドキュメント同期・作業原則 4）

---

## タスク C: S11 Options 拡充 — 既定モデル設定

### 目的

requirements.md §4.1 の S11 は「API キー、モデル管理、表示言語」だが、現状の Options（[src/options/bootstrap.ts](../src/options/bootstrap.ts)）は **Gemini API キー保存のみ**。このタスクでは「既定モデルの設定」を追加する。

**スコープ外（P1。手を付けない）**: OpenRouter カスタムモデル管理（requirements.md §7 で P1 と明記）・表示言語切替（UI 英語化自体が P1 のため、切替 UI も P1 と同時）。

### 現状の仕様（読んでから始める）

- S5 スキーマ画面のモデル入力は**自由入力テキスト**（[schemaView.ts](../src/app/views/schemaView.ts) の placeholder `例: gemini-2.5-flash`）で、store の初期値は空文字（[store.ts](../src/app/store.ts) の `schema.model`）。
- S6 パイロット・S7 一括抽出は S5 で使ったモデルを引き継ぐ（extractService の「S6→S5 のモデル引き継ぎ」）。つまり**S5 の初期値に既定モデルを注入すれば下流全部に効く**。
- 単価表は [src/lib/llm/pricing.ts](../src/lib/llm/pricing.ts) の `MODEL_PRICING`（キーがモデル ID）。
- 秘密情報の保存パターンは [src/lib/storage/secretsStore.ts](../src/lib/storage/secretsStore.ts)（`chrome.storage.local` + trim + 空文字拒否）。モデル名は秘密情報ではないので **secretsStore には足さず、新規ファイルにする**。

### 実装手順

1. **spec 先行**: [ui-states.md](ui-states.md) §2（Options）に「既定モデル」の状態行を追記する（未設定 / 保存済み / 保存中 / 保存失敗。API キーと同じトンマナ）。
2. `src/lib/storage/settingsStore.ts` を新規作成:
   - 保存キー `settings.defaultModel`（`secrets.geminiApiKey` の命名に倣う）
   - `loadDefaultModel(): Promise<string | null>` / `saveDefaultModel(model: string): Promise<void>`（trim、空文字は `removeLocal` = 「未設定に戻す」扱いにする。API キーと違い空での解除を許す）
   - JSDoc コメントは日本語
3. **Options UI**（[options.html](../src/options/options.html) / [options.css](../src/options/options.css) / [bootstrap.ts](../src/options/bootstrap.ts)）:
   - 「既定モデル」テキスト入力 + `<datalist>`（候補 = `Object.keys(MODEL_PRICING)`）+ 保存ボタン
   - 起動時に保存値を input へ表示（API キーと違いマスク不要）
   - 保存時のステータス表示は既存の `options__status` を流用
   - 補足文: 「S5 スキーマ画面の初期値になります。単価表にないモデルはコスト概算が表示されません」
4. **S5 への注入**: schemaService（[src/app/services/schemaService.ts](../src/app/services/schemaService.ts)）のスキーマ素材読込時に、`schema.model` が空文字なら `loadDefaultModel()` の値で埋める。**ユーザーが画面で入力済みの値は上書きしない**（空のときだけ）。
5. **テスト**:
   - unit: settingsStore（保存 / trim / 空文字で解除 / 読み出し）、bootstrap（datalist 描画・保存フロー・失敗表示）、schemaService（空のときだけ注入されること）
   - カバレッジ 100% を維持
   - E2E: Options ページの spec は現状存在しないため新設は必須ではないが、`npm run test:e2e` 全体は必ず回す（作業原則 8）。余力があれば `options-smoke.spec.ts` を popup-smoke に倣って追加
6. **ドキュメント同期**: CLAUDE.md の「options〔API キー保存は実装済み〕」を更新。requirements.md の S11 行はそのまま（OpenRouter / 表示言語が P1 であることは §7 に記載済み）。

### 完了条件

- [ ] Options で既定モデルを保存 → S5 を新規に開くとモデル欄に反映される（実機で確認し、確認結果を報告に含める）
- [ ] 既定モデル未設定時の挙動が現状と同一（回帰なし）
- [ ] ui-states.md §2 と実装が一致
- [ ] 定型フロー（§0-4）全通過

---

## タスク D: 抽出精度ベンチマーク（Q8）→ 既定モデル確定

### 目的

requirements.md §8「既定 LLM モデルは抽出精度ベンチマークで確定してから固定する」（未決定事項 Q8）。現状 `experiments/` には anchor-spike しかなく、モデルベンチマークは未着手。これが**リリース（タスク E）前の最後の技術的ブロッカー**。

### 参照実装

tiab-review の `experiments/` 運用を踏襲する（tiab-review-plugin/AGENTS.md 参照。構成: `data/`（入力）+ `runner.ts`（tsx で実行）+ `results/`（JSON 出力）+ `logs/`）。原則:

- **採用基準を実行前に文書化する**（事前登録。結果を見てから基準を動かさない）
- **固定バージョンのモデル ID** を使う（`gemini-2.5-pro` のようなエイリアスではなく、日付付きスナップショットがあればそれ）
- API キーは `.env`（`experiments/` 直下、gitignore 済みであることを確認）

### 実装手順

1. `experiments/extraction-benchmark/` を新設し、`README.md` に**先に**以下を書いてユーザー承認を取る（ここがチェックポイント。承認前に API を叩かない）:
   - 比較対象モデル（候補: `MODEL_PRICING` にある Gemini 系。OpenRouter 系は P1 なので対象外でよい）
   - 評価指標（requirements.md §8 の案をそのまま採用: 項目レベル正確度 / not_reported 判定の感度・特異度 / quote アンカリング成功率）
   - 採用基準（例: 正確度最優先、同等ならコスト。「同等」の閾値もここで数値化する — Q8 で唯一残っている決め事）
   - データセット: 最小構成は fixture の実 RCT 2 本（[tests/fixtures/pdf/](../tests/fixtures/pdf/)。CC BY・アウトカム表あり・1 段組 + 2 段組）+ 手作業で作るゴールドスタンダード（各論文 × 代表スキーマ 15〜20 項目を人手で抽出した正解表 JSON）。本数を増やす場合は同 README の選定基準（PMC OA・CC BY）に従う
2. ランナーを実装する。**src/ の本番コードを最大限再利用する**こと（プロンプトの二重管理を避ける）:
   - プロンプト構築・応答パース: [src/features/extraction/skills/extractData.ts](../src/features/extraction/skills/extractData.ts)
   - 応答検証: `validateAiOutput`
   - アンカリング: anchoring 中核（anchor-spike が Node で pdfjs-dist を動かした実績があるので、その構成（tsx + @napi-rs/canvas 不要のテキスト層抽出）を流用する）
   - LLM 呼び出し: [src/lib/llm/](../src/lib/llm/) の `GeminiProvider` + `withRetry`
   - 実行は `npx tsx experiments/extraction-benchmark/runner.ts`（anchor-spike と同様に experiments 側に独立 package.json / tsconfig を置く）
3. `results/` に モデル × 論文 × 項目の生データ JSON と集計を保存し、`REPORT.md` に結果・採用モデル・判断根拠をまとめる（anchor-spike/REPORT.md のトンマナ）。
4. **確定の反映**（別コミット）:
   - [pricing.ts](../src/lib/llm/pricing.ts) の単価表を採用モデルの固定 ID で最新化
   - タスク C の既定モデルの「工場出荷値」（settingsStore 未設定時に schemaView placeholder へ出すモデル名）を採用モデルに更新
   - requirements.md の Q8 を「解決済み（日付・採用モデル・根拠は experiments/extraction-benchmark/REPORT.md）」に更新
   - CLAUDE.md の「既定 LLM モデルは…確定してから固定（Q8）」の注記を解決済みに更新

### 注意

- ベンチマークは実 API 課金が発生する。**実行前にコスト概算（モデル数 × 論文数 × トークン概算）を README に書き、ユーザー承認を得る**。
- ゴールドスタンダード作成（手作業）はユーザー（ドメインエキスパート）の作業になる可能性が高い。正解表の JSON スキーマだけ先に決めて依頼する形でよい。
- `experiments/` は jest のカバレッジ対象外（test-strategy.md §2「抽出精度はテストスイートの対象外」）。本体の `npm test` を巻き込まないこと。

### 完了条件

- [ ] README（事前登録）にユーザー承認が付いている
- [ ] REPORT.md に全モデルの指標と採用判断が記録されている
- [ ] 既定モデルが本体コード・ドキュメントに反映され、Q8 が解決済みになっている

---

## タスク E: リリース準備（Chrome ウェブストア公開）

> ✅ **完了（2026-07-12）**: Chrome ウェブストアで **v0.1.0 を一般公開**（[掲載ページ](https://chromewebstore.google.com/detail/sr-data-extraction-plugin/ibpbkgffgkmdmflamhadbcfjgfljjgip)）。当初は限定公開（unlisted）でのテスター配布を計画していたが（下記 2026-07-06 決定）、最終的に一般公開＝検索可能で掲載した。以下の本文は計画時の記録として残す。提出・審査の実施記録は [docs/store/README.md](store/README.md) の「提出前チェック」を参照。

### 目的

requirements.md §6（非機能要件）と §7（リリース計画 MVP 行）の「配る」部分。

**配布方式（2026-07-06 決定）**: zip の GitHub Releases 配布は行わず、アルファ配布から **Chrome Web Store の限定公開（unlisted）** を使う。参照実装 sr-query-builder は zip アルファ配布運用だが、この点は踏襲しない。理由:

- 拡張 ID が Store 版と一本化され、OAuth クライアント設定を 2 系統面倒見なくて済む
- テスターに「解凍 → デベロッパーモード → パッケージ化されていない拡張を読み込む」という開発者向け手順を踏ませない（デベロッパーモード拡張は起動時警告も出続ける）
- バグ修正が Store の自動更新で行き渡る（zip は再ダウンロード依頼が必要）

トレードオフは初回審査の待ち時間のみ。審査待ちの間にテストが必要な場合は、開発者向け手順（README の開発セットアップ節）どおり `dist/` を直接読み込めばよい。

### チェックリスト

1. **README 仕上げ**: データフロー図・funding 表記（KAKENHI 25K13585）・開発ステータス（タスク A）は済んでいる。残り: スクリーンショット（S3 / S8 / S9 あたり）、ユーザー向けセットアップ手順（開発者向けと分離。**Store のリンクからインストール → API キー設定 → OAuth 同意**の流れで書く。限定公開の間はリンクを知っている人だけがインストールできる旨を注記）。
2. **本番ビルド確認**: `npm run build` が通り、`dist/` を chrome://extensions で読み込んで S1→S10 が動くこと（manual-testing.md のシナリオを smoke として流用）。
3. **manifest 最終確認**: version・description（日本語）・permissions が requirements.md §2.1〜2.2 の説明（OAuth スコープは `userinfo.email` + `drive.file` のみ。2026-07-18 の issue #128〜#131 で `spreadsheets` を廃止）と一致すること。余計な permission が残っていたら報告。
4. **Chrome Web Store 提出物**（`docs/store/` を新設してまとめる）:
   - プライバシーポリシー（README のデータフロー節を独立ページ化。「外部サーバーなし・PDF の外部送信は LLM API のみ」）
   - permissions の使用理由説明文（審査フォーム用。日本語 + 英語。`host_permissions` の `openrouter.ai` / Gemini API も含める）
   - ストア用アイコン・スクリーンショット
5. **限定公開で提出 → テスター配布**: 審査通過後、限定公開リンクをテスターへ配布し、クリーンな Chrome プロファイルで通しが動くことを確認する。
   - ※ 公開（検索可能化）への切替の可否・タイミングはユーザー判断。このタスクは限定公開での配布確認まで。

### 完了条件

- [ ] Store 提出物一式が `docs/store/`（新設）にまとまっている
- [ ] Chrome Web Store に限定公開で掲載され、クリーンな Chrome プロファイルでインストール → プロジェクト作成 → 抽出 → エクスポートまで通る

---

## スコープ外（P1 以降。このマイルストーンでは着手しない）

> ⚠️ これは A〜E マイルストーン（〜v0.1.0）時点のスコープ外。多くは v0.11 / v0.12 で再分類済み（二重独立抽出・RoB テンプレートは実装済み、tiab 引き継ぎは #68、OpenRouter カスタムモデルはクローズ）。**現行の分類は上章「リリース後マイルストーン（M1〜M4）」を参照**。

| 項目 | 根拠 |
|---|---|
| relocate-quote skill（アンカリング失敗 quote の LLM 再特定） | [architecture.md](architecture.md) の src 構成案に「P1」と明記。`LLMApiLog.purpose` enum に `relocate_quote` が予約済みなので、着手時は enum 追加不要 |
| 二重独立抽出 + 不一致解決画面（Q4） | requirements.md §7 P1 |
| tiab-review プロジェクト引き継ぎ（Q2） | 同上 |
| OpenRouter カスタムモデル | 同上（providerFactory は現状 OpenRouter 指定で P1 エラーを投げる設計のまま維持） |
| RoB テンプレートスキーマ / UI 英語化・表示言語切替 | 同上 |

P1 に着手する際は本書を更新するのではなく、新しい計画書を起こすこと。
