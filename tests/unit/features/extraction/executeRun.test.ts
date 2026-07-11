// executeRun（一括抽出の実行）の単体テスト
// - 正常系: プロンプト構築 → 構造化出力要求 → 応答検証 → アンカリング → Evidence 追記
// - 複数文書（v0.10）: study の全文書を連結し、document_index が指す文書でアンカリング・Evidence.document_id を決定
// - partial_failure: バッチ失敗 4 種（load / api / format / save）と要素破棄の記録
// - 集計: 実測トークンの合算（null 許容）、modelVersion の採用、進捗通知
import type { DocumentRecord } from '../../../../src/domain/document';
import type { Evidence } from '../../../../src/domain/evidence';
import type { SchemaField } from '../../../../src/domain/schemaField';
import {
  DEFAULT_FLUSH_EVERY_N_STUDIES,
  DEFAULT_MAX_ROWS_PER_FLUSH,
  EXTRACT_DATA_TEMPERATURE,
  MAX_FAILURE_DETAIL_BODY_CHARS,
  executeRun,
  type ExecuteRunDeps,
  type ExecuteRunInput,
  type RunProgress,
} from '../../../../src/features/extraction/executeRun';
import type { PlannedBatch, RunPlan } from '../../../../src/features/extraction/planRun';
import {
  EXTRACT_DATA_RESPONSE_SCHEMA,
  EXTRACT_DATA_SYSTEM_PROMPT,
  type ExtractDataImagePage,
  type ExtractDataPage,
} from '../../../../src/features/extraction/skills/extractData';
import { LlmProviderError } from '../../../../src/lib/llm/LLMProvider';
import type {
  ChatContentPart,
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

function makeDocument(
  documentId: string,
  overrides: Partial<DocumentRecord> = {},
): DocumentRecord {
  return {
    documentId,
    studyId: documentId,
    documentRole: 'article',
    driveFileId: `drive-${documentId}`,
    sourceFileId: `src-${documentId}`,
    filename: `${documentId}.pdf`,
    pmid: null,
    doi: null,
    textRef: 'https://drive.example/text.txt',
    textStatus: 'ok',
    pageCount: 2,
    charCount: 100,
    importedAt: '2026-07-01T00:00:00Z',
    importedBy: 'tester@example.com',
    note: null,
    ...overrides,
  };
}

function makeBatch(
  overrides: Partial<PlannedBatch> & Pick<PlannedBatch, 'studyId' | 'fieldIds'>,
): PlannedBatch {
  return {
    // 既定は 1 study = 1 文書（document_id は study_id と同値）
    documentIds: [overrides.studyId],
    imageDocumentIds: [],
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
    inputMode: 'text_only',
    tokensInEstimate: 0,
    tokensOutEstimate: 0,
    costEstimateUsd: 0,
    warnings: [],
  };
}

/** plan の全 documentIds から DocumentRecord を自動生成する（override が無ければ 1 doc = 1 study） */
function documentsForPlan(plan: RunPlan): DocumentRecord[] {
  const ids = new Set<string>();
  for (const batch of plan.batches) {
    for (const id of batch.documentIds) {
      ids.add(id);
    }
  }
  return [...ids].map((id) => makeDocument(id));
}

/** executeRun のラッパ。documents 未指定なら plan から自動導出して渡す */
function execute(
  input: Omit<ExecuteRunInput, 'documents'> & { documents?: readonly DocumentRecord[] },
  deps: ExecuteRunDeps,
) {
  return executeRun(
    { ...input, documents: input.documents ?? documentsForPlan(input.plan) },
    deps,
  );
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
      supportsImageInput: true,
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

/** 手動リリース式の provider。in-flight 数のピークを観測してからバッチを解放する
 *（並行実行テスト・バッチ化の二重フラッシュ防止テストの両方で使う） */
function gatedProvider(): {
  provider: LLMProvider;
  peak: () => number;
  releaseAll: () => void;
} {
  let active = 0;
  let peak = 0;
  const releasers: Array<() => void> = [];
  return {
    peak: () => peak,
    releaseAll: () => {
      releasers.splice(0).forEach((release) => {
        release();
      });
    },
    provider: {
      providerId: 'gemini',
      model: 'm',
      supportsImageInput: true,
      chat: async () => {
        active += 1;
        peak = Math.max(peak, active);
        await new Promise<void>((resolve) => {
          releasers.push(() => {
            active -= 1;
            resolve();
          });
        });
        return chatResponse([DESIGN_ITEM], { tokensIn: 10, tokensOut: 5 });
      },
    },
  };
}

/** run が完了するまで、待機中の chat を順次解放しながらマクロタスクを回す */
async function drain(runPromise: Promise<unknown>, releaseAll: () => void): Promise<void> {
  let done = false;
  void runPromise.then(() => {
    done = true;
  });
  while (!done) {
    await new Promise((resolve) => setTimeout(resolve, 0));
    releaseAll();
  }
  await runPromise;
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
  document_index: 1,
  confidence: 'high',
};
const ARM_ITEM = {
  field_id: 'f_n',
  entity_key: 'arm:1',
  value: '60',
  not_reported: false,
  quote: 'Sixty patients received the intervention and 60 received placebo.',
  page: 2,
  document_index: 1,
  confidence: 'medium',
};
const NOT_REPORTED_ITEM = {
  field_id: 'f_design',
  entity_key: '-',
  value: null,
  not_reported: true,
  quote: null,
  page: null,
  document_index: null,
  confidence: null,
};

describe('executeRun の入力検証', () => {
  test('plan と異なる schema_version の項目が混ざっていたら投げる', async () => {
    const { provider } = providerOf([]);
    const { deps } = makeDeps(provider);
    const v2Field = makeField({ fieldId: 'f_x', fieldName: 'x', schemaVersion: 2 });
    await expect(
      execute(
        {
          runId: 'run-1',
          plan: makePlan([makeBatch({ studyId: 'd1', fieldIds: ['f_design'] })]),
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
      execute(
        {
          runId: 'run-1',
          plan: makePlan([makeBatch({ studyId: 'd1', fieldIds: ['f_missing'] })]),
          fields: FIELDS,
        },
        deps,
      ),
    ).rejects.toThrow('field_id "f_missing" が fields に見つかりません');
  });

  test('plan の documentIds に documents で解決できない ID があれば投げる', async () => {
    const { provider } = providerOf([]);
    const { deps } = makeDeps(provider);
    await expect(
      executeRun(
        {
          runId: 'run-1',
          plan: makePlan([
            makeBatch({ studyId: 's1', documentIds: ['ghost'], fieldIds: ['f_design'] }),
          ]),
          fields: FIELDS,
          documents: [makeDocument('other')],
        },
        deps,
      ),
    ).rejects.toThrow('document_id "ghost" が documents に見つかりません');
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
    const result = await execute(
      {
        runId: 'run-1',
        plan: makePlan([makeBatch({ studyId: 'd1', fieldIds: ['f_design', 'f_n'] })]),
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
    // 単一文書の連結見出し
    expect(userMessage?.content).toContain('=== Document 1/1 [article] d1.pdf ===');
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
        bboxPage: null,
        bbox: null,
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
        bboxPage: null,
        bbox: null,
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
        bboxPage: null,
        bbox: null,
      },
    ]);
    expect(saved).toEqual([result.evidence]);
    expect(result.tokensIn).toBe(100);
    expect(result.tokensOut).toBe(50);
    expect(result.modelVersion).toBe('gemini-2.5-pro-001');
    expect(result.rejectedItems).toHaveLength(0);
    expect(result.batchFailures).toHaveLength(0);
    expect(progress).toEqual([
      { totalBatches: 1, completedBatches: 1, studyId: 'd1', section: null, failure: null },
    ]);
  });

  test('複数文書 study: document_index が指す文書でアンカリングし Evidence.document_id に記録する', async () => {
    // 同一 study の 2 文書。document_index 2（登録）由来の quote は登録 PDF でアンカリングされる
    const REG_PAGES: ExtractDataPage[] = [{ page: 1, text: 'Registered as NCT01234567 on 2019-01-01.' }];
    const artItem = { ...DESIGN_ITEM, document_index: 1 };
    const regItem = {
      field_id: 'f_n',
      entity_key: 'arm:1',
      value: 'NCT01234567',
      not_reported: false,
      quote: 'Registered as NCT01234567',
      page: 1,
      document_index: 2,
      confidence: 'high',
    };
    const { provider, calls } = providerOf([chatResponse([artItem, regItem])]);
    const { deps, saved } = makeDeps(provider);
    deps.loadDocumentPages = jest.fn(async (id: string) => (id === 'reg' ? REG_PAGES : PAGES));

    const result = await executeRun(
      {
        runId: 'run-1',
        plan: makePlan([
          makeBatch({ studyId: 's1', documentIds: ['art', 'reg'], fieldIds: ['f_design', 'f_n'] }),
        ]),
        fields: FIELDS,
        documents: [
          makeDocument('art', { studyId: 's1', documentRole: 'article', filename: 'main.pdf' }),
          makeDocument('reg', {
            studyId: 's1',
            documentRole: 'registration',
            filename: 'NCT01.pdf',
          }),
        ],
      },
      deps,
    );

    // プロンプトに 2 文書がロール付きで連結される
    const userContent = calls[0]!.messages[1]!.content;
    expect(userContent).toContain('=== Document 1/2 [article] main.pdf ===');
    expect(userContent).toContain('=== Document 2/2 [registration] NCT01.pdf ===');

    // article 由来 → document_id = 'art' / exact、登録由来 → document_id = 'reg' / 登録本文で exact
    expect(result.evidence).toEqual([
      expect.objectContaining({ studyId: 's1', documentId: 'art', anchorStatus: 'exact' }),
      expect.objectContaining({
        studyId: 's1',
        documentId: 'reg',
        value: 'NCT01234567',
        anchorStatus: 'exact',
      }),
    ]);
    expect(saved).toHaveLength(1);
  });

  test('本文に見つからない quote は anchor_status = failed で保存する', async () => {
    const missingQuoteItem = {
      ...DESIGN_ITEM,
      value: null,
      quote: 'this passage does not appear anywhere in the article',
    };
    const { provider } = providerOf([chatResponse([missingQuoteItem])]);
    const { deps } = makeDeps(provider);
    const result = await execute(
      {
        runId: 'run-1',
        plan: makePlan([makeBatch({ studyId: 'd1', fieldIds: ['f_design'] })]),
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
    const result = await execute(
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
    const result = await execute(
      {
        runId: 'run-1',
        plan: makePlan([makeBatch({ studyId: 'd1', fieldIds: ['f_design'] })]),
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
    const result = await execute(
      {
        runId: 'run-1',
        plan: makePlan([makeBatch({ studyId: 'd1', section: 'methods', fieldIds: ['f_design'] })]),
        fields: FIELDS,
      },
      deps,
    );
    expect(result.status).toBe('partial_failure');
    expect(result.rejectedItems).toEqual([
      expect.objectContaining({
        studyId: 'd1',
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
    const result = await execute(
      {
        runId: 'run-1',
        plan: makePlan([makeBatch({ studyId: 'd1', fieldIds: ['f_design'] })]),
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
    const result = await execute(
      {
        runId: 'run-1',
        plan: makePlan([
          makeBatch({ studyId: 'd1', section: 'methods', fieldIds: ['f_design'] }),
          makeBatch({ studyId: 'd1', section: 'population', fieldIds: ['f_n'] }),
        ]),
        fields: FIELDS,
      },
      deps,
    );
    expect(result.status).toBe('partial_failure');
    expect(result.batchFailures).toEqual([
      { studyId: 'd1', section: 'methods', reason: 'api_error', detail: 'boom' },
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
        studyId: 'd1',
        section: 'methods',
        failure: { studyId: 'd1', section: 'methods', reason: 'api_error', detail: 'boom' },
      },
      { totalBatches: 2, completedBatches: 2, studyId: 'd1', section: 'population', failure: null },
    ]);
  });

  test('LlmProviderError はプロバイダ応答本文を detail に含める', async () => {
    const { provider } = providerOf([
      new LlmProviderError('Gemini API failed: HTTP 400', 'gemini', 400, 'input token count exceeds the maximum'),
    ]);
    const { deps } = makeDeps(provider);
    const result = await execute(
      {
        runId: 'run-1',
        plan: makePlan([makeBatch({ studyId: 'd1', fieldIds: ['f_design'] })]),
        fields: FIELDS,
      },
      deps,
    );
    expect(result.batchFailures).toEqual([
      {
        studyId: 'd1',
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
    const result = await execute(
      {
        runId: 'run-1',
        plan: makePlan([makeBatch({ studyId: 'd1', fieldIds: ['f_design'] })]),
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
    const result = await execute(
      {
        runId: 'run-1',
        plan: makePlan([makeBatch({ studyId: 'd1', fieldIds: ['f_design'] })]),
        fields: FIELDS,
      },
      deps,
    );
    expect(result.batchFailures[0]?.detail).toBe('Gemini API failed: HTTP 401');
  });

  test('Error 以外の例外も文字列化して記録する', async () => {
    const { provider } = providerOf(['throw-string']);
    const { deps } = makeDeps(provider);
    const result = await execute(
      {
        runId: 'run-1',
        plan: makePlan([makeBatch({ studyId: 'd1', fieldIds: ['f_design'] })]),
        fields: FIELDS,
      },
      deps,
    );
    expect(result.batchFailures).toEqual([
      { studyId: 'd1', section: null, reason: 'api_error', detail: 'oops' },
    ]);
  });

  test('JSON としてパースできない応答は format_error', async () => {
    const { provider } = providerOf([
      { text: 'これは JSON ではありません', tokensIn: 5, tokensOut: 5, raw: {} },
    ]);
    const { deps } = makeDeps(provider);
    const result = await execute(
      {
        runId: 'run-1',
        plan: makePlan([makeBatch({ studyId: 'd1', fieldIds: ['f_design'] })]),
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

  test('本文ロード失敗は同一 study の全バッチを load_failed にする（ロードは 1 回だけ）', async () => {
    const { provider, calls } = providerOf([]);
    const { deps, loadPages } = makeDeps(provider);
    loadPages.mockRejectedValue(new Error('drive down'));
    const result = await execute(
      {
        runId: 'run-1',
        plan: makePlan([
          makeBatch({ studyId: 'd1', section: 'methods', fieldIds: ['f_design'] }),
          makeBatch({ studyId: 'd1', section: 'population', fieldIds: ['f_n'] }),
        ]),
        fields: FIELDS,
      },
      deps,
    );
    expect(result.status).toBe('partial_failure');
    expect(result.batchFailures).toEqual([
      { studyId: 'd1', section: 'methods', reason: 'load_failed', detail: 'drive down' },
      { studyId: 'd1', section: 'population', reason: 'load_failed', detail: 'drive down' },
    ]);
    expect(loadPages).toHaveBeenCalledTimes(1);
    expect(calls).toHaveLength(0);
  });

  test('documentIds が空のバッチは load_failed（既定文言）にする', async () => {
    const { provider, calls } = providerOf([]);
    const { deps } = makeDeps(provider);
    const result = await executeRun(
      {
        runId: 'run-1',
        plan: makePlan([makeBatch({ studyId: 's1', documentIds: [], fieldIds: ['f_design'] })]),
        fields: FIELDS,
        documents: [],
      },
      deps,
    );
    expect(result.batchFailures).toEqual([
      { studyId: 's1', section: null, reason: 'load_failed', detail: '本文を取得できる文書がありません' },
    ]);
    expect(calls).toHaveLength(0);
  });

  test('本文が 0 ページの document は load_failed にする', async () => {
    const { provider } = providerOf([]);
    const { deps, loadPages } = makeDeps(provider);
    loadPages.mockResolvedValue([]);
    const result = await execute(
      {
        runId: 'run-1',
        plan: makePlan([makeBatch({ studyId: 'd1', fieldIds: ['f_design'] })]),
        fields: FIELDS,
      },
      deps,
    );
    expect(result.batchFailures[0]).toMatchObject({
      reason: 'load_failed',
      detail: expect.stringContaining('本文ページが 0 件'),
    });
  });

  test('複数文書 study で一部の文書だけロードできれば残りで抽出を続行する', async () => {
    // art はロード成功・reg は失敗 → reg を除いた 1 文書で抽出（document_index は詰め直される）
    const item = { ...DESIGN_ITEM, document_index: 1 };
    const { provider, calls } = providerOf([chatResponse([item])]);
    const { deps } = makeDeps(provider);
    deps.loadDocumentPages = jest.fn(async (id: string) => {
      if (id === 'reg') {
        throw new Error('reg down');
      }
      return PAGES;
    });
    const result = await executeRun(
      {
        runId: 'run-1',
        plan: makePlan([
          makeBatch({ studyId: 's1', documentIds: ['art', 'reg'], fieldIds: ['f_design'] }),
        ]),
        fields: FIELDS,
        documents: [
          makeDocument('art', { studyId: 's1', filename: 'main.pdf' }),
          makeDocument('reg', { studyId: 's1', documentRole: 'registration' }),
        ],
      },
      deps,
    );
    // 1 文書だけ連結される（Document 1/1）
    expect(calls[0]!.messages[1]!.content).toContain('=== Document 1/1 [article] main.pdf ===');
    expect(result.status).toBe('done');
    expect(result.evidence[0]?.documentId).toBe('art');
  });

  test('Evidence 追記の失敗は save_failed とし、その行は結果に含めない', async () => {
    const { provider } = providerOf([chatResponse([DESIGN_ITEM])]);
    const { deps } = makeDeps(provider);
    deps.appendEvidence = async () => {
      throw new Error('sheets quota');
    };
    const result = await execute(
      {
        runId: 'run-1',
        plan: makePlan([makeBatch({ studyId: 'd1', fieldIds: ['f_design'] })]),
        fields: FIELDS,
      },
      deps,
    );
    expect(result.status).toBe('partial_failure');
    expect(result.batchFailures).toEqual([
      { studyId: 'd1', section: null, reason: 'save_failed', detail: 'sheets quota' },
    ]);
    expect(result.evidence).toHaveLength(0);
  });
});

describe('executeRun の画像入力（pdf_native。handoff-scanned-pdf-native-highlight.md §7.4 PR2）', () => {
  const IMAGE_PAGES: ExtractDataImagePage[] = [
    { page: 1, mimeType: 'image/png', dataBase64: 'QUJD' },
  ];

  test('画像文書（no_text_layer）は loadDocumentPageImages でロードし、画像パート付きでプロンプトを送る（anchorStatus は null）', async () => {
    const { provider, calls } = providerOf([chatResponse([DESIGN_ITEM])]);
    const { deps } = makeDeps(provider);
    const loadImages = jest.fn().mockResolvedValue(IMAGE_PAGES);
    deps.loadDocumentPageImages = loadImages;
    const result = await executeRun(
      {
        runId: 'run-1',
        plan: makePlan([
          makeBatch({
            studyId: 'd1',
            documentIds: ['d1'],
            imageDocumentIds: ['d1'],
            fieldIds: ['f_design'],
          }),
        ]),
        fields: FIELDS,
        documents: [makeDocument('d1', { textStatus: 'no_text_layer', textRef: null })],
      },
      deps,
    );

    expect(loadImages).toHaveBeenCalledWith('d1');
    const userContent = calls[0]!.messages[1]!.content;
    expect(Array.isArray(userContent)).toBe(true);
    const parts = userContent as ChatContentPart[];
    expect(parts[0]).toMatchObject({ type: 'text' });
    expect((parts[0] as { text: string }).text).toContain('scanned PDF with no text layer');
    expect(parts.slice(1)).toEqual([
      { type: 'text', text: '[Document 1/1 page 1]' },
      { type: 'image', mimeType: 'image/png', dataBase64: 'QUJD' },
    ]);
    expect(result.status).toBe('done');
    expect(result.evidence[0]?.anchorStatus).toBeNull();
  });

  test('画像入力（pdf_native）のバッチがあるのに loadDocumentPageImages 未注入なら実行前に throw する', async () => {
    const { provider } = providerOf([]);
    const { deps } = makeDeps(provider); // loadDocumentPageImages 未設定
    await expect(
      executeRun(
        {
          runId: 'run-1',
          plan: makePlan([
            makeBatch({
              studyId: 'd1',
              documentIds: ['d1'],
              imageDocumentIds: ['d1'],
              fieldIds: ['f_design'],
            }),
          ]),
          fields: FIELDS,
          documents: [makeDocument('d1', { textStatus: 'no_text_layer', textRef: null })],
        },
        deps,
      ),
    ).rejects.toThrow('loadDocumentPageImages');
  });

  test('画像のロード失敗は load_failed として記録する', async () => {
    const { provider } = providerOf([]);
    const { deps } = makeDeps(provider);
    deps.loadDocumentPageImages = jest.fn().mockRejectedValue(new Error('drive down'));
    const result = await executeRun(
      {
        runId: 'run-1',
        plan: makePlan([
          makeBatch({
            studyId: 'd1',
            documentIds: ['d1'],
            imageDocumentIds: ['d1'],
            fieldIds: ['f_design'],
          }),
        ]),
        fields: FIELDS,
        documents: [makeDocument('d1', { textStatus: 'no_text_layer', textRef: null })],
      },
      deps,
    );
    expect(result.batchFailures).toEqual([
      { studyId: 'd1', section: null, reason: 'load_failed', detail: 'drive down' },
    ]);
  });

  test('画像が 0 件の文書は load_failed（本文と同趣旨のメッセージ）', async () => {
    const { provider } = providerOf([]);
    const { deps } = makeDeps(provider);
    deps.loadDocumentPageImages = jest.fn().mockResolvedValue([]);
    const result = await executeRun(
      {
        runId: 'run-1',
        plan: makePlan([
          makeBatch({
            studyId: 'd1',
            documentIds: ['d1'],
            imageDocumentIds: ['d1'],
            fieldIds: ['f_design'],
          }),
        ]),
        fields: FIELDS,
        documents: [makeDocument('d1', { textStatus: 'no_text_layer', textRef: null })],
      },
      deps,
    );
    expect(result.batchFailures[0]).toMatchObject({
      reason: 'load_failed',
      detail: expect.stringContaining('ページ画像が 0 件'),
    });
  });

  test('同一画像文書は複数バッチにまたがっても 1 回だけロードする（Promise キャッシュ）', async () => {
    const { provider } = providerOf([chatResponse([DESIGN_ITEM]), chatResponse([DESIGN_ITEM])]);
    const { deps } = makeDeps(provider);
    const loadImages = jest.fn().mockResolvedValue(IMAGE_PAGES);
    deps.loadDocumentPageImages = loadImages;
    const result = await executeRun(
      {
        runId: 'run-1',
        plan: makePlan([
          makeBatch({
            studyId: 'd1',
            section: 'methods',
            documentIds: ['d1'],
            imageDocumentIds: ['d1'],
            fieldIds: ['f_design'],
          }),
          makeBatch({
            studyId: 'd1',
            section: 'population',
            documentIds: ['d1'],
            imageDocumentIds: ['d1'],
            fieldIds: ['f_design'],
          }),
        ]),
        fields: FIELDS,
        documents: [makeDocument('d1', { textStatus: 'no_text_layer', textRef: null })],
      },
      deps,
    );
    expect(loadImages).toHaveBeenCalledTimes(1);
    expect(result.evidence).toHaveLength(2);
  });

  test('複数文書 study に text と image が混在する場合、document_index ごとに入力形式を出し分ける', async () => {
    const artItem = { ...DESIGN_ITEM, document_index: 1 };
    const scanItem = {
      field_id: 'f_n',
      entity_key: 'arm:1',
      value: '60',
      not_reported: false,
      quote: 'irrelevant for image doc',
      page: 1,
      document_index: 2,
      confidence: 'medium',
    };
    const { provider, calls } = providerOf([chatResponse([artItem, scanItem])]);
    const { deps } = makeDeps(provider);
    deps.loadDocumentPageImages = jest.fn().mockResolvedValue(IMAGE_PAGES);
    const result = await executeRun(
      {
        runId: 'run-1',
        plan: makePlan([
          makeBatch({
            studyId: 's1',
            documentIds: ['art', 'scan'],
            imageDocumentIds: ['scan'],
            fieldIds: ['f_design', 'f_n'],
          }),
        ]),
        fields: FIELDS,
        documents: [
          makeDocument('art', { studyId: 's1', documentRole: 'article', filename: 'main.pdf' }),
          makeDocument('scan', {
            studyId: 's1',
            documentRole: 'supplement',
            filename: 'scan.pdf',
            textStatus: 'no_text_layer',
            textRef: null,
          }),
        ],
      },
      deps,
    );

    const userContent = calls[0]!.messages[1]!.content as ChatContentPart[];
    expect(Array.isArray(userContent)).toBe(true);
    const promptText = (userContent[0] as { text: string }).text;
    expect(promptText).toContain('=== Document 1/2 [article] main.pdf ===');
    expect(promptText).toContain('=== Document 2/2 [supplement] scan.pdf ===');
    expect(result.evidence).toEqual([
      expect.objectContaining({ documentId: 'art', anchorStatus: 'exact' }),
      expect.objectContaining({ documentId: 'scan', value: '60', anchorStatus: null }),
    ]);
  });
});

describe('executeRun の box_2d（bbox）。handoff-scanned-pdf-native-highlight.md §7.4 PR3', () => {
  const IMAGE_PAGES: ExtractDataImagePage[] = [
    { page: 1, mimeType: 'image/png', dataBase64: 'QUJD' },
  ];
  const SCAN_ITEM_WITH_BOX = {
    field_id: 'f_design',
    entity_key: '-',
    value: 'randomized controlled trial',
    not_reported: false,
    quote: 'randomized controlled trial',
    page: 1,
    document_index: 1,
    confidence: 'high',
    box_2d: [100, 200, 300, 400],
  };

  test('gemini + 画像文書を含むバッチ: requestBox=true でスキーマ/システムプロンプトに box ルールを載せ、bbox を Evidence へ書く', async () => {
    const { provider, calls } = providerOf([chatResponse([SCAN_ITEM_WITH_BOX])]);
    const { deps } = makeDeps(provider); // providerOf の既定 providerId は 'gemini'
    deps.loadDocumentPageImages = jest.fn().mockResolvedValue(IMAGE_PAGES);
    const result = await executeRun(
      {
        runId: 'run-1',
        plan: makePlan([
          makeBatch({
            studyId: 'd1',
            documentIds: ['d1'],
            imageDocumentIds: ['d1'],
            fieldIds: ['f_design'],
          }),
        ]),
        fields: FIELDS,
        documents: [makeDocument('d1', { textStatus: 'no_text_layer', textRef: null })],
      },
      deps,
    );

    // システムプロンプト・応答スキーマの両方に box ルールが乗る
    const [systemMessage] = calls[0]!.messages;
    expect((systemMessage as { content: string }).content).toContain('box_2d');
    expect(calls[0]!.options?.responseSchema).not.toBe(EXTRACT_DATA_RESPONSE_SCHEMA);
    const schemaItems = calls[0]!.options?.responseSchema?.['items'] as Record<string, unknown>;
    expect((schemaItems['properties'] as Record<string, unknown>)['box_2d']).toBeDefined();

    expect(result.evidence[0]).toMatchObject({
      bboxPage: 1,
      bbox: { ymin: 100, xmin: 200, ymax: 300, xmax: 400 },
    });
  });

  test('gemini でもテキストのみのバッチ: requestBox=false（既存 EXTRACT_DATA_RESPONSE_SCHEMA をそのまま使う）', async () => {
    const { provider, calls } = providerOf([chatResponse([DESIGN_ITEM])]);
    const { deps } = makeDeps(provider);
    const result = await execute(
      {
        runId: 'run-1',
        plan: makePlan([makeBatch({ studyId: 'd1', fieldIds: ['f_design'] })]),
        fields: FIELDS,
      },
      deps,
    );
    const [systemMessage] = calls[0]!.messages;
    expect((systemMessage as { content: string }).content).not.toContain('box_2d');
    expect(calls[0]!.options?.responseSchema).toBe(EXTRACT_DATA_RESPONSE_SCHEMA);
    expect(result.evidence[0]).toMatchObject({ bboxPage: null, bbox: null });
  });

  test('非 gemini provider + 画像文書: requestBox=false のまま実行し、bbox は常に null', async () => {
    const { provider, calls } = providerOf([chatResponse([DESIGN_ITEM])]);
    // providerId を openrouter へ差し替える（box grounding の可否が未確認のため初期対象外。§7.0）
    const nonGeminiProvider: LLMProvider = { ...provider, providerId: 'openrouter' };
    const { deps } = makeDeps(nonGeminiProvider);
    deps.loadDocumentPageImages = jest.fn().mockResolvedValue(IMAGE_PAGES);
    const result = await executeRun(
      {
        runId: 'run-1',
        plan: makePlan([
          makeBatch({
            studyId: 'd1',
            documentIds: ['d1'],
            imageDocumentIds: ['d1'],
            fieldIds: ['f_design'],
          }),
        ]),
        fields: FIELDS,
        documents: [makeDocument('d1', { textStatus: 'no_text_layer', textRef: null })],
      },
      deps,
    );
    const [systemMessage] = calls[0]!.messages;
    expect((systemMessage as { content: string }).content).not.toContain('box_2d');
    expect(calls[0]!.options?.responseSchema).toBe(EXTRACT_DATA_RESPONSE_SCHEMA);
    expect(result.evidence[0]).toMatchObject({ bboxPage: null, bbox: null });
  });

  test('box はあるが page が null: bbox は書かない（page 起点で bboxPage を決めるため）', async () => {
    const { provider } = providerOf([chatResponse([{ ...SCAN_ITEM_WITH_BOX, page: null }])]);
    const { deps } = makeDeps(provider);
    deps.loadDocumentPageImages = jest.fn().mockResolvedValue(IMAGE_PAGES);
    const result = await executeRun(
      {
        runId: 'run-1',
        plan: makePlan([
          makeBatch({
            studyId: 'd1',
            documentIds: ['d1'],
            imageDocumentIds: ['d1'],
            fieldIds: ['f_design'],
          }),
        ]),
        fields: FIELDS,
        documents: [makeDocument('d1', { textStatus: 'no_text_layer', textRef: null })],
      },
      deps,
    );
    expect(result.evidence[0]).toMatchObject({ page: null, bboxPage: null, bbox: null });
  });

  test('text 文書由来の box_2d は無視する（出所文書が画像でなければ bbox を書かない）', async () => {
    // 混在 study（art=text, scan=image）。document_index=1（art）を指す要素に box_2d が
    // 付いていても、出所文書がテキストなので bbox は書かない（幻覚・混線防止）
    const artItemWithBox = { ...DESIGN_ITEM, document_index: 1, box_2d: [1, 2, 3, 4] };
    const scanItem = {
      field_id: 'f_n',
      entity_key: 'arm:1',
      value: '60',
      not_reported: false,
      quote: 'irrelevant for image doc',
      page: 1,
      document_index: 2,
      confidence: 'medium',
    };
    const { provider } = providerOf([chatResponse([artItemWithBox, scanItem])]);
    const { deps } = makeDeps(provider);
    deps.loadDocumentPageImages = jest.fn().mockResolvedValue(IMAGE_PAGES);
    const result = await executeRun(
      {
        runId: 'run-1',
        plan: makePlan([
          makeBatch({
            studyId: 's1',
            documentIds: ['art', 'scan'],
            imageDocumentIds: ['scan'],
            fieldIds: ['f_design', 'f_n'],
          }),
        ]),
        fields: FIELDS,
        documents: [
          makeDocument('art', { studyId: 's1', documentRole: 'article', filename: 'main.pdf' }),
          makeDocument('scan', {
            studyId: 's1',
            documentRole: 'supplement',
            filename: 'scan.pdf',
            textStatus: 'no_text_layer',
            textRef: null,
          }),
        ],
      },
      deps,
    );
    expect(result.evidence).toEqual([
      expect.objectContaining({ documentId: 'art', bboxPage: null, bbox: null }),
      expect.objectContaining({ documentId: 'scan', bboxPage: null, bbox: null }),
    ]);
  });
});

describe('executeRun の並行実行（maxConcurrency）', () => {
  const fourStudies = () =>
    makePlan([
      makeBatch({ studyId: 'd1', fieldIds: ['f_design'] }),
      makeBatch({ studyId: 'd2', fieldIds: ['f_design'] }),
      makeBatch({ studyId: 'd3', fieldIds: ['f_design'] }),
      makeBatch({ studyId: 'd4', fieldIds: ['f_design'] }),
    ]);

  test('maxConcurrency=2 は同時実行を 2 本までに抑える', async () => {
    const { provider, peak, releaseAll } = gatedProvider();
    const { deps } = makeDeps(provider);
    deps.maxConcurrency = 2;
    const runPromise = execute({ runId: 'run-1', plan: fourStudies(), fields: FIELDS }, deps);
    await drain(runPromise, releaseAll);
    const result = await runPromise;
    expect(peak()).toBe(2);
    expect(result.evidence).toHaveLength(4);
    expect(result.status).toBe('done');
    // トークンは順不同でも合算は同値（可換）
    expect(result.tokensIn).toBe(40);
    expect(result.tokensOut).toBe(20);
    expect(new Set(result.evidence.map((e) => e.studyId))).toEqual(
      new Set(['d1', 'd2', 'd3', 'd4']),
    );
  });

  test('maxConcurrency=1（既定相当）は逐次で 1 本ずつ', async () => {
    const { provider, peak, releaseAll } = gatedProvider();
    const { deps } = makeDeps(provider);
    deps.maxConcurrency = 1;
    const runPromise = execute({ runId: 'run-1', plan: fourStudies(), fields: FIELDS }, deps);
    await drain(runPromise, releaseAll);
    expect(peak()).toBe(1);
  });

  test('maxConcurrency=0 以下は 1（逐次）に丸める', async () => {
    const { provider, peak, releaseAll } = gatedProvider();
    const { deps } = makeDeps(provider);
    deps.maxConcurrency = 0;
    const runPromise = execute({ runId: 'run-1', plan: fourStudies(), fields: FIELDS }, deps);
    await drain(runPromise, releaseAll);
    expect(peak()).toBe(1);
  });

  test('並行実行でも同一 document は 1 回だけロードする（Promise キャッシュ）', async () => {
    // 同一 study の 2 バッチ（section 分割）が同時に同じ document を miss しても loadPages は 1 回
    const { provider } = providerOf([chatResponse([DESIGN_ITEM]), chatResponse([DESIGN_ITEM])]);
    const { deps, loadPages } = makeDeps(provider);
    deps.maxConcurrency = 2;
    const result = await execute(
      {
        runId: 'run-1',
        plan: makePlan([
          makeBatch({ studyId: 'd1', section: 'methods', fieldIds: ['f_design'] }),
          makeBatch({ studyId: 'd1', section: 'population', fieldIds: ['f_design'] }),
        ]),
        fields: FIELDS,
      },
      deps,
    );
    expect(loadPages).toHaveBeenCalledTimes(1);
    expect(result.evidence).toHaveLength(2);
  });
});

describe('executeRun の Evidence 書き込みバッチ化（429 対策）', () => {
  const studiesPlan = (studyIds: readonly string[]): RunPlan =>
    makePlan(studyIds.map((id) => makeBatch({ studyId: id, fieldIds: ['f_design'] })));

  test('study 数が既定値（DEFAULT_FLUSH_EVERY_N_STUDIES=5）ちょうどなら、実行中に 1 回だけフラッシュする', async () => {
    expect(DEFAULT_FLUSH_EVERY_N_STUDIES).toBe(5);
    const { provider } = providerOf(Array.from({ length: 5 }, () => chatResponse([DESIGN_ITEM])));
    // deps.flushEveryNStudies は指定しない = 既定値が使われる
    const { deps } = makeDeps(provider);
    const appendCalls: Evidence[][] = [];
    deps.appendEvidence = async (rows) => {
      appendCalls.push([...rows]);
    };
    const result = await execute(
      { runId: 'run-1', plan: studiesPlan(['d1', 'd2', 'd3', 'd4', 'd5']), fields: FIELDS },
      deps,
    );

    expect(appendCalls).toHaveLength(1);
    expect(appendCalls[0]).toHaveLength(5);
    expect(result.evidence).toHaveLength(5);
    expect(result.status).toBe('done');
  });

  test('flushEveryNStudies ごとに appendEvidence を分割して呼び、端数は全 study 完了時にまとめて書く', async () => {
    const { provider } = providerOf(Array.from({ length: 7 }, () => chatResponse([DESIGN_ITEM])));
    const { deps, progress } = makeDeps(provider);
    deps.flushEveryNStudies = 3;
    const appendCalls: Evidence[][] = [];
    deps.appendEvidence = async (rows) => {
      appendCalls.push([...rows]);
    };
    const result = await execute(
      {
        runId: 'run-1',
        plan: studiesPlan(['d1', 'd2', 'd3', 'd4', 'd5', 'd6', 'd7']),
        fields: FIELDS,
      },
      deps,
    );

    // 7 study を 3 件ずつ分割 → [3, 3, 1]（最後の端数は全 study 完了時のフラッシュで書く）
    expect(appendCalls.map((rows) => rows.length)).toEqual([3, 3, 1]);
    expect(result.evidence).toHaveLength(7);
    expect(result.status).toBe('done');
    expect(progress).toHaveLength(7);
    expect(progress.every((p) => p.failure === null)).toBe(true);
  });

  test('フラッシュ失敗時は、そのフラッシュに含まれる study を全部 save_failed にし、他のフラッシュの成否には影響しない', async () => {
    const { provider } = providerOf(Array.from({ length: 4 }, () => chatResponse([DESIGN_ITEM])));
    const { deps } = makeDeps(provider);
    deps.flushEveryNStudies = 2;
    const appendCalls: Evidence[][] = [];
    deps.appendEvidence = async (rows) => {
      appendCalls.push([...rows]);
      if (appendCalls.length === 2) {
        // 2 回目（d3, d4 ぶん）のフラッシュだけ失敗させる
        throw new Error('sheets quota (2nd flush)');
      }
    };
    const result = await execute(
      { runId: 'run-1', plan: studiesPlan(['d1', 'd2', 'd3', 'd4']), fields: FIELDS },
      deps,
    );

    expect(result.status).toBe('partial_failure');
    // d1, d2 は 1 回目のフラッシュで保存済み。d3, d4 は保存されない（結果に含めない）
    expect(result.evidence).toHaveLength(2);
    expect(new Set(result.evidence.map((e) => e.studyId))).toEqual(new Set(['d1', 'd2']));
    expect(result.batchFailures).toEqual([
      { studyId: 'd3', section: null, reason: 'save_failed', detail: 'sheets quota (2nd flush)' },
      { studyId: 'd4', section: null, reason: 'save_failed', detail: 'sheets quota (2nd flush)' },
    ]);
  });

  test('並行実行でも二重フラッシュしない: フラッシュ中に他バッチが閾値へ達しても、フラッシュ完了後にまとめて処理する', async () => {
    const { provider } = providerOf(Array.from({ length: 6 }, () => chatResponse([DESIGN_ITEM])));
    const { deps } = makeDeps(provider);
    deps.maxConcurrency = 6;
    deps.flushEveryNStudies = 3;
    const appendCalls: Evidence[][] = [];
    let releaseFirstFlush: (() => void) | undefined;
    deps.appendEvidence = async (rows) => {
      appendCalls.push([...rows]);
      if (appendCalls.length === 1) {
        // 1 回目のフラッシュだけ完了を止める。この間に d4〜d6 も閾値（3 件）に達するが、
        // flushPromise が埋まっているので二重には走らないはず
        await new Promise<void>((resolve) => {
          releaseFirstFlush = resolve;
        });
      }
    };
    const runPromise = execute(
      { runId: 'run-1', plan: studiesPlan(['d1', 'd2', 'd3', 'd4', 'd5', 'd6']), fields: FIELDS },
      deps,
    );

    // d1〜d6 の push が出そろい、1 回目のフラッシュが appendEvidence 内でブロックされるまで待つ
    while (releaseFirstFlush === undefined) {
      await new Promise((resolve) => setTimeout(resolve, 0));
    }
    // この時点でフラッシュは 1 回しか走っていない（二重フラッシュしていないことの確認）
    expect(appendCalls).toHaveLength(1);
    expect(appendCalls[0]).toHaveLength(3);

    (releaseFirstFlush as () => void)();
    const result = await runPromise;

    expect(appendCalls).toHaveLength(2);
    expect(appendCalls[1]).toHaveLength(3);
    expect(result.evidence).toHaveLength(6);
    expect(result.status).toBe('done');
  });

  test('flushEveryNStudies に 0 以下や小数を渡しても 1 以上の整数に丸める', async () => {
    const { provider } = providerOf(Array.from({ length: 3 }, () => chatResponse([DESIGN_ITEM])));
    const { deps } = makeDeps(provider);
    deps.flushEveryNStudies = 0; // floor(0)=0 → max(1,0)=1 に丸められる
    const appendCalls: Evidence[][] = [];
    deps.appendEvidence = async (rows) => {
      appendCalls.push([...rows]);
    };
    const result = await execute(
      { runId: 'run-1', plan: studiesPlan(['d1', 'd2', 'd3']), fields: FIELDS },
      deps,
    );

    // 1 study ごとに毎回フラッシュする（バッチ化を無効にした従来相当の挙動）
    expect(appendCalls.map((rows) => rows.length)).toEqual([1, 1, 1]);
    expect(result.evidence).toHaveLength(3);
  });

  test('DEFAULT_MAX_ROWS_PER_FLUSH は 500', () => {
    expect(DEFAULT_MAX_ROWS_PER_FLUSH).toBe(500);
  });

  test('study 数が閾値未満でも、バッファの総行数が maxRowsPerFlush 以上になればフラッシュする（行キャップ）', async () => {
    // 1 バッチ（= 1 study）で 2 行返す応答を 2 バッチぶん用意する
    const twoItemsResponse = chatResponse([DESIGN_ITEM, ARM_ITEM]);
    const { provider } = providerOf([twoItemsResponse, twoItemsResponse]);
    const { deps } = makeDeps(provider);
    deps.flushEveryNStudies = 10; // study 数条件では発火しない大きさにする
    deps.maxRowsPerFlush = 3; // 2 study 目の push で累計 4 行 >= 3 に達して発火する
    const appendCalls: Evidence[][] = [];
    deps.appendEvidence = async (rows) => {
      appendCalls.push([...rows]);
    };
    const result = await execute(
      {
        runId: 'run-1',
        plan: makePlan([
          makeBatch({ studyId: 'd1', fieldIds: ['f_design', 'f_n'] }),
          makeBatch({ studyId: 'd2', fieldIds: ['f_design', 'f_n'] }),
        ]),
        fields: FIELDS,
      },
      deps,
    );

    // study 数（2）は flushEveryNStudies（10）未満だが、行数（4）が maxRowsPerFlush（3）以上になり発火する
    expect(appendCalls).toHaveLength(1);
    expect(appendCalls[0]).toHaveLength(4);
    expect(result.evidence).toHaveLength(4);
    expect(result.status).toBe('done');
  });

  test('maxRowsPerFlush に 0 以下や小数を渡しても 1 以上の整数に丸める', async () => {
    const { provider } = providerOf(Array.from({ length: 3 }, () => chatResponse([DESIGN_ITEM])));
    const { deps } = makeDeps(provider);
    deps.flushEveryNStudies = 10; // 行キャップだけで発火することを確認するため大きめにする
    deps.maxRowsPerFlush = 0; // floor(0)=0 → max(1,0)=1 に丸められる
    const appendCalls: Evidence[][] = [];
    deps.appendEvidence = async (rows) => {
      appendCalls.push([...rows]);
    };
    const result = await execute(
      { runId: 'run-1', plan: studiesPlan(['d1', 'd2', 'd3']), fields: FIELDS },
      deps,
    );

    // 1 行たまるたびに毎回フラッシュする
    expect(appendCalls.map((rows) => rows.length)).toEqual([1, 1, 1]);
    expect(result.evidence).toHaveLength(3);
  });
});

describe('executeRun の実測集計', () => {
  test('トークンが一度も取れなければ null のまま返す', async () => {
    const { provider } = providerOf([chatResponse([DESIGN_ITEM])]);
    const { deps } = makeDeps(provider);
    const result = await execute(
      {
        runId: 'run-1',
        plan: makePlan([makeBatch({ studyId: 'd1', fieldIds: ['f_design'] })]),
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
    const result = await execute(
      {
        runId: 'run-1',
        plan: makePlan([
          makeBatch({ studyId: 'd1', fieldIds: ['f_design'] }),
          makeBatch({ studyId: 'd2', fieldIds: ['f_n'] }),
          makeBatch({ studyId: 'd3', fieldIds: ['f_n'] }),
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
    const result = await execute(
      {
        runId: 'run-1',
        plan: makePlan([
          makeBatch({ studyId: 'd1', fieldIds: ['f_design'] }),
          makeBatch({ studyId: 'd2', fieldIds: ['f_n'] }),
          makeBatch({ studyId: 'd3', fieldIds: ['f_n'] }),
          makeBatch({ studyId: 'd4', fieldIds: ['f_n'] }),
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
    const result = await execute(
      {
        runId: 'run-1',
        plan: makePlan([makeBatch({ studyId: 'd1', fieldIds: ['f_design'] })]),
        fields: FIELDS,
      },
      deps,
    );
    expect(result.modelVersion).toBeNull();
  });
});
