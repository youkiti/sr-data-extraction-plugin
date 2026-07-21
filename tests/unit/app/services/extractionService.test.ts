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
  ensureRunOptionalColumns,
} from '../../../../src/features/extraction/runRepository';
import type { ExtractDataPage } from '../../../../src/features/extraction/skills/extractData';
import { readAllArmStructures } from '../../../../src/features/verification/armStructureRepository';
import { uploadTextFile } from '../../../../src/lib/google/drive';
import type { GoogleApiDeps } from '../../../../src/lib/google/types';
import { appendLlmApiLog } from '../../../../src/lib/llm/apiLogRepository';
import type { ChatResponse, LLMProvider } from '../../../../src/lib/llm/LLMProvider';
import type { RateLimitPolicy } from '../../../../src/lib/llm/rateLimitPolicy';

jest.mock('../../../../src/features/extraction/annotationRepository');
jest.mock('../../../../src/features/extraction/evidenceRepository');
jest.mock('../../../../src/features/extraction/runRepository');
jest.mock('../../../../src/features/verification/armStructureRepository');
jest.mock('../../../../src/lib/google/drive');
jest.mock('../../../../src/lib/llm/apiLogRepository');

const mockedUpload = jest.mocked(uploadTextFile);
const mockedAppendLog = jest.mocked(appendLlmApiLog);
const mockedAppendEvidence = jest.mocked(appendEvidenceRows);
const mockedEnsureBboxColumns = jest.mocked(ensureEvidenceBboxColumns);
const mockedUpsertStudy = jest.mocked(upsertStudyDataRows);
const mockedUpsertResults = jest.mocked(upsertResultsDataRows);
const mockedAppendRun = jest.mocked(appendExtractionRun);
const mockedEnsureRunOptionalColumns = jest.mocked(ensureRunOptionalColumns);
const mockedReadArmRows = jest.mocked(readAllArmStructures);

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
  // 既定: ArmStructures は未確定（arm completeness チェックは応答内の自己整合のみ。issue #106）
  mockedReadArmRows.mockResolvedValue([]);
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
      warnings: null, // arm completeness 警告なし（issue #106）
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
    // ExtractionRuns タブのヘッダ拡張（field_ids / warnings 列。issue #80 / #106）も running 行より先に行う
    expect(mockedEnsureRunOptionalColumns).toHaveBeenCalledWith('sid', GOOGLE);
    expect(mockedEnsureRunOptionalColumns.mock.invocationCallOrder[0]).toBeLessThan(
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
    expect(JSON.parse(promptCall?.content ?? '{}').promptVersion).toBe(8); // EXTRACT_DATA_PROMPT_VERSION
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

  test('高精度読み取りモード（issue #176）: highAccuracyImages: true はテキスト層のある文献にもページ画像を併用添付し、input_mode = text_with_page_images を記録する', async () => {
    const chat = jest.fn().mockResolvedValue(AI_RESPONSE);
    const deps = makeDeps(chat);
    const loadImages = jest.fn().mockResolvedValue([
      { page: 1, mimeType: 'image/png', dataBase64: 'QUJD' },
    ]);
    const outcome = await runExtraction(
      { ...baseParams(), highAccuracyImages: true },
      { ...deps, loadDocumentPageImages: loadImages },
    );
    expect(outcome.run.inputMode).toBe('text_with_page_images');
    expect(loadImages).toHaveBeenCalledWith('doc-1');
    expect(deps.loadDocumentPages).toHaveBeenCalledWith('doc-1');
    // テキスト層があるためアンカリングは通常どおり成立する（画像は読み取り補助のみ）
    expect(outcome.result.evidence[0]?.anchorStatus).toBe('exact');
    expect(mockedAppendRun).toHaveBeenCalledTimes(2);
  });

  test('高精度読み取りモード省略時（highAccuracyImages 未指定）は既定の text_only のまま変わらない', async () => {
    const chat = jest.fn().mockResolvedValue(AI_RESPONSE);
    const deps = makeDeps(chat);
    const outcome = await runExtraction(baseParams(), deps);
    expect(outcome.run.inputMode).toBe('text_only');
    expect(deps.loadDocumentPageImages).not.toHaveBeenCalled();
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

  test('arm completeness 警告（issue #106）: ArmStructures 確定 arm との突合で欠落を検出し、完了行の warnings と LLMApiLog へ記録する（status は done のまま）', async () => {
    // ArmStructures は study-1 に arm:1 / arm:2 の 2 群を確定済み
    mockedReadArmRows.mockResolvedValue([
      {
        studyId: 'study-1',
        version: 1,
        armKey: 'arm:1',
        armName: '介入群',
        annotator: 'me@example.com',
        annotatorType: 'human_with_ai',
        confirmedAt: 't0',
        note: null,
      },
      {
        studyId: 'study-1',
        version: 1,
        armKey: 'arm:2',
        armName: '対照群',
        annotator: 'me@example.com',
        annotatorType: 'human_with_ai',
        confirmedAt: 't0',
        note: null,
      },
    ]);
    // 応答は arm:1 の arm レベル項目のみ返す（arm:2 が丸ごと欠落）
    const chat = jest.fn().mockResolvedValue({
      text: JSON.stringify([
        {
          field_id: 'f-arm',
          entity_key: 'arm:1',
          value: '60',
          not_reported: false,
          quote: '60 patients',
          page: 1,
          confidence: 'high',
        },
      ]),
      tokensIn: 10,
      tokensOut: 5,
      raw: {},
    } satisfies ChatResponse);
    const deps = makeDeps(chat);
    const outcome = await runExtraction(
      {
        ...baseParams(),
        fields: [makeField({ fieldId: 'f-arm', fieldName: 'sample_size', entityLevel: 'arm' })],
      },
      deps,
    );

    const expectedWarning = {
      kind: 'arm_completeness',
      studyId: 'study-1',
      section: null,
      expectedArmKeys: ['arm:1', 'arm:2'],
      missingItems: [{ armKey: 'arm:2', fieldId: 'f-arm' }],
    };
    // warning のみで status には影響しない（issue #106 の設計判断）
    expect(outcome.run.status).toBe('done');
    expect(outcome.result.armWarnings).toEqual([expectedWarning]);
    expect(outcome.run.warnings).toEqual([expectedWarning]);
    // 完了行（2 回目の追記）に warnings が載る。running 行（1 回目）は null のまま
    expect(mockedAppendRun).toHaveBeenNthCalledWith(
      1,
      'sid',
      expect.objectContaining({ status: 'running', warnings: null }),
      GOOGLE,
    );
    expect(mockedAppendRun).toHaveBeenNthCalledWith(
      2,
      'sid',
      expect.objectContaining({ status: 'done', warnings: [expectedWarning] }),
      GOOGLE,
    );
    // LLMApiLog には chat の 1 行 + 警告の 1 行が追記される
    expect(mockedAppendLog).toHaveBeenCalledTimes(2);
    const warningEntry = mockedAppendLog.mock.calls
      .map(([, entry]) => entry)
      .find((entry) => entry.error !== null);
    expect(warningEntry).toMatchObject({
      purpose: 'extract_study',
      promptRef: '',
      responseRef: '',
      promptSummary: `[arm_completeness] run ${outcome.run.runId}`,
    });
    expect(warningEntry?.error).toContain('警告（arm_completeness）');
    expect(warningEntry?.error).toContain('arm:2 × sample_size');
  });

  test('arm completeness 警告: ArmStructures の読み出し失敗は握りつぶし、応答内の自己整合のみでチェックして run を続行する（issue #106）', async () => {
    mockedReadArmRows.mockRejectedValue(new Error('sheets down'));
    // 応答内で arm:2 が outcome に現れるのに arm レベル項目が arm:1 しか無い → 自己整合だけで検出できる
    const chat = jest.fn().mockResolvedValue({
      text: JSON.stringify([
        {
          field_id: 'f-arm',
          entity_key: 'arm:1',
          value: '60',
          not_reported: false,
          quote: '60 patients',
          page: 1,
          confidence: 'high',
        },
        {
          field_id: 'f-events',
          entity_key: 'outcome:mortality|arm:2',
          value: '3',
          not_reported: false,
          quote: '3 deaths',
          page: 1,
          confidence: 'high',
        },
      ]),
      tokensIn: 10,
      tokensOut: 5,
      raw: {},
    } satisfies ChatResponse);
    const deps = makeDeps(chat);
    const outcome = await runExtraction(
      {
        ...baseParams(),
        fields: [
          makeField({ fieldId: 'f-arm', fieldName: 'sample_size', entityLevel: 'arm' }),
          makeField({ fieldId: 'f-events', fieldName: 'events', entityLevel: 'outcome_result' }),
        ],
      },
      deps,
    );
    expect(outcome.run.status).toBe('done');
    expect(outcome.result.armWarnings).toEqual([
      expect.objectContaining({
        studyId: 'study-1',
        expectedArmKeys: ['arm:1', 'arm:2'],
        missingItems: [{ armKey: 'arm:2', fieldId: 'f-arm' }],
      }),
    ]);
  });

  /** arm:2 が欠落した応答で warning 付きの完了行を作る共通セットアップ（フォールバック検証用） */
  function armWarningRunSetup() {
    mockedReadArmRows.mockResolvedValue([
      {
        studyId: 'study-1',
        version: 1,
        armKey: 'arm:1',
        armName: '介入群',
        annotator: 'me@example.com',
        annotatorType: 'human_with_ai',
        confirmedAt: 't0',
        note: null,
      },
      {
        studyId: 'study-1',
        version: 1,
        armKey: 'arm:2',
        armName: '対照群',
        annotator: 'me@example.com',
        annotatorType: 'human_with_ai',
        confirmedAt: 't0',
        note: null,
      },
    ]);
    const chat = jest.fn().mockResolvedValue({
      text: JSON.stringify([
        {
          field_id: 'f-arm',
          entity_key: 'arm:1',
          value: '60',
          not_reported: false,
          quote: '60 patients',
          page: 1,
          confidence: 'high',
        },
      ]),
      tokensIn: 10,
      tokensOut: 5,
      raw: {},
    } satisfies ChatResponse);
    return {
      params: {
        ...baseParams(),
        fields: [makeField({ fieldId: 'f-arm', fieldName: 'sample_size', entityLevel: 'arm' })],
      },
      deps: makeDeps(chat),
    };
  }

  test('warnings 付き完了行の追記に失敗したら warnings なしで 1 回だけ再試行する（完了行の成立を優先。issue #106 レビュー対応）', async () => {
    const { params, deps } = armWarningRunSetup();
    // 完了行（status=done）かつ warnings 付きの追記だけを 1 回失敗させる
    mockedAppendRun.mockImplementation(async (_sid, run) => {
      if (run.status === 'done' && run.warnings !== null) {
        throw new Error('セルサイズ超過（400）');
      }
    });
    const outcome = await runExtraction(params, deps);
    // running 行 → warnings 付き完了行（失敗）→ warnings なし完了行（成功）の 3 回
    expect(mockedAppendRun).toHaveBeenCalledTimes(3);
    expect(mockedAppendRun).toHaveBeenNthCalledWith(
      3,
      'sid',
      expect.objectContaining({ status: 'done', warnings: null }),
      GOOGLE,
    );
    // run は「中断」に転落しない。戻り値の run はシートに書けた内容（warnings なし）を反映し、
    // S7 表示用の result.armWarnings は保持される
    expect(outcome.run.status).toBe('done');
    expect(outcome.run.warnings).toBeNull();
    expect(outcome.result.armWarnings).toHaveLength(1);
  });

  test('warnings なし（null）の完了行の追記失敗はフォールバックせずそのまま失敗させる', async () => {
    const chat = jest.fn().mockResolvedValue(AI_RESPONSE); // 警告なしの通常応答
    const deps = makeDeps(chat);
    mockedAppendRun.mockImplementation(async (_sid, run) => {
      if (run.status === 'done') {
        throw new Error('ネットワーク断');
      }
    });
    await expect(runExtraction(baseParams(), deps)).rejects.toThrow('ネットワーク断');
    expect(mockedAppendRun).toHaveBeenCalledTimes(2); // running 行 + 失敗した完了行のみ
  });
});
