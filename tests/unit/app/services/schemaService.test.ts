import { emptyPilotMatrix } from '../../../../src/app/services/pilotMatrixService';
import { importSchemaFile } from '../../../../src/app/services/schemaTransferService';
import { serializeSchemaExport } from '../../../../src/features/schema/schemaTransfer';
import { addEditorOutcome, updateEditorOutcome, moveEditorOutcome, restoreEditorOutcome, requestRemoveEditorOutcome, confirmRemoveEditorOutcome, cancelRemoveEditorOutcome, importedOutcomeRows } from '../../../../src/app/services/schemaService';
import { readAllDecisions } from '../../../../src/features/verification/decisionRepository';
import { readEvidenceRows } from '../../../../src/features/extraction/evidenceRepository';
import { buildOutcomeMigrationRows } from '../../../../src/features/schema/outcomeMigration';
import { confirmOutcomeMigration, updateOutcomeMigration } from '../../../../src/app/services/schemaService';
import { makeEvidence as migrationEvidence } from '../../features/export/rset/testHelpers';
jest.mock('../../../../src/features/extraction/evidenceRepository');
import type { SchemaOutcome } from '../../../../src/domain/schemaOutcome';
import type { Decision } from '../../../../src/domain/decision';
jest.mock('../../../../src/features/verification/decisionRepository');
import { readAllSchemaOutcomes } from '../../../../src/features/schema/schemaOutcomeRepository';
jest.mock('../../../../src/features/schema/schemaOutcomeRepository');
import { providerModelMismatchMessage } from '../../../../src/lib/llm/modelCatalog';
import {
  addEditorRow,
  applyRedraft,
  cancelEditor,
  cancelRedraft,
  cancelRobPrespecDialog,
  confirmRobPrespecDialog,
  confirmSchema,
  emptyEditorRow,
  insertSchemaPreset,
  loadSchema,
  moveEditorRow,
  removeEditorRow,
  runDraftSchema,
  selectRevertVersion,
  setDraftModel,
  skipRobPrespecDialog,
  sortEditorRowsBySection,
  startEditorFromCurrent,
  startRevertFromVersion,
  toggleRedraftSelection,
  toggleSampleDocument,
  updateEditorRow,
  updateRobPrespecDialog,
  type SchemaServiceDeps,
} from '../../../../src/app/services/schemaService';
import {
  serializeRob2PrespecNote,
  type RobPrespecDialogState,
} from '../../../../src/features/schema/presets/robPrespec';
import { serializeRobinsIPrespecNote } from '../../../../src/features/schema/presets/robinsIPrespec';
import { serializeQuadas3PrespecNote } from '../../../../src/features/schema/presets/quadas3Prespec';
import { serializeQuipsPrespecNote } from '../../../../src/features/schema/presets/quipsPrespec';
import {
  ROB_TEMPLATE_QUADAS3,
  ROB_TEMPLATE_QUIPS,
  ROB_TEMPLATE_ROB2,
  ROB_TEMPLATE_ROBINS_I,
} from '../../../../src/features/schema/presets/robTemplates';
import { createInitialState, createStore, type Store } from '../../../../src/app/store';
import { buildRedraftDiff, defaultRedraftSelection } from '../../../../src/features/schema/redraftDiff';
import type { DocumentRecord } from '../../../../src/domain/document';
import type { Protocol } from '../../../../src/domain/protocol';
import type { SchemaField } from '../../../../src/domain/schemaField';
import type { SchemaVersion } from '../../../../src/domain/schemaVersion';
import { readDocuments } from '../../../../src/features/documents/documentRepository';
import { ensureStudyDataColumns } from '../../../../src/features/extraction/annotationRepository';
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
jest.mock('../../../../src/features/extraction/annotationRepository', () => ({
  ensureStudyDataColumns: jest.fn(),
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
const ensureStudyDataColumnsMock = ensureStudyDataColumns as jest.MockedFunction<
  typeof ensureStudyDataColumns
>;
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
    maxQuotes: null,
    multiSelect: null,
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
    maxQuotes: null,
    multiSelect: false,
    exclusiveValues: null,
    freeTextValues: null,
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
    excluded: false,
    exclusionReason: null,
    exclusionNote: null,
    excludedAt: null,
    ...overrides,
  };
}

function makeDeps(overrides: Partial<SchemaServiceDeps> = {}): {
  deps: SchemaServiceDeps;
  chatMock: jest.Mock<Promise<ChatResponse>, Parameters<LLMProvider['chat']>>;
} {
  const chatMock = jest.fn<Promise<ChatResponse>, Parameters<LLMProvider['chat']>>(async () => ({
    text: JSON.stringify({ fields: [DRAFTED_ITEM], outcomes: [] }),
    tokensIn: 100,
    tokensOut: 50,
    cachedTokensIn: null,
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
  jest.mocked(readEvidenceRows).mockReset().mockResolvedValue([]);
  jest.mocked(readAllSchemaOutcomes).mockResolvedValue([]);
  jest.mocked(readAllDecisions).mockReset().mockResolvedValue([]);
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
  ensureStudyDataColumnsMock.mockResolvedValue(undefined);
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

  test('既定モデル未設定（null）なら工場出荷の既定モデル（gemini-3.8-flash）で埋める', async () => {
    const store = makeStore();
    await loadSchema(store, makeDeps({ loadDefaultModel: async () => null }).deps);
    expect(store.getState().schema.model).toBe('gemini-3.8-flash');
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
  test('初回の一覧の案を編集し、AI 由来の経路を保ったまま最初の版を確定する', async () => {
    const store = makeStore();
    seedForDraft(store);
    const { deps, chatMock } = makeDeps();
    chatMock.mockResolvedValueOnce({
      text: JSON.stringify({
        fields: [{ ...DRAFTED_ITEM, entity_level: 'outcome_result' }],
        outcomes: [{ outcome_id: 'mortality', outcome_label: '全死亡', description: null, typical_timepoints: '30d|90d' }],
      }),
      tokensIn: 1, tokensOut: 1, cachedTokensIn: null, raw: {},
    });
    await runDraftSchema(store, deps);
    expect(store.getState().schema.editorOutcomes).toEqual([
      { aliases: [], outcomeId: 'mortality', outcomeLabel: '全死亡', description: null, typicalTimepoints: '30d|90d',
        addedVia: 'ai_draft', idLocked: false, idEdited: false, note: null },
    ]);
    updateEditorOutcome(store, 0, { outcomeLabel: '死亡' });
    expect(store.getState().schema.editorOutcomes[0]?.addedVia).toBe('ai_draft');
    const saved = { schemaVersion: 1, aliases: [], outcomeIndex: 1, outcomeId: 'mortality', outcomeLabel: '死亡',
      description: null, typicalTimepoints: '30d|90d', addedVia: 'ai_draft' as const, note: null };
    saveVersionMock.mockResolvedValue({ version: makeVersion(1), fields: [makeField()], outcomes: [saved] });
    await confirmSchema(store, deps, '');
    expect(saveVersionMock).toHaveBeenCalledWith(expect.objectContaining({
      outcomes: [expect.objectContaining({ outcomeLabel: '死亡', addedVia: 'ai_draft' })], listModeBefore: false,
    }), expect.anything());
    expect(store.getState().schema.currentOutcomes).toEqual([saved]);
    expect(store.getState().schema.allOutcomes).toEqual([saved]);
  });

  test('再ドラフトは一覧を提案させず、応答に案があっても現行の一覧を引き継ぐ', async () => {
    const store = makeStore();
    seedForDraft(store);
    const current = schemaOutcome();
    store.setState({ schema: {
      ...store.getState().schema, versions: [makeVersion(1)], currentFields: [makeField()],
      currentOutcomes: [current], allOutcomes: [current],
    } });
    const { deps, chatMock } = makeDeps();
    chatMock.mockResolvedValueOnce({
      text: JSON.stringify({
        fields: [{ ...DRAFTED_ITEM, entity_level: 'outcome_result' }],
        outcomes: [{ outcome_id: 'pain', outcome_label: '疼痛', description: null, typical_timepoints: null }],
      }),
      tokensIn: 1, tokensOut: 1, cachedTokensIn: null, raw: {},
    });
    await runDraftSchema(store, deps);
    expect(chatMock.mock.calls[0]?.[0][0]?.content).toContain('This is a redraft of an existing schema');
    applyRedraft(store);
    expect(store.getState().schema.editorOutcomes).toEqual([
      { aliases: [], outcomeId: current.outcomeId, outcomeLabel: current.outcomeLabel, description: current.description,
        typicalTimepoints: current.typicalTimepoints, addedVia: current.addedVia, note: current.note,
        idLocked: true, idEdited: false },
    ]);
  });

  test('接続方式とモデルが食い違う場合は LLM を呼ばず案内する', async () => {
    const store = makeStore();
    seedForDraft(store);
    store.setState({ schema: { ...store.getState().schema, model: 'gemini-2.5-pro' } });
    const { deps, chatMock } = makeDeps({
      loadLlmConnectionSettings: async () => ({
        provider: 'anthropic', openAiCompatibleEndpoint: null, azureOpenAiEndpoint: null, localLlmEndpoint: null,
      }),
    });
    await runDraftSchema(store, deps);
    expect(store.getState().schema.draftError).toBe(
      providerModelMismatchMessage('gemini-2.5-pro', 'anthropic'),
    );
    expect(chatMock).not.toHaveBeenCalled();
  });

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

  test.each([true, false, 'consentError', 'runError'])('同意待ちの再操作を止め、終了時にロックを解除する: %s', async (outcome) => {
    const store = makeStore();
    seedForDraft(store);
    const before = store.getState();
    let resolveConsent!: (value: boolean) => void;
    let rejectConsent!: (error: Error) => void;
    const ensureAiDataConsent = jest.fn(() => new Promise<boolean>((resolve, reject) => {
      resolveConsent = resolve;
      rejectConsent = reject;
    }));
    const { deps, chatMock } = makeDeps({ ensureAiDataConsent });
    if (outcome === 'runError') chatMock.mockRejectedValueOnce(new Error('ドラフト失敗'));
    const pending = runDraftSchema(store, deps);
    expect(store.getState().schema.drafting).toBe(false);
    while (!resolveConsent) await Promise.resolve();
    expect(store.getState()).toBe(before);
    await runDraftSchema(store, deps);
    expect(ensureAiDataConsent).toHaveBeenCalledTimes(1);
    expect(chatMock).not.toHaveBeenCalled();
    if (outcome === 'consentError') rejectConsent(new Error('同意確認失敗'));
    else resolveConsent(outcome !== false);
    await pending;
    expect(chatMock).toHaveBeenCalledTimes(outcome === true || outcome === 'runError' ? 1 : 0);
    expect(store.getState().schema.drafting).toBe(false);
    if (outcome === false) expect(store.getState()).toBe(before);
    ensureAiDataConsent.mockResolvedValue(false);
    await runDraftSchema(store, deps);
    expect(ensureAiDataConsent).toHaveBeenCalledTimes(2);
  });

  test('AI へ送る前の同意（issue #381）: キャンセルなら LLM を呼ばず画面も変えない / 同意なら実行する', async () => {
    const store = makeStore();
    seedForDraft(store);
    const ensureAiDataConsent = jest.fn().mockResolvedValueOnce(false).mockResolvedValueOnce(true);
    const { deps, chatMock } = makeDeps({ ensureAiDataConsent });
    const before = store.getState().schema;
    await runDraftSchema(store, deps);
    expect(ensureAiDataConsent).toHaveBeenCalledWith('gemini');
    expect(chatMock).not.toHaveBeenCalled();
    expect(store.getState().schema).toEqual(before);

    await runDraftSchema(store, deps);
    expect(chatMock).toHaveBeenCalledTimes(1);
  });

  test('AI へ送る前の同意は API キーの検証より後に確かめる', async () => {
    const store = makeStore();
    seedForDraft(store);
    const ensureAiDataConsent = jest.fn();
    await runDraftSchema(store, makeDeps({ loadApiKey: async () => null, ensureAiDataConsent }).deps);
    expect(ensureAiDataConsent).not.toHaveBeenCalled();
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
    expect(schema.editorOutcomes).toEqual([]);
    expect(toastTexts().some((text) => text.includes('1 項目をドラフト'))).toBe(true);
  });

  test('保存した OpenAI 互換接続はスラッシュなしモデルでも provider 設定を優先する', async () => {
    const store = makeStore();
    seedForDraft(store);
    const { deps, chatMock } = makeDeps();
    deps.loadLlmConnectionSettings = async () => ({
      provider: 'openai_compatible',
      openAiCompatibleEndpoint: 'https://llm.example/v1/chat/completions',
      azureOpenAiEndpoint: null, localLlmEndpoint: null,
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

      resolveChat({ text: JSON.stringify([DRAFTED_ITEM]), tokensIn: 1, tokensOut: 1, cachedTokensIn: null, raw: {} });
      await promise;
      expect(store.getState().schema.drafting).toBe(false);

      const elapsed = store.getState().schema.draftElapsedSeconds;
      await jest.advanceTimersByTimeAsync(3000);
      expect(store.getState().schema.draftElapsedSeconds).toBe(elapsed); // ticker 停止済み
    } finally {
      jest.useRealTimers();
    }
  });

  describe('現行版があるときの分岐（issue #197。差分承認画面を経由する）', () => {
    test('currentFields が 1 件以上なら editorRows へ直行せず redraft をセットする', async () => {
      const store = makeStore();
      seedForDraft(store);
      store.setState({
        schema: {
          ...store.getState().schema,
          currentFields: [makeField({ fieldName: 'sample_size_total', required: false })],
        },
      });
      const { deps } = makeDeps();
      await runDraftSchema(store, deps);

      const { schema } = store.getState();
      expect(schema.drafting).toBe(false);
      expect(schema.editorRows).toBeNull();
      expect(schema.redraft).not.toBeNull();
      expect(schema.redraft?.diff.changed).toHaveLength(1); // required の差分あり
      expect(schema.redraft?.selection.changed).toEqual({ sample_size_total: true });
      expect(toastTexts().some((text) => text.includes('追加 0 件 / 変更 1 件 / 削除候補 0 件'))).toBe(
        true,
      );
    });

    test('currentFields が空配列（0 版扱い）なら従来どおり editorRows へ直行する', async () => {
      const store = makeStore();
      seedForDraft(store);
      store.setState({ schema: { ...store.getState().schema, currentFields: [] } });
      const { deps } = makeDeps();
      await runDraftSchema(store, deps);

      const { schema } = store.getState();
      expect(schema.editorRows).toHaveLength(1);
      expect(schema.redraft).toBeNull();
      expect(toastTexts().some((text) => text.includes('1 項目をドラフト'))).toBe(true);
    });
  });
});

describe('差分承認画面のサービス関数（issue #197）', () => {
  function seedRedraft(store: Store): void {
    const currentFields = [
      makeField({ fieldId: 'f-changed', fieldName: 'changed_field', required: false }),
      makeField({ fieldId: 'f-removed', fieldName: 'removed_field' }),
    ];
    const drafted = [
      makeEditorRow({ fieldName: 'changed_field', required: true }),
      makeEditorRow({ fieldName: 'added_field' }),
    ];
    store.setState({
      schema: {
        ...store.getState().schema,
        currentFields,
        redraft: {
          diff: buildRedraftDiff(currentFields, drafted),
          selection: defaultRedraftSelection(buildRedraftDiff(currentFields, drafted)),
        },
      },
    });
  }

  describe('toggleRedraftSelection', () => {
    test('redraft が null（非表示中）は no-op', () => {
      const store = makeStore();
      toggleRedraftSelection(store, 'added', 'added_field', false);
      expect(store.getState().schema.redraft).toBeNull();
    });

    test('該当キーだけを更新し、他のキーは保持する', () => {
      const store = makeStore();
      seedRedraft(store);
      toggleRedraftSelection(store, 'removed', 'removed_field', true);
      const { redraft } = store.getState().schema;
      expect(redraft?.selection.removed).toEqual({ removed_field: true });
      expect(redraft?.selection.added).toEqual({ added_field: true }); // 他カテゴリは不変
      toggleRedraftSelection(store, 'added', 'added_field', false);
      expect(store.getState().schema.redraft?.selection.added).toEqual({ added_field: false });
    });
  });

  describe('applyRedraft', () => {
    test('redraft が null（非表示中）は no-op', () => {
      const store = makeStore();
      applyRedraft(store);
      expect(store.getState().schema.editorRows).toBeNull();
    });

    test('既定選択のまま適用すると editorOrigin は ai_draft になり、redraft は閉じる', () => {
      const store = makeStore();
      seedRedraft(store);
      applyRedraft(store);
      const { schema } = store.getState();
      expect(schema.redraft).toBeNull();
      expect(schema.editorOrigin).toBe('ai_draft');
      // removed_field は既定選択（false = 削除しない）のため残る
      expect(schema.editorRows?.map((row) => row.fieldName)).toEqual([
        'changed_field',
        'removed_field',
        'added_field',
      ]);
      expect(schema.editorErrors).toEqual([]);
    });

    test('選択を既定から変更して適用すると editorOrigin は user_edit になる', () => {
      const store = makeStore();
      seedRedraft(store);
      toggleRedraftSelection(store, 'added', 'added_field', false);
      applyRedraft(store);
      const { schema } = store.getState();
      expect(schema.editorOrigin).toBe('user_edit');
      expect(schema.editorRows?.map((row) => row.fieldName)).toEqual(['changed_field', 'removed_field']);
    });
  });

  describe('cancelRedraft', () => {
    test('redraft を null に戻す（エディタは開かない）', () => {
      const store = makeStore();
      seedRedraft(store);
      cancelRedraft(store);
      const { schema } = store.getState();
      expect(schema.redraft).toBeNull();
      expect(schema.editorRows).toBeNull();
    });
  });

  test('cancelEditor は開いたままの差分承認画面も閉じる', () => {
    const store = makeStore();
    seedRedraft(store);
    cancelEditor(store);
    expect(store.getState().schema.redraft).toBeNull();
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

  describe('moveEditorRow（行の並び替え。issue #230）', () => {
    test('正常な移動: from の行を to の位置へ挿入し、他行は詰める', () => {
      const store = makeStore();
      const rows = [
        makeEditorRow({ fieldName: 'a' }),
        makeEditorRow({ fieldName: 'b' }),
        makeEditorRow({ fieldName: 'c' }),
      ];
      store.setState({
        schema: { ...store.getState().schema, editorRows: rows, editorOrigin: 'ai_draft' },
      });
      moveEditorRow(store, 2, 0);
      const { schema } = store.getState();
      expect(schema.editorRows?.map((row) => row.fieldName)).toEqual(['c', 'a', 'b']);
      expect(schema.editorOrigin).toBe('user_edit');
      expect(schema.editorErrors).toEqual([]);
    });

    test('editorRows === null は no-op', () => {
      const store = makeStore();
      moveEditorRow(store, 0, 1);
      expect(store.getState().schema.editorRows).toBeNull();
    });

    test('range外 index（負の値・length 以上）は no-op', () => {
      const store = makeStore();
      const rows = [makeEditorRow({ fieldName: 'a' }), makeEditorRow({ fieldName: 'b' })];
      store.setState({ schema: { ...store.getState().schema, editorRows: rows } });

      moveEditorRow(store, -1, 0);
      expect(store.getState().schema.editorRows?.map((row) => row.fieldName)).toEqual(['a', 'b']);

      moveEditorRow(store, 0, 2);
      expect(store.getState().schema.editorRows?.map((row) => row.fieldName)).toEqual(['a', 'b']);

      moveEditorRow(store, 2, 0);
      expect(store.getState().schema.editorRows?.map((row) => row.fieldName)).toEqual(['a', 'b']);
    });

    test('from === to は no-op（store を触らない）', () => {
      const store = makeStore();
      const rows = [makeEditorRow({ fieldName: 'a' }), makeEditorRow({ fieldName: 'b' })];
      store.setState({ schema: { ...store.getState().schema, editorRows: rows, editorOrigin: 'ai_draft' } });
      moveEditorRow(store, 1, 1);
      const { schema } = store.getState();
      expect(schema.editorRows).toBe(rows);
      expect(schema.editorOrigin).toBe('ai_draft');
    });

    test('editorErrors が移動後の並びで再計算される', () => {
      const store = makeStore();
      const invalidRow = makeEditorRow({ fieldName: '' });
      const rows = [makeEditorRow({ fieldName: 'a' }), invalidRow];
      store.setState({ schema: { ...store.getState().schema, editorRows: rows } });
      moveEditorRow(store, 1, 0);
      const { schema } = store.getState();
      expect(schema.editorRows?.[0]).toBe(invalidRow);
      expect(schema.editorErrors.some((error) => error.index === 0)).toBe(true);
    });
  });

  describe('sortEditorRowsBySection（issue #230）', () => {
    test('section の初出順を保ちつつ、同じ section の行を寄せる', () => {
      const store = makeStore();
      const rows = [
        makeEditorRow({ fieldName: 'a', section: 'results' }),
        makeEditorRow({ fieldName: 'b', section: 'methods' }),
        makeEditorRow({ fieldName: 'c', section: 'results' }),
        makeEditorRow({ fieldName: 'd', section: 'methods' }),
      ];
      store.setState({
        schema: { ...store.getState().schema, editorRows: rows, editorOrigin: 'ai_draft' },
      });
      sortEditorRowsBySection(store);
      const { schema } = store.getState();
      // section 初出順: results → methods。各 section 内は元の相対順序を維持
      expect(schema.editorRows?.map((row) => row.fieldName)).toEqual(['a', 'c', 'b', 'd']);
      expect(schema.editorOrigin).toBe('user_edit');
    });

    test('既にまとまっている配列では store を触らない', () => {
      const store = makeStore();
      const rows = [
        makeEditorRow({ fieldName: 'a', section: 'methods' }),
        makeEditorRow({ fieldName: 'b', section: 'methods' }),
        makeEditorRow({ fieldName: 'c', section: 'results' }),
      ];
      store.setState({ schema: { ...store.getState().schema, editorRows: rows, editorOrigin: 'ai_draft' } });
      sortEditorRowsBySection(store);
      const { schema } = store.getState();
      expect(schema.editorRows).toBe(rows);
      expect(schema.editorOrigin).toBe('ai_draft');
    });

    test('editorRows === null は no-op', () => {
      const store = makeStore();
      sortEditorRowsBySection(store);
      expect(store.getState().schema.editorRows).toBeNull();
    });
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
      // error には t() 解決前のメッセージキーを保持する（issue #126 項目3: 描画時に現在言語で
      // 解決することでエラー表示中の言語切替にも追従する。renderer 側の確認は schemaView.test.ts）
      expect(store.getState().schema.presetDialog?.error).toBe('schema.prespecErrEffectRequired');
      updateRobPrespecDialog(store, { effect: 'assignment' });
      // union（PresetDialogState）のうち rob2_sq を開いていることは直前で保証済み
      const dialog = store.getState().schema.presetDialog as RobPrespecDialogState;
      expect(dialog.effect).toBe('assignment');
      expect(dialog.error).toBeNull();
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
      expect(store.getState().schema.presetDialog?.error).toBe(
        'schema.prespecErrDeviationRequired',
      );
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

    test('insertSchemaPreset(robins_i / robins_i_sq) も行を挿入せずダイアログを開く（issue #103 PR2）', () => {
      const store = makeEditorStore();
      insertSchemaPreset(store, 'robins_i');
      expect(store.getState().schema.editorRows).toHaveLength(1);
      expect(store.getState().schema.presetDialog).toEqual({
        kind: 'robins_i',
        design: '',
        participants: '',
        experimental: '',
        comparator: '',
        outcome: '',
        numericalResult: '',
        benefitHarm: null,
        effect: null,
        confoundingDomains: '',
        coInterventions: '',
        error: null,
      });
      insertSchemaPreset(store, 'robins_i_sq');
      expect(store.getState().schema.presetDialog?.kind).toBe('robins_i_sq');
      expect(store.getState().schema.editorRows).toHaveLength(1);
    });

    test('robins_i の再挿入時は robins_i_judgement 行の note からダイアログ初期値を復元する', () => {
      const note = serializeRobinsIPrespecNote({
        design: null,
        participants: 'adults',
        experimental: null,
        comparator: null,
        outcome: 'mortality',
        numericalResult: null,
        benefitHarm: 'harm',
        effect: 'starting_adhering',
        confoundingDomains: ['age', 'severity'],
        coInterventions: [],
      });
      const store = makeEditorStore([makeEditorRow({ fieldName: 'robins_i_judgement', note })]);
      insertSchemaPreset(store, 'robins_i_sq');
      expect(store.getState().schema.presetDialog).toMatchObject({
        kind: 'robins_i_sq',
        participants: 'adults',
        outcome: 'mortality',
        benefitHarm: 'harm',
        effect: 'starting_adhering',
        confoundingDomains: 'age\nseverity',
      });
    });

    test('skipRobPrespecDialog: robins_i も現行と同一の行を挿入して閉じる（robins_i_sq は no-op）', () => {
      const store = makeEditorStore();
      insertSchemaPreset(store, 'robins_i_sq');
      skipRobPrespecDialog(store); // SQ 完全版にスキップは無い
      expect(store.getState().schema.presetDialog?.kind).toBe('robins_i_sq');
      expect(store.getState().schema.editorRows).toHaveLength(1);
      cancelRobPrespecDialog(store);

      insertSchemaPreset(store, 'robins_i');
      skipRobPrespecDialog(store);
      expect(store.getState().schema.presetDialog).toBeNull();
      expect(store.getState().schema.editorRows?.slice(1)).toEqual([...ROB_TEMPLATE_ROBINS_I]);
    });

    test('confirmRobPrespecDialog: robins_i_sq は effect 未選択で必須未充足エラー（挿入しない）', () => {
      const store = makeEditorStore();
      insertSchemaPreset(store, 'robins_i_sq');
      confirmRobPrespecDialog(store);
      expect(store.getState().schema.presetDialog?.error).toBe(
        'schema.prespecErrRobinsIEffectRequired',
      );
      expect(store.getState().schema.editorRows).toHaveLength(1);
    });

    test('confirmRobPrespecDialog: robins_i_sq は effect で D4 の SQ セットが排他的に切り替わる', () => {
      const store = makeEditorStore();
      insertSchemaPreset(store, 'robins_i_sq');
      updateRobPrespecDialog(store, { effect: 'assignment' });
      confirmRobPrespecDialog(store);
      const rows = store.getState().schema.editorRows ?? [];
      expect(rows).toHaveLength(33); // 既存 1 行 + 32 行
      const names = rows.map((row) => row.fieldName);
      expect(names).toContain('robins_i_sq4_1');
      expect(names).not.toContain('robins_i_sq4_3');
      expect(rows[1]?.extractionInstruction).toContain('to assess the effect of assignment to intervention');
    });

    test('confirmRobPrespecDialog: robins_i はリスト入力を Review context と note に反映する', () => {
      const store = makeEditorStore();
      insertSchemaPreset(store, 'robins_i');
      updateRobPrespecDialog(store, { confoundingDomains: 'age\nseverity' });
      confirmRobPrespecDialog(store);
      const rows = store.getState().schema.editorRows ?? [];
      expect(rows).toHaveLength(3);
      expect(rows[1]?.extractionInstruction).toContain('age; severity');
      expect(rows[1]?.note).toContain('robins_i_prespec');
      expect(store.getState().schema.presetDialog).toBeNull();
    });

    test('insertSchemaPreset(quadas3 / quips) も行を挿入せずダイアログを開く（issue #103 PR3）', () => {
      const store = makeEditorStore();
      insertSchemaPreset(store, 'quadas3');
      expect(store.getState().schema.editorRows).toHaveLength(1);
      expect(store.getState().schema.presetDialog?.kind).toBe('quadas3');
      cancelRobPrespecDialog(store);
      insertSchemaPreset(store, 'quips');
      expect(store.getState().schema.presetDialog?.kind).toBe('quips');
      expect(store.getState().schema.editorRows).toHaveLength(1);
    });

    test('quadas3 / quips の再挿入時は判定行の note からダイアログ初期値を復元する', () => {
      const q3Note = serializeQuadas3PrespecNote({
        population: 'adults',
        indexTest: null,
        targetCondition: null,
        intendedUsePopulation: null,
        testRole: null,
        referenceStandard: null,
        analysisUnit: 'per patient',
      });
      const store = makeEditorStore([
        makeEditorRow({ fieldName: 'quadas3_rob_judgement', note: q3Note }),
      ]);
      insertSchemaPreset(store, 'quadas3');
      expect(store.getState().schema.presetDialog).toMatchObject({
        kind: 'quadas3',
        population: 'adults',
        analysisUnit: 'per patient',
      });
      cancelRobPrespecDialog(store);

      const quipsNote = serializeQuipsPrespecNote({
        population: null,
        prognosticFactor: 'FAB',
        outcome: null,
        keyCharacteristics: ['age', 'sex'],
        importantConfounders: [],
      });
      const store2 = makeEditorStore([
        makeEditorRow({ fieldName: 'quips_judgement', note: quipsNote }),
      ]);
      insertSchemaPreset(store2, 'quips');
      expect(store2.getState().schema.presetDialog).toMatchObject({
        kind: 'quips',
        prognosticFactor: 'FAB',
        keyCharacteristics: 'age\nsex',
      });
    });

    test('skipRobPrespecDialog: quadas3 / quips も現行と同一の行を挿入して閉じる', () => {
      const store = makeEditorStore();
      insertSchemaPreset(store, 'quadas3');
      skipRobPrespecDialog(store);
      expect(store.getState().schema.presetDialog).toBeNull();
      expect(store.getState().schema.editorRows?.slice(1)).toEqual([...ROB_TEMPLATE_QUADAS3]);

      const store2 = makeEditorStore();
      insertSchemaPreset(store2, 'quips');
      skipRobPrespecDialog(store2);
      expect(store2.getState().schema.editorRows?.slice(1)).toEqual([...ROB_TEMPLATE_QUIPS]);
    });

    test('confirmRobPrespecDialog: quadas3 は全項目任意（未入力の確定はスキップと同一 = 回帰なし）', () => {
      const store = makeEditorStore();
      insertSchemaPreset(store, 'quadas3');
      confirmRobPrespecDialog(store);
      expect(store.getState().schema.presetDialog).toBeNull();
      expect(store.getState().schema.editorRows?.slice(1)).toEqual([...ROB_TEMPLATE_QUADAS3]);
    });

    test('confirmRobPrespecDialog: quadas3 の Analysis / unit は SQ 4.3 へ注入され note に保存される', () => {
      const store = makeEditorStore();
      insertSchemaPreset(store, 'quadas3');
      updateRobPrespecDialog(store, { analysisUnit: 'per patient' });
      confirmRobPrespecDialog(store);
      const rows = store.getState().schema.editorRows ?? [];
      const sq4_3 = rows.find((row) => row.fieldName === 'quadas3_sq4_3');
      expect(sq4_3?.extractionInstruction).toContain(
        'the unit of analysis of the ideal test accuracy trial is: per patient',
      );
      const judgement = rows.find((row) => row.fieldName === 'quadas3_rob_judgement');
      expect(judgement?.note).toContain('quadas3_prespec');
    });

    test('confirmRobPrespecDialog: quips の LIST は対象 item へ注入され note に保存される', () => {
      const store = makeEditorStore();
      insertSchemaPreset(store, 'quips');
      updateRobPrespecDialog(store, { importantConfounders: 'baseline severity' });
      confirmRobPrespecDialog(store);
      const rows = store.getState().schema.editorRows ?? [];
      const item5_1 = rows.find((row) => row.fieldName === 'quips_pi5_1');
      expect(item5_1?.extractionInstruction).toContain('baseline severity');
      const judgement = rows.find((row) => row.fieldName === 'quips_judgement');
      expect(judgement?.note).toContain('quips_prespec');
      expect(store.getState().schema.presetDialog).toBeNull();
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
      schema: { ...store.getState().schema, currentFields: [makeField({ fieldId: 'f-keep', maxQuotes: 12 })] },
    });
    startEditorFromCurrent(store);
    expect(store.getState().schema.editorRows?.[0]).toMatchObject({
      fieldId: 'f-keep',
      maxQuotes: 12,
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
    saveVersionMock.mockResolvedValue({ version: savedVersion, fields: savedFields, outcomes: [] });
    const { deps } = makeDeps();

    const outcomeList = { schemaVersion: 1, outcomes: [], currentIds: new Set<string>(), aliasToId: new Map(), everIds: new Set<string>() };
    store.setState({
      pilot: { ...store.getState().pilot, outcomeList, verifyStudyId: 'study-1' },
      adjudicate: { ...store.getState().adjudicate, outcomeList },
    });
    await confirmSchema(store, deps, '  単位を修正  ');

    expect(store.getState().pilot.outcomeList).toBeUndefined();
    expect(store.getState().adjudicate.outcomeList).toBeUndefined();
    // 確定の後はパイロットも最新の結果から開き直す（移行の経路と同じ。issue #547）
    expect(store.getState().pilot.verifyStudyId).toBeNull();
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
    // StudyData のヘッダ同期（study レベル項目のみ）も確定と同じタイミングで呼ばれる
    expect(ensureStudyDataColumnsMock).toHaveBeenCalledWith(
      'sheet-1',
      ['study_design'],
      deps.google,
    );
  });

  test('note 空文字は null・versions 未読込は初版（parent null）として確定する', async () => {
    const store = makeStore();
    store.setState({
      protocol: { ...store.getState().protocol, records: [makeProtocol()] },
    });
    store.setState({
      schema: { ...store.getState().schema, editorRows: [makeEditorRow()] },
    });
    saveVersionMock.mockResolvedValue({ version: makeVersion(1), fields: [makeField()], outcomes: [] });
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

describe('confirmSchema: StudyData ヘッダ同期（確定と同時に列を反映。app サービス層での合成）', () => {
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

  test('確定した fields のうち entityLevel === study の fieldName だけを渡す（arm / outcome_result は除く）', async () => {
    const store = makeStore();
    seedEditor(store, [makeEditorRow()]);
    const savedVersion = makeVersion(2, { parentVersion: 1, protocolVersion: 3 });
    const savedFields = [
      makeField({
        schemaVersion: 2,
        fieldId: 'f-study',
        fieldName: 'sample_size_total',
        entityLevel: 'study',
      }),
      makeField({
        schemaVersion: 2,
        fieldId: 'f-arm',
        fieldName: 'arm_dose',
        entityLevel: 'arm',
      }),
      makeField({
        schemaVersion: 2,
        fieldId: 'f-outcome',
        fieldName: 'outcome_value',
        entityLevel: 'outcome_result',
      }),
      makeField({
        schemaVersion: 2,
        fieldId: 'f-rob',
        fieldName: 'rob2_judgement',
        entityLevel: 'rob_domain',
      }),
      makeField({
        schemaVersion: 2,
        fieldId: 'f-study-2',
        fieldName: 'country',
        entityLevel: 'study',
      }),
    ];
    saveVersionMock.mockResolvedValue({ version: savedVersion, fields: savedFields, outcomes: [] });
    const { deps } = makeDeps();

    await confirmSchema(store, deps, '');

    expect(ensureStudyDataColumnsMock).toHaveBeenCalledWith(
      'sheet-1',
      ['sample_size_total', 'country'],
      deps.google,
    );
  });

  test('ヘッダ同期が失敗しても確定処理は成功扱いで完了する（store の状態遷移は従来どおり・console.warn を残す）', async () => {
    const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
    const store = makeStore();
    seedEditor(store, [makeEditorRow()]);
    const savedVersion = makeVersion(2, { parentVersion: 1, protocolVersion: 3 });
    const savedFields = [makeField({ schemaVersion: 2 })];
    saveVersionMock.mockResolvedValue({ version: savedVersion, fields: savedFields, outcomes: [] });
    ensureStudyDataColumnsMock.mockRejectedValue(new Error('batchGet に失敗しました'));
    const { deps } = makeDeps();

    await confirmSchema(store, deps, '');

    const { schema, counts } = store.getState();
    // 確定処理そのものは成功扱い（従来の成功時と同じ状態遷移）
    expect(schema.confirming).toBe(false);
    expect(schema.versions?.map((v) => v.schemaVersion)).toEqual([2, 1]);
    expect(schema.currentFields).toBe(savedFields);
    expect(schema.editorRows).toBeNull();
    expect(schema.draftError).toBeNull();
    expect(counts.schemaVersions).toBe(2);
    expect(toastTexts().some((text) => text.includes('表のデザイン v2 を確定'))).toBe(true);
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining('StudyData のヘッダ列同期に失敗しました'),
    );
    warnSpy.mockRestore();
  });
});


test.each([
  { exclusiveValues: ['NA'], freeTextValues: ['Other'] },
  { exclusiveValues: [], freeTextValues: [] },
])('現行版の複数選択設定をエディタへ復元する: %p', (multiSelect) => {
  const store = makeStore();
  store.setState({ schema: { ...store.getState().schema, currentFields: [makeField({ dataType: 'enum', multiSelect })] } });
  startEditorFromCurrent(store);
  expect(store.getState().schema.editorRows?.[0]).toMatchObject({
    multiSelect: true, exclusiveValues: multiSelect.exclusiveValues.join('|') || null,
    freeTextValues: multiSelect.freeTextValues.join('|') || null,
  });
});

// 「前の版の内容に戻す」（issue #318）
describe('前の版の内容に戻す（issue #318）', () => {
  const latestFields = [
    makeField({ schemaVersion: 3, fieldId: 'f-keep', fieldName: 'keep_me' }),
    makeField({ schemaVersion: 3, fieldId: 'f-new', fieldName: 'added_later' }),
  ];
  const sourceFields = [
    makeField({ schemaVersion: 1, fieldId: 'f-gone', fieldName: 'dropped_later' }),
    makeField({ schemaVersion: 1, fieldId: 'f-keep', fieldName: 'keep_me' }),
  ];

  function seedConfirmed(store: Store): void {
    store.setState({
      schema: {
        ...store.getState().schema,
        versions: [makeVersion(3), makeVersion(2), makeVersion(1)],
        currentFields: latestFields,
      },
    });
  }

  describe('selectRevertVersion', () => {
    test('版を選び、前回のエラーを消す', () => {
      const store = makeStore();
      store.setState({
        schema: { ...store.getState().schema, revertFrom: { version: 2, loading: false, error: 'e' } },
      });
      selectRevertVersion(store, 1);
      expect(store.getState().schema.revertFrom).toEqual({ version: 1, loading: false, error: null });
    });

    test('読み込み中は変えない', () => {
      const store = makeStore();
      store.setState({
        schema: { ...store.getState().schema, revertFrom: { version: 2, loading: true, error: null } },
      });
      selectRevertVersion(store, 1);
      expect(store.getState().schema.revertFrom.version).toBe(2);
    });
  });

  describe('startRevertFromVersion', () => {
    test('プロジェクト未選択・版未読込・読み込み中は何もしない', async () => {
      const { deps } = makeDeps();
      await startRevertFromVersion(makeStore(false), deps, 1);
      const unloaded = makeStore();
      await startRevertFromVersion(unloaded, deps, 1);
      const noVersions = makeStore();
      noVersions.setState({ schema: { ...noVersions.getState().schema, currentFields: latestFields } });
      await startRevertFromVersion(noVersions, deps, 1);
      const busy = makeStore();
      seedConfirmed(busy);
      busy.setState({ schema: { ...busy.getState().schema, revertFrom: { version: 1, loading: true, error: null } } });
      await startRevertFromVersion(busy, deps, 1);
      expect(getFieldsMock).not.toHaveBeenCalled();
      expect(busy.getState().schema.redraft).toBeNull();
    });

    test('最新版を選んだときは「新しい版を作る」と同じくエディタへ直行する', async () => {
      const store = makeStore();
      seedConfirmed(store);
      await startRevertFromVersion(store, makeDeps().deps, 3);
      const { schema } = store.getState();
      expect(getFieldsMock).not.toHaveBeenCalled();
      expect(schema.editorRows?.map((row) => row.fieldId)).toEqual(['f-keep', 'f-new']);
      expect(schema.editorParentVersion).toBeNull();
    });

    test('戻し元の版を読み込み、既定ですべて採用の差分承認画面を開く', async () => {
      const store = makeStore();
      seedConfirmed(store);
      getFieldsMock.mockResolvedValue(sourceFields);
      const { deps } = makeDeps();
      await startRevertFromVersion(store, deps, 1);
      expect(getFieldsMock).toHaveBeenCalledWith('sheet-1', 1, deps.google);
      const { schema } = store.getState();
      expect(schema.revertFrom).toEqual({ version: 1, loading: false, error: null });
      expect(schema.redraft?.revert).toEqual({ sourceVersion: 1, sourceFields });
      expect(schema.redraft?.selection).toEqual({
        added: { dropped_later: true },
        changed: {},
        removed: { added_later: true },
      });
    });

    test.each([
      ['「新しい版を作る」でエディタを開いた', (store: Store) => startEditorFromCurrent(store)],
      ['AI 再ドラフトが始まった', (store: Store) => store.setState({ schema: { ...store.getState().schema, drafting: true } })],
      ['別の差分承認画面が開いた', (store: Store) => {
        const diff = buildRedraftDiff(latestFields, []);
        store.setState({ schema: { ...store.getState().schema, redraft: { diff, selection: defaultRedraftSelection(diff) } } });
      }],
      ['新しい版が確定して最新版の項目が替わった', (store: Store) =>
        store.setState({ schema: { ...store.getState().schema, currentFields: [...latestFields] } })],
      ['プロジェクトを切り替えた', (store: Store) => store.setState({ currentProject: null })],
    ])('読み込み中に%sときは、結果を捨てて差分画面を出さない', async (_label, interrupt) => {
      const store = makeStore();
      seedConfirmed(store);
      let resolve: (fields: SchemaField[]) => void = () => undefined;
      getFieldsMock.mockReturnValue(new Promise((r) => { resolve = r; }));
      const pending = startRevertFromVersion(store, makeDeps().deps, 1);
      interrupt(store);
      const editorBefore = store.getState().schema.editorRows;
      const redraftBefore = store.getState().schema.redraft;
      resolve(sourceFields);
      await pending;
      const { schema } = store.getState();
      expect(schema.revertFrom).toEqual({ version: 1, loading: false, error: null });
      expect(schema.redraft).toBe(redraftBefore);
      expect(schema.editorRows).toBe(editorBefore);
      expect(schema.editorParentVersion).toBeNull();
    });

    test('戻し元の項目が 0 件・読み込み失敗はカードにエラーを出す', async () => {
      const store = makeStore();
      seedConfirmed(store);
      getFieldsMock.mockResolvedValue([]);
      await startRevertFromVersion(store, makeDeps().deps, 2);
      expect(store.getState().schema.revertFrom).toEqual({
        version: 2,
        loading: false,
        error: 'スキーマ v2 の項目が見つかりません。再読み込みしてください。',
      });
      getFieldsMock.mockRejectedValue(new Error('sheets down'));
      await startRevertFromVersion(store, makeDeps().deps, 1);
      expect(store.getState().schema.revertFrom).toEqual({ version: 1, loading: false, error: 'sheets down' });
      expect(store.getState().schema.redraft).toBeNull();
    });
  });

  describe('反映と確定', () => {
    async function openRevert(store: Store): Promise<void> {
      seedConfirmed(store);
      getFieldsMock.mockResolvedValue(sourceFields);
      await startRevertFromVersion(store, makeDeps().deps, 1);
    }

    test('反映すると戻し元の並び順でエディタを開き、確定時の派生元を戻し元にする', async () => {
      const store = makeStore();
      await openRevert(store);
      applyRedraft(store);
      const { schema } = store.getState();
      expect(schema.redraft).toBeNull();
      expect(schema.editorOrigin).toBe('user_edit');
      expect(schema.editorParentVersion).toBe(1);
      expect(schema.editorNoteDefault).toBe('v1 の内容に戻す');
      expect(schema.editorRows?.map((row) => row.fieldId)).toEqual(['f-gone', 'f-keep']);

      store.setState({ protocol: { ...store.getState().protocol, records: [makeProtocol({ version: 2 })] } });
      saveVersionMock.mockResolvedValue({ version: makeVersion(4, { parentVersion: 1 }), fields: sourceFields, outcomes: [] });
      await confirmSchema(store, makeDeps().deps, 'v1 の内容に戻す');
      expect(saveVersionMock).toHaveBeenCalledWith(
        expect.objectContaining({ parentVersion: 1, createdByType: 'user_edit', note: 'v1 の内容に戻す' }),
        expect.anything(),
      );
      expect(store.getState().schema.editorParentVersion).toBeNull();
      expect(store.getState().schema.editorNoteDefault).toBeNull();
    });

    test('エディタを閉じる・AI 再ドラフトを反映する・新しい版を作るでは派生元を最新版に戻す', async () => {
      const store = makeStore();
      await openRevert(store);
      applyRedraft(store);
      cancelEditor(store);
      expect(store.getState().schema.editorParentVersion).toBeNull();

      await openRevert(store);
      applyRedraft(store);
      startEditorFromCurrent(store);
      expect(store.getState().schema.editorParentVersion).toBeNull();

      store.setState({ schema: { ...store.getState().schema, editorParentVersion: 1 } });
      const diff = buildRedraftDiff(latestFields, [makeEditorRow({ fieldName: 'keep_me' })]);
      store.setState({
        schema: { ...store.getState().schema, redraft: { diff, selection: defaultRedraftSelection(diff) } },
      });
      applyRedraft(store);
      expect(store.getState().schema.editorParentVersion).toBeNull();
    });
  });
});

const schemaOutcome = (patch: Partial<SchemaOutcome> = {}): SchemaOutcome => ({
  schemaVersion: 1, aliases: [], outcomeIndex: 1, outcomeId: 'mortality', outcomeLabel: '全死亡',
  description: null, typicalTimepoints: '30d', addedVia: 'migration', note: null, ...patch,
});

function seedOutcomeEditor(store: Store): void {
  store.setState({ schema: {
    ...store.getState().schema, versions: [makeVersion(2), makeVersion(1)], currentFields: [makeField()],
    allOutcomes: [schemaOutcome(), schemaOutcome({ schemaVersion: 2, outcomeLabel: '最新版' }), schemaOutcome({ outcomeId: 'pain', outcomeLabel: '疼痛' })],
    currentOutcomes: [schemaOutcome({ schemaVersion: 2, outcomeLabel: '最新版' })],
  } });
  startEditorFromCurrent(store);
}

const outcomeDecision = (): Decision => ({
  studyId: 'study1', fieldId: 'f1', entityKey: 'outcome:mortality', annotator: 'a',
  annotatorType: 'human_with_ai', schemaVersion: 1, action: 'accept', value: '1', note: null,
  decidedAt: '2026-11-16T00:00:00Z', decidedBy: 'a',
});

function seedMigration(store: Store): void {
  const evidence = [migrationEvidence({ entityKey: 'outcome:pain' }), migrationEvidence({ entityKey: 'outcome:old' })];
  const decisions = [{ ...outcomeDecision(), entityKey: 'outcome:old' }];
  store.setState({ schema: { ...store.getState().schema, versions: [makeVersion(1)], currentFields: [makeField()], allOutcomes: [],
    outcomeMigration: { rows: buildOutcomeMigrationRows(evidence, decisions, []), evidence, decisions, confirmingExclusions: false } },
  verify: { ...store.getState().verify, targets: [] },
  protocol: { ...store.getState().protocol, records: [makeProtocol()] } });
}

test('移行候補の連鎖・自分への統合・未選択のまとめ先を防ぎ、選択解除で別名をほどく', () => {
  const store = makeStore();
  updateOutcomeMigration(store, 'none', {});
  seedMigration(store);
  addEditorOutcome(store);
  expect(store.getState().schema.editorOutcomes).toEqual([]);
  updateOutcomeMigration(store, 'old', { target: 'old' });
  updateOutcomeMigration(store, 'old', { target: 'missing' });
  updateOutcomeMigration(store, 'old', { target: 'pain' });
  updateOutcomeMigration(store, 'pain', { target: 'old' });
  expect(store.getState().schema.outcomeMigration!.rows.map((row) => row.target)).toEqual([null, 'pain']);
  updateOutcomeMigration(store, 'pain', { selected: false });
  expect(store.getState().schema.outcomeMigration!.rows[1]!.target).toBeNull();
  updateOutcomeMigration(store, 'old', { target: 'pain' });
  expect(store.getState().schema.outcomeMigration!.rows[1]!.target).toBeNull();
  store.setState({ schema: { ...store.getState().schema, confirming: true } });
  updateOutcomeMigration(store, 'old', { label: '変更しない' });
  expect(store.getState().schema.outcomeMigration!.rows[1]!.label).toBe('old');
});

test('移行は項目を保持し、除外の確認または別名の統合を経て最初の一覧を確定する', async () => {
  const store = makeStore();
  const { deps } = makeDeps();
  await confirmOutcomeMigration(store, deps);
  seedMigration(store);
  updateOutcomeMigration(store, 'pain', { selected: false });
  updateOutcomeMigration(store, 'old', { selected: false });
  await confirmOutcomeMigration(store, deps);
  expect(store.getState().schema.editorOutcomeErrors.length).toBeGreaterThan(0);
  updateOutcomeMigration(store, 'pain', { selected: true });
  await confirmOutcomeMigration(store, deps);
  expect(store.getState().schema.outcomeMigration!.confirmingExclusions).toBe(true);
  saveVersionMock.mockResolvedValue({ version: makeVersion(2), fields: [makeField()], outcomes: [schemaOutcome({ outcomeId: 'pain' })] });
  await confirmOutcomeMigration(store, deps, true);
  expect(saveVersionMock).toHaveBeenCalledWith(expect.objectContaining({ note: 'アウトカムの一覧を作成（移行）', createdByType: 'user_edit',
    outcomes: [expect.objectContaining({ outcomeId: 'pain', addedVia: 'migration', aliases: [] })] }), expect.anything());
  expect(store.getState().schema.outcomeMigration).toBeNull();
  expect(store.getState().verify.targets).toBeNull();
  expect(store.getState().export.built).toBeNull();
  seedMigration(store);
  updateOutcomeMigration(store, 'old', { target: 'pain' });
  store.setState({ schema: { ...store.getState().schema, allOutcomes: null, versions: null } });
  await confirmOutcomeMigration(store, deps);
  expect(saveVersionMock).toHaveBeenLastCalledWith(expect.objectContaining({ outcomes: [expect.objectContaining({ outcomeId: 'pain', aliases: ['old'] })] }), expect.anything());
  seedMigration(store);
  saveVersionMock.mockRejectedValueOnce(new Error('保存失敗'));
  await confirmOutcomeMigration(store, deps);
  expect(store.getState().schema.outcomeMigration).not.toBeNull();
  expect(store.getState().verify.targets).toEqual([]);
});

test('移行の確定は項目なし・確定中・一覧作成済みでは何もしない', async () => {
  const store = makeStore();
  const { deps } = makeDeps();
  seedMigration(store);
  const schema = store.getState().schema;
  for (const patch of [{ currentFields: null }, { confirming: true }, { allOutcomes: [schemaOutcome()] }]) {
    store.setState({ schema: { ...schema, ...patch } });
    await confirmOutcomeMigration(store, deps);
  }
  expect(saveVersionMock).not.toHaveBeenCalled();
});

test('論文単位モードの既存キーから移行候補を読み込む', async () => {
  listVersionsMock.mockResolvedValue([makeVersion(1)]);
  getFieldsMock.mockResolvedValue([makeField({ fieldName: 'outcome_name' })]);
  jest.mocked(readEvidenceRows).mockResolvedValue([migrationEvidence({ entityKey: 'outcome:pain', value: '痛み' })]);
  const store = makeStore();
  await loadSchema(store, makeDeps().deps);
  expect(store.getState().schema.outcomeMigration?.rows[0]).toMatchObject({ id: 'pain', label: '痛み' });
});

test('一覧を読み込み、欠けた最新版では前版の一覧と参照元を保持する', async () => {
  const store = makeStore();
  listVersionsMock.mockResolvedValue([makeVersion(2), makeVersion(1)]);
  getFieldsMock.mockResolvedValue([makeField()]);
  jest.mocked(readAllSchemaOutcomes).mockResolvedValue([schemaOutcome()]);
  await loadSchema(store, makeDeps().deps);
  expect(store.getState().schema).toMatchObject({ allOutcomes: [schemaOutcome()], currentOutcomes: [schemaOutcome()], currentOutcomesSourceVersion: 1 });
});

test('一覧なしの版をキャッシュした後に抽出すると、S5 の再表示で移行候補を読み直す', async () => {
  const store = makeStore();
  const deps = makeDeps().deps;
  listVersionsMock.mockResolvedValue([makeVersion(1)]);
  getFieldsMock.mockResolvedValue([makeField()]);
  await loadSchema(store, deps);
  expect(store.getState().schema.outcomeMigration).toBeNull();
  jest.mocked(readEvidenceRows).mockResolvedValue([migrationEvidence({ entityKey: 'outcome:pain' })]);
  store.setState({ schema: { ...store.getState().schema, migrationStale: true } });
  await loadSchema(store, deps);
  expect(store.getState().schema.outcomeMigration?.rows).toEqual([expect.objectContaining({ id: 'pain' })]);
  expect(store.getState().schema.migrationStale).toBe(false);
  expect(listVersionsMock).toHaveBeenCalledTimes(1);
  expect(getFieldsMock).toHaveBeenCalledTimes(1);
  expect(jest.mocked(readAllSchemaOutcomes)).toHaveBeenCalledTimes(1);
  await loadSchema(store, deps);
  expect(jest.mocked(readEvidenceRows)).toHaveBeenCalledTimes(2);
  expect(jest.mocked(readAllDecisions)).toHaveBeenCalledTimes(2);
  startEditorFromCurrent(store);
  addEditorOutcome(store);
  expect(store.getState().schema.editorOutcomes).toEqual([]);
  jest.mocked(readEvidenceRows).mockRejectedValueOnce(new Error('offline'));
  store.setState({ schema: { ...store.getState().schema, migrationStale: true } });
  await loadSchema(store, deps);
  expect(store.getState().schema.loadError).toBe('offline');
  expect(store.getState().schema.migrationStale).toBe(true);
});

test('キャッシュに一覧と項目が未設定でも移行素材を読み込める', async () => {
  const store = makeStore();
  store.setState({ schema: { ...store.getState().schema, versions: [makeVersion(1)], migrationStale: true } });
  await loadSchema(store, makeDeps().deps);
  expect(store.getState().schema.currentFields).toBeNull();
  expect(store.getState().schema.allOutcomes).toBeNull();
  expect(store.getState().schema.migrationStale).toBe(false);
});

test('復元候補と新規入力で再利用した id は最後の版の別名を引き継ぐ', () => {
  const store = makeStore();
  seedOutcomeEditor(store);
  store.setState({ schema: { ...store.getState().schema, allOutcomes: [
    schemaOutcome({ outcomeId: 'pain', aliases: ['old_pain'] }),
    schemaOutcome({ schemaVersion: 2, outcomeId: 'pain', aliases: ['legacy_pain'] }),
  ] } });
  restoreEditorOutcome(store, 'pain');
  expect(store.getState().schema.editorOutcomes[1]?.aliases).toEqual(['legacy_pain']);
  addEditorOutcome(store);
  updateEditorOutcome(store, 2, { outcomeId: ' pain ' });
  expect(store.getState().schema.editorOutcomes[2]?.aliases).toEqual(['legacy_pain']);
  updateEditorOutcome(store, 2, { outcomeId: 'fresh' });
  expect(store.getState().schema.editorOutcomes[2]?.aliases).toEqual([]);
});

test.each(['row', 'replacement'] as const)('別名側だけの判定も削除確認に含める: %s', async (mode) => {
  const store = makeStore();
  seedOutcomeEditor(store);
  const current = schemaOutcome({ schemaVersion: 2, aliases: ['old'] });
  store.setState({ schema: { ...store.getState().schema, allOutcomes: [current], currentOutcomes: [current] } });
  startEditorFromCurrent(store);
  jest.mocked(readAllDecisions).mockResolvedValue([{ ...outcomeDecision(), entityKey: 'outcome:old' }]);
  if (mode === 'row') {
    await requestRemoveEditorOutcome(store, makeDeps().deps, 0);
    expect(store.getState().schema.outcomeRemoval?.counts).toEqual({ cells: 1, studies: 1 });
  } else {
    store.setState({ schema: { ...store.getState().schema, editorOutcomes: [{
      ...store.getState().schema.editorOutcomes[0]!, outcomeId: 'pain', aliases: [],
    }] } });
    await confirmSchema(store, makeDeps().deps, '');
    expect(store.getState().schema.pendingOutcomeRemovals?.items).toEqual([
      expect.objectContaining({ outcomeId: 'mortality', cells: 1, studies: 1 }),
    ]);
  }
  expect(saveVersionMock).not.toHaveBeenCalled();
});

test.each(['row', 'replacement'] as const)('一覧の履歴が未読込でも判定済みアウトカムの削除を確認する: %s', async (mode) => {
  const store = makeStore();
  seedOutcomeEditor(store);
  store.setState({ schema: { ...store.getState().schema, allOutcomes: null, versions: null } });
  jest.mocked(readAllDecisions).mockResolvedValue([outcomeDecision()]);
  if (mode === 'row') {
    await requestRemoveEditorOutcome(store, makeDeps().deps, 0);
    expect(store.getState().schema.outcomeRemoval?.counts).toEqual({ cells: 1, studies: 1 });
    store.setState({ schema: { ...store.getState().schema, versions: [] } });
    await requestRemoveEditorOutcome(store, makeDeps().deps, 0);
    expect(store.getState().schema.outcomeRemoval?.counts).toEqual({ cells: 1, studies: 1 });
  } else {
    store.setState({ schema: { ...store.getState().schema, editorOutcomes: [] } });
    await confirmSchema(store, makeDeps().deps, '');
    expect(store.getState().schema.pendingOutcomeRemovals?.items).toEqual([
      expect.objectContaining({ outcomeId: 'mortality', cells: 1, studies: 1 }),
    ]);
  }
  expect(saveVersionMock).not.toHaveBeenCalled();
});

test('新しい版は id を固定して一覧を引き継ぎ、未編集の id だけを名称から更新する', () => {
  const store = makeStore();
  seedOutcomeEditor(store);
  expect(store.getState().schema.editorOutcomes[0]).toMatchObject({ outcomeLabel: '最新版', idLocked: true });
  updateEditorOutcome(store, 0, { outcomeId: 'changed', outcomeLabel: '新名称' });
  expect(store.getState().schema.editorOutcomes[0]).toMatchObject({ outcomeId: 'mortality', outcomeLabel: '新名称' });
  addEditorOutcome(store);
  updateEditorOutcome(store, 1, { outcomeLabel: 'New Pain' });
  expect(store.getState().schema.editorOutcomes[1]?.outcomeId).toBe('new_pain');
  updateEditorOutcome(store, 1, { outcomeId: 'custom' });
  updateEditorOutcome(store, 1, { outcomeLabel: '別名' });
  expect(store.getState().schema.editorOutcomes[1]?.outcomeId).toBe('custom');
  moveEditorOutcome(store, 1, 0);
  expect(store.getState().schema.editorOutcomes.map((row) => row.outcomeId)).toEqual(['custom', 'mortality']);
  for (const [from, to] of [[-1, 0], [0, -1], [5, 0], [0, 5], [0, 0]]) {
    moveEditorOutcome(store, from!, to!);
  }
  restoreEditorOutcome(store, 'pain');
  restoreEditorOutcome(store, 'pain');
  restoreEditorOutcome(store, 'missing');
  expect(store.getState().schema.editorOutcomes).toHaveLength(3);
  expect(store.getState().schema.editorOutcomes[2]).toMatchObject({ outcomeId: 'pain', outcomeLabel: '疼痛', idLocked: true });
  cancelEditor(store);
  addEditorOutcome(store);
  updateEditorOutcome(store, 0, { outcomeLabel: '無効' });
  moveEditorOutcome(store, 0, 1);
  restoreEditorOutcome(store, 'pain');
  expect(store.getState().schema).toMatchObject({ editorOutcomes: [], outcomeRemoval: null, outcomeDecisions: null });
});

test('再ドラフトは現行一覧を、復帰は戻し元の版の一覧を使う', async () => {
  const store = makeStore();
  seedOutcomeEditor(store);
  cancelEditor(store);
  const fields = store.getState().schema.currentFields!;
  store.setState({ schema: { ...store.getState().schema, redraft: {
    diff: buildRedraftDiff(fields, [makeEditorRow()]), selection: { added: {}, changed: {}, removed: {} },
  } } });
  applyRedraft(store);
  expect(store.getState().schema.editorOutcomes[0]).toMatchObject({ outcomeLabel: '最新版', idLocked: true });
  cancelEditor(store);
  getFieldsMock.mockResolvedValue([makeField()]);
  await startRevertFromVersion(store, makeDeps().deps, 1);
  applyRedraft(store);
  expect(store.getState().schema.editorOutcomes.map((row) => row.outcomeId)).toEqual(['mortality', 'pain']);
  expect(store.getState().schema.editorOutcomes[0]?.outcomeLabel).toBe('全死亡');
});

test.each([false, true])('一覧モードで一覧の無い版へ戻すと現行一覧を引き継ぐ（現行一覧未読込: %s）', async (unloaded) => {
  const store = makeStore();
  seedOutcomeEditor(store);
  cancelEditor(store);
  const current = schemaOutcome({ schemaVersion: 2, outcomeLabel: '最新版' });
  store.setState({ schema: {
    ...store.getState().schema,
    allOutcomes: [current],
    currentOutcomes: unloaded ? null : [current],
  } });
  getFieldsMock.mockResolvedValue([makeField()]);
  await startRevertFromVersion(store, makeDeps().deps, 1);
  applyRedraft(store);
  expect(store.getState().schema.editorOutcomes).toEqual(unloaded ? [] : [{
    aliases: [], outcomeId: 'mortality', outcomeLabel: '最新版', description: null, typicalTimepoints: '30d',
    addedVia: 'migration', note: null, idLocked: true, idEdited: false,
  }]);
});

test('全版の一覧が null でも過去の版への反映は空一覧で開く', async () => {
  const store = makeStore();
  seedOutcomeEditor(store);
  cancelEditor(store);
  store.setState({ schema: { ...store.getState().schema, allOutcomes: null } });
  getFieldsMock.mockResolvedValue([makeField()]);
  await startRevertFromVersion(store, makeDeps().deps, 1);
  // 版の一覧が反映の前に消えても（再読み込みの途中など）空一覧で開く
  store.setState({ schema: { ...store.getState().schema, versions: null } });
  applyRedraft(store);
  expect(store.getState().schema.editorOutcomes).toEqual([]);
  expect(store.getState().schema.editorParentVersion).toBe(1);
});

test('全版の一覧が null でも編集でき、復元候補は無い', () => {
  const store = makeStore();
  seedOutcomeEditor(store);
  store.setState({ schema: { ...store.getState().schema, allOutcomes: null } });
  addEditorOutcome(store);
  expect(store.getState().schema.editorOutcomes).toHaveLength(2);
  expect(store.getState().schema.editorOutcomeErrors).toHaveLength(1);
  restoreEditorOutcome(store, 'pain');
  expect(store.getState().schema.editorOutcomes).toHaveLength(2);
});

test('未確定の行は即時に外し、判定ゼロの確定行も確認せず外す', async () => {
  const store = makeStore();
  seedOutcomeEditor(store);
  addEditorOutcome(store);
  await requestRemoveEditorOutcome(store, makeDeps().deps, 1);
  expect(readAllDecisions).not.toHaveBeenCalled();
  expect(store.getState().schema.editorOutcomes).toHaveLength(1);
  await requestRemoveEditorOutcome(store, makeDeps().deps, 0);
  expect(store.getState().schema.editorOutcomes).toEqual([]);
  expect(store.getState().schema.editorOutcomeErrors[0]?.message).toBe('アウトカムの一覧は 1 件以上必要です（一覧を作った後は空にできません）');
  restoreEditorOutcome(store, 'mortality');
  await requestRemoveEditorOutcome(store, makeDeps().deps, 0);
  expect(readAllDecisions).toHaveBeenCalledTimes(1);
});

test('判定ありは件数を出して待ち、キャンセルしても再読込せず確認後に外す', async () => {
  const store = makeStore();
  seedOutcomeEditor(store);
  jest.mocked(readAllDecisions).mockResolvedValue([outcomeDecision()]);
  confirmRemoveEditorOutcome(store);
  await requestRemoveEditorOutcome(store, makeDeps().deps, 0);
  expect(store.getState().schema.outcomeRemoval).toMatchObject({ counts: { cells: 1, studies: 1 }, loading: false });
  expect(store.getState().schema.editorOutcomes).toHaveLength(1);
  cancelRemoveEditorOutcome(store);
  await requestRemoveEditorOutcome(store, makeDeps().deps, 0);
  expect(readAllDecisions).toHaveBeenCalledTimes(1);
  confirmRemoveEditorOutcome(store);
  expect(store.getState().schema.editorOutcomes).toEqual([]);
});

test('読み込み失敗では外さず、再試行できる', async () => {
  const store = makeStore();
  seedOutcomeEditor(store);
  jest.mocked(readAllDecisions).mockRejectedValueOnce(new Error('offline'));
  await requestRemoveEditorOutcome(store, makeDeps().deps, 0);
  expect(store.getState().schema.editorOutcomes).toHaveLength(1);
  expect(store.getState().schema.outcomeRemoval?.error).toBe('offline');
  await requestRemoveEditorOutcome(store, makeDeps().deps, 0);
  expect(store.getState().schema.editorOutcomes).toEqual([]);
});

test.each(['close', 'other', 'project', 'reject'] as const)('遅れて返る削除件数を捨てる: %s', async (kind) => {
  const store = makeStore();
  seedOutcomeEditor(store);
  restoreEditorOutcome(store, 'pain');
  let resolve!: (value: Decision[]) => void;
  let reject!: (reason: Error) => void;
  jest.mocked(readAllDecisions).mockReturnValueOnce(new Promise((res, rej) => {
    resolve = res;
    reject = rej;
  }));
  const pending = requestRemoveEditorOutcome(store, makeDeps().deps, 0);
  if (kind === 'close' || kind === 'reject') {
    cancelEditor(store);
  } else if (kind === 'other') {
    await requestRemoveEditorOutcome(store, makeDeps().deps, 1);
  } else {
    store.setState({ currentProject: null });
  }
  if (kind === 'reject') {
    reject(new Error('late'));
  } else {
    resolve([outcomeDecision()]);
  }
  await pending;
  expect(store.getState().schema.outcomeDecisions).not.toEqual([outcomeDecision()]);
});

test('閉じたエディタ・無効な行・未選択プロジェクトでは削除しない', async () => {
  const store = makeStore();
  await requestRemoveEditorOutcome(store, makeDeps().deps, 0);
  await requestRemoveEditorOutcome(makeStore(false), makeDeps().deps, 0);
  seedOutcomeEditor(store);
  updateEditorOutcome(store, 99, {});
  await requestRemoveEditorOutcome(store, makeDeps().deps, 99);
  expect(readAllDecisions).not.toHaveBeenCalled();
});

test('一覧の検証エラーは確定を止め、成功した一覧を全版の行に追加して編集状態を閉じる', async () => {
  const store = makeStore();
  seedOutcomeEditor(store);
  updateEditorOutcome(store, 0, { outcomeLabel: '' });
  await confirmSchema(store, makeDeps().deps, '');
  expect(saveVersionMock).not.toHaveBeenCalled();
  expect(store.getState().schema.editorOutcomeErrors).toHaveLength(1);
  updateEditorOutcome(store, 0, { outcomeLabel: '新名称' });
  store.setState({ protocol: { ...store.getState().protocol, records: [makeProtocol()] } });
  const saved = schemaOutcome({ schemaVersion: 3, outcomeLabel: '新名称' });
  saveVersionMock.mockResolvedValue({ version: makeVersion(3), fields: [makeField()], outcomes: [saved] });
  await confirmSchema(store, makeDeps().deps, '');
  expect(saveVersionMock).toHaveBeenCalledWith(expect.objectContaining({ outcomes: [expect.objectContaining({ outcomeId: 'mortality' })], listModeBefore: true }), expect.anything());
  expect(store.getState().schema).toMatchObject({ currentOutcomes: [saved], currentOutcomesSourceVersion: 3, editorOutcomes: [], outcomeDecisions: null, outcomeRemoval: null });
  expect(store.getState().schema.allOutcomes).toHaveLength(4);
});

test('ファイルの既存 id を固定し、一覧が無いファイルは現行一覧を引き継ぐ', () => {
  const store = makeStore();
  seedOutcomeEditor(store);
  const schema = store.getState().schema;
  expect(importedOutcomeRows(schema, null)[0]).toMatchObject({ outcomeId: 'mortality', idLocked: true });
  expect(importedOutcomeRows(schema, schema.editorOutcomes)[0]).toMatchObject({ addedVia: 'file_import', idLocked: true });
  const initial = createInitialState().schema;
  expect(importedOutcomeRows(initial, null)).toEqual([]);
  expect(importedOutcomeRows(initial, schema.editorOutcomes)[0]?.idLocked).toBe(false);
});

async function importReplacementOutcomes(store: Store): Promise<void> {
  seedOutcomeEditor(store);
  cancelEditor(store);
  const text = serializeSchemaExport([makeField()], {
    projectName: '別の SR', schemaVersion: 1, exportedAt: '2026-11-16T00:00:00Z',
    exportedBy: 'a', extractPromptVersion: 14, appVersion: '0.1.0',
  }, [schemaOutcome({ outcomeId: 'pain', outcomeLabel: '疼痛' })]);
  await importSchemaFile(store, {
    name: 'schema.json', size: text.length, text: async () => text,
    arrayBuffer: async () => new ArrayBuffer(0),
  });
  applyRedraft(store);
  expect(store.getState().schema.editorOutcomes.map((row) => row.outcomeId)).toEqual(['pain']);
}

function mockOutcomeSave(): void {
  saveVersionMock.mockResolvedValue({ version: makeVersion(3), fields: [makeField()], outcomes: [schemaOutcome({ schemaVersion: 3, outcomeId: 'pain' })] });
  jest.mocked(listProtocols).mockResolvedValue([makeProtocol()]);
}

test('JSON の読み込みで消える判定済みアウトカムは確定前に確認し、承認で改訂理由を保って保存する', async () => {
  const store = makeStore();
  await importReplacementOutcomes(store);
  mockOutcomeSave();
  jest.mocked(readAllDecisions).mockResolvedValue([outcomeDecision()]);
  await confirmSchema(store, makeDeps().deps, '一覧を見直す');
  expect(saveVersionMock).not.toHaveBeenCalled();
  expect(store.getState().schema.pendingOutcomeRemovals).toEqual({
    loading: false, error: null,
    items: [{ outcomeId: 'mortality', outcomeLabel: '最新版', cells: 1, studies: 1 }],
  });
  expect(store.getState().schema.editorNoteDefault).toBe('一覧を見直す');
  await confirmSchema(store, makeDeps().deps, '一覧を見直す', true);
  expect(saveVersionMock).toHaveBeenCalledWith(expect.objectContaining({ note: '一覧を見直す' }), expect.anything());
  expect(readAllDecisions).toHaveBeenCalledTimes(1);
  expect(store.getState().schema).toMatchObject({ acknowledgedRemovedOutcomeIds: [], pendingOutcomeRemovals: null });
});

test('確定前の削除確認をやめてもエディタの一覧は変えず保存しない', async () => {
  const store = makeStore();
  await importReplacementOutcomes(store);
  jest.mocked(readAllDecisions).mockResolvedValue([outcomeDecision()]);
  await confirmSchema(store, makeDeps().deps, '');
  const rows = store.getState().schema.editorOutcomes;
  cancelRemoveEditorOutcome(store);
  expect(store.getState().schema.pendingOutcomeRemovals).toBeNull();
  expect(store.getState().schema.editorOutcomes).toBe(rows);
  expect(saveVersionMock).not.toHaveBeenCalled();
});

test('一覧の置き換えで消えるアウトカムの判定がゼロなら確認なしで保存する', async () => {
  const store = makeStore();
  await importReplacementOutcomes(store);
  mockOutcomeSave();
  await confirmSchema(store, makeDeps().deps, '');
  expect(saveVersionMock).toHaveBeenCalledTimes(1);
  expect(store.getState().schema.pendingOutcomeRemovals).toBeNull();
});

test.each([false, true])('行の外すで確認済みの id は確定前に聞き直さない（判定あり=%s）', async (judged) => {
  const store = makeStore();
  seedOutcomeEditor(store);
  restoreEditorOutcome(store, 'pain');
  mockOutcomeSave();
  jest.mocked(readAllDecisions).mockResolvedValue(judged ? [outcomeDecision()] : []);
  await requestRemoveEditorOutcome(store, makeDeps().deps, 0);
  if (judged) {
    confirmRemoveEditorOutcome(store);
  }
  expect(store.getState().schema.acknowledgedRemovedOutcomeIds).toContain('mortality');
  await confirmSchema(store, makeDeps().deps, '');
  expect(saveVersionMock).toHaveBeenCalledTimes(1);
  expect(readAllDecisions).toHaveBeenCalledTimes(1);
});

test('確定前の Decisions 読み込み失敗では保存せず、もう一度確認できる', async () => {
  const store = makeStore();
  await importReplacementOutcomes(store);
  jest.mocked(readAllDecisions).mockRejectedValueOnce(new Error('offline')).mockResolvedValueOnce([outcomeDecision()]);
  await confirmSchema(store, makeDeps().deps, '');
  expect(store.getState().schema.pendingOutcomeRemovals).toEqual({ loading: false, error: 'offline', items: [] });
  expect(saveVersionMock).not.toHaveBeenCalled();
  await confirmSchema(store, makeDeps().deps, '');
  expect(store.getState().schema.pendingOutcomeRemovals?.items).toHaveLength(1);
  expect(saveVersionMock).not.toHaveBeenCalled();
});

test.each(['add', 'edit', 'move', 'restore', 'remove'] as const)('確定前の確認中に一覧を操作すると確認を消す: %s', async (operation) => {
  const store = makeStore();
  await importReplacementOutcomes(store);
  addEditorOutcome(store);
  updateEditorOutcome(store, 1, { outcomeLabel: '新しいアウトカム' });
  jest.mocked(readAllDecisions).mockResolvedValue([outcomeDecision()]);
  await confirmSchema(store, makeDeps().deps, '');
  expect(store.getState().schema.pendingOutcomeRemovals?.items).toHaveLength(1);
  switch (operation) {
    case 'add':
      addEditorOutcome(store);
      break;
    case 'edit':
      updateEditorOutcome(store, 0, { outcomeLabel: '変更' });
      break;
    case 'move':
      moveEditorOutcome(store, 0, 1);
      break;
    case 'restore':
      restoreEditorOutcome(store, 'mortality');
      break;
    case 'remove':
      await requestRemoveEditorOutcome(store, makeDeps().deps, 1);
      break;
  }
  expect(store.getState().schema.pendingOutcomeRemovals).toBeNull();
  expect(saveVersionMock).not.toHaveBeenCalled();
});

test.each(['edit', 'cancel', 'close', 'project', 'failure'] as const)('確定前の読み込み中の操作や遅い応答で保存しない: %s', async (operation) => {
  const store = makeStore();
  await importReplacementOutcomes(store);
  let resolve!: (value: Decision[]) => void;
  let reject!: (reason: Error) => void;
  jest.mocked(readAllDecisions).mockReturnValueOnce(new Promise((res, rej) => {
    resolve = res;
    reject = rej;
  }));
  const task = confirmSchema(store, makeDeps().deps, '');
  expect(store.getState().schema.pendingOutcomeRemovals?.loading).toBe(true);
  await confirmSchema(store, makeDeps().deps, '');
  expect(readAllDecisions).toHaveBeenCalledTimes(1);
  if (operation === 'edit') {
    updateEditorOutcome(store, 0, { outcomeLabel: '変更' });
  } else if (operation === 'close') {
    cancelEditor(store);
  } else if (operation === 'project') {
    store.setState({ currentProject: null });
  } else {
    cancelRemoveEditorOutcome(store);
  }
  if (operation === 'failure') {
    reject(new Error('遅い失敗'));
  } else {
    resolve([outcomeDecision()]);
  }
  await task;
  expect(saveVersionMock).not.toHaveBeenCalled();
});

test('前の版の一覧へ戻す場合も現行版から消える判定済みアウトカムを確認する', async () => {
  const store = makeStore();
  seedOutcomeEditor(store);
  cancelEditor(store);
  store.setState({ schema: {
    ...store.getState().schema,
    allOutcomes: [schemaOutcome({ schemaVersion: 2 }), schemaOutcome({ outcomeId: 'pain', outcomeLabel: '疼痛' })],
  } });
  getFieldsMock.mockResolvedValue([makeField()]);
  await startRevertFromVersion(store, makeDeps().deps, 1);
  applyRedraft(store);
  jest.mocked(readAllDecisions).mockResolvedValue([outcomeDecision()]);
  await confirmSchema(store, makeDeps().deps, '旧版へ戻す');
  expect(store.getState().schema.pendingOutcomeRemovals?.items).toEqual([
    { outcomeId: 'mortality', outcomeLabel: '最新版', cells: 1, studies: 1 },
  ]);
  expect(saveVersionMock).not.toHaveBeenCalled();
});

test('読み込み済み Decisions を使い、判定ゼロの id だけを自動確認済みにする', async () => {
  const store = makeStore();
  await importReplacementOutcomes(store);
  store.setState({ schema: {
    ...store.getState().schema,
    currentOutcomes: [...store.getState().schema.currentOutcomes!, schemaOutcome({ outcomeId: 'sleep', outcomeLabel: '睡眠' })],
    outcomeDecisions: [outcomeDecision()],
  } });
  await confirmSchema(store, makeDeps().deps, '');
  expect(readAllDecisions).not.toHaveBeenCalled();
  expect(store.getState().schema.acknowledgedRemovedOutcomeIds).toEqual(['sleep']);
  expect(store.getState().schema.pendingOutcomeRemovals?.items.map((item) => item.outcomeId)).toEqual(['mortality']);
});

test('二重の確定操作は保存を一度だけ実行する', async () => {
  const store = makeStore();
  seedOutcomeEditor(store);
  mockOutcomeSave();
  const { deps } = makeDeps();
  await Promise.all([confirmSchema(store, deps, ''), confirmSchema(store, deps, '')]);
  expect(saveVersionMock).toHaveBeenCalledTimes(1);
});


test.each([false, true])('版の確定成功時だけ依存キャッシュと PDF を破棄する（一覧の削除: %s）', async (removeOutcome) => {
  const store = makeStore();
  store.setState({
    protocol: { ...store.getState().protocol, records: [makeProtocol()] },
    schema: { ...store.getState().schema, versions: [makeVersion(1)], editorRows: [makeEditorRow()] },
  });
  if (removeOutcome) {
    seedOutcomeEditor(store);
    store.setState({ schema: { ...store.getState().schema,
      editorOutcomes: store.getState().schema.editorOutcomes.map((row) => ({ ...row, outcomeId: 'pain' })),
      acknowledgedRemovedOutcomeIds: ['mortality'],
    } });
  }
  type State = ReturnType<typeof store.getState>;
  const state = store.getState();
  const verifyDispose = jest.fn();
  const pilotDispose = jest.fn();
  const adjudicateDispose = jest.fn();
  store.setState({
    verify: { ...state.verify, targets: [], selectedStudyId: 'study-1',
      verification: { disposePdf: verifyDispose } as unknown as State['verify']['verification'] },
    pilot: { ...state.pilot, verification: { disposePdf: pilotDispose } as unknown as State['pilot']['verification'] },
    dashboard: { ...state.dashboard, data: {} as NonNullable<State['dashboard']['data']> },
    export: { ...state.export, built: {} as NonNullable<State['export']['built']> },
    adjudicate: { ...state.adjudicate, rows: [], outcomeList: null,
      working: { disposePdf: adjudicateDispose } as unknown as State['adjudicate']['working'] },
    home: { ...state.home, assignedProgress: {} as NonNullable<State['home']['assignedProgress']> },
  });
  const cached = store.getState();
  saveVersionMock.mockRejectedValueOnce(new Error('保存失敗'));
  await confirmSchema(store, makeDeps().deps, '');
  for (const key of ['verify', 'pilot', 'dashboard', 'export', 'adjudicate', 'home'] as const) {
    expect(store.getState()[key]).toBe(cached[key]);
  }
  for (const dispose of [verifyDispose, pilotDispose, adjudicateDispose]) {
    expect(dispose).not.toHaveBeenCalled();
  }
  saveVersionMock.mockResolvedValue({ version: makeVersion(3), fields: [makeField()],
    outcomes: removeOutcome ? [schemaOutcome({ outcomeId: 'pain' })] : [] });
  await confirmSchema(store, makeDeps().deps, '');
  expect(store.getState().schema.editorRows).toBeNull();
  expect(store.getState().verify).toMatchObject({ verification: null, targets: null, selectedStudyId: null });
  expect(store.getState().pilot.verification).toBeNull();
  expect(store.getState().dashboard.data).toBeNull();
  expect(store.getState().export.built).toBeNull();
  expect(store.getState().adjudicate.rows).toBeNull();
  expect(store.getState().adjudicate.outcomeList).toBeUndefined();
  expect(store.getState().home.assignedProgress).toBeNull();
  for (const dispose of [verifyDispose, pilotDispose, adjudicateDispose]) {
    expect(dispose).toHaveBeenCalledTimes(1);
  }
});

test('移行成功時だけパイロットの検証・一覧・マトリクスを破棄する', async () => {
  const store = makeStore();
  seedMigration(store);
  const disposePdf = jest.fn();
  const verification = { disposePdf } as unknown as NonNullable<ReturnType<typeof store.getState>['pilot']['verification']>;
  const matrix = { ...emptyPilotMatrix(), runId: 'cached' };
  store.setState({ pilot: { ...store.getState().pilot, verification, verifyStudyId: 'study-1',
    outcomeList: null, matrix, historyInitialized: true,
    run: { runId: 'cached' } as NonNullable<ReturnType<typeof store.getState>['pilot']['run']>,
    runFields: [makeField()], evidence: [] } });
  saveVersionMock.mockRejectedValueOnce(new Error('保存失敗'));
  await confirmOutcomeMigration(store, makeDeps().deps);
  expect(store.getState().pilot.verification).toBe(verification);
  expect(store.getState().pilot.matrix).toBe(matrix);
  expect(disposePdf).not.toHaveBeenCalled();
  saveVersionMock.mockResolvedValue({ version: makeVersion(2), fields: [makeField()], outcomes: [schemaOutcome()] });
  await confirmOutcomeMigration(store, makeDeps().deps);
  expect(store.getState().pilot.verification).toBeNull();
  expect(store.getState().pilot.verifyStudyId).toBeNull();
  expect(store.getState().pilot.outcomeList).toBeUndefined();
  expect(store.getState().pilot.matrix).toBeUndefined();
  expect(store.getState().pilot.run).toBeNull();
  expect(store.getState().pilot.runFields).toBeNull();
  expect(store.getState().pilot.evidence).toBeNull();
  expect(store.getState().pilot.historyInitialized).toBe(false);
  expect(disposePdf).toHaveBeenCalledTimes(1);
});
