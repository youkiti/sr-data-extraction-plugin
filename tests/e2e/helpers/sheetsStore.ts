// E2E の Sheets スタブ用ヘルパ（issue #252）。
//
// なぜ要るか: 実 Google Sheets は append / batchUpdate で書き込んだ行がそのまま次の GET で
// 返るが、旧来の E2E スタブはヘッダ行固定で GET に応答していた。判定 1 件目が成功すると
// foldDecisionWriteTokens（src/app/services/verifyService.ts / pilotService.ts）が書き込み
// 時点の updated_at を store へ畳み込み、判定 2 件目はそれを expectedUpdatedAt として
// サーバへ渡す。ヘッダ固定スタブでは「サーバ側に該当行が存在しない（実値 null）」ことになり、
// annotationRepository.ts の checkStudyRowConflict / upsertResultsDataRows の期待値検証が
// 不一致と判定して、偽の AnnotationConflictError（競合バナー）を投げてしまう。
// このヘルパは StudyData / ResultsData の内容をメモリ上に保持し、append・batchUpdate・
// ヘッダ拡張 PUT（StudyData!A1）を実際の状態へ反映してから次の GET へ返すことで、
// 実 Sheets の挙動を忠実に再現する。
import type { Request } from '@playwright/test';

/** StudyData / ResultsData の状態を保持し、GET 応答用の values と書き込みの反映を提供する */
export interface SheetsDataStore {
  /** StudyData の GET 応答にそのまま渡せる values（ヘッダ行 + データ行） */
  studyValues(): string[][];
  /** ResultsData の GET 応答にそのまま渡せる values（ヘッダ行 + データ行） */
  resultsValues(): string[][];
  /**
   * 書き込みリクエストを解釈して内部状態へ反映する。
   * 対象（StudyData!A1 PUT / {StudyData|ResultsData}!A1:append POST / batchUpdate POST）で
   * あれば反映して true、対象外なら何もせず false を返す。
   * `route.fulfill` はこの関数の中では呼ばない（呼び出し側の spec に任せる）
   */
  handleWrite(request: Request): boolean;
}

interface SheetState {
  header: string[];
  rows: string[][];
}

/** appendRows / batchUpdateRows が送る null 混じりの行を Sheets 応答と同じ文字列配列へ揃える */
function toSheetRow(row: readonly (string | number | boolean | null | undefined)[]): string[] {
  return row.map((v) => (v === null || v === undefined ? '' : String(v)));
}

export function createSheetsDataStore(options: {
  studyHeader: readonly string[];
  resultsHeader: readonly string[];
}): SheetsDataStore {
  const studySheet: SheetState = { header: [...options.studyHeader], rows: [] };
  const resultsSheet: SheetState = { header: [...options.resultsHeader], rows: [] };

  function handleWrite(request: Request): boolean {
    const url = decodeURIComponent(request.url());
    const method = request.method();

    // StudyData のヘッダ拡張（動的値列の追加。writeHeaderRow）: PUT `values/StudyData!A1`
    if (method === 'PUT' && url.includes('/values/StudyData!A1?')) {
      const body = request.postDataJSON() as { values?: string[][] } | undefined;
      const newHeader = body?.values?.[0];
      if (newHeader !== undefined) {
        studySheet.header = newHeader;
      }
      return true;
    }

    // 行の追記: POST `values/{tab}!A1:append`
    if (method === 'POST' && url.includes('/values/StudyData!A1:append')) {
      const body = request.postDataJSON() as { values?: string[][] } | undefined;
      for (const row of body?.values ?? []) {
        studySheet.rows.push(toSheetRow(row));
      }
      return true;
    }
    if (method === 'POST' && url.includes('/values/ResultsData!A1:append')) {
      const body = request.postDataJSON() as { values?: string[][] } | undefined;
      for (const row of body?.values ?? []) {
        resultsSheet.rows.push(toSheetRow(row));
      }
      return true;
    }

    // 既存行の上書き: POST `values:batchUpdate`（body の data[].range に `{tab}!A{rowIndex}` が
    // 入る。rowIndex は 1 始まり・ヘッダが 1 行目なのでデータ配列の index は rowIndex - 2）
    if (method === 'POST' && url.includes('values:batchUpdate')) {
      const body = request.postDataJSON() as
        | { data?: { range: string; values?: string[][] }[] }
        | undefined;
      let matched = false;
      for (const item of body?.data ?? []) {
        const match = /^(StudyData|ResultsData)!A(\d+)$/.exec(item.range);
        const newRow = item.values?.[0];
        if (match === null || newRow === undefined) {
          continue;
        }
        matched = true;
        const tab = match[1] as 'StudyData' | 'ResultsData';
        const rowIndex = Number(match[2]);
        const dataIndex = rowIndex - 2;
        const sheet = tab === 'StudyData' ? studySheet : resultsSheet;
        sheet.rows[dataIndex] = toSheetRow(newRow);
      }
      return matched;
    }

    return false;
  }

  return {
    studyValues: () => [studySheet.header, ...studySheet.rows],
    resultsValues: () => [resultsSheet.header, ...resultsSheet.rows],
    handleWrite,
  };
}
