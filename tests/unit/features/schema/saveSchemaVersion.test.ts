import {
  saveSchemaVersion,
  SchemaValidationError,
} from '../../../../src/features/schema/saveSchemaVersion';
import {
  appendSchemaFields,
  appendSchemaVersion,
  getNextSchemaVersion,
} from '../../../../src/features/schema/schemaRepository';
import { appendSchemaOutcomes } from '../../../../src/features/schema/schemaOutcomeRepository';
import type { SchemaEditorRow } from '../../../../src/features/schema/types';

jest.mock('../../../../src/features/schema/schemaRepository', () => ({
  appendSchemaFields: jest.fn(),
  appendSchemaVersion: jest.fn(),
  getNextSchemaVersion: jest.fn(),
}));

jest.mock('../../../../src/features/schema/schemaOutcomeRepository');

const appendFieldsMock = appendSchemaFields as jest.MockedFunction<typeof appendSchemaFields>;
const appendVersionMock = appendSchemaVersion as jest.MockedFunction<typeof appendSchemaVersion>;
const getNextVersionMock = getNextSchemaVersion as jest.MockedFunction<typeof getNextSchemaVersion>;

const google = { fetch: jest.fn() as unknown as typeof fetch, getAccessToken: async () => 't' };

function makeRow(overrides: Partial<SchemaEditorRow> = {}): SchemaEditorRow {
  return {
    maxQuotes: null,
    multiSelect: false,
    exclusiveValues: null,
    freeTextValues: null,
    fieldId: null,
    section: ' methods ',
    fieldName: ' study_design ',
    fieldLabel: ' 研究デザイン ',
    entityLevel: 'study',
    dataType: 'text',
    unit: null,
    allowedValues: null,
    required: true,
    extractionInstruction: ' Report the design. ',
    example: null,
    aiGenerated: true,
    note: null,
    ...overrides,
  };
}

beforeEach(() => {
  jest.clearAllMocks();
  getNextVersionMock.mockResolvedValue(2);
});

describe('saveSchemaVersion', () => {
  test.each([
    ['registration_id', 'study'], ['timepoint', 'outcome_result'],
  ] as const)('既存の予約名 %s は現行項目を渡した場合だけ保存できる', async (fieldName, entityLevel) => {
    const params = {
      spreadsheetId: 'sheet-1', rows: [makeRow({ fieldId: 'f-old', fieldName, entityLevel })],
      outcomes: [], listModeBefore: false, parentVersion: 1, protocolVersion: 1,
      createdByType: 'user_edit' as const, createdBy: '', note: null,
    };
    await expect(saveSchemaVersion(params, { google })).rejects.toBeInstanceOf(SchemaValidationError);
    const saved = await saveSchemaVersion({ ...params, existingFields: [{ fieldId: 'f-old', fieldName, entityLevel }] }, { google });
    expect(saved.fields[0]).toMatchObject({ fieldId: 'f-old', fieldName, entityLevel });
    expect(appendFieldsMock).toHaveBeenCalledWith('sheet-1', saved.fields, google);
  });

  test('検証を通った行を新版として追記する（新規行は UUID 採番・既存 ID は維持・trim 済み）', async () => {
    const rows = [
      makeRow(),
      makeRow({ fieldId: 'f-old', fieldName: 'country', fieldLabel: '国', maxQuotes: 12 }),
    ];
    const { version, fields } = await saveSchemaVersion(
      {
        spreadsheetId: 'sheet-1', outcomes: [], listModeBefore: false,
        rows,
        parentVersion: 1,
        protocolVersion: 3,
        createdByType: 'user_edit',
        createdBy: 'tester@example.com',
        note: '改訂',
      },
      { google, newUuid: () => 'f-new', now: () => '2026-07-02T01:00:00Z' },
    );

    expect(version).toEqual({
      schemaVersion: 2,
      parentVersion: 1,
      protocolVersion: 3,
      createdByType: 'user_edit',
      createdAt: '2026-07-02T01:00:00Z',
      createdBy: 'tester@example.com',
      note: '改訂',
    });
    expect(fields[0]).toMatchObject({
      schemaVersion: 2,
      fieldId: 'f-new',
      fieldIndex: 1,
      section: 'methods',
      fieldName: 'study_design',
      fieldLabel: '研究デザイン',
      extractionInstruction: 'Report the design.',
    });
    expect(fields[1]).toMatchObject({ fieldId: 'f-old', fieldIndex: 2, maxQuotes: 12 });
    expect(appendVersionMock).toHaveBeenCalledWith('sheet-1', version, google);
    expect(appendFieldsMock).toHaveBeenCalledWith('sheet-1', fields, google);
  });

  test('並び替え後の配列順で field_index が採番される（issue #230 の回帰防止。field_index は配列位置のみに由来し、fieldId は維持される）', async () => {
    // S5 エディタの並び替え（moveEditorRow / sortEditorRowsBySection）は editorRows 配列の
    // 位置を入れ替えるだけで、field_index を直接操作しない。ここでは並び替え後の配列を
    // そのまま渡し、確定時に新しい並び順どおりに 1 から採番されることを固定する
    const rows = [
      makeRow({ fieldId: 'f-a', fieldName: 'a' }),
      makeRow({ fieldId: 'f-b', fieldName: 'b' }),
      makeRow({ fieldId: 'f-c', fieldName: 'c' }),
    ];
    const reordered = [rows[2] as SchemaEditorRow, rows[0] as SchemaEditorRow, rows[1] as SchemaEditorRow];

    const { fields } = await saveSchemaVersion(
      {
        spreadsheetId: 'sheet-1', outcomes: [], listModeBefore: false,
        rows: reordered,
        parentVersion: 1,
        protocolVersion: 1,
        createdByType: 'user_edit',
        createdBy: 'tester@example.com',
        note: null,
      },
      { google },
    );

    expect(fields.map((field) => ({ fieldId: field.fieldId, fieldIndex: field.fieldIndex }))).toEqual([
      { fieldId: 'f-c', fieldIndex: 1 },
      { fieldId: 'f-a', fieldIndex: 2 },
      { fieldId: 'f-b', fieldIndex: 3 },
    ]);
  });

  test('enum 以外の行の許容値は null に落とす（enum は維持）', async () => {
    const { fields } = await saveSchemaVersion(
      {
        spreadsheetId: 'sheet-1', outcomes: [], listModeBefore: false,
        rows: [
          makeRow({ dataType: 'enum', allowedValues: 'a|b' }),
          makeRow({ fieldName: 'other_field', dataType: 'text', allowedValues: '   ' }),
        ],
        parentVersion: null,
        protocolVersion: 1,
        createdByType: 'ai_draft',
        createdBy: '',
        note: null,
      },
      { google },
    );
    expect(fields[0]?.allowedValues).toBe('a|b');
    expect(fields[1]?.allowedValues).toBeNull();
    expect(fields[0]?.fieldId).toMatch(/^[0-9a-f-]{36}$/); // 既定の generateUuid
  });

  test('行が 0 件なら SchemaValidationError', async () => {
    await expect(
      saveSchemaVersion(
        {
          spreadsheetId: 'sheet-1', outcomes: [], listModeBefore: false,
          rows: [],
          parentVersion: null,
          protocolVersion: 1,
          createdByType: 'ai_draft',
          createdBy: '',
          note: null,
        },
        { google },
      ),
    ).rejects.toThrow('表のデザイン項目が 1 件もありません');
  });

  test('検証エラーがあると SchemaValidationError（追記しない）', async () => {
    await expect(
      saveSchemaVersion(
        {
          spreadsheetId: 'sheet-1', outcomes: [], listModeBefore: false,
          rows: [makeRow({ fieldName: 'NG name' })],
          parentVersion: null,
          protocolVersion: 1,
          createdByType: 'ai_draft',
          createdBy: '',
          note: null,
        },
        { google },
      ),
    ).rejects.toThrow(SchemaValidationError);
    expect(appendVersionMock).not.toHaveBeenCalled();
  });
});


test('複数選択の設定を trim・重複除去して保存する', async () => {
  const { fields } = await saveSchemaVersion({
    spreadsheetId: 's', outcomes: [], listModeBefore: false, rows: [makeRow({ dataType: 'enum', allowedValues: 'A|NA|Other', multiSelect: true,
      exclusiveValues: ' NA |NA', freeTextValues: ' Other ' })],
    parentVersion: null, protocolVersion: 1, createdByType: 'user_edit', createdBy: 'test', note: null,
  }, { google });
  expect(fields[0]?.multiSelect).toEqual({ exclusiveValues: ['NA'], freeTextValues: ['Other'] });
});

test('アウトカムの全行を同じ版で項目の後に追記し、文字列と順序を整える', async () => {
  const params = {
    spreadsheetId: 's', rows: [makeRow()], listModeBefore: true,
    parentVersion: 1, protocolVersion: 1, createdByType: 'user_edit' as const, createdBy: 'a', note: null,
    outcomes: [
      { aliases: [' old '], outcomeId: ' mortality ', outcomeLabel: ' 全死亡 ', description: ' 定義 ', typicalTimepoints: ' 30d|90d ',
        addedVia: 'migration' as const, note: ' 注記 ', idLocked: true, idEdited: false },
      { aliases: [], outcomeId: 'pain', outcomeLabel: '疼痛', description: ' ', typicalTimepoints: null,
        addedVia: 'schema_editor' as const, note: null, idLocked: false, idEdited: false },
    ],
  };
  const result = await saveSchemaVersion(params, { google });
  expect(result.outcomes).toEqual([
    { schemaVersion: 2, aliases: ['old'], outcomeIndex: 1, outcomeId: 'mortality', outcomeLabel: '全死亡', description: '定義', typicalTimepoints: '30d|90d', addedVia: 'migration', note: '注記' },
    { schemaVersion: 2, aliases: [], outcomeIndex: 2, outcomeId: 'pain', outcomeLabel: '疼痛', description: null, typicalTimepoints: null, addedVia: 'schema_editor', note: null },
  ]);
  expect(appendSchemaOutcomes).toHaveBeenCalledWith('s', result.outcomes, google);
  expect(jest.mocked(appendSchemaOutcomes).mock.invocationCallOrder[0]).toBeGreaterThan(appendFieldsMock.mock.invocationCallOrder[0]!);
  expect(appendFieldsMock.mock.invocationCallOrder[0]).toBeGreaterThan(appendVersionMock.mock.invocationCallOrder[0]!);
  const cause = new Error('failed');
  jest.mocked(appendSchemaOutcomes).mockRejectedValueOnce(cause);
  const failedSave = saveSchemaVersion(params, { google });
  await expect(failedSave).rejects.toThrow('版 2 の項目は保存しましたが');
  await expect(failedSave).rejects.toHaveProperty('cause', cause);
  await expect(saveSchemaVersion({ ...params, outcomes: [] }, { google })).rejects.toThrow(SchemaValidationError);
});

test('一覧が無い版では空一覧を渡し、読み書きの I/O はリポジトリへ委ねる', async () => {
  const result = await saveSchemaVersion({
    spreadsheetId: 's', rows: [makeRow()], outcomes: [], listModeBefore: false,
    parentVersion: null, protocolVersion: 1, createdByType: 'user_edit', createdBy: 'a', note: null,
  }, { google });
  expect(result.outcomes).toEqual([]);
  expect(appendSchemaOutcomes).toHaveBeenCalledWith('s', [], google);
});
