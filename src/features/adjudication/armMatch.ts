// 群構成の突き合わせ（docs/design-independent-dual-review.md §6.2）。
// 両者の最新 ArmStructures を arm:1 ↔ arm:1 の位置対応で並べ、本数・名称が完全一致するかを判定する。
// 並べ替えマッピング UI は将来拡張のため v1 は位置対応固定（§11）
import { makeArmEntityKey } from '../../utils/entityKey';

export interface DraftArmRow {
  armKey: string;
  armName: string;
}

/** 本数と、位置対応での名称（trim 後）が完全一致するか */
export function armsMatch(
  armsA: readonly { armName: string }[],
  armsB: readonly { armName: string }[],
): boolean {
  if (armsA.length !== armsB.length) {
    return false;
  }
  return armsA.every(
    (arm, index) => arm.armName.trim() === (armsB[index] as { armName: string }).armName.trim(),
  );
}

/**
 * consensus 群構成の編集用ドラフトを組み立てる。一致していれば A（= B と同一）の名称を、
 * 本数が食い違う位置は存在する側の名称を初期値にする（裁定者が編集して確定する下書き）。
 * armKey は既存の arm キー流用ではなく、位置に基づいて `arm:1`... を振り直す
 * （consensus は新しい版として独立に確定するため）
 */
export function buildConsensusArmDraft(
  armsA: readonly { armName: string }[],
  armsB: readonly { armName: string }[],
): DraftArmRow[] {
  const length = Math.max(armsA.length, armsB.length);
  const rows: DraftArmRow[] = [];
  for (let index = 0; index < length; index += 1) {
    // index < length（= max(lenA, lenB)）なので、どちらかは必ず存在する
    const source = index < armsA.length ? armsA[index] : armsB[index];
    rows.push({
      armKey: makeArmEntityKey(index + 1),
      armName: (source as { armName: string }).armName.trim(),
    });
  }
  return rows;
}
