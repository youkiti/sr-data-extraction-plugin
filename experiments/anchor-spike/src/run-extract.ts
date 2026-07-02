// ステップ 3: Gemini 抽出実行（2 PDF × 2 モード = 4 run）
// - pdf_native: PDF を base64 inline_data で直接送信
// - text_only: ステップ 1 のページ別テキストを [PAGE n] 区切りで送信
// リクエスト / レスポンスは outputs/runs/ に保存（API キーは保存しない。作業原則 5）
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';

const here = path.dirname(fileURLToPath(import.meta.url));
const spikeRoot = path.resolve(here, '..');
const repoRoot = path.resolve(spikeRoot, '../..');
dotenv.config({ path: path.join(repoRoot, '.env'), quiet: true });

const MODEL = 'gemini-3.1-flash-lite';
const ENDPOINT = `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent`;

const apiKey = process.env['GEMINI_API_KEY'];
if (!apiKey) {
  console.error('GEMINI_API_KEY がリポジトリルートの .env にありません');
  process.exit(1);
}

type Mode = 'pdf_native' | 'text_only';

interface SchemaField {
  field_id: string;
  field_name: string;
  entity_level: string;
  data_type: string;
  extraction_instruction: string;
}

interface EvidenceRow {
  run: string;
  pdfId: string;
  mode: Mode;
  field_id: string;
  entity_key: string;
  value: string | null;
  not_reported: boolean;
  quote: string | null;
  page: number | null;
  confidence: string;
}

const TARGETS = [
  { pdfId: 'udca', file: 'PMC10715657_plosone_udca_rct.pdf' },
  { pdfId: 'thermocov', file: 'PMC10766786_frontmed_thermocov_rct.pdf' },
] as const;
const MODES: Mode[] = ['pdf_native', 'text_only'];

// Gemini の responseSchema（§4.3 の出力契約をそのまま構造化出力で強制）
const RESPONSE_SCHEMA = {
  type: 'ARRAY',
  items: {
    type: 'OBJECT',
    properties: {
      field_id: { type: 'STRING' },
      entity_key: { type: 'STRING' },
      value: { type: 'STRING', nullable: true },
      not_reported: { type: 'BOOLEAN' },
      quote: { type: 'STRING', nullable: true },
      page: { type: 'INTEGER', nullable: true },
      confidence: { type: 'STRING', enum: ['high', 'medium', 'low'] },
    },
    required: ['field_id', 'entity_key', 'not_reported', 'confidence'],
  },
} as const;

async function loadPromptBody(): Promise<string> {
  const md = await readFile(path.join(spikeRoot, 'prompts', 'extract-data.md'), 'utf8');
  const parts = md.split(/\r?\n---\r?\n/);
  const body = parts[1];
  if (!body) throw new Error('prompts/extract-data.md の本文ブロックが見つからない');
  return body.trim();
}

interface PageJson {
  page: number;
  text: string;
}

async function loadPages(pdfId: string): Promise<PageJson[]> {
  const raw = await readFile(path.join(spikeRoot, 'outputs', 'textlayer', `${pdfId}.json`), 'utf8');
  return (JSON.parse(raw) as { pages: PageJson[] }).pages;
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
      console.warn(`  ${res.status} → ${wait}ms 待って再試行`);
      await sleep(wait);
      continue;
    }
    if (res.status === 400 && useResponseSchema) {
      // responseSchema 非対応の可能性 → responseMimeType のみで 1 回だけフォールバック
      console.warn('  400 with responseSchema → schema なしで再試行');
      return callGemini(parts, false);
    }
    if (!res.ok) throw new Error(`Gemini ${res.status}: ${text.slice(0, 500)}`);
    return { responseJson: JSON.parse(text), status: res.status, elapsedMs, usedResponseSchema: useResponseSchema };
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

async function main(): Promise<void> {
  const outDir = path.join(spikeRoot, 'outputs', 'runs');
  await mkdir(outDir, { recursive: true });

  const promptBody = await loadPromptBody();
  const schemaRaw = await readFile(path.join(spikeRoot, 'schema', 'mini-schema.json'), 'utf8');
  const schemaFields = (JSON.parse(schemaRaw) as { fields: SchemaField[] }).fields;
  const knownFieldIds = new Set(schemaFields.map((f) => f.field_id));
  const promptWithSchema = promptBody.replace('{{SCHEMA_JSON}}', JSON.stringify(schemaFields, null, 1));

  const allEvidence: EvidenceRow[] = [];

  for (const target of TARGETS) {
    for (const mode of MODES) {
      const runId = `${target.pdfId}_${mode}`;
      console.log(`--- run: ${runId} ---`);
      let parts: unknown[];
      let promptText: string;
      if (mode === 'pdf_native') {
        promptText = promptWithSchema.replace('{{DOCUMENT_INPUT}}', 'The article is attached as a PDF file.');
        const pdfBytes = await readFile(
          path.join(repoRoot, 'tests', 'fixtures', 'pdf', target.file),
        );
        parts = [
          { text: promptText },
          { inline_data: { mime_type: 'application/pdf', data: pdfBytes.toString('base64') } },
        ];
      } else {
        const pages = await loadPages(target.pdfId);
        const pageText = pages.map((p) => `[PAGE ${p.page}]\n${p.text}`).join('\n\n');
        promptText = promptWithSchema.replace(
          '{{DOCUMENT_INPUT}}',
          `The article text was extracted from the PDF page by page. Pages are delimited by markers of the form [PAGE n]. Use these markers to report the \`page\` number.\n\n${pageText}`,
        );
        parts = [{ text: promptText }];
      }

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

      // field_id がスキーマに無い要素は破棄（§4.3 の partial_failure 処理の原型）
      const evidence: EvidenceRow[] = [];
      let discarded = 0;
      for (const raw of rawRows) {
        const row = raw as Record<string, unknown>;
        if (typeof row['field_id'] !== 'string' || !knownFieldIds.has(row['field_id'])) {
          discarded++;
          continue;
        }
        evidence.push({
          run: runId,
          pdfId: target.pdfId,
          mode,
          field_id: row['field_id'],
          entity_key: typeof row['entity_key'] === 'string' ? row['entity_key'] : '-',
          value: typeof row['value'] === 'string' ? row['value'] : null,
          not_reported: row['not_reported'] === true,
          quote: typeof row['quote'] === 'string' ? row['quote'] : null,
          page: typeof row['page'] === 'number' ? row['page'] : null,
          confidence: typeof row['confidence'] === 'string' ? row['confidence'] : 'low',
        });
      }
      allEvidence.push(...evidence);

      const usage = (result.responseJson as { usageMetadata?: unknown }).usageMetadata ?? null;
      await writeFile(
        path.join(outDir, `${runId}.json`),
        JSON.stringify(
          {
            runId,
            model: MODEL,
            mode,
            pdfId: target.pdfId,
            executedAt: new Date().toISOString(),
            elapsedMs: result.elapsedMs,
            usedResponseSchema: result.usedResponseSchema,
            usageMetadata: usage,
            promptChars: promptText.length,
            parseError,
            rowCount: evidence.length,
            discardedRowCount: discarded,
            evidence,
            rawResponse: result.responseJson,
          },
          null,
          1,
        ),
        'utf8',
      );
      console.log(
        `  rows=${evidence.length} discarded=${discarded} elapsed=${result.elapsedMs}ms schema=${result.usedResponseSchema}${parseError ? ` parseError=${parseError}` : ''}`,
      );
      await sleep(2000); // レート制限への儀礼的ウェイト
    }
  }

  await writeFile(
    path.join(outDir, 'evidence-all.json'),
    JSON.stringify(allEvidence, null, 1),
    'utf8',
  );
  console.log(`全 run 完了: evidence 合計 ${allEvidence.length} 行 -> outputs/runs/evidence-all.json`);
}

await main();
