import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { normalized, quoteInText, toDecimal, textNumbers, quoteNumbers, matches, buildPrompt, parseResponse, judgeField, consensus, kappa, readOwner, makeLabels } from './recheckReaders';
import { runCli } from './recheckReadersCli';
import { readJson, jsonLines } from './io';

const field = 'experimental_mean';
const answer = (entry: Record<string, unknown> = {}) => ({ item: 1, reason: 'Synthetic', fields: { [field]: { label: 'reported', document_value: '12', report_file: 'report_DOC1.txt', quote: 'Twelve participants: 12', ...entry } } });
const judge = (entry: Record<string, unknown> = {}, gold = '12') => judgeField(field, gold, answer(entry), ['report_DOC1.txt'], { 'report_DOC1.txt': normalized('Twelve participants: 12. Other value 14. Derived from groups.') });

test('正規化と引用、数字・数詞の読み', () => {
  assert.equal(normalized(' A–B\n C−D '), 'a-b c-d');
  assert.equal(normalized('Straße ﬃ ς ı'), 'strasse ffi σ ı');
  assert.ok(quoteInText('A—B   C', normalized('a-b\n c')));
  assert.equal(quoteInText(' ', 'text'), false);
  assert.equal(toDecimal('-000.00'), '0'); assert.equal(toDecimal('+02.50'), '2.5');
  assert.equal(toDecimal('−1,234.50'), '-1234.5');
  for (const value of [true, null, 'NaN', 'Infinity', '1e2']) assert.equal(toDecimal(value), null);
  assert.deepEqual([...textNumbers('1,234')], ['1234']);
  assert.deepEqual([...textNumbers('150,150')], ['150150', '150']);
  assert.deepEqual([...textNumbers('150,151')], ['150151', '150', '151']);
  assert.deepEqual([...textNumbers('2·50')], ['2.5']);
  assert.ok(quoteNumbers('twelve and NONE').has('12')); assert.ok(quoteNumbers('twelve and NONE').has('0'));
});
test('文字列の丸めは gold の末尾のゼロと二つの丸め方を尊重する', () => {
  assert.equal(matches('experimental_cases', '12.4', '12'), false);
  for (const [p, g] of [['6.43', '6.4'], ['291.96', '292.0'], ['2.675', '2.68'], ['2.65', '2.6'], ['2.65', '2.7'], ['-2.675', '-2.68'], ['9.99', '10.0']]) assert.ok(matches(field, p, g), `${p}, ${g}`);
  assert.equal(matches(field, '6.43', '6.5'), false);
  assert.equal(matches(field, null, '1'), false);
});
test('値の検査は全問題と reported の再分類を区別する', () => {
  assert.equal(judgeField(field, '12', null, [], {}).problem, 'missing_item');
  assert.equal(judgeField(field, '12', {}, [], {}).problem, 'missing_field');
  for (const [entry, problem] of [
    [{ label: 'bad' }, 'bad_label'], [{ report_file: 'bad.txt' }, 'bad_file'], [{ quote: 'missing' }, 'quote_not_found'],
    [{ document_value: 'no' }, 'value_not_numeric'], [{ label: 'different_value', document_value: '13' }, 'value_not_in_quote'],
    [{ document_value: '14', quote: 'Other value 14' }, 'value_differs_from_gold'], [{ label: 'different_value' }, 'value_equals_gold'],
  ] as [Record<string, unknown>, string][]) assert.equal(judge(entry).problem, problem);
  assert.equal(judge({ quote: 'Derived from groups' }).label, 'derivable');
  assert.equal(judge({ quote: 'Derived from groups' }).label_as_given, 'reported');
  assert.equal(judge({ quote: 'Twelve participants' }).label, 'reported');
  assert.equal(judge({ document_value: '-12' }, '-12').problem, null);
  assert.equal(judge({ label: 'not_in_documents' }).document_value, null);
  assert.equal(judge({ label: 'different_value', document_value: '14', quote: 'Other value 14' }).problem, null);
});
test('応答のフェンス、BOM、項目番号を検査する', () => {
  assert.ok(parseResponse('\uFEFF```json\n' + JSON.stringify({ answers: [{ item: '1' }] }) + '\n```', 1).has(1));
  for (const answers of [[{ item: 1 }, { item: '1' }], [{ item: 0 }], [{ item: 2 }], [{ item: '1.0' }], [{ item: 1.5 }]]) assert.throws(() => parseResponse(JSON.stringify({ answers }), 1));
  assert.throws(() => parseResponse('{}', 1));
  assert.ok(buildPrompt('/input', 2, ['report_DOC1.txt']).includes('2 item(s)'));
});
test('合議は照合後ラベルと different_value の数を使い、元ラベルで κ を数える', () => {
  const reported = judge(), derived = judge({ label: 'derivable' }), absent = judge({ label: 'not_in_documents' });
  assert.equal(consensus(reported, reported).status, 'agreed');
  assert.deepEqual(consensus(reported, derived), { status: 'split', label: null, singleValid: false });
  assert.equal(consensus(reported, absent).singleValid, true);
  assert.equal(consensus(reported).status, 'incomplete'); assert.equal(consensus(reported).singleValid, true);
  assert.equal(consensus(absent, { ...reported, problem: 'bad_file' }).singleValid, false);
  const different = judge({ label: 'different_value', document_value: '14', quote: 'Other value 14' });
  assert.equal(consensus(different, { ...different, document_value: '14.0' }).status, 'agreed');
  assert.equal(consensus(different, { ...different, document_value: '15' }).status, 'split');
  assert.equal(consensus(judge({ quote: 'Derived from groups' }), derived).status, 'agreed');
  assert.deepEqual(kappa([]), { agreement: null, kappa: null });
  assert.deepEqual(kappa([['reported', 'reported']]), { agreement: 1, kappa: null });
  assert.deepEqual(kappa([['reported', 'reported'], ['reported', 'derivable'], ['derivable', 'derivable'], ['derivable', 'reported']]), { agreement: 0.5, kappa: 0 });
});
test('本人判定の各形式、新旧、未知キー、不正ラベル、不足、出力順', () => {
  const row = { rowId: 'r1', field, label: 'reported' };
  const latest = { ...row, label: 'derivable', savedAt: '2026-11-25T01:00:00Z' };
  const older = { ...row, savedAt: '2026-11-24T01:00:00Z' };
  const owner = readOwner(JSON.stringify([{ key: 'x', value: JSON.stringify(latest) }, { value: older }]));
  assert.equal(owner.get('r1\t' + field)!.label, 'derivable');
  assert.equal(readOwner(JSON.stringify([older, latest, row])).get('r1\t' + field)!.label, 'derivable');
  assert.equal(readOwner(JSON.stringify(row) + '\n' + JSON.stringify({ ...row, label: 'not_in_documents' })).get('r1\t' + field)!.label, 'not_in_documents');
  const values = [{ rowId: 'r1', field, label: 'reported' as const, status: 'agreed' }];
  const result = makeLabels(values, owner);
  assert.equal(result.overrides, 1); assert.equal(result.owner, 1); assert.equal(result.automatic, 0);
  assert.equal(JSON.stringify(result.labels[0]), '{"rowId":"r1","field":"experimental_mean","label":"derivable"}');
  assert.deepEqual(Object.keys(result.labels[0]!), ['rowId', 'field', 'label']);
  assert.equal(makeLabels(values, readOwner('[]')).automatic, 1);
  assert.throws(() => makeLabels([{ ...values[0]!, status: 'split', label: null }], readOwner('[]')), /1/);
  assert.throws(() => makeLabels([], owner), /凍結/);
  assert.throws(() => readOwner(JSON.stringify([{ ...row, label: 'bad' }])));
  assert.throws(() => readOwner(JSON.stringify([{ ...row, savedAt: 'bad' }])));
});

test('合成ファイルで凍結から取り込み、合議、本人判定、書き出しまで通す', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'recheck-test-'));
  try {
    const work = path.join(dir, 'recheck-readers'), logs: string[] = [];
    const run = (args: string[]) => runCli([...args, '--outputs', dir], { log: (s) => logs.push(s), studies: async () => [{ studyKey: 'cc-by/REV1/S1', context: { timing_rules: ['Follow-up'] } }] });
    const item = { study: 'Synthetic', data_type: 'continuous', analysis_name: 'Outcome', footnotes: '<b>Follow-up</b>', fields: [field, 'control_mean', 'experimental_sd'] };
    const fields = [field, 'control_mean'];
    const rows = fields.map((f) => ({ tier: 'cc-by', studyKey: 'cc-by/REV1/S1', rowId: 'REV1:r:1', field: f, item, gold: '12', upstreamLabel: 'reported', passedDocIds: ['DOC1'] }));
    await writeFile(path.join(dir, 'recheck-needed.jsonl'), rows.map((r) => JSON.stringify(r)).join('\n'));
    await mkdir(path.join(dir, 'textlayer'));
    await writeFile(path.join(dir, 'textlayer', 'cc-by__DOC1.json'), JSON.stringify({ pages: [{ page: 1, text: 'Twelve participants: 12' }] }));
    assert.equal(await run(['freeze']), 0);
    await assert.rejects(run(['freeze']), /既に/);
    assert.equal(await run(['freeze', '--force']), 0);
    const frozen = await readJson<{ tasks: { id: string }[] }>(path.join(work, 'frozen.json')), id = frozen.tasks[0]!.id;
    const input = path.join(work, 'inputs', id);
    const check = await readJson<{ items: { fields: string[]; review_note: string }[]; review_context: unknown }>(path.join(input, 'check.json'));
    assert.deepEqual(check.items[0]!.fields, fields); assert.equal(check.items[0]!.review_note, 'Follow-up'); assert.ok(check.review_context);
    assert.equal(await readFile(path.join(input, 'report_DOC1.txt'), 'utf8'), '[PAGE 1]\nTwelve participants: 12\n');
    assert.equal(await run(['ingest', '--reader', 'missing']), 1);
    for (const reader of ['a', 'b']) {
      await mkdir(path.join(work, 'responses', reader), { recursive: true });
      const first = answer().fields[field]!;
      const fields = { [field]: first, control_mean: reader === 'a' ? first : { label: 'not_in_documents' } };
      await writeFile(path.join(work, 'responses', reader, id + '.json'), JSON.stringify({ answers: [{ item: 1, fields }] }));
      assert.equal(await run(['ingest', '--reader', reader]), 0);
    }
    await assert.rejects(run(['freeze', '--force']), /退避/);
    assert.equal(await run(['summarize', '--reader-a', 'a', '--reader-b', 'b']), 0);
    const summary = await readJson<{ total: number; owner: number; agreement: number }>(path.join(work, 'summary.json'));
    assert.equal(summary.total, 2); assert.equal(summary.owner, 1); assert.equal(summary.agreement, 0.5);
    const queue = await readJson<{ context: Record<string, unknown>; singleValid: boolean; readerA: { quote: string } }[]>(path.join(work, 'owner-queue.json'));
    assert.equal(queue.length, 1); assert.equal(queue[0]!.singleValid, true); assert.ok(queue[0]!.readerA.quote); assert.equal('gold' in queue[0]!.context, false);
    const docs = await readJson<Record<string, { file: string; text: string }[]>>(path.join(work, 'owner-docs.json'));
    assert.equal(docs[id]![0]!.file, 'report_DOC1.txt');
    const owner = path.join(dir, 'owner.json');
    await writeFile(owner, '[]');
    await assert.rejects(run(['labels', '--adjudications', owner]), /不足/);
    await writeFile(owner, JSON.stringify([{ rowId: 'REV1:r:1', field: 'control_mean', label: 'not_in_documents' }]));
    assert.equal(await run(['labels', '--adjudications', owner]), 0);
    const labels = await jsonLines<Record<string, unknown>>(path.join(dir, 'recheck-labels.jsonl'));
    assert.deepEqual(labels.map((r) => r.field), fields); assert.deepEqual(Object.keys(labels[0]!), ['rowId', 'field', 'label']);
    await assert.rejects(run(['labels', '--adjudications', owner]), /既に/);
    assert.equal(await run(['labels', '--adjudications', owner, '--force']), 0);
    const frozenFile = path.join(work, 'frozen.json'), original = await readFile(frozenFile, 'utf8');
    await writeFile(frozenFile, original + '\n');
    await assert.rejects(run(['summarize', '--reader-a', 'a', '--reader-b', 'b']), /ハッシュ/);
    await writeFile(frozenFile, original);
    await writeFile(path.join(work, 'responses', 'a', id + '.json'), '{}');
    assert.equal(await run(['ingest', '--reader', 'a']), 1);
    await writeFile(path.join(input, 'report_DOC1.txt'), 'changed');
    await assert.rejects(run(['ingest', '--reader', 'a']), /ハッシュ/);
  } finally { await rm(dir, { recursive: true, force: true }); }
});
