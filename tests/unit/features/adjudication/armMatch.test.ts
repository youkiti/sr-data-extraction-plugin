import {
  armMappingFromRemap,
  armsMatch,
  buildArmKeyRemap,
  buildConsensusArmDraft,
  buildDefaultArmMapping,
  parseArmKeyRemapNote,
  remapArmEntityKey,
  serializeArmKeyRemap,
  unmappedBArms,
  type ArmRef,
} from '../../../../src/features/adjudication/armMatch';

function arm(armKey: string, armName: string): ArmRef {
  return { armKey, armName };
}

describe('buildDefaultArmMapping', () => {
  test('同名同順（従来の位置対応一致）は名称一致だけで全対応になる', () => {
    expect(
      buildDefaultArmMapping(
        [arm('arm:1', '介入群 '), arm('arm:2', '対照群')],
        [arm('arm:1', '介入群'), arm('arm:2', ' 対照群')],
      ),
    ).toEqual(['arm:1', 'arm:2']);
  });

  test('同名別順は名称一致で自動的に並べ替えて対応する（issue #63 の主目的）', () => {
    expect(
      buildDefaultArmMapping(
        [arm('arm:1', '介入群'), arm('arm:2', '対照群')],
        [arm('arm:1', '対照群'), arm('arm:2', '介入群')],
      ),
    ).toEqual(['arm:2', 'arm:1']);
  });

  test('名称がすべて異なる場合は位置対応にフォールバックする（従来挙動の維持）', () => {
    expect(
      buildDefaultArmMapping(
        [arm('arm:1', 'X'), arm('arm:2', 'Y')],
        [arm('arm:1', 'P'), arm('arm:2', 'Q')],
      ),
    ).toEqual(['arm:1', 'arm:2']);
  });

  test('名称一致が位置対応の相手を奪った残りは、残り物同士で対応づける', () => {
    // A[1]「介入群」が B[0]「介入群」を名称一致で取り、A[0] は残った B[1] と対応する
    expect(
      buildDefaultArmMapping(
        [arm('arm:1', '対照群'), arm('arm:2', '介入群')],
        [arm('arm:1', '介入群'), arm('arm:2', '対照群 (usual care)')],
      ),
    ).toEqual(['arm:2', 'arm:1']);
  });

  test('B が少ないとき対応の無い A 行は null になる', () => {
    expect(
      buildDefaultArmMapping([arm('arm:1', 'X'), arm('arm:2', 'Y'), arm('arm:3', 'Z')], [arm('arm:1', 'Y')]),
    ).toEqual([null, 'arm:1', null]);
  });

  test('両者 0 件は空マッピング', () => {
    expect(buildDefaultArmMapping([], [])).toEqual([]);
  });
});

describe('armsMatch', () => {
  test('マッピングで対応づけた名称（trim 後）がすべて一致すれば true（順序が違っても一致）', () => {
    expect(
      armsMatch(
        [arm('arm:1', '介入群'), arm('arm:2', '対照群')],
        [arm('arm:1', '対照群 '), arm('arm:2', '介入群')],
        ['arm:2', 'arm:1'],
      ),
    ).toBe(true);
  });

  test('本数が異なれば false', () => {
    expect(armsMatch([arm('arm:1', '介入群')], [arm('arm:1', '介入群'), arm('arm:2', '対照群')], ['arm:1'])).toBe(
      false,
    );
  });

  test('対応なし（null）の A 行があれば false', () => {
    expect(
      armsMatch([arm('arm:1', 'X'), arm('arm:2', 'Y')], [arm('arm:1', 'X'), arm('arm:2', 'Q')], ['arm:1', null]),
    ).toBe(false);
  });

  test('対応する B 群の名称が異なれば false', () => {
    expect(
      armsMatch([arm('arm:1', 'X'), arm('arm:2', 'Y')], [arm('arm:1', 'X'), arm('arm:2', 'Q')], ['arm:1', 'arm:2']),
    ).toBe(false);
  });

  test('マッピングが存在しない B の armKey を指していれば false', () => {
    expect(armsMatch([arm('arm:1', 'X')], [arm('arm:1', 'X')], ['arm:9'])).toBe(false);
  });

  test('マッピング配列が A より短い（値未定義）行は対応なし扱いで false', () => {
    expect(armsMatch([arm('arm:1', 'X'), arm('arm:2', 'Y')], [arm('arm:1', 'X'), arm('arm:2', 'Y')], ['arm:1'])).toBe(
      false,
    );
  });

  test('両者 0 件は一致扱い（vacuous true）', () => {
    expect(armsMatch([], [], [])).toBe(true);
  });
});

describe('unmappedBArms', () => {
  test('どの A にも対応づけられていない B の群を B の並び順で返す', () => {
    expect(
      unmappedBArms([arm('arm:1', 'P'), arm('arm:2', 'Q'), arm('arm:3', 'R')], ['arm:2', null]),
    ).toEqual([arm('arm:1', 'P'), arm('arm:3', 'R')]);
  });
});

describe('buildArmKeyRemap', () => {
  test('対応づけた B 群は対応先 A 群の armKey へ、B のみ群は衝突しない新キーへ写す', () => {
    const remap = buildArmKeyRemap(
      [arm('arm:1', 'X'), arm('arm:2', 'Y')],
      [arm('arm:1', 'Y'), arm('arm:2', 'X'), arm('arm:3', 'Z')],
      ['arm:2', 'arm:1'],
    );
    expect([...remap.entries()]).toEqual([
      ['arm:2', 'arm:1'],
      ['arm:1', 'arm:2'],
      ['arm:3', 'arm:3'],
    ]);
  });

  test('B のみ群の新キーは A のキーとの衝突を避けて最小の空き番号を使う', () => {
    // A が arm:1..2 を使用 → B のみ群（arm:1）は arm:3 へ
    const remap = buildArmKeyRemap(
      [arm('arm:1', 'X'), arm('arm:2', 'Y')],
      [arm('arm:1', 'P'), arm('arm:2', 'X'), arm('arm:3', 'Y')],
      ['arm:2', 'arm:3'],
    );
    expect(remap.get('arm:1')).toBe('arm:3');
  });

  test('マッピング配列が A より長い余剰 index は無視する（防御）', () => {
    const remap = buildArmKeyRemap([arm('arm:1', 'X')], [arm('arm:1', 'X')], ['arm:1', 'arm:9']);
    expect([...remap.entries()]).toEqual([['arm:1', 'arm:1']]);
  });
});

describe('armMappingFromRemap', () => {
  test('永続化された辞書から A index → B armKey を復元する', () => {
    const remap = new Map([
      ['arm:2', 'arm:1'],
      ['arm:1', 'arm:2'],
    ]);
    expect(
      armMappingFromRemap([arm('arm:1', 'X'), arm('arm:2', 'Y')], [arm('arm:1', 'Y'), arm('arm:2', 'X')], remap),
    ).toEqual(['arm:2', 'arm:1']);
  });

  test('辞書に対応が無い A 行は null', () => {
    expect(armMappingFromRemap([arm('arm:1', 'X')], [arm('arm:1', 'P')], new Map([['arm:1', 'arm:9']]))).toEqual([
      null,
    ]);
  });

  test('壊れた辞書（複数の B が同じ正準キーへ写る）は先勝ちで読む', () => {
    const remap = new Map([
      ['arm:1', 'arm:1'],
      ['arm:2', 'arm:1'],
    ]);
    expect(armMappingFromRemap([arm('arm:1', 'X')], [arm('arm:1', 'X'), arm('arm:2', 'Y')], remap)).toEqual([
      'arm:1',
    ]);
  });
});

describe('buildConsensusArmDraft', () => {
  test('A の armKey・名称を引き継ぎ、B のみ群を新キーで末尾に足す', () => {
    expect(
      buildConsensusArmDraft(
        [arm('arm:1', '介入群 '), arm('arm:2', '対照群')],
        [arm('arm:1', '対照群'), arm('arm:2', '介入群'), arm('arm:3', '第 3 群')],
        ['arm:2', 'arm:1'],
      ),
    ).toEqual([
      { armKey: 'arm:1', armName: '介入群' },
      { armKey: 'arm:2', armName: '対照群' },
      { armKey: 'arm:3', armName: '第 3 群' },
    ]);
  });

  test('両者 0 件は空配列', () => {
    expect(buildConsensusArmDraft([], [], [])).toEqual([]);
  });
});

describe('serializeArmKeyRemap / parseArmKeyRemapNote', () => {
  test('直列化 → note 経由で往復できる', () => {
    const remap = new Map([
      ['arm:2', 'arm:1'],
      ['arm:1', 'arm:2'],
    ]);
    const note = `裁定者: judge@example.com / ${serializeArmKeyRemap(remap)}`;
    expect(parseArmKeyRemapNote(note)).toEqual(remap);
  });

  test('空の辞書も往復できる', () => {
    expect(parseArmKeyRemapNote(serializeArmKeyRemap(new Map()))).toEqual(new Map());
  });

  test('note が null / 辞書を含まない / JSON 不正 / 型不正なら null', () => {
    expect(parseArmKeyRemapNote(null)).toBeNull();
    expect(parseArmKeyRemapNote('裁定者: judge@example.com')).toBeNull();
    expect(parseArmKeyRemapNote('arm_mapping:{broken')).toBeNull();
    expect(parseArmKeyRemapNote('arm_mapping:[1,2]')).toBeNull();
    expect(parseArmKeyRemapNote('arm_mapping:"text"')).toBeNull();
    expect(parseArmKeyRemapNote('arm_mapping:null')).toBeNull();
    expect(parseArmKeyRemapNote('arm_mapping:{"arm:1":1}')).toBeNull();
  });
});

describe('remapArmEntityKey', () => {
  const remap = new Map([
    ['arm:2', 'arm:1'],
    ['arm:1', 'arm:2'],
  ]);

  test('arm レベルはキー全体を写す', () => {
    expect(remapArmEntityKey('arm:2', remap)).toBe('arm:1');
  });

  test('辞書に無い arm はそのまま', () => {
    expect(remapArmEntityKey('arm:9', remap)).toBe('arm:9');
  });

  test('outcome_result レベルは arm セグメントだけを写す（time は保持）', () => {
    expect(remapArmEntityKey('outcome:mortality|arm:2|time:30d', remap)).toBe('outcome:mortality|arm:1|time:30d');
    expect(remapArmEntityKey('outcome:mortality|arm:1', remap)).toBe('outcome:mortality|arm:2');
  });

  test('outcome_result で辞書に無い arm はそのまま', () => {
    expect(remapArmEntityKey('outcome:mortality|arm:9', remap)).toBe('outcome:mortality|arm:9');
  });

  test('arm を含まない outcome / study / rob_domain / 不正キーはそのまま', () => {
    expect(remapArmEntityKey('outcome:mortality', remap)).toBe('outcome:mortality');
    expect(remapArmEntityKey('-', remap)).toBe('-');
    expect(remapArmEntityKey('rob:domain_1', remap)).toBe('rob:domain_1');
    expect(remapArmEntityKey('broken::key', remap)).toBe('broken::key');
  });
});
