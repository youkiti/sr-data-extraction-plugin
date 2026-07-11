// 追試タスクA: プロンプトから期待値を排除した「未知値抽出＋位置」条件での bbox 検証。
// run-bbox.ts との違いは項目定義（ItemSpec.description）に一切の期待値ヒント（「52%のはず」等）を
// 書かないことのみ。呼び出し・パース・保存の骨格は run-bbox.ts を踏襲する。
// gold（正解値）はこのファイル内の GOLD テーブルにのみ保持し、プロンプトへは絶対に渡さない
// （プロンプトに登場するのは label と「答えを含まない」description だけ）。
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';

const here = path.dirname(fileURLToPath(import.meta.url));
const spikeRoot = path.resolve(here, '..');
const repoRoot = path.resolve(spikeRoot, '../..');
dotenv.config({ path: path.join(repoRoot, '.env'), quiet: true });

const MODEL = 'gemini-3.5-flash';
const ENDPOINT = `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent`;

const apiKey = process.env['GEMINI_API_KEY'];
if (!apiKey) {
  console.error('GEMINI_API_KEY がリポジトリルートの .env にありません');
  process.exit(1);
}

interface ItemSpec {
  label: string;
  /** 対象の説明。期待値・正解のヒントは一切書かない（本検証の核心） */
  description: string;
}

interface PageTarget {
  page: number;
  items: ItemSpec[];
}

// 前回 run-bbox.ts と同一の 8 項目・同一ページ配分（比較可能性のため）。
// 説明文からは数値・答えを全て除去し、「どこを見ればよいか」だけを示す。
const BLIND_TARGETS: PageTarget[] = [
  {
    page: 1,
    items: [
      { label: 'title', description: '論文タイトル（見出し全文。レイアウト上の大文字表記のまま）' },
      {
        label: 'first_author',
        description:
          '筆頭著者名（著者一覧の先頭の人物。氏名のみ、資格略称 RNC/DNSc/APRN 等は含めない）',
      },
      {
        label: 'final_response_rate',
        description: '抄録 RESULTS 内の "The final response rate was ..." に続く割合の値',
      },
    ],
  },
  {
    page: 4,
    items: [
      {
        label: 'comfort_final_cronbach_alpha',
        description: 'Table 1（Reliability data）の Comfort 行・Final sample (N=190) 列の Cronbach α 値',
      },
      {
        label: 'total_no_of_items',
        description: 'Table 1（Reliability data）の Total 行・Final sample (N=190) 列の No. of items 値',
      },
    ],
  },
  {
    page: 5,
    items: [
      {
        label: 'item1_percent',
        description:
          'Table 2 の Item No. 1「Allowing families to hold their dying or dead infant」行の % 列の値',
      },
      {
        label: 'item7_percent',
        description:
          'Table 2 の Item No. 7「Discussing autopsy or organ donation with families of dying infants」行の % 列の値',
      },
      {
        label: 'mean_comfort_score',
        description: '本文（Table 2 の下の段落）中の "mean score" に続く数値',
      },
    ],
  },
];

// gold（正解値）: プロンプトには絶対に渡さない。前回 run-bbox.ts の実測結果（outputs/runs/p{1,4,5}.json）
// から転記。value の照合はゆるく行う（数値は表記ゆれを許容、文字列は完全一致 or 部分一致）。
const GOLD: Record<string, { value: string; note?: string }> = {
  title: {
    value:
      "NEONATAL STAFF AND ADVANCED PRACTICE NURSES' PERCEPTIONS OF BEREAVEMENT/END-OF-LIFE CARE OF FAMILIES OF CRITICALLY ILL AND/OR DYING INFANTS",
  },
  first_author: { value: 'Arthur J. Engler' },
  final_response_rate: { value: '52', note: '52%' },
  comfort_final_cronbach_alpha: { value: '.95' },
  total_no_of_items: { value: '55' },
  item1_percent: { value: '98' },
  item7_percent: { value: '45' },
  mean_comfort_score: { value: '4.13' },
};

const RESPONSE_SCHEMA = {
  type: 'ARRAY',
  items: {
    type: 'OBJECT',
    properties: {
      label: { type: 'STRING' },
      value: { type: 'STRING' },
      quote: { type: 'STRING' },
      page: { type: 'INTEGER' },
      box_2d: {
        type: 'ARRAY',
        items: { type: 'INTEGER' },
      },
    },
    required: ['label', 'value', 'quote', 'page', 'box_2d'],
  },
} as const;

function buildPrompt(target: PageTarget): string {
  const itemLines = target.items.map((it) => `- label="${it.label}": ${it.description}`).join('\n');
  return `あなたはこの論文ページ画像（ページ ${target.page}）から、指定された項目の値を実際に読み取り、それぞれの値が書かれている領域を bounding box として返すタスクを行う。値はこちらから与えないので、画像から自分で探して読み取ること。

box_2d の形式は [ymin, xmin, ymax, xmax] とする。画像の左上を原点 (0,0) とし、各座標は画像の高さ・幅に対して 0〜1000 に正規化した整数値で表す（ymin/ymax が縦方向、xmin/xmax が横方向）。box は対象の文言・数値だけを過不足なく囲む最小の矩形にすること。

項目一覧:
${itemLines}

各項目について、次のフィールドを持つ JSON オブジェクトを1つずつ、項目と同じ順序で返すこと:
- "label": 上記の label をそのまま
- "value": 画像から実際に読み取った値（数値や固有名詞はそのまま、単位や%記号は付けない）
- "quote": box の中に実際に見える文言をそのまま（言い換えない）
- "page": ${target.page}
- "box_2d": [ymin, xmin, ymax, xmax]

出力は上記オブジェクトの配列のみ。項目が画像内に見つからない場合も box_2d には最も近いと思われる位置を返すこと（省略しない）。`;
}

/** run-bbox.ts と同一のロジック（末尾重複5要素→4要素復元）。比較可能性のため変更しない */
function normalizeBox(box: unknown): { box: number[] | null; recovered: boolean } {
  if (!Array.isArray(box) || !box.every((n) => typeof n === 'number')) {
    return { box: null, recovered: false };
  }
  if (box.length === 4) return { box: box as number[], recovered: false };
  if (box.length === 5 && box[3] === box[4]) {
    return { box: (box as number[]).slice(0, 4), recovered: true };
  }
  return { box: null, recovered: false };
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

interface CallResult {
  responseJson: unknown;
  status: number;
  elapsedMs: number;
  usedResponseSchema: boolean;
}

async function callGemini(parts: unknown[], useResponseSchema: boolean): Promise<CallResult> {
  const body = {
    contents: [{ role: 'user', parts }],
    generationConfig: {
      temperature: 0,
      responseMimeType: 'application/json',
      ...(useResponseSchema ? { responseSchema: RESPONSE_SCHEMA } : {}),
    },
  };
  for (let attempt = 1; ; attempt++) {
    const t0 = Date.now();
    const res = await fetch(ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey as string },
      body: JSON.stringify(body),
    });
    const elapsedMs = Date.now() - t0;
    const text = await res.text();
    if (res.status === 429 || res.status >= 500) {
      if (attempt >= 3) throw new Error(`Gemini ${res.status}（リトライ上限）: ${text.slice(0, 300)}`);
      const wait = 5000 * attempt;
      console.warn(`  ${res.status} -> ${wait}ms 待って再試行`);
      await sleep(wait);
      continue;
    }
    if (res.status === 400 && useResponseSchema) {
      console.warn('  400 with responseSchema -> schema なしで再試行');
      return callGemini(parts, false);
    }
    if (!res.ok) throw new Error(`Gemini ${res.status}: ${text.slice(0, 500)}`);
    return {
      responseJson: JSON.parse(text),
      status: res.status,
      elapsedMs,
      usedResponseSchema: useResponseSchema,
    };
  }
}

function extractResponseText(responseJson: unknown): string {
  const r = responseJson as {
    candidates?: Array<{ content?: { parts?: Array<{ text?: string }> }; finishReason?: string }>;
  };
  const cand = r.candidates?.[0];
  const text = cand?.content?.parts?.map((p) => p.text ?? '').join('') ?? '';
  if (!text) throw new Error(`応答にテキストがない（finishReason=${cand?.finishReason}）`);
  return text;
}

function redactRequestForSave(promptText: string): unknown {
  return {
    contents: [
      {
        role: 'user',
        parts: [
          { text: promptText },
          { inline_data: { mime_type: 'image/png', data: '<omitted: base64 image>' } },
        ],
      },
    ],
    generationConfig: {
      temperature: 0,
      responseMimeType: 'application/json',
      responseSchema: RESPONSE_SCHEMA,
    },
    note: 'API キーは x-goog-api-key ヘッダで送信（本ファイルには含めていない）。gold 正解値はプロンプトに含まれない',
  };
}

/** ゆるい正誤判定。数値は前後の空白・先頭の"."揺れを吸収、文字列は完全一致 or 部分一致を許容 */
function judgeValue(label: string, value: string | null): { correct: boolean; detail: string } {
  const gold = GOLD[label];
  if (!gold) return { correct: false, detail: 'gold未定義' };
  if (value === null) return { correct: false, detail: '値なし' };
  const norm = (s: string) => s.trim().toLowerCase().replace(/^0?\./, '.').replace(/%$/, '');
  const v = norm(value);
  const g = norm(gold.value);
  if (v === g) return { correct: true, detail: '完全一致' };
  // 文字列項目（title/first_author）は部分一致も許容
  if (g.length > 6 && (g.includes(v) || v.includes(g))) {
    return { correct: true, detail: '部分一致' };
  }
  return { correct: false, detail: `不一致 (got="${value}" gold="${gold.value}")` };
}

async function runTarget(target: PageTarget, outDir: string): Promise<void> {
  const runId = `p${target.page}`;
  console.log(`--- run(blind): ${runId} (items=${target.items.map((i) => i.label).join(',')}) ---`);
  const promptText = buildPrompt(target);
  const pngPath = path.join(spikeRoot, 'outputs', 'pages', `p${target.page}.png`);
  const pngBytes = await readFile(pngPath);
  const parts = [
    { text: promptText },
    { inline_data: { mime_type: 'image/png', data: pngBytes.toString('base64') } },
  ];

  const result = await callGemini(parts, true);
  const responseText = extractResponseText(result.responseJson);

  let rawRows: unknown[];
  let parseError: string | null = null;
  try {
    const parsed: unknown = JSON.parse(responseText);
    rawRows = Array.isArray(parsed) ? parsed : [];
    if (!Array.isArray(parsed)) parseError = '応答 JSON が配列でない';
  } catch (e) {
    rawRows = [];
    parseError = `JSON パース失敗: ${String(e)}`;
  }

  const knownLabels = new Set(target.items.map((i) => i.label));
  const rows: Array<{
    label: string;
    value: string | null;
    quote: string | null;
    page: number;
    box_2d: number[] | null;
    boxRecovered?: boolean;
    rawBox2d?: unknown;
    valueCorrect: boolean;
    valueJudgeDetail: string;
  }> = [];
  let discarded = 0;
  for (const raw of rawRows) {
    const row = raw as Record<string, unknown>;
    if (typeof row['label'] !== 'string' || !knownLabels.has(row['label'])) {
      discarded++;
      continue;
    }
    const { box: boxNums, recovered } = normalizeBox(row['box_2d']);
    const value = typeof row['value'] === 'string' ? row['value'] : null;
    const judge = judgeValue(row['label'], value);
    rows.push({
      label: row['label'],
      value,
      quote: typeof row['quote'] === 'string' ? row['quote'] : null,
      page: typeof row['page'] === 'number' ? row['page'] : target.page,
      box_2d: boxNums,
      ...(recovered ? { boxRecovered: true, rawBox2d: row['box_2d'] } : {}),
      valueCorrect: judge.correct,
      valueJudgeDetail: judge.detail,
    });
  }

  const usage = (result.responseJson as { usageMetadata?: unknown }).usageMetadata ?? null;
  await writeFile(
    path.join(outDir, `${runId}.json`),
    JSON.stringify(
      {
        runId,
        model: MODEL,
        page: target.page,
        requestedItems: target.items,
        executedAt: new Date().toISOString(),
        elapsedMs: result.elapsedMs,
        usedResponseSchema: result.usedResponseSchema,
        usageMetadata: usage,
        parseError,
        rowCount: rows.length,
        discardedRowCount: discarded,
        rows,
        request: redactRequestForSave(promptText),
        rawResponse: result.responseJson,
      },
      null,
      1,
    ),
    'utf8',
  );
  console.log(
    `  rows=${rows.length} discarded=${discarded} elapsed=${result.elapsedMs}ms schema=${result.usedResponseSchema}${parseError ? ` parseError=${parseError}` : ''}`,
  );
  for (const row of rows) {
    console.log(
      `    ${row.label}: value=${row.value} correct=${row.valueCorrect}(${row.valueJudgeDetail}) box_2d=${JSON.stringify(row.box_2d)}${row.boxRecovered ? ` (recovered from ${JSON.stringify(row.rawBox2d)})` : ''}`,
    );
  }
}

async function main(): Promise<void> {
  const outDir = path.join(spikeRoot, 'outputs', 'runs-blind');
  await mkdir(outDir, { recursive: true });

  let targets = BLIND_TARGETS;
  const pagesFilter = process.env['PAGES'];
  if (pagesFilter) {
    const pages = new Set(pagesFilter.split(',').map((s) => Number(s.trim())));
    targets = targets.filter((t) => pages.has(t.page));
  }
  console.log('=== BLIND モード（期待値をプロンプトから排除） ===');

  for (const target of targets) {
    await runTarget(target, outDir);
    await sleep(2000);
  }
  console.log('run-bbox-blind 完了');
}

await main();
