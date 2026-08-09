// GoogleApiError.endpoint（URL 全体）を、ApiErrorLog.api 列に書く短い API 名へ変換する純粋関数
// （issue #249）。
//
// なぜ URL をそのまま記録しないか: Drive API はファイル ID をパス・クエリに含むため、
// URL をそのまま記録すると個人が特定しうる識別子をログへ残してしまう（作業原則 5）。
// この関数は host + pathname + 一部のクエリ有無だけを見て、既知の呼び出しパターンを
// 固定の API 名（例: 'drive.files.get' / 'sheets.values.append'）へ写す。
//
// GoogleApiError は HTTP メソッドを保持しない（endpoint は URL のみ）ため、
// 同じ pathname を GET/PUT の両方で使う呼び出し（例: values/{range} は
// getSheetValues が GET・updateRow/writeHeaderRow が PUT）はクエリの有無で区別する
// （書き込み系は valueInputOption を必ず付ける。lib/google/sheets.ts 参照）。
// 未知のパターンは 'unknown' を返す（診断用途なので取りこぼしより誤爆しないことを優先する）

const UNKNOWN_API_NAME = 'unknown';

function driveApiName(pathname: string, query: URLSearchParams): string {
  if (pathname.endsWith('/copy')) {
    return 'drive.files.copy';
  }
  if (pathname.endsWith('/permissions')) {
    return 'drive.permissions.create';
  }
  if (pathname === '/drive/v3/files' || pathname === '/upload/drive/v3/files') {
    // 一覧系（listFolderPdfs / listRecentSpreadsheets / ensureChildFolder / ensureRootFolder）は
    // 検索クエリ q= を必ず付ける。付かなければファイル作成（createFolder / アップロード）
    return query.has('q') ? 'drive.files.list' : 'drive.files.create';
  }
  // /drive/v3/files/{id}（メタデータ取得・実体取得・親付け替えのいずれか）。
  // moveFileToFolder の PATCH だけが addParents を持つ
  if (query.has('addParents')) {
    return 'drive.files.update';
  }
  return 'drive.files.get';
}

function sheetsApiName(pathname: string, query: URLSearchParams): string {
  if (pathname.endsWith(':append')) {
    return 'sheets.values.append';
  }
  if (pathname.endsWith(':batchGet')) {
    return 'sheets.values.batchGet';
  }
  if (pathname.endsWith(':batchUpdate')) {
    // /values:batchUpdate（batchUpdateRows）と /{spreadsheetId}:batchUpdate（addSheetTab）を区別する
    return pathname.includes('/values:batchUpdate')
      ? 'sheets.values.batchUpdate'
      : 'sheets.spreadsheets.batchUpdate';
  }
  if (pathname.includes('/values/')) {
    // 書き込み（updateRow / writeHeaderRow）は valueInputOption を必ず付ける。
    // 読み込み（getSheetValues）は付けない
    return query.has('valueInputOption') ? 'sheets.values.update' : 'sheets.values.get';
  }
  // 残るのは /v4/spreadsheets（createSpreadsheet）と /v4/spreadsheets/{id}（getSheetTitles）
  return pathname === '/v4/spreadsheets' ? 'sheets.spreadsheets.create' : 'sheets.spreadsheets.get';
}

/**
 * GoogleApiError.endpoint（URL）から ApiErrorLog.api 列へ書く短い API 名を導出する。
 * 解釈できない URL（不正な文字列・未知のホスト・未知のパスパターン）は 'unknown' を返す
 */
export function apiNameFromEndpoint(endpoint: string): string {
  let url: URL;
  try {
    url = new URL(endpoint);
  } catch {
    return UNKNOWN_API_NAME;
  }
  if (url.pathname.startsWith('/drive/v3/files') || url.pathname.startsWith('/upload/drive/v3/files')) {
    return driveApiName(url.pathname, url.searchParams);
  }
  if (url.pathname.startsWith('/v4/spreadsheets')) {
    return sheetsApiName(url.pathname, url.searchParams);
  }
  return UNKNOWN_API_NAME;
}
