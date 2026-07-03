import { saveProtocol } from '../../../../src/features/protocol/saveProtocol';
import {
  appendProtocol,
  getNextProtocolVersion,
} from '../../../../src/features/protocol/protocolRepository';
import { uploadTextFile } from '../../../../src/lib/google/drive';
import type { ParsedProtocolFile } from '../../../../src/features/protocol/types';

jest.mock('../../../../src/features/protocol/protocolRepository', () => ({
  appendProtocol: jest.fn(),
  getNextProtocolVersion: jest.fn(),
}));
jest.mock('../../../../src/lib/google/drive', () => ({
  uploadTextFile: jest.fn(),
}));

const appendProtocolMock = appendProtocol as jest.MockedFunction<typeof appendProtocol>;
const getNextVersionMock = getNextProtocolVersion as jest.MockedFunction<
  typeof getNextProtocolVersion
>;
const uploadTextFileMock = uploadTextFile as jest.MockedFunction<typeof uploadTextFile>;

const google = { fetch: jest.fn() as unknown as typeof fetch, getAccessToken: async () => 't' };

function makeParsed(overrides: Partial<ParsedProtocolFile> = {}): ParsedProtocolFile {
  return {
    sourceType: 'manual',
    sourceFilename: '',
    plainText: 'P: 成人肺炎',
    preview: 'P: 成人肺炎',
    ...overrides,
  };
}

beforeEach(() => {
  jest.clearAllMocks();
  getNextVersionMock.mockResolvedValue(1);
});

describe('saveProtocol', () => {
  test('手入力: Drive 退避せず raw_text_inline に全文を保持して追記する', async () => {
    const protocol = await saveProtocol(
      {
        spreadsheetId: 'sheet-1',
        rawProtocolsFolderId: 'folder-raw',
        parsed: makeParsed(),
        createdBy: 'tester@example.com',
      },
      { google, now: () => '2026-07-02T01:00:00Z' },
    );
    expect(uploadTextFileMock).not.toHaveBeenCalled();
    expect(protocol).toEqual({
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
      rawTextPreview: 'P: 成人肺炎',
      rawTextInline: 'P: 成人肺炎',
      createdAt: '2026-07-02T01:00:00Z',
      createdBy: 'tester@example.com',
    });
    expect(appendProtocolMock).toHaveBeenCalledWith('sheet-1', protocol, google);
  });

  test('markdown: 抽出テキストを raw_protocols/protocol_v{version}.txt へ退避し raw_text_ref に URL を残す', async () => {
    getNextVersionMock.mockResolvedValue(3);
    uploadTextFileMock.mockResolvedValue({
      id: 'raw-1',
      webViewLink: 'https://drive.google.com/file/d/raw-1/view',
    });
    const protocol = await saveProtocol(
      {
        spreadsheetId: 'sheet-1',
        rawProtocolsFolderId: 'folder-raw',
        parsed: makeParsed({
          sourceType: 'markdown',
          sourceFilename: 'protocol.md',
          plainText: '# 本文',
          preview: '# 本文',
        }),
        createdBy: 'tester@example.com',
      },
      { google, now: () => '2026-07-02T01:00:00Z' },
    );
    expect(uploadTextFileMock).toHaveBeenCalledWith(
      { name: 'protocol_v3.txt', content: '# 本文', parentId: 'folder-raw' },
      google,
    );
    expect(protocol).toMatchObject({
      version: 3,
      sourceType: 'markdown',
      sourceFilename: 'protocol.md',
      rawTextRef: 'https://drive.google.com/file/d/raw-1/view',
      rawTextInline: null,
    });
  });

  test('空のプレビューは null として追記する（now 未指定なら現在時刻を使う）', async () => {
    const protocol = await saveProtocol(
      {
        spreadsheetId: 'sheet-1',
        rawProtocolsFolderId: 'folder-raw',
        parsed: makeParsed({ plainText: '', preview: '' }),
        createdBy: '',
      },
      { google },
    );
    expect(protocol.rawTextPreview).toBeNull();
    expect(protocol.createdAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });
});
