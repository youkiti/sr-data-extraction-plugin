import type { SchemaField } from '../../domain/schemaField';
import type { PilotFeedback, PilotFeedbackField } from './pilotFeedback';
import { isProtectedField } from './redraftDiff';
import type { PilotInstructionRevision } from './skills/revisePilotInstructions';

export const MIN_STUDIES_FOR_REVISION = 2;
type Entry = PilotFeedbackField['entries'][number];
const numeric = /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)$/;
const normalize = (value: string) => value.replace(/\s+/g, '').toLowerCase();
const escapeRegExp = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

export function valueShape(value: string | null): string {
  const text = (value ?? '').trim();
  if (!text) return 'empty';
  if (numeric.test(text)) {
    const dot = text.indexOf('.');
    return dot < 0 ? 'integer' : `decimal(${text.length - dot - 1})`;
  }
  if (/\d/.test(text)) return 'number_with_text';
  return `text(${text.split(/\s+/).length})`;
}

export function classifyDiscrepancy(ai: string | null, human: string | null): string {
  const a = (ai ?? '').trim();
  const h = (human ?? '').trim();
  if (!a && h) return 'ai_empty';
  if (normalize(a) === normalize(h)) return 'formatting_only';
  const an = numeric.test(a);
  const hn = numeric.test(h);
  if (an && hn) {
    const av = Number(a);
    const hv = Number(h);
    if (av === hv) return 'formatting_only';
    const power = Math.log10(hv / av);
    if (
      av !== 0 &&
      hv !== 0 &&
      Number.isFinite(power) &&
      Math.abs(power - Math.round(power)) < 1e-10
    )
      return 'numeric_scale';
    return 'numeric_different';
  }
  if (an !== hn) return 'number_vs_text';
  if (normalize(a).includes(normalize(h))) return 'ai_longer';
  if (normalize(h).includes(normalize(a))) return 'ai_shorter';
  return 'text_different';
}

const quoted = /'[^']*'|"[^"]*"|「[^」]*」|『[^』]*』/g;
const numbers = /[+-]?(?:\d+(?:\.\d*)?|\.\d+)/g;

export function maskPilotNote(entry: Entry): string | null {
  if (entry.note === null) return null;
  const values = [entry.aiValue, entry.humanValue].map((v) => (v ?? '').trim()).filter(Boolean);
  const terms = [...values, ...values.flatMap((v) => v.match(/[a-z0-9]{3,}/gi) ?? [])];
  const escaped = [...new Set(terms)]
    .sort((a, b) => b.length - a.length)
    .map(escapeRegExp);
  const masked = escaped.length
    ? entry.note.replace(new RegExp(escaped.join('|'), 'gi'), '<value>')
    : entry.note;
  return masked.replace(numbers, '<num>').replace(quoted, '<text>').slice(0, 300);
}

export function selectRevisionFeedback(
  feedback: PilotFeedback,
  fields: readonly SchemaField[],
): {
  feedback: PilotFeedback;
  excludedSingleStudyCount: number;
} {
  let excludedSingleStudyCount = 0;
  const items = feedback.items.flatMap((item) => {
    const field = fields.find((f) => f.fieldId === item.fieldId);
    if (!field || isProtectedField(field)) return [];
    const entries = item.entries.filter((entry) => entry.action !== 'accept');
    const studies = new Set(entries.map((entry) => entry.studyId)).size;
    if (studies < MIN_STUDIES_FOR_REVISION) {
      if (studies === 1) excludedSingleStudyCount++;
      return [];
    }
    return [{ ...item, entries }];
  });
  return {
    feedback: { items, decisionCount: items.reduce((n, item) => n + item.entries.length, 0) },
    excludedSingleStudyCount,
  };
}

// 漏れ照合では符号を捨てる（"18-65" の "-65" を 65 と照合できるようにする）
const unsignedNumbers = /(?:\d+(?:\.\d*)?|\.\d+)/g;
const extractNumbers = (text: string): number[] =>
  (text.match(unsignedNumbers) ?? []).map(Number);

/**
 * 語の途中への一致（"itt" と "written"・"yes" と "eyes"）を漏れと誤判定しないよう、
 * 英数字で始まる / 終わる文字列は、その側で英数字に隣接しない位置だけを一致とみなす
 */
function containsLiteral(haystack: string, literal: string): boolean {
  const head = /^[a-z0-9]/i.test(literal) ? '(?<![a-z0-9])' : '';
  const tail = /[a-z0-9]$/i.test(literal) ? '(?![a-z0-9])' : '';
  return new RegExp(head + escapeRegExp(literal) + tail, 'i').test(haystack);
}

/** 送信対象の生データと照合し、現行定義にない値を含む提案を項目単位で除外する。 */
export function filterLeakingRevisions(
  revisions: readonly PilotInstructionRevision[],
  fields: readonly SchemaField[],
  feedback: PilotFeedback,
): { revisions: PilotInstructionRevision[]; droppedFieldNames: string[] } {
  const strings = feedback.items
    .flatMap((item) =>
      item.entries.flatMap((entry) => [
        ...[entry.aiValue, entry.humanValue]
          .map((v) => (v ?? '').trim())
          .filter((v) => v.length >= 3),
        ...(entry.note?.match(quoted) ?? []).map((v) => v.slice(1, -1)).filter(Boolean),
      ]),
    )
    .map((v) => v.toLowerCase());
  const droppedFieldNames: string[] = [];
  const kept = revisions.filter((revision) => {
    const field = fields.find((f) => f.fieldName.trim() === revision.fieldName);
    if (!field) return false;
    const definitions = [
      field.extractionInstruction,
      field.example,
      field.fieldLabel,
      field.allowedValues,
      field.unit,
    ].map((v) => (v ?? '').toLowerCase());
    const proposed = [revision.extractionInstruction, revision.example ?? '']
      .join('\n')
      .toLowerCase();
    const existingNumbers = definitions.flatMap(extractNumbers);
    const pilotNumbers = feedback.items
      .filter((item) => item.fieldId === field.fieldId)
      .flatMap((item) =>
        item.entries.flatMap((entry) =>
          [entry.aiValue, entry.humanValue, entry.note].flatMap((v) => extractNumbers(v ?? '')),
        ),
      );
    const leak =
      strings.some(
        (v) => containsLiteral(proposed, v) && !definitions.some((d) => containsLiteral(d, v)),
      ) ||
      extractNumbers(proposed).some(
        (v) => pilotNumbers.includes(v) && !existingNumbers.includes(v),
      );
    if (leak) droppedFieldNames.push(revision.fieldName);
    return !leak;
  });
  return { revisions: kept, droppedFieldNames };
}
