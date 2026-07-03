import { appendDocuments } from '../../../../src/features/documents/documentRepository';
import { extractTextLayer } from '../../../../src/features/documents/extractTextLayer';
import {
  defaultStudyLabel,
  importDocuments,
  type ImportProgress,
} from '../../../../src/features/documents/importDocuments';
import { copyFile, getFileBinary, uploadTextFile } from '../../../../src/lib/google/drive';
import type { GoogleApiDeps } from '../../../../src/lib/google/types';

jest.mock('../../../../src/features/documents/documentRepository');
jest.mock('../../../../src/features/documents/extractTextLayer');
jest.mock('../../../../src/lib/google/drive');

const mockedAppend = jest.mocked(appendDocuments);
const mockedExtract = jest.mocked(extractTextLayer);
const mockedCopy = jest.mocked(copyFile);
const mockedBinary = jest.mocked(getFileBinary);
const mockedUpload = jest.mocked(uploadTextFile);

const GOOGLE: GoogleApiDeps = {
  fetch: jest.fn(),
  getAccessToken: jest.fn().mockResolvedValue('token'),
};

const PDF_BYTES = new Uint8Array([1]).buffer;

function makeDeps(overrides: Partial<Parameters<typeof importDocuments>[1]> = {}) {
  let uuidCount = 0;
  return {
    google: GOOGLE,
    loadPdf: jest.fn(),
    newUuid: () => `u${++uuidCount}`,
    now: () => 'NOW',
    ...overrides,
  };
}

function baseParams(selections: { sourceFileId: string; filename: string }[]) {
  return {
    spreadsheetId: 'sid',
    documentsFolderId: 'folder-docs',
    extractedTextsFolderId: 'folder-texts',
    selections,
    importedBy: 'me@example.com',
  };
}

beforeEach(() => {
  jest.clearAllMocks();
  // clearAllMocks は実装を戻さないため、前のテストの mockRejectedValue を明示的に上書きする
  mockedAppend.mockResolvedValue(undefined);
  mockedCopy.mockResolvedValue({ id: 'copy-1', webViewLink: 'https://drive/copy-1' });
  mockedBinary.mockResolvedValue(PDF_BYTES);
  mockedUpload.mockResolvedValue({ id: 'txt-1', webViewLink: 'https://drive/txt-1' });
  mockedExtract.mockResolvedValue({
    pages: [],
    textStatus: 'ok',
    pageCount: 2,
    charCount: 100,
    serializedText: 'page text',
  });
});

describe('defaultStudyLabel', () => {
  test('拡張子 .pdf を大文字小文字問わず外す', () => {
    expect(defaultStudyLabel('smith2020.pdf')).toBe('smith2020');
    expect(defaultStudyLabel('SMITH2020.PDF')).toBe('SMITH2020');
    expect(defaultStudyLabel('readme.txt')).toBe('readme.txt');
  });
});

describe('importDocuments', () => {
  test('コピー → 抽出 → txt 保存 → Documents 追記まで通し、進捗を 2 段階通知する', async () => {
    const progress: ImportProgress[] = [];
    const deps = makeDeps({ onProgress: (p) => progress.push(p) });
    const result = await importDocuments(
      baseParams([{ sourceFileId: 'src-1', filename: 'smith2020.pdf' }]),
      deps,
    );

    expect(mockedCopy).toHaveBeenCalledWith(
      'src-1',
      { name: 'smith2020.pdf', parentId: 'folder-docs' },
      GOOGLE,
    );
    expect(mockedBinary).toHaveBeenCalledWith('copy-1', GOOGLE);
    expect(mockedExtract).toHaveBeenCalledWith(PDF_BYTES, { loadPdf: deps.loadPdf });
    expect(mockedUpload).toHaveBeenCalledWith(
      { name: 'u1.txt', content: 'page text', parentId: 'folder-texts' },
      GOOGLE,
    );
    expect(result.failures).toEqual([]);
    expect(result.imported).toEqual([
      {
        documentId: 'u1',
        studyLabel: 'smith2020',
        driveFileId: 'copy-1',
        sourceFileId: 'src-1',
        filename: 'smith2020.pdf',
        pmid: null,
        doi: null,
        textRef: 'https://drive/txt-1',
        textStatus: 'ok',
        pageCount: 2,
        charCount: 100,
        importedAt: 'NOW',
        importedBy: 'me@example.com',
        note: null,
      },
    ]);
    expect(mockedAppend).toHaveBeenCalledWith('sid', result.imported, GOOGLE);
    expect(progress).toEqual([
      { fileIndex: 0, totalFiles: 1, filename: 'smith2020.pdf', stage: 'copy' },
      { fileIndex: 0, totalFiles: 1, filename: 'smith2020.pdf', stage: 'extract' },
    ]);
  });

  test('no_text_layer の PDF は txt を保存せず text_ref = null で登録する（※Q7）', async () => {
    mockedExtract.mockResolvedValue({
      pages: [],
      textStatus: 'no_text_layer',
      pageCount: 5,
      charCount: 0,
      serializedText: null,
    });
    const result = await importDocuments(
      baseParams([{ sourceFileId: 'src-1', filename: 'scan.pdf' }]),
      makeDeps(),
    );
    expect(mockedUpload).not.toHaveBeenCalled();
    expect(result.imported[0]).toMatchObject({
      textRef: null,
      textStatus: 'no_text_layer',
      pageCount: 5,
      charCount: 0,
    });
  });

  test('コピー失敗・抽出失敗のファイルは飛ばして残りを続行する', async () => {
    mockedCopy
      .mockRejectedValueOnce(new Error('copy boom'))
      .mockResolvedValueOnce({ id: 'copy-2', webViewLink: 'w' })
      .mockResolvedValueOnce({ id: 'copy-3', webViewLink: 'w' });
    mockedExtract
      .mockRejectedValueOnce(new Error('broken pdf'))
      .mockResolvedValueOnce({
        pages: [],
        textStatus: 'ok',
        pageCount: 1,
        charCount: 50,
        serializedText: 't',
      });
    const result = await importDocuments(
      baseParams([
        { sourceFileId: 'src-1', filename: 'a.pdf' },
        { sourceFileId: 'src-2', filename: 'b.pdf' },
        { sourceFileId: 'src-3', filename: 'c.pdf' },
      ]),
      makeDeps(),
    );
    expect(result.failures).toEqual([
      { sourceFileId: 'src-1', filename: 'a.pdf', stage: 'copy', detail: 'copy boom' },
      { sourceFileId: 'src-2', filename: 'b.pdf', stage: 'extract', detail: 'broken pdf' },
    ]);
    expect(result.imported).toHaveLength(1);
    expect(result.imported[0]?.filename).toBe('c.pdf');
    expect(mockedAppend).toHaveBeenCalledTimes(1);
  });

  test('Error 以外の throw も文字列化して failure に残す', async () => {
    mockedCopy.mockRejectedValue('quota exceeded');
    const result = await importDocuments(
      baseParams([{ sourceFileId: 'src-1', filename: 'a.pdf' }]),
      makeDeps(),
    );
    expect(result.failures).toEqual([
      { sourceFileId: 'src-1', filename: 'a.pdf', stage: 'copy', detail: 'quota exceeded' },
    ]);
    expect(result.imported).toEqual([]);
  });

  test('Documents 追記が失敗したら成功済みファイルも save 失敗として返す', async () => {
    mockedAppend.mockRejectedValue(new Error('sheets down'));
    const result = await importDocuments(
      baseParams([{ sourceFileId: 'src-1', filename: 'a.pdf' }]),
      makeDeps(),
    );
    expect(result.imported).toEqual([]);
    expect(result.failures).toEqual([
      { sourceFileId: 'src-1', filename: 'a.pdf', stage: 'save', detail: 'sheets down' },
    ]);
  });

  test('全ファイル失敗なら Documents 追記を呼ばない。既定の uuid / now でも動く', async () => {
    mockedCopy.mockRejectedValue(new Error('boom'));
    const failedAll = await importDocuments(
      baseParams([{ sourceFileId: 'src-1', filename: 'a.pdf' }]),
      { google: GOOGLE, loadPdf: jest.fn() },
    );
    expect(failedAll.imported).toEqual([]);
    expect(mockedAppend).not.toHaveBeenCalled();

    mockedCopy.mockResolvedValue({ id: 'copy-1', webViewLink: 'w' });
    const ok = await importDocuments(baseParams([{ sourceFileId: 'src-1', filename: 'a.pdf' }]), {
      google: GOOGLE,
      loadPdf: jest.fn(),
    });
    expect(ok.imported[0]?.documentId).toMatch(/^[0-9a-f]{8}-/);
    expect(ok.imported[0]?.importedAt).not.toBe('');
  });
});
