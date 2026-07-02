import type { DocumentRecord } from '../../../../src/domain/document';
import { SHEET_HEADERS } from '../../../../src/domain/sheetsSchema';
import {
  appendDocuments,
  documentToRow,
  readDocuments,
  updateDocument,
} from '../../../../src/features/documents/documentRepository';

const HEADER = [...SHEET_HEADERS.Documents];

interface MockDeps {
  fetch: jest.Mock;
  getAccessToken: jest.Mock;
}

function makeDeps(values: string[][]): MockDeps {
  const fetch = jest
    .fn()
    .mockImplementation(async (_input: RequestInfo | URL, init?: RequestInit) => {
      const method = init?.method ?? 'GET';
      const json = method === 'GET' ? { values } : {};
      return {
        ok: true,
        status: 200,
        json: async () => json,
        text: async () => JSON.stringify(json),
      } as Response;
    });
  return { fetch, getAccessToken: jest.fn().mockResolvedValue('token') };
}

function makeDocument(overrides: Partial<DocumentRecord> = {}): DocumentRecord {
  return {
    documentId: 'doc-1',
    studyLabel: 'Smith 2020',
    driveFileId: 'drive-1',
    sourceFileId: 'src-1',
    filename: 'smith2020.pdf',
    pmid: '12345678',
    doi: '10.1000/xyz',
    textRef: 'https://drive.google.com/file/d/text-1/view',
    textStatus: 'ok',
    pageCount: 12,
    charCount: 34567,
    importedAt: 't1',
    importedBy: 'me@example.com',
    note: null,
    ...overrides,
  };
}

const SHEET_ROW = [
  'doc-1',
  'Smith 2020',
  'drive-1',
  'src-1',
  'smith2020.pdf',
  '12345678',
  '10.1000/xyz',
  'https://drive.google.com/file/d/text-1/view',
  'ok',
  '12',
  '34567',
  't1',
  'me@example.com',
  '',
];

describe('documentToRow', () => {
  test('SHEET_HEADERS.Documents の列順に対応する', () => {
    const row = documentToRow(makeDocument());
    expect(row).toHaveLength(HEADER.length);
    expect(row[0]).toBe('doc-1');
    expect(row[8]).toBe('ok');
    expect(row[13]).toBeNull();
  });
});

describe('readDocuments', () => {
  test('全列をパースする（空セルは null、no_text_layer 行は数値も null）', async () => {
    const deps = makeDeps([
      HEADER,
      SHEET_ROW,
      // スキャン PDF: text_ref / pmid / doi / counts 空
      ['doc-2', 'Scan 1999', 'drive-2', 'src-2', 'scan.pdf', '', '', '', 'no_text_layer', '', '', 't1', 'me@example.com', 'memo'],
    ]);
    await expect(readDocuments('sid', deps)).resolves.toEqual([
      makeDocument(),
      makeDocument({
        documentId: 'doc-2',
        studyLabel: 'Scan 1999',
        driveFileId: 'drive-2',
        sourceFileId: 'src-2',
        filename: 'scan.pdf',
        pmid: null,
        doi: null,
        textRef: null,
        textStatus: 'no_text_layer',
        pageCount: null,
        charCount: null,
        note: 'memo',
      }),
    ]);
  });

  test('末尾セルが欠落したラグ行も空セル扱いで読める', async () => {
    // imported_at 以降（12〜14 列目）が欠落した行
    const ragged = SHEET_ROW.slice(0, 11);
    const deps = makeDeps([HEADER, ragged]);
    const [doc] = await readDocuments('sid', deps);
    expect(doc).toMatchObject({ importedAt: '', importedBy: '', note: null });
  });

  test('ヘッダ欠落 / 列名不一致 / text_status 不正 / 数値不正 / document_id 重複は throw', async () => {
    await expect(readDocuments('sid', makeDeps([]))).rejects.toThrow(
      'Documents タブにヘッダ行がありません',
    );
    await expect(readDocuments('sid', makeDeps([['document_id', 'filename']]))).rejects.toThrow(
      '2 列目が "study_label"',
    );
    const badStatus = [...SHEET_ROW];
    badStatus[8] = 'scanned';
    await expect(readDocuments('sid', makeDeps([HEADER, badStatus]))).rejects.toThrow(
      'Documents 2 行目: text_status "scanned" が不正です',
    );
    const badCount = [...SHEET_ROW];
    badCount[9] = 'twelve';
    await expect(readDocuments('sid', makeDeps([HEADER, badCount]))).rejects.toThrow(
      'page_count "twelve" が整数ではありません',
    );
    await expect(readDocuments('sid', makeDeps([HEADER, SHEET_ROW, SHEET_ROW]))).rejects.toThrow(
      '同一 document_id の行が複数あります（doc-1）',
    );
  });
});

describe('appendDocuments', () => {
  test('1 回の :append でまとめて追記し、空配列は no-op', async () => {
    const deps = makeDeps([HEADER]);
    await appendDocuments('sid', [makeDocument(), makeDocument({ documentId: 'doc-2' })], deps);
    expect(deps.fetch).toHaveBeenCalledTimes(1);
    const [url, init] = deps.fetch.mock.calls[0];
    expect(decodeURIComponent(url as string)).toContain('Documents!A1:append');
    const body = JSON.parse((init as RequestInit).body as string);
    expect(body.values).toHaveLength(2);

    const empty = makeDeps([HEADER]);
    await appendDocuments('sid', [], empty);
    expect(empty.fetch).not.toHaveBeenCalled();
  });
});

describe('updateDocument', () => {
  test('document_id 一致行を行番号指定で上書きする', async () => {
    const other = [...SHEET_ROW];
    other[0] = 'doc-0';
    const deps = makeDeps([HEADER, other, SHEET_ROW]);
    await updateDocument('sid', makeDocument({ studyLabel: 'Smith 2020 (RCT)' }), deps);
    const put = deps.fetch.mock.calls.find(
      ([, init]) => (init as RequestInit | undefined)?.method === 'PUT',
    );
    expect(decodeURIComponent(put?.[0] as string)).toContain('Documents!A3?valueInputOption=RAW');
    const body = JSON.parse((put?.[1] as RequestInit).body as string);
    expect(body.values[0][1]).toBe('Smith 2020 (RCT)');
  });

  test('該当行が無ければ throw', async () => {
    const deps = makeDeps([HEADER]);
    await expect(updateDocument('sid', makeDocument(), deps)).rejects.toThrow(
      'document_id "doc-1" の行がありません',
    );
  });
});
