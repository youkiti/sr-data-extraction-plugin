# ハンドオフ: スキャン PDF の `pdf_native` 抽出 / 座標ハイライト検討

> ステータス: **検討用ドラフト（未着手）**。2026-07-11 作成。
> このドキュメントは意思決定のための材料であり、実装計画の確定版ではない。
> まず「§5 意思決定ポイント」を読み、方針を決めてから該当選択肢の詳細へ進むこと。

## 0. きっかけ・関連

- **きっかけ**: スキャン論文 PDF が誤って `text_status: ok` に判定される不具合の修正（PR #46 `fix/text-status-boilerplate-stamp`）の際、「テキスト層のないスキャン PDF は、そもそも PDF を API に送って座標でハイライトする仕組みではなかったか？」という問いが出た。
- **結論（先出し）**: 現行の設計・実装に「**API が返す座標でハイライト**」する仕組みは無い。ハイライトは PDF.js が抽出した**テキスト層の span 座標**に quote をアンカリングして描いており、テキスト層のないスキャン PDF は原理的にハイライトできない（Q7 で確定済み）。`pdf_native` は「**抽出**を PDF 直送で行う」モードで、ハイライトとは別軸。しかも `pdf_native` はまだ実装されていない（`text_only` 固定・P1）。
- **関連**: requirements.md **Q7**（スキャン PDF / OCR 対応）、**Q3**（入力方式 `pdf_native` / `text_only` の確定）、§5（quote アンカリング）。

---

## 1. 現状（事実確認）

### 1.1 設計（requirements.md）

- **Q7 確定**（[requirements.md](requirements.md) L534）: 「画像のみ PDF も `pdf_native` モード（PDF を直接 LLM へ送信）で抽出対象にする。**テキスト層がないためアンカリング / ハイライトは不可**（§5 参照）」
- **non-goal**（[requirements.md](requirements.md) L69）: 「テキスト層の再建（**OCR 処理そのもの**）」は対象外。
- **input_mode**（[requirements.md](requirements.md) L235 / `ExtractionRuns`）: `pdf_native`（PDF を直接 LLM へ）/ `text_only`。**Q3 でパイロット比較して確定する**方針だった（born-digital で LLM 内部認識と PDF.js テキスト層が食い違うリスクの計測。L475）。

### 1.2 実装の現状（= 設計との差分）

| 事実 | 根拠 |
|---|---|
| `InputMode` 型は存在する（`'pdf_native' \| 'text_only'`） | [src/domain/extractionRun.ts](../src/domain/extractionRun.ts) L7 |
| だが実行時は **`text_only` にハードコード** | [src/app/services/extractionService.ts](../src/app/services/extractionService.ts) L147 `inputMode: 'text_only' as const` |
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
- バナー / 検索の出し分け: [src/app/views/verificationPanel.ts](../src/app/views/verificationPanel.ts) L215-218, L244（`textStatus !== 'no_text_layer'` で非表示）, `canSearchText`。

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

---

## 6. 参照

- 設計: [requirements.md](requirements.md) Q7 / Q3 / §3.2 Documents.text_status / §5 quote アンカリング
- アーキ: [architecture.md](architecture.md) L216-219（アンカリング → highlightMap → オーバーレイ）
- コード touchpoints:
  - LLM 抽象: [src/lib/llm/LLMProvider.ts](../src/lib/llm/LLMProvider.ts), [GeminiProvider.ts](../src/lib/llm/GeminiProvider.ts), [OpenRouterProvider.ts](../src/lib/llm/OpenRouterProvider.ts)
  - 抽出: [skills/extractData.ts](../src/features/extraction/skills/extractData.ts), [planRun.ts](../src/features/extraction/planRun.ts), [executeRun.ts](../src/features/extraction/executeRun.ts), [extractionService.ts](../src/app/services/extractionService.ts)
  - ハイライト: [evidence.ts](../src/domain/evidence.ts), [anchor.ts](../src/domain/anchor.ts), [highlights.ts](../src/features/verification/highlights.ts), [pdfViewer.ts](../src/app/ui/pdfViewer.ts), [verificationPanel.ts](../src/app/views/verificationPanel.ts)
  - text_status 判定（今回の修正）: [detectTextStatus.ts](../src/features/documents/detectTextStatus.ts) ＋ PR #46
