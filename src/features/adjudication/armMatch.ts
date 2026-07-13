// 群構成の突き合わせ（docs/design-independent-dual-review.md §6.2・§13）。
// issue #63（arm 並べ替えマッピング）: v1 の「arm:1 ↔ arm:1 の位置対応固定」を解消し、
// 「A の各群に対応する B の群」のマッピングで突き合わせる。既定マッピングは
// 名称一致（trim）→ 位置対応 → 残り物同士 の順で自動対応し、裁定者は群構成カードで
// 手動変更できる。セル突き合わせ（cellMatch.ts）へは「B の armKey → 正準 armKey
// （A のキー空間 + B のみ群の新規採番キー）」の辞書（buildArmKeyRemap）として渡り、
// B 側 entity_key の書き換え（remapArmEntityKey）に使う。群構成の確定時は辞書を
// ArmStructures の note へ直列化（serializeArmKeyRemap）し、再入場時に復元する
// （parseArmKeyRemapNote。note に辞書が無い旧データは既定マッピングへフォールバック）
import { makeArmEntityKey, makeOutcomeEntityKey, parseEntityKey } from '../../utils/entityKey';

/** 群 1 本ぶんの参照（ArmStructures の最新版から armKey / armName だけを使う） */
export interface ArmRef {
  armKey: string;
  armName: string;
}

/** index = A の群順。値 = 対応する B の armKey（null = 対応なし） */
export type ArmMapping = readonly (string | null)[];

export interface DraftArmRow {
  armKey: string;
  armName: string;
}

/**
 * 既定マッピングを組み立てる: ①名称一致（trim。未使用の B から先頭順）
 * ②位置対応（同 index の B が未使用なら対応づける）③残り物同士（A の空き行へ B の残りを順に）。
 * 同名同順（従来の位置対応で一致していたケース）は①だけで全対応になり後方互換
 */
export function buildDefaultArmMapping(
  armsA: readonly ArmRef[],
  armsB: readonly ArmRef[],
): (string | null)[] {
  const used = new Set<string>();
  const mapping: (string | null)[] = armsA.map(() => null);
  armsA.forEach((armA, index) => {
    const hit = armsB.find((armB) => !used.has(armB.armKey) && armB.armName.trim() === armA.armName.trim());
    if (hit !== undefined) {
      mapping[index] = hit.armKey;
      used.add(hit.armKey);
    }
  });
  armsA.forEach((_, index) => {
    if (mapping[index] !== null) {
      return;
    }
    const positional = armsB[index];
    if (positional !== undefined && !used.has(positional.armKey)) {
      mapping[index] = positional.armKey;
      used.add(positional.armKey);
    }
  });
  const leftovers = armsB.filter((armB) => !used.has(armB.armKey));
  armsA.forEach((_, index) => {
    if (mapping[index] !== null) {
      return;
    }
    const next = leftovers.shift();
    if (next !== undefined) {
      mapping[index] = next.armKey;
    }
  });
  return mapping;
}

/**
 * マッピング適用後の一致判定: 本数が一致し、全 A 群に対応する B 群があり、
 * 対応する名称（trim 後）が一致するか（B のみ群は本数一致 + 全対応の時点で存在しない）
 */
export function armsMatch(
  armsA: readonly ArmRef[],
  armsB: readonly ArmRef[],
  mapping: ArmMapping,
): boolean {
  if (armsA.length !== armsB.length) {
    return false;
  }
  const byKey = new Map(armsB.map((arm) => [arm.armKey, arm]));
  return armsA.every((armA, index) => {
    const bKey = mapping[index] ?? null;
    if (bKey === null) {
      return false;
    }
    const armB = byKey.get(bKey);
    return armB !== undefined && armB.armName.trim() === armA.armName.trim();
  });
}

/** どの A の群にも対応づけられていない B の群（B の並び順を保つ） */
export function unmappedBArms(armsB: readonly ArmRef[], mapping: ArmMapping): ArmRef[] {
  const used = new Set(mapping.filter((key): key is string => key !== null));
  return armsB.filter((arm) => !used.has(arm.armKey));
}

/** B のみ群への新キー採番（A のキー・採番済みキーと衝突しない `arm:n` を 1 から順に探す） */
function freshKeysForUnmapped(
  armsA: readonly ArmRef[],
  armsB: readonly ArmRef[],
  mapping: ArmMapping,
): { arm: ArmRef; armKey: string }[] {
  const taken = new Set(armsA.map((arm) => arm.armKey));
  const assigned: { arm: ArmRef; armKey: string }[] = [];
  for (const arm of unmappedBArms(armsB, mapping)) {
    let n = 1;
    while (taken.has(makeArmEntityKey(n))) {
      n += 1;
    }
    const armKey = makeArmEntityKey(n);
    taken.add(armKey);
    assigned.push({ arm, armKey });
  }
  return assigned;
}

/**
 * 「B の armKey → 正準 armKey」の辞書を組み立てる。対応づけられた B 群は対応先 A 群の
 * armKey へ、B のみ群は A のキー空間と衝突しない新規採番キーへ写す（B の全群が対象 = 全域写像）
 */
export function buildArmKeyRemap(
  armsA: readonly ArmRef[],
  armsB: readonly ArmRef[],
  mapping: ArmMapping,
): Map<string, string> {
  const remap = new Map<string, string>();
  mapping.forEach((bKey, index) => {
    const armA = armsA[index];
    if (bKey !== null && armA !== undefined) {
      remap.set(bKey, armA.armKey);
    }
  });
  for (const { arm, armKey } of freshKeysForUnmapped(armsA, armsB, mapping)) {
    remap.set(arm.armKey, armKey);
  }
  return remap;
}

/**
 * 永続化された辞書（B → 正準）から A index → B armKey のマッピングを逆引きする（再入場時の復元）。
 * 対応の無い A 行は null。壊れた辞書（同じ正準キーへ複数の B が写る等）は先勝ちで読む
 */
export function armMappingFromRemap(
  armsA: readonly ArmRef[],
  armsB: readonly ArmRef[],
  remap: ReadonlyMap<string, string>,
): (string | null)[] {
  const claimed = new Set<string>();
  return armsA.map((armA) => {
    const hit = armsB.find((armB) => !claimed.has(armB.armKey) && remap.get(armB.armKey) === armA.armKey);
    if (hit === undefined) {
      return null;
    }
    claimed.add(hit.armKey);
    return hit.armKey;
  });
}

/**
 * consensus 群構成の編集用ドラフト初期値: A の群（armKey・名称とも A 由来）+ B のみ群
 * （新規採番キー + B の名称）。armKey を A から引き継ぐことで、consensus の
 * ArmStructures.arm_key とセル突き合わせの正準 entity_key が構造的に一致する
 */
export function buildConsensusArmDraft(
  armsA: readonly ArmRef[],
  armsB: readonly ArmRef[],
  mapping: ArmMapping,
): DraftArmRow[] {
  const rows: DraftArmRow[] = armsA.map((arm) => ({ armKey: arm.armKey, armName: arm.armName.trim() }));
  for (const { arm, armKey } of freshKeysForUnmapped(armsA, armsB, mapping)) {
    rows.push({ armKey, armName: arm.armName.trim() });
  }
  return rows;
}

const ARM_MAPPING_NOTE_PREFIX = 'arm_mapping:';

/** ArmStructures の note へ残す直列化（群構成の確定時）: `arm_mapping:{"B の armKey":"正準 armKey"}` */
export function serializeArmKeyRemap(remap: ReadonlyMap<string, string>): string {
  return `${ARM_MAPPING_NOTE_PREFIX}${JSON.stringify(Object.fromEntries(remap))}`;
}

/** note から辞書を復元する。note なし・辞書なし・形式不正は null（既定マッピングへフォールバック） */
export function parseArmKeyRemapNote(note: string | null): Map<string, string> | null {
  if (note === null) {
    return null;
  }
  const index = note.indexOf(ARM_MAPPING_NOTE_PREFIX);
  if (index === -1) {
    return null;
  }
  try {
    const parsed: unknown = JSON.parse(note.slice(index + ARM_MAPPING_NOTE_PREFIX.length));
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
      return null;
    }
    const remap = new Map<string, string>();
    for (const [key, value] of Object.entries(parsed)) {
      if (typeof value !== 'string') {
        return null;
      }
      remap.set(key, value);
    }
    return remap;
  } catch {
    return null;
  }
}

/**
 * entity_key の arm セグメントを辞書で書き換える（B 側の行に適用する。issue #63）。
 * arm レベルはキー全体を、outcome_result レベルは `arm:` セグメントだけを写す。
 * 辞書に無い arm・arm を含まないレベル（study / rob_domain）・形式不正のキーはそのまま返す
 */
export function remapArmEntityKey(entityKey: string, remap: ReadonlyMap<string, string>): string {
  const parsed = parseEntityKey(entityKey);
  if (parsed === null) {
    return entityKey;
  }
  if (parsed.level === 'arm') {
    return remap.get(entityKey) ?? entityKey;
  }
  if (parsed.level === 'outcome_result' && parsed.arm !== null) {
    const mapped = remap.get(makeArmEntityKey(parsed.arm));
    if (mapped === undefined) {
      return entityKey;
    }
    const armValue = mapped.slice('arm:'.length);
    return makeOutcomeEntityKey({
      outcome: parsed.outcome,
      arm: armValue,
      ...(parsed.time !== null ? { time: parsed.time } : {}),
    });
  }
  return entityKey;
}
