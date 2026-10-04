import {
  appendSchemaFields,
  appendSchemaVersion,
  getNextSchemaVersion,
  getSchemaFieldsByVersion,
  listSchemaVersions,
} from '../../../../src/features/schema/schemaRepository';
import { SHEET_HEADERS } from '../../../../src/domain/sheetsSchema';
import { appendRow, appendRows, getBatchValues, getSheetValues, updateRow } from '../../../../src/lib/google/sheets';
import type { SchemaField } from '../../../../src/domain/schemaField';

jest.mock('../../../../src/lib/google/sheets', () => ({
  appendRow: jest.fn(),
  appendRows: jest.fn(),
  getSheetValues: jest.fn(),
  getBatchValues: jest.fn(),
  updateRow: jest.fn(),
}));

const appendRowMock = appendRow as jest.MockedFunction<typeof appendRow>;
const appendRowsMock = appendRows as jest.MockedFunction<typeof appendRows>;
const getSheetValuesMock = getSheetValues as jest.MockedFunction<typeof getSheetValues>;

const deps = { fetch: jest.fn() as unknown as typeof fetch, getAccessToken: async () => 't' };
const VERSIONS_HEADER = [...SHEET_HEADERS.SchemaVersions];
const FIELDS_HEADER = [...SHEET_HEADERS.SchemaFields];

function versionRow(overrides: Record<string, string> = {}): string[] {
  const defaults: Record<string, string> = {
    schema_version: '1',
    parent_version: '',
    protocol_version: '1',
    created_by_type: 'ai_draft',
    created_at: '2026-07-02T00:00:00Z',
    created_by: 'tester@example.com',
    note: '',
  };
  return VERSIONS_HEADER.map((key) => overrides[key] ?? defaults[key] ?? '');
}

function fieldRow(overrides: Record<string, string> = {}): string[] {
  const defaults: Record<string, string> = {
    schema_version: '1',
    field_id: 'f-1',
    field_index: '1',
    section: 'methods',
    field_name: 'study_design',
    field_label: '研究デザイン',
    entity_level: 'study',
    data_type: 'enum',
    unit: '',
    allowed_values: 'rct|observational',
    required: 'TRUE',
    extraction_instruction: 'Report the design.',
    example: 'RCT',
    ai_generated: 'TRUE',
    note: '',
  };
  return FIELDS_HEADER.map((key) => overrides[key] ?? defaults[key] ?? '');
}

const FIELD: SchemaField = {
  maxQuotes: null,
  multiSelect: null,
  schemaVersion: 2,
  fieldId: 'f-9',
  fieldIndex: 3,
  section: 'outcomes',
  fieldName: 'outcome_events',
  fieldLabel: 'イベント数',
  entityLevel: 'outcome_result',
  dataType: 'integer',
  unit: null,
  allowedValues: null,
  required: true,
  extractionInstruction: 'Report events per arm.',
  example: null,
  aiGenerated: false,
  note: null,
};

beforeEach(() => {
  jest.clearAllMocks();
  jest.mocked(getBatchValues).mockResolvedValue([[FIELDS_HEADER]]);
});

describe('getNextSchemaVersion', () => {
  test('ヘッダーのみなら 1、既存があれば最大 + 1（壊れた行は無視）', async () => {
    getSheetValuesMock.mockResolvedValue([VERSIONS_HEADER]);
    await expect(getNextSchemaVersion('sheet-1', deps)).resolves.toBe(1);

    getSheetValuesMock.mockResolvedValue([
      VERSIONS_HEADER,
      versionRow({ schema_version: '2' }),
      versionRow({ schema_version: 'x' }),
      [],
    ]);
    await expect(getNextSchemaVersion('sheet-1', deps)).resolves.toBe(3);
  });
});

describe('appendSchemaVersion / appendSchemaFields', () => {
  test('SchemaVersions は列順どおり 1 行追記する', async () => {
    await appendSchemaVersion(
      'sheet-1',
      {
        schemaVersion: 2,
        parentVersion: 1,
        protocolVersion: 3,
        createdByType: 'user_edit',
        createdAt: '2026-07-02T01:00:00Z',
        createdBy: 'tester@example.com',
        note: '単位を修正',
      },
      deps,
    );
    expect(appendRowMock).toHaveBeenCalledWith(
      'sheet-1',
      'SchemaVersions',
      [2, 1, 3, 'user_edit', '2026-07-02T01:00:00Z', 'tester@example.com', '単位を修正'],
      deps,
    );
  });

  test('SchemaVersions の null 列（parent / note）は null のまま追記する', async () => {
    await appendSchemaVersion(
      'sheet-1',
      {
        schemaVersion: 1,
        parentVersion: null,
        protocolVersion: 1,
        createdByType: 'ai_draft',
        createdAt: '2026-07-02T00:00:00Z',
        createdBy: '',
        note: null,
      },
      deps,
    );
    expect(appendRowMock).toHaveBeenCalledWith(
      'sheet-1',
      'SchemaVersions',
      [1, null, 1, 'ai_draft', '2026-07-02T00:00:00Z', '', null],
      deps,
    );
  });

  test('SchemaFields は全項目をまとめて追記する（null 維持・列順固定）', async () => {
    await appendSchemaFields('sheet-1', [FIELD], deps);
    expect(appendRowsMock).toHaveBeenCalledWith(
      'sheet-1',
      'SchemaFields',
      [
        [
          2,
          'f-9',
          3,
          'outcomes',
          'outcome_events',
          'イベント数',
          'outcome_result',
          'integer',
          null,
          null,
          true,
          'Report events per arm.',
          null,
          false,
          null,
          null,
          null,
          null,
          null,
        ],
      ],
      deps,
    );
  });
});

describe('listSchemaVersions', () => {
  test('データ行が無ければ []', async () => {
    getSheetValuesMock.mockResolvedValue([VERSIONS_HEADER]);
    await expect(listSchemaVersions('sheet-1', deps)).resolves.toEqual([]);
  });

  test('全行を SchemaVersion へ変換し降順で返す（空 parent は null・未知 type はフォールバック）', async () => {
    getSheetValuesMock.mockResolvedValue([
      VERSIONS_HEADER,
      versionRow({ schema_version: '1', created_by_type: 'pilot_revision' }),
      versionRow({
        schema_version: '2',
        parent_version: '1',
        created_by_type: 'unknown',
        note: '改訂',
      }),
    ]);
    const versions = await listSchemaVersions('sheet-1', deps);
    expect(versions.map((v) => v.schemaVersion)).toEqual([2, 1]);
    expect(versions[1]?.createdByType).toBe('pilot_revision');
    expect(versions[0]).toEqual({
      schemaVersion: 2,
      parentVersion: 1,
      protocolVersion: 1,
      createdByType: 'ai_draft', // 未知値のフォールバック
      createdAt: '2026-07-02T00:00:00Z',
      createdBy: 'tester@example.com',
      note: '改訂',
    });
    expect(versions[1]?.parentVersion).toBeNull();
  });

  test('壊れた行（数値でない version・欠損セル）は 0 に倒す', async () => {
    getSheetValuesMock.mockResolvedValue([VERSIONS_HEADER, ['x']]);
    const versions = await listSchemaVersions('sheet-1', deps);
    expect(versions[0]).toMatchObject({ schemaVersion: 0, protocolVersion: 0, note: null });
  });
});

describe('getSchemaFieldsByVersion', () => {
  test('データ行が無ければ []', async () => {
    getSheetValuesMock.mockResolvedValue([FIELDS_HEADER]);
    await expect(getSchemaFieldsByVersion('sheet-1', 1, deps)).resolves.toEqual([]);
  });

  test('指定版だけを field_index 昇順で返す（bool / null / enum フォールバックの変換込み）', async () => {
    getSheetValuesMock.mockResolvedValue([
      FIELDS_HEADER,
      fieldRow({ field_index: '2', field_name: 'country', data_type: 'x', entity_level: 'x' }),
      fieldRow({ field_index: '1' }),
      fieldRow({ field_index: '3', field_name: 'arm_name', entity_level: 'arm' }),
      fieldRow({ field_index: '4', field_name: 'events', entity_level: 'outcome_result' }),
      fieldRow({ field_index: '5', field_name: 'rob_d1', entity_level: 'rob_domain' }),
      fieldRow({ schema_version: '2', field_name: 'other_version' }),
      ['x'],
    ]);
    const fields = await getSchemaFieldsByVersion('sheet-1', 1, deps);
    expect(fields.map((f) => f.fieldName)).toEqual([
      'study_design',
      'country',
      'arm_name',
      'events',
      'rob_d1',
    ]);
    expect(fields.map((f) => f.entityLevel)).toEqual([
      'study',
      'study',
      'arm',
      'outcome_result',
      'rob_domain',
    ]);
    expect(fields[0]).toEqual({
      maxQuotes: null,
      multiSelect: null,
      schemaVersion: 1,
      fieldId: 'f-1',
      fieldIndex: 1,
      section: 'methods',
      fieldName: 'study_design',
      fieldLabel: '研究デザイン',
      entityLevel: 'study',
      dataType: 'enum',
      unit: null,
      allowedValues: 'rct|observational',
      required: true,
      extractionInstruction: 'Report the design.',
      example: 'RCT',
      aiGenerated: true,
      note: null,
    });
    // 未知の data_type / entity_level はフォールバック
    expect(fields[1]).toMatchObject({ dataType: 'text', entityLevel: 'study' });
  });

  test('version セル以外が欠けた行（短い行）は空値として変換する', async () => {
    getSheetValuesMock.mockResolvedValue([FIELDS_HEADER, ['1']]);
    const fields = await getSchemaFieldsByVersion('sheet-1', 1, deps);
    expect(fields[0]).toMatchObject({
      schemaVersion: 1,
      fieldIndex: 0, // 数値にならない field_index は 0 に倒す
      fieldName: '',
      required: false,
      unit: null,
    });
  });

  test('schema_version が数値にならない行・完全に空の行はどの版にも一致しない', async () => {
    getSheetValuesMock.mockResolvedValue([
      FIELDS_HEADER,
      fieldRow({ schema_version: 'z', field_index: 'y' }),
      [],
    ]);
    await expect(getSchemaFieldsByVersion('sheet-1', 0, deps)).resolves.toEqual([]);
  });
});

describe('max_quotes の後方互換', () => {
  test('旧ヘッダで OFF なら 15 列のまま追記する', async () => {
    jest.mocked(getBatchValues).mockResolvedValue([[FIELDS_HEADER.slice(0, 15)]]);
    await appendSchemaFields('s', [FIELD], deps);
    expect(updateRow).not.toHaveBeenCalled();
    expect(appendRowsMock.mock.calls[0]?.[2][0]).toHaveLength(15);
  });
  test.each([15, 16])('ON の保存で %p 列ヘッダを必要なときだけ拡張する', async (length) => {
    jest.mocked(getBatchValues).mockResolvedValue([[FIELDS_HEADER.slice(0, length)]]);
    await appendSchemaFields('s', [{ ...FIELD, dataType: 'text', maxQuotes: 10 }], deps);
    expect(updateRow).toHaveBeenCalledTimes(length === 15 ? 1 : 0);
    expect(appendRowsMock.mock.calls[0]?.[2][0]?.[15]).toBe(10);
  });
  test.each([[], [[]], [[['wrong']]], [[ [...FIELDS_HEADER.slice(0, 15), 'wrong'] ]]].map((headers) => ({ headers })))('不正ヘッダを拒否する %p', async ({ headers }) => {
    jest.mocked(getBatchValues).mockResolvedValue(headers as string[][][]);
    await expect(appendSchemaFields('s', [FIELD], deps)).rejects.toThrow('SchemaFields');
  });
  test.each(['', '2.5', 'bad', '10', '  '])('上限セル %p を読む', async (value) => {
    getSheetValuesMock.mockResolvedValue([FIELDS_HEADER, fieldRow({ max_quotes: value })]);
    expect((await getSchemaFieldsByVersion('s', 1, deps))[0]?.maxQuotes).toBe(value === '10' ? 10 : null);
  });
  test('旧 15 列の行は OFF', async () => {
    getSheetValuesMock.mockResolvedValue([FIELDS_HEADER.slice(0, 15), fieldRow().slice(0, 15)]);
    expect((await getSchemaFieldsByVersion('s', 1, deps))[0]?.maxQuotes).toBeNull();
  });
});


describe('複数選択のシート互換', () => {
  test.each([15, 16, 19])('単一選択は既存 %i 列を維持する', async (width) => {
    jest.mocked(getBatchValues).mockResolvedValue([[FIELDS_HEADER.slice(0, width)]]);
    await appendSchemaFields('s', [FIELD], deps);
    expect(updateRow).not.toHaveBeenCalled();
    expect(appendRowsMock.mock.calls[0]?.[2][0]).toHaveLength(width);
  });
  test('複数引用だけなら 16 列までしか拡張しない', async () => {
    jest.mocked(getBatchValues).mockResolvedValue([[FIELDS_HEADER.slice(0, 15)]]);
    await appendSchemaFields('s', [{ ...FIELD, maxQuotes: 3 }], deps);
    expect(updateRow).toHaveBeenCalledWith('s', 'SchemaFields', 1, FIELDS_HEADER.slice(0, 16), deps);
    expect(appendRowsMock.mock.calls[0]?.[2][0]).toHaveLength(16);
  });
  test.each([15, 16, 17, 18, 19])('複数選択は %i 列から必要時だけ拡張する', async (width) => {
    jest.mocked(getBatchValues).mockResolvedValue([[FIELDS_HEADER.slice(0, width)]]);
    await appendSchemaFields('s', [
      { ...FIELD, multiSelect: { exclusiveValues: ['NA', 'unclear'], freeTextValues: ['Other'] } },
      { ...FIELD, multiSelect: { exclusiveValues: [], freeTextValues: [] } },
    ], deps);
    expect(updateRow).toHaveBeenCalledTimes(width < 19 ? 1 : 0);
    expect(appendRowsMock.mock.calls[0]?.[2].map((row) => row.slice(16))).toEqual([
      [true, 'NA|unclear', 'Other'], [true, null, null],
    ]);
  });
  test.each([15, 16, 19])('%i 列から一致した範囲だけ読み込む', async (width) => {
    getSheetValuesMock.mockResolvedValue([FIELDS_HEADER.slice(0, width), fieldRow({
      max_quotes: '3', multi_select: 'TRUE', exclusive_values: ' NA |NA|unclear', free_text_values: 'Other',
    })]);
    const [field] = await getSchemaFieldsByVersion('s', 1, deps);
    expect(field?.maxQuotes).toBe(width >= 16 ? 3 : null);
    expect(field?.multiSelect).toEqual(width === 19 ? { exclusiveValues: ['NA', 'unclear'], freeTextValues: ['Other'] } : null);
  });
  test('途中の不一致以降は読まず、書き込みは拒否する', async () => {
    const header = [...FIELDS_HEADER];
    header[17] = 'wrong';
    getSheetValuesMock.mockResolvedValue([header, fieldRow({ multi_select: 'TRUE', exclusive_values: 'NA', free_text_values: 'Other' })]);
    expect((await getSchemaFieldsByVersion('s', 1, deps))[0]?.multiSelect).toEqual({ exclusiveValues: [], freeTextValues: [] });
    jest.mocked(getBatchValues).mockResolvedValue([[header]]);
    await expect(appendSchemaFields('s', [FIELD], deps)).rejects.toThrow('18 列目');
  });
});


test('先頭15列のヘッダが異なっても従来の位置で読み取る', async () => {
  getSheetValuesMock.mockResolvedValue([['different', ...FIELDS_HEADER.slice(1)], fieldRow({ note: '保持する注記' })]);
  expect((await getSchemaFieldsByVersion('sheet-1', 1, deps))[0]).toMatchObject({
    fieldId: 'f-1', note: '保持する注記', allowedValues: 'rct|observational',
  });
});

test('20列目以降の利用者追加列は検査せず空セルを追記する', async () => {
  jest.mocked(getBatchValues).mockResolvedValue([[[...FIELDS_HEADER, 'custom', 'another']]]);
  await appendSchemaFields('sheet-1', [FIELD], deps);
  expect(appendRowsMock.mock.calls[0]?.[2][0]).toHaveLength(21);
  expect(appendRowsMock.mock.calls[0]?.[2][0]?.slice(19)).toEqual([null, null]);
  expect(updateRow).not.toHaveBeenCalled();
});

test.each([15, 16])('旧版の設定プロパティがない項目では %i 列のヘッダを拡張しない', async (width) => {
  const { multiSelect: _omit, ...legacy } = FIELD;
  void _omit;
  jest.mocked(getBatchValues).mockResolvedValue([[FIELDS_HEADER.slice(0, width)]]);
  await appendSchemaFields('sheet-1', [legacy as SchemaField], deps);
  expect(updateRow).not.toHaveBeenCalled();
  expect(appendRowsMock.mock.calls[0]?.[2][0]).toHaveLength(width);
});
