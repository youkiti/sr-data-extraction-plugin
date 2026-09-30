// 担当セットの分割再現性・表示対象・継承・レビュアーごとの進捗を検証する。
import {
  assignedPairForStudy,
  currentReviewSets,
  generateSeed,
  inheritReviewSet,
  isReviewSetsActive,
  reviewerSetProgress,
  reviewSetMismatchCount,
  splitIntoReviewSets,
  visibleStudyIdsForReviewer,
} from '../../../../src/features/review/reviewSets';
import { decision, field, reviewSet, study } from './reviewSetFixtures';

const options = { calibrationCount: 2, groupCount: 3, seed: '42' };

describe('担当セットの有効判定', () => {
  test('有効なセットとセット付きのアクティブ study の両方が必要', () => {
    expect(isReviewSetsActive([], [reviewSet()])).toBe(false);
    expect(isReviewSetsActive([study({ reviewSet: 'group-1' })], [])).toBe(false);
    expect(isReviewSetsActive([study(), study({ reviewSet: '  ' })], [reviewSet()])).toBe(true);
    expect(isReviewSetsActive([study()], [reviewSet({ studyIds: null })])).toBe(false);
    expect(isReviewSetsActive([study({ reviewSet: 'group-1' })], [reviewSet()])).toBe(true);
  });
});

describe('乱数種と一括分割', () => {
  test('乱数種は十進 uint32 で、乱数源を差し替えられる', () => {
    expect(generateSeed(() => 0)).toBe('0');
    expect(generateSeed(() => 0.5)).toBe('2147483648');
    expect(generateSeed(() => 1 - Number.EPSILON)).toBe('4294967295');
    const spy = jest.spyOn(Math, 'random').mockReturnValue(0.25);
    try {
      expect(generateSeed()).toBe('1073741824');
    } finally {
      spy.mockRestore();
    }
  });

  test('固定種の実行結果を保持し、同じ種なら分割が再現する', () => {
    const ids = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'];
    const result = splitIntoReviewSets(ids, options);
    // 実装を一度 Jest で実行して得た結果を固定し、乱数系列やシャッフル順の変更を検知する。
    expect([...result]).toEqual([
      ['c', 'calibration'],
      ['h', 'calibration'],
      ['b', 'group-1'],
      ['a', 'group-2'],
      ['g', 'group-3'],
      ['f', 'group-1'],
      ['d', 'group-2'],
      ['e', 'group-3'],
    ]);
    expect(splitIntoReviewSets(ids, options)).toEqual(result);
    expect(ids).toEqual(['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h']);
    expect(splitIntoReviewSets(ids, { ...options, seed: '43' })).not.toEqual(result);
  });

  test('キャリブレーション数を件数に丸め、残りをグループへ均等に配る', () => {
    expect([
      ...splitIntoReviewSets(['a', 'b'], { ...options, calibrationCount: 9 }).values(),
    ]).toEqual(['calibration', 'calibration']);
    expect(splitIntoReviewSets([], options).size).toBe(0);
    const result = splitIntoReviewSets(['a', 'b', 'c', 'd', 'e'], {
      ...options,
      calibrationCount: 0,
    });
    expect([...result.values()]).toEqual(['group-1', 'group-2', 'group-3', 'group-1', 'group-2']);
    expect([
      ...splitIntoReviewSets(['a'], { ...options, seed: '0', calibrationCount: 0 }).values(),
    ]).toEqual(['group-1']);
    expect(splitIntoReviewSets(['a'], { ...options, seed: '4294967295' }).size).toBe(1);
  });

  test.each([-1, 1.5, NaN, Infinity])(
    '不正なキャリブレーション数 %s を拒否する',
    (calibrationCount) => {
      expect(() => splitIntoReviewSets([], { ...options, calibrationCount })).toThrow(
        'キャリブレーション',
      );
    },
  );
  test.each([0, -1, 1.5, NaN, Infinity])('不正なグループ数 %s を拒否する', (groupCount) => {
    expect(() => splitIntoReviewSets([], { ...options, groupCount })).toThrow('グループ数');
  });
  test.each(['', '-1', '1.5', 'x', '4294967296', '9007199254740992'])(
    '不正な種 %s を拒否する',
    (seed) => {
      expect(() => splitIntoReviewSets([], { ...options, seed })).toThrow('乱数種');
    },
  );
});

describe('担当者の表示対象とペア', () => {
  const studies = [
    study({ studyId: 'cal', reviewSet: 'calibration' }),
    study({ studyId: 'g1', reviewSet: 'group-1' }),
    study({ studyId: 'g2', reviewSet: 'group-2' }),
    study({ studyId: 'unknown', reviewSet: 'group-3' }),
    study({ studyId: 'empty' }),
  ];
  const sets = [reviewSet({ studyIds: ['g1'] }), reviewSet({ setId: 'group-2', studyIds: ['g2'], reviewerEmails: ['c@example.com'] }), reviewSet({ setId: 'calibration', studyIds: ['cal'] })];
  test('担当セットと全 calibration を作成順で返す', () => {
    expect(visibleStudyIdsForReviewer('a@example.com', studies, sets)).toEqual(['cal', 'g1']);
    expect(visibleStudyIdsForReviewer('c@example.com', studies, sets)).toEqual(['cal', 'g2']);
    expect(visibleStudyIdsForReviewer('未登録', studies, sets)).toEqual(['cal']);
    expect(visibleStudyIdsForReviewer('a@example.com', studies, [])).toEqual([]);
  });
  test('2 名グループのみ担当ペアをソートして返し、元データは変更しない', () => {
    const row = reviewSet({ reviewerEmails: ['z@example.com', 'a@example.com'] });
    expect(assignedPairForStudy(study({ reviewSet: 'group-1' }), [row])).toEqual([
      'a@example.com',
      'z@example.com',
    ]);
    expect(row.reviewerEmails).toEqual(['z@example.com', 'a@example.com']);
    for (const reviewSet of [null, 'calibration', '', '不明']) {
      expect(assignedPairForStudy(study({ reviewSet }), sets)).toBeNull();
    }
    expect(assignedPairForStudy(study({ reviewSet: 'group-3' }), sets)).toBeNull();
    expect(assignedPairForStudy(study({ reviewSet: 'group-2' }), sets)).toBeNull();
  });
});

describe('統合時の担当セット継承', () => {
  test('共通値を保ち、異なる場合は選択値か作成順先頭を使う', () => {
    expect(inheritReviewSet([])).toBeNull();
    expect(inheritReviewSet([study(), study()], 'group-9')).toBeNull();
    expect(
      inheritReviewSet([study(), study()], null, [reviewSet()]),
    ).toBe('group-1');
    const sources = [
      study({ studyId: 's2', reviewSet: 'group-2', createdAt: 't9' }),
      study({ reviewSet: 'group-1', createdAt: 't0' }),
    ];
    const sets = [reviewSet(), reviewSet({ setId: 'group-2', studyIds: ['s2'] })];
    expect(inheritReviewSet(sources, undefined, sets)).toBe('group-2');
    expect(inheritReviewSet(sources, 'calibration', sets)).toBe('calibration');
    expect(inheritReviewSet(sources, null, sets)).toBeNull();
  });
});

describe('レビュアー × セットの進捗', () => {
  test('全セル判定済みの study を数え、担当外は省き calibration は全員を対象にする', () => {
    const input = {
      reviewerEmails: ['a@example.com', 'b@example.com', 'c@example.com', 'a@example.com'],
      studies: [
        study({ reviewSet: 'group-1' }),
        study({ studyId: 's2', reviewSet: 'group-1' }),
        study({ studyId: 'cal', reviewSet: 'calibration' }),
        study({ studyId: 'unassigned' }),
      ],
      sets: [
        reviewSet({ studyIds: ['s1', 's2'] }),
        reviewSet({ setId: 'group-2', studyIds: [], reviewerEmails: ['c@example.com'] }),
        reviewSet({ setId: 'calibration', studyIds: ['cal'], reviewerEmails: [] }),
      ],
      fields: [field()],
      decisions: [
        decision(),
        decision({ studyId: 'cal' }),
        decision({ studyId: 's2', annotator: 'b@example.com' }),
        decision({ studyId: '別の研究', annotator: 'c@example.com' }),
      ],
      armStructures: new Map(),
    };
    expect(reviewerSetProgress(input)).toEqual([
      { email: 'a@example.com', setId: 'calibration', done: 1, total: 1 },
      { email: 'a@example.com', setId: 'group-1', done: 1, total: 2 },
      { email: 'b@example.com', setId: 'calibration', done: 0, total: 1 },
      { email: 'b@example.com', setId: 'group-1', done: 1, total: 2 },
      { email: 'c@example.com', setId: 'calibration', done: 0, total: 1 },
      { email: 'c@example.com', setId: 'group-2', done: 0, total: 0 },
    ]);
    expect(reviewerSetProgress({ ...input, fields: [] }).every((row) => row.done === 0)).toBe(true);
    expect(reviewerSetProgress({ ...input, reviewerEmails: [] })).toEqual([]);
  });
  test('各レビュアーの確定群構成と取り消し判定を完了条件に反映する', () => {
    const input = {
      reviewerEmails: ['a@example.com', 'b@example.com'],
      studies: [study({ reviewSet: 'group-1' })],
      sets: [reviewSet()],
      fields: [field({ entityLevel: 'arm' })],
      decisions: [
        decision({ entityKey: 'arm:1' }),
        decision({ entityKey: 'arm:2' }),
        decision({ entityKey: 'arm:2', action: 'undo', decidedAt: 't1' }),
      ],
      armStructures: new Map([
        [
          's1',
          new Map([
            [
              'a@example.com',
              {
                version: 1,
                arms: [
                  { armKey: 'arm:1', armName: '治療' },
                  { armKey: 'arm:2', armName: '対照' },
                ],
              },
            ],
          ]),
        ],
      ]),
    };
    expect(reviewerSetProgress(input)).toEqual([
      { email: 'a@example.com', setId: 'group-1', done: 0, total: 1 },
      { email: 'b@example.com', setId: 'group-1', done: 0, total: 1 },
    ]);
    expect(reviewerSetProgress({ ...input, decisions: input.decisions.slice(0, 2) })[0]?.done).toBe(
      1,
    );
  });
});

test('現在のグループは最新 seed の分割とアクティブ研究の割当で決まる', () => {
  const old = reviewSet({ setId: 'group-3', seed: '1', updatedAt: 't0' });
  const rows = [
    old,
    reviewSet({ seed: '2', updatedAt: 't2', studyIds: [] }),
    reviewSet({ setId: 'group-2', studyIds: [], seed: '1', splitUpdatedAt: 't0', updatedAt: 't9' }),
    reviewSet({ setId: 'calibration', studyIds: [], seed: '2', updatedAt: 't2' }),
  ];
  expect(currentReviewSets([], rows).map((set) => set.setId)).toEqual(['group-1', 'calibration']);
  const assigned = study({ reviewSet: 'group-3' });
  expect(currentReviewSets([assigned], rows).map((set) => set.setId)).toEqual([
    'group-3',
    'group-1',
    'calibration',
  ]);
  expect(visibleStudyIdsForReviewer('a@example.com', [assigned], rows)).toEqual(['s1']);
  expect(assignedPairForStudy(assigned, rows)).toEqual(['a@example.com', 'b@example.com']);
  expect(currentReviewSets([], [reviewSet({ seed: null })])).toEqual([]);
  expect(
    currentReviewSets([study({ reviewSet: 'group-1' })], [reviewSet({ seed: null })]),
  ).toHaveLength(1);
});


test('担当列の直接変更を無視し、所属の食い違いを数える', () => {
  const studies = [study({ reviewSet: 'calibration' }), study({ studyId: 'cal', reviewSet: 'group-9' }), study({ studyId: 'outside', reviewSet: 'calibration' }), study({ studyId: 'new', reviewSet: '' })];
  const sets = [reviewSet(), reviewSet({ setId: 'calibration', studyIds: ['cal'], reviewerEmails: [] }), reviewSet({ setId: 'group-2', studyIds: ['outside'], reviewerEmails: ['c'] }), reviewSet({ setId: 'group-3', studyIds: null })];
  expect(reviewSetMismatchCount(studies, sets)).toBe(3);
  expect(reviewSetMismatchCount([study({ reviewSet: 'group-1' }), study({ studyId: 'new' })], sets)).toBe(0);
  expect(visibleStudyIdsForReviewer('a@example.com', studies, sets)).toEqual(['s1', 'cal']);
  expect(assignedPairForStudy(studies[0]!, sets)).toEqual(['a@example.com', 'b@example.com']);
  expect(assignedPairForStudy(studies[1]!, sets)).toBeNull();
  expect(assignedPairForStudy(studies[2]!, sets)).toBeNull();
  expect(assignedPairForStudy(studies[3]!, [reviewSet({ studyIds: null })])).toBeNull();
  expect(reviewerSetProgress({ studies, sets, reviewerEmails: ['a@example.com'], fields: [field()], decisions: [decision()], armStructures: new Map() })).toEqual([
    { email: 'a@example.com', setId: 'calibration', done: 0, total: 1 },
    { email: 'a@example.com', setId: 'group-1', done: 1, total: 1 },
    { email: 'a@example.com', setId: 'group-3', done: 0, total: 0 },
  ]);
});
