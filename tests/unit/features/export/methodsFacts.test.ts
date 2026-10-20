import type { LlmApiLogEntry } from '../../../../src/domain/llmApiLog';
import type { MethodsRunFact } from '../../../../src/features/extraction/runRepository';
import {
  buildMethodsFacts,
  providerDisplayName,
  type MethodsFactsInput,
} from '../../../../src/features/export/methodsFacts';

function makeRun(overrides: Partial<MethodsRunFact> = {}): MethodsRunFact {
  return {
    runId: 'run-1',
    runType: 'full',
    status: 'done',
    provider: 'gemini',
    requestedModel: 'gemini-3.8-flash',
    modelVersion: 'gemini-3.8-flash-001',
    studyIds: ['s1'],
    fieldIds: null,
    startedAt: '2026-07-10T00:00:00.000Z',
    ...overrides,
  };
}

function makeLog(overrides: Partial<LlmApiLogEntry> = {}): LlmApiLogEntry {
  return {
    logId: 'log-1',
    timestamp: '2026-07-01T00:00:00.000Z',
    provider: 'gemini',
    model: 'gemini-3.8-flash',
    purpose: 'extract_study',
    promptRef: 'https://drive/prompt',
    responseRef: 'https://drive/response',
    promptSummary: null,
    tokensIn: null,
    tokensOut: null,
    cachedTokensIn: null,
    latencyMs: null,
    costEstimateUsd: null,
    error: null,
    runId: null,
    studyId: null,
    section: null,
    promptVersion: null,
    thoughtsTokensOut: null,
    ...overrides,
  };
}

/** extractionService の recordBatchFailure が書く行（警告専用行 = payload 参照が空） */
function batchFailed(runId: string | null, studyId: string | null, section: string | null = null): LlmApiLogEntry {
  return makeLog({
    promptRef: '',
    responseRef: '',
    promptSummary: `[batch_failed] run ${runId ?? ''}`,
    error: 'バッチ失敗（api_error）: 500',
    runId,
    studyId,
    section,
  });
}

function makeInput(overrides: Partial<MethodsFactsInput> = {}): MethodsFactsInput {
  return {
    toolVersion: '1.0.0',
    activeStudyIds: ['s1', 's2', 's3'],
    documents: [],
    runFacts: [],
    logs: [],
    versions: [{ createdByType: 'user_edit', createdAt: '2026-07-01T00:00:00.000Z' }],
    chatAssistDecisionCount: 0,
    unverifiedCellCount: 0,
    annotationRows: [],
    ...overrides,
  };
}

describe('buildMethodsFacts: 事前抽出の成否', () => {
  test('done の run の研究は成功。採用研究（アクティブ）でない研究は数えない', () => {
    const facts = buildMethodsFacts(
      makeInput({ runFacts: [makeRun({ studyIds: ['s1', 's2', 'inactive'] })] }),
    );
    expect(facts.includedStudyCount).toBe(3);
    expect(facts.extractedStudyCount).toBe(2);
    expect(facts.partialStudyCount).toBe(0);
  });

  test('[batch_failed] のある研究はその run では失敗。別の run で成功すれば成功に数える', () => {
    const facts = buildMethodsFacts(
      makeInput({
        runFacts: [
          makeRun({ runId: 'r2', status: 'done', studyIds: ['s2'] }),
          makeRun({ runId: 'r1', status: 'partial_failure', studyIds: ['s1', 's2', 's3'] }),
        ],
        logs: [batchFailed('r1', 's2'), batchFailed('r1', 's3')],
      }),
    );
    // s1 = r1 で成功、s2 = r1 で失敗・r2 で成功、s3 = 失敗のみ
    expect(facts.extractedStudyCount).toBe(2);
    // r1 は失敗を研究単位で特定できるため、s1 は全項目の実行とみなす
    expect(facts.partialStudyCount).toBe(0);
  });

  test('run_id / study_id の無い旧 [batch_failed] 行・別の要約の行は突き合わせに使わない', () => {
    const facts = buildMethodsFacts(
      makeInput({
        runFacts: [makeRun({ runId: 'r1', status: 'partial_failure', studyIds: ['s1'] })],
        logs: [
          batchFailed(null, 's1'),
          batchFailed('r1', null),
          makeLog({ promptSummary: '[transfer_failed] run r1', runId: 'r1', studyId: 's1' }),
        ],
      }),
    );
    // 失敗は研究単位で特定できない → 成功に数えるが、全項目とはみなさない
    expect(facts.extractedStudyCount).toBe(1);
    expect(facts.partialStudyCount).toBe(1);
  });

  test('ある節が失敗しても別の節が成功した研究は抽出済みかつ部分として数え、モデルも含める', () => {
    const facts = buildMethodsFacts(
      makeInput({
        runFacts: [makeRun({ status: 'partial_failure', modelVersion: 'partial-model' })],
        // 成功行が失敗行より先でも、失敗した節を除外する。
        logs: [
          makeLog({ runId: 'run-1', studyId: 's1', section: 'methods' }),
          batchFailed('run-1', 's1', 'results'),
        ],
      }),
    );
    expect(facts.extractedStudyCount).toBe(1);
    expect(facts.partialStudyCount).toBe(1);
    expect(facts.modelIds).toEqual(['partial-model']);
  });

  test.each<Partial<LlmApiLogEntry>>([
    { section: 'results' },
    { purpose: 'draft_schema' },
    { error: '500' },
    { promptRef: '', responseRef: '' },
    { runId: null },
    { studyId: null },
    { runId: 'other-run' },
    { studyId: 's2' },
  ])('失敗していない節の成功行が無い研究は未抽出（対象外の行: %j）', (overrides) => {
    const facts = buildMethodsFacts(
      makeInput({
        runFacts: [makeRun({ status: 'partial_failure' })],
        logs: [
          batchFailed('run-1', 's1', 'results'),
          makeLog({ runId: 'run-1', studyId: 's1', section: 'methods', ...overrides }),
        ],
      }),
    );
    expect(facts.extractedStudyCount).toBe(0);
    expect(facts.partialStudyCount).toBe(0);
    expect(facts.modelIds).toEqual([]);
  });

  test.each(['done', 'partial_failure'] as const)(
    '転記失敗と別研究のバッチ失敗が併存すれば、失敗していない研究も全項目に数えない（%s）',
    (status) => {
      const facts = buildMethodsFacts(
        makeInput({
          runFacts: [makeRun({ status, studyIds: ['s1', 's2'] })],
          logs: [
            batchFailed('run-1', 's2', 'results'),
            makeLog({ promptSummary: '[transfer_failed] run run-1', runId: 'run-1' }),
          ],
        }),
      );
      expect(facts.extractedStudyCount).toBe(1);
      expect(facts.partialStudyCount).toBe(1);
    },
  );

  test('バッチ失敗が無くても転記失敗のある done run は全項目の根拠にしない。run 不明の行は除く', () => {
    const facts = buildMethodsFacts(
      makeInput({
        runFacts: [makeRun()],
        logs: [
          makeLog({ promptSummary: '[transfer_failed] run run-1', runId: 'run-1' }),
          makeLog({ promptSummary: '[transfer_failed] run unknown' }),
        ],
      }),
    );
    expect(facts.extractedStudyCount).toBe(1);
    expect(facts.partialStudyCount).toBe(1);
  });

  test('field_ids 指定の run だけで抽出した研究は、全項目の事前抽出を確かめられない研究に数える', () => {
    const facts = buildMethodsFacts(
      makeInput({
        runFacts: [
          makeRun({ runId: 'r2', studyIds: ['s1'], fieldIds: ['f1'] }),
          makeRun({ runId: 'r1', studyIds: ['s1', 's2'], fieldIds: ['f1', 'f2'] }),
          makeRun({ runId: 'r0', studyIds: ['s2'], fieldIds: null }),
        ],
      }),
    );
    expect(facts.extractedStudyCount).toBe(2);
    expect(facts.partialStudyCount).toBe(1); // s1 のみ（s2 は r0 で全項目）
  });
});

describe('buildMethodsFacts: モデルと provider', () => {
  test('成功した run（全 run_type）のモデルを新しい順・重複除去で列挙し、無い版は requested_model で代用する', () => {
    const facts = buildMethodsFacts(
      makeInput({
        runFacts: [
          makeRun({ runId: 'r4', studyIds: ['s1'], modelVersion: null, requestedModel: 'claude-x', provider: 'anthropic' }),
          makeRun({ runId: 'r3', runType: 'single_study', studyIds: ['s2'], modelVersion: 'gpt-test', provider: 'openrouter' }),
          makeRun({ runId: 'r2', runType: 'pilot', studyIds: ['s3'] }),
          makeRun({ runId: 'r1', studyIds: ['s1'] }),
          // 全研究が失敗した run のモデルは書かない
          makeRun({ runId: 'r0', studyIds: ['s1'], modelVersion: 'failed-model', provider: 'azure_openai' }),
        ],
        logs: [batchFailed('r0', 's1')],
      }),
    );
    expect(facts.modelIds).toEqual(['claude-x', 'gpt-test', 'gemini-3.8-flash-001']);
    expect(facts.modelIdsIncludeRequested).toBe(true);
    expect(facts.providers).toEqual(['Anthropic', 'OpenRouter', 'Gemini']);
  });

  test('model_version も requested_model も空の run はモデルを書かず、代用の印も立てない。空の provider は除く', () => {
    const facts = buildMethodsFacts(
      makeInput({
        runFacts: [makeRun({ modelVersion: null, requestedModel: '', provider: '' as never })],
      }),
    );
    expect(facts.modelIds).toEqual([]);
    expect(facts.modelIdsIncludeRequested).toBe(false);
    expect(facts.providers).toEqual([]);
  });

  test('provider の表示名', () => {
    expect(providerDisplayName('gemini')).toBe('Gemini');
    expect(providerDisplayName('openrouter')).toBe('OpenRouter');
    expect(providerDisplayName('openai_compatible')).toBe('OpenAI-compatible');
    expect(providerDisplayName('anthropic')).toBe('Anthropic');
    expect(providerDisplayName('azure_openai')).toBe('Azure OpenAI');
    expect(providerDisplayName('local_llm')).toBe('Local LLM');
  });
});

describe('buildMethodsFacts: フォームの草案・パイロット・改訂', () => {
  test('成功した draft_schema 呼び出しのモデルを草案のモデルにする（エラー行・警告専用行は除く）', () => {
    const facts = buildMethodsFacts(
      makeInput({
        logs: [
          makeLog({ purpose: 'draft_schema', model: 'gemini-3.8-flash', provider: 'gemini' }),
          makeLog({ purpose: 'draft_schema', model: 'gemini-3.8-flash', provider: 'gemini' }),
          makeLog({ purpose: 'draft_schema', model: '', provider: 'local_llm' }),
          makeLog({ purpose: 'draft_schema', model: 'errored', error: '500' }),
          makeLog({ purpose: 'draft_schema', model: 'warning', promptRef: '', responseRef: '' }),
          makeLog({ purpose: 'extract_study', model: 'extract' }),
        ],
      }),
    );
    expect(facts.aiDraft).toBe(true);
    expect(facts.draftModelIds).toEqual(['gemini-3.8-flash']);
    expect(facts.draftProviders).toEqual(['Gemini', 'Local LLM']);
  });

  test('草案の呼び出し記録が無くても ai_draft の版があれば AI の草案ありとする（モデルは空）', () => {
    const facts = buildMethodsFacts(
      makeInput({ versions: [{ createdByType: 'ai_draft', createdAt: '2026-07-01T00:00:00.000Z' }] }),
    );
    expect(facts.aiDraft).toBe(true);
    expect(facts.draftModelIds).toEqual([]);
  });

  test('草案の記録が無ければ aiDraft は偽', () => {
    expect(buildMethodsFacts(makeInput()).aiDraft).toBe(false);
  });

  test('パイロットの研究数は成功した研究だけ。最初のパイロットより後の版があれば改訂ありとする', () => {
    const facts = buildMethodsFacts(
      makeInput({
        runFacts: [
          makeRun({ runId: 'p2', runType: 'pilot', studyIds: ['s3'], startedAt: '2026-07-05T00:00:00.000Z' }),
          makeRun({ runId: 'p1', runType: 'pilot', status: 'partial_failure', studyIds: ['s1', 's2'], startedAt: '2026-07-03T00:00:00.000Z' }),
          // 開始時刻の無い旧 run は比較に使わない
          makeRun({ runId: 'p0', runType: 'pilot', studyIds: ['s1'], startedAt: null }),
        ],
        logs: [batchFailed('p1', 's2')],
        versions: [
          { createdByType: 'pilot_revision', createdAt: '2026-07-04T00:00:00.000Z' },
          { createdByType: 'user_edit', createdAt: '2026-07-02T00:00:00.000Z' },
        ],
      }),
    );
    expect(facts.pilotStudyCount).toBe(2); // s1 / s3（s2 は失敗分）
    expect(facts.revisedAfterPilot).toBe(true);
    expect(facts.formRevisionCount).toBe(1);
    expect(facts.pilotRevisionCount).toBe(1);
  });

  test('パイロットより後の版が無い・パイロットの開始時刻が取れないときは改訂なしとする', () => {
    const later = buildMethodsFacts(
      makeInput({
        runFacts: [makeRun({ runType: 'pilot', startedAt: '2026-07-05T00:00:00.000Z' })],
        versions: [{ createdByType: 'user_edit', createdAt: '2026-07-01T00:00:00.000Z' }],
      }),
    );
    expect(later.revisedAfterPilot).toBe(false);
    const unknown = buildMethodsFacts(
      makeInput({ runFacts: [makeRun({ runType: 'pilot', startedAt: null })] }),
    );
    expect(unknown.pilotStudyCount).toBe(1);
    expect(unknown.revisedAfterPilot).toBe(false);
  });

  test('版が 1 つも無いときの改訂回数は 0', () => {
    expect(buildMethodsFacts(makeInput({ versions: [] })).formRevisionCount).toBe(0);
  });
});

describe('buildMethodsFacts: その他の値', () => {
  test('スキャン PDF・質問後の判定・未検証セル・人の行の種別をそのまま数える', () => {
    const facts = buildMethodsFacts(
      makeInput({
        documents: [{ textStatus: 'no_text_layer' }, { textStatus: 'ok' }, { textStatus: 'no_text_layer' }],
        chatAssistDecisionCount: 2,
        unverifiedCellCount: 5,
        annotationRows: [
          { annotator: 'ai', annotatorType: 'ai' },
          { annotator: 'a@example.com', annotatorType: 'human_with_ai' },
          { annotator: 'a@example.com', annotatorType: 'human_with_ai' },
          { annotator: 'b@example.com', annotatorType: 'human_independent' },
          { annotator: 'c@example.com', annotatorType: 'human_independent' },
        ],
      }),
    );
    expect(facts.toolVersion).toBe('1.0.0');
    expect(facts.scannedDocumentCount).toBe(2);
    expect(facts.chatAssistDecisionCount).toBe(2);
    expect(facts.unverifiedCellCount).toBe(5);
    expect(facts.humanWithAiAnnotatorCount).toBe(1);
    expect(facts.humanIndependentAnnotatorCount).toBe(2);
    expect(facts.hasConsensus).toBe(false);
    expect(
      buildMethodsFacts(
        makeInput({ annotationRows: [{ annotator: 'x@example.com', annotatorType: 'consensus' }] }),
      ).hasConsensus,
    ).toBe(true);
  });
});
