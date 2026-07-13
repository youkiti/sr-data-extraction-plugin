import {
  addEditorRow,
  cancelEditor,
  cancelRobPrespecDialog,
  confirmRobPrespecDialog,
  confirmSchema,
  emptyEditorRow,
  insertSchemaPreset,
  loadSchema,
  removeEditorRow,
  runDraftSchema,
  setDraftModel,
  skipRobPrespecDialog,
  startEditorFromCurrent,
  toggleSampleDocument,
  updateEditorRow,
  updateRobPrespecDialog,
  type SchemaServiceDeps,
} from '../../../../src/app/services/schemaService';
import { serializeRob2PrespecNote } from '../../../../src/features/schema/presets/robPrespec';
import { ROB_TEMPLATE_ROB2 } from '../../../../src/features/schema/presets/robTemplates';
import { createInitialState, createStore, type Store } from '../../../../src/app/store';
import type { DocumentRecord } from '../../../../src/domain/document';
import type { Protocol } from '../../../../src/domain/protocol';
import type { SchemaField } from '../../../../src/domain/schemaField';
import type { SchemaVersion } from '../../../../src/domain/schemaVersion';
import { readDocuments } from '../../../../src/features/documents/documentRepository';
import { listProtocols } from '../../../../src/features/protocol/protocolRepository';
import {
  getSchemaFieldsByVersion,
  listSchemaVersions,
} from '../../../../src/features/schema/schemaRepository';
import { saveSchemaVersion } from '../../../../src/features/schema/saveSchemaVersion';
import type { SchemaEditorRow } from '../../../../src/features/schema/types';
import { ensureChildFolder, getFileText, uploadTextFile } from '../../../../src/lib/google/drive';
import { appendLlmApiLog } from '../../../../src/lib/llm/apiLogRepository';
import type { ChatResponse, LLMProvider } from '../../../../src/lib/llm/LLMProvider';
import { installChromeMock } from '../../../setup/chrome-mock';

jest.mock('../../../../src/features/schema/schemaRepository', () => ({
  getSchemaFieldsByVersion: jest.fn(),
  listSchemaVersions: jest.fn(),
}));
jest.mock('../../../../src/features/schema/saveSchemaVersion', () => ({
  saveSchemaVersion: jest.fn(),
}));
jest.mock('../../../../src/features/protocol/protocolRepository', () => ({
  listProtocols: jest.fn(),
}));
jest.mock('../../../../src/features/documents/documentRepository', () => ({
  readDocuments: jest.fn(),
}));
jest.mock('../../../../src/lib/google/drive', () => ({
  ensureChildFolder: jest.fn(),
  getFileText: jest.fn(),
  uploadTextFile: jest.fn(),
}));
jest.mock('../../../../src/lib/llm/apiLogRepository', () => ({
  appendLlmApiLog: jest.fn(),
}));

const listVersionsMock = listSchemaVersions as jest.MockedFunction<typeof listSchemaVersions>;
const getFieldsMock = getSchemaFieldsByVersion as jest.MockedFunction<
  typeof getSchemaFieldsByVersion
>;
const saveVersionMock = saveSchemaVersion as jest.MockedFunction<typeof saveSchemaVersion>;
const listProtocolsMock = listProtocols as jest.MockedFunction<typeof listProtocols>;
const readDocumentsMock = readDocuments as jest.MockedFunction<typeof readDocuments>;
const ensureChildFolderMock = ensureChildFolder as jest.MockedFunction<typeof ensureChildFolder>;
const getFileTextMock = getFileText as jest.MockedFunction<typeof getFileText>;
const uploadTextFileMock = uploadTextFile as jest.MockedFunction<typeof uploadTextFile>;
const appendLlmApiLogMock = appendLlmApiLog as jest.MockedFunction<typeof appendLlmApiLog>;

const DRAFTED_ITEM = {
  section: 'population',
  field_name: 'sample_size_total',
  field_label: '総サンプルサイズ',
  entity_level: 'study',
  data_type: 'integer',
  unit: null,
  allowed_values: null,
  required: true,
  extraction_instruction: 'Report the total number of randomised participants.',
  example: null,
};

function makeVersion(schemaVersion: number, overrides: Partial<SchemaVersion> = {}): SchemaVersion {
  return {
    schemaVersion,
    parentVersion: null,
    protocolVersion: 1,
    createdByType: 'ai_draft',
    createdAt: '2026-07-02T00:00:00Z',
    createdBy: 'tester@example.com',
    note: null,
    ...overrides,
  };
}

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

function makeEditorRow(overrides: Partial<SchemaEditorRow> = {}): SchemaEditorRow {
  return {
    fieldId: null,
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

function makeProtocol(overrides: Partial<Protocol> = {}): Protocol {
  return {
    version: 1,
    frameworkType: null,
    researchQuestion: '',
    inclusionCriteria: null,
    exclusionCriteria: null,
    studyDesign: null,
    blockCount: 0,
    combinationExpression: '',
    sourceType: 'manual',
    sourceFilename: null,
    rawTextRef: null,
    rawTextPreview: null,
    rawTextInline: 'P: 成人肺炎',
    createdAt: '2026-07-01T00:00:00Z',
    createdBy: 'tester@example.com',
    ...overrides,
  };
}

function makeDocument(overrides: Partial<DocumentRecord> = {}): DocumentRecord {
  // フェーズ 1 は 1 文書 = 1 study。文書ごとに一意な study_id を自動採番する
  const documentId = overrides.documentId ?? 'doc-1';
  return {
    documentId,
    studyId: `study-${documentId}`,
    documentRole: 'article',
    driveFileId: 'drive-1',
    sourceFileId: 'src-1',
    filename: 'smith2020.pdf',
    pmid: null,
    doi: null,
    textRef: 'https://drive.google.com/file/d/txt-1/view',
    textStatus: 'ok',
    pageCount: 2,
    charCount: 4000,
    importedAt: '2026-07-01T00:00:00Z',
    importedBy: 'tester@example.com',
    note: null,
    ...overrides,
  };
}

function makeDeps(overrides: Partial<SchemaServiceDeps> = {}): {
  deps: SchemaServiceDeps;
  chatMock: jest.Mock<Promise<ChatResponse>, Parameters<LLMProvider['chat']>>;
} {
  const chatMock = jest.fn<Promise<ChatResponse>, Parameters<LLMProvider['chat']>>(async () => ({
    text: JSON.stringify([DRAFTED_ITEM]),
    tokensIn: 100,
    tokensOut: 50,
    raw: {},
  }));
  const deps: SchemaServiceDeps = {
    google: { fetch: jest.fn() as unknown as typeof fetch, getAccessToken: async () => 't' },
    profile: { getProfileUserInfo: async () => ({ email: 'tester@example.com', id: 'uid' }) },
    loadApiKey: async () => 'api-key',
    buildProvider: (config) => ({
      providerId: 'gemini',
      model: config.model,
      supportsImageInput: true,
      chat: chatMock,
    }),
    newUuid: () => 'log-uuid',
    now: () => '2026-07-02T01:00:00Z',
    ...overrides,
  };
  return { deps, chatMock };
}

function makeStore(withProject = true): Store {
  const initial = createInitialState();
  if (withProject) {
    initial.currentProject = {
      projectId: 'p1',
      spreadsheetId: 'sheet-1',
      driveFolderId: 'folder-1',
      name: 'テスト SR',
    };
  }
  return createStore(initial);
}

/** ドラフト実行に必要な前提（プロトコル・文献・選択・モデル）をストアへ流し込む */
function seedForDraft(store: Store): void {
  store.setState({
    protocol: { ...store.getState().protocol, records: [makeProtocol()] },
    documents: { ...store.getState().documents, records: [makeDocument()] },
  });
  store.setState({
    schema: { ...store.getState().schema, selectedDocumentIds: ['doc-1'], model: 'gemini-test' },
  });
}

function toastTexts(): string[] {
  return Array.from(document.querySelectorAll('.toast')).map((node) => node.textContent ?? '');
}

beforeEach(() => {
  jest.clearAllMocks();
  document.body.innerHTML = '';
  ensureChildFolderMock.mockResolvedValue({
    id: 'folder-x',
    webViewLink: 'https://drive.google.com/drive/folders/folder-x',
  });
  getFileTextMock.mockResolvedValue('1 ページ目の本文\f2 ページ目の本文');
  uploadTextFileMock.mockResolvedValue({
    id: 'log-1',
    webViewLink: 'https://drive.google.com/file/d/log-1/view',
  });
  appendLlmApiLogMock.mockResolvedValue(undefined);
});

describe('loadSchema', () => {
  test('プロジェクト未選択・読込中は何もしない', async () => {
    await loadSchema(makeStore(false), makeDeps().deps);
    const store = makeStore();
    store.setState({ schema: { ...store.getState().schema, loading: true } });
    await loadSchema(store, makeDeps().deps);
    expect(listVersionsMock).not.toHaveBeenCalled();
  });

  test('読込済みなら no-op、force 指定時のみ再読込する', async () => {
    const store = makeStore();
    store.setState({ schema: { ...store.getState().schema, versions: [] } });
    await loadSchema(store, makeDeps().deps);
    expect(listVersionsMock).not.toHaveBeenCalled();

    listVersionsMock.mockResolvedValue([]);
    await loadSchema(store, makeDeps().deps, { force: true });
    expect(listVersionsMock).toHaveBeenCalledTimes(1);
  });

  test('版なし: versions = [] / currentFields = []（SchemaFields は読まない）', async () => {
    const store = makeStore();
    listVersionsMock.mockResolvedValue([]);
    await loadSchema(store, makeDeps().deps);
    expect(store.getState().schema.versions).toEqual([]);
    expect(store.getState().schema.currentFields).toEqual([]);
    expect(getFieldsMock).not.toHaveBeenCalled();
    expect(store.getState().counts.schemaVersions).toBe(0);
  });

  test('版あり: 最新版の項目も読み込み、進捗カウントを揃える', async () => {
    const store = makeStore();
    listVersionsMock.mockResolvedValue([makeVersion(2), makeVersion(1)]);
    getFieldsMock.mockResolvedValue([makeField({ schemaVersion: 2 })]);
    await loadSchema(store, makeDeps().deps);
    expect(getFieldsMock).toHaveBeenCalledWith('sheet-1', 2, expect.anything());
    expect(store.getState().schema.versions).toHaveLength(2);
    expect(store.getState().schema.currentFields).toHaveLength(1);
    expect(store.getState().counts.schemaVersions).toBe(2);
  });

  test('失敗: loadError に文言を残す（Error 以外は文字列化）', async () => {
    const store = makeStore();
    listVersionsMock.mockRejectedValue(new Error('403'));
    await loadSchema(store, makeDeps().deps);
    expect(store.getState().schema.loadError).toBe('403');

    listVersionsMock.mockRejectedValue('壊れた応答');
    await loadSchema(store, makeDeps().deps, { force: true });
    expect(store.getState().schema.loadError).toBe('壊れた応答');
  });
});

describe('loadSchema の既定モデル注入（S11。ui-states.md §2「既定モデル」）', () => {
  beforeEach(() => {
    listVersionsMock.mockResolvedValue([]);
  });

  test('model が空文字なら既定モデル設定で埋める', async () => {
    const store = makeStore();
    await loadSchema(store, makeDeps({ loadDefaultModel: async () => 'gemini-2.5-pro' }).deps);
    expect(store.getState().schema.model).toBe('gemini-2.5-pro');
  });

  test('既定モデル未設定（null）なら工場出荷の既定モデル（gemini-3.5-flash）で埋める', async () => {
    const store = makeStore();
    await loadSchema(store, makeDeps({ loadDefaultModel: async () => null }).deps);
    expect(store.getState().schema.model).toBe('gemini-3.5-flash');
  });

  test('ユーザーが入力済みの model は上書きしない（設定の読み出し自体を行わない）', async () => {
    const store = makeStore();
    store.setState({ schema: { ...store.getState().schema, model: 'user-typed-model' } });
    const loadDefaultModelMock = jest.fn(async () => 'gemini-2.5-pro');
    await loadSchema(store, makeDeps({ loadDefaultModel: loadDefaultModelMock }).deps);
    expect(store.getState().schema.model).toBe('user-typed-model');
    expect(loadDefaultModelMock).not.toHaveBeenCalled();
  });

  test('deps.loadDefaultModel 未指定なら settingsStore（chrome.storage.local）から読む', async () => {
    const chromeMock = installChromeMock();
    chromeMock.storage.local.data['settings.defaultModel'] = 'gemini-2.0-flash';
    const store = makeStore();
    await loadSchema(store, makeDeps().deps);
    expect(store.getState().schema.model).toBe('gemini-2.0-flash');
    installChromeMock(); // 後続テストへ設定値を持ち越さない
  });
});

describe('toggleSampleDocument / setDraftModel', () => {
  test('選択の追加・重複無視・解除', () => {
    const store = makeStore();
    toggleSampleDocument(store, 'doc-1', true);
    toggleSampleDocument(store, 'doc-1', true); // 重複は no-op
    toggleSampleDocument(store, 'doc-2', true);
    expect(store.getState().schema.selectedDocumentIds).toEqual(['doc-1', 'doc-2']);
    toggleSampleDocument(store, 'doc-1', false);
    expect(store.getState().schema.selectedDocumentIds).toEqual(['doc-2']);
  });

  test('4 本目はトーストで断る', () => {
    const store = makeStore();
    for (const id of ['a', 'b', 'c']) {
      toggleSampleDocument(store, id, true);
    }
    toggleSampleDocument(store, 'd', true);
    expect(store.getState().schema.selectedDocumentIds).toEqual(['a', 'b', 'c']);
    expect(toastTexts()).toContain('サンプル論文は 3 本までです');
  });

  test('モデル名は trim して保存する', () => {
    const store = makeStore();
    setDraftModel(store, '  gemini-test  ');
    expect(store.getState().schema.model).toBe('gemini-test');
  });
});

describe('runDraftSchema', () => {
  test('プロジェクト未選択・実行中は何もしない', async () => {
    const { deps, chatMock } = makeDeps();
    await runDraftSchema(makeStore(false), deps);
    const store = makeStore();
    store.setState({ schema: { ...store.getState().schema, drafting: true } });
    await runDraftSchema(store, deps);
    expect(chatMock).not.toHaveBeenCalled();
  });

  test('選択 0 本・モデル未入力・API キー未設定はガードして案内する', async () => {
    const store = makeStore();
    await runDraftSchema(store, makeDeps().deps);
    expect(store.getState().schema.draftError).toContain('1〜3 本選択');

    store.setState({ schema: { ...store.getState().schema, selectedDocumentIds: ['doc-1'] } });
    await runDraftSchema(store, makeDeps().deps);
    expect(store.getState().schema.draftError).toContain('モデルを選択してください');

    store.setState({ schema: { ...store.getState().schema, model: 'gemini-test' } });
    await runDraftSchema(store, makeDeps({ loadApiKey: async () => null }).deps);
    expect(store.getState().schema.draftError).toContain('API キーが未設定');
  });

  test('成功: プロンプト構築 → LLM 呼び出し（ログ付き）→ エディタへ流し込む', async () => {
    const store = makeStore();
    seedForDraft(store);
    const { deps, chatMock } = makeDeps();
    await runDraftSchema(store, deps);

    // プロトコル本文 + サンプル論文（ページ復元済み）がプロンプトに入る
    const [messages, options] = chatMock.mock.calls[0] ?? [];
    expect(messages?.[0]?.role).toBe('system');
    expect(messages?.[1]?.content).toContain('P: 成人肺炎');
    // サンプル論文の見出しは filename 表示（v0.10。study_label は Studies へ移設された）
    expect(messages?.[1]?.content).toContain('## Sample article: smith2020.pdf');
    expect(messages?.[1]?.content).toContain('[PAGE 2]\n2 ページ目の本文');
    expect(options?.responseFormat).toBe('json');

    // logs/llm フォルダ解決 + フル payload 保存 + LLMApiLog 追記
    expect(ensureChildFolderMock).toHaveBeenCalledWith('logs', 'folder-1', deps.google);
    expect(ensureChildFolderMock).toHaveBeenCalledWith('llm', 'folder-x', deps.google);
    expect(uploadTextFileMock).toHaveBeenCalled();
    expect(appendLlmApiLogMock).toHaveBeenCalledWith(
      'sheet-1',
      expect.objectContaining({ purpose: 'draft_schema' }),
      deps.google,
    );

    const { schema } = store.getState();
    expect(schema.drafting).toBe(false);
    expect(schema.editorRows).toHaveLength(1);
    expect(schema.editorRows?.[0]).toMatchObject({
      fieldName: 'sample_size_total',
      aiGenerated: true,
      fieldId: null,
    });
    expect(schema.editorOrigin).toBe('ai_draft');
    expect(toastTexts().some((text) => text.includes('1 項目をドラフト'))).toBe(true);
  });

  test('保存した OpenAI 互換接続はスラッシュなしモデルでも provider 設定を優先する', async () => {
    const store = makeStore();
    seedForDraft(store);
    const { deps, chatMock } = makeDeps();
    deps.loadLlmConnectionSettings = async () => ({
      provider: 'openai_compatible',
      openAiCompatibleEndpoint: 'https://llm.example/v1/chat/completions',
    });
    deps.loadApiKey = jest.fn().mockResolvedValue('custom-key');
    deps.buildProvider = jest.fn((config) => ({
      providerId: 'openai_compatible',
      model: config.model,
      supportsImageInput: true,
      chat: chatMock,
    }));
    await runDraftSchema(store, deps);
    expect(deps.loadApiKey).toHaveBeenCalledWith('openai_compatible');
    expect(deps.buildProvider).toHaveBeenCalledWith({
      provider: 'openai_compatible',
      apiKey: 'custom-key',
      model: 'gemini-test',
      endpoint: 'https://llm.example/v1/chat/completions',
    });
  });

  test('resolveRateLimitPolicy 注入時もドラフトが成立する（429 対策ポリシー経路）', async () => {
    const store = makeStore();
    seedForDraft(store);
    const resolveRateLimitPolicy = jest.fn().mockResolvedValue({
      requestsPerMinute: 8,
      maxAttempts: 5,
      baseDelayMs: 2_000,
      maxDelayMs: 60_000,
    });
    const { deps, chatMock } = makeDeps({ resolveRateLimitPolicy });
    await runDraftSchema(store, deps);
    expect(resolveRateLimitPolicy).toHaveBeenCalledTimes(1);
    expect(chatMock).toHaveBeenCalledTimes(1);
    expect(store.getState().schema.editorRows).toHaveLength(1);
  });

  test('スライス未読込でも Protocol / Documents を Sheets から解決する', async () => {
    const store = makeStore();
    store.setState({
      schema: { ...store.getState().schema, selectedDocumentIds: ['doc-1'], model: 'gemini-test' },
    });
    listProtocolsMock.mockResolvedValue([
      makeProtocol({
        rawTextInline: null,
        rawTextRef: 'https://drive.google.com/file/d/raw-1/view',
      }),
    ]);
    readDocumentsMock.mockResolvedValue([makeDocument()]);
    getFileTextMock.mockResolvedValue('プロトコル退避テキスト');
    const { deps, chatMock } = makeDeps();
    await runDraftSchema(store, deps);

    expect(listProtocolsMock).toHaveBeenCalledWith('sheet-1', deps.google);
    expect(readDocumentsMock).toHaveBeenCalledWith('sheet-1', deps.google);
    // raw_text_ref（webViewLink）からファイル ID を解決してテキスト取得
    expect(getFileTextMock).toHaveBeenCalledWith('raw-1', deps.google);
    expect(chatMock).toHaveBeenCalled();
  });

  test('プロトコル未入力・本文取得不能はエラー文言にする', async () => {
    const store = makeStore();
    store.setState({
      documents: { ...store.getState().documents, records: [makeDocument()] },
    });
    store.setState({
      schema: { ...store.getState().schema, selectedDocumentIds: ['doc-1'], model: 'gemini-test' },
    });
    listProtocolsMock.mockResolvedValue([]);
    await runDraftSchema(store, makeDeps().deps);
    expect(store.getState().schema.draftError).toContain('プロトコルが未入力');

    listProtocolsMock.mockResolvedValue([
      makeProtocol({ rawTextInline: null, rawTextRef: 'not-a-drive-url' }),
    ]);
    await runDraftSchema(store, makeDeps().deps);
    expect(store.getState().schema.draftError).toContain('本文を取得できません');

    listProtocolsMock.mockResolvedValue([makeProtocol({ rawTextInline: null, rawTextRef: null })]);
    await runDraftSchema(store, makeDeps().deps);
    expect(store.getState().schema.draftError).toContain('本文を取得できません');
  });

  test('選択 ID が文献一覧に無いときは filename 解決を ID に倒し、読み込み失敗を表示する', async () => {
    const store = makeStore();
    store.setState({
      protocol: { ...store.getState().protocol, records: [makeProtocol()] },
      documents: { ...store.getState().documents, records: [makeDocument()] },
    });
    store.setState({
      schema: {
        ...store.getState().schema,
        selectedDocumentIds: ['ghost-id'],
        model: 'gemini-test',
      },
    });
    await runDraftSchema(store, makeDeps().deps);
    expect(store.getState().schema.draftError).toContain('見つかりません');
  });

  test('LLM 失敗: draftError に文言を残し drafting を戻す', async () => {
    const store = makeStore();
    seedForDraft(store);
    const { deps, chatMock } = makeDeps();
    chatMock.mockRejectedValue(new Error('quota exceeded'));
    await runDraftSchema(store, deps);
    const { schema } = store.getState();
    expect(schema.drafting).toBe(false);
    expect(schema.draftError).toContain('quota exceeded');
    expect(schema.editorRows).toBeNull();
  });

  test('経過時間を 1 秒ごとに store へ反映し、完了後は ticker を止める', async () => {
    jest.useFakeTimers();
    try {
      const store = makeStore();
      seedForDraft(store);
      let resolveChat: (response: ChatResponse) => void = () => undefined;
      const { deps, chatMock } = makeDeps();
      chatMock.mockImplementation(
        () =>
          new Promise<ChatResponse>((resolve) => {
            resolveChat = resolve;
          }),
      );

      const promise = runDraftSchema(store, deps);
      await jest.advanceTimersByTimeAsync(2000);
      expect(store.getState().schema.draftElapsedSeconds).toBe(2);

      resolveChat({ text: JSON.stringify([DRAFTED_ITEM]), tokensIn: 1, tokensOut: 1, raw: {} });
      await promise;
      expect(store.getState().schema.drafting).toBe(false);

      const elapsed = store.getState().schema.draftElapsedSeconds;
      await jest.advanceTimersByTimeAsync(3000);
      expect(store.getState().schema.draftElapsedSeconds).toBe(elapsed); // ticker 停止済み
    } finally {
      jest.useRealTimers();
    }
  });
});

describe('エディタ操作', () => {
  test('updateEditorRow: 行を差し替え、origin を user_edit にして再検証する', () => {
    const store = makeStore();
    store.setState({
      schema: {
        ...store.getState().schema,
        editorRows: [makeEditorRow()],
        editorOrigin: 'ai_draft',
      },
    });
    updateEditorRow(store, 0, { fieldName: 'NG name' });
    const { schema } = store.getState();
    expect(schema.editorRows?.[0]?.fieldName).toBe('NG name');
    expect(schema.editorOrigin).toBe('user_edit');
    expect(schema.editorErrors).toHaveLength(1);
  });

  test('updateEditorRow: エディタ未表示・範囲外 index は no-op', () => {
    const store = makeStore();
    updateEditorRow(store, 0, { fieldName: 'x' });
    expect(store.getState().schema.editorRows).toBeNull();

    store.setState({ schema: { ...store.getState().schema, editorRows: [makeEditorRow()] } });
    updateEditorRow(store, 5, { fieldName: 'x' });
    expect(store.getState().schema.editorRows?.[0]?.fieldName).toBe('study_design');
  });

  test('addEditorRow / removeEditorRow / insertSchemaPreset（エディタ未表示は no-op）', () => {
    const store = makeStore();
    addEditorRow(store);
    removeEditorRow(store, 0);
    insertSchemaPreset(store, 'binary');
    expect(store.getState().schema.editorRows).toBeNull();

    store.setState({ schema: { ...store.getState().schema, editorRows: [makeEditorRow()] } });
    addEditorRow(store);
    expect(store.getState().schema.editorRows).toHaveLength(2);
    expect(store.getState().schema.editorRows?.[1]).toEqual(emptyEditorRow());
    expect(store.getState().schema.editorErrors.length).toBeGreaterThan(0); // 空行は必須エラー

    removeEditorRow(store, 1);
    expect(store.getState().schema.editorRows).toHaveLength(1);
    expect(store.getState().schema.editorErrors).toEqual([]);

    insertSchemaPreset(store, 'continuous');
    // 連続プリセットは issue #76 で outcome_unit_reported が加わり 13 項目（旧 12 + 1）
    expect(store.getState().schema.editorRows).toHaveLength(14);
    expect(store.getState().schema.editorOrigin).toBe('user_edit');

    // RoB 2 系は行を挿入せず事前設定ダイアログを開く（issue #103）。
    // スキップで従来と同一の 2 行（判定 + 根拠）が末尾に付く（回帰なし）
    insertSchemaPreset(store, 'rob2');
    expect(store.getState().schema.editorRows).toHaveLength(14);
    expect(store.getState().schema.presetDialog?.kind).toBe('rob2');
    skipRobPrespecDialog(store);
    expect(store.getState().schema.presetDialog).toBeNull();
    expect(store.getState().schema.editorRows).toHaveLength(16);
    expect(store.getState().schema.editorRows?.[14]?.fieldName).toBe('rob2_judgement');
    expect(store.getState().schema.editorRows?.[15]?.entityLevel).toBe('rob_domain');
    expect(store.getState().schema.editorRows?.slice(14)).toEqual([...ROB_TEMPLATE_ROB2]);
    expect(store.getState().schema.editorErrors).toEqual([]);

    // RoB 2（SQ 完全版。issue #61 + #103）はダイアログで effect を選んで確定すると
    // 判定 + 根拠 + SQ 22 問の計 24 行が末尾に付く
    insertSchemaPreset(store, 'rob2_sq');
    expect(store.getState().schema.presetDialog?.kind).toBe('rob2_sq');
    updateRobPrespecDialog(store, { effect: 'assignment' });
    confirmRobPrespecDialog(store);
    expect(store.getState().schema.presetDialog).toBeNull();
    expect(store.getState().schema.editorRows).toHaveLength(40);
    expect(store.getState().schema.editorRows?.[16]?.fieldName).toBe('rob2_judgement');
    expect(store.getState().schema.editorRows?.[17]?.fieldName).toBe('rob2_support');
    expect(store.getState().schema.editorRows?.[18]?.fieldName).toBe('rob2_sq1_1');
    expect(store.getState().schema.editorRows?.[39]?.fieldName).toBe('rob2_sq5_3');
    // 軽量版 rob2 と field_name が衝突するため、この時点ではエラーが検出される
    // （両プリセットは排他利用が前提。robTemplates.test.ts の意図的な衝突確認と対応）
    expect(store.getState().schema.editorErrors.length).toBeGreaterThan(0);
  });

  describe('RoB プリセット事前設定ダイアログ（issue #103）', () => {
    function makeEditorStore(rows: SchemaEditorRow[] = [makeEditorRow()]): Store {
      const store = makeStore();
      store.setState({ schema: { ...store.getState().schema, editorRows: rows } });
      return store;
    }

    test('insertSchemaPreset(rob2 / rob2_sq) は行を挿入せずダイアログを開く（初期値は空）', () => {
      const store = makeEditorStore();
      insertSchemaPreset(store, 'rob2');
      expect(store.getState().schema.editorRows).toHaveLength(1);
      expect(store.getState().schema.presetDialog).toEqual({
        kind: 'rob2',
        experimental: '',
        comparator: '',
        outcome: '',
        numericalResult: '',
        effect: null,
        deviationTypes: [],
        error: null,
      });
      insertSchemaPreset(store, 'rob2_sq');
      expect(store.getState().schema.presetDialog?.kind).toBe('rob2_sq');
      expect(store.getState().schema.editorRows).toHaveLength(1);
    });

    test('再挿入時は既存 rob2_judgement 行の note からダイアログ初期値を復元する', () => {
      const note = serializeRob2PrespecNote({
        design: 'individually_randomized_parallel_group',
        experimental: 'CBT-I',
        comparator: 'waitlist',
        outcome: 'SOL',
        numericalResult: null,
        effect: 'adhering',
        deviationTypes: ['non_adherence'],
      });
      const store = makeEditorStore([
        makeEditorRow({ fieldName: 'rob2_judgement', note }),
      ]);
      insertSchemaPreset(store, 'rob2_sq');
      expect(store.getState().schema.presetDialog).toMatchObject({
        kind: 'rob2_sq',
        experimental: 'CBT-I',
        comparator: 'waitlist',
        outcome: 'SOL',
        numericalResult: '',
        effect: 'adhering',
        deviationTypes: ['non_adherence'],
      });
    });

    test('updateRobPrespecDialog: 入力を反映し検証エラーをクリアする（非表示中は no-op）', () => {
      const store = makeEditorStore();
      updateRobPrespecDialog(store, { outcome: 'x' });
      expect(store.getState().schema.presetDialog).toBeNull();

      insertSchemaPreset(store, 'rob2_sq');
      confirmRobPrespecDialog(store); // effect 未選択 → エラー
      expect(store.getState().schema.presetDialog?.error).toContain('effect of interest');
      updateRobPrespecDialog(store, { effect: 'assignment' });
      expect(store.getState().schema.presetDialog?.effect).toBe('assignment');
      expect(store.getState().schema.presetDialog?.error).toBeNull();
    });

    test('cancelRobPrespecDialog: 行を挿入せず閉じる', () => {
      const store = makeEditorStore();
      insertSchemaPreset(store, 'rob2');
      cancelRobPrespecDialog(store);
      expect(store.getState().schema.presetDialog).toBeNull();
      expect(store.getState().schema.editorRows).toHaveLength(1);
    });

    test('skipRobPrespecDialog: rob2 のみ現行と同一の行を挿入して閉じる（rob2_sq・非表示中は no-op）', () => {
      const store = makeEditorStore();
      skipRobPrespecDialog(store); // 非表示中
      expect(store.getState().schema.editorRows).toHaveLength(1);

      insertSchemaPreset(store, 'rob2_sq');
      skipRobPrespecDialog(store); // rob2_sq にスキップは無い
      expect(store.getState().schema.presetDialog?.kind).toBe('rob2_sq');
      expect(store.getState().schema.editorRows).toHaveLength(1);
      cancelRobPrespecDialog(store);

      insertSchemaPreset(store, 'rob2');
      skipRobPrespecDialog(store);
      expect(store.getState().schema.presetDialog).toBeNull();
      expect(store.getState().schema.editorRows?.slice(1)).toEqual([...ROB_TEMPLATE_ROB2]);
      expect(store.getState().schema.editorOrigin).toBe('user_edit');
    });

    test('confirmRobPrespecDialog: 非表示中は no-op / adhering + 種別 0 個は必須未充足エラーで挿入しない', () => {
      const store = makeEditorStore();
      confirmRobPrespecDialog(store); // 非表示中
      expect(store.getState().schema.editorRows).toHaveLength(1);

      insertSchemaPreset(store, 'rob2');
      updateRobPrespecDialog(store, { effect: 'adhering' });
      confirmRobPrespecDialog(store);
      expect(store.getState().schema.presetDialog?.error).toContain('最低 1 つ');
      expect(store.getState().schema.editorRows).toHaveLength(1);
    });

    test('confirmRobPrespecDialog: rob2 に入力があれば Review context を注入し note に JSON を保存する', () => {
      const store = makeEditorStore();
      insertSchemaPreset(store, 'rob2');
      updateRobPrespecDialog(store, { outcome: 'mortality' });
      confirmRobPrespecDialog(store);
      const rows = store.getState().schema.editorRows ?? [];
      expect(rows).toHaveLength(3);
      expect(rows[1]?.extractionInstruction).toContain('Review context');
      expect(rows[1]?.extractionInstruction).toContain('mortality');
      expect(rows[1]?.note).toContain('rob2_prespec');
      expect(rows[2]?.note).toBeNull();
      expect(store.getState().schema.presetDialog).toBeNull();
    });

    test('confirmRobPrespecDialog: rob2_sq は effect で SQ セットが切り替わる（adhering は 2.7 なしの 23 行）', () => {
      const store = makeEditorStore();
      insertSchemaPreset(store, 'rob2_sq');
      updateRobPrespecDialog(store, {
        effect: 'adhering',
        deviationTypes: ['non_protocol_interventions'],
      });
      confirmRobPrespecDialog(store);
      const rows = store.getState().schema.editorRows ?? [];
      expect(rows).toHaveLength(24); // 既存 1 行 + 23 行
      const names = rows.map((row) => row.fieldName);
      expect(names).toContain('rob2_sq2_6');
      expect(names).not.toContain('rob2_sq2_7');
      expect(rows[1]?.extractionInstruction).toContain("the 'per-protocol' effect");
    });

    test('cancelEditor は開いたままの事前設定ダイアログも閉じる', () => {
      const store = makeEditorStore();
      insertSchemaPreset(store, 'rob2');
      expect(store.getState().schema.presetDialog).not.toBeNull();
      cancelEditor(store);
      expect(store.getState().schema.presetDialog).toBeNull();
      expect(store.getState().schema.editorRows).toBeNull();
    });
  });

  test('startEditorFromCurrent: 現行版の項目を fieldId 維持で引き継ぐ（未読込は no-op）', () => {
    const store = makeStore();
    startEditorFromCurrent(store);
    expect(store.getState().schema.editorRows).toBeNull();

    store.setState({
      schema: { ...store.getState().schema, currentFields: [makeField({ fieldId: 'f-keep' })] },
    });
    startEditorFromCurrent(store);
    expect(store.getState().schema.editorRows?.[0]).toMatchObject({
      fieldId: 'f-keep',
      fieldName: 'study_design',
    });
  });

  test('cancelEditor: エディタとエラーを破棄する', () => {
    const store = makeStore();
    store.setState({
      schema: {
        ...store.getState().schema,
        editorRows: [makeEditorRow()],
        draftError: 'エラー',
      },
    });
    cancelEditor(store);
    const { schema } = store.getState();
    expect(schema.editorRows).toBeNull();
    expect(schema.draftError).toBeNull();
  });
});

describe('confirmSchema', () => {
  function seedEditor(store: Store, rows: SchemaEditorRow[]): void {
    store.setState({
      protocol: { ...store.getState().protocol, records: [makeProtocol({ version: 3 })] },
    });
    store.setState({
      schema: {
        ...store.getState().schema,
        versions: [makeVersion(1)],
        editorRows: rows,
        editorOrigin: 'ai_draft',
      },
    });
  }

  test('プロジェクト未選択・エディタ未表示・確定中は何もしない', async () => {
    await confirmSchema(makeStore(false), makeDeps().deps, '');
    const store = makeStore();
    await confirmSchema(store, makeDeps().deps, '');
    store.setState({
      schema: { ...store.getState().schema, editorRows: [makeEditorRow()], confirming: true },
    });
    await confirmSchema(store, makeDeps().deps, '');
    expect(saveVersionMock).not.toHaveBeenCalled();
  });

  test('検証エラー・0 件はエディタへ表示して確定しない', async () => {
    const store = makeStore();
    seedEditor(store, [makeEditorRow({ fieldName: '' })]);
    await confirmSchema(store, makeDeps().deps, '');
    expect(store.getState().schema.editorErrors).toHaveLength(1);
    expect(saveVersionMock).not.toHaveBeenCalled();

    seedEditor(store, []);
    await confirmSchema(store, makeDeps().deps, '');
    expect(store.getState().schema.draftError).toContain('1 件もありません');
  });

  test('成功: 新版を先頭へ追加し、現行項目・カウント・トーストを更新する', async () => {
    const store = makeStore();
    seedEditor(store, [makeEditorRow()]);
    const savedVersion = makeVersion(2, { parentVersion: 1, protocolVersion: 3 });
    const savedFields = [makeField({ schemaVersion: 2 })];
    saveVersionMock.mockResolvedValue({ version: savedVersion, fields: savedFields });
    const { deps } = makeDeps();

    await confirmSchema(store, deps, '  単位を修正  ');

    expect(saveVersionMock).toHaveBeenCalledWith(
      expect.objectContaining({
        spreadsheetId: 'sheet-1',
        parentVersion: 1,
        protocolVersion: 3,
        createdByType: 'ai_draft',
        createdBy: 'tester@example.com',
        note: '単位を修正',
      }),
      expect.objectContaining({ google: deps.google }),
    );
    const { schema, counts } = store.getState();
    expect(schema.versions?.map((v) => v.schemaVersion)).toEqual([2, 1]);
    expect(schema.currentFields).toBe(savedFields);
    expect(schema.editorRows).toBeNull();
    expect(counts.schemaVersions).toBe(2);
    expect(toastTexts().some((text) => text.includes('表のデザイン v2 を確定'))).toBe(true);
  });

  test('note 空文字は null・versions 未読込は初版（parent null）として確定する', async () => {
    const store = makeStore();
    store.setState({
      protocol: { ...store.getState().protocol, records: [makeProtocol()] },
    });
    store.setState({
      schema: { ...store.getState().schema, editorRows: [makeEditorRow()] },
    });
    saveVersionMock.mockResolvedValue({ version: makeVersion(1), fields: [makeField()] });
    await confirmSchema(store, makeDeps({ profile: { getProfileUserInfo: async () => ({ email: '', id: 'uid' }) } }).deps, '   ');
    expect(saveVersionMock).toHaveBeenCalledWith(
      expect.objectContaining({
        parentVersion: null,
        note: null,
        createdByType: 'user_edit',
        createdBy: '', // email が取れないときは空文字
      }),
      expect.anything(),
    );
  });

  test('失敗: draftError に文言を残し confirming を戻す', async () => {
    const store = makeStore();
    seedEditor(store, [makeEditorRow()]);
    saveVersionMock.mockRejectedValue(new Error('append failed'));
    await confirmSchema(store, makeDeps().deps, '');
    const { schema } = store.getState();
    expect(schema.confirming).toBe(false);
    expect(schema.draftError).toBe('append failed');
    expect(schema.editorRows).not.toBeNull(); // エディタは保持
  });
});
