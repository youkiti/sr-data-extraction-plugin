# テスト戦略（v0.1）

- **作成日**: 2026-07-02
- **対象**: 実装フェーズにおける単体テスト・E2E・CI の計画
- **位置づけ**: [architecture.md](architecture.md) §4（テスト方針）の詳細版。§4 のカバレッジ目標・モック戦略・anchoring 重点ケースはそのまま前提とし、本ファイルは「いつ・何を・どの seam で」を定める
- **参照実装**: sr-query-builder-plugin の [jest.config.ts](../sr-query-builder-plugin/jest.config.ts) / [playwright.config.ts](../sr-query-builder-plugin/playwright.config.ts) / [docs/ui-review-strategy.md](../sr-query-builder-plugin/docs/ui-review-strategy.md)（Tier 0〜3 モデル）

## 1. sr-query-builder からそのまま流用する構成

| 項目 | 内容 |
|---|---|
| unit | jest + ts-jest + jsdom。`src/` 配下の行・分岐カバレッジ **100% を `coverageThreshold` で強制**。エントリ（`popup.ts` / `app.ts` / `options.ts` / `service-worker.ts`）は coverage 除外し、実処理は `bootstrap.ts` 側でテスト |
| chrome API | `tests/setup/chrome-mock.ts`（コピー流用） |
| E2E | Playwright。`webServer` で dev ビルド → `tools/playwright-server.js` で `dist/` を静的配信（localhost:4400）。`page.addInitScript()` で chrome スタブ、`page.route()` で外部 API（Sheets / Drive / Gemini）を全 stub |
| a11y | `@axe-core/playwright` を各 E2E spec に組み込み（Tier 3） |
| CSS 規約 | stylelint + `[hidden] { display: none !important }` 規約（Tier 0）を最初から導入 |
| 状態 spec | [ui-states.md](ui-states.md)（Tier 1）は**要件定義フェーズで作成済み**。実装が spec に追いつく形で進め、乖離は drift 注記で管理 |
| npm スクリプト | `test` / `test:watch` / `test:coverage` / `test:e2e` / `test:e2e:ui`（sr-query-builder と同一） |

## 2. 本拡張特有の設計

### 2.1 E2E seam（day 1 から入れる 2 点）

sr-query-builder では後付けになって手戻りしたため、スケルトン段階で仕込む：

1. **状態注入**: `app.ts` は `window.__E2E_PRELOADED_STATE__` があればストアのシードに使う（本番動作には影響しない）
2. **PDF.js worker の URL 解決**【決定済み 2026-07-02】: 本番は `chrome.runtime.getURL('pdf.worker.min.mjs')`。E2E では chrome スタブ側で `chrome.runtime.getURL = (p) => '/' + p` と定義して解決する（`dist/` を丸ごと静的配信しているため worker も同じ相対パスで届く）。**プロダクションコードは無変更**で seam をテスト側に閉じる。MV3 の module worker 事情でこの方式が通らない場合のみ、resolver DI（`loadPdf({ resolveAssetUrl })`）へフォールバック — その判断は architecture.md §7 チェックポイント 2 と同時に行う

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

### 2.3 anchoring は fixture 先行の TDD

技術的中核（architecture.md §4.3）のため、ここだけはテストを実装より先に書く。§4.3 のケース一覧（ハイフネーション / リガチャ / NFKC / 2 段組読み順 / ページまたぎ / fuzzy 15% 境界 / 複数一致時の ai_page 近接選択）を table-driven テストとして先に固定し、それに向けて実装する。

【実績 2026-07-02】この TDD はインライン合成 fixture（§2.2 の方針転換注記）で実施済み。テストは緑・カバレッジ 100% を維持している。

### 2.4 LLM 抽出の守備範囲

- unit: `GeminiProvider` をモジュールモック。`validateAiOutput`（zod + 「値と quote の矛盾 → confidence=low 強制」）は AI 応答 fixture JSON で網羅
- E2E: `page.route()` で Gemini API を stub
- **抽出「精度」はテストスイートの対象外** — `experiments/` のベンチマーク（requirements.md §8 / Q8)に分離し、jest / Playwright は配管の正しさだけを見る

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

sr-query-builder（CI なし・ローカル規律運用）とは異なり、本拡張は GitHub Actions を段階導入する：

| 段階 | タイミング | ジョブ |
|---|---|---|
| CI-1 | スケルトン PR から | `typecheck` + `jest`（カバレッジ 100% 込み） + `lint` + `lint:css` + `dev` ビルド |
| CI-2 | フェーズ 2〜3（E2E spec が安定してから） | Playwright E2E を追加（`npx playwright install chromium` + `fetch-pdfs.ps1` で PDF 取得。ubuntu ランナーは pwsh 同梱のため ps1 がそのまま動く） |

- 理由: カバレッジ 100% 強制と dev ビルド検証（作業原則 7）は CI がないと形骸化しやすい一方、E2E は画面が安定する前に CI に入れると flaky 対応コストが先行する
- CI 導入後もローカルの `typecheck → test → test:e2e → lint → dev` を完了報告前の定型フローとして維持する（CI は安全網であって代替ではない）

## 5. 未決定・実装フェーズで判断する点

1. worker seam A 案（chrome スタブ解決）の実機確認 — チェックポイント 2 で PDF.js バージョンと同時に
2. ~~テキスト層 fixture JSON のスキーマ（`generate-pdf-fixture.ts` 実装時）~~【解決 2026-07-02: JSON 層自体を見送り（§2.2 の方針転換注記）。再導入を判断した時点でスキーマも決める】
3. visual regression（`toHaveScreenshot()`）の適用範囲 — verify 画面の overlay 以外に使うか
