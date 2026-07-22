import type { DocumentRecord } from '../../../../src/domain/document';
import { SHEET_HEADERS } from '../../../../src/domain/sheetsSchema';
import {
  appendDocuments,
  documentToRow,
  ensureDocumentExclusionColumns,
  readDocuments,
  updateDocument,
  updateDocuments,
} from '../../../../src/features/documents/documentRepository';

const HEADER = [...SHEET_HEADERS.Documents];
/** 旧ヘッダ（除外機能列導入前。issue #181）。fetchDocuments / ensureDocumentExclusionColumns の後方互換テスト用 */
const LEGACY_HEADER = HEADER.slice(0, 15);

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
    studyId: 'study-1',
    documentRole: 'article',
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
    excluded: false,
    exclusionReason: null,
    exclusionNote: null,
    excludedAt: null,
    ...overrides,
  };
}

/** 除外機能列（issue #181）を含むフル 19 列の行。除外なし（既定状態）を表す */
const SHEET_ROW = [
  'doc-1',
  'study-1',
  'article',
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
  'FALSE',
  '',
  '',
  '',
];

describe('documentToRow', () => {
  test('SHEET_HEADERS.Documents の列順に対応する', () => {
    const row = documentToRow(makeDocument());
    expect(row).toHaveLength(HEADER.length);
    expect(row[0]).toBe('doc-1');
    expect(row[1]).toBe('study-1');
    expect(row[2]).toBe('article');
    expect(row[9]).toBe('ok');
    expect(row[14]).toBeNull();
    expect(row[15]).toBe(false);
    expect(row[16]).toBe('');
    expect(row[17]).toBe('');
    expect(row[18]).toBe('');
  });

  test('sourceFileId が null（ローカル取り込み）の行は空文字で書く', () => {
    const row = documentToRow(makeDocument({ sourceFileId: null }));
    expect(row[4]).toBe('');
  });

  test('除外中（issue #181）の行は excluded=true・理由/メモ/日時を書く', () => {
    const row = documentToRow(
      makeDocument({
        excluded: true,
        exclusionReason: 'duplicate',
        exclusionNote: '重複のため除外',
        excludedAt: '2026-07-20T00:00:00Z',
      }),
    );
    expect(row[15]).toBe(true);
    expect(row[16]).toBe('duplicate');
    expect(row[17]).toBe('重複のため除外');
    expect(row[18]).toBe('2026-07-20T00:00:00Z');
  });
});

describe('readDocuments', () => {
  test('全列をパースする（空セルは null、no_text_layer 行は数値も null）', async () => {
    const deps = makeDeps([
      HEADER,
      SHEET_ROW,
      // スキャン PDF: text_ref / pmid / doi / counts 空（除外機能列も欠落したラグ行）
      ['doc-2', 'study-2', 'article', 'drive-2', 'src-2', 'scan.pdf', '', '', '', 'no_text_layer', '', '', 't1', 'me@example.com', 'memo'],
    ]);
    await expect(readDocuments('sid', deps)).resolves.toEqual([
      makeDocument(),
      makeDocument({
        documentId: 'doc-2',
        studyId: 'study-2',
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

  test('source_file_id が空セル（ローカル取り込み）は null に戻す', async () => {
    const localRow = [...SHEET_ROW];
    localRow[4] = '';
    const deps = makeDeps([HEADER, localRow]);
    const [doc] = await readDocuments('sid', deps);
    expect(doc?.sourceFileId).toBeNull();
  });

  test('末尾セルが欠落したラグ行も空セル扱いで読める', async () => {
    // imported_at 以降（13〜19 列目）が欠落した行
    const ragged = SHEET_ROW.slice(0, 12);
    const deps = makeDeps([HEADER, ragged]);
    const [doc] = await readDocuments('sid', deps);
    expect(doc).toMatchObject({
      importedAt: '',
      importedBy: '',
      note: null,
      excluded: false,
      exclusionReason: null,
      exclusionNote: null,
      excludedAt: null,
    });
  });

  test('旧 15 列ヘッダ（除外機能列導入前）は excluded=false・reason/note/excluded_at=null として読める（issue #181 後方互換）', async () => {
    const legacyRow = SHEET_ROW.slice(0, 15);
    const deps = makeDeps([LEGACY_HEADER, legacyRow]);
    await expect(readDocuments('sid', deps)).resolves.toEqual([makeDocument()]);
  });

  test('新 19 列ヘッダ + 値は excluded（大文字小文字を無視）・exclusion_reason（全 enum 値）・exclusion_note・excluded_at を正しくパースする（issue #181）', async () => {
    const rowFor = (id: string, tail: readonly string[]): string[] => {
      const row = [...SHEET_ROW];
      row[0] = id;
      return [...row.slice(0, 15), ...tail];
    };
    const rows = [
      HEADER,
      rowFor('doc-ineligible', ['TRUE', 'ineligible', '対象外と判明', '2026-07-20T00:00:00Z']),
      rowFor('doc-duplicate', ['true', 'duplicate', '', '2026-07-21T00:00:00Z']),
      rowFor('doc-mis', ['False', 'mis_imported', '', '']),
      rowFor('doc-hold', ['FALSE', 'on_hold', '保留メモ', '']),
      rowFor('doc-other', ['TRUE', 'other', 'その他メモ', '2026-07-22T00:00:00Z']),
    ];
    const deps = makeDeps(rows);
    const docs = await readDocuments('sid', deps);
    expect(docs.map((d) => d.excluded)).toEqual([true, true, false, false, true]);
    expect(docs.map((d) => d.exclusionReason)).toEqual([
      'ineligible',
      'duplicate',
      'mis_imported',
      'on_hold',
      'other',
    ]);
    expect(docs[0]?.exclusionNote).toBe('対象外と判明');
    expect(docs[1]?.excludedAt).toBe('2026-07-21T00:00:00Z');
    expect(docs[2]?.exclusionNote).toBeNull();
    expect(docs[2]?.excludedAt).toBeNull();
  });

  test('ヘッダ欠落 / 列名不一致 / text_status 不正 / 数値不正 / document_id 重複 / exclusion_reason 不正は throw', async () => {
    await expect(readDocuments('sid', makeDeps([]))).rejects.toThrow(
      'Documents タブにヘッダ行がありません',
    );
    await expect(readDocuments('sid', makeDeps([['document_id', 'filename']]))).rejects.toThrow(
      '2 列目が "study_id"',
    );
    const badRole = [...SHEET_ROW];
    badRole[2] = 'thesis';
    await expect(readDocuments('sid', makeDeps([HEADER, badRole]))).rejects.toThrow(
      'Documents 2 行目: document_role "thesis" が不正です',
    );
    const badStatus = [...SHEET_ROW];
    badStatus[9] = 'scanned';
    await expect(readDocuments('sid', makeDeps([HEADER, badStatus]))).rejects.toThrow(
      'Documents 2 行目: text_status "scanned" が不正です',
    );
    const badCount = [...SHEET_ROW];
    badCount[10] = 'twelve';
    await expect(readDocuments('sid', makeDeps([HEADER, badCount]))).rejects.toThrow(
      'page_count "twelve" が整数ではありません',
    );
    await expect(readDocuments('sid', makeDeps([HEADER, SHEET_ROW, SHEET_ROW]))).rejects.toThrow(
      '同一 document_id の行が複数あります（doc-1）',
    );
    const badReason = [...SHEET_ROW];
    badReason[16] = 'weird';
    await expect(readDocuments('sid', makeDeps([HEADER, badReason]))).rejects.toThrow(
      'Documents 2 行目: exclusion_reason "weird" が不正です',
    );
  });

  test('16 列目以降の列名不一致（存在する列のみ検証）は throw', async () => {
    const badHeader = [...HEADER];
    badHeader[15] = 'is_excluded';
    await expect(readDocuments('sid', makeDeps([badHeader, SHEET_ROW]))).rejects.toThrow(
      'Documents のヘッダ 16 列目が "excluded" ではありません（実際: "is_excluded"）',
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
    await updateDocument('sid', makeDocument({ studyId: 'study-1-rct' }), deps);
    const put = deps.fetch.mock.calls.find(
      ([, init]) => (init as RequestInit | undefined)?.method === 'PUT',
    );
    expect(decodeURIComponent(put?.[0] as string)).toContain('Documents!A3?valueInputOption=RAW');
    const body = JSON.parse((put?.[1] as RequestInit).body as string);
    expect(body.values[0][1]).toBe('study-1-rct');
  });

  test('該当行が無ければ throw', async () => {
    const deps = makeDeps([HEADER]);
    await expect(updateDocument('sid', makeDocument(), deps)).rejects.toThrow(
      'document_id "doc-1" の行がありません',
    );
  });
});

describe('updateDocuments', () => {
  test('1 read + values:batchUpdate 1 回で複数行を上書きする（issue #68）', async () => {
    const row2 = [...SHEET_ROW];
    row2[0] = 'doc-2';
    const deps = makeDeps([HEADER, SHEET_ROW, row2]);
    await updateDocuments(
      'sid',
      [
        makeDocument({ pmid: '999' }),
        makeDocument({ documentId: 'doc-2', doi: '10.2000/abc' }),
      ],
      deps,
    );
    // 1 回目 = Documents GET（行番号解決）、2 回目 = values:batchUpdate POST
    expect(deps.fetch).toHaveBeenCalledTimes(2);
    const [url, init] = deps.fetch.mock.calls[1];
    expect(url as string).toContain('/values:batchUpdate');
    const body = JSON.parse((init as RequestInit).body as string);
    expect(body.data.map((d: { range: string }) => d.range)).toEqual([
      'Documents!A2',
      'Documents!A3',
    ]);
    expect(body.data[0].values[0][6]).toBe('999');
    expect(body.data[1].values[0][7]).toBe('10.2000/abc');
  });

  test('該当行が無ければ throw・空配列は no-op', async () => {
    const deps = makeDeps([HEADER]);
    await expect(updateDocuments('sid', [makeDocument()], deps)).rejects.toThrow(
      'document_id "doc-1" の行がありません',
    );

    const empty = makeDeps([HEADER]);
    await updateDocuments('sid', [], empty);
    expect(empty.fetch).not.toHaveBeenCalled();
  });
});

describe('ensureDocumentExclusionColumns（issue #181: 既存プロジェクトの後方互換移行）', () => {
  /** getBatchValues（GET .../values:batchGet）と updateRow（PUT .../values/Documents!A1）を
   *  method で出し分けるモック fetch。headerRow が undefined ならヘッダ行なし（空シート）を模す */
  function optionalColumnsDeps(headerRow: string[] | undefined): MockDeps {
    const fetch = jest.fn(async (_url: string, init?: RequestInit) => {
      const method = init?.method ?? 'GET';
      if (method === 'GET') {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            valueRanges: headerRow === undefined ? [] : [{ values: [headerRow] }],
          }),
          text: async () => '',
        } as Response;
      }
      // updateRow（ヘッダ拡張の PUT）
      return { ok: true, status: 200, json: async () => ({}), text: async () => '' } as Response;
    });
    return { fetch, getAccessToken: jest.fn().mockResolvedValue('token') };
  }

  function findPut(d: MockDeps): [string, RequestInit] | undefined {
    return d.fetch.mock.calls.find(([, init]) => (init as RequestInit)?.method === 'PUT') as
      | [string, RequestInit]
      | undefined;
  }

  test('旧 15 列ヘッダはフルヘッダ（19 列）へ拡張する（PUT）', async () => {
    const d = optionalColumnsDeps([...LEGACY_HEADER]);
    await ensureDocumentExclusionColumns('sid', d);
    const putCall = findPut(d);
    expect(putCall).toBeDefined();
    const [url, init] = putCall as [string, RequestInit];
    expect(decodeURIComponent(url)).toContain('/sid/values/Documents!A1');
    const body = JSON.parse(init.body as string) as { values: string[][] };
    expect(body.values).toEqual([[...SHEET_HEADERS.Documents]]);
  });

  test('既にフル列数（拡張済み）なら no-op（PUT を呼ばない）', async () => {
    const d = optionalColumnsDeps([...SHEET_HEADERS.Documents]);
    await ensureDocumentExclusionColumns('sid', d);
    expect(findPut(d)).toBeUndefined();
  });

  test('先頭 15 列が SHEET_HEADERS.Documents と不一致なら throw し、PUT は呼ばない（壊れたプロジェクトへの書き込み防止）', async () => {
    const badHeader = [...LEGACY_HEADER];
    badHeader[2] = 'wrong'; // document_role のはずが不一致
    const d = optionalColumnsDeps(badHeader);
    await expect(ensureDocumentExclusionColumns('sid', d)).rejects.toThrow(
      'Documents のヘッダ 3 列目が "document_role" ではありません',
    );
    expect(findPut(d)).toBeUndefined();
  });

  test('既存の任意列（16 列目）が excluded 以外なら throw し、PUT は呼ばない（未知の列を上書きしない）', async () => {
    const badHeader = [...LEGACY_HEADER, 'custom_column'];
    const d = optionalColumnsDeps(badHeader);
    await expect(ensureDocumentExclusionColumns('sid', d)).rejects.toThrow(
      'Documents のヘッダ 16 列目が "excluded" ではありません（実際: "custom_column"）',
    );
    expect(findPut(d)).toBeUndefined();
  });

  test('ヘッダ行が無い（空シート）場合も列不一致として throw する', async () => {
    const d = optionalColumnsDeps(undefined);
    await expect(ensureDocumentExclusionColumns('sid', d)).rejects.toThrow(
      'Documents のヘッダ 1 列目が "document_id" ではありません',
    );
  });
});
