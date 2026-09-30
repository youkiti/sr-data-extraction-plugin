// 担当セットの行型と識別子。calibration と番号付きグループを表示順に並べる。
/** 担当セットの識別子。グループ番号は 1 から始まる */
export type ReviewSetId = 'calibration' | `group-${number}`;
export const CALIBRATION_SET_ID = 'calibration';

/** ReviewSets タブの追記行 */
export interface ReviewSetRow {
  setId: string;
  reviewerEmails: string[];
  seed: string | null;
  /** null は直前の所属を引き継ぎ、空配列は所属なし */
  studyIds: string[] | null;
  /** 担当者の編集後も保持する、seed を記録した分割の日時（メモリ内のみ） */
  splitUpdatedAt?: string;
  updatedBy: string;
  updatedAt: string;
}

export function groupSetId(n: number): ReviewSetId {
  if (!Number.isSafeInteger(n) || n < 1) throw new Error('グループ番号は 1 以上の整数が必要です');
  return `group-${n}`;
}

export function isGroupSetId(id: string): id is `group-${number}` {
  return /^group-[1-9]\d*$/.test(id) && Number.isSafeInteger(Number(id.slice(6)));
}

/** calibration を先頭にし、グループは番号順、不明な識別子は末尾に並べる */
export function compareReviewSetIds(a: string, b: string): number {
  if (a === b) return 0;
  if (a === CALIBRATION_SET_ID) return -1;
  if (b === CALIBRATION_SET_ID) return 1;
  const aGroup = isGroupSetId(a);
  const bGroup = isGroupSetId(b);
  if (aGroup && bGroup) return Number(a.slice(6)) - Number(b.slice(6));
  if (aGroup) return -1;
  if (bGroup) return 1;
  return a.localeCompare(b);
}
