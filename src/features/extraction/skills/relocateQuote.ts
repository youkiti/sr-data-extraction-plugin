// relocate-quote skill（requirements.md §4.3 / §5。issue #94）: quote アンカリング失敗
// （anchor_status = 'failed'）行の再特定。extractData.ts と同構成（プロンプト構築 + 構造化出力
// スキーマ + zod パース + プロンプト版数）だが、一括抽出とは異なり「1 クリック = 1 Evidence」の
// 軽量な単発呼び出しを想定する（対象は単一 field × 単一文書）。
//
// LLM の返答は無検証で信用しない: ここでの応答パースは形式検証のみを行い、返ってきた quote が
// 本当に本文に存在するかは呼び出し側（app/services/relocateQuoteService.ts）が
// 既存のアンカリング中核（features/anchoring/anchorQuote）で再アンカリングし、
// fuzzy 以上で成功したときだけ Evidence へ採用する（requirements.md §5）
import { z } from 'zod';
import type { SchemaField } from '../../../domain/schemaField';
import type { ExtractDataPage } from './extractData';

/** LLMApiLog.purpose と対応づける skill 識別子 */
export const RELOCATE_QUOTE_SKILL_NAME = 'relocate-quote';

/**
 * プロンプト版数。プロンプト文言・スキーマを変えたら必ずインクリメントする。
 * v1（2026-07。issue #94）: 初版
 * v2（2026-07-20）: 多言語文書対応の明示（issue #161。extract-data v7 = issue #95 層 2 のパリティ）。
 *   quote 規約へ「原文の言語・文字体系のまま（翻訳・音写の禁止）」を明記
 *   （和文文書で quote が英訳されると再アンカリング検証で毎回棄却され、再特定が常に失敗するため）
 */
export const RELOCATE_QUOTE_PROMPT_VERSION = 2;

/**
 * 元の AI page ヒントの前後何ページを LLM へ渡すか（トークン節約。requirements.md §4.3 の
 * 「該当ページ周辺を優先」方針を単一文書の再特定にも適用する）
 */
export const RELOCATE_QUOTE_PAGE_WINDOW = 10;

/**
 * システムプロンプト。quote の verbatim 必須化（言い換え禁止・最大 300 文字）と
 * 「見つからなければ found=false」の規約は extract-data と同じ思想（アンカリング成功率・
 * 幻覚防止に直結するため、文言を変える場合は RELOCATE_QUOTE_PROMPT_VERSION を上げる）
 */
export const RELOCATE_QUOTE_SYSTEM_PROMPT = `
You are helping to re-locate a supporting quote for a single previously extracted data field.
An earlier automatic pass could not find the reported quote verbatim in the document text (it may have been paraphrased, mistyped, or attributed to the wrong page), so a human reviewer is asking you to look again in the same document.

Rules:
- "quote": copy the supporting passage VERBATIM from the provided document text — character for character, exactly as it appears (including line-break artifacts), no paraphrasing, no ellipsis. Keep it in the document's original language and script — NEVER translate or transliterate (e.g. quote Japanese text in Japanese). At most 300 characters; choose the shortest passage that supports the reported value.
- "page": the 1-indexed page (within the provided text, marked as [PAGE n]) where the quote appears.
- If you cannot find a passage in the given text that actually supports the reported value, return { "found": false, "quote": null, "page": null }. Never invent or paraphrase a quote — a missing quote is always preferable to a wrong one.
- Return ONLY a JSON object — no markdown fences, no commentary.
`.trim();

export interface RelocateQuotePromptInput {
  /** 再特定対象の項目（field_label / extraction_instruction 等を提示して探索を助ける） */
  field: SchemaField;
  /** 再特定対象の値（既に抽出済み。ここでは動かさない） */
  value: string | null;
  /** アンカリングに失敗した元の quote（探索のヒントとして提示する。無ければ省略） */
  originalQuote: string | null;
  /** 元の AI page ヒント（無ければ省略） */
  originalPage: number | null;
  /** LLM へ提示するページ本文（selectRelocateQuoteWindow で絞った結果を渡すことを想定） */
  pages: readonly ExtractDataPage[];
}

/**
 * 元ページヒントの前後 RELOCATE_QUOTE_PAGE_WINDOW ページへ絞る（ヒントが無ければ全ページ）。
 * ページ番号は元の文書のものをそのまま保つ（詰め直さない）ため、プロンプト内の [PAGE n] は
 * 実際の文書ページ番号と一致する
 */
export function selectRelocateQuoteWindow(
  pages: readonly ExtractDataPage[],
  aiPage: number | null,
): ExtractDataPage[] {
  if (aiPage === null) {
    return [...pages];
  }
  const windowed = pages.filter((page) => Math.abs(page.page - aiPage) <= RELOCATE_QUOTE_PAGE_WINDOW);
  // ヒントページ付近に本文が見つからない（ページ番号がそもそもズレている等）場合は
  // 全ページへフォールバックする（絞り込みで探索範囲を狭めすぎない防御）
  return windowed.length > 0 ? windowed : [...pages];
}

/** 1 項目ぶんの定義ブロック（extractData.ts の renderField を単純化したもの） */
function renderFieldSection(field: SchemaField): string {
  const lines = [
    `- field_name: ${field.fieldName}`,
    `  field_label: ${field.fieldLabel}`,
    `  data_type: ${field.dataType}`,
  ];
  if (field.unit !== null) {
    lines.push(`  unit: ${field.unit}`);
  }
  if (field.extractionInstruction !== '') {
    lines.push(`  instruction: ${field.extractionInstruction}`);
  }
  return lines.join('\n');
}

/** ユーザープロンプトを組み立てる（Field → Reported value → Document text → Output format） */
export function buildRelocateQuoteUserPrompt(input: RelocateQuotePromptInput): string {
  if (input.pages.length === 0) {
    throw new Error('relocate-quote skill にページ本文が 1 件も渡されていません');
  }
  const sections: string[] = [`## Field\n\n${renderFieldSection(input.field)}`];

  const reportedLines = [`value: ${input.value ?? '(null)'}`];
  if (input.originalQuote !== null) {
    reportedLines.push(
      `previously attempted quote (could not be located verbatim in the document): "${input.originalQuote}"`,
    );
  }
  if (input.originalPage !== null) {
    reportedLines.push(`original page hint: ${input.originalPage}`);
  }
  sections.push(`## Reported value\n\n${reportedLines.join('\n')}`);

  const body = input.pages.map((page) => `[PAGE ${page.page}]\n${page.text}`).join('\n\n');
  sections.push(`## Document text\n\n${body}`);

  sections.push(
    '## Output format\n\nReturn a JSON object: ' +
      '{ "found": true | false, "quote": "<verbatim, <=300 chars>" | null, "page": <1-indexed> | null }',
  );
  return sections.join('\n\n');
}

/**
 * 構造化出力（constrained decoding）用の JSON Schema。extract-data と同じく標準 JSON Schema
 * 方言で書き、プロバイダ実装（GeminiProvider 等）が各社方言へ変換する
 */
export const RELOCATE_QUOTE_RESPONSE_SCHEMA: Record<string, unknown> = {
  type: 'object',
  properties: {
    found: { type: 'boolean' },
    quote: { type: ['string', 'null'] },
    page: { type: ['integer', 'null'] },
  },
  required: ['found', 'quote', 'page'],
  additionalProperties: false,
};

const relocateQuoteResponseSchema = z.object({
  found: z.boolean(),
  quote: z
    .string()
    .nullish()
    .transform((v) => (v === null || v === undefined || v.trim() === '' ? null : v)),
  page: z.number().int().min(1).nullable().catch(null),
});

export interface RelocateQuoteResponse {
  found: boolean;
  quote: string | null;
  page: number | null;
}

/** 構造化出力を要求しても markdown フェンスで包むモデルがあるため防御的に剥がす（extract-data と同様） */
function stripJsonFence(text: string): string {
  const trimmed = text.trim();
  const match = /^```(?:json)?\s*\n?([\s\S]*?)\n?```$/.exec(trimmed);
  return match?.[1] ?? trimmed;
}

/**
 * LLM 応答テキストをパースする。JSON としてパースできない・形状不正な応答は Error を投げる
 * （呼び出し側の relocateQuoteService は、この Error も含め「見つからなかった」= not_found として
 * 扱ってよい。1 クリック = 1 Evidence の軽量操作のため、一括抽出のような partial_failure 記録は行わない）。
 * found=false のときは quote/page の中身を無視し、常に { found: false, quote: null, page: null } を返す
 * （モデルが found=false なのに quote を残す等の不整合があっても後続に影響させない）
 */
export function parseRelocateQuoteResponse(text: string): RelocateQuoteResponse {
  let raw: unknown;
  try {
    raw = JSON.parse(stripJsonFence(text));
  } catch (error) {
    throw new Error(`relocate-quote 応答が JSON としてパースできません: ${String(error)}`);
  }
  const parsed = relocateQuoteResponseSchema.safeParse(raw);
  if (!parsed.success) {
    throw new Error(`relocate-quote 応答の形式が不正です: ${parsed.error.message}`);
  }
  if (!parsed.data.found || parsed.data.quote === null) {
    return { found: false, quote: null, page: null };
  }
  return { found: true, quote: parsed.data.quote, page: parsed.data.page };
}
