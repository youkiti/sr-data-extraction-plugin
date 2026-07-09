// executeRun（一括抽出の実行）の単体テスト
// - 正常系: プロンプト構築 → 構造化出力要求 → 応答検証 → アンカリング → Evidence 追記
// - partial_failure: バッチ失敗 4 種（load / api / format / save）と要素破棄の記録
// - 集計: 実測トークンの合算（null 許容）、modelVersion の採用、進捗通知
import type { Evidence } from '../../../../src/domain/evidence';
import type { SchemaField } from '../../../../src/domain/schemaField';
import {
  EXTRACT_DATA_TEMPERATURE,
  MAX_FAILURE_DETAIL_BODY_CHARS,
  executeRun,
  type ExecuteRunDeps,
  type RunProgress,
} from '../../../../src/features/extraction/executeRun';
import type { PlannedBatch, RunPlan } from '../../../../src/features/extraction/planRun';
import {
  EXTRACT_DATA_RESPONSE_SCHEMA,
  EXTRACT_DATA_SYSTEM_PROMPT,
  type ExtractDataPage,
} from '../../../../src/features/extraction/skills/extractData';
import { LlmProviderError } from '../../../../src/lib/llm/LLMProvider';
import type {
  ChatMessage,
  ChatOptions,
  ChatResponse,
  LLMProvider,
} from '../../../../src/lib/llm/LLMProvider';

function makeField(
  overrides: Pick<SchemaField, 'fieldId' | 'fieldName'> & Partial<SchemaField>,
): SchemaField {
  return {
    schemaVersion: 1,
    fieldIndex: 0,
    section: 'methods',
    fieldLabel: overrides.fieldName,
    entityLevel: 'study',
    dataType: 'text',
    unit: null,
    allowedValues: null,
    required: true,
    extractionInstruction: '',
    example: null,
    aiGenerated: true,
    note: null,
    ...overrides,
  };
}

const STUDY_FIELD = makeField({ fieldId: 'f_design', fieldName: 'study_design', fieldIndex: 1 });
const ARM_FIELD = makeField({
  fieldId: 'f_n',
  fieldName: 'sample_size',
  fieldIndex: 2,
  section: 'population',
  entityLevel: 'arm',
});
const FIELDS = [STUDY_FIELD, ARM_FIELD];

const PAGES: ExtractDataPage[] = [
  { page: 1, text: 'The study design was a randomized controlled trial in adults.' },
  { page: 2, text: 'Sixty patients received the intervention and 60 received placebo.' },
];

function makeBatch(
  overrides: Partial<PlannedBatch> & Pick<PlannedBatch, 'documentId' | 'fieldIds'>,
): PlannedBatch {
  return {
    // 既定は 1 文書 = 1 study（study_id は document_id と同値）
    studyId: overrides.documentId,
    section: null,
    tokensInEstimate: 0,
    tokensOutEstimate: 0,
    overBudget: false,
    ...overrides,
  };
}

function makePlan(batches: PlannedBatch[]): RunPlan {
  return {
    schemaVersion: 1,
    model: 'gemini-2.5-pro',
    batches,
    skippedDocuments: [],
    tokensInEstimate: 0,
    tokensOutEstimate: 0,
    costEstimateUsd: 0,
    warnings: [],
  };
}

function chatResponse(
  items: unknown,
  extra: Partial<Omit<ChatResponse, 'text'>> = {},
): ChatResponse {
  return {
    text: JSON.stringify(items),
    tokensIn: null,
    tokensOut: null,
    raw: {},
    ...extra,
  };
}

interface ProviderCall {
  messages: readonly ChatMessage[];
  options: ChatOptions | undefined;
}

/** chat が呼ばれるたびに results の先頭から消費する fake provider */
function providerOf(results: Array<ChatResponse | Error | 'throw-string'>): {
  provider: LLMProvider;
  calls: ProviderCall[];
} {
  const calls: ProviderCall[] = [];
  return {
    calls,
    provider: {
      providerId: 'gemini',
      model: 'gemini-2.5-pro',
      chat: async (messages, options) => {
        calls.push({ messages, options });
        const next = results[calls.length - 1];
        if (next === undefined) {
          throw new Error('fake provider: 想定外の追加呼び出し');
        }
        if (next === 'throw-string') {
          // Error 以外の throw 値の文字列化を検証するための意図的な literal throw
          throw 'oops';
        }
        if (next instanceof Error) {
          throw next;
        }
        return next;
      },
    },
  };
}

/** 進捗・Evidence 追記を記録する標準 deps。個別テストで上書きする */
function makeDeps(provider: LLMProvider): {
  deps: ExecuteRunDeps;
  saved: Evidence[][];
  progress: RunProgress[];
  loadPages: jest.Mock;
} {
  const saved: Evidence[][] = [];
  const progress: RunProgress[] = [];
  let id = 0;
  const loadPages = jest.fn().mockResolvedValue(PAGES);
  return {
    saved,
    progress,
    loadPages,
    deps: {
      provider,
      loadDocumentPages: loadPages,
      appendEvidence: async (rows) => {
        saved.push([...rows]);
      },
      newUuid: () => {
        id += 1;
        return `ev-${id}`;
      },
      onProgress: (p) => {
        progress.push(p);
      },
    },
  };
}

const DESIGN_ITEM = {
  field_id: 'f_design',
  entity_key: '-',
  value: 'randomized controlled trial',
  not_reported: false,
  quote: 'randomized controlled trial',
  page: 1,
  confidence: 'high',
};
const ARM_ITEM = {
  field_id: 'f_n',
  entity_key: 'arm:1',
  value: '60',
  not_reported: false,
  quote: 'Sixty patients received the intervention and 60 received placebo.',
  page: 2,
  confidence: 'medium',
};
const NOT_REPORTED_ITEM = {
  field_id: 'f_design',
  entity_key: '-',
  value: null,
  not_reported: true,
  quote: null,
  page: null,
  confidence: null,
};

describe('executeRun の入力検証', () => {
  test('plan と異なる schema_version の項目が混ざっていたら投げる', async () => {
    const { provider } = providerOf([]);
    const { deps } = makeDeps(provider);
    const v2Field = makeField({ fieldId: 'f_x', fieldName: 'x', schemaVersion: 2 });
    await expect(
      executeRun(
        {
          runId: 'run-1',
          plan: makePlan([makeBatch({ documentId: 'd1', fieldIds: ['f_design'] })]),
          fields: [STUDY_FIELD, v2Field],
        },
        deps,
      ),
    ).rejects.toThrow('schema_version');
  });

  test('plan の fieldIds に fields で解決できない ID があれば投げる', async () => {
    const { provider } = providerOf([]);
    const { deps } = makeDeps(provider);
    await expect(
      executeRun(
        {
          runId: 'run-1',
          plan: makePlan([makeBatch({ documentId: 'd1', fieldIds: ['f_missing'] })]),
          fields: FIELDS,
        },
        deps,
      ),
    ).rejects.toThrow('field_id "f_missing" が fields に見つかりません');
  });
});

describe('executeRun の正常系', () => {
  test('プロンプト構築 → 構造化出力要求 → Evidence 生成・追記まで貫通する', async () => {
    const { provider, calls } = providerOf([
      chatResponse([DESIGN_ITEM, ARM_ITEM, NOT_REPORTED_ITEM], {
        tokensIn: 100,
        tokensOut: 50,
        raw: { modelVersion: 'gemini-2.5-pro-001' },
      }),
    ]);
    const { deps, saved, progress } = makeDeps(provider);
    const result = await executeRun(
      {
        runId: 'run-1',
        plan: makePlan([makeBatch({ documentId: 'd1', fieldIds: ['f_design', 'f_n'] })]),
        fields: FIELDS,
        protocolContext: 'RQ: PROTO-CTX',
      },
      deps,
    );

    // LLM へは system プロンプト + user プロンプト（項目定義・本文・プロトコル）を渡す
    expect(calls).toHaveLength(1);
    const [systemMessage, userMessage] = calls[0]!.messages;
    expect(systemMessage).toEqual({ role: 'system', content: EXTRACT_DATA_SYSTEM_PROMPT });
    expect(userMessage?.role).toBe('user');
    expect(userMessage?.content).toContain('RQ: PROTO-CTX');
    expect(userMessage?.content).toContain('field_id: f_design');
    expect(userMessage?.content).toContain('[PAGE 2]');
    expect(calls[0]!.options).toEqual({
      temperature: EXTRACT_DATA_TEMPERATURE,
      responseSchema: EXTRACT_DATA_RESPONSE_SCHEMA,
    });

    expect(result.status).toBe('done');
    expect(result.runId).toBe('run-1');
    expect(result.evidence).toEqual([
      {
        evidenceId: 'ev-1',
        runId: 'run-1',
        studyId: 'd1',
        documentId: 'd1',
        fieldId: 'f_design',
        entityKey: '-',
        value: 'randomized controlled trial',
        notReported: false,
        quote: 'randomized controlled trial',
        page: 1,
        confidence: 'high',
        anchorStatus: 'exact',
      },
      {
        evidenceId: 'ev-2',
        runId: 'run-1',
        studyId: 'd1',
        documentId: 'd1',
        fieldId: 'f_n',
        entityKey: 'arm:1',
        value: '60',
        notReported: false,
        quote: 'Sixty patients received the intervention and 60 received placebo.',
        page: 2,
        confidence: 'medium',
        anchorStatus: 'exact',
      },
      // quote が無い要素（not_reported）はアンカリング対象外
      {
        evidenceId: 'ev-3',
        runId: 'run-1',
        studyId: 'd1',
        documentId: 'd1',
        fieldId: 'f_design',
        entityKey: '-',
        value: null,
        notReported: true,
        quote: null,
        page: null,
        confidence: null,
        anchorStatus: null,
      },
    ]);
    expect(saved).toEqual([result.evidence]);
    expect(result.tokensIn).toBe(100);
    expect(result.tokensOut).toBe(50);
    expect(result.modelVersion).toBe('gemini-2.5-pro-001');
    expect(result.rejectedItems).toHaveLength(0);
    expect(result.batchFailures).toHaveLength(0);
    expect(progress).toEqual([
      { totalBatches: 1, completedBatches: 1, documentId: 'd1', section: null, failure: null },
    ]);
  });

  test('本文に見つからない quote は anchor_status = failed で保存する', async () => {
    const missingQuoteItem = {
      ...DESIGN_ITEM,
      value: null,
      quote: 'this passage does not appear anywhere in the article',
    };
    const { provider } = providerOf([chatResponse([missingQuoteItem])]);
    const { deps } = makeDeps(provider);
    const result = await executeRun(
      {
        runId: 'run-1',
        plan: makePlan([makeBatch({ documentId: 'd1', fieldIds: ['f_design'] })]),
        fields: FIELDS,
      },
      deps,
    );
    expect(result.evidence[0]?.anchorStatus).toBe('failed');
    expect(result.status).toBe('done');
  });

  test('バッチ 0 件の plan は何もせず done を返す', async () => {
    const { provider, calls } = providerOf([]);
    const { deps, progress } = makeDeps(provider);
    const result = await executeRun(
      { runId: 'run-1', plan: makePlan([]), fields: FIELDS },
      deps,
    );
    expect(result).toEqual({
      runId: 'run-1',
      status: 'done',
      evidence: [],
      rejectedItems: [],
      batchFailures: [],
      tokensIn: null,
      tokensOut: null,
      modelVersion: null,
    });
    expect(calls).toHaveLength(0);
    expect(progress).toHaveLength(0);
  });

  test('newUuid / onProgress を省略しても既定実装で動く', async () => {
    const { provider } = providerOf([chatResponse([DESIGN_ITEM])]);
    const result = await executeRun(
      {
        runId: 'run-1',
        plan: makePlan([makeBatch({ documentId: 'd1', fieldIds: ['f_design'] })]),
        fields: FIELDS,
      },
      {
        provider,
        loadDocumentPages: async () => PAGES,
        appendEvidence: async () => undefined,
      },
    );
    expect(result.status).toBe('done');
    expect(result.evidence[0]?.evidenceId).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    );
  });
});

describe('executeRun の partial_failure', () => {
  test('破棄要素（unknown_field_id 等）はバッチ情報付きで記録し、有効要素は保存する', async () => {
    const unknownItem = { ...DESIGN_ITEM, field_id: 'f_ghost' };
    const { provider } = providerOf([chatResponse([unknownItem, DESIGN_ITEM])]);
    const { deps, saved } = makeDeps(provider);
    const result = await executeRun(
      {
        runId: 'run-1',
        plan: makePlan([
          makeBatch({ documentId: 'd1', section: 'methods', fieldIds: ['f_design'] }),
        ]),
        fields: FIELDS,
      },
      deps,
    );
    expect(result.status).toBe('partial_failure');
    expect(result.rejectedItems).toEqual([
      expect.objectContaining({
        documentId: 'd1',
        section: 'methods',
        index: 0,
        reason: 'unknown_field_id',
      }),
    ]);
    expect(result.evidence).toHaveLength(1);
    expect(saved).toHaveLength(1);
    expect(result.batchFailures).toHaveLength(0);
  });

  test('全要素が破棄されたバッチは Evidence 追記を呼ばない', async () => {
    const unknownItem = { ...DESIGN_ITEM, field_id: 'f_ghost' };
    const { provider } = providerOf([chatResponse([unknownItem])]);
    const { deps, saved } = makeDeps(provider);
    const result = await executeRun(
      {
        runId: 'run-1',
        plan: makePlan([makeBatch({ documentId: 'd1', fieldIds: ['f_design'] })]),
        fields: FIELDS,
      },
      deps,
    );
    expect(result.status).toBe('partial_failure');
    expect(result.evidence).toHaveLength(0);
    expect(saved).toHaveLength(0);
  });

  test('API エラーのバッチは api_error として記録し、後続バッチは続行する', async () => {
    const { provider } = providerOf([
      new Error('boom'),
      chatResponse([ARM_ITEM], { tokensIn: 10, tokensOut: 20 }),
    ]);
    const { deps, saved, progress, loadPages } = makeDeps(provider);
    const result = await executeRun(
      {
        runId: 'run-1',
        plan: makePlan([
          makeBatch({ documentId: 'd1', section: 'methods', fieldIds: ['f_design'] }),
          makeBatch({ documentId: 'd1', section: 'population', fieldIds: ['f_n'] }),
        ]),
        fields: FIELDS,
      },
      deps,
    );
    expect(result.status).toBe('partial_failure');
    expect(result.batchFailures).toEqual([
      { documentId: 'd1', section: 'methods', reason: 'api_error', detail: 'boom' },
    ]);
    expect(result.evidence).toHaveLength(1);
    expect(result.evidence[0]?.fieldId).toBe('f_n');
    expect(saved).toHaveLength(1);
    // 同一 document の本文は 1 回だけロードしてバッチ間で使い回す
    expect(loadPages).toHaveBeenCalledTimes(1);
    expect(result.tokensIn).toBe(10);
    expect(result.tokensOut).toBe(20);
    expect(progress).toEqual([
      {
        totalBatches: 2,
        completedBatches: 1,
        documentId: 'd1',
        section: 'methods',
        failure: { documentId: 'd1', section: 'methods', reason: 'api_error', detail: 'boom' },
      },
      { totalBatches: 2, completedBatches: 2, documentId: 'd1', section: 'population', failure: null },
    ]);
  });

  test('LlmProviderError はプロバイダ応答本文を detail に含める', async () => {
    const { provider } = providerOf([
      new LlmProviderError('Gemini API failed: HTTP 400', 'gemini', 400, 'input token count exceeds the maximum'),
    ]);
    const { deps } = makeDeps(provider);
    const result = await executeRun(
      {
        runId: 'run-1',
        plan: makePlan([makeBatch({ documentId: 'd1', fieldIds: ['f_design'] })]),
        fields: FIELDS,
      },
      deps,
    );
    expect(result.batchFailures).toEqual([
      {
        documentId: 'd1',
        section: null,
        reason: 'api_error',
        detail: 'Gemini API failed: HTTP 400: input token count exceeds the maximum',
      },
    ]);
  });

  test('LlmProviderError の応答本文が長い場合は責め切る', async () => {
    const body = 'x'.repeat(MAX_FAILURE_DETAIL_BODY_CHARS + 50);
    const { provider } = providerOf([
      new LlmProviderError('Gemini API failed: HTTP 400', 'gemini', 400, body),
    ]);
    const { deps } = makeDeps(provider);
    const result = await executeRun(
      {
        runId: 'run-1',
        plan: makePlan([makeBatch({ documentId: 'd1', fieldIds: ['f_design'] })]),
        fields: FIELDS,
      },
      deps,
    );
    const detail = result.batchFailures[0]?.detail ?? '';
    expect(detail.endsWith('…')).toBe(true);
    expect(detail).toBe(
      `Gemini API failed: HTTP 400: ${'x'.repeat(MAX_FAILURE_DETAIL_BODY_CHARS - 1)}…`,
    );
  });

  test('LlmProviderError の応答本文が空なら message のみを detail にする', async () => {
    const { provider } = providerOf([
      new LlmProviderError('Gemini API failed: HTTP 401', 'gemini', 401, '  '),
    ]);
    const { deps } = makeDeps(provider);
    const result = await executeRun(
      {
        runId: 'run-1',
        plan: makePlan([makeBatch({ documentId: 'd1', fieldIds: ['f_design'] })]),
        fields: FIELDS,
      },
      deps,
    );
    expect(result.batchFailures[0]?.detail).toBe('Gemini API failed: HTTP 401');
  });

  test('Error 以外の例外も文字列化して記録する', async () => {
    const { provider } = providerOf(['throw-string']);
    const { deps } = makeDeps(provider);
    const result = await executeRun(
      {
        runId: 'run-1',
        plan: makePlan([makeBatch({ documentId: 'd1', fieldIds: ['f_design'] })]),
        fields: FIELDS,
      },
      deps,
    );
    expect(result.batchFailures).toEqual([
      { documentId: 'd1', section: null, reason: 'api_error', detail: 'oops' },
    ]);
  });

  test('JSON としてパースできない応答は format_error', async () => {
    const { provider } = providerOf([
      { text: 'これは JSON ではありません', tokensIn: 5, tokensOut: 5, raw: {} },
    ]);
    const { deps } = makeDeps(provider);
    const result = await executeRun(
      {
        runId: 'run-1',
        plan: makePlan([makeBatch({ documentId: 'd1', fieldIds: ['f_design'] })]),
        fields: FIELDS,
      },
      deps,
    );
    expect(result.status).toBe('partial_failure');
    expect(result.batchFailures[0]).toMatchObject({ reason: 'format_error' });
    expect(result.batchFailures[0]?.detail).toContain('JSON としてパースできません');
    // 失敗前に取れた実測トークンは集計に含める
    expect(result.tokensIn).toBe(5);
  });

  test('本文ロード失敗は同一 document の全バッチを load_failed にする（ロードは 1 回だけ）', async () => {
    const { provider, calls } = providerOf([]);
    const { deps, loadPages } = makeDeps(provider);
    loadPages.mockRejectedValue(new Error('drive down'));
    const result = await executeRun(
      {
        runId: 'run-1',
        plan: makePlan([
          makeBatch({ documentId: 'd1', section: 'methods', fieldIds: ['f_design'] }),
          makeBatch({ documentId: 'd1', section: 'population', fieldIds: ['f_n'] }),
        ]),
        fields: FIELDS,
      },
      deps,
    );
    expect(result.status).toBe('partial_failure');
    expect(result.batchFailures).toEqual([
      { documentId: 'd1', section: 'methods', reason: 'load_failed', detail: 'drive down' },
      { documentId: 'd1', section: 'population', reason: 'load_failed', detail: 'drive down' },
    ]);
    expect(loadPages).toHaveBeenCalledTimes(1);
    expect(calls).toHaveLength(0);
  });

  test('本文が 0 ページの document は load_failed にする', async () => {
    const { provider } = providerOf([]);
    const { deps, loadPages } = makeDeps(provider);
    loadPages.mockResolvedValue([]);
    const result = await executeRun(
      {
        runId: 'run-1',
        plan: makePlan([makeBatch({ documentId: 'd1', fieldIds: ['f_design'] })]),
        fields: FIELDS,
      },
      deps,
    );
    expect(result.batchFailures[0]).toMatchObject({
      reason: 'load_failed',
      detail: expect.stringContaining('本文ページが 0 件'),
    });
  });

  test('Evidence 追記の失敗は save_failed とし、その行は結果に含めない', async () => {
    const { provider } = providerOf([chatResponse([DESIGN_ITEM])]);
    const { deps } = makeDeps(provider);
    deps.appendEvidence = async () => {
      throw new Error('sheets quota');
    };
    const result = await executeRun(
      {
        runId: 'run-1',
        plan: makePlan([makeBatch({ documentId: 'd1', fieldIds: ['f_design'] })]),
        fields: FIELDS,
      },
      deps,
    );
    expect(result.status).toBe('partial_failure');
    expect(result.batchFailures).toEqual([
      { documentId: 'd1', section: null, reason: 'save_failed', detail: 'sheets quota' },
    ]);
    expect(result.evidence).toHaveLength(0);
  });
});

describe('executeRun の実測集計', () => {
  test('トークンが一度も取れなければ null のまま返す', async () => {
    const { provider } = providerOf([chatResponse([DESIGN_ITEM])]);
    const { deps } = makeDeps(provider);
    const result = await executeRun(
      {
        runId: 'run-1',
        plan: makePlan([makeBatch({ documentId: 'd1', fieldIds: ['f_design'] })]),
        fields: FIELDS,
      },
      deps,
    );
    expect(result.tokensIn).toBeNull();
    expect(result.tokensOut).toBeNull();
    expect(result.modelVersion).toBeNull();
  });

  test('複数バッチのトークンを合算し、取れなかった呼び出しは無視する', async () => {
    const { provider } = providerOf([
      chatResponse([DESIGN_ITEM], { tokensIn: 100, tokensOut: 40 }),
      chatResponse([ARM_ITEM], { tokensIn: null, tokensOut: null }),
      chatResponse([ARM_ITEM], { tokensIn: 50, tokensOut: 10 }),
    ]);
    const { deps, loadPages } = makeDeps(provider);
    const result = await executeRun(
      {
        runId: 'run-1',
        plan: makePlan([
          makeBatch({ documentId: 'd1', fieldIds: ['f_design'] }),
          makeBatch({ documentId: 'd2', fieldIds: ['f_n'] }),
          makeBatch({ documentId: 'd3', fieldIds: ['f_n'] }),
        ]),
        fields: FIELDS,
      },
      deps,
    );
    expect(result.tokensIn).toBe(150);
    expect(result.tokensOut).toBe(50);
    // document ごとにロードされる
    expect(loadPages).toHaveBeenCalledTimes(3);
  });

  test('modelVersion は最初に取れた文字列を採用し、型不正・欠落は無視する', async () => {
    const { provider } = providerOf([
      chatResponse([DESIGN_ITEM], { raw: 'not-an-object' }),
      chatResponse([ARM_ITEM], { raw: { modelVersion: 42 } }),
      chatResponse([ARM_ITEM], { raw: { modelVersion: 'gemini-2.5-pro-002' } }),
      chatResponse([ARM_ITEM], { raw: { modelVersion: 'gemini-2.5-pro-999' } }),
    ]);
    const { deps } = makeDeps(provider);
    const result = await executeRun(
      {
        runId: 'run-1',
        plan: makePlan([
          makeBatch({ documentId: 'd1', fieldIds: ['f_design'] }),
          makeBatch({ documentId: 'd2', fieldIds: ['f_n'] }),
          makeBatch({ documentId: 'd3', fieldIds: ['f_n'] }),
          makeBatch({ documentId: 'd4', fieldIds: ['f_n'] }),
        ]),
        fields: FIELDS,
      },
      deps,
    );
    expect(result.modelVersion).toBe('gemini-2.5-pro-002');
  });

  test('raw が null の応答でも落ちない', async () => {
    const { provider } = providerOf([chatResponse([DESIGN_ITEM], { raw: null })]);
    const { deps } = makeDeps(provider);
    const result = await executeRun(
      {
        runId: 'run-1',
        plan: makePlan([makeBatch({ documentId: 'd1', fieldIds: ['f_design'] })]),
        fields: FIELDS,
      },
      deps,
    );
    expect(result.modelVersion).toBeNull();
  });
});
