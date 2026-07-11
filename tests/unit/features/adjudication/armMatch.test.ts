import { armsMatch, buildConsensusArmDraft } from '../../../../src/features/adjudication/armMatch';

describe('armsMatch', () => {
  test('本数・名称（trim 後）が位置対応で完全一致すれば true', () => {
    expect(
      armsMatch(
        [{ armName: '介入群 ' }, { armName: '対照群' }],
        [{ armName: '介入群' }, { armName: ' 対照群' }],
      ),
    ).toBe(true);
  });

  test('本数が異なれば false', () => {
    expect(armsMatch([{ armName: '介入群' }], [{ armName: '介入群' }, { armName: '対照群' }])).toBe(false);
  });

  test('同数でも名称が位置対応で異なれば false', () => {
    expect(armsMatch([{ armName: '介入群' }, { armName: '対照群' }], [{ armName: '対照群' }, { armName: '介入群' }])).toBe(
      false,
    );
  });

  test('両者 0 件は一致扱い（vacuous true）', () => {
    expect(armsMatch([], [])).toBe(true);
  });
});

describe('buildConsensusArmDraft', () => {
  test('A の名称を初期値に、位置ごとに arm:n を振り直す', () => {
    expect(
      buildConsensusArmDraft(
        [{ armName: '介入群' }, { armName: '対照群' }],
        [{ armName: '対照群' }, { armName: '介入群' }],
      ),
    ).toEqual([
      { armKey: 'arm:1', armName: '介入群' },
      { armKey: 'arm:2', armName: '対照群' },
    ]);
  });

  test('本数が食い違う位置は存在する側（B）の名称で埋める', () => {
    expect(buildConsensusArmDraft([{ armName: '介入群' }], [{ armName: '対照群' }, { armName: '第 3 群' }])).toEqual([
      { armKey: 'arm:1', armName: '介入群' },
      { armKey: 'arm:2', armName: '第 3 群' },
    ]);
  });

  test('両者に無い位置は無い（空配列同士は空配列）', () => {
    expect(buildConsensusArmDraft([], [])).toEqual([]);
  });
});
