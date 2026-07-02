import {
  appendProtocol,
  getNextProtocolVersion,
  listProtocols,
} from '../../../../src/features/protocol/protocolRepository';
import { SHEET_HEADERS } from '../../../../src/domain/sheetsSchema';
import { appendRow, getSheetValues } from '../../../../src/lib/google/sheets';
import type { Protocol } from '../../../../src/domain/protocol';

jest.mock('../../../../src/lib/google/sheets', () => ({
  appendRow: jest.fn(),
  getSheetValues: jest.fn(),
}));

const appendRowMock = appendRow as jest.MockedFunction<typeof appendRow>;
const getSheetValuesMock = getSheetValues as jest.MockedFunction<typeof getSheetValues>;

const deps = { fetch: jest.fn() as unknown as typeof fetch, getAccessToken: async () => 'token' };
const HEADER = [...SHEET_HEADERS.Protocol];

/** SHEET_HEADERS.Protocol の列順で 1 行組み立てる */
function makeRow(overrides: Record<string, string> = {}): string[] {
  const defaults: Record<string, string> = {
    version: '1',
    framework_type: 'pico',
    research_question: 'RQ',
    inclusion_criteria: '成人',
    exclusion_criteria: '小児',
    study_design: 'RCT',
    block_count: '2',
    combination_expression: '#1 AND #2',
    source_type: 'manual',
    source_filename: '',
    raw_text_ref: '',
    raw_text_preview: 'RQ preview',
    raw_text_inline: 'RQ 全文',
    created_at: '2026-07-02T00:00:00Z',
    created_by: 'tester@example.com',
  };
  return HEADER.map((key) => overrides[key] ?? defaults[key] ?? '');
}

beforeEach(() => {
  jest.clearAllMocks();
});

describe('getNextProtocolVersion', () => {
  test('ヘッダーのみ（データ行なし）なら 1 を返す', async () => {
    getSheetValuesMock.mockResolvedValue([HEADER]);
    await expect(getNextProtocolVersion('sheet-1', deps)).resolves.toBe(1);
    expect(getSheetValuesMock).toHaveBeenCalledWith('sheet-1', 'Protocol', deps);
  });

  test('既存の最大 version + 1 を返す（行順に依存しない）', async () => {
    getSheetValuesMock.mockResolvedValue([
      HEADER,
      makeRow({ version: '3' }),
      makeRow({ version: '1' }),
    ]);
    await expect(getNextProtocolVersion('sheet-1', deps)).resolves.toBe(4);
  });

  test('version が数値にならない行・欠損セルは無視する', async () => {
    getSheetValuesMock.mockResolvedValue([HEADER, makeRow({ version: 'x' }), []]);
    await expect(getNextProtocolVersion('sheet-1', deps)).resolves.toBe(1);
  });
});

describe('appendProtocol', () => {
  test('SHEET_HEADERS.Protocol の列順で 1 行追記する（null は維持）', async () => {
    const protocol: Protocol = {
      version: 2,
      frameworkType: null,
      researchQuestion: '',
      inclusionCriteria: null,
      exclusionCriteria: null,
      studyDesign: null,
      blockCount: 0,
      combinationExpression: '',
      sourceType: 'markdown',
      sourceFilename: 'protocol.md',
      rawTextRef: 'https://drive.google.com/file/d/raw-1/view',
      rawTextPreview: 'preview',
      rawTextInline: null,
      createdAt: '2026-07-02T01:00:00Z',
      createdBy: 'tester@example.com',
    };
    await appendProtocol('sheet-1', protocol, deps);
    expect(appendRowMock).toHaveBeenCalledWith(
      'sheet-1',
      'Protocol',
      [
        2,
        null,
        '',
        null,
        null,
        null,
        0,
        '',
        'markdown',
        'protocol.md',
        'https://drive.google.com/file/d/raw-1/view',
        'preview',
        null,
        '2026-07-02T01:00:00Z',
        'tester@example.com',
      ],
      deps,
    );
  });
});

describe('listProtocols', () => {
  test('データ行が無ければ [] を返す', async () => {
    getSheetValuesMock.mockResolvedValue([HEADER]);
    await expect(listProtocols('sheet-1', deps)).resolves.toEqual([]);
  });

  test('全行を Protocol へ変換し version 降順で返す', async () => {
    getSheetValuesMock.mockResolvedValue([
      HEADER,
      makeRow({ version: '1' }),
      makeRow({
        version: '2',
        framework_type: '',
        inclusion_criteria: '',
        exclusion_criteria: '',
        study_design: '',
        source_type: 'docx',
        source_filename: 'p.docx',
        raw_text_ref: 'https://drive.google.com/file/d/raw-2/view',
        raw_text_inline: '',
      }),
    ]);
    const records = await listProtocols('sheet-1', deps);
    expect(records.map((r) => r.version)).toEqual([2, 1]);
    expect(records[0]).toEqual({
      version: 2,
      frameworkType: null, // 未知 / 空の framework_type は null へ倒す
      researchQuestion: 'RQ',
      inclusionCriteria: null,
      exclusionCriteria: null,
      studyDesign: null,
      blockCount: 2,
      combinationExpression: '#1 AND #2',
      sourceType: 'docx',
      sourceFilename: 'p.docx',
      rawTextRef: 'https://drive.google.com/file/d/raw-2/view',
      rawTextPreview: 'RQ preview',
      rawTextInline: null,
      createdAt: '2026-07-02T00:00:00Z',
      createdBy: 'tester@example.com',
    });
    expect(records[1]).toMatchObject({
      frameworkType: 'pico',
      inclusionCriteria: '成人',
      sourceType: 'manual',
      sourceFilename: null,
      rawTextRef: null,
      rawTextInline: 'RQ 全文',
    });
  });

  test('数値列が壊れている行は 0 に倒し、欠損セルは空として扱う', async () => {
    getSheetValuesMock.mockResolvedValue([
      HEADER,
      ['x'], // version 以外のセルが欠けた行
    ]);
    const records = await listProtocols('sheet-1', deps);
    expect(records).toHaveLength(1);
    expect(records[0]).toMatchObject({
      version: 0,
      blockCount: 0,
      sourceType: 'manual',
      researchQuestion: '',
      rawTextPreview: null,
    });
  });
});
