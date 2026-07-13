import { runExtraction } from '../../../../src/app/services/extractionService';
import type { DocumentRecord } from '../../../../src/domain/document';
import type { SchemaField } from '../../../../src/domain/schemaField';
import { upsertResultsDataRows, upsertStudyDataRows } from '../../../../src/features/extraction/annotationRepository';
import {
  appendEvidenceRows,
  ensureEvidenceBboxColumns,
} from '../../../../src/features/extraction/evidenceRepository';
import {
  appendExtractionRun,
  ensureRunFieldIdsColumn,
} from '../../../../src/features/extraction/runRepository';
import type { ExtractDataPage } from '../../../../src/features/extraction/skills/extractData';
import { uploadTextFile } from '../../../../src/lib/google/drive';
import type { GoogleApiDeps } from '../../../../src/lib/google/types';
import { appendLlmApiLog } from '../../../../src/lib/llm/apiLogRepository';
import type { ChatResponse, LLMProvider } from '../../../../src/lib/llm/LLMProvider';
import type { RateLimitPolicy } from '../../../../src/lib/llm/rateLimitPolicy';

jest.mock('../../../../src/features/extraction/annotationRepository');
jest.mock('../../../../src/features/extraction/evidenceRepository');
jest.mock('../../../../src/features/extraction/runRepository');
jest.mock('../../../../src/lib/google/drive');
jest.mock('../../../../src/lib/llm/apiLogRepository');

const mockedUpload = jest.mocked(uploadTextFile);
const mockedAppendLog = jest.mocked(appendLlmApiLog);
const mockedAppendEvidence = jest.mocked(appendEvidenceRows);
const mockedEnsureBboxColumns = jest.mocked(ensureEvidenceBboxColumns);
const mockedUpsertStudy = jest.mocked(upsertStudyDataRows);
const mockedUpsertResults = jest.mocked(upsertResultsDataRows);
const mockedAppendRun = jest.mocked(appendExtractionRun);
const mockedEnsureRunFieldIdsColumn = jest.mocked(ensureRunFieldIdsColumn);

const GOOGLE: GoogleApiDeps = {
  fetch: jest.fn(),
  getAccessToken: jest.fn().mockResolvedValue('token'),
};

function makeDocument(overrides: Partial<DocumentRecord> = {}): DocumentRecord {
  return {
    documentId: 'doc-1',
    studyId: 'study-1',
    documentRole: 'article',
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
  return { providerId: 'gemini', model: 'gemini-2.5-flash', supportsImageInput: true, chat };
}

function makeDeps(chat: jest.Mock) {
  let uuidCount = 0;
  return {
    google: GOOGLE,
    apiKey: 'KEY',
    loadDocumentPages: jest.fn().mockResolvedValue(PAGES),
    loadDocumentPageImages: jest.fn().mockResolvedValue([]),
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
    fieldIds: null,
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
      studyIds: ['study-1'],
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
      fieldIds: null, // フェーズ 1: UI 未結線のため常に全項目（issue #80）
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
    // Evidence タブのヘッダ拡張（bbox 5 列。既存プロジェクトの後方互換移行）は
    // running 行の追記よりも先に行う（§7.4 PR3。怠ると旧ヘッダのまま列がずれた行を書いてしまう）
    expect(mockedEnsureBboxColumns).toHaveBeenCalledWith('sid', GOOGLE);
    expect(mockedEnsureBboxColumns.mock.invocationCallOrder[0]).toBeLessThan(
      mockedAppendRun.mock.invocationCallOrder[0] as number,
    );
    // ExtractionRuns タブのヘッダ拡張（field_ids 列。issue #80）も running 行より先に行う
    expect(mockedEnsureRunFieldIdsColumn).toHaveBeenCalledWith('sid', GOOGLE);
    expect(mockedEnsureRunFieldIdsColumn.mock.invocationCallOrder[0]).toBeLessThan(
      mockedAppendRun.mock.invocationCallOrder[0] as number,
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
          studyId: 'study-1',
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

  test('fieldIds（run 単位のフィールド選択）を running 行・完了行の両方に記録する（issue #80）', async () => {
    const chat = jest.fn().mockResolvedValue(AI_RESPONSE);
    const deps = makeDeps(chat);
    const outcome = await runExtraction(
      { ...baseParams(), fieldIds: ['f-study', 'f-other'] },
      deps,
    );
    expect(outcome.run.fieldIds).toEqual(['f-study', 'f-other']);
    expect(mockedAppendRun).toHaveBeenNthCalledWith(
      1,
      'sid',
      expect.objectContaining({ status: 'running', fieldIds: ['f-study', 'f-other'] }),
      GOOGLE,
    );
    expect(mockedAppendRun).toHaveBeenNthCalledWith(
      2,
      'sid',
      expect.objectContaining({ status: 'done', fieldIds: ['f-study', 'f-other'] }),
      GOOGLE,
    );
    // runExtraction 自体は params.fieldIds で params.fields を絞り込まない
    // （絞り込み済みの fields を渡す設計は呼び出し側の責務）
    expect(chat).toHaveBeenCalledTimes(1);
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
    expect(JSON.parse(promptCall?.content ?? '{}').promptVersion).toBe(5); // EXTRACT_DATA_PROMPT_VERSION
    expect(mockedUpload.mock.calls[1]?.[0].name).toMatch(/\.response\.json$/);

    expect(mockedAppendLog).toHaveBeenCalledTimes(1);
    const [logSheetId, entry] = mockedAppendLog.mock.calls[0] ?? [];
    expect(logSheetId).toBe('sid');
    expect(entry).toMatchObject({
      provider: 'gemini',
      model: 'gemini-2.5-flash',
      purpose: 'extract_study',
      tokensIn: 1000,
      tokensOut: 200,
      error: null,
    });
  });

  test('全文献がテキスト層なしでも「対象外」にはせず、pdf_native（画像入力）として実行する', async () => {
    const chat = jest.fn().mockResolvedValue(AI_RESPONSE);
    const deps = makeDeps(chat);
    const loadImages = jest.fn().mockResolvedValue([
      { page: 1, mimeType: 'image/png', dataBase64: 'QUJD' },
    ]);
    const outcome = await runExtraction(
      {
        ...baseParams(),
        documents: [makeDocument({ textStatus: 'no_text_layer', textRef: null, pageCount: 2 })],
      },
      { ...deps, loadDocumentPageImages: loadImages },
    );
    expect(outcome.run.inputMode).toBe('pdf_native');
    expect(loadImages).toHaveBeenCalledWith('doc-1');
    // 画像入力の文書にはテキスト層が無いためアンカリングできず null のまま保存する
    expect(outcome.result.evidence[0]?.anchorStatus).toBeNull();
    expect(mockedAppendRun).toHaveBeenCalledTimes(2);
  });

  test('省略可能な依存（buildProvider / newUuid / now）は既定実装で動く', async () => {
    // loadDocumentPages を失敗させると LLM 呼び出しなしで partial_failure になり、
    // 既定 buildProvider（createProvider = 実 GeminiProvider 生成）でもネットワークに触れない
    const outcome = await runExtraction(baseParams(), {
      google: GOOGLE,
      apiKey: 'KEY',
      loadDocumentPages: jest.fn().mockRejectedValue(new Error('drive down')),
      loadDocumentPageImages: jest.fn().mockResolvedValue([]),
    });
    expect(outcome.run.status).toBe('partial_failure');
    expect(outcome.result.batchFailures).toEqual([
      { studyId: 'study-1', section: null, reason: 'load_failed', detail: 'drive down' },
    ]);
    expect(outcome.run.provider).toBe('gemini');
    expect(outcome.run.runId).toMatch(/^[0-9a-f]{8}-/); // 既定 UUID 発番
    expect(outcome.run.tokensIn).toBeNull();
    expect(mockedAppendRun).toHaveBeenCalledTimes(2); // running 行 + 完了行
  });

  test('resolveRateLimitPolicy 注入時: バッチ間を RPM 間隔でスロットルする（429 対策 A）', async () => {
    const chat = jest.fn().mockResolvedValue(AI_RESPONSE);
    const deps = makeDeps(chat);
    // 2 study = 2 バッチ。RPM=30 → 2000ms 間隔。仮想クロックで実待ちを回避
    const waits: number[] = [];
    const clock = { now: 0 };
    const outcome = await runExtraction(
      {
        ...baseParams(),
        documents: [
          makeDocument({ documentId: 'doc-1', studyId: 'study-1' }),
          makeDocument({ documentId: 'doc-2', studyId: 'study-2', filename: 'jones2021.pdf' }),
        ],
      },
      {
        ...deps,
        resolveRateLimitPolicy: async () => ({
          requestsPerMinute: 30,
          maxAttempts: 3,
          baseDelayMs: 1_000,
          maxDelayMs: 60_000,
          maxConcurrency: 1,
          flushEveryNStudies: 5,
        }),
        rateLimitClock: {
          now: () => clock.now,
          sleep: (ms) => {
            waits.push(ms);
            clock.now += ms;
            return Promise.resolve();
          },
        },
      },
    );
    expect(chat).toHaveBeenCalledTimes(2);
    // 初回は待たず 2 バッチ目で 1 間隔（2000ms）だけスロットルする
    expect(waits).toEqual([2_000]);
    expect(outcome.run.status).toBe('done');
  });

  test('flushEveryNStudies 省略 + resolveRateLimitPolicy 未注入時: UNLIMITED ポリシー値が executeRun へ注入され、2 study なら 1 回にまとまって appendEvidenceRows が呼ばれる（429 対策）', async () => {
    const chat = jest.fn().mockResolvedValue(AI_RESPONSE);
    const deps = makeDeps(chat);
    const outcome = await runExtraction(
      {
        ...baseParams(),
        documents: [
          makeDocument({ documentId: 'doc-1', studyId: 'study-1' }),
          makeDocument({ documentId: 'doc-2', studyId: 'study-2', filename: 'jones2021.pdf' }),
        ],
      },
      deps, // flushEveryNStudies は指定しない
    );
    expect(outcome.result.status).toBe('done');
    expect(mockedAppendEvidence).toHaveBeenCalledTimes(1);
    const [, rows] = mockedAppendEvidence.mock.calls[0] as unknown as [string, unknown[]];
    expect(rows).toHaveLength(2);
  });

  test('flushEveryNStudies 注入: 指定した study 数ごとに appendEvidenceRows を分割して呼ぶ（429 対策）', async () => {
    const chat = jest.fn().mockResolvedValue(AI_RESPONSE);
    const deps = makeDeps(chat);
    const outcome = await runExtraction(
      {
        ...baseParams(),
        documents: [
          makeDocument({ documentId: 'doc-1', studyId: 'study-1' }),
          makeDocument({ documentId: 'doc-2', studyId: 'study-2', filename: 'jones2021.pdf' }),
        ],
      },
      { ...deps, flushEveryNStudies: 1 },
    );
    expect(outcome.result.status).toBe('done');
    // flushEveryNStudies=1 なら study ごとに appendEvidenceRows が呼ばれる（従来相当の挙動）
    expect(mockedAppendEvidence).toHaveBeenCalledTimes(2);
  });

  test('flushEveryNStudies は tier 連動ポリシーの値を deps 明示指定より優先度低く使う（429 対策・tier 連動）', async () => {
    const chat = jest.fn().mockResolvedValue(AI_RESPONSE);
    const deps = makeDeps(chat);
    // 2 study だが resolveRateLimitPolicy が flushEveryNStudies=1 の tier を返す
    // → deps.flushEveryNStudies 未指定でも policy の値（1）が使われ、study ごとに分割される
    const outcome = await runExtraction(
      {
        ...baseParams(),
        documents: [
          makeDocument({ documentId: 'doc-1', studyId: 'study-1' }),
          makeDocument({ documentId: 'doc-2', studyId: 'study-2', filename: 'jones2021.pdf' }),
        ],
      },
      {
        ...deps,
        resolveRateLimitPolicy: async () => ({
          requestsPerMinute: null,
          maxAttempts: 3,
          baseDelayMs: 1_000,
          maxDelayMs: 15_000,
          maxConcurrency: 1,
          flushEveryNStudies: 1,
        }),
      },
    );
    expect(outcome.result.status).toBe('done');
    expect(mockedAppendEvidence).toHaveBeenCalledTimes(2);
  });

  test('flushEveryNStudies: deps 明示指定は policy の値より優先する（429 対策）', async () => {
    const chat = jest.fn().mockResolvedValue(AI_RESPONSE);
    const deps = makeDeps(chat);
    // policy は flushEveryNStudies=1（study ごとに分割）だが、deps.flushEveryNStudies=2 を
    // 明示注入しているので 2 study が 1 回にまとまる
    const outcome = await runExtraction(
      {
        ...baseParams(),
        documents: [
          makeDocument({ documentId: 'doc-1', studyId: 'study-1' }),
          makeDocument({ documentId: 'doc-2', studyId: 'study-2', filename: 'jones2021.pdf' }),
        ],
      },
      {
        ...deps,
        flushEveryNStudies: 2,
        resolveRateLimitPolicy: async () => ({
          requestsPerMinute: null,
          maxAttempts: 3,
          baseDelayMs: 1_000,
          maxDelayMs: 15_000,
          maxConcurrency: 1,
          flushEveryNStudies: 1,
        }),
      },
    );
    expect(outcome.result.status).toBe('done');
    expect(mockedAppendEvidence).toHaveBeenCalledTimes(1);
  });

  test('flushEveryNStudies: deps・policy のどちらにも値が無ければ DEFAULT_FLUSH_EVERY_N_STUDIES（5）へフォールバックする', async () => {
    const chat = jest.fn().mockResolvedValue(AI_RESPONSE);
    const deps = makeDeps(chat);
    const documents = Array.from({ length: 6 }, (_, i) =>
      makeDocument({
        documentId: `doc-${i + 1}`,
        studyId: `study-${i + 1}`,
        filename: `s${i + 1}.pdf`,
      }),
    );
    // resolveRateLimitPolicy が（本来ありえないが）flushEveryNStudies を欠いたポリシーを返す
    // ケースを型キャストで意図的に再現し、DEFAULT_FLUSH_EVERY_N_STUDIES への 2 段目フォールバックを検証する
    const policyWithoutFlush = {
      requestsPerMinute: null,
      maxAttempts: 3,
      baseDelayMs: 1_000,
      maxDelayMs: 15_000,
      maxConcurrency: 1,
    } as unknown as RateLimitPolicy;
    const outcome = await runExtraction(
      { ...baseParams(), documents },
      { ...deps, resolveRateLimitPolicy: async () => policyWithoutFlush },
    );
    expect(outcome.result.status).toBe('done');
    // DEFAULT_FLUSH_EVERY_N_STUDIES=5 なら 6 study は [5, 1] に分割される
    expect(mockedAppendEvidence).toHaveBeenCalledTimes(2);
    const rowCounts = mockedAppendEvidence.mock.calls.map(
      ([, rows]) => (rows as unknown[]).length,
    );
    expect(rowCounts).toEqual([5, 1]);
  });
});
