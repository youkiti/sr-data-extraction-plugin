// プロジェクト全体の進捗カウント読み出し（ガード判定 + #/home サマリの実データ化）。
// 行本体は要らないため、各タブの先頭列（ExtractionRuns のみ run_type〜status 列）だけを
// values:batchGet 1 呼び出しでまとめて読む（docs/ui-states.md §3 `#/home`）
import { getBatchValues } from '../../lib/google/sheets';
import type { GoogleApiDeps } from '../../lib/google/types';

/** ガード判定・進捗サマリに使う各タブの行数サマリ（ui-flow.md §4） */
export interface ProgressCounts {
  /** Documents タブの行数 */
  documents: number;
  /** Protocol の版数（1 以上でスキーマ設計へ進める） */
  protocolVersions: number;
  /** 確定済み schema_version の数 */
  schemaVersions: number;
  /** pilot run の実行数（0 のとき一括抽出前に警告バナー） */
  pilotRuns: number;
  /** Evidence タブの行数（1 以上で検証へ進める） */
  evidenceRows: number;
  /** StudyData / ResultsData の行数合計（1 以上でエクスポートへ進める） */
  dataRows: number;
}

/**
 * batchGet の読み出し範囲。ヘッダ行（1 行目）を除いた 2 行目以降の
 * キー列だけを読む。順序は readProgressCounts の分解と対応させること
 */
const COUNT_RANGES = [
  'Documents!A2:A',
  'Protocol!A2:A',
  'SchemaVersions!A2:A',
  'ExtractionRuns!B2:I', // run_type〜status 列（2 行プロトコルのため完了行だけを数える）
  'Evidence!A2:A',
  'StudyData!A2:A',
  'ResultsData!A2:A',
] as const;

/** キー列が空でない行だけを数える（末尾のゴミ空行を件数に含めない） */
function countRows(rows: string[][]): number {
  return rows.filter((row) => (row[0] ?? '') !== '').length;
}

/**
 * 進捗カウントを Sheets から読み込む。
 * pilotRuns は ExtractionRuns の run_type = 'pilot' の完了行のみを数える
 * （run 1 件 = running 行 + 完了行の 2 行なので、行数のままだと二重に数えてしまう）
 */
export async function readProgressCounts(
  spreadsheetId: string,
  deps: GoogleApiDeps,
): Promise<ProgressCounts> {
  // getBatchValues は ranges と同順・同数を保証する（空範囲は []）ため 7 要素タプルとして扱える
  const [documents, protocol, schemaVersions, runRows, evidence, studyData, resultsData] =
    (await getBatchValues(spreadsheetId, COUNT_RANGES, deps)) as [
      string[][], string[][], string[][], string[][], string[][], string[][], string[][],
    ];
  return {
    documents: countRows(documents),
    protocolVersions: countRows(protocol),
    schemaVersions: countRows(schemaVersions),
    // row は B 列起点: row[0] = run_type, row[7] = status
    pilotRuns: runRows.filter(
      (row) =>
        (row[0] ?? '') === 'pilot' &&
        ((row[7] ?? '') === 'done' || (row[7] ?? '') === 'partial_failure'),
    ).length,
    evidenceRows: countRows(evidence),
    dataRows: countRows(studyData) + countRows(resultsData),
  };
}
