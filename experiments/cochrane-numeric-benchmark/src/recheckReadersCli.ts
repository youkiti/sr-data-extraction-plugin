import { mkdir, readFile, writeFile, stat, rm } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { benchRoot, type Tier } from './config';
import { inputRoot, loadStudies, readJson, writeJson, jsonLines, sha256, type TextCache } from './io';
import type { Label, ReviewContext } from './evaluationSet';
import { cleanFootnotes } from './schema';
import { safeError } from './cost';
import { buildPrompt, normalized, parseResponse, judgeField, consensus, kappa, LABELS, valueKey, readOwner, makeLabels, type FieldJudge, type FinalValue } from './recheckReaders';

interface Needed {
  tier: Tier; studyKey: string; rowId: string; field: string; item: Record<string, unknown>; gold: string;
  upstreamLabel: Label; passedDocIds: string[];
}
interface CheckItem { item: number; fields: string[]; gold: Record<string, string>; [key: string]: unknown }
interface Check { study: string; reports: string[]; review_context?: ReviewContext; items: CheckItem[] }
interface FrozenItem { item: number; rowId: string; fields: string[]; gold: Record<string, string> }
interface FrozenTask { id: string; studyKey: string; tier: Tier; files: Record<string, string>; items: FrozenItem[] }
interface Frozen { tasks: FrozenTask[]; values: { taskId: string; item: number; rowId: string; field: string; gold: string; upstreamLabel: Label }[] }
interface Judgment extends FieldJudge { taskId: string; item: number; rowId: string; frozenSha256: string }
interface Final extends FinalValue { gold: string; singleValid: boolean; labelA: string | null; labelB: string | null; frozenSha256: string }
interface Options { studies?: () => Promise<{ studyKey: string; context: ReviewContext | null }[]>; log?: (message: string) => void }
const exists = async (file: string) => { try { await stat(file); return true; } catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false; throw error; } };
const writeLines = async (file: string, rows: unknown[]) => { await mkdir(path.dirname(file), { recursive: true }); await writeFile(file, rows.map((row) => JSON.stringify(row) + '\n').join(''), 'utf8'); };
function safeName(name: string): string {
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(name)) throw new Error('名前が不正です');
  return name;
}
export async function runCli(args: string[], options: Options = {}): Promise<number> {
  const [command, ...rest] = args;
  const flags = new Map<string, string>();
  let force = false;
  for (let i = 0; i < rest.length; i++) {
    const flag = rest[i]!;
    if (flag === '--force') { force = true; continue; }
    if (!['--outputs', '--reader', '--reader-a', '--reader-b', '--adjudications'].includes(flag) || !rest[i + 1] || rest[i + 1]!.startsWith('--')) throw new Error('オプションが不正です');
    flags.set(flag, rest[++i]!);
  }
  const required = (key: string) => { const value = flags.get(key); if (!value) throw new Error(`${key} が必要です`); return value; };
  const outputs = path.resolve(flags.get('--outputs') ?? path.join(benchRoot, 'outputs'));
  const work = path.join(outputs, 'recheck-readers'), frozenFile = path.join(work, 'frozen.json');
  const log = options.log ?? console.log;
  if (command === 'freeze') {
    if (await exists(frozenFile)) {
      if (await exists(path.join(work, 'responses')) || await exists(path.join(work, 'judgments'))) throw new Error('応答または判定があるため凍結を上書きできません。作業フォルダを退避してください');
      if (!force) throw new Error('凍結は既にあります。作り直すには --force が必要です');
    }
    const rows = await jsonLines<Needed>(path.join(outputs, 'recheck-needed.jsonl'));
    const studies = await (options.studies ?? (async () => loadStudies(await inputRoot())))();
    const groups = new Map<string, Needed[]>(), keys = new Set<string>();
    for (const row of rows) {
      if (keys.has(valueKey(row))) throw new Error('再チェック対象の値が重複しています');
      keys.add(valueKey(row));
      groups.set(row.studyKey, [...(groups.get(row.studyKey) ?? []), row]);
    }
    const frozen: Frozen = { tasks: [], values: [] };
    // 読み取りと整合性確認を済ませてから、入力の作り直しを始める。
    const contents: { dir: string; files: Record<string, string> }[] = [];
    for (const [studyKey, group] of groups) {
      const first = group[0]!, study = studies.find((s) => s.studyKey === studyKey);
      if (!study) throw new Error('再チェック対象の研究が見つかりません');
      if (group.some((r) => r.tier !== first.tier || JSON.stringify(r.passedDocIds) !== JSON.stringify(first.passedDocIds))) throw new Error('研究内の文書集合が一致しません');
      const id = 't' + sha256(studyKey).slice(0, 12), dir = path.join(work, 'inputs', id);
      const reports: string[] = [], files: Record<string, string> = {};
      for (const docId of first.passedDocIds) {
        if (!/^[A-Za-z0-9_-]+$/.test(docId) || !['cc-by', 'cc-by-nc'].includes(first.tier)) throw new Error('文書 ID または tier が不正です');
        const cache = await readJson<TextCache>(path.join(outputs, 'textlayer', `${first.tier}__${docId}.json`));
        const file = `report_${docId}.txt`;
        reports.push(file);
        files[file] = cache.pages.map((p) => `[PAGE ${p.page}]\n${p.text.replace(/\r\n?/g, '\n')}`).join('\n') + '\n';
      }
      const items: CheckItem[] = [], frozenItems: FrozenItem[] = [], rowMap = new Map<string, number>();
      for (const row of group) {
        let index = rowMap.get(row.rowId);
        if (index === undefined) {
          index = items.length; rowMap.set(row.rowId, index);
          const item: CheckItem = { item: index + 1, fields: [], gold: {} };
          for (const key of ['study', 'analysis_group_name', 'analysis_name', 'outcome', 'subgroup', 'experimental_group_label', 'control_group_label', 'experimental_intervention', 'control_intervention', 'test_name', 'subgroup_by', 'subgroup_item']) {
            if (typeof row.item[key] === 'string' && (row.item[key] as string).trim()) item[key] = row.item[key];
          }
          item.data_type = row.item.data_type;
          const note = cleanFootnotes(String(row.item.footnotes ?? ''));
          if (note) item.review_note = note;
          items.push(item); frozenItems.push({ item: index + 1, rowId: row.rowId, fields: item.fields, gold: item.gold });
        }
        items[index]!.fields.push(row.field); items[index]!.gold[row.field] = row.gold;
        frozen.values.push({ taskId: id, item: index + 1, rowId: row.rowId, field: row.field, gold: row.gold, upstreamLabel: row.upstreamLabel });
      }
      const check: Check = { study: String(first.item.study ?? studyKey), reports, ...(study.context ? { review_context: study.context } : {}), items };
      files['check.json'] = JSON.stringify(check, null, 2) + '\n';
      files['prompt.txt'] = buildPrompt(dir.replace(/\\/g, '/'), items.length, reports) + '\n';
      frozen.tasks.push({ id, studyKey, tier: first.tier, files: Object.fromEntries(Object.entries(files).map(([name, text]) => [name, sha256(text)])), items: frozenItems });
      contents.push({ dir, files });
    }
    // 研究をまたいで交互に並ぶ入力でも、値の順序を元の一覧に合わせる。
    const order = new Map(rows.map((row, i) => [valueKey(row), i]));
    frozen.values.sort((a, b) => order.get(valueKey(a))! - order.get(valueKey(b))!);
    if (force) {
      for (const name of ['inputs', 'final.jsonl', 'summary.json', 'owner-queue.json', 'owner-docs.json']) {
        const target = path.resolve(work, name), relative = path.relative(work, target);
        if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) throw new Error('作り直すパスが作業フォルダの外です');
        await rm(target, { recursive: true, force: true });
      }
    }
    for (const { dir, files } of contents) {
      await mkdir(dir, { recursive: true });
      for (const [name, text] of Object.entries(files)) await writeFile(path.join(dir, name), text, 'utf8');
    }
    await writeJson(frozenFile, frozen);
    log(`タスク ${frozen.tasks.length}・項目 ${frozen.tasks.reduce((n, t) => n + t.items.length, 0)}・値 ${rows.length}`);
    return 0;
  }
  const raw = await readFile(frozenFile, 'utf8'), hash = sha256(raw), frozen = JSON.parse(raw) as Frozen;
  const checks = new Map<string, Check>(), texts = new Map<string, Record<string, string>>();
  for (const task of frozen.tasks) {
    const files: Record<string, string> = {};
    for (const [name, expected] of Object.entries(task.files)) {
      const content = await readFile(path.join(work, 'inputs', task.id, name), 'utf8');
      if (sha256(content) !== expected) throw new Error('凍結した入力ファイルのハッシュが一致しません');
      files[name] = content;
    }
    checks.set(task.id, JSON.parse(files['check.json']!) as Check); texts.set(task.id, files);
  }
  if (command === 'ingest') {
    const name = safeName(required('--reader')), judgments: Judgment[] = [];
    let found = 0, missing = 0, unusable = 0;
    for (const task of frozen.tasks) {
      const file = path.join(work, 'responses', name, task.id + '.json');
      let answers = new Map<number, unknown>();
      if (!await exists(file)) missing++;
      else {
        found++;
        const response = await readFile(file, 'utf8');
        try { answers = parseResponse(response, task.items.length); } catch { unusable++; }
      }
      const reports = checks.get(task.id)!.reports;
      const norm = Object.fromEntries(reports.map((file) => [file, normalized(texts.get(task.id)![file]!)]));
      for (const item of task.items) for (const field of item.fields) judgments.push({ taskId: task.id, item: item.item, rowId: item.rowId,
        ...judgeField(field, item.gold[field]!, answers.get(item.item), reports, norm), frozenSha256: hash });
    }
    await writeLines(path.join(work, 'judgments', name + '.jsonl'), judgments);
    const problems = problemCounts(judgments);
    log(`期待タスク ${frozen.tasks.length}・存在 ${found}・欠落 ${missing}・解析不能 ${unusable}・有効 ${judgments.filter((j) => j.problem === null).length}・無効 ${judgments.filter((j) => j.problem !== null).length}・問題 ${JSON.stringify(problems)}`);
    return missing || unusable ? 1 : 0;
  }
  if (command === 'summarize') {
    const readJudges = async (name: string) => {
      const rows = await jsonLines<Judgment>(path.join(work, 'judgments', safeName(name) + '.jsonl'));
      const map = new Map<string, Judgment>();
      for (const row of rows) {
        if (row.frozenSha256 !== hash) throw new Error('判定と凍結のハッシュが一致しません');
        const value = frozen.values.find((v) => valueKey(v) === valueKey(row));
        if (!value || value.taskId !== row.taskId || value.item !== row.item || map.has(valueKey(row))) throw new Error('判定のキーが不正または重複しています');
        map.set(valueKey(row), row);
      }
      return map;
    };
    const nameA = required('--reader-a'), nameB = required('--reader-b');
    if (nameA === nameB) throw new Error('異なる読み手を指定してください');
    const a = await readJudges(nameA), b = await readJudges(nameB);
    const final: Final[] = [], queue: unknown[] = [], docTasks = new Set<string>(), pairs: [string, string][] = [];
    const countsA: FieldJudge[] = [], countsB: FieldJudge[] = [];
    for (const value of frozen.values) {
      const ja = a.get(valueKey(value)) ?? judgeField(value.field, value.gold, null, [], {});
      const jb = b.get(valueKey(value)) ?? judgeField(value.field, value.gold, null, [], {});
      countsA.push(ja); countsB.push(jb);
      const result = consensus(ja, jb);
      final.push({ rowId: value.rowId, field: value.field, gold: value.gold, ...result, labelA: ja.label, labelB: jb.label, frozenSha256: hash });
      if (ja.problem === null && jb.problem === null) pairs.push([ja.label_as_given!, jb.label_as_given!]);
      if (result.status !== 'agreed') {
        const check = checks.get(value.taskId)!, { gold: _gold, ...context } = check.items.find((i) => i.item === value.item)!;
        const detail = (j: FieldJudge) => { const { field: _field, source: _source, ...rest } = j; return rest; };
        queue.push({ key: valueKey(value), taskId: value.taskId, study: check.study, context, field: value.field, gold: value.gold,
          status: result.status, singleValid: result.singleValid, readerA: detail(ja), readerB: detail(jb), upstreamLabel: value.upstreamLabel });
        docTasks.add(value.taskId);
      }
    }
    const matrix = Object.fromEntries(LABELS.map((la) => [la, Object.fromEntries(LABELS.map((lb) => [lb, pairs.filter(([a, b]) => a === la && b === lb).length]))]));
    const summary = { total: final.length, statuses: Object.fromEntries(['agreed', 'split', 'incomplete'].map((s) => [s, final.filter((v) => v.status === s).length])),
      singleValid: final.filter((v) => v.singleValid).length, validPairs: pairs.length, ...kappa(pairs), matrix, problemsA: problemCounts(countsA), problemsB: problemCounts(countsB), owner: queue.length };
    await writeLines(path.join(work, 'final.jsonl'), final);
    await writeJson(path.join(work, 'summary.json'), summary);
    await writeJson(path.join(work, 'owner-queue.json'), queue);
    await writeJson(path.join(work, 'owner-docs.json'), Object.fromEntries([...docTasks].map((id) => [id, checks.get(id)!.reports.map((file) => ({ file, text: texts.get(id)![file]! }))])));
    log(`値 ${final.length}・状態 ${JSON.stringify(summary.statuses)}・κ ${summary.kappa}・本人 ${queue.length}`);
    return 0;
  }
  if (command === 'labels') {
    const output = path.join(outputs, 'recheck-labels.jsonl');
    if (await exists(output) && !force) throw new Error('ラベルは既にあります。上書きには --force が必要です');
    const final = await jsonLines<Final>(path.join(work, 'final.jsonl'));
    if (final.length !== frozen.values.length || final.some((v, i) => v.frozenSha256 !== hash || valueKey(v) !== valueKey(frozen.values[i]!))) throw new Error('合議結果と凍結が一致しません');
    const result = makeLabels(final, readOwner(await readFile(required('--adjudications'), 'utf8')));
    await writeLines(output, result.labels);
    log(`自動 ${result.automatic}・本人 ${result.owner}・agreed 上書き ${result.overrides}・ラベル ${JSON.stringify(result.labelsByType)}`);
    return 0;
  }
  throw new Error('freeze / ingest / summarize / labels を指定してください');
}
function problemCounts(rows: FieldJudge[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const row of rows) if (row.problem) out[row.problem] = (out[row.problem] ?? 0) + 1;
  return out;
}
if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  try { process.exitCode = await runCli(process.argv.slice(2)); } catch (error) { console.error(safeError(error)); process.exitCode = 1; }
}
