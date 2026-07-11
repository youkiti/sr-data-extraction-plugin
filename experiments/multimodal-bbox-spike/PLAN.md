# 技術スパイク計画: マルチモーダル bounding box 実弾検証（v1.0）

- **ステータス**: 実施完了。結果と判定は [REPORT.md](REPORT.md)
- **作成日**: 2026-07-11
- **位置づけ**: スキャン PDF（画像のみ・`no_text_layer`）は現行の quote アンカリング方式（§5 のテキスト層マッチング）が原理的に使えない。マルチモーダル LLM（Gemini）がページ画像に対して抽出値の位置を bounding box として返せるなら、スキャン PDF でもハイライト表示付き検証 UI が成立する可能性がある。本拡張の実装には一切触れず、`experiments/` 内で自己完結してこの仮説だけを検証する（anchor-spike と同じ作法）。

## 1. 検証する仮説

| # | 仮説 | 失敗したときの含意 |
|---|---|---|
| H1 | Gemini がページ画像に対し各抽出値の `box_2d` を返せる。座標規約（`[ymin, xmin, ymax, xmax]` を 0–1000 正規化、と推定）は 1 個の既知要素で実測確認する | 規約が違えば以降の box が全部ズレる。まずここを固定してから残りを流す |
| H2 | その box が対象（本文の1文・見出し・**表のセル値**）を実際に囲む | ハイライト UI として使い物になるかの直接指標 |
| H4 | スキャン品質・2段組・小さな表数値でも実用精度が出る | スキャン PDF 全般に一般化できるか。表の数値だけ弱ければ「本文は可・表は要注意」という限定的な採用判断になる |

（H3 相当の「入力方式の比較」は本スパイクの範囲外。単一モデル・単一入力方式〔ページ画像 1 枚〕のみを見る）

## 2. 成果物と本実装へのマッピング

| スパイク成果物 | 本実装での行き先（仮に採用する場合） |
|---|---|
| 座標規約の実測結果 | `GeminiProvider` に画像 inline_data 経路を追加する際の変換式の根拠 |
| box → PDF ユーザー空間への写像式（§6 参照） | `src/lib/pdf/viewportRect.ts` の `toDisplayRect` に渡す `UserSpaceRect` の作り方 |
| overlay 画像による目視命中判定 | no_text_layer 文書向けハイライト機能の go/no-go 判断材料（requirements.md Q7 追記候補） |
| REPORT.md | 「スキャン PDF はハイライト非対応」という現行整理を見直すかどうかの判断根拠 |

## 3. ディレクトリ構成

```
experiments/multimodal-bbox-spike/
├── PLAN.md            # 本ファイル
├── REPORT.md           # 結果（手順4-5で作成）
├── package.json        # pdfjs-dist / @napi-rs/canvas / dotenv / tsx / typescript のみ
├── tsconfig.json
├── inputs/
│   └── 07.pdf           # 10ページのスキャン論文（画像のみ・テキスト層なし）
├── src/
│   ├── render-pages.ts  # PDF → 各ページ PNG（scale 2.0）。dims.json に W_pt/H_pt を記録
│   ├── run-bbox.ts      # 対象ページ画像 → Gemini → box_2d 付き抽出値。生req/res(redact済)を outputs/runs/
│   ├── overlay.ts       # box を PNG へ描画（@napi-rs/canvas）
│   └── report.ts        # 集計素材 JSON（目視判定の補助）
└── outputs/
    ├── pages/            # p{N}.png + dims.json
    ├── runs/             # Gemini 生リクエスト(キーredact済)/レスポンス
    └── overlays/          # box 描画済み PNG
```

- API キーはリポジトリルートの `.env`（`GEMINI_API_KEY`、gitignore 済み）から dotenv で読む。**キー・生トークンをログ / REPORT / 保存物に出さない**（作業原則 5）。anchor-spike に倣い `x-goog-api-key` ヘッダでキーを渡す（URL クエリに乗せない = redact 漏れのリスクをそもそも作らない）
- モデルは **`gemini-3.5-flash` に固定**。SDK は使わず `fetch` + REST（`generativelanguage.googleapis.com` の `generateContent`）
- `outputs/` はコミット対象（anchor-spike の運用踏襲。入力 PDF はスキャン複写だが検証目的の一時利用）

## 4. 実施手順

### ステップ 0: scaffold

package.json / tsconfig（anchor-spike 同型）。`npm install` で pdfjs-dist 6.1.200 / @napi-rs/canvas / dotenv / tsx を導入。

### ステップ 1: render-pages

pdfjs-dist の Node（legacy ビルド `pdfjs-dist/legacy/build/pdf.mjs`）+ `@napi-rs/canvas` の `NodeCanvasFactory` で全 10 ページを scale 2.0 で PNG 化 → `outputs/pages/p{N}.png`。scale 1.0 の `getViewport` から得た `width`/`height`（= PDF ポイント単位のページ寸法）を `outputs/pages/dims.json` に `{ page, widthPt, heightPt, rotation }[]` として保存する。

### ステップ 2: run-bbox

対象は次の 3 ページ（画像 1 枚を 1 リクエストで送信。`responseMimeType: application/json` + `responseSchema` で `[{label, value, quote, page, box_2d:[ymin,xmin,ymax,xmax]}]` を強制、temperature 0）:

- **p1**（タイトル・著者・抄録の BACKGROUND/OBJECTIVE/METHODS/RESULTS ブロック）: 「論文タイトル」「筆頭著者名」「最終回答率 the final response rate（52%）」の3値
- **p5**（Table 2 = Comfort scale の %一覧）: 「Allowing families to hold their dying or dead infant の %（98）」「Discussing autopsy or organ donation … の %（45）」の2値 + 本文中の「mean score = 4.13」
- **p4**（Table 1 = Reliability data）: 「Comfort scale の Final sample Cronbach α（.95)」「Total の No. of items（55）」の2値

**まず p1 だけ・要素1個（タイトル）に絞って実行** → overlay で座標規約（順序・0–1000 正規化かどうか）を目視確認してから残りを流す（規約を後から間違えて気づくと全部やり直しになるため）。

### ステップ 3: overlay

box を対応 PNG へ描画。画素座標へは実測で確定した規約に従う（推定は `x_px = xmin/1000 * 幅px`, `y_px = ymin/1000 * 高px`）。box 内側に label を小さく描く。

### ステップ 4: 目視判定

overlay PNG を実際に読み、対象を囲めているかを「本文」「見出し」「表セル」に分けて命中/外れを数える。

### ステップ 5: REPORT.md

- 実測で確定した座標規約
- 項目別の命中・外れ表
- 表セルと本文の精度差
- 総合判定（🟢Green / 🟡Yellow / 🔴Red。§5 参照）
- 拡張本体へ持っていく場合の変更メモ（`GeminiProvider` への inline_data 画像経路追加、box → `UserSpaceRect` への写像式）

## 5. 判定基準

| 判定 | 条件 | 意味 |
|---|---|---|
| 🟢 Green | 本文・見出し・表セルのいずれも対象をおおむね正しく囲む | no_text_layer 文書へのハイライト機能を実装候補にできる |
| 🟡 Yellow | 本文・見出しは実用域だが表セルが不安定 | 本文限定の部分採用を検討。表は別途対策（セル全体を囲む粗い box で妥協、等）を要件レベルで検討 |
| 🔴 Red | box が対象と無関係 / 座標規約が安定しない | この方式は不採用。no_text_layer は引き続きハイライト非対応の整理を維持 |

n=1 論文・項目数も少数（本文 3 + 見出し系 1 + 表セル 4）のため、この判定は**シグナル判定**であり統計的判断ではない。

## 6. box → 既存オーバーレイ座標系への写像（実装は本スパイクの範囲外。式のみ REPORT に記載）

box_2d = `[ymin, xmin, ymax, xmax]`（0–1000 正規化）から、PDF ユーザー空間矩形（`src/lib/pdf/viewportRect.ts` の `UserSpaceRect`。原点左下・ポイント単位）を次で作れる:

```
UserSpaceRect {
  x:      xmin / 1000 * W_pt,
  width:  (xmax - xmin) / 1000 * W_pt,
  y:      H_pt * (1 - ymax / 1000),
  height: (ymax - ymin) / 1000 * H_pt,
}
```

これを既存の `toDisplayRect(rect, { width: W_pt, height: H_pt, rotation: 0 })` に渡すと `top = ymin/1000 * H_pt` に一致する（回転 0 の場合。scale は打ち消される）。回転がある場合は `toDisplayRect` 側の回転別分岐がそのまま効く想定だが、本スパイクの入力 PDF はページ回転 0 のみのため未検証。

## 7. スコープ外

- 拡張本体のコード変更（`src/` は一切触らない）
- Sheets / Drive / OAuth
- 複数モデル・複数入力方式の比較
- テキスト層 PDF（既存 anchor-spike の対象）
- box の統計的精度測定（n=1 論文のシグナル判定に留める）

## 8. 想定リスク

| リスク | 対応 |
|---|---|
| 座標規約が推定と異なる（画素座標・順序違い等） | ステップ 2 で 1 要素だけ先出しして overlay 目視 → 規約確定後に残りを実行 |
| gemini-3.5-flash が box_2d を含む responseSchema に対応しない / JSON が崩れる | responseSchema なしへ 1 回だけフォールバック（anchor-spike と同方針）。崩れた場合は REPORT に明記して Red 判定の根拠にする |
| スキャン品質（複写スタンプ・ノイズ）で表セルの box がずれる | overlay 目視で表セルのみ分離集計し、Yellow 判定の主根拠にする |
| 無料枠 / レート制限 | 3 リクエスト + 予備 1（規約確認）程度なので低リスク。429 は指数バックオフで最大3回まで再試行 |
