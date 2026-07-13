// tiab-review シート直読み I/O のテスト（issue #68）。
// References / Decisions は values:batchGet 1 回、Config は別 GET（欠落は null）で読むこと、
// GoogleApiError のユーザー向け文言変換を検証する
import { readTiabSheet } from '../../../../src/features/documents/tiabSheetReader';

const REF_HEADER = ['ref_id', 'title', 'abstract', 'year', 'authors', 'doi', 'pmid', 'fulltext_url'];
const DEC_HEADER = ['decision_id', 'ref_id', 'reviewer_id', 'decision', 'reason', 'labels', 'note', 'decided_at', 'client_version', 'source_url', 'screening_phase'];

function okJson(body: unknown): Response {
  return {
    ok: true,
    status: 200,
    json: async () => body,
    text: async () => JSON.stringify(body),
  } as Response;
}

function errorResponse(status: number): Response {
  return {
    ok: false,
    status,
    json: async () => ({}),
    text: async () => '',
    headers: new Headers(),
  } as unknown as Response;
}

function makeDeps(
  handler: (url: string) => Response | Promise<Response>,
): { fetch: typeof fetch; getAccessToken: () => Promise<string> } {
  return {
    fetch: jest.fn(async (input: RequestInfo | URL) =>
      handler(decodeURIComponent(String(input)))) as unknown as typeof fetch,
    getAccessToken: async () => 'token',
  };
}

describe('readTiabSheet', () => {
  test('References / Decisions を batchGet で読み、Config の採用ラウンドを返す', async () => {
    const deps = makeDeps((url) => {
      if (url.includes('values:batchGet')) {
        expect(url).toContain('ranges=References');
        expect(url).toContain('ranges=Decisions');
        return okJson({
          valueRanges: [
            { values: [REF_HEADER, ['r1', 'T1', '', '2020', 'Smith, J', '', '', '']] },
            { values: [DEC_HEADER, ['d1', 'r1', 'a@example.com', 'include', '', '', '', 't1', '', '', 'fulltext']] },
          ],
        });
      }
      expect(url).toContain('/values/Config');
      return okJson({ values: [['keyOpened', 'true'], ['fulltext_ai_active_round', ' llm:round-1 ']] });
    });

    const data = await readTiabSheet('sheet-1', deps);
    expect(data.references).toHaveLength(1);
    expect(data.references[0]).toMatchObject({ refId: 'r1', title: 'T1', year: 2020 });
    expect(data.decisions).toHaveLength(1);
    expect(data.decisions[0]).toMatchObject({ refId: 'r1', screeningPhase: 'fulltext' });
    expect(data.activeFulltextAiRound).toBe('llm:round-1');
  });

  test('Config の採用ラウンドが空値なら null、Config タブ欠落（読み出し失敗）も null', async () => {
    const emptyRound = makeDeps((url) =>
      url.includes('values:batchGet')
        ? okJson({ valueRanges: [{ values: [REF_HEADER] }, { values: [DEC_HEADER] }] })
        : okJson({ values: [['fulltext_ai_active_round', '']] }),
    );
    await expect(readTiabSheet('sheet-1', emptyRound)).resolves.toMatchObject({
      activeFulltextAiRound: null,
    });

    // 値セルが欠落したラグ行（B 列なし）も null 扱い
    const raggedRound = makeDeps((url) =>
      url.includes('values:batchGet')
        ? okJson({ valueRanges: [{ values: [REF_HEADER] }, { values: [DEC_HEADER] }] })
        : okJson({ values: [['fulltext_ai_active_round']] }),
    );
    await expect(readTiabSheet('sheet-1', raggedRound)).resolves.toMatchObject({
      activeFulltextAiRound: null,
    });

    const missingConfig = makeDeps((url) =>
      url.includes('values:batchGet')
        ? okJson({ valueRanges: [{ values: [REF_HEADER] }, { values: [DEC_HEADER] }] })
        : errorResponse(400),
    );
    await expect(readTiabSheet('sheet-1', missingConfig)).resolves.toMatchObject({
      activeFulltextAiRound: null,
    });
  });

  test('batchGet の 400（タブ欠落）は tiab-review シートでない旨のエラーへ変換する', async () => {
    const deps = makeDeps(() => errorResponse(400));
    await expect(readTiabSheet('sheet-1', deps)).rejects.toThrow(
      'References / Decisions タブが見つかりません。tiab-review のスプレッドシートを指定してください',
    );
  });

  test('403 / 404 はアクセス確認のエラーへ変換する', async () => {
    for (const status of [403, 404]) {
      const deps = makeDeps(() => errorResponse(status));
      await expect(readTiabSheet('sheet-1', deps)).rejects.toThrow(
        'スプレッドシートを開けません。URL / ID と、同じ Google アカウントでアクセスできることを確認してください',
      );
    }
  });

  test('その他の GoogleApiError はそのまま伝播する', async () => {
    const deps = makeDeps(() => errorResponse(500));
    // 500 は googleFetch 側のリトライ対象外（429 / 503 のみ）のため即 throw される
    await expect(readTiabSheet('sheet-1', deps)).rejects.toThrow('Google API failed: HTTP 500');
  });

  test('Error 以外の失敗は文字列化して Error にする', async () => {
    const deps = {
      fetch: jest.fn(async () => {
        throw 'network down';
      }) as unknown as typeof fetch,
      getAccessToken: async () => 'token',
    };
    await expect(readTiabSheet('sheet-1', deps)).rejects.toThrow('network down');
  });

  test('References のヘッダが不正なら parse エラーを伝播する', async () => {
    const deps = makeDeps((url) =>
      url.includes('values:batchGet')
        ? okJson({ valueRanges: [{ values: [['id', 'name']] }, { values: [DEC_HEADER] }] })
        : okJson({ values: [] }),
    );
    await expect(readTiabSheet('sheet-1', deps)).rejects.toThrow(
      'References タブに ref_id / title 列が見つかりません',
    );
  });
});
