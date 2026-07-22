import type { DocumentRecord } from '../../../../src/domain/document';
import { PAGE_SEPARATOR } from '../../../../src/features/documents/extractedText';
import {
  makeLoadDocumentPages,
  parseDriveFileId,
} from '../../../../src/features/documents/loadDocumentPages';

function makeDocument(overrides: Partial<DocumentRecord> = {}): DocumentRecord {
  return {
    documentId: 'doc-1',
    studyId: 'study-1',
    documentRole: 'article',
    driveFileId: 'drive-1',
    sourceFileId: 'src-1',
    filename: 'smith2020.pdf',
    pmid: null,
    doi: null,
    textRef: 'https://drive.google.com/file/d/txt-1_ABC/view?usp=drivesdk',
    textStatus: 'ok',
    pageCount: 2,
    charCount: 20,
    importedAt: 't1',
    importedBy: 'me',
    note: null,
    excluded: false,
    exclusionReason: null,
    exclusionNote: null,
    excludedAt: null,
    ...overrides,
  };
}

describe('parseDriveFileId', () => {
  test('/file/d/{id} 形式と /d/{id} 形式から ID を取り出す', () => {
    expect(parseDriveFileId('https://drive.google.com/file/d/abc_DEF-123/view')).toBe(
      'abc_DEF-123',
    );
    expect(parseDriveFileId('https://drive.google.com/d/xyz/preview')).toBe('xyz');
  });

  test('?id={id} 形式から取り出す', () => {
    expect(parseDriveFileId('https://drive.google.com/open?id=abc123')).toBe('abc123');
  });

  test('取り出せなければ null（id なし URL / URL ですらない文字列）', () => {
    expect(parseDriveFileId('https://drive.google.com/open?x=1')).toBeNull();
    expect(parseDriveFileId('https://drive.google.com/open?id=')).toBeNull();
    expect(parseDriveFileId('not a url')).toBeNull();
  });
});

describe('makeLoadDocumentPages', () => {
  function makeGoogle(body: string): { fetch: jest.Mock; getAccessToken: jest.Mock } {
    return {
      fetch: jest.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({}),
        text: async () => body,
      } as Response),
      getAccessToken: jest.fn().mockResolvedValue('token'),
    };
  }

  test('text_ref の Drive ファイルを読み、ページ別テキストへ復元する', async () => {
    const google = makeGoogle(`first page${PAGE_SEPARATOR}second page`);
    const load = makeLoadDocumentPages([makeDocument()], google);
    await expect(load('doc-1')).resolves.toEqual([
      { page: 1, text: 'first page' },
      { page: 2, text: 'second page' },
    ]);
    const [url] = google.fetch.mock.calls[0];
    expect(url).toContain('/files/txt-1_ABC?alt=media');
  });

  test('未知の document_id / text_ref なし / ID 解決不能はそれぞれ throw', async () => {
    const google = makeGoogle('');
    const load = makeLoadDocumentPages(
      [
        makeDocument(),
        makeDocument({ documentId: 'doc-2', studyId: 'study-2', textRef: null }),
        makeDocument({ documentId: 'doc-3', textRef: 'https://drive.google.com/open?x=1' }),
      ],
      google,
    );
    await expect(load('doc-x')).rejects.toThrow('"doc-x" が documents 一覧に見つかりません');
    await expect(load('doc-2')).rejects.toThrow('テキスト層がありません');
    await expect(load('doc-3')).rejects.toThrow('text_ref からファイル ID を解決できません');
    expect(google.fetch).not.toHaveBeenCalled();
  });
});
