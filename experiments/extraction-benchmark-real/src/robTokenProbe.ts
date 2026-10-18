// issue #61 の実 API 確認: RoB signaling question を全出力させたとき、出力トークン制約に当たるか。
//
// 本番と同じ経路を Node で再現する:
//   - fields  = 本番の RoB テンプレート（src/features/schema/presets/robTemplates.ts）をそのまま SchemaField 化
//   - 計画    = 本番の planRun（section 分割の判断込み）
//   - 呼び出し = 本番の executeRun と同じく **maxOutputTokens を指定しない**（provider 既定の上限に委ねる）
//   - 検証    = 本番の parseExtractDataResponse
//
// これにより「planRun の section 分割だけで RoB SQ 全出力が収まるか / 1 study 複数回コールが要るか」を
// 実測で判断する。★API 課金が発生。
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { loadLocalConfig } from './localConfig';
import dotenv from 'dotenv';
import {
  buildExtractDataSystemPrompt,
  buildExtractDataUserContent,
  EXTRACT_DATA_PROMPT_VERSION,
  extractDataResponseSchema,
  parseExtractDataResponse,
  type ExtractDataPage,
} from '../../../src/features/extraction/skills/extractData';
import { planRun } from '../../../src/features/extraction/planRun';
import { ROB_TEMPLATES } from '../../../src/features/schema/presets/robTemplates';
import type { SchemaEditorRow } from '../../../src/features/schema/types';
import type { SchemaField } from '../../../src/domain/schemaField';
import type { DocumentRecord } from '../../../src/domain/document';
import { createProvider } from '../../../src/lib/llm/providerFactory';
import { LlmProviderError, type ChatMessage } from '../../../src/lib/llm/LLMProvider';
import { estimateCostUsd } from '../../../src/lib/llm/pricing';
import { benchRoot, repoRoot } from './config';
import { loadBenchmarkSchema } from './loadSchema';

dotenv.config({ path: [path.join(benchRoot, '.env'), path.join(repoRoot, '.env')], quiet: true });

const MODEL = process.env.PROBE_MODEL ?? 'gemini-3.5-flash';
const OUT_DIR = path.join(benchRoot, 'outputs', 'rob-token-probe');
/** コスト上限（概算）。到達したら中断する */
const COST_LIMIT_USD = 3;

async function loadPages(pdfId: string): Promise<ExtractDataPage[]> {
  const raw = await readFile(path.join(benchRoot, 'outputs', 'textlayer', `${pdfId}.json`), 'utf8');
  return (JSON.parse(raw) as { pages: ExtractDataPage[] }).pages;
}

/** RoB テンプレート行（SchemaEditorRow）を SchemaField へ。fieldIndex は startIndex から連番 */
function toFields(rows: readonly SchemaEditorRow[], startIndex: number): SchemaField[] {
  return rows.map((row, i) => ({
    schemaVersion: 1,
    fieldId: `f_${row.fieldName}`,
    fieldIndex: startIndex + i,
    section: row.section,
    fieldName: row.fieldName,
    fieldLabel: row.fieldLabel,
    entityLevel: row.entityLevel,
    dataType: row.dataType,
    unit: row.unit,
    allowedValues: row.allowedValues,
    required: row.required,
    extractionInstruction: row.extractionInstruction,
    example: row.example,
    aiGenerated: row.aiGenerated,
    note: row.note,
    maxQuotes: null,
    multiSelect: null,
  }));
}

function makeDocument(pdfId: string, chars: number, pages: number): DocumentRecord {
  return {
    documentId: `doc_${pdfId}`,
    studyId: `st_${pdfId}`,
    documentRole: 'article',
    driveFileId: 'drive_dummy',
    sourceFileId: null,
    filename: `${pdfId}.pdf`,
    pmid: null,
    doi: null,
    textRef: 'text_dummy',
    textStatus: 'ok',
    pageCount: pages,
    charCount: chars,
    importedAt: '2026-08-02T00:00:00.000Z',
    importedBy: 'probe',
    note: null,
    excluded: false,
    exclusionReason: null,
    exclusionNote: null,
    excludedAt: null,
  };
}

interface CallResult {
  caseId: string;
  pdfId: string;
  section: string | null;
  fieldCount: number;
  /** planRun の出力トークン概算（この値が 8,000 を超えると section 分割へ落ちる） */
  tokensOutEstimate: number;
  tokensIn: number | null;
  tokensOut: number | null;
  finishReason: string | null;
  /** provider が投げた例外（MAX_TOKENS 打ち切りはここに出る） */
  error: string | null;
  formatError: string | null;
  items: number;
  rejected: number;
  elapsedMs: number;
  costUsd: number | null;
}

let totalCost = 0;
const results: CallResult[] = [];

/** 1 バッチ = 1 API 呼び出し。executeRun と同じく maxOutputTokens は渡さない */
async function runBatch(
  caseId: string,
  pdfId: string,
  pages: ExtractDataPage[],
  fields: readonly SchemaField[],
  section: string | null,
  tokensOutEstimate: number,
): Promise<void> {
  const apiKey = process.env['GEMINI_API_KEY'] ?? '';
  if (apiKey === '') throw new Error('GEMINI_API_KEY が .env にありません');
  const provider = createProvider({ apiKey, model: MODEL });
  const messages: ChatMessage[] = [
    { role: 'system', content: buildExtractDataSystemPrompt(false) },
    {
      role: 'user',
      content: buildExtractDataUserContent({
        fields,
        documents: [{ role: 'article', filename: `${pdfId}.pdf`, mode: 'text', pages }],
      }),
    },
  ];

  const t0 = Date.now();
  let text: string | null = null;
  let tokensIn: number | null = null;
  let tokensOut: number | null = null;
  let finishReason: string | null = null;
  let error: string | null = null;
  let raw: unknown = null;
  try {
    // ★本番 executeRun.ts:602 と同一（temperature + responseSchema のみ。maxOutputTokens なし）
    const res = await provider.chat(messages, { temperature: 0, responseSchema: extractDataResponseSchema(false) });
    text = res.text;
    tokensIn = res.tokensIn;
    tokensOut = res.tokensOut;
    raw = res.raw;
    finishReason =
      (raw as { candidates?: { finishReason?: string }[] } | null)?.candidates?.[0]?.finishReason ?? null;
  } catch (err) {
    error = err instanceof LlmProviderError ? `${err.status ?? 'n/a'}: ${err.message}` : String(err);
    // 打ち切り時も usage が取れることがあるため raw から拾う
    const detail = (err as { raw?: unknown }).raw;
    if (detail !== undefined) raw = detail;
  }
  const elapsedMs = Date.now() - t0;

  let items = 0;
  let rejected = 0;
  let formatError: string | null = null;
  if (text !== null) {
    try {
      const parsed = parseExtractDataResponse(text, fields, 1);
      items = parsed.items.length;
      rejected = parsed.rejected.length;
    } catch (err) {
      formatError = err instanceof Error ? err.message : String(err);
    }
  }

  const costUsd = estimateCostUsd(MODEL, tokensIn, tokensOut);
  totalCost += costUsd ?? 0;
  const result: CallResult = {
    caseId,
    pdfId,
    section,
    fieldCount: fields.length,
    tokensOutEstimate,
    tokensIn,
    tokensOut,
    finishReason,
    error,
    formatError,
    items,
    rejected,
    elapsedMs,
    costUsd,
  };
  results.push(result);
  await writeFile(
    path.join(OUT_DIR, `${caseId}__${pdfId}__${(section ?? 'all').replace(/[^\w]/g, '_')}.json`),
    JSON.stringify({ ...result, promptVersion: EXTRACT_DATA_PROMPT_VERSION, model: MODEL, raw }, null, 1),
    'utf8',
  );
  const flag = error ? ' ★ERROR' : formatError ? ' ★FORMAT_ERROR' : '';
  console.log(
    `  ${caseId} / ${pdfId} / section=${section ?? '(全項目1バッチ)'}: ` +
      `fields=${fields.length} 概算out=${tokensOutEstimate} 実out=${tokensOut ?? '-'} ` +
      `finish=${finishReason ?? '-'} items=${items} rejected=${rejected} ${elapsedMs}ms${flag}`,
  );
  if (error) console.log(`      error: ${error}`);
  if (formatError) console.log(`      formatError: ${formatError.slice(0, 200)}`);
}

/** planRun を通して（= 本番と同じ分割判断で）バッチごとに実行する */
async function runCase(
  caseId: string,
  pdfId: string,
  pages: ExtractDataPage[],
  fields: readonly SchemaField[],
): Promise<void> {
  const chars = pages.reduce((sum, p) => sum + p.text.length, 0);
  const doc = makeDocument(pdfId, chars, pages.length);
  const plan = planRun({ documents: [doc], fields, model: MODEL });
  console.log(
    `\n[${caseId}] ${pdfId}: fields=${fields.length} → batches=${plan.batches.length} ` +
      `(概算 in=${plan.tokensInEstimate} out=${plan.tokensOutEstimate})`,
  );
  for (const w of plan.warnings) console.log(`  warning: ${w}`);
  const byId = new Map(fields.map((f) => [f.fieldId, f]));
  for (const batch of plan.batches) {
    const batchFields = batch.fieldIds.map((id) => byId.get(id)).filter((f): f is SchemaField => f !== undefined);
    await runBatch(caseId, pdfId, pages, batchFields, batch.section, batch.tokensOutEstimate);
    if (totalCost >= COST_LIMIT_USD) throw new Error(`コスト上限 $${COST_LIMIT_USD} に到達`);
  }
}

async function main(): Promise<void> {
  await mkdir(OUT_DIR, { recursive: true });
  const dataFields = await loadBenchmarkSchema();

  const rob2Sq = toFields(ROB_TEMPLATES.rob2_sq, 1000);
  const robinsISq = toFields(ROB_TEMPLATES.robins_i_sq, 2000);
  const quadas3 = toFields(ROB_TEMPLATES.quadas3, 3000);
  const quips = toFields(ROB_TEMPLATES.quips, 4000);

  console.log(`モデル: ${MODEL} / prompt v${EXTRACT_DATA_PROMPT_VERSION}`);
  console.log(
    `テンプレート行数: rob2_sq=${rob2Sq.length} robins_i_sq=${robinsISq.length} ` +
      `quadas3=${quadas3.length} quips=${quips.length} / 抽出スキーマ=${dataFields.length}`,
  );
  for (const [name, fs] of [
    ['rob2_sq', rob2Sq],
    ['robins_i_sq', robinsISq],
    ['quadas3', quadas3],
    ['quips', quips],
  ] as const) {
    const sections = [...new Set(fs.map((f) => f.section))];
    console.log(`  ${name}: sections=${sections.join(', ')}`);
  }

  const targets = (process.env.PROBE_TARGETS ?? loadLocalConfig().probes.robTargets.join(',')).split(',').map((s) => s.trim());
  const cases = (process.env.PROBE_CASES ?? 'rob2_only,data_plus_rob2,robins_i_only').split(',').map((s) => s.trim());

  for (const pdfId of targets) {
    const pages = await loadPages(pdfId);
    if (cases.includes('rob2_only')) {
      await runCase('rob2_only', pdfId, pages, rob2Sq);
    }
    if (cases.includes('data_plus_rob2')) {
      await runCase('data_plus_rob2', pdfId, pages, [...dataFields, ...rob2Sq]);
    }
    if (cases.includes('robins_i_only')) {
      await runCase('robins_i_only', pdfId, pages, robinsISq);
    }
    if (cases.includes('quadas3_only')) {
      await runCase('quadas3_only', pdfId, pages, quadas3);
    }
    if (cases.includes('quips_only')) {
      await runCase('quips_only', pdfId, pages, quips);
    }
    // planRun の分割を通さず「抽出スキーマ + RoB SQ を 1 コール」に押し込む最悪ケース。
    // provider 既定の出力上限がどこで効くか（MAX_TOKENS 打ち切りの有無）を測る
    if (cases.includes('forced_single')) {
      const fields = [...dataFields, ...rob2Sq];
      const chars = pages.reduce((sum, p) => sum + p.text.length, 0);
      const est = planRun({ documents: [makeDocument(pdfId, chars, pages.length)], fields, model: MODEL });
      console.log(`\n[forced_single] ${pdfId}: fields=${fields.length}（planRun なら ${est.batches.length} 分割のところを 1 コール）`);
      await runBatch('forced_single', pdfId, pages, fields, null, est.tokensOutEstimate);
    }
  }

  console.log('\n=== まとめ ===');
  for (const r of results) {
    console.log(
      `${r.caseId}\t${r.pdfId}\t${r.section ?? '(all)'}\tfields=${r.fieldCount}\t` +
        `out概算=${r.tokensOutEstimate}\tout実測=${r.tokensOut ?? '-'}\tfinish=${r.finishReason ?? '-'}\t` +
        `items=${r.items}\t${r.error ? 'ERROR' : r.formatError ? 'FORMAT_ERROR' : 'ok'}`,
    );
  }
  console.log(`累計コスト概算 $${totalCost.toFixed(4)}`);
  await writeFile(path.join(OUT_DIR, '_summary.json'), JSON.stringify({ model: MODEL, results }, null, 1), 'utf8');
}

await main();
