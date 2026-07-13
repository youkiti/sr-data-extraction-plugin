// 重複 PDF の取り込み防止（issue #102）のテスト。Drive I/O と MD5 計算はモックし、
// ①same_source（source_file_id 一致）②same_content（md5 一致。既存コピー / バッチ内）の
// 判定と、孤児コピー（Documents 行なし）を突き合わせ対象にしない不変条件を検証する
import {
  dedupSelections,
  DUPLICATE_REASON_LABELS,
} from '../../../../src/features/documents/dedupSelections';
import type { ImportSelection } from '../../../../src/features/documents/importDocuments';
import type { DocumentRecord } from '../../../../src/domain/document';
import { getFileMd5, listFolderPdfs } from '../../../../src/lib/google/drive';
import { md5Hex } from '../../../../src/utils/md5';

jest.mock('../../../../src/lib/google/drive');
jest.mock('../../../../src/utils/md5');

const mockListFolderPdfs = jest.mocked(listFolderPdfs);
const mockGetFileMd5 = jest.mocked(getFileMd5);
const mockMd5Hex = jest.mocked(md5Hex);

const GOOGLE = { fetch: jest.fn(), getAccessToken: jest.fn(async () => 't') };

function makeDoc(overrides: Partial<DocumentRecord> = {}): DocumentRecord {
  return {
    documentId: 'doc-1',
    studyId: 'study-1',
    documentRole: 'article',
    driveFileId: 'copy-1',
    sourceFileId: 'src-1',
    filename: 'smith2020.pdf',
    pmid: null,
    doi: null,
    textRef: 'https://drive.google.com/file/d/txt-1/view',
    textStatus: 'ok',
    pageCount: 10,
    charCount: 20000,
    importedAt: '2026-07-02T00:00:00Z',
    importedBy: 'tester@example.com',
    note: null,
    ...overrides,
  };
}

function driveSelection(fileId: string, filename: string): ImportSelection {
  return {
    key: fileId,
    filename,
    sourceFileId: fileId,
    source: { kind: 'drive', fileId },
  };
}

function localSelection(filename: string, data: ArrayBuffer): ImportSelection {
  return {
    key: `local:${filename}:${data.byteLength}`,
    filename,
    sourceFileId: null,
    source: { kind: 'local', data },
  };
}

function baseParams(
  selections: ImportSelection[],
  existingDocuments: DocumentRecord[],
): Parameters<typeof dedupSelections>[0] {
  return { selections, existingDocuments, documentsFolderId: 'docs-folder' };
}

beforeEach(() => {
  jest.clearAllMocks();
  mockListFolderPdfs.mockResolvedValue([]);
  mockGetFileMd5.mockResolvedValue(null);
  mockMd5Hex.mockReturnValue('local-md5');
});

describe('dedupSelections', () => {
  test('同一 Drive ファイル（source_file_id 一致）は same_source でスキップし、全件スキップなら Drive を読まない', async () => {
    const result = await dedupSelections(
      baseParams([driveSelection('src-1', 'a.pdf')], [makeDoc({ sourceFileId: 'src-1' })]),
      { google: GOOGLE },
    );
    expect(result.accepted).toEqual([]);
    expect(result.skipped).toEqual([{ key: 'src-1', filename: 'a.pdf', reason: 'same_source' }]);
    expect(mockListFolderPdfs).not.toHaveBeenCalled();
    expect(mockGetFileMd5).not.toHaveBeenCalled();
  });

  test('ファイル ID は異なるが内容が同一（既存コピーの md5 一致）は same_content でスキップ', async () => {
    mockListFolderPdfs.mockResolvedValue([{ id: 'copy-1', name: 'a.pdf', md5Checksum: 'M1' }]);
    mockGetFileMd5.mockResolvedValueOnce('M1').mockResolvedValueOnce('M9');

    const result = await dedupSelections(
      baseParams(
        [driveSelection('src-2', 'a-copy.pdf'), driveSelection('src-3', 'b.pdf')],
        [makeDoc({ sourceFileId: 'src-1', driveFileId: 'copy-1' })],
      ),
      { google: GOOGLE },
    );

    expect(mockListFolderPdfs).toHaveBeenCalledWith('docs-folder', GOOGLE);
    expect(result.skipped).toEqual([
      { key: 'src-2', filename: 'a-copy.pdf', reason: 'same_content' },
    ]);
    expect(result.accepted.map((s) => s.key)).toEqual(['src-3']);
  });

  test('Documents 行から参照されない孤児コピー・md5 欠落の一覧項目は突き合わせ対象にしない', async () => {
    mockListFolderPdfs.mockResolvedValue([
      // save 失敗で残った孤児コピー（既存 Documents の driveFileId に無い）→ 対象外 = 再取り込みを塞がない
      { id: 'orphan-copy', name: 'orphan.pdf', md5Checksum: 'M-orphan' },
      // md5 欠落（バイナリ実体なし）→ 対象外
      { id: 'copy-1', name: 'a.pdf' },
    ]);
    mockGetFileMd5.mockResolvedValue('M-orphan');

    const result = await dedupSelections(
      baseParams([driveSelection('src-2', 'retry.pdf')], [makeDoc({ driveFileId: 'copy-1' })]),
      { google: GOOGLE },
    );

    expect(result.skipped).toEqual([]);
    expect(result.accepted.map((s) => s.key)).toEqual(['src-2']);
  });

  test('ローカル取り込みはブラウザ内 MD5 で判定する（既存コピーと一致 → スキップ / 不一致 → 取り込み）', async () => {
    mockListFolderPdfs.mockResolvedValue([{ id: 'copy-1', name: 'a.pdf', md5Checksum: 'M1' }]);
    mockMd5Hex.mockReturnValueOnce('M1').mockReturnValueOnce('M2');
    const dup = localSelection('dup.pdf', new ArrayBuffer(4));
    const fresh = localSelection('fresh.pdf', new ArrayBuffer(8));

    const result = await dedupSelections(baseParams([dup, fresh], [makeDoc()]), {
      google: GOOGLE,
    });

    expect(result.skipped).toEqual([
      { key: dup.key, filename: 'dup.pdf', reason: 'same_content' },
    ]);
    expect(result.accepted).toEqual([fresh]);
    expect(mockGetFileMd5).not.toHaveBeenCalled();
  });

  test('同一バッチ内の内容重複は 2 件目以降をスキップする（既存 0 件なら Drive を読まない）', async () => {
    mockMd5Hex.mockReturnValue('SAME');
    const first = localSelection('a.pdf', new ArrayBuffer(4));
    const second = localSelection('b.pdf', new ArrayBuffer(6));

    const result = await dedupSelections(baseParams([first, second], []), { google: GOOGLE });

    expect(result.accepted).toEqual([first]);
    expect(result.skipped).toEqual([
      { key: second.key, filename: 'b.pdf', reason: 'same_content' },
    ]);
    expect(mockListFolderPdfs).not.toHaveBeenCalled();
  });

  test('md5 を取得できない Drive ファイル（null）は判定不能として取り込みへ進める（既知集合にも足さない）', async () => {
    mockGetFileMd5.mockResolvedValue(null);

    const result = await dedupSelections(
      baseParams(
        [driveSelection('src-2', 'x.pdf'), driveSelection('src-3', 'y.pdf')],
        // sourceFileId が null の既存行（ローカル取り込み由来）は same_source 判定の対象外
        [makeDoc({ sourceFileId: null, driveFileId: 'copy-1' })],
      ),
      { google: GOOGLE },
    );

    expect(result.skipped).toEqual([]);
    expect(result.accepted.map((s) => s.key)).toEqual(['src-2', 'src-3']);
  });

  test('スキップ理由の表示文言が定義されている', () => {
    expect(DUPLICATE_REASON_LABELS.same_source).toBe('取り込み済みのためスキップ');
    expect(DUPLICATE_REASON_LABELS.same_content).toBe(
      '内容が同一の PDF が取り込み済みのためスキップ',
    );
  });
});
