// R セット（issue #60）共通のセル状態語彙。
// tab1 / ma / rob の各 builder が「値」と「検証状態」を分離出力する際の判定ロジックをここへ集約する。
//
// 設計判断（design-r-export.md 参照）: 既存の `verification/cellState.ts` は Decisions の
// 折り畳みから状態を導出するが、StudyData / ResultsData の annotator 行はその折り畳み結果を
// そのまま反映した「現在値」を保持している（NOT_REPORTED_TOKEN = not_reported、
// null = 未検証、それ以外 = 確定値）。R セットは annotator 行から直接読むため、
// Decisions を再度畳み込む必要はなく、ここでは NOT_REPORTED_TOKEN の規約だけを再利用する
import { NOT_REPORTED_TOKEN } from '../../../domain/annotation';

/** R セットのステータス語彙（tab1_status.csv / ma_status.csv / rob.csv の verification_status 列） */
export type RSetStatus = 'verified' | 'not_reported' | 'unverified' | 'no_data' | 'not_applicable';

/**
 * annotator 行から読んだ生値（NOT_REPORTED_TOKEN を含みうる）と AI Evidence の有無からステータスを導出する。
 * - 値が null（未検証）: Evidence があれば `unverified`、無ければ `no_data`
 * - 値が NOT_REPORTED_TOKEN: `not_reported`
 * - それ以外（人間が accept / edit / reject で確定した値）: `verified`
 */
export function resolveRSetStatus(rawValue: string | null, hasEvidence: boolean): RSetStatus {
  if (rawValue === null) {
    return hasEvidence ? 'unverified' : 'no_data';
  }
  if (rawValue === NOT_REPORTED_TOKEN) {
    return 'not_reported';
  }
  return 'verified';
}

/**
 * 値列に出す文字列（automation bias 対策: `verified` 以外は値を出さずステータス側にのみ委ねる。
 * D-4「unverified セルは値列空・ステータスのみ」を not_reported / no_data / not_applicable にも一貫適用する）
 */
export function resolveRSetValue(rawValue: string | null, status: RSetStatus): string {
  return status === 'verified' ? (rawValue ?? '') : '';
}

/** ResultsDataRow（value + notReported）を rawValue（NOT_REPORTED_TOKEN 規約）へ正規化する */
export function resultsRowRawValue(
  row: { value: string | null; notReported: boolean } | undefined,
): string | null {
  if (row === undefined) {
    return null;
  }
  return row.notReported ? NOT_REPORTED_TOKEN : row.value;
}
