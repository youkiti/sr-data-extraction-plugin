import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileHash, readOptional, sha256 } from '../../cochrane-numeric-benchmark/src/io';
import { selectedPmcids, type Condition } from './config';
import type { PdfManifest } from './fetchPdf';

export const GOLD_SHA256 = '21e67aefb54a8d45009a602854faf0992daa9e8195b88845e00a2a84df127129';
export const YUN_COMMIT = '1bc768d4d098c727c9866eeff909297c38a3e84c';
const execFileAsync = promisify(execFile);
type GitRunner = (file: string, args: string[], options: { shell: false }) => Promise<{ stdout: string }>;
export async function assertYunCheckout(root: string, git: GitRunner = execFileAsync): Promise<void> {
  let head: string, status: string;
  try {
    head = (await git('git', ['-C', root, 'rev-parse', 'HEAD'], { shell: false })).stdout.trim();
    status = (await git('git', ['-C', root, 'status', '--porcelain', '--untracked-files=no'], { shell: false })).stdout.trim();
  } catch {
    throw new Error('YUN_ROOT の上流チェックアウトを git で検証できません');
  }
  if (head !== YUN_COMMIT) throw new Error(`YUN_ROOT の上流 commit が一致しません。${YUN_COMMIT} が必要です`);
  if (status) throw new Error('YUN_ROOT の上流チェックアウトに追跡対象ファイルの変更があります。変更のない状態が必要です');
}
export interface Ico { id: number; outcome: string; intervention: string; comparator: string; outcome_type: 'binary' | 'continuous'; outcomeId: string }
export interface Study { pmcid: number; studyKey: string; icos: Ico[] }
export interface Page { page: number; text: string }
export interface Document { role: 'article'; filename: string; mode: 'text'; pages: Page[] }
export interface TextCache { pmcid: number; version: number; pdfSha256: string; pdfjsVersion: string; pageCount: number; pages: Page[] }
export type Reason = 'no_oa' | 'no_pdf' | 'fetch_failed' | 'text_failed' | 'empty_text';
export interface EvaluationSet { studies: Study[]; documents: Map<string, Document[]>; hashes: Record<string, string>; excluded: { pmcid: number; reason: Reason }[] }
export function parseGold(bytes: Uint8Array, expected = GOLD_SHA256): { studies: Study[]; rows: number } {
  if (sha256(bytes) !== expected) throw new Error('gold の SHA256 が一致しません');
  const rows = JSON.parse(Buffer.from(bytes).toString('utf8')) as Record<string, unknown>[];
  const groups = new Map<number, Ico[]>();
  for (const row of rows.filter((r) => r.split === 'TEST')) {
    if (!Number.isSafeInteger(row.pmcid) || !Number.isSafeInteger(row.id) ||
      (row.outcome_type !== 'binary' && row.outcome_type !== 'continuous') ||
      ['outcome', 'intervention', 'comparator'].some((key) => typeof row[key] !== 'string')) throw new Error('gold の行形式が不正です');
    const pmcid = row.pmcid as number;
    const icos = groups.get(pmcid) ?? [];
    icos.push({ id: row.id as number, outcome: (row.outcome as string).trim(), intervention: (row.intervention as string).trim(),
      comparator: (row.comparator as string).trim(), outcome_type: row.outcome_type, outcomeId: '' });
    groups.set(pmcid, icos);
  }
  return { rows: rows.length, studies: [...groups].sort(([a], [b]) => a - b).map(([pmcid, icos]) => ({ pmcid, studyKey: `PMC${pmcid}`,
    icos: icos.sort((a, b) => a.id - b.id).map((ico, index) => ({ ...ico, outcomeId: `o${index + 1}` })) })) };
}
export function printCounts(studies: Study[], prefix: string): void {
  console.log(`${prefix}: RCT=${studies.length}, ICO=${studies.reduce((n, s) => n + s.icos.length, 0)}`);
  for (const type of ['binary', 'continuous']) console.log(`${prefix} / ${type}: RCT=${studies.filter((s) => s.icos.some((i) => i.outcome_type === type)).length}, ICO=${studies.reduce((n, s) => n + s.icos.filter((i) => i.outcome_type === type).length, 0)}`);
}
export async function loadGold(root: string): Promise<{ studies: Study[]; hash: string }> {
  const bytes = await readFile(path.join(root, 'evaluation/data/annotated_rct_dataset.json'));
  const { studies, rows } = parseGold(bytes);
  console.log(`gold 全行=${rows}`); printCounts(studies, 'TEST');
  return { studies, hash: sha256(bytes) };
}
export async function loadEvaluation(root: string, out: string, condition: Condition): Promise<EvaluationSet> {
  return loadDocuments(await loadGold(root), root, out, condition);
}
export async function loadDocuments(gold: { studies: Study[]; hash: string }, root: string, out: string, condition: Condition): Promise<EvaluationSet> {
  const selected = selectedPmcids(gold.studies.map((s) => s.pmcid));
  const result: EvaluationSet = { studies: [], documents: new Map(), hashes: { gold: gold.hash }, excluded: [] };
  const manifest = condition === 'pdf' ? await readOptional<PdfManifest>(path.join(out, 'pdf/manifest.json')) : null;
  for (const study of gold.studies.filter((s) => selected.includes(s.pmcid))) {
    let pages: Page[], hash: string;
    if (condition === 'md') {
      const bytes = await readFile(path.join(root, `evaluation/data/no_attributes_markdown_files/${study.studyKey}.md`));
      pages = [{ page: 1, text: bytes.toString('utf8') }]; hash = sha256(bytes);
    } else {
      const entry = manifest?.entries.find((e) => e.pmcid === study.pmcid);
      let reason: Reason | null = !entry ? 'fetch_failed' : entry.status === 'ok' ? null : entry.status;
      let cache: TextCache | null = null;
      if (!reason) {
        try {
          cache = await readOptional<TextCache>(path.join(out, `textlayer/${study.studyKey}.json`));
          if (!cache || cache.pmcid !== study.pmcid || cache.version !== entry!.version || cache.pdfSha256 !== entry!.sha256 ||
            await fileHash(path.join(out, `pdf/${study.studyKey}.${entry!.version}.pdf`)) !== entry!.sha256) reason = 'text_failed';
          else if (!cache.pages.some((p) => p.text.trim())) reason = 'empty_text';
        } catch { reason = 'text_failed'; }
      }
      if (reason) { result.excluded.push({ pmcid: study.pmcid, reason }); continue; }
      pages = cache!.pages; hash = cache!.pdfSha256;
    }
    result.studies.push(study);
    result.documents.set(study.studyKey, [{ role: 'article', filename: `${study.studyKey}.${condition === 'md' ? 'md' : 'pdf'}`, mode: 'text', pages }]);
    result.hashes[`${condition}/${study.studyKey}`] = hash;
  }
  for (const reason of ['no_oa', 'no_pdf', 'fetch_failed', 'text_failed', 'empty_text']) console.log(`除外 ${reason}: ${result.excluded.filter((e) => e.reason === reason).length}`);
  printCounts(result.studies, '利用可能');
  return result;
}
