import test from 'node:test';
import assert from 'node:assert/strict';
import { buildExtractDataSystemPrompt, buildExtractDataUserContent, extractDataResponseSchema } from '../../../src/features/extraction/skills/extractData';
import { EXTRACT_DATA_TEMPERATURE } from '../../../src/features/extraction/executeRun';
import { ALLOW_CALC_RULE_SENTENCE, DEFAULT_RULE_SENTENCE, buildStudyRequest, systemPrompt } from './prompt';
import type { Document, Study } from './dataset';

const study: Study = { pmcid: 2, studyKey: 'PMC2', icos: [{ id: 1, outcomeId: 'o1', outcome: 'outcome', intervention: 'drug', comparator: 'placebo', outcome_type: 'binary' }] };
const documents: Document[] = [{ role: 'article', filename: 'PMC2.md', mode: 'text', pages: [{ page: 1, text: '本文' }] }];

test('default の依頼は従来のシステム・ユーザーメッセージと設定に完全一致する', () => {
  const request = buildStudyRequest(study, documents, 'default');
  assert.equal(systemPrompt('default'), buildExtractDataSystemPrompt(false, false));
  assert.deepEqual(request.messages, [
    { role: 'system', content: buildExtractDataSystemPrompt(false, false) },
    { role: 'user', content: buildExtractDataUserContent({ fields: request.fields, outcomeList: [{ outcomeId: 'o1', outcomeLabel: 'outcome',
      description: 'Intervention group: drug | Comparator group: placebo | Outcome: outcome | Data type: binary', typicalTimepoints: null }], protocolContext: null, documents }) },
  ]);
  assert.deepEqual(request.chatOptions, { temperature: EXTRACT_DATA_TEMPERATURE, responseSchema: extractDataResponseSchema(false) });
});

test('allow-calc は指定の一文だけを置換し、他の依頼内容は変更しない', () => {
  const original = buildStudyRequest(study, documents, 'default');
  const changed = buildStudyRequest(study, documents, 'allow-calc');
  const content = changed.messages[0]!.content;
  assert.equal(typeof content, 'string');
  assert.equal(content, systemPrompt('allow-calc'));
  assert.equal((content as string).split(ALLOW_CALC_RULE_SENTENCE).length, 2);
  assert.ok(!(content as string).includes(DEFAULT_RULE_SENTENCE));
  assert.equal((content as string).replace(ALLOW_CALC_RULE_SENTENCE, DEFAULT_RULE_SENTENCE), original.messages[0]!.content);
  assert.deepEqual({ ...changed, messages: original.messages }, original);
  assert.deepEqual(changed.messages.slice(1), original.messages.slice(1));
});

test('allow-calc は置換対象文がない場合も複数ある場合も拒否する', () => {
  assert.throws(() => systemPrompt('allow-calc', '対象文なし'), /正確に 1 回/);
  assert.throws(() => systemPrompt('allow-calc', `${DEFAULT_RULE_SENTENCE}\n${DEFAULT_RULE_SENTENCE}`), /正確に 1 回/);
});

test('依頼構築の既定引数は環境変数を反映する', () => {
  const before = process.env.BENCH_PROMPT_VARIANT;
  try {
    delete process.env.BENCH_PROMPT_VARIANT;
    assert.deepEqual(buildStudyRequest(study, documents), buildStudyRequest(study, documents, 'default'));
    process.env.BENCH_PROMPT_VARIANT = 'allow-calc';
    assert.deepEqual(buildStudyRequest(study, documents), buildStudyRequest(study, documents, 'allow-calc'));
  } finally { if (before === undefined) delete process.env.BENCH_PROMPT_VARIANT; else process.env.BENCH_PROMPT_VARIANT = before; }
});
