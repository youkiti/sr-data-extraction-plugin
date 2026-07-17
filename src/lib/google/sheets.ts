// sr-query-builder-plugin の lib/google/sheets.ts をコピー流用（architecture.md §7-3）。
// 本拡張向けに getSheetTitles（タブ一覧の取得。既存プロジェクト検証用）と
// SheetsAccessDeniedError（drive.file スコープのアクセス拒否分類。issue #130）を追加している
import { GoogleApiError, googleFetch, type GoogleApiDeps } from './types';

const API_BASE = 'https://sheets.googleapis.com/v4/spreadsheets';

/**
 * drive.file スコープでのアクセス拒否（issue #130）。
 * このアプリが作成していない・Picker で許可されていないシートを開いたときに発生し、
 * S1 / ロール解決の「Google で許可する」（スプレッドシート Picker）誘導のトリガーになる。
 * drive.file では「未許可」と「不存在」を区別できない（未許可シートも 404 を返す）ため、
 * 404 は常に本エラーへ分類する。
 */
export class SheetsAccessDeniedError extends Error {
  readonly spreadsheetId: string;
  readonly status: number;

  constructor(spreadsheetId: string, status: number) {
    super(
      'このスプレッドシートを開く権限がまだありません（共有シートの場合は Picker での許可が必要です）'
    );
    this.name = 'SheetsAccessDeniedError';
    this.spreadsheetId = spreadsheetId;
    this.status = status;
  }
}

/**
 * Sheets API のエラーがアクセス拒否（Picker 誘導の対象）かを判定する。
 * - 404: 常に対象（上記のとおり不存在と未許可を区別できない）
 * - 403: responseBody の reason が権限系のときのみ対象。API 無効化・クォータ等の
 *   403 は Picker で解決しないため一般エラーのまま伝播させる
 */
export function isSheetsAccessDenied(err: unknown): err is GoogleApiError {
  if (!(err instanceof GoogleApiError)) {
    return false;
  }
  if (err.status === 404) {
    return true;
  }
  if (err.status !== 403) {
    return false;
  }
  try {
    const body = JSON.parse(err.responseBody) as {
      error?: { status?: unknown; errors?: Array<{ reason?: unknown }> };
    };
    const statusText = typeof body.error?.status === 'string' ? body.error.status : '';
    const reasons = (body.error?.errors ?? [])
      .map((e) => (typeof e.reason === 'string' ? e.reason : ''))
      .filter((r) => r.length > 0);
    return (
      statusText === 'PERMISSION_DENIED' ||
      reasons.some((r) => r === 'forbidden' || r === 'insufficientPermissions')
    );
  } catch {
    // body が JSON でない 403 は判断材料がないため保守的に一般エラー扱い
    return false;
  }
}

/**
 * Sheets API v4 の薄いラッパ群。Sheets API は JSON なので XML 変換は不要。
 * 13 タブの初期化やヘッダ書き込みなど、プロジェクト作成で使う最小限の機能だけ提供する。
 */

export interface CreatedSpreadsheet {
  spreadsheetId: string;
  spreadsheetUrl: string;
}

/**
 * タイトルと初期タブ名を指定してスプレッドシートを新規作成する。
 * 指定されたタブ名と同じ順序で sheet が作られる（既定の `Sheet1` は含めない）。
 */
export async function createSpreadsheet(
  title: string,
  tabTitles: readonly string[],
  deps: GoogleApiDeps
): Promise<CreatedSpreadsheet> {
  const body = {
    properties: { title },
    sheets: tabTitles.map((t) => ({ properties: { title: t } })),
  };
  const res = await googleFetch(
    API_BASE,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    },
    deps
  );
  const json = (await res.json()) as {
    spreadsheetId: string;
    spreadsheetUrl: string;
  };
  return { spreadsheetId: json.spreadsheetId, spreadsheetUrl: json.spreadsheetUrl };
}

/**
 * スプレッドシートのタブ名一覧を取得する。
 * 既存プロジェクトを開くときの検証（Meta / Documents / SchemaFields の存在確認。
 * docs/ui-states.md §1）に使う。
 */
export async function getSheetTitles(
  spreadsheetId: string,
  deps: GoogleApiDeps
): Promise<string[]> {
  const url = `${API_BASE}/${encodeURIComponent(spreadsheetId)}?fields=sheets.properties.title`;
  const res = await googleFetch(url, { method: 'GET' }, deps);
  const json = (await res.json()) as {
    sheets?: { properties?: { title?: string } }[];
  };
  return (json.sheets ?? [])
    .map((sheet) => sheet.properties?.title ?? '')
    .filter((title) => title !== '');
}

/**
 * スプレッドシートにタブを 1 つ追加する（batchUpdate addSheet）。
 * ArmStructures タブ追加（v0.7）より前に作られた既存プロジェクトへの
 * 後方互換フォールバック（書き込み時にタブがなければ作る）で使う。
 */
export async function addSheetTab(
  spreadsheetId: string,
  title: string,
  deps: GoogleApiDeps
): Promise<void> {
  const url = `${API_BASE}/${encodeURIComponent(spreadsheetId)}:batchUpdate`;
  await googleFetch(
    url,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        requests: [{ addSheet: { properties: { title } } }],
      }),
    },
    deps
  );
}

/**
 * 指定タブのヘッダ行（A1:Z1）に列名を書き込む。上書き。
 */
export async function writeHeaderRow(
  spreadsheetId: string,
  tab: string,
  headers: readonly string[],
  deps: GoogleApiDeps
): Promise<void> {
  const range = `${tab}!A1`;
  const url = `${API_BASE}/${spreadsheetId}/values/${encodeURIComponent(range)}?valueInputOption=RAW`;
  await googleFetch(
    url,
    {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ values: [headers] }),
    },
    deps
  );
}

/**
 * 指定タブに行を 1 件追記する。
 */
export async function appendRow(
  spreadsheetId: string,
  tab: string,
  row: readonly (string | number | boolean | null)[],
  deps: GoogleApiDeps
): Promise<void> {
  await appendRows(spreadsheetId, tab, [row], deps);
}

/**
 * 指定タブに複数行をまとめて追記する（1 API 呼び出し）。
 * Evidence のバッチ追記など「行数が多く 1 行ずつの往復が高くつく」用途向け。
 * 空配列は no-op（API を呼ばない）。null は空文字に変換する
 */
export async function appendRows(
  spreadsheetId: string,
  tab: string,
  rows: readonly (readonly (string | number | boolean | null)[])[],
  deps: GoogleApiDeps
): Promise<void> {
  if (rows.length === 0) {
    return;
  }
  const range = `${tab}!A1`;
  const url = `${API_BASE}/${spreadsheetId}/values/${encodeURIComponent(range)}:append?valueInputOption=RAW&insertDataOption=INSERT_ROWS`;
  await googleFetch(
    url,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        values: rows.map((row) => row.map((v) => (v === null ? '' : v))),
      }),
    },
    deps
  );
}

/**
 * 指定タブの 1 行を丸ごと上書きする（annotator 行の現在値更新などの行書き換え用）。
 *
 * - 範囲は `{tab}!A{rowIndex}` を起点にし、渡した values の幅ぶん右へ展開して書き込む
 *   （rowIndex は 1 始まりのシート行番号。ヘッダ行が 1 行目なので、データ 1 件目は通常 2 を渡す。
 *   StudyData の動的値列は 26 列 = Z 列を超えうるため、終端列は固定しない）
 * - valueInputOption=RAW で PUT する。null は空文字に変換する（appendRow と同じ挙動）
 *
 * 行の追加ではなく既存セルの上書きなので、行番号は呼び出し側が
 * `getSheetValues` の並び順から算出する前提（requirements.md §3.1 の
 * 「StudyData / ResultsData の annotator 行のみ上書き可」で使う）。
 */
export async function updateRow(
  spreadsheetId: string,
  tab: string,
  rowIndex: number,
  row: readonly (string | number | boolean | null)[],
  deps: GoogleApiDeps
): Promise<void> {
  const range = `${tab}!A${rowIndex}`;
  const url = `${API_BASE}/${spreadsheetId}/values/${encodeURIComponent(range)}?valueInputOption=RAW`;
  await googleFetch(
    url,
    {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        values: [row.map((v) => (v === null ? '' : v))],
      }),
    },
    deps
  );
}

/**
 * 複数行を 1 API 呼び出しでまとめて上書きする（values:batchUpdate）。
 * tiab-review 取り込み（issue #68）の study_label / pmid / doi 一括反映のように、
 * 「多数行の上書きで 1 行ずつの PUT 往復が書き込みクォータ（60 回/分）に当たる」用途で使う。
 * 各要素は updateRow と同じ意味論（rowIndex は 1 始まり・null は空文字変換）。空配列は no-op
 */
export async function batchUpdateRows(
  spreadsheetId: string,
  tab: string,
  updates: readonly { rowIndex: number; row: readonly (string | number | boolean | null)[] }[],
  deps: GoogleApiDeps,
): Promise<void> {
  if (updates.length === 0) {
    return;
  }
  const url = `${API_BASE}/${spreadsheetId}/values:batchUpdate`;
  await googleFetch(
    url,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        valueInputOption: 'RAW',
        data: updates.map((update) => ({
          range: `${tab}!A${update.rowIndex}`,
          values: [update.row.map((v) => (v === null ? '' : v))],
        })),
      }),
    },
    deps,
  );
}

/**
 * 複数範囲を 1 API 呼び出しでまとめて取得する（values:batchGet）。
 * 進捗カウント（#/home + ガード）のように「多数タブの行数だけ欲しい」用途で
 * タブごとの GET 往復を避けるために使う。
 * 返り値は ranges と同順・同数（空範囲は `[]`。API は空範囲の values を省略する）
 */
export async function getBatchValues(
  spreadsheetId: string,
  ranges: readonly string[],
  deps: GoogleApiDeps
): Promise<string[][][]> {
  const query = ranges.map((r) => `ranges=${encodeURIComponent(r)}`).join('&');
  const url = `${API_BASE}/${encodeURIComponent(spreadsheetId)}/values:batchGet?${query}`;
  const res = await googleFetch(url, { method: 'GET' }, deps);
  const json = (await res.json()) as { valueRanges?: { values?: string[][] }[] };
  const valueRanges = json.valueRanges ?? [];
  return ranges.map((_, i) => valueRanges[i]?.values ?? []);
}

/**
 * 指定タブの全行を 2 次元配列で取得する。`majorDimension=ROWS`。
 * 範囲はタブ名のみ指定（= 全列全行）。StudyData の動的値列が Z 列を超えても取りこぼさない
 */
export async function getSheetValues(
  spreadsheetId: string,
  tab: string,
  deps: GoogleApiDeps
): Promise<string[][]> {
  const range = tab;
  const url = `${API_BASE}/${spreadsheetId}/values/${encodeURIComponent(range)}`;
  const res = await googleFetch(url, { method: 'GET' }, deps);
  const json = (await res.json()) as { values?: string[][] };
  return json.values ?? [];
}
