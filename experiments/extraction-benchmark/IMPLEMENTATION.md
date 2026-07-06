# 抽出精度ベンチマーク 実装指示書（ジュニア SE 向け）

- **対象読者**: 本リポジトリで初めて作業する実装者（ジュニア想定）
- **前提**: [README.md](README.md)（事前登録・凍結済み仕様）はユーザー承認済み。本書は「その仕様をどう実装するか」の作業手順であり、**評価指標・採用基準・データセットの定義は README が正典**。数値や採点定義に迷ったら必ず README §4〜§7 に戻ること（本書で仕様を複製しない）。
- **スコープ確定事項（2026-07-04 ユーザー決定）**: 本ベンチマークは **text_only モードのみ**を測定する。pdf_native は本番スキル（`buildExtractDataUserPrompt`）が text 専用のため今回スコープ外。REPORT.md には「pdf_native は範囲外（Q3 の最終確定はパイロットで行う建付けを維持）」と明記する。
- **作業原則（[CLAUDE.md](../../CLAUDE.md) / remaining-work-plan.md §0）**: ①`master` で作業しない・ブランチを切る ②ドキュメント/コメント/コミットは日本語 ③API キー・生トークンをログ/REPORT/チャットに出さない ④`experiments/` は jest カバレッジ対象外 — 本体の `npm test` / webpack を巻き込まない ⑤**承認前の逸脱は禁止**。実装中に仕様の穴を見つけたら勝手に決めず報告する。

---

## 0. 全体像（何を作るのか）

3 モデル × 2 論文 × 3 反復（= 18 回）の LLM 抽出を回し、人手のゴールドスタンダードと突合して README §4 の指標を出し、README §5 の採用基準で既定モデルを 1 つ選ぶ。作るものは次の 4 スクリプトだけ:

```
experiments/extraction-benchmark/
├── README.md              # 事前登録（既存・凍結）
├── IMPLEMENTATION.md      # 本書
├── REPORT.md              # 【成果物】結果・採用判断（最後に書く）
├── package.json           # 【作る】tsx 実行環境（§2）
├── tsconfig.json          # 【作る】同上
├── .env                   # 【作る】APIキー（コミット禁止・§2）
├── gold/                  # 【ユーザー作成】ゴールドスタンダード {pdf_id}.json（§3）
├── schema/
│   └── benchmark-schema.json   # 【作る】20項目スキーマ（§4）
├── src/
│   ├── config.ts          # 【作る】対象論文・モデル・パスの定義（§5）
│   ├── extractText.ts     # 【作る】PDF → ページ別テキスト（§6）
│   ├── loadSchema.ts      # 【作る】schema JSON → 本番 SchemaField 形状（§7）
│   ├── runner.ts          # 【作る】LLM 実行 → outputs/runs/（§8）
│   └── score.ts           # 【作る】突合・集計 → outputs/scores/（§9）
└── outputs/
    ├── textlayer/         # extractText.ts の出力（コミット可）
    ├── runs/              # LLM 生 req/res + usageMetadata（コミットする）
    └── scores/            # 採点・集計 JSON（コミットする）
```

**設計の肝（README §8.1）**: プロンプト・応答検証・アンカリング・LLM 呼び出しは **`src/` の本番コードをそのまま import する**。ベンチマーク独自に書き直さない（プロンプト二重管理を防ぐため）。tsx は `.ts` を直接 import できるので、相対パスで本番モジュールを読める。

---

## 1. 事前準備（着手前に 1 回だけ）

```bash
# 1. ブランチを切る（master で作業しない）
git switch -c feature/extraction-benchmark

# 2. PDF fixture を取得（未取得なら）
pwsh -NoProfile -File tests/fixtures/pdf/fetch-pdfs.ps1
ls tests/fixtures/pdf/    # PMC10715657_*.pdf と PMC10766786_*.pdf が出れば OK
```

- Node.js ≥ 18（`fetch` がグローバルで使える。anchor-spike と同条件）。
- 本番コードが `zod` に依存する（`validateAiOutput` 経由）。リポジトリルートの `node_modules` に既にあるので、experiments 側で入れ直す必要はない（tsx はルートの node_modules も解決する）。念のため §10 の疎通確認を先に通すこと。

---

## 2. package.json / tsconfig.json / .env

anchor-spike の構成をそのまま踏襲する（[experiments/anchor-spike/package.json](../anchor-spike/package.json) / [tsconfig.json](../anchor-spike/tsconfig.json) 参照）。

**`package.json`**:

```jsonc
{
  "name": "extraction-benchmark",
  "private": true,
  "version": "0.1.0",
  "description": "抽出精度ベンチマーク（README.md 参照。Q8 既定モデル確定）",
  "type": "module",
  "scripts": {
    "extract-text": "tsx src/extractText.ts",
    "run": "tsx src/runner.ts",
    "score": "tsx src/score.ts"
  },
  "devDependencies": {
    "dotenv": "^17.4.2",
    "pdfjs-dist": "^6.1.200",
    "tsx": "^4.22.4",
    "typescript": "^6.0.3"
  }
}
```

**`tsconfig.json`**: anchor-spike のものをそのままコピーで良い（`module: NodeNext` / `strict: true` / `noEmit: true`）。

**`.env`**（このディレクトリ直下。**コミット禁止**）:

```
GEMINI_API_KEY=（Gemini の API キー。gemini-3.5-flash / gemini-3.1-flash-lite 用）
OPENROUTER_API_KEY=（OpenRouter の API キー。qwen 用）
```

- `.gitignore` の `.env` パターンがサブディレクトリにも効くことは README §8.3 で確認済み。念のため実装前に `git check-ignore experiments/extraction-benchmark/.env` が当該パスを返すことを確認する。
- **キーはコード・ログ・REPORT に絶対出さない**。ログに出す必要が生じたら `key.substring(0,8)+'...'`。

```bash
cd experiments/extraction-benchmark
npm install
```

---

## 3. ゴールドスタンダード（ユーザー作成物の受け取り）

`gold/{pdf_id}.json`（`gold/udca.json` / `gold/thermocov.json`）は**ドメインエキスパート（ユーザー）が手作業で作る**。JSON スキーマと作成規約は **README §6.3 が正典**。ジュニア SE 側の責務は次の 2 つ:

1. **フォーマット検証スクリプトを用意して受け入れ検査する**（採点前に壊れたゴールドで走らせない）。`src/score.ts` の冒頭で最低限を検証してもよいし、独立の `src/validateGold.ts` を作ってもよい。検証項目:
   - トップレベルに `pdf_id` / `schema_version` / `rows` がある
   - 各 row に `field_id` / `entity_key` / `not_reported`（boolean）がある
   - `field_id` が §4 の benchmark-schema.json に存在する
   - `not_reported: false` の row は `value_gold`（非 null）を持つ / `not_reported: true` の row は `value_gold: null`
   - `entity_key` が [requirements.md §3.3](../../docs/requirements.md) の形式（study は `-`、arm は `arm:n`…）。本番の `parseEntityKey`（`src/utils/entityKey.ts`）を import して検証すると規約と自動的に一致する
2. **ゴールド未着なら採点をブロックする**。ランナー（§8）はゴールドが無くても LLM 実行だけは走らせられる（並行作業のため）。採点（§9）はゴールドが揃ってから。

> ゴールド作成が遅れている場合の暫定策として、benchmark-schema の全 field × 各論文 2 arm を人手で埋める前に、まず 1 論文だけで §8→§9 のパイプラインを通しておくと、フォーマット不整合を早期に発見できる。

---

## 4. ベンチマークスキーマ（20 項目）

README §6.2 の 20 項目を JSON で作る。**anchor-spike の [mini-schema.json](../anchor-spike/schema/mini-schema.json)（15 項目 = f01〜f15）をそのままコピーし、f16〜f20 の 5 項目を追記する**（既存 15 項目の文言は変えない — スパイクとの比較可能性を保つ）。追記 5 項目の定義は README §6.2 の表のとおり:

| field_id | field_name | entity_level | data_type | extraction_instruction（英語で書く。既存項目と同トンマナ） |
|---|---|---|---|---|
| f16_arm_mean_age | arm_mean_age | arm | text | Mean (or median) age of participants in this arm, as reported in the baseline table. |
| f17_arm_percent_female | arm_percent_female | arm | text | Percentage (or number) of female participants in this arm, from the baseline table. |
| f18_follow_up_duration | follow_up_duration | study | text | Length of follow-up / study duration, as reported in the text. |
| f19_arm_n_analyzed | arm_n_analyzed | arm | integer | Number of participants analyzed in this arm (analysis set, not the number randomized). |
| f20_funding_source | funding_source | study | text | Source(s) of study funding. |

- ファイルは `schema/benchmark-schema.json`。形式は mini-schema.json と同じ（`{ schema_version: 1, fields: [...] }`、各 field は snake_case キー `field_id` / `field_name` / `entity_level` / `data_type` / `extraction_instruction`）。
- **注意（f19 のねらい）**: f19（分析数）は f10（ランダム化数）との取り違えを検出する項目。README §6.2 の意図なので消さない。

---

## 5. src/config.ts（定数の一元管理）

対象・モデル・パスをここに集約し、runner と score で共有する。**モデル ID は README §3 の確定 ID を使う**（承認後の最初の作業でスナップショット ID を確認して README の表を更新 → その値をここに反映）。

```ts
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const benchRoot = path.dirname(path.dirname(fileURLToPath(import.meta.url))); // extraction-benchmark/
export const repoRoot = path.resolve(benchRoot, '../..');

/** 対象論文（README §6.1）。file は tests/fixtures/pdf/ 配下の実ファイル名 */
export const TARGETS = [
  { pdfId: 'udca', file: 'PMC10715657_plosone_udca_rct.pdf' },
  { pdfId: 'thermocov', file: 'PMC10766786_frontmed_thermocov_rct.pdf' },
] as const;

/** 比較対象モデル（README §3）。id はスナップショット確認後に確定値へ差し替える */
export const MODELS = [
  { id: 'gemini-3.5-flash', keyEnv: 'GEMINI_API_KEY' },
  { id: 'gemini-3.1-flash-lite', keyEnv: 'GEMINI_API_KEY' },
  { id: 'qwen/qwen3-235b-a22b-2507', keyEnv: 'OPENROUTER_API_KEY' },
] as const;

export const REPEATS = 3; // README §7
```

- `keyEnv` を明示しておくと、`createProvider` が `/` で自動判定する provider と、runner が読む API キーの対応がずれない。
- **gemini-3.1-flash-lite は pricing.ts 未収載**（README §9 #2）。承認後、正規単価を確認して [src/lib/llm/pricing.ts](../../src/lib/llm/pricing.ts) の `MODEL_PRICING` に 1 行追記してから実行する。これを忘れると `estimateCostUsd` が null を返し、コスト集計が欠ける。

---

## 6. src/extractText.ts（PDF → ページ別テキスト）

anchor-spike の [extract-text.ts](../anchor-spike/src/extract-text.ts) を**ほぼそのままコピー**。変更点は出力先を本ディレクトリの `outputs/textlayer/{pdf_id}.json` にすることと、`TARGETS` を `config.ts` から import すること。

- pdfjs-dist は Node では **legacy ビルド**を使う: `import { getDocument, version } from 'pdfjs-dist/legacy/build/pdf.mjs'`（型が効かないので `// @ts-ignore`）。
- 出力 JSON は `{ pdfId, pages: [{ page, text }, ...] }`。ページ本文は `[PAGE n]` 連結ではなく**ページ配列のまま**保存する（runner が `ExtractDataPage[]` にそのまま渡す）。
- ブラウザ出力との一致は anchor-spike で検証済み（同 REPORT H4）。ここで新たに検証は不要。

```bash
npm run extract-text   # outputs/textlayer/udca.json, thermocov.json が出る
```

---

## 7. src/loadSchema.ts（snake_case JSON → 本番 SchemaField）

**ここが唯一の"変換"作業**。benchmark-schema.json は snake_case（`field_id` 等）だが、本番の `buildExtractDataUserPrompt` / `validateAiOutput` が受ける [SchemaField](../../src/domain/schemaField.ts) は camelCase で、追加フィールド（`fieldIndex` / `section` / `fieldLabel` / `unit` / `allowedValues` / `required` / `example` / `aiGenerated` / `note`）を持つ。欠けるとプロンプト構築で落ちるので、既定値で埋める:

```ts
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import type { SchemaField, EntityLevel, FieldDataType } from '../../../src/domain/schemaField';
import { benchRoot } from './config';

interface RawField {
  field_id: string;
  field_name: string;
  entity_level: EntityLevel;
  data_type: FieldDataType;
  extraction_instruction: string;
}

export async function loadBenchmarkSchema(): Promise<SchemaField[]> {
  const raw = await readFile(path.join(benchRoot, 'schema', 'benchmark-schema.json'), 'utf8');
  const parsed = JSON.parse(raw) as { schema_version: number; fields: RawField[] };
  return parsed.fields.map((f, i) => ({
    schemaVersion: parsed.schema_version,
    fieldId: f.field_id,
    fieldIndex: i,                       // 配列順 = 表示順
    section: '',                         // ベンチマークでは未使用
    fieldName: f.field_name,
    fieldLabel: f.field_name,            // 表示名は未使用なので field_name を流用
    entityLevel: f.entity_level,
    dataType: f.data_type,
    unit: null,
    allowedValues: null,
    required: true,
    extractionInstruction: f.extraction_instruction,
    example: null,
    aiGenerated: false,
    note: null,
  }));
}
```

- import パスは実際のディレクトリ深さに合わせる（`src/loadSchema.ts` から `src/domain/schemaField.ts` へは `../../../src/domain/schemaField`）。深さを間違えると tsx が解決できないので、§10 の疎通確認で最初に潰す。
- `fieldIndex` は配列順で振れば十分（プロンプトの項目順に効くだけ）。

---

## 8. src/runner.ts（LLM 実行 → outputs/runs/）

**本番コードを最大限再利用する**中核。1 回の実行 = (model, pdfId, repeat) の組。各実行で:

1. `buildExtractDataUserPrompt({ fields, pages })` でユーザープロンプト構築
2. `createProvider({ apiKey, model }).chat(messages, { temperature: 0, responseSchema: EXTRACT_DATA_RESPONSE_SCHEMA })` で呼び出し
3. `parseExtractDataResponse(text, fields)` で検証（`{ items, rejected }`）
4. `items` の各 quote を `normalizeText` → `anchorQuote` でアンカリング
5. 生 req/res + usageMetadata + 検証結果 + anchor 結果を `outputs/runs/{model}__{pdfId}__r{n}.json` に保存

再利用する本番モジュールと import 元:

| 使うもの | import 元 |
|---|---|
| `buildExtractDataUserPrompt` / `EXTRACT_DATA_SYSTEM_PROMPT` / `EXTRACT_DATA_RESPONSE_SCHEMA` / `parseExtractDataResponse` | [src/features/extraction/skills/extractData.ts](../../src/features/extraction/skills/extractData.ts) |
| `createProvider` | [src/lib/llm/providerFactory.ts](../../src/lib/llm/providerFactory.ts) |
| `normalizeText` / `anchorQuote` | [src/features/anchoring/normalizeText.ts](../../src/features/anchoring/normalizeText.ts) / [anchorQuote.ts](../../src/features/anchoring/anchorQuote.ts) |
| `estimateCostUsd` | [src/lib/llm/pricing.ts](../../src/lib/llm/pricing.ts) |
| `SchemaField` 型 | [src/domain/schemaField.ts](../../src/domain/schemaField.ts) |
| `NormalizedPage` 型 | [src/domain/anchor.ts](../../src/domain/anchor.ts) |

スケルトン（要点のみ。エラーハンドリングと保存は埋める）:

```ts
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import dotenv from 'dotenv';
import {
  buildExtractDataUserPrompt,
  EXTRACT_DATA_SYSTEM_PROMPT,
  EXTRACT_DATA_RESPONSE_SCHEMA,
  parseExtractDataResponse,
  EXTRACT_DATA_PROMPT_VERSION,
  type ExtractDataPage,
} from '../../../src/features/extraction/skills/extractData';
import { createProvider } from '../../../src/lib/llm/providerFactory';
import { normalizeText } from '../../../src/features/anchoring/normalizeText';
import { anchorQuote } from '../../../src/features/anchoring/anchorQuote';
import { estimateCostUsd } from '../../../src/lib/llm/pricing';
import type { NormalizedPage } from '../../../src/domain/anchor';
import { benchRoot, TARGETS, MODELS, REPEATS } from './config';
import { loadBenchmarkSchema } from './loadSchema';

dotenv.config({ path: path.join(benchRoot, '.env'), quiet: true });

async function loadPages(pdfId: string): Promise<ExtractDataPage[]> {
  const raw = await readFile(path.join(benchRoot, 'outputs', 'textlayer', `${pdfId}.json`), 'utf8');
  return (JSON.parse(raw) as { pages: ExtractDataPage[] }).pages;
}

// 正規化済みページを 1 回だけ作って quote アンカリングで使い回す
function toNormalizedPages(pages: ExtractDataPage[]): NormalizedPage[] {
  return pages.map((p) => ({ page: p.page, text: normalizeText(p.text) }));
}

async function main(): Promise<void> {
  const fields = await loadBenchmarkSchema();
  const outDir = path.join(benchRoot, 'outputs', 'runs');
  await mkdir(outDir, { recursive: true });

  for (const model of MODELS) {
    const apiKey = process.env[model.keyEnv];
    if (!apiKey) throw new Error(`${model.keyEnv} が .env にありません（model=${model.id}）`);
    const provider = createProvider({ apiKey, model: model.id });

    for (const target of TARGETS) {
      const pages = await loadPages(target.pdfId);
      const normPages = toNormalizedPages(pages);
      const userPrompt = buildExtractDataUserPrompt({ fields, pages });

      for (let r = 1; r <= REPEATS; r++) {
        const runId = `${model.id.replace('/', '__')}__${target.pdfId}__r${r}`;
        const t0 = Date.now();
        const res = await provider.chat(
          [
            { role: 'system', content: EXTRACT_DATA_SYSTEM_PROMPT },
            { role: 'user', content: userPrompt },
          ],
          { temperature: 0, responseSchema: EXTRACT_DATA_RESPONSE_SCHEMA },
        );
        const elapsedMs = Date.now() - t0;

        const parsed = parseExtractDataResponse(res.text, fields); // { items, rejected }

        // 各 item の quote をアンカリング
        const anchored = parsed.items.map((item) => {
          const normQuote = item.quote ? normalizeText(item.quote) : '';
          const anchor = normQuote
            ? anchorQuote(normQuote, normPages, item.page)
            : null; // quote なしは anchor 対象外（指標(3)の分母から除外される）
          return { ...item, anchor };
        });

        await writeFile(
          path.join(outDir, `${runId}.json`),
          JSON.stringify(
            {
              runId, model: model.id, pdfId: target.pdfId, repeat: r,
              promptVersion: EXTRACT_DATA_PROMPT_VERSION,
              executedAt: new Date().toISOString(),
              elapsedMs,
              tokensIn: res.tokensIn, tokensOut: res.tokensOut,
              costUsd: estimateCostUsd(model.id, res.tokensIn, res.tokensOut),
              rejected: parsed.rejected,   // 破棄行（§4.0 で不正解として計上）
              items: anchored,
              rawResponse: res.raw,        // 監査・再現用（CC BY 論文なので本文断片保存 OK）
            },
            null, 1,
          ),
          'utf8',
        );
        console.log(`${runId}: items=${anchored.length} rejected=${parsed.rejected.length} ${elapsedMs}ms`);
        await new Promise((s) => setTimeout(s, 2000)); // レート制限への儀礼的ウェイト
      }
    }
  }
}

await main();
```

実装上の注意:

- **リトライ/レート制限**: 本番 `GeminiProvider` / `OpenRouterProvider` が 429/5xx をどう扱うか実装を確認する。もし内蔵していなければ、runner 側で `try/catch` して 429・5xx は数秒待って最大 3 回まで再試行し、失敗したらその run を `error` フラグ付きで保存して**握りつぶさず先へ進む**（作業原則 6）。3 反復あるので 1 反復落ちても集計は続く。
- **`parseExtractDataResponse` は JSON パース不能時に `AiOutputFormatError` を投げる**。これはバッチ全体失敗に相当するので、その run は「全 field 欠落 = 全行不正解」として採点側で扱えるよう、`items: []` + `formatError: <message>` を保存する。
- **temperature 0 でも応答は揺れる**ため 3 反復。集計は 3 反復をプールする（README §7）。
- `rawResponse` は必ず保存してコミットする（README §2-4 の再現性要件）。**ただし API キーは `res.raw` に含まれない**ことを確認（ヘッダはレスポンスに乗らない。念のため保存 JSON を grep して `GEMINI_API_KEY` の値が入っていないか確認）。

```bash
npm run extract-text && npm run run   # outputs/runs/*.json が 18 本
```

---

## 9. src/score.ts（突合・集計 → REPORT 素材）

`outputs/runs/*.json` と `gold/*.json` を突合し、README §4 の指標を計算する。**採点定義は README §4.0〜§4.2 が正典**。ここでは実装の順序だけ示す。

### 9.1 突合の単位とルール（README §4.0）

- **評価単位** = ゴールドの 1 行（`field_id` × `entity_key`）。
- AI 側は 3 反復ぶんの run がある。**反復はプールする**（README §7）が、指標は「反復ごとに 1 スコアを出して 3 反復平均」でも「全反復の行を合算」でも README と整合すれば良い。**推奨: 反復ごとに (model, pdfId, repeat) 単位で指標を出し、model 単位で 3 反復 × 2 論文を平均**する（反復間ばらつきも算出でき、REPORT に載せられる）。
- AI 行の突合キー: `field_id` + `entity_key`。ゴールド行に対応する AI 行が無い（欠落）＝不正解。
- **arm 番号ずれ**（README §4.0）: AI とゴールドで `arm:1`/`arm:2` が逆になることがある。まず `entity_key` 完全一致で突合し、arm レベルで一致行が異常に少ない run は `arm_label`（f09）の値で人手対応付けを検討し、**ずれの有無を REPORT に記録する**（自動で入れ替えず、まず記録）。
- **値一致判定**（README §4.0）: `normalizeText` で正規化後、`value_gold` **または** `acceptable_values` のいずれかと完全一致で正解。順序揺れ（`14/54 (25.9%)` vs `25.9% (14/54)`）は acceptable_values 側で吸収する前提。

### 9.2 指標の計算（README §4.1 主指標 / §4.2 補助）

各 (model, pdfId, repeat) で下表を数える。分母・分子の定義は **README の表をそのまま実装する**:

| 指標 | 実装メモ |
|---|---|
| (1) 項目レベル正確度 | 「報告あり行で値一致」+「gold not_reported 行で AI も not_reported」を正解として、gold 全行で割る |
| (2a) not_reported 感度 | gold `not_reported=true` の行のうち AI も not_reported とした割合 |
| (2b) not_reported 特異度 | gold 報告あり行のうち AI が値を返した（not_reported=false）割合 |
| (3) quote アンカリング成功率 | AI 行のうち `anchor.status ∈ {exact, normalized, fuzzy}` を、**quote 非 null の AI 行数**で割る（gold ではなく AI 行が母数。README §4.1 (3) の定義） |
| 重大エラー率（補助） | gold 報告あり行で AI が別の値（acceptable_values にも一致しない）を返した割合 |
| verbatim 率（補助） | `exact + normalized` を quote 非 null 行で割る |
| コスト・応答時間（補助） | run JSON の `costUsd` / `elapsedMs` |

- **not_reported の突合**: AI 行が「その field_id × entity_key で not_reported=true」を返したか。AI が該当行を返さず欠落した場合は「not_reported と主張していない」扱い（＝感度の分子に入れない。README §4.0「欠落は不正解」）。
- 出力は `outputs/scores/{model}.json`（反復別 + 3 反復平均 + 反復間 SD）と、全モデル横断の `outputs/scores/summary.json`。

### 9.3 採用判断（README §5）

`summary.json` を人が読んで README §5 の 4 手順を適用する（**スクリプトで自動採用しない**。閾値ギリギリの判断や arm ずれの解釈が入るため、集計は機械・採用判断は人+REPORT）:

1. 手順 1: 足切り（特異度 ≥92% / 重大エラー率 ≤3% / anchor ≥90%）を満たすモデルだけ残す
2. 手順 2: 正確度（指標1）で降順、最上位との差 ≤5 ポイントを「同等」
3. 手順 3: 同等群はコスト最小 →（±20% 以内なら）anchor 成功率 → 応答時間 でタイブレーク
4. 手順 4: 全モデル足切り落ちなら保留し定性分析

```bash
npm run score   # outputs/scores/*.json
```

---

## 10. 疎通確認（実装の最初にやる — API を叩く前）

**本番コードを import できるか**を、LLM を呼ぶ前に潰しておく。`src/smoke.ts` を一時的に作り、次を確認:

```ts
import { buildExtractDataUserPrompt, EXTRACT_DATA_RESPONSE_SCHEMA } from '../../../src/features/extraction/skills/extractData';
import { createProvider } from '../../../src/lib/llm/providerFactory';
import { normalizeText } from '../../../src/features/anchoring/normalizeText';
import { loadBenchmarkSchema } from './loadSchema';

const fields = await loadBenchmarkSchema();
console.log('fields:', fields.length);                        // 20 が出れば schema OK
const pages = [{ page: 1, text: 'The trial randomized 100 neonates.' }];
const prompt = buildExtractDataUserPrompt({ fields, pages }); // 例外なく文字列が返れば import OK
console.log('prompt chars:', prompt.length);
console.log('normalize:', normalizeText('ｆｕｌｌ　ｗｉｄｔｈ'));  // 半角化されれば anchoring OK
console.log('schema keys:', Object.keys(EXTRACT_DATA_RESPONSE_SCHEMA));
// createProvider は new するだけ（chat は呼ばない = API 課金なし）
console.log('provider:', createProvider({ apiKey: 'dummy', model: 'gemini-3.5-flash' }).providerId);
```

`npx tsx src/smoke.ts` が全部通れば、import パス・型・スキーマ整合の初期不良は解消。これが通ってから §8 で本物の API を叩く。**smoke.ts はコミット前に消す**。

---

## 11. 実行順（承認後の全体フロー）

```
[1] モデルのスナップショット ID 確認 → README §3 の表と config.ts を更新
[2] gemini-3.1-flash-lite を pricing.ts の MODEL_PRICING に追記（単価確認後）
[3] §2 で package.json / tsconfig / .env → npm install
[4] §4 benchmark-schema.json 作成（mini-schema コピー + f16〜f20）
[5] §5〜§7 config / extractText / loadSchema 実装
[6] §10 smoke.ts で import 疎通確認（API なし）
[7] npm run extract-text（テキスト層抽出。API なし）
    ── ここまで API 課金ゼロ。ここで一度コミットしておくと安全 ──
[8] （ゴールドが揃ったら / 並行して）§8 runner 実装 → npm run run（★API 課金発生。コスト上限 $5 監視）
[9] §9 score 実装 → npm run score
[10] REPORT.md 執筆（全指標 + 採用判断 + arm ずれ等の逸脱記録）
[11] 確定の反映（別コミット。remaining-work-plan.md タスク D「確定の反映」）:
     - pricing.ts を採用モデルの固定 ID で最新化
     - タスク C の既定モデル工場出荷値を採用モデルへ
     - requirements.md Q8 → 解決済み（日付・採用モデル・根拠は REPORT.md）
     - CLAUDE.md の Q8 注記を解決済みに
```

**コスト監視**: 実行前に「モデル数 × 論文数 × 反復 × トークン概算」で見積もり（README §7 では 3 モデル計 ≈ $0.11、上限 $5）。走行中に累計コスト（各 run の `costUsd` 合計）が $5 に近づいたら**中断して報告**（作業原則 6）。

## 12. 完了条件（README §8 / remaining-work-plan.md タスク D）

- [ ] `outputs/runs/` に 18 run（3 モデル × 2 論文 × 3 反復）の生 req/res + usageMetadata がコミットされている
- [ ] `outputs/scores/summary.json` に全モデルの README §4 指標が揃っている
- [ ] REPORT.md に採用モデルと §5 手順に沿った判断根拠、arm ずれ等の逸脱記録がある
- [ ] 既定モデルが本体コード（pricing.ts / タスク C 工場出荷値）とドキュメント（requirements.md Q8 / CLAUDE.md）に反映され、Q8 が解決済み
- [ ] API キーが outputs/ / REPORT / コミットに漏れていない（`git grep` で確認）
