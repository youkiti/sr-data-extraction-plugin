// issue #307 の実 API 確認 T2（PLAN-20261004-issue307.md）: 質的研究 3 本で、複数選択の項目に
// 選択肢ごとの要素・引用・節が返り、本番の anchorQuote で照合できるかを見る。qualitativeProbe.ts から派生。
// 本番の extractData（プロンプト・構造化出力スキーマ・応答検証）と anchorQuote をそのまま使う。
// 入力 PDF の場所と対象は非公開のローカル設定で指定する。
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { loadLocalConfig } from './localConfig';
// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-ignore -- legacy ビルドは型解決が effective でないため
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';
import {
  buildExtractDataSystemPrompt,
  buildExtractDataUserContent,
  EXTRACT_DATA_PROMPT_VERSION,
  extractDataResponseSchema,
  parseExtractDataResponse,
  type ExtractDataPage,
} from '../../../src/features/extraction/skills/extractData';
import { EXTRACT_DATA_TEMPERATURE } from '../../../src/features/extraction/executeRun';
import { createProvider } from '../../../src/lib/llm/providerFactory';
import { normalizeText } from '../../../src/features/anchoring/normalizeText';
import { anchorQuote } from '../../../src/features/anchoring/anchorQuote';
import type { SchemaField } from '../../../src/domain/schemaField';
import { benchRoot } from './config';

const MODEL = 'gemini-3.8-flash';
const PDF_DIR = loadLocalConfig().probes.multiSelect.pdfDir;
const PAPERS = loadLocalConfig().probes.multiSelect.papers;
const OUT_DIR = path.join(benchRoot, 'outputs', 'multiselect-issue307');

interface FieldSpec {
  fieldId: string;
  fieldName: string;
  dataType: 'text' | 'enum';
  instruction: string;
  allowedValues?: string;
  multi?: { exclusiveValues: string[]; freeTextValues: string[] };
}

function field(spec: FieldSpec, fieldIndex: number): SchemaField {
  return {
    schemaVersion: 1,
    fieldId: spec.fieldId,
    fieldIndex,
    section: 'study',
    fieldName: spec.fieldName,
    fieldLabel: spec.fieldName,
    entityLevel: 'study',
    dataType: spec.dataType,
    unit: null,
    allowedValues: spec.allowedValues ?? null,
    required: true,
    extractionInstruction: spec.instruction,
    example: null,
    aiGenerated: false,
    note: null,
    maxQuotes: null,
    multiSelect: spec.multi ?? null,
  };
}

// 複数選択 3 項目 + 対照 2 項目（単一選択の enum・text）。PLAN-20261004-issue307.md の T2
const FIELDS: SchemaField[] = loadLocalConfig().probes.multiSelect.fields.map((spec, index) => field(spec, index + 1));

async function extractPages(file: string): Promise<ExtractDataPage[]> {
  const data = new Uint8Array(await readFile(file));
  const loadingTask = getDocument({ data, useSystemFonts: true });
  const doc = await loadingTask.promise;
  const pages: ExtractDataPage[] = [];
  for (let p = 1; p <= doc.numPages; p++) {
    const page = await doc.getPage(p);
    const content = await page.getTextContent();
    let text = '';
    for (const raw of content.items) {
      if (!('str' in raw)) continue;
      text += raw.str;
      if (raw.hasEOL) text += '\n';
    }
    pages.push({ page: p, text });
    page.cleanup();
  }
  await loadingTask.destroy();
  return pages;
}

async function main(): Promise<void> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (apiKey === undefined || apiKey === '') throw new Error('GEMINI_API_KEY が未設定');
  await mkdir(OUT_DIR, { recursive: true });
  const provider = createProvider({ apiKey, model: MODEL, fetch: (i, init) => fetch(i, { ...init, signal: AbortSignal.timeout(600_000) }) });
  for (const pmcid of PAPERS) {
    const outPath = path.join(OUT_DIR, `${pmcid}.json`);
    // 再開: 同じ版数で、通信エラー・形式エラーの無い記録だけを完了とみなす（壊れた JSON・失敗記録は再実行）
    let done = false;
    try {
      const prev = JSON.parse(await readFile(outPath, 'utf8')) as Record<string, unknown>;
      done =
        prev.promptVersion === EXTRACT_DATA_PROMPT_VERSION &&
        prev.transportError === undefined &&
        prev.formatError === null &&
        Array.isArray(prev.items);
    } catch {
      // 未実行または壊れた記録
    }
    if (done) {
      console.log(`${pmcid}: 完了済みのためスキップ`);
      continue;
    }
    const pages = await extractPages(path.join(PDF_DIR, `${pmcid}.pdf`));
    const normPages = pages.map((p) => ({ page: p.page, text: normalizeText(p.text) }));
    const userContent = buildExtractDataUserContent({
      fields: FIELDS,
      documents: [{ role: 'article', filename: `${pmcid}.pdf`, mode: 'text', pages }],
    });
    const t0 = Date.now();
    let record: Record<string, unknown>;
    try {
      // 本番 executeRun.processBatch と同じ呼び方（テキスト入力なので requestBox = false。出力上限は指定しない）
      const res = await provider.chat(
        [
          { role: 'system', content: buildExtractDataSystemPrompt(false) },
          { role: 'user', content: userContent },
        ],
        { temperature: EXTRACT_DATA_TEMPERATURE, responseSchema: extractDataResponseSchema(false) },
      );
      let parsed: ReturnType<typeof parseExtractDataResponse> | null = null;
      let formatError: string | null = null;
      try {
        parsed = parseExtractDataResponse(res.text, FIELDS, 1);
      } catch (error) {
        formatError = String(error);
      }
      const items = (parsed?.items ?? []).map((item) => {
        const q = item.quote === null ? '' : normalizeText(item.quote);
        return { ...item, anchor: q === '' ? null : anchorQuote(q, normPages, item.page) };
      });
      record = {
        pmcid,
        model: MODEL,
        promptVersion: EXTRACT_DATA_PROMPT_VERSION,
        executedAt: new Date().toISOString(),
        elapsedMs: Date.now() - t0,
        tokensIn: res.tokensIn ?? null,
        tokensOut: res.tokensOut ?? null,
        formatError,
        rejected: parsed?.rejected ?? [],
        items,
        rawText: res.text,
      };
    } catch (error) {
      // 通信・API のエラー。成功と区別して記録し、この論文は結果不明として扱う
      record = { pmcid, model: MODEL, executedAt: new Date().toISOString(), elapsedMs: Date.now() - t0, transportError: String(error).replace(apiKey, '<redacted>') };
    }
    await writeFile(outPath, JSON.stringify(record, null, 1), 'utf8');
    // 失敗は件数 0 に畳まず、状態を先に出す
    if (record.transportError !== undefined || record.formatError !== null) {
      console.log(`${pmcid}: 失敗 — ${String(record.transportError ?? record.formatError)}`);
      continue;
    }
    const items = record.items as Array<{ fieldId: string; value: string | null; quote: string | null; quoteTheme: string | null; quoteSeq: number | null; section: string | null; notReported: boolean; confidence: string | null; forcedLowReasons: string[]; anchor: { status: string } | null }>;
    for (const f of FIELDS) {
      const own = items.filter((i) => i.fieldId === f.fieldId);
      const quoted = own.filter((i) => i.quote !== null);
      console.log(
        `${pmcid} ${f.fieldName}: 要素 ${own.length} / 値 ${JSON.stringify(own[0]?.value ?? null)} / 選択肢 [${own.map((i) => i.quoteTheme ?? '-').join(' ; ')}] / 照合 [${quoted.map((i) => i.anchor?.status ?? 'none').join(',')}] / 節あり ${quoted.filter((i) => i.section !== null).length}/${quoted.length} / forcedLow [${[...new Set(own.flatMap((i) => i.forcedLowReasons))].join(',')}]`,
      );
    }
    console.log(`${pmcid}: 要素計 ${items.length} / rejected ${(record.rejected as unknown[]).length}`);
  }
}

await main();
