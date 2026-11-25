import type { Label } from './evaluationSet';
import type { RecheckLabel } from './recheck';

export const LABELS: Label[] = ['reported', 'derivable', 'different_value', 'not_in_documents'];
const record = (value: unknown): Record<string, unknown> | null => value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null;
export function normalized(text: string): string {
  const spaced = text.replace(/[‐‑‒–—−]/g, '-').replace(/[\s\u0085\u001c-\u001f]+/gu, ' ').trim();
  // 大文字化を挟んで合字も展開する。点なし i と Cherokee は casefold の例外。
  return Array.from(spaced, (char) => char === 'ı' ? char : /[\u13a0-\u13f5\u13f8-\u13fd\uab70-\uabbf]/u.test(char) ? char.toUpperCase() : char.toUpperCase().toLowerCase()).join('').replace(/ß/g, 'ss');
}
export const quoteInText = (quote: string, text: string) => !!normalized(quote) && text.includes(normalized(quote));
function numberText(value: unknown): string | null {
  if (value === null || value === undefined || typeof value === 'boolean') return null;
  let text = String(value).trim().replace(/(?<=\d)·(?=\d)/g, '.').replace(/[‐‑‒–—−]/g, '-');
  if (/^-?\d{1,3}(,\d{3})+(\.\d+)?$/.test(text)) text = text.replace(/,/g, '');
  return /^[+-]?(\d+\.?\d*|\.\d+)$/.test(text) ? text : null;
}
export function toDecimal(value: unknown): string | null {
  const text = numberText(value);
  if (text === null) return null;
  const [whole = '', frac = ''] = text.replace(/^[+-]/, '').split('.');
  const body = (whole.replace(/^0+/, '') || '0') + (frac.replace(/0+$/, '') ? '.' + frac.replace(/0+$/, '') : '');
  return text.startsWith('-') && body !== '0' ? '-' + body : body;
}
export function textNumbers(text: string): Set<string> {
  const out = new Set<string>();
  for (const [token] of text.replace(/(?<=\d)·(?=\d)/g, '.').matchAll(/(?<![\d.,])\d{1,3}(?:,\d{3})+(?:\.\d+)?(?!\d)|\d+\.\d+|\d+|\.\d+/g)) {
    const parts = token.split(',');
    const readings = [token.replace(/,/g, ''), ...(parts.length === 2 && parts[0]!.length === 3 && !parts[1]!.includes('.') ? parts : [])];
    for (const reading of readings) { const number = toDecimal(reading); if (number !== null) out.add(number); }
  }
  return out;
}
export function quoteNumbers(text: string): Set<string> {
  const words = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten', 'eleven', 'twelve', 'thirteen', 'fourteen', 'fifteen', 'sixteen', 'seventeen', 'eighteen', 'nineteen', 'twenty'];
  const out = textNumbers(text);
  for (const [word] of text.toLowerCase().matchAll(/\b[a-z]+\b/g)) {
    if (['no', 'none', 'neither', 'nil'].includes(word)) out.add('0');
    else if (words.includes(word)) out.add(String(words.indexOf(word)));
  }
  return out;
}
function rounded(text: string, places: number, even: boolean): string {
  const negative = text.startsWith('-');
  const [whole = '0', frac = ''] = text.replace(/^[+-]/, '').split('.');
  const digits = whole + frac.padEnd(places, '0').slice(0, places);
  const tail = frac.slice(places);
  const up = tail[0] && (tail[0] > '5' || (tail[0] === '5' && (!even || /[1-9]/.test(tail.slice(1)) || Number(digits.at(-1)) % 2 === 1)));
  const result = (BigInt(digits || '0') + (up ? 1n : 0n)).toString().padStart(places + 1, '0');
  return toDecimal((negative ? '-' : '') + (places ? result.slice(0, -places) + '.' + result.slice(-places) : result))!;
}
export function matches(field: string, pred: unknown, target: unknown): boolean {
  const p = toDecimal(pred), g = toDecimal(target), raw = numberText(target);
  if (p === null || g === null || raw === null) return false;
  if (p === g) return true;
  if (['experimental_cases', 'experimental_n', 'control_cases', 'control_n', 'tp', 'fp', 'fn', 'tn'].includes(field)) return false;
  const places = raw.split('.')[1]?.length ?? 0;
  return rounded(p, places, false) === g || rounded(p, places, true) === g;
}

export const CHECK_PROMPT = `You are checking, for each number a systematic review entered in its meta-analysis data sheet, whether the reports of the included study actually state that number.

Input directory: {dir}
- check.json : the study name, the report file names, and {n_items} item(s). Each item describes one analysis (comparison, outcome, subgroup/time point, the label of the experimental group and of the control group) and lists the "fields" to judge. Each item lists only the field(s) to judge; other fields of the same analysis are not asked. An item may carry a "review_note": the review authors' own note about that row (for example the time point, or which arms were combined). The file may carry a "review_context" with the review's own text: "timing_rules" (which time point the review used when a study reports several) and "outcome_definitions" (the review's outcome definitions, which may state the time point per outcome); use it to pick the time point. "gold" holds the number the review entered for each field.
- {reports} : the study's report(s) as plain text.

The report texts are the PDF text layer that the extraction tool itself reads, one file per report, with a [PAGE n] line before each page. Tables are not marked up: a table appears as its cells in reading order, often split over several lines. Figures are not available and do not count: judge only from the text.

Rules:
1. Read ONLY the files in that directory (read long files in several chunks until the end; tables matter most). Do not open, list or search any other file or directory, do not run scripts, and do not use the web. Answer only from these report texts.
2. For every item and every field listed in the item's "fields", give one "label":
   - "reported": the reports state this number for this analysis (same outcome, groups and time point, as the item and its review_note describe them). "document_value" is that number.
   - "derivable": the reports do not print the number, but it follows by simple arithmetic a reviewer would do from numbers the reports state for this analysis (events from a percentage and N, SD from SE or a confidence interval, summing arms). "document_value" is the derived number.
   - "different_value": the reports state a number for this same analysis and it differs from the gold number. "document_value" is the number the reports state.
   - "not_in_documents": the reports give no number for this analysis for this field (for example the report is a protocol, a different sub-study, or reports the outcome only for another time point or population). "document_value" is null.
3. The gold number alone is never evidence: the label describes what the reports say.
4. For every label except "not_in_documents", also give "report_file" (one of the listed files) and "quote": ONE contiguous passage copied character for character from that file, at most 300 characters, that contains the number(s) used (a run of table cells as they appear in the text, or a sentence). Never stitch two passages together and never retype a table row from memory. For "not_in_documents", "report_file" and "quote" are null.
5. Give each "document_value" as a plain number string (e.g. "21", "6.4"), with no units, percent signs or text.
6. Give each item a short "reason" (one or two sentences).
7. Do not open, list or search any file outside the input directory, including any other output of this project.

Return only this JSON, with no code fences and no other text:
{"answers": [{"item": 1, "reason": "...", "fields": {"experimental_cases": {"label": "reported", "document_value": "21", "report_file": "report_DOC1.txt", "quote": "..."}, "control_cases": {"label": "not_in_documents", "document_value": null, "report_file": null, "quote": null}}}]}`;
export const buildPrompt = (dir: string, nItems: number, reportFiles: string[]) => CHECK_PROMPT.replace(/\{dir\}|\{n_items\}|\{reports\}/g, (key) => key === '{dir}' ? dir : key === '{n_items}' ? String(nItems) : reportFiles.join(', '));
export function parseResponse(raw: string, count: number): Map<number, unknown> {
  const text = raw.replace(/^\uFEFF/, '').trim();
  const body = /^```[A-Za-z0-9]*[ \t]*\n([\s\S]*)\n```[ \t]*$/.exec(text)?.[1] ?? text;
  const answers = record(JSON.parse(body))?.answers;
  if (!Array.isArray(answers)) throw new Error('answers が配列ではありません');
  const out = new Map<number, unknown>();
  for (const answer of answers) {
    const value = record(answer)?.item;
    const item = typeof value === 'string' && /^\d+$/.test(value) ? Number(value) : value;
    if (typeof item !== 'number' || !Number.isInteger(item) || item < 1 || item > count || out.has(item)) throw new Error('item の範囲または重複が不正です');
    out.set(item, answer);
  }
  return out;
}
export interface FieldJudge {
  field: string; label: string | null; label_as_given: string | null; document_value: string | null;
  report_file: string | null; quote: string | null; reason: string | null; quote_ok: boolean | null; problem: string | null; source: 'text';
}
export function judgeField(field: string, goldText: string, answer: unknown, files: string[], texts: Record<string, string>): FieldJudge {
  const row: FieldJudge = { field, label: null, label_as_given: null, document_value: null, report_file: null, quote: null, reason: null, quote_ok: null, problem: null, source: 'text' };
  const fail = (problem: string) => { row.problem = problem; return row; };
  if (answer === null || answer === undefined) return fail('missing_item');
  const obj = record(answer);
  row.reason = typeof obj?.reason === 'string' ? obj.reason : null;
  const entry = record(record(obj?.fields)?.[field]);
  if (!entry) return fail('missing_field');
  row.label = row.label_as_given = typeof entry.label === 'string' ? entry.label : null;
  if (!LABELS.includes(row.label as Label)) return fail('bad_label');
  if (row.label === 'not_in_documents') return row;
  row.document_value = entry.document_value == null ? null : String(entry.document_value);
  row.report_file = typeof entry.report_file === 'string' ? entry.report_file : null;
  row.quote = typeof entry.quote === 'string' ? entry.quote : null;
  if (!row.report_file || !files.includes(row.report_file)) return fail('bad_file');
  row.quote_ok = !!row.quote && quoteInText(row.quote, texts[row.report_file] ?? '');
  if (!row.quote_ok) return fail('quote_not_found');
  const document = toDecimal(entry.document_value);
  if (document === null) return fail('value_not_numeric');
  if (['reported', 'different_value'].includes(row.label!) && !quoteNumbers(row.quote!).has(document.replace(/^-/, ''))) {
    if (row.label === 'different_value') return fail('value_not_in_quote');
    row.label = 'derivable';
  }
  if (row.label === 'reported' || row.label === 'derivable') {
    if (!matches(field, document, goldText)) return fail('value_differs_from_gold');
  } else if (matches(field, document, goldText)) return fail('value_equals_gold');
  return row;
}
export function consensus(a?: FieldJudge, b?: FieldJudge) {
  const valid = (x?: FieldJudge) => !!x && x.problem === null;
  const both = valid(a) && valid(b);
  const agreed = both && a!.label === b!.label && (a!.label !== 'different_value' || toDecimal(a!.document_value) === toDecimal(b!.document_value));
  const status = agreed ? 'agreed' : both ? 'split' : 'incomplete';
  return { status, label: agreed ? a!.label as Label : null, singleValid: !agreed && [a, b].filter((x) => valid(x) && ['reported', 'derivable'].includes(x!.label!)).length === 1 };
}
export function kappa(pairs: [string, string][]) {
  if (!pairs.length) return { agreement: null, kappa: null };
  const n = pairs.length, agreement = pairs.filter(([a, b]) => a === b).length / n;
  const expected = LABELS.reduce((sum, label) => sum + pairs.filter(([a]) => a === label).length / n * pairs.filter(([, b]) => b === label).length / n, 0);
  return { agreement, kappa: expected >= 1 ? null : (agreement - expected) / (1 - expected) };
}
export interface FinalValue { rowId: string; field: string; label: Label | null; status: string }
export const valueKey = (row: { rowId: string; field: string }) => row.rowId + '\t' + row.field;
export function readOwner(raw: string): Map<string, RecheckLabel & { savedAt?: string }> {
  const text = raw.replace(/^\uFEFF/, '').trim();
  const rows: unknown[] = text.startsWith('[') ? JSON.parse(text) : text.split('\n').filter((line) => line.trim()).map((line) => JSON.parse(line));
  const out = new Map<string, RecheckLabel & { savedAt?: string }>();
  for (let value of rows) {
    if (record(value) && 'value' in record(value)!) value = record(value)!.value;
    if (typeof value === 'string') value = JSON.parse(value);
    const row = record(value);
    if (!row || typeof row.rowId !== 'string' || typeof row.field !== 'string' || !LABELS.includes(row.label as Label)) throw new Error('本人の判定のラベルまたはキーが不正です');
    if (row.savedAt !== undefined && (typeof row.savedAt !== 'string' || !Number.isFinite(Date.parse(row.savedAt)))) throw new Error('savedAt が不正です');
    const next = row as unknown as RecheckLabel & { savedAt?: string }, key = valueKey(next), prev = out.get(key);
    if (!prev?.savedAt || (next.savedAt && Date.parse(next.savedAt) >= Date.parse(prev.savedAt))) out.set(key, next);
  }
  return out;
}
export function makeLabels(values: FinalValue[], owner: ReturnType<typeof readOwner>) {
  const keys = new Set(values.map(valueKey));
  for (const [key, row] of owner) if (!keys.has(key) || !LABELS.includes(row.label)) throw new Error('凍結にないキーまたは不正なラベルです');
  const missing = values.filter((v) => !owner.has(valueKey(v)) && (v.status !== 'agreed' || !v.label)).length;
  if (missing) throw new Error(`本人の判定が ${missing} 件不足しています`);
  const labels = values.map((v): RecheckLabel => ({ rowId: v.rowId, field: v.field, label: owner.get(valueKey(v))?.label ?? v.label! }));
  return { labels, automatic: values.length - owner.size, owner: owner.size, overrides: values.filter((v) => v.status === 'agreed' && owner.has(valueKey(v))).length,
    labelsByType: Object.fromEntries(LABELS.map((label) => [label, labels.filter((v) => v.label === label).length])) };
}
