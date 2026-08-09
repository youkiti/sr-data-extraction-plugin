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
 * `values.append` が HTTP 2xx を返したのに、実際には要求した行数より少ない行しか
 * 書けていなかった（部分書き込み）ときに投げる例外（issue #247）。
 * `tab` / `requestedRows` / `updatedRows` はすべて常に判明している値。`updatedRows` は
 * appendRows がレスポンスから判別できた実際の書き込み行数で、この例外は「不一致と
 * 判別できたとき」にしか投げないため、常に具体的な行数を持つ。
 */
export class SheetsPartialAppendError extends Error {
  readonly tab: string;
  readonly requestedRows: number;
  readonly updatedRows: number;

  constructor(tab: string, requestedRows: number, updatedRows: number) {
    super(
      `Sheets への追記が要求 ${requestedRows} 行に対して ${updatedRows} 行しか追記できませんでした（tab: ${tab}）`
    );
    this.name = 'SheetsPartialAppendError';
    this.tab = tab;
    this.requestedRows = requestedRows;
    this.updatedRows = updatedRows;
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
 * `updates.updatedRange`（例 `"Evidence!A70:Z138"`）から書き込まれた行数を算出する。
 * 形式が想定と違う・パースできない場合は null（呼び出し側は「判別できなかった」として扱う）
 */
function rowCountFromUpdatedRange(updatedRange: unknown): number | null {
  if (typeof updatedRange !== 'string') {
    return null;
  }
  const rangePart = updatedRange.includes('!')
    ? updatedRange.slice(updatedRange.indexOf('!') + 1)
    : updatedRange;
  const match = /^[A-Z]+(\d+):[A-Z]+(\d+)$/.exec(rangePart);
  if (match === null) {
    return null;
  }
  // 正規表現が \d+ で数字のみに絞っているため、start/end は常に非負整数になる
  // （Number.isInteger の追加チェックは不要）
  const start = Number(match[1]);
  const end = Number(match[2]);
  return end < start ? null : end - start + 1;
}

/**
 * `values.append` のレスポンス JSON から実際に書き込めた行数を判別する。
 * 優先順は `updates.updatedRows`（数値ならそのまま採用） → `updates.updatedRange` から算出
 * → どちらも無い / 形が不正なら null（＝判別不能。呼び出し側は検証をスキップする）
 */
function determineUpdatedRowCount(json: unknown): number | null {
  if (typeof json !== 'object' || json === null) {
    return null;
  }
  const updates = (json as { updates?: unknown }).updates;
  if (typeof updates !== 'object' || updates === null) {
    return null;
  }
  const updatedRows = (updates as { updatedRows?: unknown }).updatedRows;
  if (typeof updatedRows === 'number' && Number.isFinite(updatedRows)) {
    return updatedRows;
  }
  return rowCountFromUpdatedRange((updates as { updatedRange?: unknown }).updatedRange);
}

/**
 * 指定タブに複数行をまとめて追記する（1 API 呼び出し）。
 * Evidence のバッチ追記など「行数が多く 1 行ずつの往復が高くつく」用途向け。
 * 空配列は no-op（API を呼ばない）。null は空文字に変換する。
 * `appendRow`（単一行）も本関数経由のため、以下の検証・再送に関する注意はすべての
 * 呼び出し箇所（Evidence / Decisions / ExtractionRuns 等）に等しく効く。
 *
 * **部分書き込み検知（issue #247）**: `values.append` は HTTP 2xx を返しても、実際には
 * 要求より少ない行しか書けていないことがある（実運用で Evidence 69 行のうち 1 行しか
 * 入らず run が `done` のまま終わった事象）。レスポンス JSON から書けた行数を判別できた
 * ときだけ `rows.length` と突き合わせ、不一致なら {@link SheetsPartialAppendError} を
 * 投げる。**判別できなかった（null）場合は検証せず従来どおり成功として返す** —
 * 実 API は必ず `updates.updatedRows` を返すため実運用での検知力はこれで落ちないが、
 * `updates` を持たないレスポンスを返すのは既存テストのスタブだけであり、そこで throw
 * すると検証と無関係な多数のテストが壊れるため、この分だけ残存ギャップとして許容している。
 * JSON のパース自体に失敗した場合（body が JSON でない等）も同様に null 扱いにする。
 *
 * **再送設計への注意**: throw した時点で「1 行も書けていない」とは限らない（部分書き込みの
 * 可能性がある）。そのため呼び出し側が同じ行をそのまま自動再送すると重複行が生まれうる。
 * 本関数・本モジュールは自動再送を一切行わない（リトライは googleFetch の 429/503 バックオフに
 * 限定され、そこでは自動リトライ後も 2xx かつ部分書き込みという今回のケースは救えない）。
 * 呼び出し側の再送方針は各リポジトリの責務: Evidence（evidenceRepository 経由）は
 * throw を `save_failed` の BatchFailure として記録するだけで自動再送はせず、
 * S7 の再試行（= 新しい run_id での再実行）で拾う設計になっている
 * （features/extraction/executeRun.ts の performFlush）。
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
  const res = await googleFetch(
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
  const json = await res.json().catch(() => null);
  const updatedRows = determineUpdatedRowCount(json);
  if (updatedRows !== null && updatedRows !== rows.length) {
    throw new SheetsPartialAppendError(tab, rows.length, updatedRows);
  }
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
