# 技術スパイク結果報告: extract → anchor 実弾検証（v1.0）

- **実施日**: 2026-07-02
- **計画**: [PLAN.md](PLAN.md)（全ステップ完了）
- **判定: 🟢 Green — §5 の設計のまま実装フェーズへ進んでよい**
  - anchor 成功率 96.2%（failed 3.8% ≤ 10%）、モード別最良は text_only の 97.4%
  - MV3 CSP 下で PDF.js worker 同梱方式（`chrome.runtime.getURL`）が**フォールバックなしで動作**（チェックポイント 2 クリア）

## 1. 実施条件

| 項目 | 値 |
|---|---|
| モデル | `gemini-3.1-flash-lite`（temperature 0、`responseMimeType: application/json` + `responseSchema`） |
| pdfjs-dist | **6.1.200**（Node は legacy ビルド、ブラウザは `pdf.min.mjs`） |
| 対象 PDF | PMC10715657（PLoS One・シングルカラム・10p）/ PMC10766786（Front Med・2 段組・14p） |
| スキーマ | 手書き 15 項目（study 8 / arm 3 / outcome_result 4。表由来項目を意図的に含む） |
| run | 2 PDF × 2 モード（pdf_native / text_only）= 4 run、evidence 80 行（quote 付き 78 行） |
| アンカリング | §5 どおり: 正規化（NFKC・ハイフネーション結合・空白圧縮）→ exact（ai_page±1）→ normalized（全ページ）→ fuzzy（編集距離 ≤ quote 長 15%）→ failed |

再現手順: `npm install` → `npm run extract-text` → `npm run run-extract` → `npm run anchor` → `npm run report`（API キーはリポジトリルート `.env` の `GEMINI_API_KEY`）。MV3 ハーネスは `node_modules/pdfjs-dist/build/pdf{,.worker}.min.mjs` と fixture PDF（`udca.pdf` にリネーム）を `mv3-harness/` へコピー（gitignore 済み）→ `npx playwright install chromium` → `npx tsx src/mv3-check.ts`。

## 2. 仮説別の結果

### H1: verbatim quote は返るか → **おおむね返る（exact 88.5%）**

- 全 80 行で `field_id` 逸脱ゼロ・JSON 崩れゼロ・破棄ゼロ（responseSchema がそのまま効いた）
- not_reported の使い方も妥当（udca の effect estimate は実際に論文に未報告 → 両モードとも `not_reported: true`）
- 逸脱パターンは 2 つだけ:
  1. **`...`（省略記号）で非連続テキストを結合**した quote — failed 3 件の**全原因**
  2. pdf_native モードでの**空白の脱落**（`COVID-19units` / `90min` / `(n=72)` vs テキスト層の `(n = 72)`）— fuzzy 送りの主因

### H2: §5 の段階マッチングでアンカリングできるか → **できる（成功率 96.2%）**

| 区分 | n | exact | normalized | fuzzy | failed | verbatim 率 | anchor 成功率 |
|---|---|---|---|---|---|---|---|
| **全体** | 78 | 69 | 0 | 6 | 3 | 88.5% | **96.2%** |
| mode: pdf_native | 39 | 32 | 0 | 5 | 2 | 82.1% | 94.9% |
| mode: text_only | 39 | 37 | 0 | 1 | 1 | 94.9% | **97.4%** |
| pdf: udca（1 カラム） | 38 | 36 | 0 | 2 | 0 | 94.7% | 100.0% |
| pdf: thermocov（2 段組） | 40 | 33 | 0 | 4 | 3 | 82.5% | 92.5% |
| level: study | 32 | 29 | 0 | 2 | 1 | 90.6% | 96.9% |
| level: arm | 24 | 21 | 0 | 2 | 1 | 87.5% | 95.8% |
| level: outcome_result（**表由来**） | 22 | 19 | 0 | 2 | 1 | 86.4% | 95.5% |

所見:

- **normalized バケットは 0 件** — page ヒントが全件 ±1 以内で正確だったため、exact で吸収された。§5 の段階は維持しつつ、page ヒントの信頼性は高い前提でよい
- **fuzzy が正しく安全網として機能** — 空白脱落・表の読み順ズレ由来の 6 件をすべて正しいページで回収（距離比 0.012〜0.074、閾値 15% に大きな余裕）
- **表由来項目（outcome_result）も 95.5%** — §9 で懸念した「表内数値」はこの 2 本では問題にならなかった。表クォート（`Bilirubin at the discharge (mg/dl) SD ± mean 8.67±1.35`）は読み順の揺れで fuzzy になったが回収できている
- **failed 3 件はすべて `...` 結合クォート** — アンカリング側ではなくプロンプト側の問題。対策は §5 ではなくプロンプト改訂（下記 §5-1）
- **複数一致は 12/78 行**（abstract と本文の重複が主。`p = 0.54` は 3 箇所）— requirements §5-3 の「ai_page 近接採用 + 切替 UI」の必要性を実証
- **拡張正規化（ダッシュ・引用符折り畳み）は効果ゼロ** — この 2 本では §5 の正規化仕様で十分

### H3: pdf_native vs text_only（Q3 の材料） → **アンカリングは text_only が明確に優位**

| | pdf_native | text_only |
|---|---|---|
| verbatim 率 | 82.1% | **94.9%** |
| anchor 成功率 | 94.9% | **97.4%** |
| 2 段組論文の verbatim 率 | 70.0% | **95.0%** |
| 入力トークン（thermocov） | 9,367 | 21,399 |
| 応答時間 | 7.8〜10.4 秒 | 5.5〜5.8 秒 |

- 予想どおり **pdf_native は LLM 内部のテキスト認識と PDF.js テキスト層の空白処理が食い違う**（requirements §5 のリスク記載が実証された）。ただし fuzzy が拾うため成功率の差は 2.5pt に留まる
- **抽出値の正確度はどちらも完璧ではない**（スポットチェック）: thermocov の総ランダム化数で text_only が 105（解析対象数）と取り違え、pdf_native は 144 で正解。一方、同じ text_only run 内で arm 別 N は 72 で正解 — **同一 run 内でも矛盾する**。人間検証（S8）前提の設計が正しいことの傍証
- モード間の値完全一致は 30/40。不一致の大半は表現揺れ（`14/54 (25.9%)` vs `25.9% (14/54)`）で、実質的な矛盾は上記の総数 1 件
- **結論: Q3 の「両対応で実装し、パイロットで比較」は維持**。ただし既定候補は text_only に傾いた（アンカリング優位 + 高速 + スキャン PDF 以外では十分）。pdf_native はスキャン PDF（Q7）で必須なので実装は両方必要

### H4: PDF.js worker + MV3 CSP（チェックポイント 2） → **成功（フォールバックなし）**

最小 MV3 拡張（`mv3-harness/`）を Playwright Chromium（`--load-extension`）で自動検証:

- `GlobalWorkerOptions.workerSrc = chrome.runtime.getURL('pdf.worker.min.mjs')` で**実 worker が起動**（fake worker への警告フォールバックなし、console エラーなし）
- fixture PDF の canvas 描画 + `getTextContent()` 成功
- **ブラウザのテキスト層と Node（legacy ビルド）の出力が 3,471 文字完全一致** — Node で生成する fixture JSON / `tools/generate-pdf-fixture.ts` が本番の代理として妥当
- 注意: **branded Chrome 137+ は `--load-extension` を無効化**しており、Playwright 同梱 Chromium が必須（test-strategy の CI-2 設計にそのまま効く知見）

## 3. チェックポイント 2 の結論（architecture.md §7-2）

**pdfjs-dist 6.1.200 + worker 同梱（`copy-webpack-plugin` で `dist/` へ）+ `chrome.runtime.getURL` 解決で確定してよい。** test-strategy §2.1 の worker seam A 案（chrome スタブで URL 解決）の前提も成立（プロダクションコード無変更で E2E 可能）。resolver DI フォールバックは不要。

## 4. 判定と次のアクション

**🟢 Green（failed 3.8% ≤ 10%）— §5 の設計・データ構造（anchor_status 4 値）・S8 フォールバック UI の要件は変更不要。**

### 5-1. プロンプト v2 への改訂（`src/skills/extract-data.md` 昇格時に反映）

1. **省略記号の禁止を明文化**: 「`...` や `[...]` で複数箇所を結合しない。連続する 1 箇所のみ。支持箇所が分散する場合は最も重要な 1 箇所を引用する」— これだけで failed 3 件は全て潰せる見込み
2. pdf_native 用に「数値と単位・括弧の間の空白は原文どおり保つ」を追記（fuzzy 送り削減。ただし fuzzy が拾うため優先度は低い）

### 5-2. 実装フェーズへの反映事項

| 反映先 | 内容 |
|---|---|
| requirements.md §5 | 変更不要。「複数一致時の切替 UI」は実測 12/78 行で必要性確認済み。リスク欄の pdf_native 不一致も実証済みとして維持 |
| architecture.md §7-2 | 本レポート §3 の結論を記録（pdfjs-dist 6.1.200 / worker 同梱方式で承認） |
| architecture.md §4.3 / test-strategy §2.3 | table-driven テストに実弾ケースを追加: 表読み順クォート（`SD ± mean` 逆順）、pdf_native 空白脱落（`(n=72)`）、`...` 結合 → failed、abstract/本文の複数一致 |
| `src/features/anchoring/` | 本スパイクの `normalize.ts` / `anchor.ts` / `levenshtein.ts` を下書きとして移植。拡張正規化（ダッシュ折り畳み）は不要と判明したため §5 仕様のまま |
| `src/skills/extract-data.md` | `prompts/extract-data.md` を v2 改訂（§5-1）のうえ昇格 |
| Q8 ベンチマーク | 本スパイクの run 保存形式（`outputs/runs/*.json` + usageMetadata）と集計（`report.ts`)を雛形に。CESAR 基準の正確度測定は人間ゴールドスタンダード整備後 |
| tests/fixtures/pdf/*.json | `outputs/textlayer/*.json` の形式（charStart + transform/width/height/hasEOL）を `generate-pdf-fixture.ts` のスキーマ叩き台に |

### 5-3. 限界

- n = 2 論文 × 15 項目 × 2 モードのシグナル判定であり、統計的判断ではない（PLAN §5.2 のとおり）
- 2 本とも born-digital の OA PDF。古い組版・スキャン PDF・非英語は未検証
- 抽出値の正確度は目視スポットチェックのみ（厳密な測定は Q8 ベンチマーク本体の守備範囲）
- `gemini-3.1-flash-lite` 1 モデルのみ。既定モデル確定（Q8）には複数モデル比較が別途必要

## 付録: 生データの所在

| ファイル | 内容 |
|---|---|
| `outputs/textlayer/{udca,thermocov}.json` | ページ別テキスト + span 座標（fixture JSON の叩き台） |
| `outputs/runs/{pdfId}_{mode}.json` | LLM 生応答 + usageMetadata + parse 済み evidence |
| `outputs/runs/evidence-all.json` | 全 80 evidence 行 |
| `outputs/anchored/anchored-all.json` | anchor_status 付き全行（base / extended 両正規化） |
| `outputs/report-tables.md` | 集計表 + 非 exact 行の詳細 + モード間の値比較 |
| `outputs/mv3-harness-result.json` | MV3 ハーネスの検証結果 |
