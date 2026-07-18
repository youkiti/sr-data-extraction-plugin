// 群構成の突き合わせ（docs/design-independent-dual-review.md §6.2・§13）。
// issue #63（arm 並べ替えマッピング）: v1 の「arm:1 ↔ arm:1 の位置対応固定」を解消し、
// 「A の各群に対応する B の群」のマッピングで突き合わせる。既定マッピングは
// 名称一致（trim）→ 位置対応 → 残り物同士 の順で自動対応し、裁定者は群構成カードで
// 手動変更できる。セル突き合わせ（cellMatch.ts）へは「B の armKey → 正準 armKey
// （A のキー空間 + B のみ群の新規採番キー）」の辞書（buildArmKeyRemap）として渡り、
// B 側 entity_key の書き換え（remapArmEntityKey）に使う。群構成の確定時は辞書を
// ArmStructures の note へ直列化（serializeArmKeyRemap）し、再入場時に復元する
// （parseArmKeyRemapNote。note に辞書が無い旧データは既定マッピングへフォールバック）。
// issue #117（裁定 arm マッピングの残エッジ）: remapArmEntityKey のセグメント順序保存
// （非正準順キーでの偽の不一致を解消）+ 素通しキー衝突検知（escapeArmKeyRemapCollisions。
// 無言のデータ潰しを防ぐ）を追加
import { makeArmEntityKey, parseEntityKey } from '../../utils/entityKey';

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
 * 辞書に無い arm・arm を含まないレベル（study / rob_domain）・形式不正のキーはそのまま返す。
 *
 * issue #117 件1: outcome_result レベルは `makeOutcomeEntityKey` で正準順（outcome|arm|time）へ
 * 再構築せず、元のセグメント順序を保ったまま `arm:` セグメントだけをその場で置換する。
 * LLM が非正準順（例 `outcome:x|time:30d|arm:1`）のキーを出力していた場合、正準順への
 * 再構築だと恒等マッピング（B armKey → 同じ A armKey）ですら A/B のキー文字列が食い違い
 * 「偽の不一致」になっていたための修正（`validateAiOutput` は entity_key を素通し保存するため
 * 非正準順のキーが理論上到達しうる。根治策〔validateAiOutput 側での正準化〕は既存保存データとの
 * 意味論が変わるため見送り、突き合わせ側〔ここ〕での吸収に留める）
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
    const armSegment = makeArmEntityKey(armValue);
    return entityKey
      .split('|')
      .map((segment) => (segment.startsWith('arm:') ? armSegment : segment))
      .join('|');
  }
  return entityKey;
}

/**
 * entity_key の列から実際に使われている arm キー（`arm:n` 形式）を集める
 * （issue #117 件2: B の確定 ArmStructures に無い「素通しキー」の衝突検知に使う）
 */
export function armKeysInUse(entityKeys: Iterable<string>): Set<string> {
  const keys = new Set<string>();
  for (const entityKey of entityKeys) {
    const parsed = parseEntityKey(entityKey);
    if (parsed === null) {
      continue;
    }
    if (parsed.level === 'arm') {
      keys.add(entityKey);
    } else if (parsed.level === 'outcome_result' && parsed.arm !== null) {
      keys.add(makeArmEntityKey(parsed.arm));
    }
  }
  return keys;
}

export interface ArmKeyRemapEscapeResult {
  /** 衝突を退避した辞書（衝突が無ければ元の辞書と等価な新規 Map） */
  remap: Map<string, string>;
  /** 退避された素通しキー（B の生 entity_key に現れた arm キーのうち辞書対象外だったもの） */
  collisions: string[];
}

/**
 * B の ResultsData / Decisions の実データに現れる arm キー（`actualBArmKeys`）のうち、
 * 辞書（`remap`）の対象外（= B の確定 ArmStructures に無い「素通しキー」。evidence 由来の
 * 旧データ等）が、辞書の写像先（正準キー集合）と文字列衝突する場合に、衝突しない新規キーへ
 * 退避した辞書を返す（issue #117 件2）。
 *
 * 背景: `remapArmEntityKey` は辞書に無い arm キーをそのまま通す（素通し）。素通しキーが
 * たまたま辞書の写像先と同じ文字列になると、突き合わせ側（`indexResultsRows` の Map）で
 * 後勝ちの 1 行が他方を無言で潰す。ここで事前に検知し、退避キーへ差し替えることでデータ消失を防ぐ
 * （退避キーは正準キー集合・実データ上の全 arm キー・他の退避キーのいずれとも衝突しない
 * `arm:n` を 1 から順に探して割り当てる）。衝突が無ければ `remap` のコピーをそのまま返す
 */
export function escapeArmKeyRemapCollisions(
  remap: ReadonlyMap<string, string>,
  actualBArmKeys: ReadonlySet<string>,
): ArmKeyRemapEscapeResult {
  const canonicalTargets = new Set(remap.values());
  const collidingKeys = [...actualBArmKeys]
    .filter((key) => !remap.has(key) && canonicalTargets.has(key))
    .sort();
  const escaped = new Map(remap);
  if (collidingKeys.length === 0) {
    return { remap: escaped, collisions: [] };
  }
  const taken = new Set<string>([...canonicalTargets, ...actualBArmKeys, ...remap.keys()]);
  for (const key of collidingKeys) {
    let n = 1;
    while (taken.has(makeArmEntityKey(n))) {
      n += 1;
    }
    const escapeKey = makeArmEntityKey(n);
    taken.add(escapeKey);
    escaped.set(key, escapeKey);
  }
  return { remap: escaped, collisions: collidingKeys };
}
