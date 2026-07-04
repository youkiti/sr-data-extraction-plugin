# 抽出精度ベンチマーク REPORT（プレースホルダ）

> ⚠️ **未実行（ベンチマーク本走行前）**。本ファイルは実装完了時点のプレースホルダであり、
> 記載されている指標欄・採用判断はすべて **実行後に記入する空欄** です。数値は一切捏造していません。
> 実際の走行には API キー（Gemini / OpenRouter）・ゴールドスタンダード（`gold/udca.json` /
> `gold/thermocov.json`）・`npm install` 済みの実行環境が必要で、今回の実装環境にはこれらが
> 揃っていないため本走行していません。実装（コード一式）は完了しています。

## 0. スコープ

- 本ベンチマークは **text_only モードのみ**を測定する（2026-07-04 ユーザー決定。README.md §8.4-4 / IMPLEMENTATION.md 冒頭）。
- **pdf_native は範囲外**。本番スキル `buildExtractDataUserPrompt`（`src/features/extraction/skills/extractData.ts`）が
  text 専用のため今回は測定しない。pdf_native の是非（Q3 の最終確定）はパイロット運用時に別途判断する建付けを維持する。
- 対象論文・モデル・指標・採用基準の定義はすべて [README.md](README.md)（事前登録・凍結済み）に従う。本 REPORT はその実行結果を記録する。

## 1. 指標サマリ（README.md §4 の主指標・補助指標。実行後に記入）

### 1.1 主指標（README.md §4.1）

| モデル | (1) 項目レベル正確度 | (2a) not_reported 感度 | (2b) not_reported 特異度 | (3) quote アンカリング成功率 |
|---|---|---|---|---|
| `gemini-3.5-flash` | （実行後に記入） | （実行後に記入） | （実行後に記入） | （実行後に記入） |
| `gemini-3.1-flash-lite` | （実行後に記入） | （実行後に記入） | （実行後に記入） | （実行後に記入） |
| `qwen/qwen3-235b-a22b-2507` | （実行後に記入） | （実行後に記入） | （実行後に記入） | （実行後に記入） |

### 1.2 補助指標（README.md §4.2）

| モデル | 重大エラー率 | verbatim 率 | 実測コスト（USD） | 平均応答時間（ms） |
|---|---|---|---|---|
| `gemini-3.5-flash` | （実行後に記入） | （実行後に記入） | （実行後に記入） | （実行後に記入） |
| `gemini-3.1-flash-lite` | （実行後に記入） | （実行後に記入） | （実行後に記入） | （実行後に記入） |
| `qwen/qwen3-235b-a22b-2507` | （実行後に記入） | （実行後に記入） | （実行後に記入） | （実行後に記入） |

- 反復間ばらつき（SD、3 反復）: （実行後に記入。`outputs/scores/{model}.json` の `overall.sd` 参照）
- arm 番号ずれの疑いフラグ: （実行後に記入。`outputs/scores/{model}.json` の `armMismatchFlags` を人手確認して記録）

## 2. 採用判断（README.md §5 手順。実行後に記入）

1. 手順1（足切り: 特異度 ≥92% / 重大エラー率 ≤3% / anchor 成功率 ≥90%）を満たしたモデル: （実行後に記入）
2. 手順2（正確度で降順・最上位との差 ≤5 ポイントを「同等」とみなす）: （実行後に記入）
3. 手順3（同等群のタイブレーク: コスト → anchor 成功率 → 応答時間）: （実行後に記入）
4. 手順4（全滅時の定性分析）: （該当する場合のみ記入）

**採用モデル**: （実行後に記入）
**採用理由**: （実行後に記入。手順のどこで確定したかを明記）

## 3. 逸脱・特記事項（実行後に記入）

- モデル ID のスナップショット確認結果（README.md §3 の注記どおり実施したか）: （記入）
- arm 番号ずれの具体的な発生箇所・人手対応付けの結果: （記入）
- その他、README.md 凍結後の逸脱があれば理由とともに記入（README.md §2 の原則2）: （記入）

## 4. 残作業（ユーザー側ランブック）

この環境では API キー・課金・ゴールドスタンダードが用意できないため、実装のみ完了しコードは未実行です。
本走行には以下の手順を人手で実施してください（IMPLEMENTATION.md §11 と対応）:

1. `experiments/extraction-benchmark/.env` を作成し、`GEMINI_API_KEY` / `OPENROUTER_API_KEY` を記入する（`.env.example` 参照。コミット禁止）。
2. モデルのスナップショット ID を確認し、必要であれば `README.md` §3 の表と `src/config.ts` の `MODELS` を確定 ID へ更新する。
3. `src/lib/llm/pricing.ts` の `MODEL_PRICING` に `gemini-3.1-flash-lite` の単価を追記する（現状未収載。`src/config.ts` の該当箇所に TODO コメントあり）。
4. ゴールドスタンダード `gold/udca.json` / `gold/thermocov.json` を作成し（README.md §6.3 の規約）、`npm run validate-gold` で検証する。
5. `npm install` → `npm run extract-text` → `npm run run`（★API 課金発生。コスト上限 $5 を `runner.ts` が監視するが、実行中の進捗も目視すること）→ `npm run score`。
6. 本 REPORT.md の §1〜§3 に実際の指標・採用判断・arm ずれ等の逸脱記録を記入する。
7. 確定の反映（別コミット。remaining-work-plan.md タスク D「確定の反映」）:
   - `src/lib/llm/pricing.ts` を採用モデルの固定 ID で最新化する。
   - タスク C（Options 既定モデル設定）の工場出荷値を採用モデルへ変更する。
   - `docs/requirements.md` Q8 を「解決済み」に更新する（日付・採用モデル・根拠は本 REPORT を参照させる）。
   - `CLAUDE.md` の Q8 注記を解決済みに更新する。

## 5. IMPLEMENTATION.md §12 完了条件チェックリスト（この環境での状況）

| # | 完了条件 | この環境での状況 |
|---|---|---|
| 1 | `outputs/runs/` に 18 run（3 モデル × 2 論文 × 3 反復）の生 req/res + usageMetadata がコミットされている | **未達**（API キー・課金が無いため本走行していない。`runner.ts` は実装済みで、いつでも実行可能） |
| 2 | `outputs/scores/summary.json` に全モデルの README §4 指標が揃っている | **未達**（`score.ts` は実装済み。run と gold が揃えば `npm run score` で生成される） |
| 3 | REPORT.md に採用モデルと §5 手順に沿った判断根拠、arm ずれ等の逸脱記録がある | **未達**（本ファイルは空欄プレースホルダ。§1〜§3 は実行後に記入） |
| 4 | 既定モデルが本体コード（pricing.ts / タスク C 工場出荷値）とドキュメント（requirements.md Q8 / CLAUDE.md）に反映され、Q8 が解決済み | **未達**（本タスクのスコープ外。§4 の手順7で別途実施） |
| 5 | API キーが outputs/ / REPORT / コミットに漏れていない（`git grep` で確認） | **達成可能な範囲で確認済み**（outputs/ は空のプレースホルダのみで API キーを含む内容は存在しない。`.env` は作成しておらず `.env.example` のみ。runner.ts はキーをログに出力しない設計） |

実装（ファイル一式）は完了しています。API キー・ゴールドスタンダードが揃い次第、上記ランブックに従って本走行し、本 REPORT を実データで更新してください。
