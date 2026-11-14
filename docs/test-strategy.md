# テスト戦略（v0.1）

- **作成日**: 2026-07-02
- **対象**: 実装フェーズにおける単体テスト・E2E・CI の計画
- **位置づけ**: [architecture.md](architecture.md) §4（テスト方針）の詳細版。§4 のカバレッジ目標・モック戦略・anchoring 重点ケースはそのまま前提とし、本ファイルは「いつ・何を・どの seam で」を定める
- **参照実装**: sr-query-builder-plugin の [jest.config.ts](../sr-query-builder-plugin/jest.config.ts) / [playwright.config.ts](../sr-query-builder-plugin/playwright.config.ts) / [docs/ui-review-strategy.md](../sr-query-builder-plugin/docs/ui-review-strategy.md)（Tier 0〜3 モデル）

## 1. sr-query-builder からそのまま流用する構成

| 項目 | 内容 |
|---|---|
| unit | jest + ts-jest + jsdom。`src/` 配下の行・分岐カバレッジ **100% を `coverageThreshold` で強制**。エントリ（`popup.ts` / `app.ts` / `options.ts` / `service-worker.ts`）は coverage 除外し、実処理は `bootstrap.ts` 側でテスト。動画収録用デモビルド専用コード（`src/demo/**`）も同じ理由（収録専用・配布物である `dist/` には含まれない）で coverage 除外（`jest.config.ts` の `collectCoverageFrom`） |
| chrome API | `tests/setup/chrome-mock.ts`（コピー流用） |
| E2E | Playwright。`webServer` で dev ビルド → `tools/playwright-server.js` で `dist/` を静的配信（localhost:4400）。`page.addInitScript()` で chrome スタブ、`page.route()` で外部 API（Sheets / Drive / Gemini）を全 stub |
| a11y | `@axe-core/playwright` を各 E2E spec に組み込み（Tier 3） |
| CSS 規約 | stylelint + `[hidden] { display: none !important }` 規約（Tier 0）を最初から導入 |
| 状態 spec | [ui-states.md](ui-states.md)（Tier 1）は**要件定義フェーズで作成済み**。実装が spec に追いつく形で進め、乖離は drift 注記で管理 |
| npm スクリプト | `test` / `test:watch` / `test:coverage` / `test:e2e` / `test:e2e:ui`（sr-query-builder と同一） |

## 2. 本拡張特有の設計

### 操作ツアーの通し検証（手元・週次点検）

単体テストの定義・部品検査や通常の E2E で検査しない、デモ拡張上で操作ツアーが最後まで進むことを `tools/guide-tour-check/` で確認する。画面やツアーを変えたら手元で実行する。通常の CI とは別に週次点検でも headed Chromium を Xvfb 上で実行する。サンドボックス内では実行しない。実データ・実アカウント・実 API は使わない。

```sh
npm run build:demo
npm run check:tours
npm run check:tours -- --only getting-started --lang en --size 1280x800
```

既定は日本語・1280x800・全シナリオ。`PLAYWRIGHT_CHROMIUM_PATH` で Chromium を指定できる。対象は `dist-demo/`（`EXT_DIST_DIR` でデモビルドの場所を指定可能。通常の `dist/` にはフォールバックしない）。架空 PDF は同梱の `fixtures/demo-paper-01.pdf` を使う。ビルド前に PDF が無ければ、ブラウザを使える環境で [既存の生成手順](../video/fixtures/README.md#生成方法)に従って用意する。

空のデモ（`app/app.html?demoState=empty#/home`）で8手順と取り込み前の再読み込みによる再開を確認し、既定のデモでは最後の手順だけになることを確認する。空のデモも再読み込みするとデータは初期化される。シナリオごとに一時プロファイルを作成・削除する。ブラウザの終了が戻らない場合は 15 秒で待機を打ち切り、シナリオ名付きの警告を出して続行する（シナリオの成否は変えない）。

シナリオは次の 6 本。追加の 4 本は既定のデモからヘッダの「ツアー」→「始める」で開始し、全手順と完了後の「済み」を確認する。

| シナリオ | 確認内容 |
|---|---|
| `getting-started` | 空の状態から取り込み・保存・ドラフト・確定 |
| `getting-started-all-done` | 全部済みの状態で最後の手順だけ表示 |
| `pilot-and-extract` | パイロット・一括抽出をモックで実行し、完了による自動進行 |
| `verify-basics` | 根拠・判定・引用削除の遮断・進捗 |
| `dual-review` | レビュアー・担当セット分割の遮断・一致度・裁定 |
| `export-data` | 進捗・形式・未検証警告・生成の案内 |

`blockTarget` は共通の `expectTargetBlocked` で実ブラウザのマウス入力と、対象へのフォーカス後の Enter を送って確認する。各操作後に引用件数または担当セットの表示が変わらず、確認ダイアログも出ないことを監視する。共通の変化検出はブラウザ不要の単体テストでも確認する。これらの実ブラウザ検証はサンドボックス外で実行する。

手順ごとの画像は `.tmp/guide-tour-check/<シナリオ名>-<連番>-<手順 ID>.png`。カードの画面内配置・強調枠と対象の重なりを検査し、カードが対象を覆う場合は警告として集計する。失敗時は終了コード1と、シナリオ・手順・待ち条件・カード属性・URL・画像を出す。引数・シナリオ定義・結果集計はブラウザ不要の `npm run test:tools` でも確認する。

ヘルプの照合テスト（`tests/unit/lib/help/topics.test.ts`）は `hosted/help.html` を読み、
対応表のアンカーと `src/` 内の `.ts` / `.html` に直接書かれた `help.html#<id>` の実在、
全ルートと画面トピックの一対一対応、id の重複、見出しの日英 span、小見出しの節 id 接頭辞、
既存 15 節の id と順序を検査する。ソース走査はリンクが 0 件でも許容し、走査ファイル数が
1 以上であることを確認する。表示言語・アンカー付き URL の生成とトピック検索も検査する。

### 2.1 E2E seam（day 1 から入れる 2 点）

sr-query-builder では後付けになって手戻りしたため、スケルトン段階で仕込む：

1. **状態注入**: `app.ts` は `window.__E2E_PRELOADED_STATE__` があればストアのシードに使う（本番動作には影響しない）
2. **PDF.js worker の URL 解決**【決定済み 2026-07-02】: 本番は `chrome.runtime.getURL('pdf.worker.min.mjs')`。E2E では chrome スタブ側で `chrome.runtime.getURL = (p) => '/' + p` と定義して解決する（`dist/` を丸ごと静的配信しているため worker も同じ相対パスで届く）。**プロダクションコードは無変更**で seam をテスト側に閉じる。MV3 の module worker 事情でこの方式が通らない場合のみ、resolver DI（`loadPdf({ resolveAssetUrl })`）へフォールバック — その判断は architecture.md §7 チェックポイント 2 と同時に行う

AI へ送る前の同意（issue #381）: AI 機能を実行する E2E は、chrome スタブの `chrome.storage.local` に同意済みの記録（`aiDataConsent: { version: 3, acceptedAt }`）を入れて同意画面を出さない。同意画面そのものは `tests/e2e/app-ai-consent.spec.ts` が検証する。同意文の版（`AI_DATA_CONSENT_VERSION`）を上げたら、これらのスタブの `version` も合わせる。

サインインの前の同意: ログイン済みから始まる S1 と S1 へ戻る E2E の chrome スタブには、`signInDataConsent: { version: 1, acceptedAt: '2026-07-01T00:00:00.000Z' }` を入れる。未ログインの告知と、記録の無い既存利用者への小窓は `tests/e2e/popup-smoke.spec.ts` で検証する。

### 2.2 PDF fixture の 2 層構成

| 層 | 実体 | コミット | 用途 |
|---|---|---|---|
| 実 PDF | [tests/fixtures/pdf/](../tests/fixtures/pdf/README.md)（PMC OA・CC BY の RCT 2 本。シングルカラム + 2 段組） | **しない**（gitignore。`fetch-pdfs.ps1` で再取得） | E2E での canvas 描画・テキスト層・ハイライトの実弾検証 |
| テキスト層 JSON【方針転換により見送り。下記注記】 | ~~`tests/fixtures/pdf/*.json`（ページ別テキスト + span 座標。実 PDF から `tools/generate-pdf-fixture.ts` で生成）~~ | — | ~~anchoring / highlightMap の unit テスト~~ → インライン合成 fixture で代替 |

【方針転換 2026-07-02】第 2 層（テキスト層 JSON + `tools/generate-pdf-fixture.ts`）は**導入を見送り**、anchoring / highlightMap の unit テストは**テスト内のインライン合成 fixture を正**とする（実装済み: `anchorQuote.test.ts` の `pages()` ヘルパー / `highlightMap.test.ts` の `buildPage()`〔1 文字 = 10pt の等幅ジオメトリ〕）。理由：

1. `anchorQuote` の契約は「正規化済み文字列のマッチング」であり、fuzzy 15% 境界などの table-driven ケースは境界値を 1 文字単位で作り込む必要がある。実 PDF 由来の JSON ダンプでは「どこが境界か」が読めず、ケース追加のたびに都合のよい文を実 PDF から探すことになる
2. `highlightMap` は座標計算の検証のため、期待矩形を手計算できる等幅ジオメトリが必須。実 PDF の span 座標に対する期待値は実装出力のコピー（実質スナップショット）になり、バグを固定化するだけ

実 PDF のテキスト層の癖（span 分割のされ方 / 2 段組の読み順 / 実際に出るリガチャ）への回帰検証は、anchor-spike の実弾検証（[REPORT](../experiments/anchor-spike/REPORT.md)）とフェーズ 2〜3 の実 PDF E2E（第 1 層）が受け持つ。JSON 層は「実 PDF 由来の unit 回帰」が必要になった時点（extract-text の読み順バグ等が出た場合）で導入を再判断する。

- PDF canvas への `toHaveScreenshot()` はフォントレンダリング差で flaky になりやすいため、ハイライト検証は **overlay DOM の位置 assert を主**とし、screenshot 比較は限定的に使う
- **CCITT 合成 fixture**（`tests/e2e/pdf-ccitt.spec.ts` にインライン定義。Pillow の group4 TIFF から生成した 240×120pt・1 ページの CCITTFaxDecode 画像で、著作権上の懸念のない合成物）: wasm 資産（jbig2/openjpeg/qcms）の同梱漏れで画像デコーダが初期化に失敗すると該当ページが白紙になる回帰を、実 PDF fixture ではなくこのインライン合成 fixture で検出する。方針は §2.2 冒頭の「インライン合成 fixture を正とする」に整合させ、canvas の暗い画素率という広い閾値で判定する（screenshot 完全一致は使わない）

### 2.3 anchoring は fixture 先行の TDD

技術的中核（architecture.md §4.3）のため、ここだけはテストを実装より先に書く。§4.3 のケース一覧（ハイフネーション / リガチャ / NFKC / 2 段組読み順 / ページまたぎ / fuzzy 15% 境界 / 複数一致時の ai_page 近接選択）を table-driven テストとして先に固定し、それに向けて実装する。

【実績 2026-07-02】この TDD はインライン合成 fixture（§2.2 の方針転換注記）で実施済み。テストは緑・カバレッジ 100% を維持している。

### 2.4 LLM 抽出の守備範囲

- unit: `GeminiProvider` をモジュールモック。`validateAiOutput`（zod + 「値と quote の矛盾 → confidence=low 強制」）は AI 応答 fixture JSON で網羅
- E2E: `page.route()` で Gemini API を stub
- **抽出「精度」はテストスイートの対象外** — `experiments/` のベンチマーク（requirements.md §8 / Q8)に分離し、jest / Playwright は配管の正しさだけを見る

### 2.5 E2E の Sheets スタブは書き込みを次の GET に反映する【運用ルール。issue #252】

判定 UI（#/verify・#/pilot 埋め込み）を通す E2E spec の Sheets スタブは、StudyData /
ResultsData をヘッダ行固定で返してはいけない。実 Google Sheets は append / batchUpdate で
書き込んだ行がそのまま次の GET に返るが、ヘッダ固定スタブは「サーバ側に該当 annotator 行が
存在しない」ことになる。判定 1 件目の成功後、`foldDecisionWriteTokens`
（`src/app/services/verifyService.ts` / `pilotService.ts`）が書き込み時点の `updated_at` を
store へ畳み込み、判定 2 件目はそれを `expectedUpdatedAt` としてサーバへ渡すため、
`annotationRepository.ts` の `checkStudyRowConflict` / `upsertResultsDataRows` の期待値検証が
不一致と判定し、偽の `AnnotationConflictError`（競合バナー）が発生する（判定 1 件までしか
判定しない spec ではこの不忠実さは表面化しないため見落としやすい）。

- StudyData / ResultsData を扱う spec は [tests/e2e/helpers/sheetsStore.ts](../tests/e2e/helpers/sheetsStore.ts)
  の `createSheetsDataStore()` でメモリ上の状態を保持し、GET 応答は `studyValues()` /
  `resultsValues()` を、書き込みは `handleWrite(request)` を経由させる（`route.fulfill` 自体は
  各 spec 側で呼ぶ）
- 判定操作を伴う spec（app-verify / app-pilot / app-reviewer / app-independent）は、判定
  **2 件目**を追加し、競合バナー（`#verify-conflict-warning`）が出ないことを回帰ガードとして
  assert する。保存完了（Decisions 追記数の増加など）を待ってからバナー不在を確認すること —
  保存の非同期完了を待たずに `toHaveCount(0)` だけ見ると、実際は競合していても偽陰性になる
- 意図的に競合を発生させたい seam（`studyDataConflictAfterFirstRead` 等）は、この store より
  優先させてよい（app-verify.spec.ts 参照）

## 3. フェーズ計画

architecture.md §7 のチェックポイントと対応させる：

| フェーズ | タイミング | 内容 |
|---|---|---|
| 0 | スケルトン PR（チェックポイント 1） | jest + chrome-mock + カバレッジ 100% + eslint / stylelint / typecheck 一式。**Playwright も配管だけ通す**（app.html が開いて `#/home` が描画される smoke 1 本 = sr-query-builder の `app-smoke-of-smoke.spec.ts` 相当）。§2.1 の seam 2 点もここで入れる |
| 1 | 各機能実装と並走 | 実装と同 PR で unit テスト（100% 強制のため自動的に並走）。anchoring のみ fixture + テスト先行（§2.3） |
| 2 | 各画面完成ごと | ルート別 E2E spec（popup / documents / protocol / schema / pilot / extract / verify / dashboard / export）+ axe。ui-states.md の該当セクションと照合し、乖離は drift 注記へ |
| 3 | MVP 統合 | journey spec（取り込み → スキーマ → 抽出 → 検証 → CSV エクスポート貫通）+ エラー系 journey（API 失敗 / partial_failure / anchor failed） |

Playwright をフェーズ 0 で入れるのは、後付けにすると chrome スタブ / worker 解決 / 状態注入の seam 設計が実装から漏れて手戻りするため（sr-query-builder で実証済み）。

## 4. CI【決定済み 2026-07-02: 段階導入】

`tools/release/storeApi.mjs` は `src/` 外なので jest の対象外。`node:test`（`npm run test:tools`）で実ネットワーク・実ファイルを使わず検査し、CI の `check` ジョブでも実行する。

sr-query-builder（CI なし・ローカル規律運用）とは異なり、本拡張は GitHub Actions を段階導入する：

| 段階 | タイミング | ジョブ |
|---|---|---|
| CI-1 | スケルトン PR から | `typecheck` + `jest`（カバレッジ 100% 込み） + `lint` + `lint:css` + `dev` ビルド |
| CI-2 | フェーズ 2〜3（E2E spec が安定してから）→ **導入済み 2026-07-03** | Playwright E2E を `e2e` ジョブとして追加（`npx playwright install --with-deps chromium` + `npm run test:e2e`。`check` とは `needs:` なしの並列実行）。~~`fetch-pdfs.ps1` で PDF 取得~~【注記 2026-07-03: 当初想定と異なり、ルート別 E2E は spec 内で合成する minimal PDF を stub 配信しており実 PDF fixture（§2.2 第 1 層）を参照しないため、CI での fixture 取得は不要。実 PDF は anchor-spike（`experiments/`）等の実弾検証用途】 |

- 理由: カバレッジ 100% 強制と dev ビルド検証（作業原則 7）は CI がないと形骸化しやすい一方、E2E は画面が安定する前に CI に入れると flaky 対応コストが先行する
- CI 導入後もローカルの `typecheck → test → test:e2e → lint → dev` を完了報告前の定型フローとして維持する（CI は安全網であって代替ではない）

### 4.1 変わる値の転記検査

版は `package.json`、既定モデルは `src/lib/storage/settingsStore.ts`、プロンプト版数は
`src/features/extraction/skills/extractData.ts`、要件版は `docs/requirements.md` の見出しを正とする。
ストア公開版は掲載ページを確認して `docs/store/store-status.json` に手で記録する。
`npm run facts` で `docs/project-facts.md` を生成し、CI の `npm run facts:check` で鮮度を検査する。
`tests/unit/projectFacts.test.ts` は実物の値から生成物・ヘルプ・要件本文の転記と README の手書き版の再発を検査する。
リリース時は `--stamp-help` が自動実行され、現在値の再生成とヘルプの対象バージョン更新を行う。
ヘルプの最終更新と冒頭の `version:` はデプロイ時に日付を入れる。
`tests/unit/projectFacts.test.ts` は `__DEPLOY_DATE__` がちょうど 3 件あり、日英の最終更新と `version:` の直後にあることを検査する。

### 4.2 依存更新と週次点検

`.github/dependabot.yml` は npm と GitHub Actions を毎週月曜 09:00（日本時間）に点検する。
マイナー・パッチ更新は npm の本番依存・開発依存、Actions ごとにまとめ、メジャー更新は個別 PR にする。
各 ecosystem の同時 Open PR 上限は 10。更新 PR には通常の CI を適用し、移行が必要なら個別に対応する。

`.github/workflows/weekly-check.yml` は毎週月曜 07:17（日本時間）と `workflow_dispatch` で実行する。
Actions の `weekly-check` → `Run workflow` から手動実行し、次の独立した 3 ジョブを確認する。
実機不要（CI で完結）。ローカルの検証では実 API を呼ばず、fixture を使う。

| ジョブ | 確認する内容 | 失敗時の対処 |
|---|---|---|
| `models` | `npm ci` 後、`npm run check:models` で工場出荷の既定モデル、ヘルプ相談の固定モデル、単価表の ID を収集し、Gemini・Anthropic・OpenRouter のモデル一覧と完全一致で照合する。Gemini と Anthropic は全ページを辿る。Anthropic で一覧にない ID だけ、ID を `encodeURIComponent` で符号化して `GET /v1/models/{id}` で確認する。200 は別名 → 正式 ID をログに出して存在扱い、404 は欠落、それ以外の失敗は確認不能とする。推論リクエストは送らない | ログと Step summary のモデル ID・出典を確認する。一覧にない場合は公式の提供終了案内や別名の扱い、キーのアクセス権を確認してから、該当定数・単価表を修正する。提供終了とは即断しない。HTTP 401/403 は secret の権限・有効期限、429/5xx・通信失敗はサービス状況を確認し再実行する。応答形式・ページ送りの異常はスクリプトと fixture を更新する |
| `audit` | lockfile を使って `npm audit --omit=dev --audit-level=high`。本番依存の high / critical で失敗する | audit の依存経路を確認し、直接依存または親パッケージを安全な版へ更新して通常の CI を通す。レジストリへの接続失敗もジョブ失敗になるためログで区別する |
| `tours` | `npm ci`、Chromium と OS 依存の導入、`npm run video:fixtures`、`npm run build:demo` の後、`LANGUAGE=ja` の Xvfb 上で `npm run check:tours` を実行する | 準備段階の失敗なら依存・デモ生成を確認する。ツアーの失敗ならログのシナリオ・手順・待ち条件と `tour-screenshots` artifact（14 日保存）を確認し、対象セレクタ・ツアー定義・画面の動作を修正する |

モデル確認に使う repository secrets は `GEMINI_API_KEY`・`ANTHROPIC_API_KEY`・`OPENROUTER_API_KEY`。
各キーが未設定または空なら、その provider は「スキップ」と未確認件数をログと Step summary に残す。
全キー未設定でもモデル確認ジョブは成功するが、生存確認済みにはならない。手動実行時もスキップの有無を確認する。
キーがある provider のモデル欠落・一覧取得失敗・Anthropic の個別取得の確認不能は終了コード 1。確認不能を欠落とは数えない。他のモデル・provider の確認は続ける。
OpenRouter もキーがある場合だけ取得する。Azure や利用者の私設 API は組み込み ID の対象に含めない。
キーはヘッダーで送り、応答本文と通信例外の詳細は出力しない。

収集処理は TypeScript の構文木を読み、定数の書式が変わって読めなくなった場合は失敗させる。
`tools/weekly/checkModelIds.test.mjs` は `npm run test:tools` に含め、収集・照合・ページング・スキップ・エラー処理を fixture と注入した fetch で検証する。

## 5. 未決定・実装フェーズで判断する点

1. worker seam A 案（chrome スタブ解決）の実機確認 — チェックポイント 2 で PDF.js バージョンと同時に
2. ~~テキスト層 fixture JSON のスキーマ（`generate-pdf-fixture.ts` 実装時）~~【解決 2026-07-02: JSON 層自体を見送り（§2.2 の方針転換注記）。再導入を判断した時点でスキーマも決める】
3. visual regression（`toHaveScreenshot()`）の適用範囲 — verify 画面の overlay 以外に使うか
