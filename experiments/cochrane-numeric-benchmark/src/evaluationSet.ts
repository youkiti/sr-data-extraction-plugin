import { EVAL_DATA_TYPES, type Tier } from './config';

export interface TaskItem {
  row_id: string;
  data_type: string;
  fields: string[];
  analysis_name?: string;
  analysis_group_name?: string;
  outcome?: string;
  subgroup?: string;
  footnotes?: string;
  experimental_group_label?: string;
  control_group_label?: string;
  experimental_intervention?: string;
  control_intervention?: string;
}
export interface Document {
  pmcid: string;
  pdf_path: string | null;
}
export interface Task {
  pmcid: string;
  tier: Tier;
  study_id: string;
  documents: Document[];
  items: TaskItem[];
  gold: Record<string, Record<string, string>>;
}
export interface ReviewContext { timing_rules?: string[]; outcome_definitions?: string }
export interface Study {
  tier: Tier;
  reviewId: string;
  studyKey: string;
  stem: string;
  taskPath: string;
  task: Task;
  items: TaskItem[];
  context: ReviewContext | null;
}
export type Label = 'reported' | 'derivable' | 'different_value' | 'not_in_documents';
export interface Reference {
  task_id: string;
  item: number;
  field: string;
  row_id: string;
  gold: string;
  label: Label | null;
}
export interface Provenance { row_id: string; values: Record<string, string>; provenance: string }
export interface Judgment { task_id: string; item: number; field: string; label: string | null; source?: string }
export interface EvalValue {
  tier: Tier;
  reviewId: string;
  studyKey: string;
  rowId: string;
  itemIndex: number;
  field: string;
  group: 'experimental' | 'control';
  valueKind: 'events' | 'n' | 'mean' | 'sd';
  dataType: string;
  gold: string;
  label: Label | null;
  provenance: string;
  figureOnly: boolean | null;
}
export interface Page { page: number; text: string }
export interface UsableDocument extends Document { pages: Page[] }
export interface DocumentState { exists: boolean; pages: Page[] }
export interface Excluded { studyKey: string; reason: 'no_pdf' | 'no_text_layer' | 'no_gold' }
export interface EmptyGoldCounts { items: number; values: number }

export function filterItems(items: TaskItem[]): TaskItem[] {
  return items.filter((item) => (EVAL_DATA_TYPES as readonly string[]).includes(item.data_type));
}
export function filterGoldItems(study: Study): { items: TaskItem[]; emptyGold: EmptyGoldCounts } {
  const emptyGold = { items: 0, values: 0 };
  const items = study.items.flatMap((item) => {
    const fields = item.fields.filter((field) => study.task.gold[item.row_id]?.[field]?.trim() !== '');
    emptyGold.values += item.fields.length - fields.length;
    if (!fields.length) { emptyGold.items++; return []; }
    return [{ ...item, fields }];
  });
  return { items, emptyGold };
}
export function usableDocuments(study: Study, states: DocumentState[]): { documents: UsableDocument[]; reason: Excluded['reason'] | null } {
  if (!study.items.length) return { documents: [], reason: 'no_gold' };
  const hasPdf = study.task.documents.some((doc, i) => doc.pdf_path && states[i]?.exists);
  const documents = study.task.documents.flatMap((doc, i) => {
    const state = states[i];
    return doc.pdf_path && state?.exists && state.pages.some((page) => page.text.trim()) ? [{ ...doc, pages: state.pages }] : [];
  });
  return { documents, reason: documents.length ? null : hasPdf ? 'no_text_layer' : 'no_pdf' };
}
export function evaluationValues(study: Study, refs: Reference[], provenance: Provenance[], judgments: Judgment[]): EvalValue[] {
  const refMap = new Map(refs.map((ref) => [`${ref.row_id}\t${ref.field}`, ref]));
  const provMap = new Map(provenance.map((row) => [row.row_id, row]));
  const reported = new Map<string, Judgment[]>();
  for (const judgment of judgments) {
    const key = `${judgment.task_id}\t${judgment.item}\t${judgment.field}`;
    if (judgment.label === 'reported') reported.set(key, [...(reported.get(key) ?? []), judgment]);
  }
  return filterGoldItems(study).items.flatMap((item, index) => item.fields.map((field) => {
    const ref = refMap.get(`${item.row_id}\t${field}`);
    if (!ref) throw new Error(`参照ラベル行がありません: ${study.studyKey} / ${field}`);
    const prov = provMap.get(item.row_id);
    const gold = study.task.gold[item.row_id]?.[field];
    if (gold === undefined || gold !== ref.gold || gold !== prov?.values[field]) {
      throw new Error(`gold が一致しません: ${study.studyKey} / ${field}`);
    }
    const readers = reported.get(`${ref.task_id}\t${ref.item}\t${field}`) ?? [];
    const figureOnly = ref.label !== 'reported' || !readers.length ? null :
      readers.some((reader) => reader.source === 'text') ? false : readers.every((reader) => reader.source === 'figure') ? true : null;
    const [group, kind] = field.split('_');
    if ((group !== 'experimental' && group !== 'control') || !['cases', 'n', 'mean', 'sd'].includes(kind ?? '')) {
      throw new Error(`未対応の数値フィールドです: ${field}`);
    }
    return { tier: study.tier, reviewId: study.reviewId, studyKey: study.studyKey, rowId: item.row_id,
      itemIndex: index + 1, field, group, valueKind: kind === 'cases' ? 'events' : kind as 'n' | 'mean' | 'sd',
      dataType: item.data_type, gold, label: ref.label, provenance: prov!.provenance, figureOnly };
  }));
}
