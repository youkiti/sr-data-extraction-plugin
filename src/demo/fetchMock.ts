// デモモード用 fetch モック（tiab-review-plugin/src/demo/fetch-mock.ts の方式を踏襲）。
//
// globalThis.fetch を丸ごと差し替え、Google Sheets API / Drive API / Gemini API への呼び出しを
// すべてインメモリで処理する。OAuth トークン取得自体は auth.ts のデモ版で完結する
// （chrome.runtime.sendMessage を一切使わないため、本モックは userinfo エンドポイントを扱わない）。
// chrome-extension:// 宛て（PDF.js のワーカー/CMap 取得・同梱 PDF フィクスチャ取得等）と
// 相対 URL は実際の fetch へそのまま素通しし、それ以外の未対応な外部ホスト・エンドポイントは
// 404 を返して console.warn するだけに留め、実ネットワークには一切出ない。
import {
  readRange,
  readRanges,
  writeRange,
  appendRowsTo,
  addSheetToStore,
  listSheets,
  getStoreSpreadsheetTitle,
} from './sheetStore';
import { buildGenerateContentResponseText } from './llmFixtures';
import {
  DEMO_DRIVE_PDF_FILE_IDS,
  DEMO_DRIVE_TEXT_FILE_IDS,
  DEMO_FIXTURE_PDF_FILENAMES,
  DEMO_SPREADSHEET_ID,
} from './constants';
import { DEMO_PAPERS } from './paperContent';

let installed = false;

/**
 * 人工遅延の有効フラグ。既定 true（実運用らしい待ち時間を入れる）。
 * seed.ts が起動時の初期シード投入（数十回の Sheets 呼び出し）を行う間だけ
 * `setDemoDelaysEnabled(false)` で無効化し、シードを一瞬で終わらせる
 * （初期シードは「実際のユーザー操作」ではなく起動時のセットアップなので、
 * ここに遅延を入れると画面が開くたびに長時間ローディングのままになってしまう）。
 * シード完了後は必ず true へ戻し、以降の実操作（一括抽出の実行・検証の判定保存等）では
 * 遅延ありに戻す。
 */
let delaysEnabled = true;

export function setDemoDelaysEnabled(enabled: boolean): void {
  delaysEnabled = enabled;
}

/** Sheets 書き込み系（120〜250ms）/ Gemini 抽出（1 論文あたり 2〜4 秒）の人工遅延。
 * 一括抽出の進捗バーが実運用らしく動いて見えることが目的（brief の指示） */
function randomDelayMs(minMs: number, maxMs: number): number {
  return minMs + Math.random() * (maxMs - minMs);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

/**
 * 実 API の「シートが存在しない」エラーメッセージ文言に合わせて 400 を返す。
 * lib/google/sheets.ts はエラーメッセージの文言までは見ないが（HTTP ステータスのみ判定）、
 * 実 API の挙動に忠実にしておく。
 */
function notFoundRange(range: string): Response {
  return jsonResponse(400, { error: { code: 400, message: `Unable to parse range: ${range}` } });
}

function unknownSpreadsheet(): Response {
  return jsonResponse(404, { error: { code: 404, message: 'Requested entity was not found.' } });
}

function extractUrl(input: RequestInfo | URL): string {
  if (typeof input === 'string') return input;
  if (input instanceof URL) return input.toString();
  return input.url;
}

function isPassthroughUrl(rawUrl: string): boolean {
  if (rawUrl.startsWith('chrome-extension://')) return true;
  // http(s) 以外（相対パス等）は拡張内リソースの参照とみなし、そのまま実 fetch へ流す
  return !/^https?:\/\//i.test(rawUrl);
}

function readJsonBody(init: RequestInit | undefined): unknown {
  if (!init || init.body === undefined || init.body === null) return undefined;
  try {
    return JSON.parse(init.body as string);
  } catch {
    return undefined;
  }
}

// ============================================================
// Google Sheets API（lib/google/sheets.ts が実際に叩くエンドポイントのみ対応する）
// ============================================================

function handleSpreadsheetMetadata(spreadsheetId: string): Response {
  if (spreadsheetId !== DEMO_SPREADSHEET_ID) return unknownSpreadsheet();
  return jsonResponse(200, {
    spreadsheetId,
    properties: { title: getStoreSpreadsheetTitle() },
    sheets: listSheets().map(({ title, sheetId }) => ({ properties: { title, sheetId } })),
  });
}

function handleSpreadsheetBatchUpdate(spreadsheetId: string, body: unknown): Response {
  if (spreadsheetId !== DEMO_SPREADSHEET_ID) return unknownSpreadsheet();
  const requests: unknown[] = Array.isArray((body as { requests?: unknown[] })?.requests)
    ? ((body as { requests: unknown[] }).requests as unknown[])
    : [];
  const replies = requests.map((req) => {
    const addTitle = (req as { addSheet?: { properties?: { title?: unknown } } })?.addSheet?.properties
      ?.title;
    if (typeof addTitle === 'string' && addTitle) {
      const sheetId = addSheetToStore(addTitle);
      return { addSheet: { properties: { sheetId, title: addTitle } } };
    }
    console.warn('[demo] spreadsheet batchUpdate: 未対応のリクエスト種別のため無視しました', req);
    return {};
  });
  return jsonResponse(200, { spreadsheetId, replies });
}

function handleValuesGet(range: string): Response {
  const values = readRange(range);
  if (values === null) return notFoundRange(range);
  return jsonResponse(200, { range, majorDimension: 'ROWS', values });
}

function handleValuesUpdate(range: string, body: unknown): Response {
  const values: string[][] = Array.isArray((body as { values?: unknown })?.values)
    ? ((body as { values: string[][] }).values)
    : [];
  if (!writeRange(range, values)) return notFoundRange(range);
  return jsonResponse(200, {
    spreadsheetId: DEMO_SPREADSHEET_ID,
    updatedRange: range,
    updatedRows: values.length,
    updatedColumns: values[0]?.length ?? 0,
    updatedCells: values.reduce((acc, row) => acc + row.length, 0),
  });
}

function handleValuesAppend(sheetName: string, body: unknown): Response {
  const rows: string[][] = Array.isArray((body as { values?: unknown })?.values)
    ? ((body as { values: string[][] }).values)
    : [];
  const result = appendRowsTo(sheetName, rows);
  if (!result) return notFoundRange(sheetName);
  const { firstRowIndex, lastRowIndex } = result;
  return jsonResponse(200, {
    spreadsheetId: DEMO_SPREADSHEET_ID,
    updates: {
      spreadsheetId: DEMO_SPREADSHEET_ID,
      updatedRange: `${sheetName}!A${firstRowIndex}:Z${lastRowIndex}`,
      updatedRows: rows.length,
    },
  });
}

function handleValuesBatchGet(spreadsheetId: string, ranges: string[]): Response {
  if (spreadsheetId !== DEMO_SPREADSHEET_ID) return unknownSpreadsheet();
  const results = readRanges(ranges);
  if (results === null) {
    return jsonResponse(400, { error: { code: 400, message: `Unable to parse range: ${ranges.join(', ')}` } });
  }
  return jsonResponse(200, {
    spreadsheetId,
    valueRanges: results.map((values, i) => ({ range: ranges[i], majorDimension: 'ROWS', values })),
  });
}

function handleValuesBatchUpdate(spreadsheetId: string, body: unknown): Response {
  if (spreadsheetId !== DEMO_SPREADSHEET_ID) return unknownSpreadsheet();
  const data: { range: string; values?: string[][] }[] = Array.isArray((body as { data?: unknown })?.data)
    ? ((body as { data: { range: string; values?: string[][] }[] }).data)
    : [];
  for (const item of data) {
    if (!writeRange(item.range, item.values ?? [])) return notFoundRange(item.range);
  }
  return jsonResponse(200, { spreadsheetId, totalUpdatedRows: data.length });
}

/**
 * `${SHEETS_API_BASE}/{id}(...)` 形式のパスを解釈する。
 * 戻り値 null は「このハンドラの対象外」を意味し、呼び出し側は次のフォールバック
 * （404 + console.warn）に進む。
 */
function routeSheetsApi(pathname: string, url: URL, method: string, body: unknown): Response | null {
  const prefix = '/v4/spreadsheets/';
  if (!pathname.startsWith(prefix)) return null;
  const rest = pathname.slice(prefix.length);

  // "{id}:batchUpdate" （スプレッドシート全体への addSheet 等。/values を含まないもの限定）
  if (rest.endsWith(':batchUpdate') && !rest.includes('/values')) {
    if (method !== 'POST') return null;
    return handleSpreadsheetBatchUpdate(rest.slice(0, -':batchUpdate'.length), body);
  }

  const valuesMarker = '/values';
  const valuesIdx = rest.indexOf(valuesMarker);

  if (valuesIdx === -1) {
    // メタデータ取得（fields=properties.title / fields=sheets.properties.title 等）
    if (method !== 'GET') return null;
    return handleSpreadsheetMetadata(rest);
  }

  const spreadsheetId = rest.slice(0, valuesIdx);
  // '' | ':batchGet' | ':batchUpdate' | '/{range}' | '/{sheetName}:append'
  const tail = rest.slice(valuesIdx + valuesMarker.length);

  if (tail === ':batchGet') {
    if (method !== 'GET') return null;
    const ranges = url.searchParams.getAll('ranges').map((r) => decodeURIComponent(r));
    return handleValuesBatchGet(spreadsheetId, ranges);
  }
  if (tail === ':batchUpdate') {
    if (method !== 'POST') return null;
    return handleValuesBatchUpdate(spreadsheetId, body);
  }
  if (tail.startsWith('/')) {
    if (spreadsheetId !== DEMO_SPREADSHEET_ID) return unknownSpreadsheet();

    // ":append" はエンコード対象外の文字列として付与されているため、
    // decode より前に判定する（レンジ内部の "!"/":" は %21/%3A に潰れておりここに現れない）
    const rawSegment = tail.slice(1);
    if (rawSegment.endsWith(':append')) {
      if (method !== 'POST') return null;
      // lib/google/sheets.ts の appendRows は range を `${tab}!A1` の形で渡す（Google Sheets API は
      // 「この範囲を含むテーブルの末尾へ追記する」という意味で解釈する）。ストア側はタブ名だけを
      // キーにしているため、"!" より前（タブ名部分）だけを取り出す
      const range = decodeURIComponent(rawSegment.slice(0, -':append'.length));
      const sheetName = range.split('!')[0] as string;
      return handleValuesAppend(sheetName, body);
    }

    const range = decodeURIComponent(rawSegment);
    if (method === 'GET') return handleValuesGet(range);
    if (method === 'PUT') return handleValuesUpdate(range, body);
    return null;
  }
  return null;
}

// ============================================================
// Google Drive API（lib/google/drive.ts の getFileText / getFileBinary のみ対応）
// ============================================================

/** 拡張バンドル同梱の実 PDF フィクスチャ（デモ論文ぶん）をバイト列で取得する（chrome-extension:// URL は isPassthroughUrl で実 fetch へ流れる） */
async function fetchBundledFixturePdfBytes(filename: string): Promise<ArrayBuffer> {
  const resourceUrl = chrome.runtime.getURL(`fixtures/${filename}`);
  const response = await fetch(resourceUrl);
  if (!response.ok) {
    throw new Error(
      `デモ用 PDF フィクスチャの読み込みに失敗しました（HTTP ${response.status}）: ${resourceUrl}`,
    );
  }
  return response.arrayBuffer();
}

/** extracted_texts/{document_id}.txt 相当。PAGE_TEXTS を lib/documents/extractedText.ts の形式（form feed 区切り）で結合する */
function buildExtractedTextBody(pageTexts: readonly string[]): string {
  return pageTexts.join('\f');
}

/** Drive files.get?alt=media（PDF バイナリ / 抽出済みテキスト取得）の応答を組み立てる。
 * DEMO_DRIVE_PDF_FILE_IDS / DEMO_DRIVE_TEXT_FILE_IDS のインデックス = DEMO_PAPERS のインデックス */
async function handleDriveMediaDownload(fileId: string): Promise<Response> {
  const pdfIndex = DEMO_DRIVE_PDF_FILE_IDS.indexOf(fileId as (typeof DEMO_DRIVE_PDF_FILE_IDS)[number]);
  if (pdfIndex !== -1) {
    const filename = DEMO_FIXTURE_PDF_FILENAMES[pdfIndex] as string;
    try {
      const bytes = await fetchBundledFixturePdfBytes(filename);
      return new Response(bytes, { status: 200, headers: { 'Content-Type': 'application/pdf' } });
    } catch (error) {
      console.error('[demo] デモ PDF フィクスチャの読み込みに失敗しました:', error);
      return jsonResponse(500, { error: { code: 500, message: 'demo pdf fixture load failed' } });
    }
  }
  const textIndex = DEMO_DRIVE_TEXT_FILE_IDS.indexOf(fileId as (typeof DEMO_DRIVE_TEXT_FILE_IDS)[number]);
  if (textIndex !== -1) {
    const pageTexts = DEMO_PAPERS[textIndex]?.pageTexts ?? [];
    return new Response(buildExtractedTextBody(pageTexts), {
      status: 200,
      headers: { 'Content-Type': 'text/plain; charset=utf-8' },
    });
  }
  return jsonResponse(404, { error: { code: 404, message: 'File not found' } });
}

/** Drive に新規作成するフォルダ/ファイルの仮想 ID 採番（#/export の Drive 保存フロー用） */
let nextDemoDriveFileSeq = 1;
function nextDemoDriveFileId(): string {
  const id = `demo-drive-created-${String(nextDemoDriveFileSeq).padStart(3, '0')}`;
  nextDemoDriveFileSeq += 1;
  return id;
}

/**
 * Drive files.create（フォルダ作成 / メタデータのみの作成）の応答。
 * lib/google/drive.ts の createFolder が呼ぶ。デモでは常に新規作成扱いにする
 * （ensureChildFolder 側の検索 GET を常に空応答にしているため、毎回ここを通る）
 */
function handleDriveCreate(): Response {
  const id = nextDemoDriveFileId();
  return jsonResponse(200, { id, webViewLink: `https://drive.google.com/file/d/${id}/view` });
}

function routeGoogleApis(pathname: string, url: URL, method: string): Response | null | Promise<Response | null> {
  // #/export の「Drive に保存」（features/export/exportLogRepository.ts 経由）が使う
  // exports フォルダの検索・作成・CSV アップロード。デモでは実体を持たず、常に
  // 「まだ無い（検索は空）→ 新規作成」の経路を通す（フォルダ・アップロード実体の永続化はしない）
  if (pathname === '/drive/v3/files') {
    if (method === 'GET') {
      // ensureChildFolder の検索 GET。常に「まだ無い」を返し、後続の createFolder へ倒す
      return jsonResponse(200, { files: [] });
    }
    if (method === 'POST') {
      return handleDriveCreate();
    }
    return null;
  }
  if (pathname === '/upload/drive/v3/files') {
    // uploadTextFile / アップロード系（multipart）。中身は検証せず ID だけ払い出す
    if (method !== 'POST') return null;
    return handleDriveCreate();
  }

  const fileMatch = /^\/drive\/v3\/files\/([^/]+)$/.exec(pathname);
  if (fileMatch) {
    if (method === 'PATCH') {
      // moveFileToFolder（parents 付け替え）。デモではプロジェクト作成フローを通らないため
      // 実際には呼ばれない想定だが、念のため成功応答にしておく
      const fileId = decodeURIComponent(fileMatch[1] as string);
      return jsonResponse(200, { id: fileId, parents: [] });
    }
    if (method !== 'GET') return null;
    const fileId = decodeURIComponent(fileMatch[1] as string);
    if (url.searchParams.get('alt') === 'media') {
      return handleDriveMediaDownload(fileId);
    }
    // メタデータ GET（capabilities 確認等）。デモでは常に編集・共有可能として返す
    return jsonResponse(200, { id: fileId, capabilities: { canEdit: true, canShare: true } });
  }
  return null;
}

// ============================================================
// Gemini API（generativelanguage.googleapis.com）
// ============================================================

/**
 * `/v1beta/models/{model}:generateContent` のみ対応する（本拡張の GeminiProvider は
 * streamGenerateContent ではなく generateContent を使う。lib/llm/GeminiProvider.ts 参照）。
 * API キーの値そのものは一切検証しない（デモでは何を入力しても通す）。
 */
function routeGeminiApi(pathname: string, method: string, body: unknown): Response | null {
  const match = /^\/v1beta\/models\/([^:]+):generateContent$/.exec(pathname);
  if (!match) return null;
  if (method !== 'POST') return null;
  const responseText = buildGenerateContentResponseText(body);
  return jsonResponse(200, {
    candidates: [
      {
        content: { role: 'model', parts: [{ text: responseText }] },
        finishReason: 'STOP',
      },
    ],
    usageMetadata: { promptTokenCount: 1200, candidatesTokenCount: 400, totalTokenCount: 1600 },
  });
}

// ============================================================
// インストール
// ============================================================

export function installDemoFetchMock(): void {
  if (installed) return;
  installed = true;

  const originalFetch = globalThis.fetch.bind(globalThis);

  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const rawUrl = extractUrl(input);

    if (isPassthroughUrl(rawUrl)) {
      return originalFetch(input, init);
    }

    try {
      const url = new URL(rawUrl);
      const method = (init?.method ?? 'GET').toUpperCase();
      const body = readJsonBody(init);

      if (url.hostname === 'sheets.googleapis.com') {
        // Sheets の読み書きは実運用らしい待ち時間（120〜250ms）を入れる。一括抽出時の
        // 進捗バーやスピナーが「一瞬で終わって見えない」ことを防ぐのが目的（brief の指示）。
        // 起動時の初期シード投入中は無効化する（delaysEnabled 冒頭コメント参照）
        if (delaysEnabled) {
          await sleep(randomDelayMs(120, 250));
        }
        const response = routeSheetsApi(url.pathname, url, method, body);
        if (response) return response;
      } else if (url.hostname === 'www.googleapis.com') {
        const response = await routeGoogleApis(url.pathname, url, method);
        if (response) return response;
      } else if (url.hostname === 'generativelanguage.googleapis.com') {
        // LLM 抽出は 1 論文（1 バッチ）あたり 2〜4 秒程度の人工遅延を入れる
        if (delaysEnabled) {
          await sleep(randomDelayMs(2000, 4000));
        }
        const response = routeGeminiApi(url.pathname, method, body);
        if (response) return response;
      }
    } catch (error) {
      console.error('[demo] fetchMock internal error:', error);
      return jsonResponse(500, { error: { code: 500, message: 'demo fetchMock internal error' } });
    }

    console.warn(`[demo] 未対応の外部リクエストです（デモモードのため実ネットワークへは出ません）: ${rawUrl}`);
    return jsonResponse(404, { error: { code: 404, message: 'Demo mode: no network access for this endpoint' } });
  }) as typeof fetch;
}
