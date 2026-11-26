import { createHash } from 'node:crypto';
import { readFile, readdir, stat, writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { cochraneRoot, readSubset, selectedTiers, textLayerDir, type Tier } from './config';
import { evaluationValues, filterItems, filterGoldItems, usableDocuments, type EmptyGoldCounts, type Study, type Task, type Reference, type Provenance,
  type Judgment, type ReviewContext, type Page, type EvalValue, type UsableDocument, type Excluded } from './evaluationSet';
import { resolveContext } from './schema';

export const sha256 = (bytes: string | Uint8Array) => createHash('sha256').update(bytes).digest('hex');
export const fileHash = async (file: string) => sha256(await readFile(file));
export async function readJson<T>(file: string): Promise<T> { return JSON.parse(await readFile(file, 'utf8')) as T; }
export async function readOptional<T>(file: string): Promise<T | null> {
  try { return await readJson<T>(file); } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw error;
  }
}
export async function writeJson(file: string, value: unknown): Promise<void> {
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, JSON.stringify(value, null, 2) + '\n', 'utf8');
}
export async function jsonLines<T>(file: string): Promise<T[]> {
  return (await readFile(file, 'utf8')).split('\n').filter((line) => line.trim()).map((line) => JSON.parse(line) as T);
}
export async function filesUnder(dir: string): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true });
  const files: string[] = [];
  for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
    const file = path.join(dir, entry.name);
    if (entry.isSymbolicLink()) throw new Error('入力にシンボリックリンクは使えません');
    if (entry.isDirectory()) files.push(...await filesUnder(file));
    else files.push(file);
  }
  return files;
}
export async function inputRoot(): Promise<string> {
  const root = cochraneRoot();
  let exists = false;
  try { exists = (await stat(root)).isDirectory(); } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
  }
  if (!exists) throw new Error('COCHRANE_BENCH_ROOT のディレクトリが存在しません');
  return root;
}
export function upstreamPath(root: string, relative: string): string {
  const resolved = path.resolve(root, relative);
  if (path.relative(root, resolved).startsWith('..') || path.isAbsolute(path.relative(root, resolved))) throw new Error('入力パスがデータルートの外を指しています');
  return resolved;
}
export const refDir = (root: string, tier: Tier) => path.join(root, 'data', 'interim', tier, 'numeric_reference_check');
export const goldFile = (root: string, tier: Tier) => path.join(root, 'data', 'processed', tier, 'gold', 'task3_numeric.jsonl');
export const cachePath = (tier: Tier, docId: string) => {
  if (!/^[A-Za-z0-9_-]+$/.test(docId)) throw new Error('文書 ID に未対応の文字があります');
  return path.join(textLayerDir(), `${tier}__${docId}.json`);
};
export interface TextCache { tier: Tier; docId: string; pdfSha256: string; pdfjsVersion: string; pageCount: number; pages: Page[] }
export async function loadStudies(root: string, tiers = selectedTiers(), { ignoreStudySubset = false } = {}): Promise<Study[]> {
  const studies: Study[] = [];
  for (const tier of tiers) {
    const taskRoot = path.join(root, 'data', 'processed', tier, 'numeric_tasks');
    const contexts = new Map<string, (ReviewContext | null | undefined)[]>();
    for (const file of await filesUnder(path.join(refDir(root, tier), 'inputs'))) {
      if (path.basename(file) !== 'check.json') continue;
      const taskId = path.relative(path.join(refDir(root, tier), 'inputs'), file).split(path.sep)[0]!;
      const reviewId = taskId.split('_')[0]!;
      const context = (await readJson<{ review_context?: ReviewContext }>(file)).review_context;
      contexts.set(reviewId, [...(contexts.get(reviewId) ?? []), context]);
    }
    const resolved = new Map([...contexts].map(([id, values]) => [id, resolveContext(values)]));
    for (const taskPath of await filesUnder(taskRoot)) {
      if (!taskPath.endsWith('.json')) continue;
      const task = await readJson<Task>(taskPath);
      const items = filterItems(task.items);
      if (!items.length) continue;
      const stem = path.basename(taskPath, '.json');
      if (!/^[A-Za-z0-9_-]+$/.test(stem) || !/^[A-Za-z0-9_-]+$/.test(task.pmcid)) throw new Error('研究キーに未対応の文字があります');
      if (task.tier !== tier) throw new Error('課題の tier がディレクトリと一致しません');
      studies.push({ tier, reviewId: task.pmcid, stem, studyKey: `${tier}/${task.pmcid}/${stem}`, taskPath,
        task, items, context: resolved.get(task.pmcid) ?? null });
    }
  }
  studies.sort((a, b) => a.studyKey.localeCompare(b.studyKey));
  const selected = ignoreStudySubset ? studies.map((study) => study.studyKey) : readSubset('BENCH_STUDIES', studies.map((study) => study.studyKey));
  return studies.filter((study) => selected.includes(study.studyKey));
}
export interface EvaluationSet {
  studies: Study[];
  values: EvalValue[];
  documents: Map<string, UsableDocument[]>;
  excluded: Excluded[];
  hashes: Record<string, string>;
  emptyGold: Partial<Record<Tier, EmptyGoldCounts>>;
}
export async function loadEvaluation(root: string, options: { ignoreStudySubset?: boolean } = {}): Promise<EvaluationSet> {
  const candidates = await loadStudies(root, selectedTiers(), options);
  const result: EvaluationSet = { studies: [], values: [], documents: new Map(), excluded: [], hashes: {}, emptyGold: {} };
  const joins = new Map<Tier, { refs: Reference[]; prov: Provenance[]; judgments: Judgment[] }>();
  for (const tier of selectedTiers()) {
    result.emptyGold[tier] = { items: 0, values: 0 };
    const base = refDir(root, tier);
    const judgments: Judgment[] = [];
    for (const file of await filesUnder(path.join(base, 'judgments'))) {
      if (file.endsWith('.jsonl')) judgments.push(...await jsonLines<Judgment>(file));
    }
    joins.set(tier, { refs: await jsonLines<Reference>(path.join(base, 'final.jsonl')), prov: await jsonLines<Provenance>(goldFile(root, tier)), judgments });
  }
  for (const study of candidates) {
    result.hashes[`upstream/${path.relative(root, study.taskPath).replace(/\\/g, '/')}`] = await fileHash(study.taskPath);
    const filtered = filterGoldItems(study);
    const counts = result.emptyGold[study.tier] ??= { items: 0, values: 0 };
    counts.items += filtered.emptyGold.items; counts.values += filtered.emptyGold.values;
    study.items = filtered.items;
    if (!study.items.length) { result.excluded.push({ studyKey: study.studyKey, reason: 'no_gold' }); continue; }
    const states = [];
    for (const doc of study.task.documents) {
      const pdf = doc.pdf_path ? upstreamPath(root, doc.pdf_path) : null;
      let exists = false;
      if (pdf) {
        try { exists = (await stat(pdf)).isFile(); } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
      }
      let pages: Page[] = [];
      if (exists && pdf) {
        const pdfHash = await fileHash(pdf);
        result.hashes[`upstream/${path.relative(root, pdf).replace(/\\/g, '/')}`] = pdfHash;
        const cache = await readOptional<TextCache>(cachePath(study.tier, doc.pmcid));
        if (!cache) throw new Error('文字層キャッシュがありません。extract-text を先に実行してください');
        if (cache.pdfSha256 !== pdfHash) throw new Error('PDF と文字層キャッシュのハッシュが違います。extract-text を再実行してください');
        result.hashes[`textlayer/${study.tier}__${doc.pmcid}.json`] = await fileHash(cachePath(study.tier, doc.pmcid));
        pages = cache.pages;
      }
      states.push({ exists, pages });
    }
    const usable = usableDocuments(study, states);
    if (usable.reason) { result.excluded.push({ studyKey: study.studyKey, reason: usable.reason }); continue; }
    const join = joins.get(study.tier)!;
    result.studies.push(study);
    result.documents.set(study.studyKey, usable.documents);
    result.values.push(...evaluationValues(study, join.refs, join.prov, join.judgments, usable.documents.map((doc) => doc.pmcid)));
  }
  return result;
}
export function printCounts(set: EvaluationSet): void {
  console.log(`candidate studies: ${set.studies.length + set.excluded.length}`);
  console.log(`studies: ${set.studies.length}, items: ${set.studies.reduce((n, s) => n + s.items.length, 0)}, values: ${set.values.length}`);
  for (const tier of selectedTiers()) {
    const studies = set.studies.filter((study) => study.tier === tier);
    console.log(`${tier}: reviews=${new Set(studies.map((study) => study.reviewId)).size}, studies=${studies.length}, items=${studies.reduce((n, study) => n + study.items.length, 0)}, values=${set.values.filter((value) => value.tier === tier).length}`);
    const empty = set.emptyGold[tier] ?? { items: 0, values: 0 };
    console.log(`${tier}: needsRecheck=${set.values.filter((value) => value.tier === tier && value.needsRecheck).length}`);
    console.log(`${tier}: empty gold: items=${empty.items}, values=${empty.values}`);
  }
  console.log(`excluded: ${set.excluded.length} (no_pdf: ${set.excluded.filter((s) => s.reason === 'no_pdf').length} / no_text_layer: ${set.excluded.filter((s) => s.reason === 'no_text_layer').length} / no_gold: ${set.excluded.filter((s) => s.reason === 'no_gold').length})`);
  for (const excluded of set.excluded) console.log(`${excluded.studyKey}: ${excluded.reason}`);
}
export function evaluationCounts(set: EvaluationSet) {
  return Object.fromEntries(selectedTiers().map((tier) => {
    const studies = set.studies.filter((study) => study.tier === tier);
    const values = set.values.filter((value) => value.tier === tier);
    return [tier, { reviews: new Set(studies.map((study) => study.reviewId)).size, studies: studies.length,
      items: studies.reduce((n, study) => n + study.items.length, 0), values: values.length,
      rechecked: values.filter((value) => value.relabelled).length,
      recheckTransitions: values.filter((value) => value.relabelled).reduce<Record<string, number>>((counts, value) => {
        const key = `${value.upstreamLabel} → ${value.label}`;
        counts[key] = (counts[key] ?? 0) + 1; return counts;
      }, {}),
      valuesPerLabel: Object.fromEntries(['reported', 'derivable', 'different_value', 'not_in_documents', 'null'].map((label) =>
        [label, values.filter((value) => (value.label ?? 'null') === label).length])) }];
  }));
}
