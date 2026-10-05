// S5「スキーマのファイル（JSON）」（issue #316）のサービスのテスト
import { createInitialState, createStore, type Store } from '../../../../src/app/store';
import {
  exportSchemaFile,
  importSchemaFile,
  selectSchemaExportVersion,
  type SchemaImportFile,
  type SchemaTransferDeps,
} from '../../../../src/app/services/schemaTransferService';
import { applyRedraft } from '../../../../src/app/services/schemaService';
import { getSchemaFieldsByVersion } from '../../../../src/features/schema/schemaRepository';
import { SCHEMA_IMPORT_MAX_BYTES, serializeSchemaExport } from '../../../../src/features/schema/schemaTransfer';
import { getCurrentUserEmail } from '../../../../src/lib/google/identity';
import type { SchemaField } from '../../../../src/domain/schemaField';
import type { SchemaVersion } from '../../../../src/domain/schemaVersion';

jest.mock('../../../../src/features/schema/schemaRepository');
jest.mock('../../../../src/lib/google/identity');

const fieldsMock = jest.mocked(getSchemaFieldsByVersion);
const emailMock = jest.mocked(getCurrentUserEmail);

function makeField(overrides: Partial<SchemaField> = {}): SchemaField {
  return {
    maxQuotes: null,
    multiSelect: null,
    schemaVersion: 2,
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

function version(schemaVersion: number): SchemaVersion {
  return {
    schemaVersion, parentVersion: null, protocolVersion: 1, createdByType: 'user_edit',
    createdAt: '2026-07-01T00:00:00Z', createdBy: 'me@example.com', note: null,
  };
}

const LATEST = [makeField(), makeField({ fieldId: 'f-2', fieldIndex: 2, fieldName: 'sample_size' })];

function storeOf(versions: SchemaVersion[] = [version(2), version(1)], currentFields: SchemaField[] = LATEST): Store {
  const state = createInitialState();
  state.currentProject = { projectId: 'p', spreadsheetId: 'sheet', driveFolderId: 'folder', name: '不眠 SR' };
  state.schema.versions = versions;
  state.schema.currentFields = currentFields;
  return createStore(state);
}

function makeDeps(): { deps: SchemaTransferDeps; download: jest.Mock } {
  const download = jest.fn();
  return {
    download,
    deps: {
      google: {} as SchemaTransferDeps['google'],
      profile: {} as SchemaTransferDeps['profile'],
      now: () => '2026-10-05T12:00:00Z',
      getAppVersion: () => '0.13.0',
      download,
    },
  };
}

const OTHER_SOURCE = {
  projectName: '別の SR',
  schemaVersion: 4,
  exportedAt: '2026-09-30T00:00:00Z',
  exportedBy: 'other@example.com',
  extractPromptVersion: 12,
  appVersion: '0.12.0',
};

function fileOf(text: string, size = text.length): SchemaImportFile {
  return { size, text: async () => text };
}

function exportedFile(fields: SchemaField[]): SchemaImportFile {
  return fileOf(serializeSchemaExport(fields, OTHER_SOURCE));
}

beforeEach(() => {
  jest.resetAllMocks();
  emailMock.mockResolvedValue('me@example.com');
  document.body.innerHTML = '';
});

describe('selectSchemaExportVersion', () => {
  test('版を選び前回のエラーを消す。書き出し中は変えない', () => {
    const store = storeOf();
    store.setState({ schema: { ...store.getState().schema, transfer: { ...store.getState().schema.transfer, exportError: 'e' } } });
    selectSchemaExportVersion(store, 1);
    expect(store.getState().schema.transfer).toMatchObject({ exportVersion: 1, exportError: null });
    store.setState({ schema: { ...store.getState().schema, transfer: { ...store.getState().schema.transfer, exporting: true } } });
    selectSchemaExportVersion(store, 2);
    expect(store.getState().schema.transfer.exportVersion).toBe(1);
  });
});

describe('exportSchemaFile', () => {
  test('最新版は読み込み済みの項目を使い、出所つきの JSON をダウンロードする', async () => {
    const store = storeOf();
    const { deps, download } = makeDeps();
    await exportSchemaFile(store, deps, 2);
    expect(fieldsMock).not.toHaveBeenCalled();
    expect(download).toHaveBeenCalledTimes(1);
    const [filename, content, mime] = download.mock.calls[0] as [string, string, string];
    expect(filename).toBe('schema-v2-SR-2026-10-05.json');
    expect(mime).toBe('application/json');
    const json = JSON.parse(content);
    expect(json.source).toEqual({
      projectName: '不眠 SR',
      schemaVersion: 2,
      exportedAt: '2026-10-05T12:00:00Z',
      exportedBy: 'me@example.com',
      extractPromptVersion: 12,
      appVersion: '0.13.0',
    });
    expect(json.fields.map((field: { fieldName: string }) => field.fieldName)).toEqual(['study_design', 'sample_size']);
    expect(store.getState().schema.transfer).toMatchObject({ exportVersion: 2, exporting: false, exportError: null });
  });

  test('古い版は Sheets から項目を読む。メールが取れなければ空にする', async () => {
    const store = storeOf();
    fieldsMock.mockResolvedValue([makeField({ schemaVersion: 1, fieldName: 'old_field' })]);
    emailMock.mockResolvedValue(null);
    const { deps, download } = makeDeps();
    await exportSchemaFile(store, deps, 1);
    expect(fieldsMock).toHaveBeenCalledWith('sheet', 1, deps.google);
    const json = JSON.parse((download.mock.calls[0] as [string, string])[1]);
    expect(json.source.exportedBy).toBe('');
    expect(json.fields[0].fieldName).toBe('old_field');
  });

  test('項目が 0 件・読み込み失敗はカードにエラーを出す', async () => {
    const store = storeOf();
    fieldsMock.mockResolvedValue([]);
    const { deps, download } = makeDeps();
    await exportSchemaFile(store, deps, 1);
    expect(store.getState().schema.transfer.exportError).toBe('スキーマ v1 が見つかりません。再読み込みしてください。');
    fieldsMock.mockRejectedValue('boom');
    await exportSchemaFile(store, deps, 1);
    expect(store.getState().schema.transfer).toMatchObject({ exporting: false, exportError: 'boom' });
    expect(download).not.toHaveBeenCalled();
  });

  test('プロジェクト未選択・版未読込・書き出し中は何もしない', async () => {
    const { deps, download } = makeDeps();
    const noProject = storeOf();
    noProject.setState({ currentProject: null });
    await exportSchemaFile(noProject, deps, 2);
    const unloaded = storeOf();
    unloaded.setState({ schema: { ...unloaded.getState().schema, versions: null } });
    await exportSchemaFile(unloaded, deps, 2);
    const busy = storeOf();
    busy.setState({ schema: { ...busy.getState().schema, transfer: { ...busy.getState().schema.transfer, exporting: true } } });
    await exportSchemaFile(busy, deps, 2);
    expect(download).not.toHaveBeenCalled();
  });

  test('既定の時刻・拡張の版・ダウンロードの経路を使える', async () => {
    const store = storeOf();
    const getManifest = jest.fn(() => ({ version: '9.9.9' }));
    const original = (globalThis as { chrome?: unknown }).chrome;
    (globalThis as { chrome?: unknown }).chrome = { runtime: { getManifest } };
    const createObjectURL = jest.fn(() => 'blob:x');
    const revokeObjectURL = jest.fn();
    Object.assign(URL, { createObjectURL, revokeObjectURL });
    const click = jest.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => undefined);
    await exportSchemaFile(store, { google: {} as SchemaTransferDeps['google'], profile: {} as SchemaTransferDeps['profile'] }, 2);
    expect(getManifest).toHaveBeenCalled();
    expect(click).toHaveBeenCalled();
    (globalThis as { chrome?: unknown }).chrome = undefined;
    await exportSchemaFile(store, { google: {} as SchemaTransferDeps['google'], profile: {} as SchemaTransferDeps['profile'] }, 2);
    expect(click).toHaveBeenCalledTimes(2);
    click.mockRestore();
    (globalThis as { chrome?: unknown }).chrome = original;
  });
});

describe('importSchemaFile', () => {
  test('版が無いプロジェクトでは、エディタへ直接入れて出所を改訂理由の初期値にする', async () => {
    const store = storeOf([], []);
    await importSchemaFile(store, exportedFile([makeField({ fieldName: 'imported' })]));
    const { schema } = store.getState();
    expect(schema.redraft).toBeNull();
    expect(schema.editorRows?.map((row) => [row.fieldId, row.fieldName])).toEqual([[null, 'imported']]);
    expect(schema.editorOrigin).toBe('user_edit');
    expect(schema.editorParentVersion).toBeNull();
    expect(schema.editorNoteDefault).toBe('別の SR の v4（2026-09-30）から読み込み');
    expect(schema.transfer.importing).toBe(false);
    expect(document.body.textContent).toContain('ファイルから 1 項目を読み込みました');
  });

  test('版があるプロジェクトでは、最新版との差分承認画面を開き、反映すると同名の field_id を引き継ぐ', async () => {
    const store = storeOf();
    await importSchemaFile(
      store,
      exportedFile([makeField({ fieldName: 'study_design', extractionInstruction: 'New.' }), makeField({ fieldName: 'added' })]),
    );
    const { redraft } = store.getState().schema;
    expect(redraft?.imported).toEqual(OTHER_SOURCE);
    expect(redraft?.selection).toEqual({ added: { added: true }, changed: { study_design: true }, removed: { sample_size: false } });
    applyRedraft(store);
    const { schema } = store.getState();
    expect(schema.editorRows?.map((row) => [row.fieldId, row.fieldName, row.extractionInstruction])).toEqual([
      ['f-1', 'study_design', 'New.'],
      ['f-2', 'sample_size', 'Report the design.'],
      [null, 'added', 'Report the design.'],
    ]);
    expect(schema.editorParentVersion).toBeNull();
    expect(schema.editorNoteDefault).toBe('別の SR の v4（2026-09-30）から読み込み');
    expect(schema.editorOrigin).toBe('user_edit');
  });

  test('大きすぎる・読めないファイルは画面を変えずに理由を出す', async () => {
    const store = storeOf();
    await importSchemaFile(store, fileOf('{}', SCHEMA_IMPORT_MAX_BYTES + 1));
    expect(store.getState().schema.transfer.importError).toBe('1 MB を超えるファイルは読み込めません。');
    await importSchemaFile(store, fileOf('nope'));
    expect(store.getState().schema.transfer).toMatchObject({ importing: false, importError: 'JSON として読めませんでした。' });
    expect(store.getState().schema.redraft).toBeNull();
    expect(store.getState().schema.editorRows).toBeNull();
  });

  test.each([
    ['プロジェクト未選択', (store: Store) => store.setState({ currentProject: null })],
    ['版未読込', (store: Store) => store.setState({ schema: { ...store.getState().schema, versions: null } })],
    ['項目未読込', (store: Store) => store.setState({ schema: { ...store.getState().schema, currentFields: null } })],
    ['読み込み中', (store: Store) => store.setState({ schema: { ...store.getState().schema, transfer: { ...store.getState().schema.transfer, importing: true } } })],
    ['エディタ表示中', (store: Store) => store.setState({ schema: { ...store.getState().schema, editorRows: [] } })],
  ])('%sは何もしない', async (_label, setup) => {
    const store = storeOf();
    setup(store);
    const text = jest.fn(async () => '{}');
    await importSchemaFile(store, { size: 2, text });
    expect(text).not.toHaveBeenCalled();
  });

  test.each([
    ['エディタを開いた', (store: Store) => store.setState({ schema: { ...store.getState().schema, editorRows: [] } })],
    ['AI 再ドラフトが始まった', (store: Store) => store.setState({ schema: { ...store.getState().schema, drafting: true } })],
    ['最新版の項目が替わった', (store: Store) => store.setState({ schema: { ...store.getState().schema, currentFields: [...LATEST] } })],
    ['プロジェクトを切り替えた', (store: Store) => store.setState({ currentProject: null })],
  ])('読み込み中に%sときは結果を捨てる', async (_label, interrupt) => {
    const store = storeOf();
    let resolve: (text: string) => void = () => undefined;
    const file: SchemaImportFile = { size: 10, text: () => new Promise((r) => { resolve = r; }) };
    const pending = importSchemaFile(store, file);
    interrupt(store);
    const before = store.getState().schema;
    resolve(serializeSchemaExport([makeField()], OTHER_SOURCE));
    await pending;
    const { schema } = store.getState();
    expect(schema.transfer.importing).toBe(false);
    expect(schema.redraft).toBe(before.redraft);
    expect(schema.editorRows).toBe(before.editorRows);
  });
});
