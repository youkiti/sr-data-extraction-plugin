import { runPilotRevision } from '../../../../src/app/services/pilotRevisionService';
import { loadSchema, type SchemaServiceDeps } from '../../../../src/app/services/schemaService';
import { createInitialState, createStore, type Store } from '../../../../src/app/store';
import type { SchemaField } from '../../../../src/domain/schemaField';
import type { ExtractionRun } from '../../../../src/domain/extractionRun';
import type { Decision } from '../../../../src/domain/decision';
import { readAllDecisions } from '../../../../src/features/verification/decisionRepository';
import { ensureChildFolder, uploadTextFile } from '../../../../src/lib/google/drive';
import { getCurrentUserEmail } from '../../../../src/lib/google/identity';
import { appendLlmApiLog } from '../../../../src/lib/llm/apiLogRepository';
import type { ChatResponse, LLMProvider } from '../../../../src/lib/llm/LLMProvider';
import { UNLIMITED_POLICY } from '../../../../src/lib/llm/rateLimitPolicy';

jest.mock('pdfjs-dist', () => ({ GlobalWorkerOptions: { workerSrc: '' }, getDocument: jest.fn() }));
jest.mock('../../../../src/app/services/schemaService', () => ({ loadSchema: jest.fn() }));
jest.mock('../../../../src/features/verification/decisionRepository', () => ({
  readAllDecisions: jest.fn(),
}));
jest.mock('../../../../src/lib/google/drive', () => ({
  ensureChildFolder: jest.fn(),
  uploadTextFile: jest.fn(),
}));
jest.mock('../../../../src/lib/google/identity', () => ({ getCurrentUserEmail: jest.fn() }));
jest.mock('../../../../src/lib/llm/apiLogRepository', () => ({ appendLlmApiLog: jest.fn() }));

function makeField(overrides: Partial<SchemaField> = {}): SchemaField {
  return {
    schemaVersion: 1,
    fieldId: 'f-1',
    fieldIndex: 1,
    section: 'methods',
    fieldName: 'study_design',
    fieldLabel: '研究デザイン',
    entityLevel: 'study',
    dataType: 'text',
    unit: null,
    allowedValues: null,
    required: true,
    extractionInstruction: 'Report the design.',
    example: null,
    aiGenerated: true,
    note: null,
    ...overrides,
  };
}

function run(overrides: Partial<ExtractionRun> = {}): ExtractionRun {
  return {
    runId: 'r',
    runType: 'pilot',
    schemaVersion: 1,
    studyIds: ['s1'],
    provider: 'gemini',
    requestedModel: 'model',
    modelVersion: null,
    inputMode: 'text_only',
    status: 'done',
    startedAt: '01',
    finishedAt: null,
    tokensIn: null,
    tokensOut: null,
    costEstimate: null,
    fieldIds: null,
    warnings: null,
    ...overrides,
  };
}
const revision = {
  field_name: 'study_design',
  extraction_instruction: '改訂指示',
  example: null,
  rationale: '理由',
};
const judgment: Decision = {
  studyId: 's1',
  fieldId: 'f-1',
  entityKey: '-',
  action: 'edit',
  value: '修正',
  note: '判定メモ',
  annotator: 'me',
  decidedBy: 'me',
  schemaVersion: 1,
  annotatorType: 'human_with_ai',
  decidedAt: '01',
};
function makeStore(): Store {
  const state = createInitialState();
  state.currentProject = {
    projectId: 'p',
    spreadsheetId: 'sheet',
    driveFolderId: 'folder',
    name: 'テスト',
  };
  state.schema.currentFields = [makeField(), makeField({ fieldName: 'other', fieldId: 'f2' })];
  state.pilot = {
    ...state.pilot,
    run: run(),
    runFields: [makeField()],
    evidence: [],
    model: 'gemini-test',
  };
  return createStore(state);
}
function makeDeps(overrides: Partial<SchemaServiceDeps> = {}) {
  const chat = jest.fn<Promise<ChatResponse>, Parameters<LLMProvider['chat']>>().mockResolvedValue({
    text: JSON.stringify({ revisions: [revision] }),
    tokensIn: 10,
    tokensOut: 20,
    cachedTokensIn: null,
    raw: {},
  });
  const deps: SchemaServiceDeps = {
    google: { fetch: jest.fn(), getAccessToken: async () => 'fake' },
    profile: { getProfileUserInfo: async () => ({ email: 'me', id: 'id' }) },
    loadApiKey: async () => 'fake',
    buildProvider: (config) => ({
      providerId: 'gemini',
      model: config.model,
      supportsImageInput: true,
      chat,
    }),
    now: () => 'now',
    newUuid: () => 'id',
    ...overrides,
  };
  return { deps, chat };
}
beforeEach(() => {
  jest.clearAllMocks();
  (readAllDecisions as jest.Mock).mockResolvedValue([
    judgment,
    { ...judgment, studyId: 'outside' },
  ]);
  (getCurrentUserEmail as jest.Mock).mockResolvedValue('me');
  (ensureChildFolder as jest.Mock).mockResolvedValue({ id: 'logs' });
  (uploadTextFile as jest.Mock).mockResolvedValue({ webViewLink: 'fake-link' });
});

test('現行版への部分提案と出所を保持し、プロンプト版付きの監査ログを残す', async () => {
  const store = makeStore();
  const { deps, chat } = makeDeps();
  expect(await runPilotRevision(store, deps)).toBe(true);
  expect(chat).toHaveBeenCalledWith(
    [
      expect.objectContaining({
        role: 'system',
        content: expect.stringContaining('Do NOT embed pilot-specific values'),
      }),
      expect.objectContaining({ role: 'user', content: expect.stringContaining('判定メモ') }),
    ],
    expect.objectContaining({ responseFormat: 'json' }),
  );
  expect(store.getState().schema.redraft?.diff.removed).toEqual([]);
  expect(store.getState().schema.redraft?.diff.added).toEqual([]);
  expect(store.getState().schema.redraft?.diff.changed).toHaveLength(1);
  expect(store.getState().schema.redraft?.diff.unchanged).toHaveLength(1);
  expect(store.getState().schema.pilotRevision).toEqual({
    runId: 'r',
    runStartedAt: '01',
    decisionCount: 1,
    rationales: { study_design: '理由' },
  });
  expect(store.getState().pilot.decisions).toEqual([judgment]);
  expect(appendLlmApiLog).toHaveBeenCalledWith(
    'sheet',
    expect.objectContaining({ purpose: 'revise_schema_pilot' }),
    deps.google,
  );
  expect(uploadTextFile).toHaveBeenCalledWith(
    expect.objectContaining({ content: expect.stringContaining('"promptVersion": 1') }),
    deps.google,
  );
  expect(store.getState().pilot.revising).toBe(false);
});

test('未読込の現行版を既存ローダーで取得し、指定のレート制限を使う', async () => {
  const store = makeStore();
  store.setState({ schema: { ...store.getState().schema, currentFields: null } });
  (loadSchema as jest.Mock).mockImplementation(async (target: Store) =>
    target.setState({
      schema: {
        ...target.getState().schema,
        currentFields: [makeField({ extractionInstruction: '現行版の指示' })],
      },
    }),
  );
  const policy = jest.fn(async () => UNLIMITED_POLICY);
  const { deps, chat } = makeDeps({ resolveRateLimitPolicy: policy });
  expect(await runPilotRevision(store, deps)).toBe(true);
  expect(loadSchema).toHaveBeenCalledWith(store, deps, { force: true });
  expect(policy).toHaveBeenCalled();
  expect(chat.mock.calls[0]?.[0][1]?.content).toContain('現行版の指示');
});

test('未選択・実行中・必要な run データ未読込なら呼び出さない', async () => {
  const { deps, chat } = makeDeps();
  for (const patch of [
    { revising: true },
    { running: true },
    { run: null },
    { runFields: null },
    { evidence: null },
  ]) {
    const store = makeStore();
    store.setState({ pilot: { ...store.getState().pilot, ...patch } });
    expect(await runPilotRevision(store, deps)).toBe(false);
  }
  const store = makeStore();
  store.setState({ currentProject: null });
  expect(await runPilotRevision(store, deps)).toBe(false);
  expect(chat).not.toHaveBeenCalled();
});

test('モデルなし・キーなし・利用可能な判定なしをインラインエラーにする', async () => {
  const store = makeStore();
  store.setState({ pilot: { ...store.getState().pilot, model: '' } });
  expect(await runPilotRevision(store, makeDeps().deps)).toBe(false);
  expect(store.getState().pilot.reviseError).toContain('モデル');
  const noKey = makeStore();
  expect(await runPilotRevision(noKey, makeDeps({ loadApiKey: async () => null }).deps)).toBe(
    false,
  );
  expect(noKey.getState().pilot.reviseError).toContain('API キー');
  (getCurrentUserEmail as jest.Mock).mockResolvedValue(null);
  const noJudgments = makeStore();
  expect(await runPilotRevision(noJudgments, makeDeps().deps)).toBe(false);
  expect(noJudgments.getState().pilot.reviseError).toContain('改訂に使える判定');
});

test.each([null, '読込失敗'])('スキーマを取得できなければ理由を出す: %s', async (loadError) => {
  const store = makeStore();
  store.setState({ schema: { ...store.getState().schema, currentFields: null, loadError } });
  (loadSchema as jest.Mock).mockResolvedValue(undefined);
  expect(await runPilotRevision(store, makeDeps().deps)).toBe(false);
  expect(store.getState().pilot.reviseError).toBe(
    loadError ??
      '確定済みの表のデザインを読み込めていません。表のデザイン画面で確定・再読込してください',
  );
});

test('提案なしは差分へ遷移せず、文字列の失敗も表示する', async () => {
  const store = makeStore();
  const { deps, chat } = makeDeps();
  chat.mockResolvedValueOnce({
    text: '{"revisions":[]}',
    tokensIn: null,
    tokensOut: null,
    cachedTokensIn: null,
    raw: {},
  });
  expect(await runPilotRevision(store, deps)).toBe(false);
  expect(store.getState().schema.redraft).toBeNull();
  expect(store.getState().pilot.reviseError).toBe('改訂が必要な項目は提案されませんでした');
  (readAllDecisions as jest.Mock).mockRejectedValueOnce('文字列の失敗');
  expect(await runPilotRevision(store, deps)).toBe(false);
  expect(store.getState().pilot.reviseError).toBe('文字列の失敗');
});

test('経過時間を更新し、成功・失敗後はタイマーを止める', async () => {
  jest.useFakeTimers();
  const store = makeStore();
  const { deps, chat } = makeDeps();
  let complete!: (response: ChatResponse) => void;
  chat.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        complete = resolve;
      }),
  );
  const pending = runPilotRevision(store, deps);
  for (let i = 0; i < 30; i++) await Promise.resolve();
  jest.advanceTimersByTime(2000);
  expect(store.getState().pilot.reviseElapsedSeconds).toBe(2);
  complete({
    text: JSON.stringify({ revisions: [revision] }),
    tokensIn: null,
    tokensOut: null,
    cachedTokensIn: null,
    raw: {},
  });
  await pending;
  expect(jest.getTimerCount()).toBe(0);
  jest.useRealTimers();
});
