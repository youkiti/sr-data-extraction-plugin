# ディレクトリ構造案 / アーキテクチャ概要（v0.1）

- **作成日**: 2026-07-02
- **対象**: sr-data-extraction-plugin の `src/` 配下構成、ビルド構成、テスト方針
- **位置づけ**: 実装着手時に承認を取る起案。UI フレームワークは sr-query-builder / tiab-review と同じく **vanilla TypeScript** で確定
- **参照**: sr-query-builder-plugin の [docs/architecture.md](../sr-query-builder-plugin/docs/architecture.md) と同構成

## 1. ルート構成

```
sr-data-extraction-plugin/
├── .github/workflows/ci.yml       # CI-1（typecheck + lint + jest + dev ビルド。test-strategy.md §4）
├── docs/
│   ├── requirements.md
│   ├── ui-flow.md
│   ├── architecture.md            # 本ファイル
│   ├── ui-states.md
│   └── test-strategy.md
├── src/                           # 全ソース（HTML / CSS / TS が同居。webpack がコピー）
├── tests/
│   ├── setup/                     # jest 共通セットアップ（chrome モック等）
│   ├── fixtures/                  # テスト用 PDF fixture（test-strategy.md §2.2）
│   ├── unit/                      # 単体テスト（src/ 構成をミラー）
│   └── e2e/                       # Playwright（ルート別 spec + axe）
├── hosted/                        # GitHub Pages でホストする Drive Picker ページ（picker.html + README.md）
├── tools/                         # 開発補助スクリプト（playwright-server.js 等）
├── experiments/                   # 抽出精度ベンチマーク（requirements.md §8。tiab-review の運用を踏襲）
├── sr-query-builder-plugin/       # サブモジュール（要件・UI 構成の参照実装）
├── tiab-review-plugin/            # サブモジュール（技術スタック・オフライン同期の参照実装）
├── .env.example                   # OAUTH_CLIENT_ID のテンプレ
├── .eslintrc.cjs
├── .gitignore
├── .prettierrc
├── .stylelintrc.cjs
├── jest.config.ts
├── package.json
├── playwright.config.ts
├── tsconfig.json
├── webpack.config.js
├── LICENSE                        # MIT
├── README.md                      # データフロー図 + KAKENHI 25K13585 funding 表記
├── THIRD_PARTY_NOTICES.md
└── CLAUDE.md
```

## 2. `src/` 配下

sr-query-builder と同じ方針：**UI ライブラリは使わず素の TypeScript + DOM API**。画面ごとのフォルダに HTML・CSS・TS を同居させ、`copy-webpack-plugin` で `dist/` へ転写する。

```
src/
├── manifest.json                  # MV3 manifest。webpack ビルド時に OAUTH_CLIENT_ID 置換
├── _locales/
│   ├── ja/messages.json           # 既定
│   └── en/messages.json           # P1
├── icons/
│
├── popup/                         # S1: プロジェクト選択・新規作成
│   ├── popup.html / popup.ts / popup.css
│   └── bootstrap.ts
│
├── app/                           # メインビュー（chrome.tabs.create で開くフルページ）
│   ├── app.html / app.ts / app.css
│   ├── bootstrap.ts               # DI 配線（views × services × navigate）
│   ├── router.ts                  # #/home 〜 #/export のルート定義
│   ├── store.ts                   # in-memory ストア（currentProject のみ chrome.storage.local へ永続化）
│   ├── guards.ts                  # 前提条件ガード（ui-flow.md §4）
│   ├── services/                  # 画面とドメインロジックの仲介
│   │   ├── documentsService.ts
│   │   ├── protocolService.ts
│   │   ├── schemaService.ts
│   │   ├── extractionService.ts   # pilot / full / single_document の実行管理
│   │   ├── verifyService.ts       # 判定保存 + undo 履歴
│   │   └── exportService.ts
│   ├── views/                     # 各ルートの描画関数（render(state, ctx): HTMLElement。ctx は views/types.ts の ViewContext）
│   │   ├── homeView.ts
│   │   ├── documentsView.ts
│   │   ├── protocolView.ts        # sr-query-builder から移植
│   │   ├── schemaView.ts          # 表形式スキーマエディタ
│   │   ├── pilotView.ts
│   │   ├── extractView.ts
│   │   ├── verifyView.ts          # 2 ペイン検証（中核）
│   │   ├── dashboardView.ts
│   │   └── exportView.ts
│   └── ui/                        # DOM ヘルパ
│       ├── dom.ts / toast.ts / modal.ts
│       ├── statusChip.ts          # 判定チップ（tiab-review トンマナ）
│       └── pdfViewer.ts           # PDF.js canvas + テキスト層 + ハイライトオーバーレイの UI コンポーネント
│
├── options/                       # S11: BYOK 設定（Gemini API キー等）
│   ├── options.html / options.ts / options.css
│   └── bootstrap.ts
│
├── background/
│   └── service-worker.ts
│
├── features/                      # ドメイン機能（UI に依存しない純粋ロジック）
│   ├── project/
│   │   ├── createProject.ts       # スプレッドシート 13 タブ + Drive フォルダ 4 種の生成
│   │   ├── selectProject.ts
│   │   └── projectStore.ts
│   ├── documents/
│   │   ├── importDocuments.ts     # Picker 選択 → documents/ へコピー（Q9）→ テキスト抽出 → Documents 追記
│   │   ├── extractTextLayer.ts    # PDF バイト列 → テキスト層 + text_status + extracted_texts 本文
│   │   ├── extractedText.ts       # extracted_texts/{id}.txt の形式（form feed 区切り）の serialize / parse
│   │   ├── detectTextStatus.ts    # ok / partial / no_text_layer 判定（全ページ反復の定型行=複写スタンプ等を除外して数える）
│   │   ├── loadDocumentPages.ts   # text_ref → ページ別テキスト復元（extractionService へ注入）
│   │   └── documentRepository.ts
│   ├── protocol/                  # sr-query-builder から移植（parseManual / parseMarkdown / parseDocx /
│   │                              #   protocolRepository〔ProtocolBlocks 関連は除外〕）+ saveProtocol
│   │                              #   （raw_protocols/ 退避 → 新 version 追記。LLM 抽出なし）
│   ├── schema/
│   │   ├── skills/draftSchema.ts  # draft-schema skill（プロンプト構築 + 応答スキーマ + パース）
│   │   ├── schemaRepository.ts    # SchemaVersions / SchemaFields I/O（追記のみ）
│   │   ├── saveSchemaVersion.ts   # 「版として確定」パイプライン（検証 → 採番 → 追記）
│   │   ├── validateField.ts       # field_name の snake_case・重複・enum 許容値等のバリデーション
│   │   ├── types.ts               # SchemaEditorRow（エディタ行）
│   │   └── presets/outcomeTemplates.ts  # 二値 / 連続アウトカムのメタ解析入力テンプレート（§3.3）
│   ├── extraction/
│   │   ├── skills/extractData.ts  # extract-data skill（構造化 JSON 強制）
│   │   ├── skills/relocateQuote.ts# P1: アンカリング失敗 quote の再特定
│   │   ├── planRun.ts             # document × スキーマのバッチ分割 + トークン / コスト概算
│   │   ├── executeRun.ts          # 実行・進捗・partial_failure 処理
│   │   ├── validateAiOutput.ts    # zod 検証 + 「値と quote の矛盾 → confidence=low 強制」
│   │   ├── aiAnnotationRows.ts    # Evidence → ai annotator 行の転記素材（純粋関数。§4.3）
│   │   ├── evidenceRepository.ts  # Evidence タブ I/O（追記のみ）
│   │   ├── annotationRepository.ts# StudyData / ResultsData の annotator 行 I/O（upsert + 重複キー検出 + 値列の追加）
│   │   └── runRepository.ts       # ExtractionRuns タブ I/O（実行完了時に確定 status で 1 行追記）
│   ├── anchoring/                 # 技術的中核（requirements.md §5）
│   │   ├── normalizeText.ts       # 空白圧縮 / ハイフネーション結合 / リガチャ / NFKC
│   │   ├── anchorQuote.ts         # exact → normalized → fuzzy の段階的マッチング
│   │   ├── fuzzyMatch.ts          # スライディングウィンドウ + 編集距離（quote 長の 15% 閾値）
│   │   └── highlightMap.ts        # マッチ文字範囲 → テキスト層 span 座標への写像
│   ├── verification/
│   │   ├── decide.ts              # accept / edit / reject / not_reported → annotator 行更新 + Decisions 追記
│   │   └── undoHistory.ts
│   └── export/
│       ├── buildStudyWideCsv.ts   # StudyData の確定 annotator 行（Q6）
│       ├── buildResultsLongCsv.ts # ResultsData の long（arm / outcome / RoB）
│       ├── buildAuditCsv.ts       # Evidence + Decisions の結合
│       └── csvEncode.ts           # UTF-8 BOM 付き
│
├── lib/                           # 外部 API / 低レベルユーティリティ
│   ├── google/
│   │   ├── auth.ts / sheets.ts / drive.ts / identity.ts   # 既存 2 拡張から流用
│   │   └── picker.ts              # Drive Picker（drive.file スコープ）。MV3 は apis.google.com を
│   │                              #   拡張ページで読めないため、ホスト済みページ（hosted/picker.html を
│   │                              #   GitHub Pages へデプロイ）+ externally_connectable メッセージングで実装
│   │                              #   【決定 2026-07-02。トークンは URL に載せず ready 応答で受け渡す】
│   ├── pdf/
│   │   ├── loadPdf.ts             # pdfjs-dist 初期化（worker は同梱、CSP 準拠。バージョンは 6.1.200 固定）
│   │   └── textLayer.ts           # ページ別テキスト + span 座標の取得（anchor-spike の抽出ロジックを正式化）
│   ├── docx/
│   │   └── extractDocxText.ts     # mammoth.extractRawText のラッパ（features/protocol の DocxExtractor 実装）
│   ├── llm/
│   │   ├── LLMProvider.ts         # interface（テキスト入力 + PDF 直接入力の両対応 ※Q3）
│   │   ├── GeminiProvider.ts      # MVP 実装
│   │   ├── OpenRouterProvider.ts  # OpenAI 互換 API（sr-query-builder から移植）
│   │   ├── providerFactory.ts
│   │   ├── apiLogger.ts           # LLMApiLog + Drive 保存（プロンプト版数も記録）
│   │   └── apiLogRepository.ts    # LLMApiLog タブへの行追記（apiLogger の appendLogEntry 実装）
│   └── storage/
│       ├── chromeStorage.ts / secretsStore.ts
│       └── offlineQueue.ts        # tiab-review の実装を共通化して流用
│
├── domain/                        # 型定義・スキーマ（純粋型、runtime 依存ゼロ）
│   ├── project.ts / document.ts / protocol.ts
│   ├── schemaField.ts / schemaVersion.ts
│   ├── annotation.ts              # annotator / annotator_type と StudyData・ResultsData 行の型
│   ├── evidence.ts / decision.ts / extractionRun.ts
│   ├── anchor.ts                  # anchor_status / マッチ結果型
│   ├── exportLog.ts / llmApiLog.ts
│   └── sheetsSchema.ts            # 13 タブ（Meta / Protocol / Documents / SchemaVersions / SchemaFields / ExtractionRuns / StudyData / ResultsData / ArmStructures / Evidence / Decisions / LLMApiLog / ExportLog）の列定義。StudyData の値列はスキーマから動的生成
│
├── styles/
│   ├── tokens.css                 # tiab-review トンマナのカラートークン + ハイライト色
│   └── globals.css
│
└── utils/
    ├── uuid.ts / iso8601.ts / sanitizeSecret.ts
    └── entityKey.ts               # entity_key（arm:1 / outcome:x|arm:1|time:30d）の生成・パース
```

### 2.1 レイヤ依存ルール

```
entries (popup / app / options / background)
            ↓
views / ui
            ↓
features
            ↓
lib / domain
            ↓
utils
```

- 上位は下位を import 可、逆は不可。ESLint の `import/no-restricted-paths` で機械的に強制
- `domain/` は純粋型のみ。runtime バリデーションは `features/*` 側で zod
- LLM プロンプトは `features/*/skills/*.ts` の TS 定数として持ち（sr-query-builder の実装方式に合わせる。当初案の `skills/*.md` asset 読み込みは webpack / jest への loader 追加コストに見合わないため不採用）、明示版数（例: `EXTRACT_DATA_PROMPT_VERSION`）を `LLMApiLog` に記録する

### 2.2 UI 実装方針

- UI ライブラリは使わない（既存 2 拡張と揃える）
- 各 view は「`render(state, ctx): HTMLElement` を返す純粋関数」（`ctx` は `views/types.ts` の `ViewContext`。サービス呼び出し等の副作用はここ経由）、状態は `app/store.ts` の中央ストアで単方向フロー
- **例外**: `ui/pdfViewer.ts` は PDF.js の canvas 描画・スクロール位置などリッチな内部状態を持つため、再レンダで破棄されない**長寿命コンポーネント**として実装する（store の再描画から分離。sr-query-builder の `draftRun` / `expandRun` と同じ思想）

### 2.3 quote アンカリングのデータフロー

```
extract-data skill ──ai_quote/ai_page──▶ anchorQuote()
extracted_texts/{id}.txt（ページ別）──▶   ├─ exact（ai_page ± 1）
                                          ├─ normalized（全ページ）
                                          ├─ fuzzy（編集距離 15%）
                                          └─ failed → verifyView のフォールバック検索 UI
anchorQuote() ──文字範囲──▶ highlightMap() ──span 座標──▶ pdfViewer オーバーレイ描画
```

- アンカリングは**取り込み済みテキスト層（extracted_texts）に対して実行**し、結果（`anchor_status` + 文字オフセット）を `Evidence` 保存時に確定する。ビューア表示時は座標写像のみ行う（再計算しない）

## 3. ビルド構成

### 3.1 webpack エントリ

| エントリ | 出力 |
|---|---|
| `src/background/service-worker.ts` | `dist/background/service-worker.js` |
| `src/popup/popup.ts` | `dist/popup/popup.js` |
| `src/app/app.ts` | `dist/app/app.js` |
| `src/options/options.ts` | `dist/options/options.js` |

- `pdfjs-dist` の **worker（`pdf.worker.min.mjs`）は `copy-webpack-plugin` で `dist/` へ同梱**（CDN 参照不可、MV3 CSP 準拠）。`GlobalWorkerOptions.workerSrc` は `chrome.runtime.getURL()` で解決
- `.env` 運用（`OAUTH_CLIENT_ID` / `LOCAL_OAUTH_CLIENT_ID`）、dev ビルドの拡張名 `(dev)` 付与、固定 `key` による拡張 ID 固定は sr-query-builder の `webpack.config.js` / `release-alpha.ps1` を踏襲

### 3.2 npm スクリプト

sr-query-builder と同一（`dev` / `watch` / `build` / `release:alpha` / `lint` / `lint:css` / `typecheck` / `test` / `test:e2e`）。

## 4. テスト方針

実装フェーズの詳細計画（フェーズ分け・E2E seam・PDF fixture 運用・CI）は [test-strategy.md](test-strategy.md) を参照。本節はその前提となる方針を定める。

### 4.1 カバレッジ目標

sr-query-builder と同じく **`src/` 配下の TS に対して行・分岐カバレッジ 100 %** を `coverageThreshold` で強制。エントリは起動フックのみに薄くし、実処理を `bootstrap*.ts` に分離する。

### 4.2 モック戦略

| 対象 | モック方法 |
|---|---|
| `chrome.*` API | `tests/setup/chrome-mock.ts`（sr-query-builder から流用） |
| Google Sheets / Drive / Picker | `lib/google/*` をモジュールモック。`fetch` スタブ + fixture |
| Gemini API | `lib/llm/GeminiProvider.ts` をモジュールモック |
| PDF.js | `lib/pdf/*` をモジュールモック。anchoring / highlightMap のテストは**テスト内のインライン合成 fixture**（合成文字列 + 等幅ジオメトリ）で完結させ、canvas 描画は E2E でだけ実弾を使う【方針転換 2026-07-02: 当初計画の事前生成 JSON fixture は見送り → test-strategy.md §2.2 注記】 |

### 4.3 アンカリングの重点テスト

`features/anchoring/` は本拡張の技術的中核のため、以下を fixture ベースで網羅する：

- 行末ハイフネーション（`exam-\nple`）、リガチャ（`ﬁ`）、全角/半角、NFKC の各正規化
- 2 段組み PDF の読み順ずれ、表セル由来 quote、ページまたぎ quote
- fuzzy 閾値（15%）境界、複数一致時の ai_page 近接選択

## 5. コーディング規約

sr-query-builder と同一（TypeScript strict + `noUncheckedIndexedAccess`、日本語コメント / コミット、named export のみ、`any` 禁止、シークレットは `sanitizeSecret` 経由）。

## 6. 依存ライブラリ（MVP 想定）

| 用途 | ライブラリ | ライセンス |
|---|---|---|
| PDF 描画・テキスト層 | pdfjs-dist | Apache-2.0 |
| docx パース | mammoth | BSD-2-Clause |
| ランタイムバリデータ | zod | MIT |
| ID 生成 | uuid | MIT |
| 編集距離 | 自前実装（準大域アライメント DP。anchor-spike で実用性を検証済み → `features/anchoring/fuzzyMatch.ts`） | — |
| ビルド | webpack / ts-loader / copy-webpack-plugin / dotenv | MIT |
| テスト | jest / ts-jest / jest-environment-jsdom / @playwright/test / @axe-core/playwright | MIT / Apache-2.0 |

## 7. 実装フェーズで承認を取るチェックポイント

1. **本ファイル全体の方針承認**（最初のスケルトン PR で）
2. **PDF.js のバージョンと worker 同梱方式**【解決済み 2026-07-02】: pdfjs-dist 6.1.200 + `chrome.runtime.getURL` での worker 同梱が MV3 CSP 下でフォールバックなしで動作（[anchor-spike REPORT](../experiments/anchor-spike/REPORT.md)）
3. **共通ライブラリ化の範囲**: `lib/google/` / `lib/storage/offlineQueue.ts` / `lib/llm/` を既存 2 拡張からコピーするか npm パッケージへ切り出すか（requirements.md 付記。暫定: MVP はコピー流用、3 拡張が揃った時点で切り出し判断）
4. **fuzzy マッチの実装**【解決済み 2026-07-02】: 自前 DP（準大域アライメント）を採用。スパイクで 2 論文 × 2 モードの実弾に対し実用十分（§6 の表参照）
5. **100 % カバレッジ到達が難しいファイル**: 都度 exclude 申請
