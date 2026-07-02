# 技術スパイク計画: extract → anchor 実弾検証（v1.0）

- **ステータス**: **実施完了（2026-07-02）。結果と判定は [REPORT.md](REPORT.md) — 🟢 Green**
- **作成日**: 2026-07-02
- **位置づけ**: 本プロダクトの中核仮説「LLM が verbatim quote を返し、それが PDF.js テキスト層にアンカリングできる」を、UI 実装前に取得済み PDF 2 本で実弾検証する。`experiments/` の最初の中身（requirements.md §8 の Q8 ベンチマーク雛形を兼ねる）
- **同時実施**: PDF.js worker + MV3 CSP の確認（architecture.md §7 チェックポイント 2）
- **参照**: [requirements.md §5](../../docs/requirements.md)（アンカリング方式）/ §4.3（extract-data 出力契約）/ Q3・Q8、[architecture.md §2.3](../../docs/architecture.md)・§4.3、[test-strategy.md §2.2](../../docs/test-strategy.md)（fixture 2 層）、[tests/fixtures/pdf/README.md](../../tests/fixtures/pdf/README.md)

---

## 1. 検証する仮説と、失敗したときに影響する設計

| # | 仮説 | 失敗時に影響する箇所 |
|---|---|---|
| H1 | gemini-3.1-flash-lite は「言い換え禁止・原文どおり・最大 300 文字」の指示で verbatim quote を返せる | §4.3 のプロンプト設計、Q8 の主指標（quote 忠実度） |
| H2 | その quote は §5 の段階マッチング（exact / normalized / fuzzy）で PDF.js テキスト層に高率でアンカリングできる | §5 の設計そのもの、S8 検証画面の成立性 |
| H3 | `pdf_native` と `text_only` で anchor 失敗率・quote 忠実度に差が出る（Q3 の判断材料） | Q3（入力方式の確定手順）、パイロット設計 |
| H4 | pdfjs-dist の worker は MV3 CSP 下で同梱方式（`chrome.runtime.getURL`）で動く | architecture §7 チェックポイント 2、test-strategy §2.2 の worker seam A 案 |

## 2. 成果物と本実装へのマッピング

| スパイク成果物 | 本実装での行き先 |
|---|---|
| 抽出プロンプト（`prompts/extract-data.md`） | `src/skills/extract-data.md` の v1 |
| 計測コード（anchor 成功率・quote 忠実度の集計） | Q8 抽出精度ベンチマークの雛形（`experiments/` に残す） |
| テキスト層抽出スクリプト（`src/extract-text.ts`） | `tools/generate-pdf-fixture.ts` と `src/lib/pdf/textLayer.ts` の原型 |
| ページ別テキスト + span 座標 JSON | `tests/fixtures/pdf/*.json`（test-strategy §2.2 のコミット対象 fixture） |
| 素朴なアンカリング実装（`src/anchor.ts` ほか） | `src/features/anchoring/*` の下書き + §2.3 の table-driven テストケース洗い出し |
| MV3 ハーネス | チェックポイント 2 の判断記録（PDF.js バージョン・worker 方式の確定） |
| `REPORT.md` | Q3 / §5 / チェックポイント 2 の判断根拠（docs へ反映） |

## 3. ディレクトリ構成

ルートに package.json がまだ無いため、スパイクは `experiments/anchor-spike/` 内で自己完結させる（本実装の scaffolding に影響を与えない。tiab-review の experiments 自己完結運用と同旨）。

```
experiments/anchor-spike/
├── PLAN.md                     # 本ファイル
├── REPORT.md                   # 結果（ステップ 6 で作成）
├── package.json                # pdfjs-dist / dotenv / tsx / typescript のみ
├── tsconfig.json
├── prompts/
│   └── extract-data.md         # プロンプト v1（text_only / pdf_native 共通部 + モード差分）
├── schema/
│   └── mini-schema.json        # ミニスキーマ（§5.2 参照。SchemaFields 相当の列を持つ）
├── src/
│   ├── extract-text.ts         # PDF → ページ別テキスト + span 座標 JSON（pdfjs-dist legacy / Node）
│   ├── run-extract.ts          # Gemini 呼び出し（pdf_native / text_only 両モード）
│   ├── normalize.ts            # §5-1 正規化（空白圧縮・ハイフネーション・リガチャ・NFKC）
│   ├── anchor.ts               # §5-2 段階マッチング（exact → normalized → fuzzy → failed）
│   ├── levenshtein.ts          # 編集距離（自前 DP。ライブラリ選定は本実装時に判断 = §7-4）
│   └── report.ts               # 集計 → REPORT.md 素材の JSON / Markdown 断片
├── outputs/
│   ├── textlayer/              # {pdf_id}.json（→ 検証後 tests/fixtures/pdf/ へ昇格）
│   ├── runs/                   # LLM 生リクエスト / レスポンス（タイムスタンプ付き JSON）
│   └── anchored/               # Evidence 相当の行 + anchor_status
└── mv3-harness/                # ステップ 5 の最小 MV3 拡張（手動 load unpacked）
    ├── manifest.json
    ├── app.html / app.js
    └── pdf.worker.min.mjs      # ビルド時に node_modules からコピー
```

- API キーはリポジトリルートの `.env`（`GEMINI_API_KEY`、gitignore 済み）から dotenv で読む。**キー・生トークンをログ / REPORT / チャットに出さない**（作業原則 5）
- モデルは **`gemini-3.1-flash-lite` に固定**（ユーザー指定）。SDK は使わず `fetch` + REST（`generativelanguage.googleapis.com` の `generateContent`）— 拡張本体も SDK なしの fetch 実装になるため、ここから合わせる
- `outputs/runs/` はコミットする（tiab-review の outputs 運用踏襲。論文は CC BY なので応答に本文断片が含まれても問題ない）

## 4. 実施ステップ

### ステップ 0: セットアップ（〜0.5h）

1. 作業ブランチ `spike/extract-anchor` を切る（作業原則 1）
2. `experiments/anchor-spike/` に package.json / tsconfig（`tsx` で実行、strict）
3. pdfjs-dist は**最新安定版をピン留め**し、バージョンを REPORT に記録（チェックポイント 2 の入力）
4. PDF 2 本の存在確認（無ければ `tests/fixtures/pdf/fetch-pdfs.ps1`）

### ステップ 1: テキスト層抽出（〜1h）

`extract-text.ts`: pdfjs-dist（Node では legacy ビルド）で 2 本の PDF から

- ページ別プレーンテキスト（`getTextContent()` の item を読み順どおり連結。text_only プロンプトとアンカリング対象の両方に使う）
- span 座標付き item 一覧（`str` / `transform` / `width` / `height`）— highlightMap の原型と fixture JSON の素材

を `outputs/textlayer/{pdf_id}.json` へ出力する。JSON スキーマはこの時点の素朴な形でよい（正式スキーマは test-strategy §5-2 のとおり `generate-pdf-fixture.ts` 実装時に確定）。

**確認ポイント**: 2 段組の Front Med 論文で読み順がどれだけ乱れるかをこの時点で目視しておく（アンカリング失敗の原因切り分けに必要）。

### ステップ 2: ミニスキーマとプロンプト v1（〜1h）

`mini-schema.json`: RCT 2 本に共通に効く **12〜15 項目**。entity_level 3 レベルと「表由来項目」を意図的に含める（§9 リスク「表内数値の抽出精度」を分離計測するため）:

| entity_level | 項目例 | ねらい |
|---|---|---|
| study | study_design / country / sample_size_total / population 記述 | 本文散文からの素直な抽出 |
| arm | arm 名 / 群別 N / 介入内容 | entity_key（`arm:1` 形式）の運用確認 |
| outcome_result | 主要アウトカムの効果推定値・群別イベント数（**表由来**） | 表セル quote のアンカリング難度計測 |

各項目は `SchemaFields` 相当（field_id / field_name / entity_level / data_type / extraction_instruction）を持たせ、プロンプトには **field_id を明示して応答にそのまま返させる**（requirements §4.3 の確定仕様どおり）。

`prompts/extract-data.md`: 出力契約は §4.3 の JSON（`{ field_id, entity_key, value, not_reported, quote, page, confidence }` の配列）。quote は「言い換え禁止・原文どおり・最大 300 文字」を明記。`responseMimeType: application/json`（+ 可能なら `responseSchema`）で構造化を強制、temperature 0。

### ステップ 3: 抽出実行（〜1h）

`run-extract.ts` で **2 PDF × 2 モード = 4 run** を実行:

- `pdf_native`: PDF を base64 の `inline_data`（`application/pdf`）で直接送信
- `text_only`: ステップ 1 のページ別テキストを `[PAGE n]` 区切りで送信（page ヒントを返させるため）

リクエスト / レスポンスの生 JSON を `outputs/runs/` に保存（`LLMApiLog` + `logs/llm/` 運用の原型）。field_id が mini-schema に無い応答要素は破棄してカウント（§4.3 の partial_failure 処理の原型）。

### ステップ 4: アンカリング素朴実装と計測（〜1.5h）

`normalize.ts` + `anchor.ts` で §5 をそのまま素朴に実装:

1. 正規化: 空白圧縮 / 行末ハイフネーション結合（`exam-\nple → example`）/ リガチャ展開（`ﬁ → fi`）/ 全角半角 / NFKC
2. 段階マッチング: `exact`（ai_page ± 1 で正規化後完全一致）→ `normalized`（全ページ）→ `fuzzy`（スライディングウィンドウ + 編集距離 ≤ quote 長 15%）→ `failed`
3. 複数一致時は ai_page 近接を採用し、一致数も記録

全 evidence 行（≈ 2 PDF × 15 項目 × 2 モード + arm/outcome 展開分）に `anchor_status` を付与して `outputs/anchored/` へ。

### ステップ 5: MV3 CSP ハーネス（〜1h、ステップ 3 の API 待ち時間と並行可）

`mv3-harness/`: 最小の MV3 拡張（manifest + `app.html`）で

1. `GlobalWorkerOptions.workerSrc = chrome.runtime.getURL('pdf.worker.min.mjs')` で worker を同梱解決
2. fixture PDF 1 本の 1 ページ目を canvas 描画 + `getTextContent()` でテキスト層取得
3. **ブラウザで取れたテキストと Node（ステップ 1）出力の一致確認** — Node での抽出が本実装の代理として妥当かの裏取り

を chrome://extensions の load unpacked で手動確認する。module worker が MV3 CSP で詰まる場合は legacy ビルド / バンドル方式の代替を試し、結果を記録（test-strategy §2.1 の「worker seam A 案が通らない場合は resolver DI へフォールバック」の判断材料）。

### ステップ 6: REPORT.md（〜1h）

集計と判定（§5 参照）を `REPORT.md` にまとめ、以下へ反映する内容を列挙:

- requirements.md §5 / Q3 への追記事項（入力方式の所見、正規化の追加要否）
- architecture.md §7 チェックポイント 2 の結論（PDF.js バージョン + worker 方式）
- `src/skills/extract-data.md` v1 として昇格するプロンプト
- architecture §4.3 の table-driven テストに追加すべき実例（実 PDF で実際に踏んだ正規化ケース）

## 5. 計測指標と判定基準（事前設定）

### 5.1 主指標

| 指標 | 定義 |
|---|---|
| **anchor 成功率** | `exact + normalized + fuzzy` の割合（モード別・PDF 別・entity_level 別） |
| **verbatim 率** | `exact + normalized` の割合（= quote が言い換えなしで返った率。H1 の直接指標） |
| **表由来項目の anchor 成功率** | outcome_result 項目のみで分離集計（§9 リスクの実測） |
| 補助 | not_reported の妥当性、field_id 不整合による破棄数、複数一致率、実行時間・トークン数 |

抽出値そのものの正確度（人間ゴールドスタンダード比）は**目視スポットチェックに留める**。厳密な精度測定は Q8 ベンチマーク本体の守備範囲（CESAR 基準）で、このスパイクはアンカリング可否に焦点を絞る。

### 5.2 判定基準（少なくとも一方のモードで）

| 判定 | 条件（failed 率） | アクション |
|---|---|---|
| **Green** | failed ≤ 10% | §5 設計のまま実装フェーズへ。優位だったモードをパイロット既定に |
| **Yellow** | 10% < failed ≤ 30% | §5 は維持しつつ、正規化ルール追加・`relocate-quote`（P1）の前倒し・プロンプト改良で再測定 1 回 |
| **Red** | failed > 30% | §5 の設計再考。PMC OA XML 取り込み（P2）の前倒しや「quote は段落単位」等の方式変更を要件レベルで再検討 |

- n が小さい（2 PDF × ~15 項目 × 2 モード ≈ 60〜80 evidence）ため、この閾値は**シグナル判定**であって統計的判断ではない。Yellow/Red の場合も「どの正規化ケースで落ちたか」の定性分析を優先する
- H4（MV3 CSP）は成功 / 代替方式で成功 / 全滅の 3 値。全滅の場合のみ実装計画に影響（可能性は低い）

## 6. スコープ外（このスパイクではやらない）

- Sheets / Drive / OAuth（すべてローカルファイルで代替）
- ハイライトの**描画**（span 座標への写像は fixture JSON まで。オーバーレイ描画は実装フェーズ）
- スキーマの AI ドラフト（draft-schema skill）— ミニスキーマは手書き
- 複数モデル比較・厳密な抽出精度測定（Q8 ベンチマーク本体で実施）
- スキャン PDF（`no_text_layer`）— アンカリング対象外のため（Q7）

## 7. 想定リスク

| リスク | 対応 |
|---|---|
| pdfjs-dist の Node（legacy）とブラウザでテキスト層出力が異なる | ステップ 5-3 で 1 ページ突き合わせて検証。乖離があれば fixture 生成をブラウザ（MV3 ハーネス or Playwright）側に寄せる |
| gemini-3.1-flash-lite が responseSchema 非対応 / JSON が崩れる | `responseMimeType` のみで再試行 → プロンプト内 JSON 指示にフォールバック。崩れ率も記録（validateAiOutput 設計の入力になる） |
| 無料枠 / レート制限 | 4 run + 再測定程度なので低リスク。429 は指数バックオフ 1 回だけ実装 |
| 2 本とも同傾向で Q3 の判断材料として弱い | 本スパイクは go/no-go 判定まで。Q3 の最終確定はパイロット（キャリブレーション）で行う建付けは requirements Q3 のまま変えない |
