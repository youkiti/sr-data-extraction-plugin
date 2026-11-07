import {
  applyEnumSuggestion, cancelEnumSuggestion, suggestEnum, updateEnumSuggestion,
} from '../../../../src/app/services/schemaEnumService';
import { emptyEditorRow, updateEditorRow, moveEditorRow } from '../../../../src/app/services/schemaService';
import type { SchemaServiceDeps } from '../../../../src/app/services/schemaService';
import { createInitialState, createStore } from '../../../../src/app/store';
import type { Evidence } from '../../../../src/domain/evidence';
import { ensureChildFolder, uploadTextFile } from '../../../../src/lib/google/drive';
import { appendLlmApiLog } from '../../../../src/lib/llm/apiLogRepository';
import { FACTORY_DEFAULT_MODEL, loadDefaultModel } from '../../../../src/lib/storage/settingsStore';
import { UNLIMITED_POLICY } from '../../../../src/lib/llm/rateLimitPolicy';
import type { LLMProvider } from '../../../../src/lib/llm/LLMProvider';

jest.mock('../../../../src/lib/google/drive', () => ({
  ensureChildFolder: jest.fn(async (name: string) => ({ id: name })),
  uploadTextFile: jest.fn(async ({ name }: { name: string }) => ({ webViewLink: 'https://drive.test/' + name })),
}));
jest.mock('../../../../src/lib/llm/apiLogRepository', () => ({ appendLlmApiLog: jest.fn() }));
jest.mock('../../../../src/lib/storage/settingsStore', () => ({
  ...jest.requireActual('../../../../src/lib/storage/settingsStore'),
  loadDefaultModel: jest.fn(async () => null),
}));
function setup() {
  const initial = createInitialState();
  const row = { ...emptyEditorRow(), fieldId: 'field', fieldLabel: '方法',
    fieldName: 'method', extractionInstruction: 'Report method', maxQuotes: 10 };
  initial.schema.editorRows = [row];
  initial.currentProject = { projectId: 'project', spreadsheetId: 'sheet', driveFolderId: 'folder',
    name: '例' };
  const store = createStore(initial);
  const chat = jest.fn<ReturnType<LLMProvider['chat']>, Parameters<LLMProvider['chat']>>(async () => ({
    text: '{"allowed_values":["interview","unclear","other"]}', tokensIn: 100, tokensOut: 20,
    cachedTokensIn: 0, raw: { text: '保存する応答全文' },
  }));
  const buildProvider = jest.fn((config) => ({ model: config.model, providerId: 'gemini' as const,
    supportsImageInput: false, chat }));
  const deps: SchemaServiceDeps = {
    google: { fetch: jest.fn(), getAccessToken: jest.fn() }, profile: { getProfileUserInfo: async () => ({ email: 'test@example.com', id: '' }) },
    loadApiKey: async () => 'fake-key', buildProvider, newUuid: () => 'log', now: () => '2026-10-21',
  };
  return { store, row, chat, deps, buildProvider };
}
function evidence(value: string | null, overrides: Partial<Evidence> = {}): Evidence {
  return { fieldId: 'field', value, notReported: false, ...overrides } as Evidence;
}

test('パイロット値を重複排除して30件まで送り、候補を編集して反映する', async () => {
  const { store, row, chat, deps, buildProvider } = setup();
  store.setState({ pilot: { ...store.getState().pilot, evidence: [
    evidence(null), evidence(''), evidence('hidden', { fieldId: 'other' }),
    evidence('nr', { notReported: true }), evidence(' 0 '), evidence('0'),
    ...Array.from({ length: 35 }, (_, i) => evidence(String(i))),
  ] } });
  await suggestEnum(store, 0, deps);
  expect(buildProvider).toHaveBeenCalledWith(expect.objectContaining({ model: FACTORY_DEFAULT_MODEL }));
  expect(loadDefaultModel).toHaveBeenCalled();
  const input = JSON.parse(chat.mock.calls[0]![0][1]!.content as string);
  expect(input).toEqual({ fieldLabel: row.fieldLabel, extractionInstruction: row.extractionInstruction,
    pilotValues: Array.from({ length: 30 }, (_, i) => String(i)) });
  expect(store.getState().schema.editorRows![0]).toBe(row);
  expect(appendLlmApiLog).toHaveBeenCalledWith('sheet', expect.objectContaining({
    purpose: 'suggest_enum', tokensIn: 100, tokensOut: 20, promptVersion: 1,
    promptRef: 'https://drive.test/log.prompt.json', responseRef: 'https://drive.test/log.response.json',
  }), deps.google);
  expect(ensureChildFolder).toHaveBeenCalledWith('logs', 'folder', deps.google);
  expect(ensureChildFolder).toHaveBeenCalledWith('llm', 'logs', deps.google);
  const uploads = jest.mocked(uploadTextFile).mock.calls;
  const promptUpload = uploads.find(([file]) => file.name === 'log.prompt.json')![0];
  const responseUpload = uploads.find(([file]) => file.name === 'log.response.json')![0];
  expect(promptUpload).toMatchObject({ parentId: 'llm', mimeType: 'application/json' });
  expect(JSON.parse(promptUpload.content)).toMatchObject({ promptVersion: 1, messages: chat.mock.calls[0]![0] });
  expect(JSON.parse(responseUpload.content)).toEqual({ text: '保存する応答全文' });
  updateEnumSuggestion(store, { values: ' survey |unclear|other' });
  applyEnumSuggestion(store);
  expect(store.getState().schema.editorRows![0]).toMatchObject({ dataType: 'enum',
    allowedValues: 'survey|unclear|other', maxQuotes: null, multiSelect: false,
    extractionInstruction: 'Report method\n次から1つ選んでください: survey | unclear | other' });
  expect(store.getState().schema.enumSuggestion).toBeNull();
  expect(store.getState().schema.editorOrigin).toBe('user_edit');
  expect(deps.google.fetch).not.toHaveBeenCalled();
});
test('パイロットなし、注入された既定モデル・制限を使い、指示の追記は省略できる', async () => {
  const { store, row, chat, deps, buildProvider } = setup();
  deps.loadDefaultModel = async () => 'gemini-2.5-pro';
  deps.resolveRateLimitPolicy = async () => UNLIMITED_POLICY;
  store.setState({ schema: { ...store.getState().schema, editorRows: [{ ...row, fieldId: null }] },
    pilot: { ...store.getState().pilot, evidence: [evidence('unused')] } });
  await suggestEnum(store, 0, deps);
  expect(buildProvider).toHaveBeenCalledWith(expect.objectContaining({ model: 'gemini-2.5-pro' }));
  expect(JSON.parse(chat.mock.calls[0]![0][1]!.content as string).pilotValues).toEqual([]);
  updateEnumSuggestion(store, { appendInstruction: false });
  applyEnumSuggestion(store);
  expect(store.getState().schema.editorRows![0]!.extractionInstruction).toBe(row.extractionInstruction);
});
test('候補の入力エラーを表示し行を保つ。修正するとエラーが消える', async () => {
  const { store, row, deps } = setup();
  await suggestEnum(store, 0, deps);
  updateEnumSuggestion(store, { values: 'a' });
  applyEnumSuggestion(store);
  expect(store.getState().schema.enumSuggestion!.error).toContain('3〜8');
  expect(store.getState().schema.editorRows![0]).toBe(row);
  updateEnumSuggestion(store, { values: 'a|unclear|other' });
  expect(store.getState().schema.enumSuggestion!.error).toBeNull();
});
test.each(['broken', '[]'])('不正JSON %s でも行は変わらない', async (text) => {
  const { store, row, chat, deps } = setup();
  chat.mockResolvedValue({ text, tokensIn: null, tokensOut: null, cachedTokensIn: null, raw: {} });
  await suggestEnum(store, 0, deps);
  expect(store.getState().schema.enumSuggestion!.error).toContain('JSON');
  applyEnumSuggestion(store);
  expect(store.getState().schema.editorRows![0]).toBe(row);
});
test.each([new Error('通信失敗'), '通信失敗'])('LLM失敗を表示する %s', async (error) => {
  const { store, row, chat, deps } = setup();
  chat.mockRejectedValue(error);
  await suggestEnum(store, 0, deps);
  expect(store.getState().schema.enumSuggestion!.error).toBe('通信失敗');
  expect(store.getState().schema.editorRows![0]).toBe(row);
});
test('接続不一致とキー未設定で送信しない', async () => {
  const { store, deps, chat } = setup();
  deps.loadLlmConnectionSettings = async () => ({ provider: 'anthropic', openAiCompatibleEndpoint: null, azureOpenAiEndpoint: null, localLlmEndpoint: null });
  await suggestEnum(store, 0, deps);
  expect(store.getState().schema.enumSuggestion!.error).toContain('モデル');
  deps.loadLlmConnectionSettings = undefined;
  deps.loadApiKey = async () => null;
  await suggestEnum(store, 0, deps);
  expect(store.getState().schema.enumSuggestion!.error).toContain('API');
  expect(chat).not.toHaveBeenCalled();
});
test('同意キャンセル時は送信しない', async () => {
  const { store, deps, chat } = setup();
  deps.ensureAiDataConsent = async () => false;
  await suggestEnum(store, 0, deps);
  expect(store.getState().schema.enumSuggestion).toBeNull();
  expect(chat).not.toHaveBeenCalled();
});
test('対象なし・別の型・処理中は実行しない', async () => {
  const { store, row, deps, chat } = setup();
  await suggestEnum(store, 9, deps);
  store.setState({ schema: { ...store.getState().schema, editorRows: null } });
  await suggestEnum(store, 0, deps);
  store.setState({ schema: { ...store.getState().schema, editorRows: [{ ...row, dataType: 'enum' }] } });
  await suggestEnum(store, 0, deps);
  store.setState({ schema: { ...store.getState().schema, editorRows: [row] } });
  const run = suggestEnum(store, 0, deps);
  applyEnumSuggestion(store);
  await suggestEnum(store, 0, deps);
  await run;
  expect(chat).toHaveBeenCalledTimes(1);
  store.setState({ currentProject: null });
  await suggestEnum(store, 0, deps);
  expect(chat).toHaveBeenCalledTimes(1);
});
test('候補なしの操作は何もしない', () => {
  const { store, row } = setup();
  applyEnumSuggestion(store);
  updateEnumSuggestion(store, { values: 'a' });
  expect(store.getState().schema.editorRows![0]).toBe(row);
});
test.each(['edited', 'removed', 'closed'])('生成後に対象行が変わった %s', async (mode) => {
  const { store, deps } = setup();
  await suggestEnum(store, 0, deps);
  if (mode === 'edited') updateEditorRow(store, 0, { fieldLabel: '改訂' });
  else store.setState({ schema: { ...store.getState().schema, editorRows: mode === 'removed' ? [] : null } });
  applyEnumSuggestion(store);
  expect(store.getState().schema.enumSuggestion!.error).toContain('編集・削除');
});
test('生成後に移動した行へ適用する', async () => {
  const { store, row, deps } = setup();
  store.setState({ schema: { ...store.getState().schema, editorRows: [row, emptyEditorRow()] } });
  await suggestEnum(store, 0, deps);
  moveEditorRow(store, 0, 1);
  applyEnumSuggestion(store);
  expect(store.getState().schema.editorRows![1]!.dataType).toBe('enum');
});
test('記録のフォルダを用意する間に取り消すと、LLM へ送らない', async () => {
  const { store, deps, chat } = setup();
  let finish!: () => void;
  const wait = new Promise<void>((resolve) => { finish = resolve; });
  jest.mocked(ensureChildFolder).mockImplementationOnce(async (name: string) => {
    await wait;
    return { id: name } as Awaited<ReturnType<typeof ensureChildFolder>>;
  });
  const run = suggestEnum(store, 0, deps);
  await new Promise((resolve) => setTimeout(resolve, 0));
  cancelEnumSuggestion(store);
  finish();
  await run;
  expect(chat).not.toHaveBeenCalled();
  expect(store.getState().schema.enumSuggestion).toBeNull();
});
test.each(['success', 'failure', 'consent', 'consentAccepted'])('キャンセル後の遅延応答を捨てる %s', async (mode) => {
  const { store, deps, chat } = setup();
  let finish!: () => void;
  const wait = new Promise<void>((resolve) => { finish = resolve; });
  if (mode === 'consent' || mode === 'consentAccepted') deps.ensureAiDataConsent = async () => { await wait; return mode === 'consentAccepted'; };
  else chat.mockImplementation(async () => {
    await wait;
    if (mode === 'failure') throw new Error('遅延失敗');
    return { text: '{"allowed_values":["a","unclear","other"]}', tokensIn: null, tokensOut: null,
      cachedTokensIn: null, raw: {} };
  });
  const run = suggestEnum(store, 0, deps);
  await new Promise((resolve) => setTimeout(resolve, 0));
  cancelEnumSuggestion(store);
  finish();
  await run;
  expect(store.getState().schema.enumSuggestion).toBeNull();
});
