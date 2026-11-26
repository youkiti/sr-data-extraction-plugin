import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { sha256, writeJson } from '../../cochrane-numeric-benchmark/src/io';
import { loadDocuments, parseGold, type Study } from './dataset';
import { buildFields, buildOutcomeList, buildStudyRequest, FIELD_ORDER } from './prompt';
import type { PdfEntry } from './fetchPdf';

const row = (pmcid: number, id: number, outcome_type = 'binary', split = 'TEST') => ({ pmcid, id, split, outcome_type,
  outcome: ' outcome ', intervention: ' treatment ', comparator: ' placebo ', intervention_events: 987654, notes: '秘密の注釈', is_figure: true });
const bytes = Buffer.from(JSON.stringify([row(10, 4), row(2, 3), row(2, 1, 'continuous'), row(1, 0, 'binary', 'DEV')]));
const gold = { studies: parseGold(bytes, sha256(bytes)).studies, hash: sha256(bytes) };

test('TEST だけを数値 PMCID・id 順にまとめて o 番号を付け、正解列を保持しない', () => {
  assert.equal(parseGold(bytes, sha256(bytes)).rows, 4);
  assert.deepEqual(gold.studies.map((s) => s.pmcid), [2, 10]);
  assert.deepEqual(gold.studies[0]!.icos.map((i) => [i.id, i.outcomeId]), [[1, 'o1'], [3, 'o2']]);
  assert.equal(gold.studies[0]!.studyKey, 'PMC2');
  assert.deepEqual(Object.keys(gold.studies[0]!.icos[0]!).sort(), ['comparator', 'id', 'intervention', 'outcome', 'outcomeId', 'outcome_type'].sort());
  assert.throws(() => parseGold(bytes), /SHA256/);
});
test('二値・連続・混在のフィールド集合は固定順', () => {
  const mixed = gold.studies[0]!.icos;
  assert.deepEqual(buildFields(mixed).map((f) => f.fieldId), FIELD_ORDER);
  assert.deepEqual(buildFields(mixed.filter((i) => i.outcome_type === 'binary')).map((f) => f.fieldId),
    ['intervention_events', 'intervention_group_size', 'comparator_events', 'comparator_group_size']);
  assert.deepEqual(buildFields(mixed.filter((i) => i.outcome_type === 'continuous')).map((f) => f.fieldId),
    ['intervention_group_size', 'intervention_mean', 'intervention_standard_deviation', 'comparator_group_size', 'comparator_mean', 'comparator_standard_deviation']);
  const field = buildFields(mixed)[0]!;
  assert.equal(field.fieldLabel, 'Number of participants with the event in the intervention group');
  assert.equal(field.extractionInstruction, 'Number of participants with the event in the intervention group, for the outcome named in entity_key. If the value is not reported directly but is easy to calculate from what is reported (for example, the number of events from a percentage and the group size), calculate it. If there are data for pre- and post-intervention, use the post-intervention data. If the outcome is reported at several timepoints, use the timepoint closest to the outcome timepoint of interest, or the last one. If the value is unavailable, not extractable, or not easy to calculate, mark it as not reported.');
  assert.deepEqual(buildOutcomeList(mixed)[0], { outcomeId: 'o1', outcomeLabel: 'outcome',
    description: 'Intervention group: treatment | Comparator group: placebo | Outcome: outcome | Data type: continuous', typicalTimepoints: null });
});
test('M は全 Markdown の 1 ページ文書、依頼に正解数値と注釈を渡さない', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'yun-md-'));
  try {
    const md = path.join(dir, 'evaluation/data/no_attributes_markdown_files'); await mkdir(md, { recursive: true });
    for (const s of gold.studies) await writeFile(path.join(md, `${s.studyKey}.md`), '# 全文\n本文\n');
    const set = await loadDocuments(gold, dir, dir, 'md');
    const docs = set.documents.get('PMC2')!;
    assert.deepEqual(docs, [{ role: 'article', filename: 'PMC2.md', mode: 'text', pages: [{ page: 1, text: '# 全文\n本文\n' }] }]);
    assert.equal(set.hashes['md/PMC2'], sha256('# 全文\n本文\n'));
    const request = buildStudyRequest(set.studies[0]!, docs);
    assert.equal(request.documentCount, 1);
    assert.equal(request.messages[0]!.role, 'system');
    assert.doesNotMatch(JSON.stringify(request), /987654|秘密の注釈|is_figure/);
  } finally { await rm(dir, { recursive: true, force: true }); }
});
test('P 文書と no_oa・no_pdf・fetch_failed・text_failed・empty_text の除外', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'yun-pdf-'));
  try {
    const studies: Study[] = Array.from({ length: 7 }, (_, i) => ({ ...gold.studies[0]!, pmcid: i + 1, studyKey: `PMC${i + 1}` }));
    const entries: PdfEntry[] = studies.slice(0, 6).map((s, i) => ({ pmcid: s.pmcid, versions: [1], version: 1,
      licenseCode: null, pdfUrl: null, md5: null, sha256: sha256('pdf'), bytes: 3, fetchedAt: '', error: null,
      status: i === 0 ? 'no_oa' : i === 1 ? 'no_pdf' : i === 2 ? 'fetch_failed' : 'ok' }));
    await writeJson(path.join(dir, 'pdf/manifest.json'), { entries });
    for (const pmcid of [4, 5, 6]) await writeFile(path.join(dir, `pdf/PMC${pmcid}.1.pdf`), 'pdf');
    for (const pmcid of [5, 6]) await writeJson(path.join(dir, `textlayer/PMC${pmcid}.json`), {
      pmcid, version: 1, pdfSha256: sha256('pdf'), pdfjsVersion: 'fake', pageCount: 1,
      pages: [{ page: 1, text: pmcid === 5 ? ' \n ' : '本文' }],
    });
    const set = await loadDocuments({ studies, hash: 'gold' }, dir, dir, 'pdf');
    assert.deepEqual(set.excluded, [{ pmcid: 1, reason: 'no_oa' }, { pmcid: 2, reason: 'no_pdf' },
      { pmcid: 3, reason: 'fetch_failed' }, { pmcid: 4, reason: 'text_failed' }, { pmcid: 5, reason: 'empty_text' }, { pmcid: 7, reason: 'fetch_failed' }]);
    assert.deepEqual(set.documents.get('PMC6'), [{ role: 'article', filename: 'PMC6.pdf', mode: 'text', pages: [{ page: 1, text: '本文' }] }]);
    assert.equal(set.hashes['pdf/PMC6'], sha256('pdf'));
  } finally { await rm(dir, { recursive: true, force: true }); }
});
