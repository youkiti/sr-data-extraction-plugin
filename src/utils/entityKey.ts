// entity_key の生成・パース（requirements.md §3.3）
// - study レベル: `-`（Evidence タブでの表記）
// - arm レベル: `arm:1`
// - outcome_result レベル: `outcome:mortality|arm:1|time:30d`（arm / time は任意）
// - rob_domain レベル（P1）: `rob:domain_1`

/** study レベルのエンティティキー（1 document に 1 インスタンス固定） */
export const STUDY_ENTITY_KEY = '-';

export type ParsedEntityKey =
  | { level: 'study' }
  | { level: 'arm'; arm: string }
  | { level: 'outcome_result'; outcome: string; arm: string | null; time: string | null }
  | { level: 'rob_domain'; domain: string };

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
  if (first.name === 'rob' && valid.length === 1) {
    return { level: 'rob_domain', domain: first.value };
  }
  if (first.name === 'outcome') {
    let arm: string | null = null;
    let time: string | null = null;
    for (const segment of valid.slice(1)) {
      if (segment.name === 'arm' && arm === null) {
        arm = segment.value;
      } else if (segment.name === 'time' && time === null) {
        time = segment.value;
      } else {
        return null;
      }
    }
    return { level: 'outcome_result', outcome: first.value, arm, time };
  }
  return null;
}
