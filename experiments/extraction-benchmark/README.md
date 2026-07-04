# 抽出精度ベンチマーク計画（Q8: 既定モデル確定）— 事前登録 README

- **ステータス**: **v1.0 — ユーザー承認済み（2026-07-04）**。§9 チェックリスト全項目承認。実装は [IMPLEMENTATION.md](IMPLEMENTATION.md) の手順で着手可。**API を叩く §8.4-4（ランナー実行）の前に、コスト上限 $5 の監視を有効にすること**
- **作成日**: 2026-07-03（承認 2026-07-04）
- **位置づけ**: requirements.md §8「既定 LLM モデルは抽出精度ベンチマークで確定してから固定する」（未決定事項 Q8）の実施計画。S1〜S10 実装・実機通し確認は完了しており、これが**リリース（remaining-work-plan.md タスク E）前の最後の技術的ブロッカー**（同タスク D）
- **参照**: [requirements.md §8・§10 Q8](../../docs/requirements.md) / [remaining-work-plan.md タスク D](../../docs/remaining-work-plan.md) / [anchor-spike PLAN.md](../anchor-spike/PLAN.md)・[REPORT.md](../anchor-spike/REPORT.md)（構成・トンマナ・実測トークンの出典） / [tests/fixtures/pdf/README.md](../../tests/fixtures/pdf/README.md)（データセットのライセンス・特性） / [src/lib/llm/pricing.ts](../../src/lib/llm/pricing.ts)（単価表）

---

## 1. 目的と位置づけ

anchor-spike（2026-07-02、🟢 Green）は「LLM の verbatim quote が PDF.js テキスト層にアンカリングできる」ことを `gemini-3.1-flash-lite` 1 モデルで実証したが、**抽出値そのものの正確度は目視スポットチェックに留めた**（REPORT.md §5-3 の限界）。本ベンチマークはその残り半分:

1. 人間ゴールドスタンダードとの突合で**抽出精度を定量測定**し、
2. 複数のモデル（Gemini 系 + OpenRouter 系）を同一条件で比較して、
3. **既定モデルを 1 つ確定する**（= Q8 の解決）。

確定したモデルは (a) [pricing.ts](../../src/lib/llm/pricing.ts) の単価表の固定 ID 化、(b) タスク C（Options 既定モデル設定）の工場出荷値、(c) requirements.md Q8 の「解決済み」更新、に反映する（remaining-work-plan.md タスク D「確定の反映」。別コミット）。

## 2. 事前登録の原則（tiab-review の experiments 運用踏襲）

1. **採用基準を実行前に固定する**。本 README がその事前登録文書であり、ユーザー承認をもって §4（指標の算出定義）と §5（採用基準）を凍結する。**結果を見てから基準・指標・データセットを動かさない**
2. 凍結後にどうしても逸脱が必要になった場合（例: モデルの提供終了）は、REPORT.md に**逸脱として明記**したうえで実施する
3. **固定バージョンのモデル ID** を使う（§3）。エイリアスのまま走らせない
4. LLM の生リクエスト / レスポンス（`outputs/runs/`）はコミットして再現可能にする（anchor-spike と同じ。対象論文は CC BY のため応答に本文断片が含まれても問題ない）
5. API キー・生トークンをログ / REPORT / チャットに出さない（作業原則 5）

## 3. 比較対象モデル

[pricing.ts](../../src/lib/llm/pricing.ts) の `MODEL_PRICING` を基に、**Gemini 系 2 モデル + OpenRouter 系 1 モデル**の計 3 種を候補とする（キーは実コードからの引用）。OpenRouter は 2026-07-04 に [`OpenRouterProvider`](../../src/lib/llm/OpenRouterProvider.ts) / [`providerFactory`](../../src/lib/llm/providerFactory.ts)（`/` を含むモデル ID を openrouter に解決）が実装済みで、Qwen 系を Gemini と同一ハーネスで比較できる（旧稿の「OpenRouter は P1 のため対象外・providerFactory が P1 エラーを投げる」は解消済み）:

| # | モデル ID | provider | 入力 $/1M | 出力 $/1M | 期待役どころ |
|---|---|---|---|---|---|
| 1 | `gemini-3.5-flash` | gemini | 0.15 | 0.60 | 精度とコストのバランス候補 |
| 2 | `gemini-3.1-flash-lite` | gemini | 0.10 | 0.40 | 低コスト候補（スパイク実績・無料枠あり）。**pricing.ts 未収載 → 実行前に単価追記が必要**（§9 #2）。単価は概算で要確認 |
| 3 | `qwen/qwen3-235b-a22b-2507` | openrouter | 0.14 | 0.14 | OpenRouter 系（大規模 MoE）の比較候補。pricing.ts 収載済み |

- **固定バージョン ID の方針**: 上表の ID はエイリアスの可能性がある。実行直前（承認後の最初の作業）に、Gemini 2 モデルは Gemini API の `models` エンドポイントで**日付付き / 番号付きスナップショット ID の有無を確認し、あればそれに固定**する。OpenRouter の Qwen は ID にサフィックス（`-2507`）を含む固定版だが、単価は openrouter.ai の料金ページで実行時の値を再確認する（変動しうるため）。いずれも確認結果を本表と REPORT.md に記録する。スナップショットが存在しないモデルはエイリアス ID + 実行日時の記録で代替する（tiab-review の固定バージョン ID 方針。requirements.md §2 の LLM 行にも明記あり）
- **`gemini-3.1-flash-lite` の pricing.ts 追記**: 現状 `MODEL_PRICING` に未収載のため、上表の 0.10 / 0.40 は同クラス（`gemini-2.0-flash`）からの概算。承認後に正規の単価を確認して pricing.ts に追記してから実行する（§8.4-3 と同じチェックポイント）

## 4. 評価指標（requirements.md §8 の案をそのまま採用）

### 4.0 突合の前提

- **評価単位** = ゴールドスタンダードの 1 行（`field_id` × `entity_key`。§6.3）。AI 応答（`validateAiOutput` 通過後の evidence 行）を `field_id` + `entity_key` でゴールド行に突合する
- **arm 番号の対応付け**: entity_key の `arm:<n>` は「本文での初出順」（プロンプト規約 = ゴールド作成規約。§6.3）。AI とゴールドで番号がずれた場合は `arm_label` の値で人手対応付けし、ずれ自体を REPORT に記録する
- **値の一致判定**: 正規化（前後空白除去・連続空白圧縮・NFKC）後に `value_gold` または `acceptable_values`（表現揺れの許容リスト。§6.3）のいずれかと完全一致すれば正解。anchor-spike で観測された `14/54 (25.9%)` vs `25.9% (14/54)` のような順序揺れは acceptable_values で吸収する
- AI 行の**欠落**（応答なし・validateAiOutput での破棄）は不正解として分母に残す

### 4.1 主指標

| 指標 | 分子 | 分母 |
|---|---|---|
| **(1) 項目レベル正確度** | 正解行数 =「ゴールド報告あり行で値が一致」+「ゴールド not_reported 行で AI も not_reported」 | ゴールド全行数（entity 展開後。§6.2 の想定 ≈ 60 行） |
| **(2a) not_reported 感度** | ゴールド not_reported=true のうち AI も not_reported=true とした行数 | ゴールド not_reported=true の行数 |
| **(2b) not_reported 特異度** | ゴールド報告あり（not_reported=false）のうち AI が値を返した（not_reported=false）行数 | ゴールド報告ありの行数 |
| **(3) quote アンカリング成功率** | `anchor_status ∈ {exact, normalized, fuzzy}` の行数 | quote 非 null の evidence 行数（anchor-spike REPORT §2 と同一定義） |

### 4.2 補助指標（採用判断のタイブレークと REPORT 報告用）

| 指標 | 分子 | 分母 |
|---|---|---|
| 重大エラー率（CESAR の Major error 対応） | ゴールド報告あり行で AI が**別の値**を返した行数（acceptable_values にも一致しない取り違え。not_reported の見落としは含めない — それは 2b が捉える） | ゴールド報告ありの行数 |
| verbatim 率 | `exact + normalized` の行数 | quote 非 null の行数 |
| 表由来項目の正確度 / anchor 成功率 | (1)(3) を outcome_result・表由来項目のみで分離集計 | 同左の部分集合 |
| 実測コスト・応答時間 | usageMetadata の実測 tokens × 単価（`estimateCostUsd`）、呼び出し所要秒 | — |

## 5. 採用基準（案）— **ここが Q8 で唯一残っている決め事。ユーザー承認待ち**

> requirements.md §10 の注記どおり「Q8 の閾値のみベンチマーク設計時に最終確定する」。以下は提案値であり、§9 チェックリストの承認をもって凍結する。

**手順 1 — 足切り**（全条件を満たすモデルだけを候補に残す）:

| 条件 | 提案閾値 | 根拠 |
|---|---|---|
| not_reported 特異度（= 報告あり項目を取りこぼさない率。CESAR の Sensitivity に対応） | ≥ 92% | requirements.md §10「Q8 参考」の CESAR データ抽出行の futility 境界（point estimate <92% で中止）を出発点として採用。n が小さいため 95%CI 側の境界（<97%）は適用しない |
| 重大エラー率 | ≤ 3% | 同上（Major error futility >3%） |
| quote アンカリング成功率 | ≥ 90% | anchor-spike の Green 判定（failed ≤ 10%）と整合 |

**手順 2 — 順位付けと同等マージン**: 足切り通過モデルを**項目レベル正確度（指標 1）で降順に並べ、最上位との差が X = 5 ポイント以内**のモデルを「同等」とみなす。

- **X = 5 の根拠**: ゴールド全行数は ≈ 60 行（§6.2）。正確度 90% 前後を仮定した二項標準誤差は √(0.9×0.1/60) ≈ 3.9 ポイントで、**5 ポイントの差（= 3 行分）はこの規模では偶然変動と区別できない**。統計的に区別できない差で高単価モデルを選ぶ理由はないため、同等域はコストで決める。逆に X を 10 に広げると実質的な性能差まで「同等」に均してしまうため 5 を提案する

**手順 3 — 同等群の中の選定**: 実測コスト（§4.2。1 論文あたり実測 tokens × 単価）が最小のモデルを既定モデルとする。コストも同等（±20% 以内）なら quote アンカリング成功率 → 応答時間 の順でタイブレーク。

**手順 4 — 全モデル足切り落ちの場合**: 採用を保留し、原因の定性分析（どの項目・どの論文で落ちたか）を REPORT.md にまとめて再設計を起案する（基準を緩めて無理に採用しない）。

## 6. データセットとゴールドスタンダード

### 6.1 対象論文（最小構成: fixture の実 RCT 2 本）

[tests/fixtures/pdf/README.md](../../tests/fixtures/pdf/README.md) の 2 本をそのまま使う。いずれも PMC OA・**CC BY 4.0** で、シングルカラム / 2 段組の両レイアウトをカバーする:

| pdf_id | PMCID | 内容 | レイアウト |
|---|---|---|---|
| `udca` | PMC10715657 | 新生児高ビリルビン血症に対する UDCA の RCT（PLoS One 2023・10p） | シングルカラム |
| `thermocov` | PMC10766786 | 軽症〜中等症 COVID-19 への局所温熱療法の RCT（Front Med 2023・14p） | 2 段組 |

PDF 本体はコミットされていないため `tests/fixtures/pdf/fetch-pdfs.ps1` で取得する。**本数を増やす場合は同 README の選定基準（PMC OA・CC BY・RCT・レイアウト多様性）に従う**。

### 6.2 代表スキーマ（20 項目案）

anchor-spike の [mini-schema.json](../anchor-spike/schema/mini-schema.json)（15 項目）を**そのまま含めて** 20 項目に拡張する（スパイク結果との比較可能性を保つため既存 15 項目の文言は変えない）。追加 5 項目は表由来（Table 1）と not_reported の多様性を増やす狙い:

| field_id | entity_level | data_type | ねらい |
|---|---|---|---|
| f01〜f15 | （mini-schema.json のとおり: study 8 / arm 3 / outcome_result 4） | — | スパイクとの継続性 |
| f16_arm_mean_age | arm | text | **表由来**（Table 1 のベースライン） |
| f17_arm_percent_female | arm | text | **表由来**（同上） |
| f18_follow_up_duration | study | text | 散文からの抽出 |
| f19_arm_n_analyzed | arm | integer | randomized（f10）との取り違え検出（スパイクで実際に観測された誤りパターン） |
| f20_funding_source | study | text | not_reported 判定の実弾を増やす |

entity 展開後のゴールド行数の想定: 各論文 2 arm として、study 10 + arm 6×2 + outcome_result 4×2 = **30 行 / 論文、計 ≈ 60 行**。

### 6.3 ゴールドスタンダード正解表の JSON スキーマ案

**ユーザー（ドメインエキスパート）が手作業で作成する**（remaining-work-plan.md タスク D 注意書き）。1 論文 1 ファイルで `gold/{pdf_id}.json` に置く。案:

```jsonc
{
  "pdf_id": "udca",
  "pmcid": "PMC10715657",
  "schema_version": 1,          // §6.2 の代表スキーマの版
  "created_by": "（作成者）",
  "created_at": "2026-07-XX",
  "rows": [
    {
      "field_id": "f03_sample_size_total",
      "entity_key": "-",          // requirements.md §3.3 の形式（study は "-"、arm は "arm:1"…）
      "not_reported": false,
      "value_gold": "100",        // 論文の表記どおり（単位変換・丸め・翻訳なし = プロンプト規約と同じ）
      "acceptable_values": ["100 neonates"],  // 同一情報の別表記（順序・区切り揺れ）。なければ []
      "source_page": 3,           // 採点検証用（推奨）
      "source_quote": "…",        // 同上（任意・300 字以内）
      "note": null                // 任意の補足（判断に迷った点など）
    },
    {
      "field_id": "f20_funding_source",
      "entity_key": "-",
      "not_reported": true,       // 論文が報告していない項目
      "value_gold": null,
      "acceptable_values": [],
      "source_page": null,
      "source_quote": null,
      "note": null
    }
  ]
}
```

作成規約:

1. `entity_key` の arm 番号は**本文での初出順**（プロンプト規約と同一。§4.0 の突合前提）
2. `value_gold` は論文の表記どおり。表現揺れを許すときだけ `acceptable_values` に列挙する（採点は §4.0 の正規化後完全一致）
3. 「論文に書かれていない」項目は `not_reported: true`。**推測で埋めない**（AI への規約と同じ）
4. 作成の所要目安: 1 論文 2〜3 時間 × 2 本

## 7. コスト概算

**実測の出典**: anchor-spike の `outputs/runs/*.json` の usageMetadata（15 項目・プロンプト v1・`gemini-3.1-flash-lite`）。トークナイザはモデル間で厳密には異なるが、同系列のため概算として流用する:

| run（実測） | 入力 tokens | 出力 tokens |
|---|---|---|
| udca × text_only | 10,383 | 2,094 |
| udca × pdf_native | 7,119 | 2,094 |
| thermocov × text_only | 21,399 | 2,154 |
| thermocov × pdf_native | 9,367 | 2,226 |
| **1 パス合計（2 論文 × 2 モード）** | **48,268** | **8,568** |

**前提**: 20 項目化 + プロンプト増分の余裕を見て 1 パス = **入力 60,000 / 出力 12,000 tokens** に切り上げ。各モデル **3 反復**（temperature 0 でも応答は揺れうるため。集計は 3 反復をプールし、反復間のばらつきも REPORT に報告）→ モデルあたり入力 180K / 出力 36K tokens。

| モデル | 単価（入 / 出 $/1M） | 入力 180K | 出力 36K | 小計 |
|---|---|---|---|---|
| `gemini-3.5-flash` | 0.15 / 0.60 | $0.027 | $0.022 | **$0.05** |
| `gemini-3.1-flash-lite` | 0.10 / 0.40 | $0.018 | $0.014 | **$0.03** |
| `qwen/qwen3-235b-a22b-2507` | 0.14 / 0.14 | $0.025 | $0.005 | **$0.03** |
| **合計（3 モデル）** | | | | **≈ $0.11** |

- 3 モデルとも低〜中単価帯のため、旧稿（`gemini-2.5-pro` を含む $0.67）より安い ≈ $0.11 に収まる
- デバッグ再実行・スナップショット ID 差し替え等の余裕を見て、**コスト上限 $5** を提案する（超えそうになったら中断して報告）→ §9 チェックリスト

## 8. 実行計画（承認後に着手）

> **実装の詳細手順は [IMPLEMENTATION.md](IMPLEMENTATION.md)（ジュニア SE 向け作業指示書）にある。** 本 §8 は方針、IMPLEMENTATION.md は手順。
> **スコープ確定（2026-07-04 ユーザー決定）**: 本ベンチマークは **text_only モードのみ**を測定する（pdf_native は本番スキル `buildExtractDataUserPrompt` が text 専用のため今回スコープ外。§8.4-4・§9 #8 参照）。

### 8.1 src/ 本番コードの再利用（プロンプト・判定ロジックの二重管理を避ける）

| 責務 | 再利用する本番コード |
|---|---|
| プロンプト構築・構造化出力スキーマ・応答パース | [src/features/extraction/skills/extractData.ts](../../src/features/extraction/skills/extractData.ts)（`EXTRACT_DATA_SYSTEM_PROMPT` は現行の版数 1 を凍結して使う。ベンチマーク中はプロンプトを変更しない） |
| 応答検証 | [src/features/extraction/validateAiOutput.ts](../../src/features/extraction/validateAiOutput.ts)（破棄行は §4.0 のとおり不正解として計上） |
| quote アンカリング | [src/features/anchoring/](../../src/features/anchoring/)（`normalizeText` / `locateQuote` / `fuzzyMatch` / `anchorQuote`） |
| LLM 呼び出し | [src/lib/llm/](../../src/lib/llm/) の `createProvider`（`providerFactory` がモデル ID から Gemini / OpenRouter を解決）+ `withRetry`（+ `withLogging` のプロンプト版数記録、`pricing.ts` の `estimateCostUsd`）。Qwen は `OpenRouterProvider`、Gemini 2 モデルは `GeminiProvider` に自動振り分け |
| PDF テキスト層抽出 | anchor-spike の `src/extract-text.ts` 構成を流用（Node + pdfjs-dist legacy ビルド。@napi-rs/canvas 等は不要。ブラウザ出力との一致は spike H4 で 3,471 文字完全一致を確認済み） |

### 8.2 独立 package 構成（anchor-spike と同様）

```
experiments/extraction-benchmark/
├── README.md            # 本ファイル（事前登録。承認記録を追記）
├── REPORT.md            # 結果・採用モデル・判断根拠（実行後に作成）
├── package.json         # tsx / typescript / dotenv / pdfjs-dist のみ（承認後に作成）
├── tsconfig.json        # 同上
├── .env                 # GEMINI_API_KEY + OPENROUTER_API_KEY（コミットしない。下記 8.3）
├── gold/                # ゴールドスタンダード {pdf_id}.json（ユーザー作成）
├── src/
│   ├── runner.ts        # モデル × 論文 × モード × 反復の実行（npx tsx src/runner.ts）
│   └── score.ts         # 突合・集計 → REPORT 素材
└── outputs/
    ├── runs/            # LLM 生リクエスト / レスポンス + usageMetadata（コミットする）
    └── scores/          # モデル × 論文 × 項目の採点 JSON + 集計
```

- `experiments/` は jest のカバレッジ対象外（test-strategy.md §2）。本体の `npm test` / webpack ビルドを巻き込まない
- src/ コードの取り込み方法（相対 import で足りるか、tsconfig の paths が要るか）はランナー実装時に決めて REPORT に記録する

### 8.3 API キー

`experiments/extraction-benchmark/.env` に `GEMINI_API_KEY`（Gemini 2 モデル用）と `OPENROUTER_API_KEY`（Qwen 用。OpenRouter の BYOK）を置く。**リポジトリの [.gitignore](../../.gitignore) の `.env` パターン（16 行目）がサブディレクトリにも効くことを `git check-ignore` で確認済み**（`.gitignore` の追記は不要）。

### 8.4 手順（チェックポイント）

1. **チェックポイント 1（本 README のユーザー承認）** — §9 のチェックリスト回答をもって §3〜§7 を凍結 ← **いまここ**
2. ゴールドスタンダード作成（ユーザー。§6.3）— ランナー実装（3）と並行可
3. モデルのスナップショット ID 確認・固定（§3）→ 本 README の表を更新
4. ランナー実装 + 実行（2 論文 × **text_only モードのみ** × 3 反復 × 3 モデル = 18 run）。**pdf_native は今回スコープ外**（2026-07-04 決定。本番スキル `buildExtractDataUserPrompt` が text 専用のため。Q3 の最終確定はパイロットで行う建付けは変えない）。REPORT には「pdf_native は範囲外」と明記する
5. 採点・集計 → REPORT.md（全モデルの指標と採用判断。anchor-spike/REPORT.md のトンマナ）
6. **確定の反映**（別コミット）: pricing.ts の固定 ID 化 / タスク C の工場出荷値 / requirements.md Q8 を解決済みに / CLAUDE.md の注記更新

## 9. ユーザー承認チェックリスト（2026-07-04 全項目承認済み）

| # | 論点 | 提案 | 回答 |
|---|---|---|---|
| 1 | 比較対象モデル | `gemini-3.5-flash` / `gemini-3.1-flash-lite` / `qwen/qwen3-235b-a22b-2507` の 3 種（§3。Gemini 2 + OpenRouter 1。スナップショット ID / 実行時単価があればそれに固定） | ✅ 承認 |
| 2 | pricing.ts 追記 | `gemini-3.1-flash-lite` を `MODEL_PRICING` に追記する（現状未収載。単価は実行前に確認。§3 の注記） | ✅ 承認 |
| 3 | 足切り閾値 | not_reported 特異度 ≥ 92%・重大エラー率 ≤ 3%（CESAR 出発点）・anchor 成功率 ≥ 90%（§5 手順 1） | ✅ 承認 |
| 4 | 同等マージン | 項目レベル正確度の差 **X = 5 ポイント**以内は「同等」とみなしコストで選ぶ（§5 手順 2） | ✅ 承認 |
| 5 | タイブレーク順 | 同等群では 実測コスト → anchor 成功率 → 応答時間（§5 手順 3） | ✅ 承認 |
| 6 | コスト上限 | **$5**（概算 $0.67 の余裕込み。§7） | ✅ 承認 |
| 7 | ゴールドスタンダード | ユーザーが手作業で作成（§6.3 の JSON スキーマ・§6.2 の 20 項目案で確定してよいか。所要目安 2〜3 h × 2 論文） | ✅ 承認 |
| 8 | 主解析モード | ~~text_only を主解析、pdf_native は副次~~ → **2026-07-04 確定: text_only のみ測定・pdf_native はスコープ外**（§8.4-4） | ✅ 承認 |

**全項目承認済み（2026-07-04）**。§8.4 のステップ 2 以降・[IMPLEMENTATION.md](IMPLEMENTATION.md) の手順に着手可。実装の詳細はそちらを参照。
