# 抽出精度ベンチマーク 結果報告（Q8: 既定モデル確定）

- **ステータス**: 🚧 **未実行（コード実装のみ完了）**。ランナー（§8）・採点（§9）は **API キー（`.env`）とゴールドスタンダード（`gold/*.json`）が揃い次第**実行する。本ファイルは実行後に確定値で埋める雛形。
- **スコープ**: **text_only モードのみ**（2026-07-04 ユーザー決定）。pdf_native は本番スキル `buildExtractDataUserPrompt` が text 専用のため**今回は範囲外**（Q3 の最終確定はパイロットで行う建付けを維持）。
- **事前登録**: [README.md](README.md)（v1.0・2026-07-04 承認済み）が指標・採用基準・データセットの正典。本報告は結果を README §4〜§5 の凍結定義で解釈する。

---

## 1. 実行条件（実行時に記入）

| 項目 | 値 |
|---|---|
| 実行日 | （YYYY-MM-DD） |
| プロンプト版数 | `EXTRACT_DATA_PROMPT_VERSION = 1`（凍結） |
| ベンチマークスキーマ | `schema/benchmark-schema.json`（20 項目・schema_version 1） |
| 対象論文 | udca（PMC10715657）/ thermocov（PMC10766786） |
| 反復 | 3（temperature 0） |
| テキスト層 | `outputs/textlayer/*.json`（udca 10p / 27,526 字・thermocov 14p / 62,948 字） |

### 1.1 モデルのスナップショット ID（実行直前に確認して記入 — README §3）

| 提案 ID | 確認後の固定 ID | 入力 $/1M | 出力 $/1M | 備考 |
|---|---|---|---|---|
| `gemini-3.5-flash` | （記入） | 0.15 | 0.60 | |
| `gemini-3.1-flash-lite` | （記入） | （要確認） | （要確認） | **pricing.ts 未収載 → 実行前に `MODEL_PRICING` へ追記**（README §9 #2） |
| `qwen/qwen3-235b-a22b-2507` | （固定版・サフィックス -2507） | 0.14 | 0.14 | 単価は openrouter.ai で実行時に再確認 |

---

## 2. 主指標（README §4.1）

各値は 3 反復 × 2 論文の平均（`outputs/scores/summary.json` 由来）。

| モデル | (1) 項目レベル正確度 | (2a) not_reported 感度 | (2b) not_reported 特異度 | (3) quote アンカリング成功率 |
|---|---|---|---|---|
| gemini-3.5-flash | | | | |
| gemini-3.1-flash-lite | | | | |
| qwen/qwen3-235b-a22b-2507 | | | | |

## 3. 補助指標（README §4.2）

| モデル | 重大エラー率 | verbatim 率 | 実測コスト（3 反復 × 2 論文合計 / 平均） | 平均応答時間 | 正確度の反復間 SD |
|---|---|---|---|---|---|
| gemini-3.5-flash | | | | | |
| gemini-3.1-flash-lite | | | | | |
| qwen/qwen3-235b-a22b-2507 | | | | | |

---

## 4. 採用判断（README §5 の手順を人手で適用）

- **手順 1（足切り）**: 特異度 ≥ 92% / 重大エラー率 ≤ 3% / anchor 成功率 ≥ 90% を満たすモデル → （記入）
- **手順 2（順位・同等マージン）**: 正確度（指標1）降順、最上位との差 ≤ 5 ポイントを「同等」 → （記入）
- **手順 3（同等群の選定）**: 実測コスト最小 →（±20% 以内なら）anchor 成功率 → 応答時間 → （記入）
- **手順 4（全落ち時）**: 保留 + 定性分析（該当時のみ）

### 4.1 採用モデル

> **（記入）**。根拠は上表と手順 1〜3。

---

## 5. 逸脱・特記事項（README §2-2）

- **pdf_native は範囲外**（2026-07-04 決定）。本ベンチマークは text_only のみを測定した。
- **arm 番号ずれ**（README §4.0）: `outputs/scores/{model}.json` の `missingGoldRows` / `extraAiRows` を確認し、AI とゴールドで `arm:1`/`arm:2` が逆転した run があれば列挙する。自動入れ替えはせず記録する → （記入）
- **その他の凍結後逸脱**（あれば）: （記入）

---

## 6. 確定の反映（別コミット。remaining-work-plan.md タスク D「確定の反映」）

採用モデル確定後に実施:

- [ ] `src/lib/llm/pricing.ts` を採用モデルの固定 ID + 実行時単価で最新化
- [ ] タスク C（Options 既定モデル設定）の工場出荷値を採用モデルへ
- [ ] `docs/requirements.md` Q8 → 解決済み（日付・採用モデル・根拠は本 REPORT）
- [ ] `CLAUDE.md` の Q8 注記を解決済みに
