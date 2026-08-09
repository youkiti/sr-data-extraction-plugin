// lib/diagnostics/apiErrorLog.ts のユニットテスト（issue #249）。
// recordApiErrorLog / withApiErrorLogging は fire-and-forget（内部の async 処理を await しない）
// ため、各テストは chrome.storage.local への読み書きが確定するまで flush() で
// マクロタスク境界を 1 回挟んでから検証する（tests/unit/options/bootstrap.test.ts と同じ手法）
import { SHEET_HEADERS } from '../../../../src/domain/sheetsSchema';
import {
  API_ERROR_LOG_FLUSH_BATCH_LIMIT,
  API_ERROR_LOG_MESSAGE_MAX_LENGTH,
  API_ERROR_LOG_QUEUE_LIMIT,
  configureApiErrorLog,
  flushApiErrorLogQueue,
  recordApiErrorLog,
  withApiErrorLogging,
} from '../../../../src/lib/diagnostics/apiErrorLog';
import { GoogleApiError } from '../../../../src/lib/google/types';
import { installChromeMock, type ChromeMock } from '../../../setup/chrome-mock';

interface MockDeps {
  fetch: jest.Mock;
  getAccessToken: jest.Mock;
}

/**
 * Sheets API スタブ:
 * - `fields=sheets.properties.title` → タブ名一覧（options.titles）
 * - それ以外の書き込み系（POST/PUT）は options.failWrite が true なら 500 を返す
 * - それ以外は成功応答のみ返す（本モジュールは応答の中身を見ない）
 */
function makeGoogleDeps(options: { titles?: string[]; failWrite?: boolean } = {}): MockDeps {
  const titles = options.titles ?? ['Meta', 'ApiErrorLog'];
  const fetch = jest.fn().mockImplementation(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const method = init?.method ?? 'GET';
    if (url.includes('fields=sheets.properties.title')) {
      return {
        ok: true,
        status: 200,
        json: async () => ({ sheets: titles.map((t) => ({ properties: { title: t } })) }),
        text: async () => '',
      } as Response;
    }
    if (options.failWrite && method !== 'GET') {
      return {
        ok: false,
        status: 500,
        json: async () => ({}),
        text: async () => 'server down',
      } as Response;
    }
    return { ok: true, status: 200, json: async () => ({}), text: async () => '' } as Response;
  });
  return { fetch, getAccessToken: jest.fn().mockResolvedValue('token') };
}

/**
 * ApiErrorLog への :append POST だけを任意のタイミングで解決できる Sheets API スタブ
 * （F1 回帰テスト用）。タブ名一覧は常に ['Meta', 'ApiErrorLog']（既にタブがある状態）を返し、
 * それ以外の書き込み（addSheetTab 等）は使わない前提。releaseAppend() を呼ぶまで
 * :append の fetch は pending のままになる = appendRows の待ちを決定的に作り出せる
 */
function makeGatedGoogleDeps(): { deps: MockDeps; releaseAppend: () => void } {
  let releaseAppend: () => void = () => undefined;
  const appendGate = new Promise<void>((resolve) => {
    releaseAppend = resolve;
  });
  const fetch = jest.fn().mockImplementation(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const method = init?.method ?? 'GET';
    if (url.includes('fields=sheets.properties.title')) {
      return {
        ok: true,
        status: 200,
        json: async () => ({ sheets: [{ properties: { title: 'Meta' } }, { properties: { title: 'ApiErrorLog' } }] }),
        text: async () => '',
      } as Response;
    }
    if (method === 'POST' && url.includes('ApiErrorLog') && url.includes(':append')) {
      await appendGate; // releaseAppend() が呼ばれるまでここで止まる
    }
    return { ok: true, status: 200, json: async () => ({}), text: async () => '' } as Response;
  });
  return { deps: { fetch, getAccessToken: jest.fn().mockResolvedValue('token') }, releaseAppend };
}

function postCalls(deps: MockDeps): [string, RequestInit][] {
  return deps.fetch.mock.calls
    .filter(([, init]) => ((init as RequestInit | undefined)?.method ?? 'GET') === 'POST')
    .map(([url, init]) => [decodeURIComponent(String(url)), init as RequestInit]);
}

function appendCallOf(deps: MockDeps): [string, RequestInit] | undefined {
  return postCalls(deps).find(([url]) => url.includes('ApiErrorLog') && url.includes(':append'));
}

/** ApiErrorLog への :append POST 1 回ぶんの body から全行を取り出す */
function appendedRows(deps: MockDeps, callIndex = 0): unknown[][] {
  const calls = postCalls(deps).filter(([url]) => url.includes('ApiErrorLog') && url.includes(':append'));
  const call = calls[callIndex];
  if (!call) {
    throw new Error(`ApiErrorLog への append 呼び出しが ${callIndex} 番目にありません`);
  }
  const body = JSON.parse(String(call[1].body)) as { values: unknown[][] };
  return body.values;
}

/** fire-and-forget な非同期処理の完了を待つ（マクロタスク境界を 1 回挟む） */
const wait = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

describe('lib/diagnostics/apiErrorLog', () => {
  let chromeMock: ChromeMock;

  beforeEach(() => {
    chromeMock = installChromeMock();
    configureApiErrorLog(null);
  });

  afterEach(() => {
    configureApiErrorLog(null);
  });

  test('SHEET_HEADERS.ApiErrorLog の列順に対応する行を書く', async () => {
    const deps = makeGoogleDeps();
    configureApiErrorLog({ spreadsheetId: 'SID', loggedBy: 'me@example.com', appVersion: '1.2.3', google: deps });
    recordApiErrorLog({
      context: 'pdf_load',
      error: new GoogleApiError(
        'Google API failed: HTTP 500',
        500,
        'https://www.googleapis.com/drive/v3/files/FILE-1?alt=media',
        'server err',
        2,
      ),
      studyId: 'study-1',
      documentId: 'doc-1',
      newUuid: () => 'log-1',
      now: () => '2026-08-09T00:00:00Z',
    });
    await wait();

    const call = appendCallOf(deps);
    expect(call).toBeDefined();
    const rows = appendedRows(deps);
    expect(SHEET_HEADERS.ApiErrorLog).toHaveLength(11);
    expect(rows).toEqual([
      [
        'log-1',
        '2026-08-09T00:00:00Z',
        'me@example.com',
        'pdf_load',
        'drive.files.get',
        500,
        'Google API failed: HTTP 500: server err',
        'study-1',
        'doc-1',
        2,
        '1.2.3',
      ],
    ]);
  });

  test('未設定時はローカルキューへ積むだけでフラッシュしない。設定後にまとめてフラッシュされる', async () => {
    recordApiErrorLog({
      context: 'evidence_append',
      error: new Error('network down'),
      newUuid: () => 'log-2',
      now: () => 't1',
    });
    await wait();

    // 未設定のままだと flush は何もしない（flushedCount は常に 0）が、remainingCount には
    // ローカルキューの実件数を返す（「未設定 = 記録が消えている」わけではないことが分かるように）
    await expect(flushApiErrorLogQueue()).resolves.toEqual({ flushedCount: 0, remainingCount: 1 });

    const deps = makeGoogleDeps();
    configureApiErrorLog({ spreadsheetId: 'SID', loggedBy: 'me@example.com', appVersion: '1.0.0', google: deps });
    await expect(flushApiErrorLogQueue()).resolves.toEqual({ flushedCount: 1, remainingCount: 0 });
    expect(appendCallOf(deps)).toBeDefined();
  });

  test('ネットワーク層の失敗（GoogleApiError でない）は http_status を空にし api は unknown', async () => {
    const deps = makeGoogleDeps();
    configureApiErrorLog({ spreadsheetId: 'SID', loggedBy: 'me@example.com', appVersion: '1.0.0', google: deps });
    recordApiErrorLog({
      context: 'pdf_load',
      error: new TypeError('Failed to fetch'),
      newUuid: () => 'log-3',
      now: () => 't1',
    });
    await wait();
    const [row] = appendedRows(deps) as [unknown[]];
    expect(row[4]).toBe('unknown'); // api
    // null は appendRows が空セル（''）へ変換して送る（lib/google/sheets.ts appendRows の仕様）
    expect(row[5]).toBe(''); // http_status
    expect(row[6]).toBe('Failed to fetch'); // message
  });

  test('Error インスタンスでない throw も文字列化して message にする', async () => {
    const deps = makeGoogleDeps();
    configureApiErrorLog({ spreadsheetId: 'SID', loggedBy: 'me@example.com', appVersion: '1.0.0', google: deps });
    recordApiErrorLog({
      context: 'pdf_load',
      error: 'raw string failure',
      newUuid: () => 'log-4',
      now: () => 't1',
    });
    await wait();
    const [row] = appendedRows(deps) as [unknown[]];
    expect(row[6]).toBe('raw string failure');
  });

  test('GoogleApiError の responseBody が空文字なら message に ": " を付けない', async () => {
    const deps = makeGoogleDeps();
    configureApiErrorLog({ spreadsheetId: 'SID', loggedBy: 'me@example.com', appVersion: '1.0.0', google: deps });
    recordApiErrorLog({
      context: 'pdf_load',
      error: new GoogleApiError('Google API failed: HTTP 500', 500, 'https://www.googleapis.com/drive/v3/files/F1?alt=media', ''),
      newUuid: () => 'log-5',
      now: () => 't1',
    });
    await wait();
    const [row] = appendedRows(deps) as [unknown[]];
    expect(row[6]).toBe('Google API failed: HTTP 500');
  });

  test('message は API_ERROR_LOG_MESSAGE_MAX_LENGTH で打ち切る（responseBody を含む長文でも）', async () => {
    const deps = makeGoogleDeps();
    configureApiErrorLog({ spreadsheetId: 'SID', loggedBy: 'me@example.com', appVersion: '1.0.0', google: deps });
    const longBody = 'x'.repeat(1000);
    recordApiErrorLog({
      context: 'evidence_append',
      error: new GoogleApiError(
        'Google API failed: HTTP 403',
        403,
        'https://www.googleapis.com/drive/v3/files/F1/permissions',
        longBody,
      ),
      newUuid: () => 'log-6',
      now: () => 't1',
    });
    await wait();
    const [row] = appendedRows(deps) as [unknown[]];
    const message = row[6] as string;
    expect(message).toHaveLength(API_ERROR_LOG_MESSAGE_MAX_LENGTH);
    expect(message.startsWith('Google API failed: HTTP 403: xxx')).toBe(true);
    // 機密情報（トークン・Authorization ヘッダ・リクエストボディ）は一切含まれないことも固定する
    expect(message).not.toContain('Bearer');
    expect(message).not.toContain('Authorization');
  });

  test('newUuid / now を省略すると既定実装（crypto.randomUUID / ISO 8601 現在時刻）を使う', async () => {
    const deps = makeGoogleDeps();
    configureApiErrorLog({ spreadsheetId: 'SID', loggedBy: 'me@example.com', appVersion: '1.0.0', google: deps });
    recordApiErrorLog({ context: 'pdf_load', error: new Error('x') });
    await wait();
    const [row] = appendedRows(deps) as [unknown[]];
    expect(String(row[0])).toMatch(/^[0-9a-f-]{36}$/); // logId
    expect(String(row[1])).toMatch(/^\d{4}-\d{2}-\d{2}T/); // occurredAt
  });

  test('studyId / documentId を渡さなければ空（null）で記録する', async () => {
    const deps = makeGoogleDeps();
    configureApiErrorLog({ spreadsheetId: 'SID', loggedBy: 'me@example.com', appVersion: '1.0.0', google: deps });
    recordApiErrorLog({ context: 'decision_save', error: new Error('x'), newUuid: () => 'log-7', now: () => 't1' });
    await wait();
    const [row] = appendedRows(deps) as [unknown[]];
    expect(row[7]).toBe(''); // null は appendRows が空セルへ変換する
    expect(row[8]).toBe('');
  });

  test('ApiErrorLog タブが無ければ addSheetTab → writeHeaderRow の順で作成してから追記する', async () => {
    const deps = makeGoogleDeps({ titles: ['Meta'] }); // ApiErrorLog 無し
    configureApiErrorLog({ spreadsheetId: 'SID', loggedBy: 'me@example.com', appVersion: '1.0.0', google: deps });
    recordApiErrorLog({ context: 'decision_save', error: new Error('boom'), newUuid: () => 'log-8', now: () => 't1' });
    await wait();

    const posts = postCalls(deps);
    expect(posts.some(([url]) => url.endsWith('/SID:batchUpdate'))).toBe(true); // addSheetTab
    const putCalls = deps.fetch.mock.calls.filter(
      ([, init]) => ((init as RequestInit | undefined)?.method ?? 'GET') === 'PUT',
    );
    expect(putCalls.some(([url]) => String(url).includes('ApiErrorLog'))).toBe(true); // writeHeaderRow
    expect(appendCallOf(deps)).toBeDefined();
  });

  test('タブが既にあれば addSheetTab / writeHeaderRow を呼ばない', async () => {
    const deps = makeGoogleDeps({ titles: ['Meta', 'ApiErrorLog'] });
    configureApiErrorLog({ spreadsheetId: 'SID', loggedBy: 'me@example.com', appVersion: '1.0.0', google: deps });
    recordApiErrorLog({ context: 'decision_save', error: new Error('boom'), newUuid: () => 'log-9', now: () => 't1' });
    await wait();

    const posts = postCalls(deps);
    expect(posts.some(([url]) => url.endsWith('/SID:batchUpdate'))).toBe(false);
    const putCalls = deps.fetch.mock.calls.filter(
      ([, init]) => ((init as RequestInit | undefined)?.method ?? 'GET') === 'PUT',
    );
    expect(putCalls).toHaveLength(0);
  });

  test('キューが空なら flushApiErrorLogQueue は何もしない（API を呼ばない）', async () => {
    const deps = makeGoogleDeps();
    configureApiErrorLog({ spreadsheetId: 'SID', loggedBy: 'me@example.com', appVersion: '1.0.0', google: deps });
    await expect(flushApiErrorLogQueue()).resolves.toEqual({ flushedCount: 0, remainingCount: 0 });
    expect(deps.fetch).not.toHaveBeenCalled();
  });

  test('1 回の flush は API_ERROR_LOG_FLUSH_BATCH_LIMIT 件までで、残りは次回に持ち越す', async () => {
    const total = API_ERROR_LOG_FLUSH_BATCH_LIMIT + 5;
    for (let i = 0; i < total; i++) {
      recordApiErrorLog({
        context: 'pdf_load',
        error: new Error(`err-${i}`),
        newUuid: () => `log-${i}`,
        now: () => `t-${i}`,
      });
      // eslint-disable-next-line no-await-in-loop -- read-modify-write のキューへ直列で積む必要がある
      await wait();
    }

    const deps = makeGoogleDeps();
    configureApiErrorLog({ spreadsheetId: 'SID', loggedBy: 'me@example.com', appVersion: '1.0.0', google: deps });

    const first = await flushApiErrorLogQueue();
    expect(first).toEqual({ flushedCount: API_ERROR_LOG_FLUSH_BATCH_LIMIT, remainingCount: 5 });

    const second = await flushApiErrorLogQueue();
    expect(second).toEqual({ flushedCount: 5, remainingCount: 0 });
  });

  test('ローカルキューは上限件数を超えたら古い方から捨てる', async () => {
    const total = API_ERROR_LOG_QUEUE_LIMIT + 10;
    for (let i = 0; i < total; i++) {
      recordApiErrorLog({
        context: 'pdf_load',
        error: new Error(`err-${i}`),
        newUuid: () => `log-${i}`,
        now: () => `t-${i}`,
      });
      // eslint-disable-next-line no-await-in-loop -- read-modify-write のキューへ直列で積む必要がある
      await wait();
    }

    const deps = makeGoogleDeps();
    configureApiErrorLog({ spreadsheetId: 'SID', loggedBy: 'me@example.com', appVersion: '1.0.0', google: deps });

    let remaining = API_ERROR_LOG_QUEUE_LIMIT;
    while (remaining > 0) {
      // eslint-disable-next-line no-await-in-loop -- キューが空になるまで繰り返し flush する
      const result = await flushApiErrorLogQueue();
      remaining = result.remainingCount;
    }
    // 累積した POST 呼び出し（各回の :append）から全行を復元する
    const flushedIds: string[] = [];
    for (const [url, init] of postCalls(deps)) {
      if (url.includes('ApiErrorLog') && url.includes(':append')) {
        const body = JSON.parse(String(init.body)) as { values: string[][] };
        for (const row of body.values) {
          flushedIds.push(row[0] as string);
        }
      }
    }

    expect(flushedIds).toHaveLength(API_ERROR_LOG_QUEUE_LIMIT);
    // 先頭 10 件（log-0..log-9）は捨てられている
    expect(flushedIds).not.toContain('log-0');
    expect(flushedIds).not.toContain('log-9');
    // 直近 API_ERROR_LOG_QUEUE_LIMIT 件（log-10..log-{total-1}）は残っている
    expect(flushedIds).toContain('log-10');
    expect(flushedIds).toContain(`log-${total - 1}`);
  });

  test('ApiErrorLog 自体への書き込み失敗は再帰的にログされない（自己再帰防止）', async () => {
    recordApiErrorLog({ context: 'pdf_load', error: new Error('boom'), newUuid: () => 'log-x', now: () => 't' });
    await wait(); // 未設定なのでキューに 1 件だけ積まれる

    const deps = makeGoogleDeps({ titles: ['Meta', 'ApiErrorLog'], failWrite: true });
    configureApiErrorLog({ spreadsheetId: 'SID', loggedBy: 'me@example.com', appVersion: '1.0.0', google: deps });

    const result = await flushApiErrorLogQueue();
    expect(result).toEqual({ flushedCount: 0, remainingCount: 1 });

    // 再帰していれば remainingCount が増え続けるはずだが、何度呼んでも 1 件のまま
    const second = await flushApiErrorLogQueue();
    expect(second).toEqual({ flushedCount: 0, remainingCount: 1 });
  });

  test('chrome.storage.local の例外は握りつぶし、呼び出し元へ伝播しない', async () => {
    chromeMock.storage.local.get.mockRejectedValueOnce(new Error('storage broken'));
    expect(() =>
      recordApiErrorLog({
        context: 'pdf_load',
        error: new Error('x'),
        newUuid: () => 'log-broken',
        now: () => 't1',
      }),
    ).not.toThrow();
    await wait();

    // 直後の正常な呼び出しは通常どおり動く（1 回の例外で以降も壊れたままにならない）
    recordApiErrorLog({ context: 'pdf_load', error: new Error('y'), newUuid: () => 'log-ok', now: () => 't2' });
    await wait();

    const deps = makeGoogleDeps();
    configureApiErrorLog({ spreadsheetId: 'SID', loggedBy: 'me@example.com', appVersion: '1.0.0', google: deps });
    const result = await flushApiErrorLogQueue();
    expect(result.flushedCount).toBe(1);
  });

  describe('withApiErrorLogging', () => {
    test('成功時は結果を返し、保留中のキューがあればフラッシュを試みる（fire-and-forget）', async () => {
      recordApiErrorLog({
        context: 'pdf_load',
        error: new Error('prior failure'),
        newUuid: () => 'log-prior',
        now: () => 't0',
      });
      await wait();

      const deps = makeGoogleDeps();
      configureApiErrorLog({ spreadsheetId: 'SID', loggedBy: 'me@example.com', appVersion: '1.0.0', google: deps });

      await expect(withApiErrorLogging('pdf_load', {}, async () => 'ok')).resolves.toBe('ok');
      await wait();
      expect(appendCallOf(deps)).toBeDefined();
    });

    test('失敗時は記録してから元のエラーをそのまま rethrow する', async () => {
      const error = new GoogleApiError(
        'Google API failed: HTTP 429',
        429,
        'https://sheets.googleapis.com/v4/spreadsheets/SID/values/Evidence%21A1:append?valueInputOption=RAW&insertDataOption=INSERT_ROWS',
        '',
        1,
      );
      await expect(
        withApiErrorLogging('evidence_append', { studyId: 's1', documentId: 'd1' }, async () => {
          throw error;
        }),
      ).rejects.toBe(error);
      await wait();

      const deps = makeGoogleDeps();
      configureApiErrorLog({ spreadsheetId: 'SID', loggedBy: 'me@example.com', appVersion: '1.0.0', google: deps });
      const result = await flushApiErrorLogQueue();
      expect(result.flushedCount).toBe(1);
      const [row] = appendedRows(deps) as [unknown[]];
      expect(row[3]).toBe('evidence_append');
      expect(row[4]).toBe('sheets.values.append');
      expect(row[7]).toBe('s1');
      expect(row[8]).toBe('d1');
      expect(row[9]).toBe(1); // retry_count
    });

    test('studyId / documentId を渡さない呼び出し（getFileBinary 相当）は空（null）で記録する', async () => {
      const deps = makeGoogleDeps();
      configureApiErrorLog({ spreadsheetId: 'SID', loggedBy: 'me@example.com', appVersion: '1.0.0', google: deps });
      const error = new Error('pdf load failed');
      await expect(
        withApiErrorLogging('pdf_load', {}, async () => {
          throw error;
        }),
      ).rejects.toBe(error);
      await wait();
      // config 設定済みなので recordApiErrorLog 内部の自動フラッシュで既に書かれているはず
      const [row] = appendedRows(deps) as [unknown[]];
      expect(row[7]).toBe(''); // study_id（null は appendRows が空セルへ変換する）
      expect(row[8]).toBe(''); // document_id
    });

    test('shouldLog が false を返すエラーは記録せず、rethrow だけする', async () => {
      const deps = makeGoogleDeps();
      configureApiErrorLog({ spreadsheetId: 'SID', loggedBy: 'me@example.com', appVersion: '1.0.0', google: deps });
      class BusinessError extends Error {}
      const error = new BusinessError('conflict');

      await expect(
        withApiErrorLogging('annotation_upsert', { shouldLog: () => false }, async () => {
          throw error;
        }),
      ).rejects.toBe(error);
      await wait();

      await expect(flushApiErrorLogQueue()).resolves.toEqual({ flushedCount: 0, remainingCount: 0 });
      expect(postCalls(deps).some(([url]) => url.includes('ApiErrorLog'))).toBe(false);
    });
  });

  // 並行性の回帰テスト（レビュー指摘。issue #249 フォローアップ）:
  // withApiErrorLogging は成功のたびに flush を撃ち、1 操作の中で複数の計装対象が連続して
  // 走る経路もあるため、record 同士・flush 同士・record と flush が日常的に重なる。
  // F1〜F3 はそれぞれ「素朴な read-modify-write のままだと何が壊れるか」に対応する
  describe('並行性（F1〜F3 の回帰防止）', () => {
    test('F1: flush の appendRows 待ち中に記録されたエントリは、flush 完了後もキューに残る', async () => {
      recordApiErrorLog({
        context: 'pdf_load',
        error: new Error('first'),
        newUuid: () => 'log-a',
        now: () => 't0',
      });
      await wait();

      const { deps, releaseAppend } = makeGatedGoogleDeps();
      configureApiErrorLog({ spreadsheetId: 'SID', loggedBy: 'me@example.com', appVersion: '1.0.0', google: deps });

      const flushPromise = flushApiErrorLogQueue();
      await wait(); // appendRows の fetch 呼び出し（= gate 待ち）まで進める

      // flush が appendRows を待っている間に、別の失敗が記録される
      recordApiErrorLog({
        context: 'pdf_load',
        error: new Error('second'),
        newUuid: () => 'log-b',
        now: () => 't1',
      });
      await wait();

      releaseAppend();
      const result = await flushPromise;

      // 古いスナップショット（log-a のみ）の rest をそのまま書き戻していれば log-b が消える。
      // logId ベースの除外なら、appendRows 開始後に積まれた log-b は対象外のまま残る
      expect(result.flushedCount).toBe(1);
      expect(result.remainingCount).toBe(1);
      expect((appendedRows(deps)[0] as string[])[0]).toBe('log-a');

      // 残った log-b は次回の flush で送られる
      const second = await flushApiErrorLogQueue();
      expect(second).toEqual({ flushedCount: 1, remainingCount: 0 });
      expect((appendedRows(deps, 1)[0] as string[])[0]).toBe('log-b');
    });

    test('F2: flush を 2 つ同時に起動しても appendRows は 1 回しか呼ばれない（single-flight）', async () => {
      recordApiErrorLog({
        context: 'pdf_load',
        error: new Error('x'),
        newUuid: () => 'log-c',
        now: () => 't0',
      });
      await wait();

      const deps = makeGoogleDeps();
      configureApiErrorLog({ spreadsheetId: 'SID', loggedBy: 'me@example.com', appVersion: '1.0.0', google: deps });

      // 2 つの呼び出しを同一 tick で起動する（single-flight ガードが効けば同じ Promise に合流する）
      const [first, second] = await Promise.all([flushApiErrorLogQueue(), flushApiErrorLogQueue()]);
      expect(first).toEqual(second);
      expect(first).toEqual({ flushedCount: 1, remainingCount: 0 });

      const appendCalls = postCalls(deps).filter(
        ([url]) => url.includes('ApiErrorLog') && url.includes(':append'),
      );
      expect(appendCalls).toHaveLength(1); // 二重書き込みなし
    });

    test('F3: recordApiErrorLog を複数同時に撃っても、全件がキューに残る（await を挟まなくても競合しない）', async () => {
      // わざと await を挟まず back-to-back で呼ぶ（キューロックが無ければ read-modify-write が
      // 競合し、後勝ちの書き込みで一部のエントリが失われる）
      recordApiErrorLog({ context: 'pdf_load', error: new Error('a'), newUuid: () => 'log-x', now: () => 't0' });
      recordApiErrorLog({ context: 'pdf_load', error: new Error('b'), newUuid: () => 'log-y', now: () => 't1' });
      recordApiErrorLog({ context: 'pdf_load', error: new Error('c'), newUuid: () => 'log-z', now: () => 't2' });
      await wait();

      const deps = makeGoogleDeps();
      configureApiErrorLog({ spreadsheetId: 'SID', loggedBy: 'me@example.com', appVersion: '1.0.0', google: deps });
      const result = await flushApiErrorLogQueue();

      expect(result.flushedCount).toBe(3);
      const ids = (appendedRows(deps) as string[][]).map((row) => row[0]);
      expect(ids.sort()).toEqual(['log-x', 'log-y', 'log-z']);
    });
  });
});
