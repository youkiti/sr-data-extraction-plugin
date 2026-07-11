import {
  ENTITY_INSTANCE_DECLARATION_FIELD_ID,
  OUTCOME_INSTANCE_DECLARATION_NOTE,
  buildOutcomeDeclarationDecisions,
  isEntityInstanceDeclaration,
  outcomeEntityKeysForArms,
} from '../../../../src/features/verification/instanceDeclarations';

describe('outcomeEntityKeysForArms', () => {
  test('確定 arm 全体に outcome_result キーを生成する', () => {
    expect(
      outcomeEntityKeysForArms({
        outcomeId: 'mortality',
        time: '30d',
        arms: [{ armKey: 'arm:1' }, { armKey: 'arm:2' }],
      }),
    ).toEqual(['outcome:mortality|arm:1|time:30d', 'outcome:mortality|arm:2|time:30d']);
  });

  test('time が null なら time セグメントを省略する', () => {
    expect(
      outcomeEntityKeysForArms({
        outcomeId: 'pain',
        time: null,
        arms: [{ armKey: 'arm:control' }],
      }),
    ).toEqual(['outcome:pain|arm:control']);
  });

  test('確定 arm なし・不正 arm_key・重複生成はエラー', () => {
    expect(() =>
      outcomeEntityKeysForArms({ outcomeId: 'x', time: null, arms: [] }),
    ).toThrow('確定済みの群');
    expect(() =>
      outcomeEntityKeysForArms({ outcomeId: 'x', time: null, arms: [{ armKey: 'bad' }] }),
    ).toThrow('arm_key bad が不正');
    expect(() =>
      outcomeEntityKeysForArms({
        outcomeId: 'x',
        time: null,
        arms: [{ armKey: 'arm:1' }, { armKey: 'arm:1' }],
      }),
    ).toThrow('重複');
  });
});

describe('buildOutcomeDeclarationDecisions', () => {
  test('Decisions に追記する予約 field_id の宣言イベントを作る', () => {
    const decisions = buildOutcomeDeclarationDecisions({
      studyId: 'study-1',
      outcomeId: 'mortality',
      time: null,
      arms: [{ armKey: 'arm:1' }],
      annotator: 'me@example.com',
      annotatorType: 'human_with_ai',
      schemaVersion: 3,
      decidedAt: '2026-07-09T00:00:00Z',
    });
    expect(decisions).toEqual([
      {
        decidedAt: '2026-07-09T00:00:00Z',
        decidedBy: 'me@example.com',
        studyId: 'study-1',
        fieldId: ENTITY_INSTANCE_DECLARATION_FIELD_ID,
        entityKey: 'outcome:mortality|arm:1',
        annotator: 'me@example.com',
        annotatorType: 'human_with_ai',
        schemaVersion: 3,
        action: 'edit',
        value: 'outcome:mortality|arm:1',
        note: OUTCOME_INSTANCE_DECLARATION_NOTE,
      },
    ]);
    expect(isEntityInstanceDeclaration(decisions[0]!)).toBe(true);
    expect(isEntityInstanceDeclaration({ ...decisions[0]!, fieldId: 'f-1' })).toBe(false);
  });

  test('annotatorType は呼び出し側の入力をそのまま使う（独立入力モード §5.2）', () => {
    const decisions = buildOutcomeDeclarationDecisions({
      studyId: 'study-1',
      outcomeId: 'mortality',
      time: null,
      arms: [{ armKey: 'arm:1' }],
      annotator: 'reviewer@example.com',
      annotatorType: 'human_independent',
      schemaVersion: 3,
      decidedAt: '2026-07-09T00:00:00Z',
    });
    expect(decisions[0]?.annotatorType).toBe('human_independent');
  });
});
