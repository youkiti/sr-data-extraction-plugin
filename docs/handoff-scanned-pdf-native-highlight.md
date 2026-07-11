# ハンドオフ: スキャン PDF の `pdf_native` 抽出 / 座標ハイライト検討

> ステータス: **PoC 完了（🟢 Green → 難条件の追試で「条件付き維持」）・実装ハンドオフ付き**。2026-07-11 作成 / 同日更新。
> §0–§5 は当初の意思決定分析（選択肢 A/B/C）。**§6 で選択肢 B（bbox 座標ハイライト）の PoC を実施し Green、難条件の追試（§6.2 末尾・スパイク REPORT §10）で「box はフォールバック併用前提・回転は実験的機能」の条件付き維持**。
> **§7 が本題のジュニア SE 向け実装ハンドオフ**（PR 分割・変更ファイル・型・受け入れ基準）。
> 着手前に §7.0 の決定ゲート（Q7 改訂の合意ほか）を必ず通すこと。

## 0. きっかけ・関連

- **きっかけ**: スキャン論文 PDF が誤って `text_status: ok` に判定される不具合の修正（PR #46 `fix/text-status-boilerplate-stamp`）の際、「テキスト層のないスキャン PDF は、そもそも PDF を API に送って座標でハイライトする仕組みではなかったか？」という問いが出た。
- **結論（先出し）**: 現行の設計・実装に「**API が返す座標でハイライト**」する仕組みは無い。ハイライトは PDF.js が抽出した**テキスト層の span 座標**に quote をアンカリングして描いており、テキスト層のないスキャン PDF は原理的にハイライトできない（Q7 で確定済み）。`pdf_native` は「**抽出**を PDF 直送で行う」モードで、ハイライトとは別軸。しかも `pdf_native` はまだ実装されていない（`text_only` 固定・P1）。
- **関連**: requirements.md **Q7**（スキャン PDF / OCR 対応）、**Q3**（入力方式 `pdf_native` / `text_only` の確定）、§5（quote アンカリング）。

---

## 1. 現状（事実確認）

### 1.1 設計（requirements.md）

- **Q7 確定**（[requirements.md](requirements.md) L540）: 「画像のみ PDF も `pdf_native` モード（PDF を直接 LLM へ送信）で抽出対象にする。**テキスト層がないためアンカリング / ハイライトは不可**（§5 参照）」
- **non-goal**（[requirements.md](requirements.md) L69）: 「テキスト層の再建（**OCR 処理そのもの**）」は対象外。
- **input_mode**（[requirements.md](requirements.md) L235 / `ExtractionRuns`）: `pdf_native`（PDF を直接 LLM へ）/ `text_only`。**Q3 でパイロット比較して確定する**方針だった（born-digital で LLM 内部認識と PDF.js テキスト層が食い違うリスクの計測。L481）。

### 1.2 実装の現状（= 設計との差分）

| 事実 | 根拠 |
|---|---|
| `InputMode` 型は存在する（`'pdf_native' \| 'text_only'`） | [src/domain/extractionRun.ts](../src/domain/extractionRun.ts) L7 |
| だが実行時は **`text_only` にハードコード** | [src/app/services/extractionService.ts](../src/app/services/extractionService.ts) L180 `inputMode: 'text_only' as const` |
| `pdf_native` は skill 側で**未対応（TODO）** | [src/features/extraction/skills/extractData.ts](../src/features/extraction/skills/extractData.ts) L49「pdf_native モードは lib/llm 移植時に別途対応」 |
| planRun は **`text_only` のトークン計算のみ**、かつ `no_text_layer` 文書を連結から除外 | [src/features/extraction/planRun.ts](../src/features/extraction/planRun.ts) L7 ほか |
| UI は「pdf_native モード時のみ選択可・**P1**」と表示（= 未実装明示） | [src/app/views/extractView.ts](../src/app/views/extractView.ts) L81 / [pilotView.ts](../src/app/views/pilotView.ts) L69 |

**帰結**: 今のスキャン PDF（`no_text_layer`）は、**抽出もされず（除外）ハイライトも不可**。検証画面では「テキスト層なし」バナー + スキャン画像のみが出る（= PR #46 修正後の正しい挙動）。

### 1.3 ハイライトの仕組み（現行パイプライン）

```
LLM quote(文字列)
  └─ anchorQuote()  … extracted_texts のページ別テキストに段階マッチ（exact/normalized/fuzzy/failed）
        └─ highlightMap()  … マッチ文字範囲 → テキスト層 item の span 座標（PDF ユーザー空間の矩形）
              └─ toDisplayRect()  … ページ回転を適用して表示座標へ
                    └─ pdfViewer オーバーレイ … CSS で矩形を scale して描画（クリックでフォーム連動）
```

- 中核型: `Evidence.quote / page / anchorStatus`（[src/domain/evidence.ts](../src/domain/evidence.ts)）、`AnchorStatus = exact|normalized|fuzzy|failed`（[src/domain/anchor.ts](../src/domain/anchor.ts)）。
- 表示素材: `EvidenceHighlight` → `HighlightOccurrence { page, rects: HighlightRect[] }`（[src/features/verification/highlights.ts](../src/features/verification/highlights.ts)）。
- 描画: [src/app/ui/pdfViewer.ts](../src/app/ui/pdfViewer.ts) `renderOverlay` / `rectStyle`。**任意の矩形（PDF ユーザー空間）を回転・拡縮込みで描ける**ため、描画層は座標源を差し替えても再利用できる。
- バナー / 検索の出し分け: [src/app/views/verificationPanel.ts](../src/app/views/verificationPanel.ts) — no_text_layer バナー L641 前後、テキストなし注記 L477、`canSearchText` は L311 / L1040（実装は `textStatus` ではなく `extractedPages` の空文字判定）。※行番号は issue #38 のレイアウトモード変更でズレやすい。シンボル名で追うこと。

### 1.4 LLM 抽象の現状（**最重要の制約**）

- [src/lib/llm/LLMProvider.ts](../src/lib/llm/LLMProvider.ts) の `ChatMessage.content` は **`string`（テキスト専用）**。画像 / PDF / inline data を渡す口が無い。
- したがって **`pdf_native`（PDF バイト直送）も bbox 検討（B）も、まず `LLMProvider` をマルチモーダル対応へ拡張する必要がある**。これが両選択肢に共通する最大の作業。
- 影響先: `LLMProvider` I/F + [GeminiProvider.ts](../src/lib/llm/GeminiProvider.ts)（Gemini は `inlineData`/`fileData` パートを持つ）+ [OpenRouterProvider.ts](../src/lib/llm/OpenRouterProvider.ts)（OpenAI 互換 `image_url` / `file`。モデル依存）+ トークン概算（[pricing.ts](../src/lib/llm/pricing.ts) / planRun）。

---

## 2. 論点の分解

「PDF を送って座標でハイライト」という 1 つの言葉に、**独立した 2 軸**が混ざっている。

- **軸 A（抽出の入力）**: 値と quote をどう取り出すか。`text_only`（現行） vs `pdf_native`（PDF 直送）。
- **軸 B（ハイライトの座標源）**: quote をどこに重ねるか。**テキスト層 span 座標**（現行・born-digital 用） vs **モデルが返す bbox**（新規） vs **OCR で再建したテキスト層**。

Q7 は「A=pdf_native を採用、B=無し（ハイライト不可）」という組み合わせを確定した。今回の問いは実質「**B に何か足せないか**」。以下の選択肢で整理する。

---

## 3. 選択肢

### 選択肢 A — `pdf_native` 抽出のみ実装（Q7/P1 の本来スコープ・ハイライトなし）

スキャン PDF を LLM に添付して**抽出だけ**行う。ハイライトは付けず、検証は「quote 全文 + ページヒント + 本文内検索（テキスト層がないので画像目視）」で人手確認する（現行バナー文言のとおり）。

- **やること**
  1. `LLMProvider` をマルチモーダル拡張（§1.4）。少なくとも「テキスト + PDF/画像パート」を送れる形へ。
  2. `extractData` skill に `pdf_native` 経路を追加（[extractData.ts](../src/features/extraction/skills/extractData.ts) L49 の TODO 解消）。プロンプト版数を上げる。
  3. `planRun` / `executeRun` を `pdf_native` 対応に（`no_text_layer` 文書を除外せず、PDF を添付。トークン概算は PDF ページ数ベースへ）。
  4. `extractionService` の `inputMode` ハードコードを解除し、文書の `text_status` で `pdf_native` / `text_only` を出し分け（study 内混在時の扱いを決める）。
  5. UI のグレーアウト解除（extractView / pilotView）。`Evidence.anchorStatus` は `null` のまま（アンカリングしない）。
- **触るファイル**: `lib/llm/*`, `features/extraction/{skills/extractData,planRun,executeRun}.ts`, `app/services/extractionService.ts`, `app/views/{extractView,pilotView}.ts`, ドメイン（`ExtractionRun.inputMode` の書き込み）。
- **リスク / 論点**
  - LLM がスキャン画像から読む精度（表・多段組み）。**Q3 のパイロットで anchor 失敗率ではなく「値の正確度」を計測**する枠組みが要る（アンカリングしないので anchor_status では測れない）。
  - コスト増（PDF/画像トークン）。単価表・概算の更新。
  - born-digital も `pdf_native` にすべきか（Q3 の本来の比較）は別途。ここではスキャン PDF に限定するのが安全。
- **工数感**: 中〜大（LLM 抽象拡張が本体）。**Q7 の確定範囲内**なので設計変更の合意は不要。

### 選択肢 B — マルチモーダル bbox で座標ハイライト（**新規機能・Q7 の「ハイライト不可」を覆す**）

抽出時にモデルへ「各 quote の**バウンディングボックス**」も返させ、それをオーバーレイに重ねる。

- **前提**: Gemini 系は画像/PDF 内要素の座標（正規化 0–1000 等）を返せる。これを quote 単位で使う。
- **やること**
  1. 選択肢 A（`pdf_native`）が前提（PDF/画像をモデルに見せないと座標は返らない）。
  2. `extractData` の構造化出力スキーマに `bbox`（page + 矩形）を追加。プロンプトで「quote の位置を bbox で返す」指示。
  3. **座標系の対応付け**を実装: モデル bbox（画像ピクセル or 正規化）→ PDF ユーザー空間の `HighlightRect` へ変換。ページ寸法・DPI・回転の対応が要る。描画層（`pdfViewer` / `toDisplayRect`）はそのまま流用できる（§1.3）。
  4. `Evidence` に bbox 由来の座標を持たせる（**追記型・監査**の設計に合わせた列追加。`highlights.ts` の分岐: テキスト層アンカリング or bbox）。
  5. `anchorStatus` に相当する**信頼度**の扱い（bbox は「当たっているか」を機械検証できない。人手判定に委ねる）。
- **触るファイル**: 選択肢 A の全ファイル + `domain/evidence.ts`（スキーマ拡張）+ `features/verification/highlights.ts`（座標源の分岐）+ `sheetsSchema.ts`（Evidence 列追加）+ CSV/audit への影響。
- **リスク / 論点（大きい）**
  - **bbox の精度**。任意テキスト span の位置は、born-digital のテキスト層アンカリング（§5）より不確か。**パイロットで「bbox が正しい位置に乗る率」を計測してからでないと採用すべきでない**。
  - 座標系変換の検証（回転ページ・多段組み・図表跨ぎ）。過去に `/Rotate 90` ハイライトずれのバグ実績あり（要注意）。
  - Evidence スキーマ拡張は 14 タブ設計・監査・エクスポートに波及。後戻りしにくい。
  - **Q7 の「ハイライト不可」を覆す意思決定**が必要（requirements 改訂）。
- **工数感**: 大。**先に PoC + 精度計測**（下記）を挟むこと。

### 選択肢 C — OCR でテキスト層を再建（参考・Q7 の non-goal）

スキャン PDF を OCR してテキスト層を作り、**現行の精密なアンカリング / ハイライトをそのまま使う**。

- 長所: ハイライトの精度・実装はほぼ現行流用。値抽出も `text_only` のまま。
- 短所: OCR エンジン同梱（bundle / worker 肥大、MV3 の remote code 制約）、処理時間、OCR 誤りの伝播。**Q7 で明示的に non-goal**。
- 位置づけ: 現時点では非推奨だが「精密ハイライトを諦めたくない」場合の唯一の筋として記録。

---

## 4. 技術メモ・落とし穴

- **LLM 抽象の拡張が律速**（§1.4）。A/B いずれも最初にここを設計する。プロバイダ差（Gemini `inlineData` vs OpenRouter/OpenAI 互換のモデル依存）を吸収する I/F を切ること。
- **座標系**: 現行オーバーレイは PDF ユーザー空間の矩形を回転込みで描ける（`toDisplayRect`）。bbox を採用するなら「モデル座標 → PDF ユーザー空間」への一段変換を足すだけで描画層は再利用可。回転ページの回帰テスト必須。
- **`Evidence` は追記型・監査対象**。列追加は sheetsSchema / リポジトリ / CSV / ダッシュボードの率計算に波及。分母（anchor 失敗率・not_reported 率）の定義に bbox 経路をどう混ぜるか要検討。
- **計測なしに採用しない**: 選択肢 B は「bbox 精度のパイロット」を先に。既存の実データベンチ基盤（`experiments/extraction-benchmark-real/`, gitignore）に「bbox が正しいセルに乗った率」を測る小実験を足すのが早い。
- **study 内混在**（born-digital + スキャンが同一 study）: `pdf_native` と `text_only` の混在バッチをどう組むか（planRun/executeRun のバッチ設計）。document_index / 連結の既存ロジック（v0.10 フェーズ2）との整合。

---

## 5. 意思決定ポイント（未決の問い）

1. **そもそもスキャン PDF に抽出を許すか**（= 選択肢 A を実装するか）。Yes なら Q7 の範囲内、追加合意不要。
2. **ハイライトを付けるか**（= 選択肢 B / C）。Yes なら **requirements Q7 の改訂**（「ハイライト不可」→条件付き可）が必要。
3. B を採るなら **PoC → 精度計測 → 本実装** の順を守るか（推奨: 守る）。
4. 対象モデルの制約（bbox を返せるのは Gemini 系中心。OpenRouter 経由の任意モデルでは不可 → provider 別の可否判定 UI が要る）。

### 推奨（たたき台）

- **短期**: 何もしないのが一貫（現状バナー + quote/ページヒントで人手検証）。スキャン PDF は「取り込めるが抽出対象外」を明示するに留める。
- **中期（やるなら）**: **選択肢 A**（`pdf_native` 抽出・ハイライトなし）を Q7 範囲で実装。LLM 抽象のマルチモーダル拡張はここで作り、将来の B/他機能の土台にする。
- **B（bbox ハイライト）は、A 実装後に PoC で精度を測ってから**判断。いきなり Evidence スキーマを拡張しない。
- → **この PoC を先に実施した（§6）。結果 🟢 Green** のため、B は「実装候補」に昇格。実装手順は §7。

---

## 6. PoC 結果 — マルチモーダル bbox の実弾検証（2026-07-11・🟢 Green）

§5 で「B は PoC で精度を測ってから」とした、その PoC をローカルスパイクで実施した。証跡: **[experiments/multimodal-bbox-spike/](../experiments/multimodal-bbox-spike/REPORT.md)**（`spike/multimodal-bbox` ブランチ・commit `de76777`）。

### 6.1 わかったこと（H1/H2/H4 支持）

- モデル `gemini-3.5-flash`（BYOK 既定）に**スキャン画像 PDF のページ画像**（今回の入力は複写スタンプ付き JBIG2 白黒スキャン = テキスト層なし）を `inline_data` で送ると、抽出値ごとに **bounding box を返す**。
- 座標規約（実測確定）: **`box_2d = [ymin, xmin, ymax, xmax]`、画像の左上を原点とし高さ・幅で 0–1000 に正規化した整数**。
- 命中: 本文・見出し・**多列レイアウトの表セル**まで 8/8 が対象を囲んだ（Sonnet が実行 → Opus が overlay を目視で独立確認 → Fable がコード・写像式・実データを監査、の三者確認）。**表セルでも精度劣化なし**が重要な収穫（`no_text_layer` で最も価値が出る）。
- 実行コスト目安: ページ画像 1 枚 ≒ 1,000〜1,100 image tokens + thinking。1 ページ 1 リクエストで複数項目をまとめても精度は落ちなかった。

### 6.2 監査（Fable）で確定した「本実装での必須条件」

1. **座標写像は回転 0 でのみ検証済み**。`box_2d` は「回転適用後の描画フレーム」座標なので、[viewportRect.ts](../src/lib/pdf/viewportRect.ts) の `toDisplayRect`（未回転ユーザー空間→表示の変換）へ素通しすると**二重回転**になる疑い。→ 回転ページの写像は §7.3・スパイク REPORT §10（追試）で確定させてから実装する。
2. **`box_2d` は `responseSchema` を付けても 5 要素（末尾重複）で返ることがある**（8 件中 2 件）。長さ・数値・範囲・順序の検証と、壊れていれば**座標なしフォールバック**（ハイライト非表示・値/quote は保持）が必須。
3. **PoC のプロンプトは期待値を与えた「既知値の位置特定」条件**で、本番の「未知値抽出＋位置」より易しい。位置精度と value 正確度は本番相当プロンプトで再測が必要（スパイク REPORT §10 の追試で対応中）。

> **追試（スパイク REPORT §10）実施済み・結果は「条件付き維持」**:
> - **未知値条件**（本番相当・期待値をプロンプトに書かない）: value 抽出 8/8（劣化なし）。**box は 7/8 が実用域・1 件は明確な外れ**（value が正しくても box が対象からズレる実例）。→ box は機械検証できず、**quote 全文 + 本文検索のフォールバックと必ず併用**する前提。
> - **回転写像**: 案(i)「表示フレームへ直接」が正しいと机上検算で確定（案(ii) `toDisplayRect` 素通しは二重回転で 1200px 超ズレ）。ただし**回転画像に対する Gemini 自身の box grounding が劣化**する新リスクを発見 → 回転ページは当面「実験的機能」扱い。

---

## 7. 実装ハンドオフ（選択肢 B: bbox 座標ハイライト）

> **読者**: 本リポジトリに不慣れなソフトウェアエンジニア。各 PR は独立にレビュー・マージできる粒度に割った。着手は §7.0 のゲート通過後、PR1 → PR4 の順。作業原則（CLAUDE.md）: ブランチ必須 / 成果物は日本語 / jest カバレッジ 100% 強制 / `npm test` 後に `npm run dev`、UI 変更時は `npm run test:e2e`。

### 7.0 決定ゲート（コーディング前に必ず確認）

- [ ] **Q7 改訂の合意**: requirements.md Q7 の「テキスト層がないためハイライト不可」を「**`pdf_native` かつ bbox が返るモデルのときは座標ハイライト可（機械検証はできず人手判定に委ねる）**」へ改訂する意思決定（プロダクトオーナー承認）。
- [x] **スパイク §10 追試 実施済み（条件付き維持）**: 未知値条件で value 8/8・box 7/8 実用域（1 件外れ）、回転写像は案(i) に確定。→ **box はフォールバック併用前提・回転ページは実験的機能**という条件で先へ進む。
- [ ] **対象プロバイダの範囲**: bbox は Gemini 系を初期対象とする。OpenRouter 経由の任意モデルは bbox 非対応がありうる → **provider 別の可否判定**（返せないモデルは「抽出のみ・ハイライトなし」に自動フォールバック）を PR3 の設計に含める。

### 7.1 目標データフロー（B 実装後）

```
no_text_layer 文書
  └─ executeRun（pdf_native 経路）… ページ画像 or PDF を LLMProvider へ添付
        └─ 応答 { field_id, value, quote, page, document_index, box_2d } を検証
              ├─ value/quote/page → Evidence（従来どおり）
              └─ box_2d → validateBox() → Evidence.bbox（page + 正規化矩形）※壊れていれば null
  検証画面
  └─ highlights.ts … Evidence.bbox があれば bbox 経路で HighlightOccurrence を生成
        └─ 座標写像（§7.3）→ pdfViewer オーバーレイ（既存の描画層を再利用）
```

born-digital（テキスト層あり）は従来の quote アンカリング経路のまま。**分岐は「Evidence が bbox を持つか」1 点**。

### 7.2 確定済みの設計判断（スパイク+監査由来。実装で迷ったらここに従う）

| 項目 | 決定 |
|---|---|
| bbox の座標規約 | `[ymin, xmin, ymax, xmax]`・0–1000 正規化・**画像左上原点** |
| 保存単位 | Evidence 1 行に `bbox_page`（1-indexed）+ 正規化 4 値。**quote/anchorStatus とは別軸**（bbox は machine 検証不能） |
| 壊れた bbox | 座標なしにフォールバック（値/quote は生かす）。バッチは落とさない |
| 幻覚 box 防止 | プロンプトで「**quote を実際に位置特定できたときだけ** box を返す。見つからなければ box は null」。PoC の「最も近い box を返せ」指示は**本番では撤廃** |
| スキーマ制約 | `responseSchema` の box に `minItems:4 / maxItems:4` + アプリ側検証の両建て。**[GeminiProvider.ts](../src/lib/llm/GeminiProvider.ts) の `toGeminiSchema` は既に minItems/maxItems をパススルー（L207-208）** するので方言変換の改修は不要 |
| 回転写像 | §7.3。回転 0 は実測済みの式。**回転≠0 は案(i)「表示フレームへ直接」に確定**（`toDisplayRect` 素通し=案(ii)は二重回転で禁止） |
| box の信頼度 | 機械検証不能。**value が正しくても box は外れうる**（追試で実例）→ ハイライトは quote 全文+本文検索のフォールバックと必ず併用 |

### 7.3 座標写像の確定仕様

**回転 0（実測済み・Fable 検算済み）**: box → PDF ユーザー空間矩形（[viewportRect.ts](../src/lib/pdf/viewportRect.ts) の `UserSpaceRect`。W_pt/H_pt は当該ページの未回転 pt 寸法）:

```
UserSpaceRect {
  x:      xmin / 1000 * W_pt,
  width:  (xmax - xmin) / 1000 * W_pt,
  y:      H_pt * (1 - ymax / 1000),
  height: (ymax - ymin) / 1000 * H_pt,
}
```
これを `toDisplayRect(rect, { width: W_pt, height: H_pt, rotation: 0 })` に渡すと表示座標に一致（`top = ymin/1000*H_pt`）。scale は打ち消すのでズーム非依存。

**回転 ≠ 0（追試で確定 = 案(i)）**: box はモデルに見せた**描画フレーム**（回転適用後）の座標。スパイク §10 の机上検算で、**案(i)「表示フレームへ直接」`left=xmin/1000*W_disp, top=ymin/1000*H_disp, w=(xmax-xmin)/1000*W_disp, h=(ymax-ymin)/1000*H_disp`（W_disp/H_disp = 回転後の表示ピクセル寸法）が正しい**と確定した。**案(ii)（回転0の `UserSpaceRect` を作って `toDisplayRect(90)` に素通し）は二重回転で left が 1200px 超ズレる**ため禁止。

**オーバーレイ側の制約（コード確認済み）と実装方針**: [pdfViewer.ts](../src/app/ui/pdfViewer.ts) の `rectStyle` は `toDisplayRect(rect, page)` を呼び、`rect` は「回転前のユーザー空間の矩形」・回転は `page` 側という契約（L142-143）。案(i) は `toDisplayRect` を通さないため、**bbox ハイライトは `rectStyle`/`highlights.ts` に「表示フレームの矩形をそのまま使う」専用パスを足す**（回転 0 でも案(i) は成立するので、bbox は一貫して案(i)＝表示フレーム直接で通すのが最も単純。テキスト層アンカリング経路は従来どおり `toDisplayRect` を使う）。**回転ページの回帰テストは必須**（過去に `/Rotate 90` ハイライトずれバグ実績あり）。

> **回転ページの追加リスク（§10 新発見）**: 写像式は正しくても、**回転（横倒し）画像に対しては Gemini 自身の box grounding 精度が落ちる**（追試の 1 サンプルで対象からズレた）。回転ページの bbox ハイライトは「実験的機能」とし、本番相当データで n を増やして grounding 精度を測るまで既定 ON にしない。

### 7.4 PR 分割（着手順）

#### PR1 — `LLMProvider` のマルチモーダル対応（**律速。ここが土台**）
- **目的**: テキストのみの `ChatMessage.content: string` を、テキスト＋画像/PDF パートを送れる形へ拡張する。
- **変更ファイル**: [LLMProvider.ts](../src/lib/llm/LLMProvider.ts) / [GeminiProvider.ts](../src/lib/llm/GeminiProvider.ts) / [OpenRouterProvider.ts](../src/lib/llm/OpenRouterProvider.ts) + 各テスト。
- **作業**:
  1. `ChatMessage.content` を `string | ChatContentPart[]` に拡張。`ChatContentPart = { type:'text'; text:string } | { type:'image'; mimeType:string; dataBase64:string }`（後方互換: 文字列はそのまま text パート扱い）。
  2. `GeminiProvider.buildRequestBody` を content 配列対応に（現状 `parts:[{text}]` → text は `{text}`、image は `{ inlineData: { mimeType, data } }`）。スパイクの `src/run-bbox.ts` が動く実装例。
  3. `OpenRouterProvider` は OpenAI 互換 `image_url`（data URL）へ写像。**モデルが画像非対応なら明示エラー**にできるよう `supportsImageInput` 的な判定口を用意。
  4. **ログ肥大対策**: `withLogging`（[lib/llm](../src/lib/llm/)）が画像パートの base64 を Drive `logs/llm` へ素通しすると 1 リクエストで数 MB になる。ログ保存時に画像パートを `<image: {mimeType}, {N}B>` 等へ redact する（スパイクの runs JSON と同方針）。
- **DoD**: 既存テスト green（文字列パスは不変）/ 画像パートを含むリクエストボディの単体テスト追加 / **ログに base64 が残らない redact テスト** / `npm run dev` 成功。**この PR は UI に出ない**（配線は PR2 以降）。

#### PR2 — `pdf_native` 抽出経路（画像添付・ハイライトはまだ無し = 選択肢 A 相当）
- **目的**: `no_text_layer` 文書を、ページ画像を添付して抽出できるようにする（値/quote/page まで。box はまだ扱わない）。
- **変更ファイル**: [extractData.ts](../src/features/extraction/skills/extractData.ts) / [planRun.ts](../src/features/extraction/planRun.ts) / [executeRun.ts](../src/features/extraction/executeRun.ts) / [extractionService.ts](../src/app/services/extractionService.ts) / [extractView.ts](../src/app/views/extractView.ts) / [pilotView.ts](../src/app/views/pilotView.ts) / **ページ画像ローダ新設**（[renderPage.ts](../src/lib/pdf/renderPage.ts) + [loadDocumentPages.ts](../src/features/documents/loadDocumentPages.ts) の画像版 + Drive [drive.ts](../src/lib/google/drive.ts) の `getFileBinary`）。
- **作業**:
  1. ページ画像ローダの**注入経路**: 現行 `executeRun` はテキストのみ注入（`loadDocumentPages` を [extractionService.ts](../src/app/services/extractionService.ts) で注入）。pdf_native 用に「Drive `getFileBinary` → pdfjs → canvas → PNG(base64)」の画像ローダを新設し同様に deps 注入する（`renderPdfPageToCanvas` 流用・scale 2.0 目安。PDF ロードは `pdfViewCache.ts` が前例）。トークンと精度のトレードオフはコメントに残す。
  2. `extractData` skill に `pdf_native` 入力（画像パート）経路を追加。L49 の TODO を解消。**プロンプト版数 `EXTRACT_DATA_PROMPT_VERSION` を 2→3** に上げる。
  3. `planRun`: `no_text_layer` 文書を除外しない分岐。トークン概算をページ画像ベースへ（image tokens 概算を [pricing.ts](../src/lib/llm/pricing.ts) に追加）。
  4. `executeRun`: study 内で `text_status` に応じ `text_only`/`pdf_native` を出し分け（混在 study の扱い＝当面は文書単位でモード決定、を明記）。
  5. `extractionService` の `inputMode:'text_only' as const`（L180）ハードコードを解除し文書の `text_status` 由来に。UI のグレーアウト解除。
- **DoD**: スキャン PDF fixture でパイロット→抽出が Evidence を生む（`anchorStatus` は null）/ jest 100% / E2E（extract/pilot ルート）green。

#### PR3 — bbox スキーマ + Evidence 拡張 + 座標写像 + highlights 分岐
- **目的**: box を取得・検証・保存し、検証画面でハイライトする。
- **変更ファイル**: [extractData.ts](../src/features/extraction/skills/extractData.ts)（スキーマ/プロンプト）/ [validateAiOutput.ts](../src/features/extraction/validateAiOutput.ts)（box 検証）/ [evidence.ts](../src/domain/evidence.ts)（型）/ [sheetsSchema.ts](../src/domain/sheetsSchema.ts)（Evidence の列定義）+ [evidenceRepository.ts](../src/features/extraction/evidenceRepository.ts)（読み書き）/ [highlights.ts](../src/features/verification/highlights.ts)（bbox 経路）/ [pdfViewer.ts](../src/app/ui/pdfViewer.ts)（回転写像で案 i を採るなら）。
- **作業**:
  1. `EXTRACT_DATA_RESPONSE_SCHEMA` に `box_2d`（`type:array, items:integer, minItems:4, maxItems:4`、nullable）を追加。システムプロンプトに §7.2 の box 指示を追記（**quote を位置特定できたときだけ返す**）。版数 3→4。
  2. `validateBox(raw): NormalizedBox | null` を新設。**長さ=4・整数・0–1000・`ymin≤ymax`・`xmin≤xmax`** を満たさなければ null（末尾重複の 5 要素は「先頭 4 要素が妥当なら採用」等の復元を許すが、復元後も範囲/順序検証を必ず通す）。`validateAiOutput` に組み込み、box 破棄は `partial_failure` にせず**行は残して bbox のみ null**。
  3. `Evidence` に `bboxPage: number | null` と正規化 4 値（例 `bbox: { ymin,xmin,ymax,xmax } | null`）を追加。Sheets 列・リポジトリの読み書き・CSV(audit)・**requirements §3.2 の Evidence 列定義**（作業原則 4 でこの PR に含める）への反映。**追記型は不変**。
     - ⚠️ **既存プロジェクトの後方互換が必須**: [evidenceRepository.ts](../src/features/extraction/evidenceRepository.ts) の `readEvidenceRows`（L103-109 付近）は `SHEET_HEADERS.Evidence` を**位置固定で厳格検証**し不一致で例外を投げる → 列を足すと**既存プロジェクトの Evidence 読み出しが全滅**する。旧ヘッダ（末尾列欠損）を許容して null 埋め・書き込み時にヘッダを拡張する移行を設計すること（前例は ArmStructures のタブ自動作成のみで、列追加の前例はない）。
  4. `highlights.ts`: `buildDocumentHighlights` に「Evidence が bbox を持つなら §7.3 の写像で `HighlightOccurrence` を作る」分岐を追加（テキスト層アンカリングは通さない）。`EvidenceHighlight.status` に bbox 由来を表す値を足すか別フラグにするかを決める（`AnchorStatus` は増やさず別軸フラグ推奨）。
  5. provider 別可否: box を返せないモデルの run では bbox 常に null（PR1 の判定口を使用）。
- **DoD**: box 検証の table-driven テスト（正常/5要素/範囲外/順序逆/NaN）/ bbox 経路のハイライト生成テスト/ 回転ページ回帰テスト green / jest 100%。

#### PR4 — 検証 UI 仕上げ + Q7 改訂 + E2E
- **目的**: `no_text_layer` でも bbox があればハイライトを出し、無ければ従来バナー。ドキュメント整合。
- **変更ファイル**: [verificationPanel.ts](../src/app/views/verificationPanel.ts)（`no_text_layer` バナー/検索の出し分けを「bbox があればハイライト表示」に更新）/ requirements.md（Q7 改訂）/ ui-states.md（状態追加）/ E2E。
- **作業**:
  1. バナー条件（no_text_layer バナー L641 前後・テキストなし注記 L477。**シンボルで追う**）を「bbox ハイライトの有無」も見るよう更新。**bbox セルの一致件数表示・フォーカス連動をどの段に噛ませるか**を設計する（現行ハイライトは issue #28 案3 の 2 段構成 = bundle 時のテキストマッチ → PDF ロード後の `buildDocumentHighlights`。no_text_layer は `extractedPages` が空で textMatches 0 件のため、bbox 側で駆動する必要がある）。クリックでフォーム連動は既存流用。
  2. requirements.md Q7 と ui-states.md を改訂（実装より先に spec を書く運用＝作業原則 4。ただし本 PR では実装済みに合わせて同時更新可）。
  3. E2E: スキャン PDF stub → 抽出 → bbox ハイライト → 判定 → Decisions 追記、を実弾検証（既存 `app-verify.spec.ts` の複数文書テストが雛形）+ axe。
- **DoD**: E2E green / ui-states.md・requirements.md 更新 / `npm run test:e2e` 通過。

### 7.5 未決・リスク（実装中に判断が要る点）
- **box を過信しない（追試で確定）**: value 正誤と box 位置は独立で、value が正しくても box が対象外に付く実例あり（7/8 実用域・1/8 明確な外れ・2/8 が画像端まで伸びる癖）。**ハイライトは quote 全文表示＋本文検索フォールバックと必ず併用**し、box 単独を正としない UI にする。
- **回転ページは実験的機能（追試で確定）**: 写像式は案(i) で正しいが、回転画像に対する Gemini の grounding 精度が未確定。既定 ON にせず本番相当データで追加検証。
- **混在 study**（born-digital + スキャンが同一 study）のバッチ設計（planRun/executeRun）。document_index 連結（v0.10 フェーズ2）との整合。
- Evidence 列追加が **ダッシュボードの率計算**（anchor 失敗率・not_reported 率の分母）に与える影響。bbox 経路を率にどう混ぜるか。
- 複雑な表（結合セル・罫線なし）と低解像度/傾きスキャンでの box 精度は PoC 未検証。パイロットで実データ計測を推奨。
- コスト増（画像トークン）。単価表・概算の更新と、ユーザーへのコスト表示。

---

## 8. 参照

- 設計: [requirements.md](requirements.md) Q7 / Q3 / §3.2 Documents.text_status / §5 quote アンカリング
- アーキ: [architecture.md](architecture.md) L216-219（アンカリング → highlightMap → オーバーレイ）
- コード touchpoints:
  - LLM 抽象: [src/lib/llm/LLMProvider.ts](../src/lib/llm/LLMProvider.ts), [GeminiProvider.ts](../src/lib/llm/GeminiProvider.ts), [OpenRouterProvider.ts](../src/lib/llm/OpenRouterProvider.ts)
  - 抽出: [skills/extractData.ts](../src/features/extraction/skills/extractData.ts), [planRun.ts](../src/features/extraction/planRun.ts), [executeRun.ts](../src/features/extraction/executeRun.ts), [extractionService.ts](../src/app/services/extractionService.ts)
  - ハイライト: [evidence.ts](../src/domain/evidence.ts), [anchor.ts](../src/domain/anchor.ts), [highlights.ts](../src/features/verification/highlights.ts), [pdfViewer.ts](../src/app/ui/pdfViewer.ts), [verificationPanel.ts](../src/app/views/verificationPanel.ts)
  - text_status 判定（今回の修正）: [detectTextStatus.ts](../src/features/documents/detectTextStatus.ts) ＋ PR #46
