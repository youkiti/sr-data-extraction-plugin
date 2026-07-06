import { runExtraction } from '../../../../src/app/services/extractionService';
import type { DocumentRecord } from '../../../../src/domain/document';
import type { SchemaField } from '../../../../src/domain/schemaField';
import { upsertResultsDataRows, upsertStudyDataRows } from '../../../../src/features/extraction/annotationRepository';
import { appendEvidenceRows } from '../../../../src/features/extraction/evidenceRepository';
import { appendExtractionRun } from '../../../../src/features/extraction/runRepository';
import type { ExtractDataPage } from '../../../../src/features/extraction/skills/extractData';
import { uploadTextFile } from '../../../../src/lib/google/drive';
import type { GoogleApiDeps } from '../../../../src/lib/google/types';
import { appendLlmApiLog } from '../../../../src/lib/llm/apiLogRepository';
import type { ChatResponse, LLMProvider } from '../../../../src/lib/llm/LLMProvider';

jest.mock('../../../../src/features/extraction/annotationRepository');
jest.mock('../../../../src/features/extraction/evidenceRepository');
jest.mock('../../../../src/features/extraction/runRepository');
jest.mock('../../../../src/lib/google/drive');
jest.mock('../../../../src/lib/llm/apiLogRepository');

const mockedUpload = jest.mocked(uploadTextFile);
const mockedAppendLog = jest.mocked(appendLlmApiLog);
const mockedAppendEvidence = jest.mocked(appendEvidenceRows);
const mockedUpsertStudy = jest.mocked(upsertStudyDataRows);
const mockedUpsertResults = jest.mocked(upsertResultsDataRows);
const mockedAppendRun = jest.mocked(appendExtractionRun);

const GOOGLE: GoogleApiDeps = {
  fetch: jest.fn(),
  getAccessToken: jest.fn().mockResolvedValue('token'),
};

function makeDocument(overrides: Partial<DocumentRecord> = {}): DocumentRecord {
  return {
    documentId: 'doc-1',
    studyLabel: 'Smith 2020',
    driveFileId: 'drive-1',
    sourceFileId: 'src-1',
    filename: 'smith2020.pdf',
    pmid: null,
    doi: null,
    textRef: 'https://drive/text-1',
    textStatus: 'ok',
    pageCount: 1,
    charCount: 500,
    importedAt: 't0',
    importedBy: 'me',
    note: null,
    ...overrides,
  };
}

function makeField(overrides: Partial<SchemaField> = {}): SchemaField {
  return {
    schemaVersion: 2,
    fieldId: 'f-study',
    fieldIndex: 1,
    section: 'population',
    fieldName: 'sample_size_total',
    fieldLabel: '総サンプルサイズ',
    entityLevel: 'study',
    dataType: 'integer',
    unit: null,
    allowedValues: null,
    required: true,
    extractionInstruction: '総サンプルサイズを抽出する',
    example: null,
    aiGenerated: true,
    note: null,
    ...overrides,
  };
}

const PAGES: ExtractDataPage[] = [{ page: 1, text: 'A total of 120 patients were enrolled.' }];

const AI_RESPONSE: ChatResponse = {
  text: JSON.stringify([
    {
      field_id: 'f-study',
      entity_key: '-',
      value: '120',
      not_reported: false,
      quote: '120 patients',
      page: 1,
      confidence: 'high',
    },
  ]),
  tokensIn: 1000,
  tokensOut: 200,
  raw: { modelVersion: 'gemini-2.5-flash-001' },
};

function makeProvider(chat: jest.Mock): LLMProvider {
  return { providerId: 'gemini', model: 'gemini-2.5-flash', chat };
}

function makeDeps(chat: jest.Mock) {
  let uuidCount = 0;
  return {
    google: GOOGLE,
    apiKey: 'KEY',
    loadDocumentPages: jest.fn().mockResolvedValue(PAGES),
    buildProvider: jest.fn().mockReturnValue(makeProvider(chat)),
    newUuid: () => `u${++uuidCount}`,
    now: () => 'NOW',
  };
}

function baseParams() {
  return {
    spreadsheetId: 'sid',
    logsLlmFolderId: 'folder-logs',
    runType: 'full' as const,
    documents: [makeDocument()],
    fields: [makeField()],
    model: 'gemini-2.5-flash',
  };
}

beforeEach(() => {
  jest.clearAllMocks();
  mockedUpload.mockResolvedValue({ id: 'file-1', webViewLink: 'https://drive/log' });
});

describe('runExtraction', () => {
  test('planRun → executeRun → Evidence 追記 → ai 行転記 → ExtractionRuns 追記を結線する', async () => {
    const chat = jest.fn().mockResolvedValue(AI_RESPONSE);
    const deps = makeDeps(chat);
    const progress: number[] = [];
    const outcome = await runExtraction(
      { ...baseParams(), onProgress: (p) => progress.push(p.completedBatches) },
      deps,
    );

    // 実行結果と ExtractionRuns 行
    expect(outcome.result.status).toBe('done');
    expect(outcome.run).toEqual({
      runId: 'u1', // 最初の uuid が run_id
      runType: 'full',
      schemaVersion: 2,
      documentIds: ['doc-1'],
      provider: 'gemini',
      requestedModel: 'gemini-2.5-flash',
      modelVersion: 'gemini-2.5-flash-001',
      inputMode: 'text_only',
      status: 'done',
      startedAt: 'NOW',
      finishedAt: 'NOW',
      tokensIn: 1000,
      tokensOut: 200,
      costEstimate: outcome.plan.costEstimateUsd,
    });
    // 2 行プロトコル: running 行 → 完了行の順に 2 回追記する
    expect(mockedAppendRun).toHaveBeenCalledTimes(2);
    expect(mockedAppendRun).toHaveBeenNthCalledWith(
      1,
      'sid',
      {
        ...outcome.run,
        modelVersion: null,
        status: 'running',
        finishedAt: null,
        tokensIn: null,
        tokensOut: null,
      },
      GOOGLE,
    );
    expect(mockedAppendRun).toHaveBeenNthCalledWith(2, 'sid', outcome.run, GOOGLE);
    // running 行は Evidence 追記より先（孤児 Evidence を生まない不変条件）
    expect(mockedAppendRun.mock.invocationCallOrder[0]).toBeLessThan(
      mockedAppendEvidence.mock.invocationCallOrder[0] as number,
    );

    // Evidence はアンカリング確定済みで追記される
    expect(mockedAppendEvidence).toHaveBeenCalledTimes(1);
    const [sheetId, evidence] = mockedAppendEvidence.mock.calls[0] as unknown as [
      string,
      { fieldId: string; runId: string; anchorStatus: string }[],
    ];
    expect(sheetId).toBe('sid');
    expect(evidence[0]).toMatchObject({ fieldId: 'f-study', runId: 'u1', anchorStatus: 'exact' });

    // ai annotator 行への転記（§4.3）
    expect(mockedUpsertStudy).toHaveBeenCalledWith(
      'sid',
      [
        expect.objectContaining({
          documentId: 'doc-1',
          annotator: 'ai',
          runId: 'u1',
          values: { sample_size_total: '120' },
        }),
      ],
      GOOGLE,
    );
    expect(mockedUpsertResults).toHaveBeenCalledWith('sid', [], GOOGLE, { newUuid: deps.newUuid });

    // LLM 呼び出しは温度 0 + 構造化出力で 1 バッチ 1 回
    expect(chat).toHaveBeenCalledTimes(1);
    expect(chat.mock.calls[0][1]).toMatchObject({ temperature: 0 });

    // 進捗通知
    expect(progress).toEqual([1]);
  });

  test('withLogging の配線: プロンプト版数付き payload を logs/llm へ保存し LLMApiLog に追記する', async () => {
    const chat = jest.fn().mockResolvedValue(AI_RESPONSE);
    const deps = makeDeps(chat);
    await runExtraction(baseParams(), deps);

    // prompt / response の 2 ファイル
    expect(mockedUpload).toHaveBeenCalledTimes(2);
    const promptCall = mockedUpload.mock.calls[0]?.[0];
    expect(promptCall?.parentId).toBe('folder-logs');
    expect(promptCall?.mimeType).toBe('application/json');
    expect(promptCall?.name).toMatch(/\.prompt\.json$/);
    expect(JSON.parse(promptCall?.content ?? '{}').promptVersion).toBe(1); // EXTRACT_DATA_PROMPT_VERSION
    expect(mockedUpload.mock.calls[1]?.[0].name).toMatch(/\.response\.json$/);

    expect(mockedAppendLog).toHaveBeenCalledTimes(1);
    const [logSheetId, entry] = mockedAppendLog.mock.calls[0] ?? [];
    expect(logSheetId).toBe('sid');
    expect(entry).toMatchObject({
      provider: 'gemini',
      model: 'gemini-2.5-flash',
      purpose: 'extract_document',
      tokensIn: 1000,
      tokensOut: 200,
      error: null,
    });
  });

  test('全文献がテキスト層なしなら実行前に throw する', async () => {
    const chat = jest.fn();
    await expect(
      runExtraction(
        { ...baseParams(), documents: [makeDocument({ textStatus: 'no_text_layer' })] },
        makeDeps(chat),
      ),
    ).rejects.toThrow('抽出できる文献がありません');
    expect(chat).not.toHaveBeenCalled();
    expect(mockedAppendRun).not.toHaveBeenCalled();
  });

  test('省略可能な依存（buildProvider / newUuid / now）は既定実装で動く', async () => {
    // loadDocumentPages を失敗させると LLM 呼び出しなしで partial_failure になり、
    // 既定 buildProvider（createProvider = 実 GeminiProvider 生成）でもネットワークに触れない
    const outcome = await runExtraction(baseParams(), {
      google: GOOGLE,
      apiKey: 'KEY',
      loadDocumentPages: jest.fn().mockRejectedValue(new Error('drive down')),
    });
    expect(outcome.run.status).toBe('partial_failure');
    expect(outcome.result.batchFailures).toEqual([
      { documentId: 'doc-1', section: null, reason: 'load_failed', detail: 'drive down' },
    ]);
    expect(outcome.run.provider).toBe('gemini');
    expect(outcome.run.runId).toMatch(/^[0-9a-f]{8}-/); // 既定 UUID 発番
    expect(outcome.run.tokensIn).toBeNull();
    expect(mockedAppendRun).toHaveBeenCalledTimes(2); // running 行 + 完了行
  });
});
