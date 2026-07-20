// entity_key の生成・パース（requirements.md §3.3）
// - study レベル: `-`（Evidence タブでの表記）
// - arm レベル: `arm:1`
// - outcome_result レベル: `outcome:mortality|arm:1|time:30d`（arm / time は任意）
// - rob_domain レベル（P1）: `rob:domain_1`（= base 評価）。estimate（result）単位の
//   オーバーライド（issue #109）は `rob:<domain_id>|outcome:<key>[|arm:<n>][|time:<t>]`

/** study レベルのエンティティキー（1 document に 1 インスタンス固定） */
export const STUDY_ENTITY_KEY = '-';

export type ParsedEntityKey =
  | { level: 'study' }
  | { level: 'arm'; arm: string }
  | { level: 'outcome_result'; outcome: string; arm: string | null; time: string | null }
  | {
      level: 'rob_domain';
      domain: string;
      /** estimate スコープの参照先 outcome（issue #109）。base 評価では 3 スロットとも省略 */
      outcome?: string;
      arm?: string | null;
      time?: string | null;
    };

/** セグメント値に使えない文字（区切り記号）が含まれていないか検証する */
function assertSegmentValue(value: string, label: string): void {
  if (value === '' || value.includes('|') || value.includes(':')) {
    throw new Error(`entity_key の ${label} に使用できない値です: "${value}"`);
  }
}

export function makeArmEntityKey(arm: string | number): string {
  const value = String(arm);
  assertSegmentValue(value, 'arm');
  return `arm:${value}`;
}

export function makeOutcomeEntityKey(parts: {
  outcome: string;
  arm?: string | number;
  time?: string;
}): string {
  assertSegmentValue(parts.outcome, 'outcome');
  const segments = [`outcome:${parts.outcome}`];
  if (parts.arm !== undefined) {
    const armValue = String(parts.arm);
    assertSegmentValue(armValue, 'arm');
    segments.push(`arm:${armValue}`);
  }
  if (parts.time !== undefined) {
    assertSegmentValue(parts.time, 'time');
    segments.push(`time:${parts.time}`);
  }
  return segments.join('|');
}

export function makeRobDomainEntityKey(domain: string): string {
  assertSegmentValue(domain, 'rob ドメイン');
  return `rob:${domain}`;
}

/**
 * estimate（result）単位の RoB オーバーライドキー（issue #109）:
 * `rob:<domain_id>|outcome:<key>[|arm:<n>][|time:<t>]`。
 * 参照先は makeOutcomeEntityKey と同じ正準順序（outcome → arm → time）で組み立てる
 */
export function makeRobEstimateEntityKey(
  domain: string,
  parts: { outcome: string; arm?: string | number; time?: string },
): string {
  assertSegmentValue(domain, 'rob ドメイン');
  return `rob:${domain}|${makeOutcomeEntityKey(parts)}`;
}

/**
 * rob_domain キーが参照する estimate（outcome_result インスタンス）のキーを正準形で返す。
 * base 評価（`rob:<domain_id>` 単独）・rob_domain 以外・形式不正は null
 */
export function robEstimateScopeOf(key: string): string | null {
  const parsed = parseEntityKey(key);
  if (parsed?.level !== 'rob_domain' || parsed.outcome === undefined) {
    return null;
  }
  return makeOutcomeEntityKey({
    outcome: parsed.outcome,
    arm: parsed.arm ?? undefined,
    time: parsed.time ?? undefined,
  });
}

/**
 * 既存 outcome_result キーを見て、人手追加フォームの既定 outcome id を採番する。
 * `outcome_1` / `outcome_2` ... だけを数え、ユーザー定義の可読キーはそのまま残す。
 */
export function nextOutcomeId(existingKeys: Iterable<string>): string {
  let max = 0;
  for (const key of existingKeys) {
    const parsed = parseEntityKey(key);
    if (parsed?.level !== 'outcome_result') {
      continue;
    }
    const match = /^outcome_(\d+)$/.exec(parsed.outcome);
    if (match !== null) {
      max = Math.max(max, Number(match[1]));
    }
  }
  return `outcome_${max + 1}`;
}

/** entity_key 文字列を判別可能な構造に戻す。形式不正は null */
export function parseEntityKey(key: string): ParsedEntityKey | null {
  if (key === STUDY_ENTITY_KEY) {
    return { level: 'study' };
  }
  const segments = key.split('|').map((segment) => {
    const index = segment.indexOf(':');
    if (index <= 0 || index === segment.length - 1) {
      return null;
    }
    return { name: segment.slice(0, index), value: segment.slice(index + 1) };
  });
  if (segments.some((segment) => segment === null || segment.value.includes(':'))) {
    return null;
  }
  const valid = segments as Array<{ name: string; value: string }>;
  // split('|') は最低 1 要素を返すため必ず存在する
  const first = valid[0] as { name: string; value: string };
  if (first.name === 'arm' && valid.length === 1) {
    return { level: 'arm', arm: first.value };
  }
  if (first.name === 'rob') {
    if (valid.length === 1) {
      return { level: 'rob_domain', domain: first.value };
    }
    // estimate スコープ（issue #109）: 2 番目は必ず outcome セグメント
    const second = valid[1] as { name: string; value: string };
    if (second.name !== 'outcome') {
      return null;
    }
    const tail = readOutcomeTail(valid.slice(2));
    if (tail === null) {
      return null;
    }
    return {
      level: 'rob_domain',
      domain: first.value,
      outcome: second.value,
      arm: tail.arm,
      time: tail.time,
    };
  }
  if (first.name === 'outcome') {
    const tail = readOutcomeTail(valid.slice(1));
    if (tail === null) {
      return null;
    }
    return { level: 'outcome_result', outcome: first.value, arm: tail.arm, time: tail.time };
  }
  return null;
}

/** outcome セグメント以降の `arm:` / `time:`（各 1 回まで）を読む。他のセグメントは形式不正（null） */
function readOutcomeTail(
  segments: readonly { name: string; value: string }[],
): { arm: string | null; time: string | null } | null {
  let arm: string | null = null;
  let time: string | null = null;
  for (const segment of segments) {
    if (segment.name === 'arm' && arm === null) {
      arm = segment.value;
    } else if (segment.name === 'time' && time === null) {
      time = segment.value;
    } else {
      return null;
    }
  }
  return { arm, time };
}
