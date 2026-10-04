import { NOT_REPORTED_TOKEN } from './annotation';
import type { SchemaField } from './schemaField';

export interface MultiSelectElement {
  /** 選択肢（既知なら allowed_values の表記。未知なら入力そのまま trim 済み） */
  option: string;
  /** 自由記述（freeTextValues の選択肢のみ。無ければ null） */
  text: string | null;
  /** allowed_values にある選択肢か */
  known: boolean;
}

/** 区切り一覧の空要素と重複を除き、初出順で返す。 */
export function splitPipeList(value: string | null): string[] {
  return [...new Set((value ?? '').split('|').map((part) => part.trim()).filter(Boolean))];
}

export function isMultiSelectField(field: SchemaField): boolean {
  return field.dataType === 'enum' && field.multiSelect !== null && splitPipeList(field.allowedValues).length > 0;
}

export function sanitizeFreeText(text: string | null): string | null {
  return text?.replace(/\|/g, '/').replace(/\r\n|\r|\n/g, ' ').trim() || null;
}

/** 同じ選択肢は先頭を残し、既知の選択肢を許容値順、未知を文字列順にする。 */
function canonicalElements(field: SchemaField, elements: readonly MultiSelectElement[]): MultiSelectElement[] {
  const allowed = splitPipeList(field.allowedValues);
  const unique = new Map<string, MultiSelectElement>();
  for (const element of elements) {
    if (!unique.has(element.option)) unique.set(element.option, element);
  }
  return [...unique.values()].sort((a, b) => {
    const ai = allowed.indexOf(a.option);
    const bi = allowed.indexOf(b.option);
    if (ai >= 0 && bi >= 0) return ai - bi;
    if (ai >= 0) return -1;
    if (bi >= 0) return 1;
    return a.option < b.option ? -1 : 1;
  });
}

export function parseMultiSelectValue(field: SchemaField, value: string | null): MultiSelectElement[] {
  if (!isMultiSelectField(field) || value === NOT_REPORTED_TOKEN) return [];
  const allowed = splitPipeList(field.allowedValues);
  const freeText = field.multiSelect!.freeTextValues.slice().sort((a, b) => b.length - a.length);
  return canonicalElements(field, splitPipeList(value).map((raw) => {
    if (allowed.includes(raw)) return { option: raw, text: null, known: true };
    const ft = freeText.find((option) => raw.startsWith(`${option}: `));
    if (ft !== undefined) return { option: ft, text: sanitizeFreeText(raw.slice(ft.length + 2)), known: true };
    const option = allowed.find((candidate) => candidate.toLowerCase() === raw.toLowerCase());
    return { option: option ?? raw, text: null, known: option !== undefined };
  }));
}

export function formatMultiSelectValue(field: SchemaField, elements: readonly MultiSelectElement[]): string | null {
  if (!isMultiSelectField(field)) return null;
  return canonicalElements(field, elements).map((element) => {
    const text = field.multiSelect!.freeTextValues.includes(element.option) ? sanitizeFreeText(element.text) : null;
    return text === null ? element.option : `${element.option}: ${text}`;
  }).join('|') || null;
}

export function canonicalizeMultiSelectValue(field: SchemaField, value: string | null): string | null {
  if (!isMultiSelectField(field) || value === null || value === '' || value === NOT_REPORTED_TOKEN) return value;
  return formatMultiSelectValue(field, parseMultiSelectValue(field, value));
}

export function toggleMultiSelectOption(
  field: SchemaField,
  elements: readonly MultiSelectElement[],
  option: string,
): MultiSelectElement[] {
  if (elements.some((element) => element.option === option)) {
    return canonicalElements(field, elements.filter((element) => element.option !== option));
  }
  if (!isMultiSelectField(field) || !splitPipeList(field.allowedValues).includes(option)) {
    return canonicalElements(field, elements);
  }
  const exclusive = field.multiSelect!.exclusiveValues;
  const kept = exclusive.includes(option) ? [] : elements.filter((element) => !exclusive.includes(element.option));
  return canonicalElements(field, [...kept, { option, text: null, known: true }]);
}
