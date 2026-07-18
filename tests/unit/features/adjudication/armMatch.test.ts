import {
  armKeysInUse,
  armMappingFromRemap,
  armsMatch,
  buildArmKeyRemap,
  buildConsensusArmDraft,
  buildDefaultArmMapping,
  escapeArmKeyRemapCollisions,
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

  // issue #117 件1: 非正準順（outcome|time|arm 等）のキーでもセグメント順序を保ったまま
  // arm セグメントだけを置換する（makeOutcomeEntityKey による正準順への再構築はしない）
  test('非正準順（outcome|time|arm）でもセグメント順序を保って arm だけ置換する', () => {
    expect(remapArmEntityKey('outcome:mortality|time:30d|arm:2', remap)).toBe('outcome:mortality|time:30d|arm:1');
  });

  test('恒等マッピング（B armKey → 同じ armKey）でも非正準順の文字列がそのまま保たれる（偽の不一致の解消）', () => {
    const identityRemap = new Map([['arm:1', 'arm:1']]);
    const key = 'outcome:x|time:30d|arm:1';
    // 修正前は makeOutcomeEntityKey で正準順（outcome|arm|time）へ再構築されるため
    // 'outcome:x|arm:1|time:30d' になり、A 側が同じ非正準順のキーを出していると文字列比較で
    // 不一致になっていた。修正後は入力と完全に同じ文字列を返す
    expect(remapArmEntityKey(key, identityRemap)).toBe(key);
  });
});

describe('armKeysInUse', () => {
  test('arm レベル・outcome_result レベルの arm セグメントを集める（重複除去）', () => {
    expect(
      armKeysInUse(['arm:1', 'outcome:x|arm:2', 'outcome:y|arm:2|time:30d', 'outcome:z|arm:1']),
    ).toEqual(new Set(['arm:1', 'arm:2']));
  });

  test('study / rob_domain / arm を含まない outcome / 形式不正のキーは無視する', () => {
    expect(armKeysInUse(['-', 'rob:domain_1', 'outcome:mortality', 'broken::key'])).toEqual(new Set());
  });

  test('空の列は空集合', () => {
    expect(armKeysInUse([])).toEqual(new Set());
  });
});

describe('escapeArmKeyRemapCollisions', () => {
  test('衝突が無ければ辞書のコピーをそのまま返す（新規 Map・同じ内容）', () => {
    const remap = new Map([['arm:2', 'arm:1']]);
    const result = escapeArmKeyRemapCollisions(remap, new Set(['arm:2']));
    expect(result.collisions).toEqual([]);
    expect([...result.remap.entries()]).toEqual([['arm:2', 'arm:1']]);
    expect(result.remap).not.toBe(remap);
  });

  test('辞書に無い素通しキーが写像先の正準キーと衝突すると退避キーへ差し替える（issue #117 件2）', () => {
    // B の確定 armsB = arm:1, arm:2（辞書対象）だが、B の実データには辞書に無い旧キー
    // 'arm:3' が残っており、A 側の 2 群目が 'arm:3' へ写像される（辞書の写像先と衝突）
    const remap = new Map([
      ['arm:2', 'arm:1'],
      ['arm:1', 'arm:3'],
    ]);
    const result = escapeArmKeyRemapCollisions(remap, new Set(['arm:1', 'arm:2', 'arm:3']));
    expect(result.collisions).toEqual(['arm:3']);
    // 退避キーは正準キー集合・実データキーのいずれとも衝突しない最小の arm:n
    expect(result.remap.get('arm:3')).toBe('arm:4');
    // 元の辞書エントリ（衝突とは無関係の写像）は変更されない
    expect(result.remap.get('arm:2')).toBe('arm:1');
    expect(result.remap.get('arm:1')).toBe('arm:3');
  });

  test('衝突していない素通しキーは退避しない', () => {
    const remap = new Map([['arm:9', 'arm:1']]);
    const result = escapeArmKeyRemapCollisions(remap, new Set(['arm:1', 'arm:9', 'arm:2']));
    // 'arm:1' は canonicalTargets（{'arm:1'}）と衝突するので退避対象、'arm:2' は衝突しないため対象外
    expect(result.collisions).toEqual(['arm:1']);
    expect(result.remap.has('arm:2')).toBe(false);
    expect(result.remap.get('arm:1')).toBe('arm:3');
  });
});
