import {
  relocateQuote,
  type RelocateQuoteDeps,
  type RelocateQuoteParams,
} from '../../../../src/app/services/relocateQuoteService';
import type { Evidence } from '../../../../src/domain/evidence';
import type { SchemaField } from '../../../../src/domain/schemaField';
import {
  appendEvidenceRows,
  ensureEvidenceRelocatedFromColumn,
} from '../../../../src/features/extraction/evidenceRepository';
import type { ExtractDataPage } from '../../../../src/features/extraction/skills/extractData';
import { ensureChildFolder, uploadTextFile } from '../../../../src/lib/google/drive';
import { appendLlmApiLog } from '../../../../src/lib/llm/apiLogRepository';
import type { ChatResponse, LLMProvider } from '../../../../src/lib/llm/LLMProvider';

jest.mock('../../../../src/lib/google/drive', () => ({
  ensureChildFolder: jest.fn(),
  uploadTextFile: jest.fn(),
}));
jest.mock('../../../../src/lib/llm/apiLogRepository', () => ({
  appendLlmApiLog: jest.fn(),
}));
jest.mock('../../../../src/features/extraction/evidenceRepository', () => ({
  appendEvidenceRows: jest.fn(),
  ensureEvidenceRelocatedFromColumn: jest.fn(),
}));

const ensureChildFolderMock = ensureChildFolder as jest.MockedFunction<typeof ensureChildFolder>;
const uploadTextFileMock = uploadTextFile as jest.MockedFunction<typeof uploadTextFile>;
const appendLlmApiLogMock = appendLlmApiLog as jest.MockedFunction<typeof appendLlmApiLog>;
const appendEvidenceRowsMock = appendEvidenceRows as jest.MockedFunction<typeof appendEvidenceRows>;
const ensureEvidenceRelocatedFromColumnMock = ensureEvidenceRelocatedFromColumn as jest.MockedFunction<
  typeof ensureEvidenceRelocatedFromColumn
>;

function makeEvidence(overrides: Partial<Evidence> = {}): Evidence {
  return {
    evidenceId: 'ev-1',
    runId: 'run-1',
    studyId: 'study-1',
    documentId: 'doc-1',
    fieldId: 'f-1',
    entityKey: '-',
    value: '120',
    notReported: false,
    quote: 'a totall of 120 patients', // わざとタイポ（アンカリング失敗の原因を模す）
    page: 3,
    confidence: 'high',
    anchorStatus: 'failed',
    bboxPage: null,
    bbox: null,
    relocatedFrom: null,
    ...overrides,
  };
}

function makeField(overrides: Partial<SchemaField> = {}): SchemaField {
  return {
    schemaVersion: 1,
    fieldId: 'f-1',
    fieldIndex: 1,
    section: 'population',
    fieldName: 'sample_size_total',
    fieldLabel: '総サンプルサイズ',
    entityLevel: 'study',
    dataType: 'integer',
    unit: null,
    allowedValues: null,
    required: true,
    extractionInstruction: 'Report the total number of randomised participants.',
    example: null,
    aiGenerated: false,
    note: null,
    ...overrides,
  };
}

function pages(): ExtractDataPage[] {
  return [
    { page: 1, text: 'introduction text' },
    { page: 3, text: 'Methods: a total of 120 patients were randomised into two arms.' },
  ];
}

function makeDeps(overrides: Partial<RelocateQuoteDeps> = {}): {
  deps: RelocateQuoteDeps;
  chatMock: jest.Mock<Promise<ChatResponse>, Parameters<LLMProvider['chat']>>;
} {
  const chatMock = jest.fn<Promise<ChatResponse>, Parameters<LLMProvider['chat']>>(async () => ({
    text: JSON.stringify({
      found: true,
      quote: 'a total of 120 patients were randomised into two arms.',
      page: 3,
    }),
    tokensIn: 10,
    tokensOut: 5,
    raw: {},
  }));
  const deps: RelocateQuoteDeps = {
    google: { fetch: jest.fn() as unknown as typeof fetch, getAccessToken: async () => 't' },
    loadApiKey: async () => 'api-key',
    buildProvider: (config) => ({
      providerId: 'gemini',
      model: config.model,
      supportsImageInput: true,
      chat: chatMock,
    }),
    newUuid: () => 'new-ev-uuid',
    now: () => '2026-07-13T00:00:00Z',
    ...overrides,
  };
  return { deps, chatMock };
}

function makeParams(overrides: Partial<RelocateQuoteParams> = {}): RelocateQuoteParams {
  return {
    spreadsheetId: 'sheet-1',
    driveFolderId: 'folder-1',
    evidence: makeEvidence(),
    field: makeField(),
    documentPages: pages(),
    ...overrides,
  };
}

beforeEach(() => {
  jest.clearAllMocks();
  ensureChildFolderMock.mockResolvedValue({
    id: 'folder-x',
    webViewLink: 'https://drive.google.com/drive/folders/folder-x',
  });
  uploadTextFileMock.mockResolvedValue({
    id: 'log-1',
    webViewLink: 'https://drive.google.com/file/d/log-1/view',
  });
  appendLlmApiLogMock.mockResolvedValue(undefined);
  appendEvidenceRowsMock.mockResolvedValue(undefined);
  ensureEvidenceRelocatedFromColumnMock.mockResolvedValue(undefined);
});

describe('relocateQuote', () => {
  test('成功: LLM の quote が fuzzy 以上で再アンカリングできれば Evidence を追記して relocated を返す', async () => {
    const { deps, chatMock } = makeDeps();
    const outcome = await relocateQuote(makeParams(), deps);
    expect(outcome.status).toBe('relocated');
    if (outcome.status !== 'relocated') {
      throw new Error('unreachable');
    }
    expect(outcome.evidence).toMatchObject({
      evidenceId: 'new-ev-uuid',
      runId: 'run-1',
      studyId: 'study-1',
      fieldId: 'f-1',
      documentId: 'doc-1',
      entityKey: '-',
      value: '120', // 値は変えない
      notReported: false,
      quote: 'a total of 120 patients were randomised into two arms.',
      confidence: 'high', // 元の confidence を維持
      relocatedFrom: 'ev-1',
    });
    expect(outcome.evidence.anchorStatus).not.toBe('failed');
    expect(outcome.evidence.anchorStatus).not.toBeNull();
    // ensureEvidenceRelocatedFromColumn → appendEvidenceRows の順で呼ばれる
    expect(ensureEvidenceRelocatedFromColumnMock).toHaveBeenCalledWith('sheet-1', deps.google);
    expect(appendEvidenceRowsMock).toHaveBeenCalledWith('sheet-1', [outcome.evidence], deps.google);
    // LLMApiLog（withLogging）記録
    expect(appendLlmApiLogMock).toHaveBeenCalledTimes(1);
    expect(appendLlmApiLogMock.mock.calls[0]?.[1]).toMatchObject({ purpose: 'relocate_quote' });
    expect(chatMock).toHaveBeenCalledTimes(1);
  });

  test('LLM が not_found を返したら Evidence を追記せず not_found を返す', async () => {
    const { deps } = makeDeps();
    const chatMock = jest.fn<Promise<ChatResponse>, Parameters<LLMProvider['chat']>>(async () => ({
      text: JSON.stringify({ found: false, quote: null, page: null }),
      tokensIn: 5,
      tokensOut: 2,
      raw: {},
    }));
    deps.buildProvider = (config) => ({
      providerId: 'gemini',
      model: config.model,
      supportsImageInput: true,
      chat: chatMock,
    });
    const outcome = await relocateQuote(makeParams(), deps);
    expect(outcome).toEqual({ status: 'not_found' });
    expect(appendEvidenceRowsMock).not.toHaveBeenCalled();
    // LLM 呼び出し自体は行われ、LLMApiLog には記録される（監査目的で成功/失敗を問わず記録）
    expect(appendLlmApiLogMock).toHaveBeenCalledTimes(1);
  });

  test('LLM が誤った quote を返した場合（本文に存在しない）は採用せず not_found を返す', async () => {
    const { deps } = makeDeps();
    const chatMock = jest.fn<Promise<ChatResponse>, Parameters<LLMProvider['chat']>>(async () => ({
      text: JSON.stringify({ found: true, quote: 'this text does not exist anywhere', page: 3 }),
      tokensIn: 5,
      tokensOut: 2,
      raw: {},
    }));
    deps.buildProvider = (config) => ({
      providerId: 'gemini',
      model: config.model,
      supportsImageInput: true,
      chat: chatMock,
    });
    const outcome = await relocateQuote(makeParams(), deps);
    expect(outcome).toEqual({ status: 'not_found' });
    expect(appendEvidenceRowsMock).not.toHaveBeenCalled();
  });

  test('documentPages が空なら LLM を呼ばず not_found を返す', async () => {
    const { deps, chatMock } = makeDeps();
    const outcome = await relocateQuote(makeParams({ documentPages: [] }), deps);
    expect(outcome.status).toBe('not_found');
    expect(chatMock).not.toHaveBeenCalled();
    expect(ensureChildFolderMock).not.toHaveBeenCalled();
  });

  test('API キー未設定なら LLM を呼ばず missingApiKeyMessage を返す', async () => {
    const { deps, chatMock } = makeDeps({ loadApiKey: async () => null });
    const outcome = await relocateQuote(makeParams(), deps);
    expect(outcome.status).toBe('not_found');
    if (outcome.status === 'not_found') {
      expect(outcome.message).toContain('API キーが未設定です');
    }
    expect(chatMock).not.toHaveBeenCalled();
  });

  test('LLM 呼び出し自体が失敗（ネットワークエラー等）した場合も not_found へ落とす', async () => {
    const { deps } = makeDeps();
    const chatMock = jest.fn<Promise<ChatResponse>, Parameters<LLMProvider['chat']>>(async () => {
      throw new Error('network down');
    });
    deps.buildProvider = (config) => ({
      providerId: 'gemini',
      model: config.model,
      supportsImageInput: true,
      chat: chatMock,
    });
    const outcome = await relocateQuote(makeParams(), deps);
    expect(outcome.status).toBe('not_found');
    if (outcome.status === 'not_found') {
      expect(outcome.message).toContain('network down');
    }
    expect(appendEvidenceRowsMock).not.toHaveBeenCalled();
  });

  test('LLM 応答が JSON としてパースできない場合も not_found へ落とす', async () => {
    const { deps } = makeDeps();
    const chatMock = jest.fn<Promise<ChatResponse>, Parameters<LLMProvider['chat']>>(async () => ({
      text: 'not json at all',
      tokensIn: 1,
      tokensOut: 1,
      raw: {},
    }));
    deps.buildProvider = (config) => ({
      providerId: 'gemini',
      model: config.model,
      supportsImageInput: true,
      chat: chatMock,
    });
    const outcome = await relocateQuote(makeParams(), deps);
    expect(outcome.status).toBe('not_found');
  });

  test('resolveRateLimitPolicy が注入されていれば使う（未注入は UNLIMITED_POLICY）', async () => {
    const resolveRateLimitPolicy = jest.fn().mockResolvedValue({
      requestsPerMinute: null,
      maxAttempts: 1,
      baseDelayMs: 1,
      maxDelayMs: 1,
      maxConcurrency: 1,
      flushEveryNStudies: 5,
    });
    const { deps } = makeDeps({ resolveRateLimitPolicy });
    await relocateQuote(makeParams(), deps);
    expect(resolveRateLimitPolicy).toHaveBeenCalledTimes(1);
  });

  test('Evidence 追記（appendEvidenceRows）が失敗しても throw せず not_found へ落とす', async () => {
    const { deps } = makeDeps();
    appendEvidenceRowsMock.mockRejectedValue(new Error('append failed'));
    const outcome = await relocateQuote(makeParams(), deps);
    expect(outcome.status).toBe('not_found');
    if (outcome.status === 'not_found') {
      expect(outcome.message).toContain('append failed');
    }
  });

  test('newUuid 未注入時は utils/uuid.generateUuid を既定で使う', async () => {
    const { deps } = makeDeps({ newUuid: undefined });
    const outcome = await relocateQuote(makeParams(), deps);
    expect(outcome.status).toBe('relocated');
    if (outcome.status === 'relocated') {
      expect(outcome.evidence.evidenceId).toEqual(expect.any(String));
      expect(outcome.evidence.evidenceId.length).toBeGreaterThan(0);
    }
  });

  test('Error インスタンスでない値が reject されても String() 化して message に残す', async () => {
    const { deps } = makeDeps();
    ensureEvidenceRelocatedFromColumnMock.mockRejectedValue('plain string rejection');
    const outcome = await relocateQuote(makeParams(), deps);
    expect(outcome.status).toBe('not_found');
    if (outcome.status === 'not_found') {
      expect(outcome.message).toBe('plain string rejection');
    }
  });
});
