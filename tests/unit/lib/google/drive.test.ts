import {
  copyFile,
  createFolder,
  ensureChildFolder,
  ensureRootFolder,
  getFileBinary,
  getFileText,
  listFolderPdfs,
  moveFileToFolder,
  shareFileWithUser,
  uploadBinaryFile,
  uploadTextFile,
} from '../../../../src/lib/google/drive';

function okJson(body: unknown): Response {
  return {
    ok: true,
    status: 200,
    json: async () => body,
    text: async () => JSON.stringify(body),
  } as Response;
}

function okText(body: string): Response {
  return {
    ok: true,
    status: 200,
    json: async () => ({}),
    text: async () => body,
  } as Response;
}

/**
 * jsdom の Blob には text()/arrayBuffer() が無い（jsdom の File が text()/arrayBuffer() を
 * 持たないのと同じ制約）ため、Blob コンストラクタを差し替えて渡された parts を直接検証する。
 */
async function captureBlobParts<T>(
  run: () => Promise<T>,
): Promise<{ result: T; parts: BlobPart[] }> {
  const holder: { parts: BlobPart[] } = { parts: [] };
  const OriginalBlob = globalThis.Blob;
  class SpyBlob extends OriginalBlob {
    constructor(parts: BlobPart[] = [], options?: BlobPropertyBag) {
      super(parts, options);
      holder.parts = parts;
    }
  }
  (globalThis as unknown as { Blob: typeof Blob }).Blob = SpyBlob as unknown as typeof Blob;
  try {
    const result = await run();
    return { result, parts: holder.parts };
  } finally {
    (globalThis as unknown as { Blob: typeof Blob }).Blob = OriginalBlob;
  }
}

describe('createFolder', () => {
  test('親フォルダ指定で作成', async () => {
    const fetch = jest.fn().mockResolvedValue(okJson({ id: 'F1', webViewLink: 'https://drive/x' }));
    const deps = { fetch, getAccessToken: jest.fn().mockResolvedValue('t') };
    const result = await createFolder('sub', 'PARENT', deps);
    expect(result).toEqual({ id: 'F1', webViewLink: 'https://drive/x' });
    const [url, init] = fetch.mock.calls[0];
    expect(url).toContain('/drive/v3/files?fields=id,webViewLink');
    const body = JSON.parse((init as RequestInit).body as string);
    expect(body).toEqual({
      name: 'sub',
      mimeType: 'application/vnd.google-apps.folder',
      parents: ['PARENT'],
    });
  });

  test('親 null ならマイドライブ直下（parents 未指定）', async () => {
    const fetch = jest.fn().mockResolvedValue(okJson({ id: 'F1', webViewLink: '' }));
    const deps = { fetch, getAccessToken: jest.fn().mockResolvedValue('t') };
    await createFolder('root', null, deps);
    const body = JSON.parse((fetch.mock.calls[0][1] as RequestInit).body as string);
    expect(body.parents).toBeUndefined();
    expect(body.folderColorRgb).toBeUndefined();
  });

  test('folderColorRgb 指定で色付きフォルダを作成', async () => {
    const fetch = jest.fn().mockResolvedValue(okJson({ id: 'F1', webViewLink: '' }));
    const deps = { fetch, getAccessToken: jest.fn().mockResolvedValue('t') };
    await createFolder('SR Data Extraction', null, deps, { folderColorRgb: '#e9318f' });
    const body = JSON.parse((fetch.mock.calls[0][1] as RequestInit).body as string);
    expect(body.folderColorRgb).toBe('#e9318f');
  });
});

describe('uploadTextFile', () => {
  test('multipart 本文に metadata + content が入る', async () => {
    const fetch = jest
      .fn()
      .mockResolvedValue(okJson({ id: 'file-1', webViewLink: 'https://drive/y' }));
    const deps = { fetch, getAccessToken: jest.fn().mockResolvedValue('t') };
    const result = await uploadTextFile(
      { name: 'log.json', content: '{"a":1}', parentId: 'FOLDER', mimeType: 'application/json' },
      deps,
    );
    expect(result).toEqual({ id: 'file-1', webViewLink: 'https://drive/y' });
    const [url, init] = fetch.mock.calls[0];
    expect(url).toContain('/upload/drive/v3/files?uploadType=multipart');
    const body = (init as RequestInit).body as string;
    expect(body).toContain('"name":"log.json"');
    expect(body).toContain('"parents":["FOLDER"]');
    expect(body).toContain('{"a":1}');
    expect(body).toContain('application/json; charset=UTF-8');
  });

  test('mimeType 未指定なら text/plain', async () => {
    const fetch = jest.fn().mockResolvedValue(okJson({ id: 'f', webViewLink: '' }));
    const deps = { fetch, getAccessToken: jest.fn().mockResolvedValue('t') };
    await uploadTextFile({ name: 'note.txt', content: 'hi', parentId: 'P' }, deps);
    const body = (fetch.mock.calls[0][1] as RequestInit).body as string;
    expect(body).toContain('text/plain; charset=UTF-8');
  });
});

describe('uploadBinaryFile', () => {
  test('multipart/related の Blob 本文に metadata + バイナリを乗せる', async () => {
    const fetch = jest
      .fn()
      .mockResolvedValue(okJson({ id: 'file-2', webViewLink: 'https://drive/z' }));
    const deps = { fetch, getAccessToken: jest.fn().mockResolvedValue('t') };
    const data = new Uint8Array([1, 2, 3]).buffer;
    const { result, parts } = await captureBlobParts(() =>
      uploadBinaryFile({ name: 'smith2020.pdf', data, parentId: 'DOCS' }, deps),
    );
    expect(result).toEqual({ id: 'file-2', webViewLink: 'https://drive/z' });
    const [url, init] = fetch.mock.calls[0];
    expect(url).toContain('/upload/drive/v3/files?uploadType=multipart');
    const initArg = init as RequestInit;
    expect((initArg.headers as Headers).get('Content-Type')).toMatch(
      /^multipart\/related; boundary=/,
    );
    expect(initArg.body).toBeInstanceOf(Blob);
    // parts = [boundary+json ヘッダ, metadata 文字列, boundary+バイナリヘッダ, data, 終端boundary]
    expect(parts[0]).toContain('Content-Type: application/json; charset=UTF-8');
    expect(parts[1]).toBe(JSON.stringify({ name: 'smith2020.pdf', parents: ['DOCS'] }));
    expect(parts[2]).toContain('Content-Type: application/pdf');
    expect(parts[3]).toBe(data);
    expect(parts[4]).toContain('--');
  });

  test('mimeType 未指定なら application/pdf', async () => {
    const fetch = jest.fn().mockResolvedValue(okJson({ id: 'f', webViewLink: '' }));
    const deps = { fetch, getAccessToken: jest.fn().mockResolvedValue('t') };
    const { parts } = await captureBlobParts(() =>
      uploadBinaryFile({ name: 'a.pdf', data: new Uint8Array([1]).buffer, parentId: 'P' }, deps),
    );
    expect(parts[2]).toContain('Content-Type: application/pdf');
  });

  test('mimeType を指定すればそれを使う', async () => {
    const fetch = jest.fn().mockResolvedValue(okJson({ id: 'f', webViewLink: '' }));
    const deps = { fetch, getAccessToken: jest.fn().mockResolvedValue('t') };
    const { parts } = await captureBlobParts(() =>
      uploadBinaryFile(
        {
          name: 'a.bin',
          data: new Uint8Array([1]).buffer,
          parentId: 'P',
          mimeType: 'application/octet-stream',
        },
        deps,
      ),
    );
    expect(parts[2]).toContain('Content-Type: application/octet-stream');
  });
});

describe('ensureChildFolder', () => {
  test('既存フォルダがあれば再利用する', async () => {
    const fetch = jest
      .fn()
      .mockResolvedValueOnce(
        okJson({ files: [{ id: 'F1', webViewLink: 'https://drive/existing' }] }),
      );
    const deps = { fetch, getAccessToken: jest.fn().mockResolvedValue('t') };
    await expect(ensureChildFolder('raw_protocols', 'PARENT', deps)).resolves.toEqual({
      id: 'F1',
      webViewLink: 'https://drive/existing',
    });
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(fetch.mock.calls[0][0]).toContain('q=');
  });

  test('既存フォルダが無ければ作成する', async () => {
    const fetch = jest
      .fn()
      .mockResolvedValueOnce(okJson({ files: [] }))
      .mockResolvedValueOnce(okJson({ id: 'F2', webViewLink: 'https://drive/new' }));
    const deps = { fetch, getAccessToken: jest.fn().mockResolvedValue('t') };
    await expect(ensureChildFolder('extracted_texts', 'PARENT', deps)).resolves.toEqual({
      id: 'F2',
      webViewLink: 'https://drive/new',
    });
    expect(fetch).toHaveBeenCalledTimes(2);
    const createBody = JSON.parse((fetch.mock.calls[1][1] as RequestInit).body as string);
    expect(createBody.name).toBe('extracted_texts');
  });
});

describe('ensureRootFolder', () => {
  test('既存フォルダがあれば再利用する（POST は呼ばない）', async () => {
    const fetch = jest
      .fn()
      .mockResolvedValueOnce(
        okJson({ files: [{ id: 'ROOT1', webViewLink: 'https://drive/root' }] }),
      );
    const deps = { fetch, getAccessToken: jest.fn().mockResolvedValue('t') };
    const result = await ensureRootFolder('SR Data Extraction', deps);
    expect(result).toEqual({ id: 'ROOT1', webViewLink: 'https://drive/root' });
    expect(fetch).toHaveBeenCalledTimes(1);
    const [url] = fetch.mock.calls[0] as [string, RequestInit];
    const decoded = decodeURIComponent(url);
    expect(decoded).toContain("'root' in parents");
    expect(decoded).toContain("name='SR Data Extraction'");
  });

  test('既存フォルダが無ければ新規作成する（親 undefined でマイドライブ直下・色指定を引き継ぐ）', async () => {
    const fetch = jest
      .fn()
      .mockResolvedValueOnce(okJson({ files: [] }))
      .mockResolvedValueOnce(okJson({ id: 'ROOT2', webViewLink: 'https://drive/new-root' }));
    const deps = { fetch, getAccessToken: jest.fn().mockResolvedValue('t') };
    const result = await ensureRootFolder('SR Data Extraction', deps, {
      folderColorRgb: '#e9318f',
    });
    expect(result).toEqual({ id: 'ROOT2', webViewLink: 'https://drive/new-root' });
    expect(fetch).toHaveBeenCalledTimes(2);
    const createBody = JSON.parse((fetch.mock.calls[1] as [string, RequestInit])[1].body as string);
    expect(createBody.name).toBe('SR Data Extraction');
    expect(createBody.parents).toBeUndefined();
    expect(createBody.folderColorRgb).toBe('#e9318f');
  });
});

describe('moveFileToFolder', () => {
  test('現在の親を removeParents に、移動先を addParents に指定する', async () => {
    const fetch = jest
      .fn()
      .mockResolvedValueOnce(okJson({ parents: ['root'] }))
      .mockResolvedValueOnce(okJson({ id: 'SID', parents: ['DEST'] }));
    const deps = { fetch, getAccessToken: jest.fn().mockResolvedValue('t') };
    await moveFileToFolder('SID', 'DEST', deps);
    expect(fetch).toHaveBeenCalledTimes(2);
    const [getUrl] = fetch.mock.calls[0] as [string, RequestInit];
    expect(getUrl).toContain('/drive/v3/files/SID?fields=parents');
    const [patchUrl, patchInit] = fetch.mock.calls[1] as [string, RequestInit];
    expect(patchInit.method).toBe('PATCH');
    const decoded = decodeURIComponent(patchUrl);
    expect(decoded).toContain('addParents=DEST');
    expect(decoded).toContain('removeParents=root');
  });

  test('親が無ければ removeParents を付けない', async () => {
    const fetch = jest
      .fn()
      .mockResolvedValueOnce(okJson({}))
      .mockResolvedValueOnce(okJson({ id: 'SID' }));
    const deps = { fetch, getAccessToken: jest.fn().mockResolvedValue('t') };
    await moveFileToFolder('SID', 'DEST', deps);
    const [patchUrl] = fetch.mock.calls[1] as [string, RequestInit];
    expect(patchUrl).not.toContain('removeParents');
    expect(decodeURIComponent(patchUrl)).toContain('addParents=DEST');
  });
});

describe('getFileText', () => {
  test('alt=media で本文を取得', async () => {
    const fetch = jest.fn().mockResolvedValue(okText('hello world'));
    const deps = { fetch, getAccessToken: jest.fn().mockResolvedValue('t') };
    await expect(getFileText('FILE-id', deps)).resolves.toBe('hello world');
    const [url] = fetch.mock.calls[0];
    expect(url).toContain('/drive/v3/files/FILE-id?alt=media');
  });
});

describe('getFileBinary', () => {
  test('alt=media でバイナリ実体を取得', async () => {
    const bytes = new Uint8Array([1, 2, 3]).buffer;
    const fetch = jest.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({}),
      text: async () => '',
      arrayBuffer: async () => bytes,
    } as Response);
    const deps = { fetch, getAccessToken: jest.fn().mockResolvedValue('t') };
    await expect(getFileBinary('FILE-id', deps)).resolves.toBe(bytes);
    const [url] = fetch.mock.calls[0];
    expect(url).toContain('/drive/v3/files/FILE-id?alt=media');
  });
});

describe('listFolderPdfs', () => {
  test('PDF フィルタ + 直下フォルダのクエリを組み立てる（単一ページ）', async () => {
    const fetch = jest
      .fn()
      .mockResolvedValueOnce(
        okJson({
          files: [
            { id: 'p1', name: 'a.pdf' },
            { id: 'p2', name: 'b.pdf' },
          ],
        }),
      );
    const deps = { fetch, getAccessToken: jest.fn().mockResolvedValue('t') };
    await expect(listFolderPdfs('FOLDER', deps)).resolves.toEqual([
      { id: 'p1', name: 'a.pdf' },
      { id: 'p2', name: 'b.pdf' },
    ]);
    expect(fetch).toHaveBeenCalledTimes(1);
    const [url] = fetch.mock.calls[0] as [string, RequestInit];
    // URLSearchParams はスペースを + で符号化するため空白へ戻してから検証する
    const decoded = decodeURIComponent(url).replace(/\+/g, ' ');
    expect(decoded).toContain("'FOLDER' in parents");
    expect(decoded).toContain("mimeType='application/pdf'");
    expect(decoded).toContain('trashed=false');
    expect(decoded).toContain('pageSize=1000');
    expect(decoded).toContain('orderBy=name');
    expect(url).not.toContain('pageToken');
  });

  test('nextPageToken をたどって全ページを結合する', async () => {
    const fetch = jest
      .fn()
      .mockResolvedValueOnce(okJson({ files: [{ id: 'p1', name: 'a.pdf' }], nextPageToken: 'T2' }))
      .mockResolvedValueOnce(okJson({ files: [{ id: 'p2', name: 'b.pdf' }] }));
    const deps = { fetch, getAccessToken: jest.fn().mockResolvedValue('t') };
    await expect(listFolderPdfs('FOLDER', deps)).resolves.toEqual([
      { id: 'p1', name: 'a.pdf' },
      { id: 'p2', name: 'b.pdf' },
    ]);
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(fetch.mock.calls[1][0]).toContain('pageToken=T2');
  });

  test('files 欠落は空配列として扱う', async () => {
    const fetch = jest.fn().mockResolvedValueOnce(okJson({}));
    const deps = { fetch, getAccessToken: jest.fn().mockResolvedValue('t') };
    await expect(listFolderPdfs('EMPTY', deps)).resolves.toEqual([]);
  });
});

describe('copyFile', () => {
  test('files.copy でコピー先フォルダと名前を指定する', async () => {
    const fetch = jest
      .fn()
      .mockResolvedValue(okJson({ id: 'COPY-1', webViewLink: 'https://drive/copy' }));
    const deps = { fetch, getAccessToken: jest.fn().mockResolvedValue('t') };
    const result = await copyFile('SRC-1', { name: 'smith2020.pdf', parentId: 'DOCS' }, deps);
    expect(result).toEqual({ id: 'COPY-1', webViewLink: 'https://drive/copy' });
    const [url, init] = fetch.mock.calls[0];
    expect(url).toContain('/drive/v3/files/SRC-1/copy?fields=id,webViewLink');
    expect((init as RequestInit).method).toBe('POST');
    const body = JSON.parse((init as RequestInit).body as string);
    expect(body).toEqual({ name: 'smith2020.pdf', parents: ['DOCS'] });
  });
});

describe('shareFileWithUser', () => {
  test('permissions.create を writer/type=user で投げる（既定は通知メールなし）', async () => {
    const fetch = jest.fn().mockResolvedValue(okJson({ id: 'perm-1' }));
    const deps = { fetch, getAccessToken: jest.fn().mockResolvedValue('t') };
    await shareFileWithUser('SHEET-1', 'r1@example.com', 'writer', deps);
    const [url, init] = fetch.mock.calls[0];
    expect(url).toContain('/drive/v3/files/SHEET-1/permissions');
    expect(url).toContain('sendNotificationEmail=false');
    expect((init as RequestInit).method).toBe('POST');
    expect(JSON.parse((init as RequestInit).body as string)).toEqual({
      role: 'writer',
      type: 'user',
      emailAddress: 'r1@example.com',
    });
  });

  test('sendNotificationEmail=true を指定すると通知ありで共有する', async () => {
    const fetch = jest.fn().mockResolvedValue(okJson({ id: 'perm-2' }));
    const deps = { fetch, getAccessToken: jest.fn().mockResolvedValue('t') };
    await shareFileWithUser('FOLDER-1', 'r2@example.com', 'reader', deps, {
      sendNotificationEmail: true,
    });
    const [url] = fetch.mock.calls[0];
    expect(url).toContain('/drive/v3/files/FOLDER-1/permissions');
    expect(url).toContain('sendNotificationEmail=true');
  });
});
