import {
  STUDY_ENTITY_KEY,
  makeArmEntityKey,
  makeOutcomeEntityKey,
  makeRobDomainEntityKey,
  makeRobEstimateEntityKey,
  nextOutcomeId,
  parseEntityKey,
  robEstimateScopeOf,
} from '../../../src/utils/entityKey';

describe('makeArmEntityKey', () => {
  test('数値・文字列から arm キーを生成する', () => {
    expect(makeArmEntityKey(1)).toBe('arm:1');
    expect(makeArmEntityKey('intervention')).toBe('arm:intervention');
  });

  test('区切り記号・空文字は拒否する', () => {
    expect(() => makeArmEntityKey('a|b')).toThrow('entity_key');
    expect(() => makeArmEntityKey('a:b')).toThrow('entity_key');
    expect(() => makeArmEntityKey('')).toThrow('entity_key');
  });
});

describe('makeOutcomeEntityKey', () => {
  test('outcome のみ', () => {
    expect(makeOutcomeEntityKey({ outcome: 'mortality' })).toBe('outcome:mortality');
  });

  test('outcome + arm + time（requirements.md §3.3 の形式）', () => {
    expect(makeOutcomeEntityKey({ outcome: 'mortality', arm: 1, time: '30d' })).toBe(
      'outcome:mortality|arm:1|time:30d',
    );
  });

  test('outcome + time のみ（arm 省略）', () => {
    expect(makeOutcomeEntityKey({ outcome: 'pain', time: '8w' })).toBe('outcome:pain|time:8w');
  });

  test('各セグメント値の区切り記号を拒否する', () => {
    expect(() => makeOutcomeEntityKey({ outcome: 'a|b' })).toThrow('entity_key');
    expect(() => makeOutcomeEntityKey({ outcome: 'x', arm: '1|2' })).toThrow('entity_key');
    expect(() => makeOutcomeEntityKey({ outcome: 'x', time: '30:00' })).toThrow('entity_key');
  });
});

describe('makeRobDomainEntityKey', () => {
  test('rob ドメインキーを生成する', () => {
    expect(makeRobDomainEntityKey('domain_1')).toBe('rob:domain_1');
  });

  test('不正な値を拒否する', () => {
    expect(() => makeRobDomainEntityKey('d|1')).toThrow('entity_key');
  });
});

describe('makeRobEstimateEntityKey', () => {
  test('outcome のみの estimate スコープキーを生成する', () => {
    expect(makeRobEstimateEntityKey('d1_randomization', { outcome: 'mortality' })).toBe(
      'rob:d1_randomization|outcome:mortality',
    );
  });

  test('outcome + arm + time は makeOutcomeEntityKey と同じ正準順序で組み立てる', () => {
    expect(makeRobEstimateEntityKey('overall', { outcome: 'pain', arm: 1, time: '30d' })).toBe(
      'rob:overall|outcome:pain|arm:1|time:30d',
    );
  });

  test('ドメイン・参照先セグメントの区切り記号を拒否する', () => {
    expect(() => makeRobEstimateEntityKey('d|1', { outcome: 'x' })).toThrow('entity_key');
    expect(() => makeRobEstimateEntityKey('d1', { outcome: 'a|b' })).toThrow('entity_key');
  });
});

describe('robEstimateScopeOf', () => {
  test('estimate スコープキーから参照先 outcome キーを正準形で返す', () => {
    expect(robEstimateScopeOf('rob:d1|outcome:mortality')).toBe('outcome:mortality');
    expect(robEstimateScopeOf('rob:d1|outcome:mortality|arm:1')).toBe('outcome:mortality|arm:1');
    expect(robEstimateScopeOf('rob:d1|outcome:pain|time:8w')).toBe('outcome:pain|time:8w');
  });

  test('順序違いの入力も正準順序（outcome → arm → time）へ戻る', () => {
    expect(robEstimateScopeOf('rob:d1|outcome:mortality|time:30d|arm:1')).toBe(
      'outcome:mortality|arm:1|time:30d',
    );
  });

  test('base 評価・rob_domain 以外・形式不正は null', () => {
    expect(robEstimateScopeOf('rob:d1')).toBeNull();
    expect(robEstimateScopeOf('outcome:mortality|arm:1')).toBeNull();
    expect(robEstimateScopeOf('broken')).toBeNull();
  });
});

describe('nextOutcomeId', () => {
  test('既存 outcome_<n> の最大 + 1 を返す', () => {
    expect(
      nextOutcomeId([
        'outcome:outcome_1|arm:1',
        'outcome:mortality|arm:1',
        'outcome:outcome_4|arm:2|time:30d',
        'arm:1',
        'broken',
      ]),
    ).toBe('outcome_5');
  });

  test('番号付き outcome が無ければ outcome_1', () => {
    expect(nextOutcomeId(['outcome:mortality|arm:1'])).toBe('outcome_1');
  });
});

describe('parseEntityKey', () => {
  test('study レベル（`-`）', () => {
    expect(parseEntityKey(STUDY_ENTITY_KEY)).toEqual({ level: 'study' });
  });

  test('arm レベル', () => {
    expect(parseEntityKey('arm:1')).toEqual({ level: 'arm', arm: '1' });
  });

  test('rob_domain レベル（P1）', () => {
    expect(parseEntityKey('rob:domain_1')).toEqual({ level: 'rob_domain', domain: 'domain_1' });
  });

  test('rob_domain の estimate スコープ（issue #109）', () => {
    expect(parseEntityKey('rob:d1|outcome:mortality')).toEqual({
      level: 'rob_domain',
      domain: 'd1',
      outcome: 'mortality',
      arm: null,
      time: null,
    });
    expect(parseEntityKey('rob:d1|outcome:mortality|arm:1|time:30d')).toEqual({
      level: 'rob_domain',
      domain: 'd1',
      outcome: 'mortality',
      arm: '1',
      time: '30d',
    });
    // outcome_result と同じセグメント読解のため arm / time の順序違いも受理する
    expect(parseEntityKey('rob:d1|outcome:mortality|time:30d|arm:1')).toEqual({
      level: 'rob_domain',
      domain: 'd1',
      outcome: 'mortality',
      arm: '1',
      time: '30d',
    });
  });

  test('estimate スコープの生成関数とラウンドトリップする', () => {
    const key = makeRobEstimateEntityKey('d2_deviations', { outcome: 'sens', arm: 2, time: '12w' });
    expect(parseEntityKey(key)).toEqual({
      level: 'rob_domain',
      domain: 'd2_deviations',
      outcome: 'sens',
      arm: '2',
      time: '12w',
    });
  });

  test('outcome_result レベル（arm / time 省略）', () => {
    expect(parseEntityKey('outcome:mortality')).toEqual({
      level: 'outcome_result',
      outcome: 'mortality',
      arm: null,
      time: null,
    });
  });

  test('outcome_result レベル（フル形式・順序違いも受理）', () => {
    expect(parseEntityKey('outcome:mortality|arm:1|time:30d')).toEqual({
      level: 'outcome_result',
      outcome: 'mortality',
      arm: '1',
      time: '30d',
    });
    expect(parseEntityKey('outcome:mortality|time:30d|arm:1')).toEqual({
      level: 'outcome_result',
      outcome: 'mortality',
      arm: '1',
      time: '30d',
    });
  });

  test('生成関数とラウンドトリップする', () => {
    const key = makeOutcomeEntityKey({ outcome: 'hba1c', arm: 2, time: '12w' });
    expect(parseEntityKey(key)).toEqual({
      level: 'outcome_result',
      outcome: 'hba1c',
      arm: '2',
      time: '12w',
    });
  });

  test('形式不正は null を返す', () => {
    expect(parseEntityKey('')).toBeNull(); // コロンなし
    expect(parseEntityKey(':value')).toBeNull(); // 名前なし
    expect(parseEntityKey('arm:')).toBeNull(); // 値なし
    expect(parseEntityKey('outcome:x:y')).toBeNull(); // 値にコロン
    expect(parseEntityKey('foo:1')).toBeNull(); // 未知のセグメント名
    expect(parseEntityKey('arm:1|arm:2')).toBeNull(); // arm の複数指定
    expect(parseEntityKey('rob:d1|rob:d2')).toBeNull(); // rob の複数指定
    expect(parseEntityKey('outcome:x|arm:1|arm:2')).toBeNull(); // arm 重複
    expect(parseEntityKey('outcome:x|time:1w|time:2w')).toBeNull(); // time 重複
    expect(parseEntityKey('outcome:x|foo:1')).toBeNull(); // 未知の後続セグメント
    expect(parseEntityKey('outcome:x|bad')).toBeNull(); // 後続セグメントにコロンなし
  });

  test('rob_domain の estimate スコープの形式不正は null（outcome_result と同じ厳格さ）', () => {
    expect(parseEntityKey('rob:d1|arm:1')).toBeNull(); // outcome 無しで arm だけ
    expect(parseEntityKey('rob:d1|time:30d')).toBeNull(); // outcome 無しで time だけ
    expect(parseEntityKey('rob:d1|outcome:x|outcome:y')).toBeNull(); // outcome 重複
    expect(parseEntityKey('rob:d1|outcome:x|arm:1|arm:2')).toBeNull(); // arm 重複
    expect(parseEntityKey('rob:d1|outcome:x|time:1w|time:2w')).toBeNull(); // time 重複
    expect(parseEntityKey('rob:d1|outcome:x|foo:1')).toBeNull(); // 未知の後続セグメント
    expect(parseEntityKey('rob:d1|outcome:x|rob:d2')).toBeNull(); // rob の再出現
  });
});
