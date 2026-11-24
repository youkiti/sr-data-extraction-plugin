import assert from 'node:assert/strict';
import test from 'node:test';
import { filterItems, filterGoldItems, evaluationValues, usableDocuments, reportBelongsTo, type Study, type Reference, type Provenance, type Judgment } from './evaluationSet';
import { buildFields, buildOutcomeList, cleanFootnotes, resolveContext, schemaInput, protocolContext } from './schema';
import { buildStudyRequest, EXTRACT_DATA_TEMPERATURE } from './prompt';
import { buildExtractDataSystemPrompt, buildExtractDataUserContent, extractDataResponseSchema } from '../../../src/features/extraction/skills/extractData';
import { applyRecheckLabels, assertRechecked } from './recheck';
import { assertLabels } from './goldLock';
import { evaluationCounts, sha256 } from './io';
import { requestHashes, checkManifest, assertInputHash } from './resume';
import type { EvaluationSet } from './io';

export function fixture() {
  const item = { row_id: 'REV1:r:1', data_type: 'continuous', fields: ['experimental_mean', 'control_mean'],
    analysis_name: 'Outcome', subgroup: 'Follow-up', analysis_group_name: 'A versus B', footnotes: '<b>Keep</b> &amp; &#x41;' };
  const study: Study = { tier: 'cc-by', reviewId: 'REV1', stem: 'S1', studyKey: 'cc-by/REV1/S1', taskPath: 'task.json',
    task: { pmcid: 'REV1', tier: 'cc-by', study_id: 'S1', documents: [{ pmcid: 'DOC1', pdf_path: 'doc.pdf' }],
      items: [item], gold: { 'REV1:r:1': { experimental_mean: '987654', control_mean: '2' } } },
    items: [item], context: { timing_rules: ['Use follow-up'], outcome_definitions: 'Definition' } };
  const refs: Reference[] = item.fields.map((field) => ({ task_id: 'REV1_t', item: 1, field, row_id: item.row_id,
    gold: study.task.gold[item.row_id]![field]!, label: 'reported' }));
  const provenance: Provenance[] = [{ row_id: item.row_id, values: study.task.gold[item.row_id]!, provenance: 'unknown' }];
  return { study, refs, provenance };
}

test('評価項目の型フィルターと PDF・文字層による除外', () => {
  const { study } = fixture();
  assert.equal(filterItems([...study.items, { row_id: 'x', fields: [], data_type: 'giv' }]).length, 1);
  assert.equal(filterItems([{ row_id: 'x', fields: [], data_type: 'dta' }]).length, 0);
  assert.equal(usableDocuments(study, [{ exists: false, pages: [] }]).reason, 'no_pdf');
  assert.equal(usableDocuments(study, [{ exists: true, pages: [{ page: 1, text: ' ' }] }]).reason, 'no_text_layer');
  const result = usableDocuments(study, [{ exists: true, pages: [{ page: 1, text: 'text' }] }]);
  assert.equal(result.reason, null); assert.equal(result.documents[0]!.pmcid, 'DOC1');
  study.task.documents[0]!.pdf_path = null;
  assert.equal(usableDocuments(study, [{ exists: true, pages: [{ page: 1, text: 'text' }] }]).reason, 'no_pdf');
});
test('参照・出所の結合と gold の三者一致', () => {
  const { study, refs, provenance } = fixture();
  const values = evaluationValues(study, refs, provenance, []);
  assert.equal(values[0]!.gold, '987654'); assert.equal(values[0]!.label, 'reported');
  assert.equal(values[0]!.provenance, 'unknown'); assert.equal(values[0]!.itemIndex, 1);
  assert.equal(values[0]!.valueKind, 'mean'); assert.equal(values[1]!.group, 'control');
  assert.throws(() => evaluationValues(study, [], provenance, []), /参照ラベル行/);
  assert.throws(() => evaluationValues(study, refs.map((r) => ({ ...r, gold: '3' })), provenance, []), /gold/);
  assert.throws(() => evaluationValues(study, refs, [{ ...provenance[0]!, values: {} }], []), /gold/);
});
test('全 gold が空の項目を落とし、残った項目を連番にする', () => {
  const { study, refs, provenance } = fixture();
  const empty = { ...study.items[0]!, row_id: 'empty' };
  study.items.unshift(empty);
  study.task.gold.empty = { experimental_mean: '', control_mean: ' \t' };
  const filtered = filterGoldItems(study);
  assert.deepEqual(filtered.emptyGold, { items: 1, values: 2 });
  study.items = filtered.items;
  assert.equal(study.items.length, 1);
  assert.equal(buildOutcomeList(study.items)[0]!.outcomeId, 'o1');
  assert.ok(evaluationValues(study, refs, provenance, []).every((value) => value.itemIndex === 1));
});
test('一部の空 gold は参照行も整合性検査も不要で、非空値だけを残す', () => {
  const { study, refs, provenance } = fixture();
  study.task.gold['REV1:r:1']!.control_mean = ' ';
  const filtered = filterGoldItems(study);
  assert.deepEqual(filtered.emptyGold, { items: 0, values: 1 });
  assert.deepEqual(filtered.items[0]!.fields, ['experimental_mean']);
  const values = evaluationValues(study, refs.slice(0, 1), [{ ...provenance[0]!, values: { experimental_mean: '987654' } }], []);
  assert.equal(values.length, 1); assert.equal(values[0]!.field, 'experimental_mean');
});
test('唯一の項目が全空 gold の研究は no_gold で除外する', () => {
  const { study } = fixture();
  study.task.gold['REV1:r:1'] = { experimental_mean: '', control_mean: ' ' };
  assert.deepEqual(evaluationValues(study, [], [], []), []);
  study.items = filterGoldItems(study).items;
  assert.equal(usableDocuments(study, []).reason, 'no_gold');
});
test('figureOnly は reported 読み手の figure 全員一致・text 優先・不明を区別', () => {
  const { study, refs, provenance } = fixture();
  const judgment = (source: string, label = 'reported'): Judgment => ({ task_id: 'REV1_t', item: 1, field: 'experimental_mean', label, source });
  const value = (judgments: Judgment[]) => evaluationValues(study, refs, provenance, judgments)[0]!.figureOnly;
  assert.equal(value([judgment('figure'), judgment('figure')]), true);
  assert.equal(value([judgment('figure'), judgment('text')]), false);
  assert.equal(value([judgment('figure', 'derivable')]), null);
  assert.equal(value([]), null);
  refs[0]!.label = 'derivable'; assert.equal(value([judgment('figure')]), null);
});
test('スキーマの固定順・部分集合と群ラベルの三段フォールバック', () => {
  const { study } = fixture();
  const fields = buildFields(study.items);
  assert.deepEqual(fields.map((f) => [f.fieldId, f.fieldIndex]), [['experimental_mean', 2], ['control_mean', 6]]);
  assert.ok(fields.every((field) => field.dataType === 'float' && field.entityLevel === 'outcome_result'));
  assert.deepEqual(buildFields([{ row_id: 'row', data_type: 'continuous', fields: ['control_sd', 'control_n', 'experimental_sd', 'experimental_mean',
    'experimental_n', 'experimental_cases', 'control_mean', 'control_cases'] }]).map((field) => field.fieldId),
  ['experimental_cases', 'experimental_n', 'experimental_mean', 'experimental_sd', 'control_cases', 'control_n', 'control_mean', 'control_sd']);
  study.items[0]!.experimental_group_label = 'Label'; study.items[0]!.experimental_intervention = 'Intervention';
  assert.match(buildOutcomeList(study.items)[0]!.description!, /Experimental group: Label/);
  study.items[0]!.experimental_group_label = '';
  assert.match(buildOutcomeList(study.items)[0]!.description!, /Experimental group: Intervention/);
  study.items[0]!.experimental_intervention = '';
  const outcome = buildOutcomeList(study.items)[0]!;
  assert.match(outcome.description!, /Experimental group: the intervention named first/);
  assert.match(outcome.description!, /Control group: the intervention named second/);
  assert.equal(outcome.outcomeId, 'o1'); assert.equal(outcome.outcomeLabel, 'Outcome - Follow-up');
  study.items[0]!.control_group_label = 'Control label'; study.items[0]!.control_intervention = 'Control intervention';
  assert.match(buildOutcomeList(study.items)[0]!.description!, /Control group: Control label/);
  study.items[0]!.control_group_label = '';
  assert.match(buildOutcomeList(study.items)[0]!.description!, /Control group: Control intervention/);
});
test('脚注の HTML 除去と実体参照、文脈の整合性、gold の非漏洩', () => {
  const { study } = fixture();
  assert.equal(cleanFootnotes('<b>A</b> &amp; &lt; &gt; &quot; &#39; &#65; &#x42;'), 'A & < > " \' A B');
  assert.deepEqual(resolveContext([null, study.context, { outcome_definitions: 'Definition', timing_rules: ['Use follow-up'] }]), study.context);
  assert.throws(() => resolveContext([study.context, { timing_rules: ['different'] }]), /一致しません/);
  assert.equal(protocolContext(null), null);
  assert.equal(protocolContext(study.context), 'Timing rules from the review:\nUse follow-up\nOutcome definitions from the review:\nDefinition');
  const output = JSON.stringify(schemaInput(study));
  for (const secret of ['987654', 'reported', 'derived_suspected', 'not_in_documents']) assert.ok(!output.includes(secret));
});
test('本番と同じプロンプトと生成設定を組み立てる', () => {
  const { study } = fixture();
  const docs = [{ pmcid: 'DOC1', pdf_path: 'doc.pdf', pages: [{ page: 1, text: 'Synthetic text' }] }];
  const request = buildStudyRequest(study, docs);
  assert.deepEqual(request.messages, [
    { role: 'system', content: buildExtractDataSystemPrompt(false, false) },
    { role: 'user', content: buildExtractDataUserContent({ ...schemaInput(study), documents: [{ role: 'article', filename: 'DOC1.pdf', mode: 'text', pages: docs[0]!.pages }] }) },
  ]);
  assert.deepEqual(request.chatOptions, { temperature: EXTRACT_DATA_TEMPERATURE, responseSchema: extractDataResponseSchema(false) });
  assert.equal(request.chatOptions.temperature, 0); assert.ok(!('maxOutputTokens' in request.chatOptions));
});

test('再チェックは文書省略・上流ラベル・同ラベルの根拠文書の三条件で判定する', () => {
  const { study, refs, provenance } = fixture();
  study.task.documents.push({ pmcid: 'DOC2', pdf_path: null });
  const judgment = (report_file: string, label = 'reported'): Judgment => ({ task_id: refs[0]!.task_id, item: 1,
    field: 'experimental_mean', label, report_file });
  const needs = (judgments: Judgment[], passed = ['DOC1']) => evaluationValues(study, refs, provenance, judgments, passed)[0]!.needsRecheck;
  assert.equal(needs([]), true);
  assert.equal(needs([], ['DOC1', 'DOC2']), false);
  assert.equal(needs([judgment('report_DOC1.txt')]), false);
  assert.equal(needs([judgment('folder/fig_DOC1_table.png')]), false);
  assert.equal(needs([judgment('report_DOC10.txt')]), true);
  assert.equal(needs([judgment('fig_DOC10_table.png')]), true);
  assert.equal(reportBelongsTo('report_DOC_1.txt', 'DOC_1'), true);
  assert.equal(reportBelongsTo('fig_DOC_1_table.png', 'DOC_1'), true);
  assert.equal(reportBelongsTo('fig_DOC_10_table.png', 'DOC_1'), false);
  assert.equal(needs([judgment('report_DOC1.txt', 'derivable')]), true);
  for (const label of ['different_value', 'not_in_documents', null] as const) {
    refs[0]!.label = label; assert.equal(needs([]), false);
  }
  refs[0]!.label = 'derivable';
  assert.equal(needs([judgment('report_DOC2.txt', 'derivable')]), true);
  assert.equal(needs([judgment('fig_DOC1_table.png', 'derivable')]), false);
});

test('再チェックラベルの置換・不要値の拒否・lock と score 共通の未完了検査', () => {
  const { study, refs, provenance } = fixture();
  study.task.documents.push({ pmcid: 'DOC2', pdf_path: null });
  const values = evaluationValues(study, refs, provenance, [], ['DOC1']);
  assert.throws(() => assertRechecked(values), /2 件.*recheck-labels.jsonl/);
  const labels = values.map((value) => ({ rowId: value.rowId, field: value.field, label: 'not_in_documents' as const }));
  const updated = applyRecheckLabels(values, labels);
  assertRechecked(updated); assertLabels(updated);
  assert.ok(updated.every((value) => value.label === 'not_in_documents' && value.upstreamLabel === 'reported' && value.relabelled));
  assert.throws(() => applyRecheckLabels(values.map((value) => ({ ...value, needsRecheck: false })), labels), /不要/);
  assert.throws(() => applyRecheckLabels(values, [labels[0]!, labels[0]!]), /重複/);
  assert.throws(() => assertLabels([{ ...updated[0]!, upstreamLabel: null }]), /未裁定/);
  const set: EvaluationSet = { studies: [study], values: updated, documents: new Map(), hashes: {}, excluded: [], emptyGold: {} };
  const counts = evaluationCounts(set)['cc-by']!;
  assert.equal(counts.rechecked, 2); assert.equal(counts.recheckTransitions['reported → not_in_documents'], 2);
});

test('manifest は依頼本文・設定とモデル部分集合を固定し、固定入力ハッシュも検査する', () => {
  const { study } = fixture();
  const set: EvaluationSet = { studies: [study], values: [], documents: new Map([[study.studyKey,
    [{ ...study.task.documents[0]!, pages: [{ page: 1, text: 'Synthetic' }] }]]]), hashes: {}, excluded: [], emptyGold: {} };
  const hashes = requestHashes(set);
  const { messages, chatOptions } = buildStudyRequest(study, set.documents.get(study.studyKey)!);
  assert.equal(Object.values(hashes)[0], sha256(JSON.stringify({ messages, chatOptions })));
  const manifest = { hashes, promptVersion: 17, harnessCommit: null, excluded: [], emptyGold: {} };
  const original = study.context;
  study.context = { timing_rules: ['Changed'] };
  assert.throws(() => checkManifest(manifest, { ...manifest, hashes: requestHashes(set) }), /ハッシュ/);
  study.context = original;
  study.items[0]!.analysis_name = 'Changed';
  assert.notDeepEqual(hashes, requestHashes(set));
  assert.throws(() => checkManifest(manifest, { ...manifest, hashes: {} }), /ハッシュ/);
  assertInputHash('cc-by', 'task3_numeric.jsonl', 'e28acce8f901rest');
  assertInputHash('cc-by-nc', 'task3_numeric.jsonl', 'eb03d74d5d4brest');
  assertInputHash('cc-by', 'final.jsonl', '8fa31935d224rest');
  assert.throws(() => assertInputHash('cc-by', 'final.jsonl', 'wrong'), /接頭辞/);
});
