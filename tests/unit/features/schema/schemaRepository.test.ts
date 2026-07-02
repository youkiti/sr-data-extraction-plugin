import {
  appendSchemaFields,
  appendSchemaVersion,
  getNextSchemaVersion,
  getSchemaFieldsByVersion,
  listSchemaVersions,
} from '../../../../src/features/schema/schemaRepository';
import { SHEET_HEADERS } from '../../../../src/domain/sheetsSchema';
import { appendRow, appendRows, getSheetValues } from '../../../../src/lib/google/sheets';
import type { SchemaField } from '../../../../src/domain/schemaField';

jest.mock('../../../../src/lib/google/sheets', () => ({
  appendRow: jest.fn(),
  appendRows: jest.fn(),
  getSheetValues: jest.fn(),
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
