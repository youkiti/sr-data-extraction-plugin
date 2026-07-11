import type { ResultsDataRow, StudyDataRow } from '../../../../src/domain/annotation';
import type { Decision } from '../../../../src/domain/decision';
import { resolveAnnotatorPair } from '../../../../src/features/adjudication/pairResolution';

function studyRow(overrides: Partial<StudyDataRow> = {}): StudyDataRow {
  return {
    studyId: 'study-1',
    annotator: 'a@example.com',
    annotatorType: 'human_with_ai',
    schemaVersion: 1,
    runId: null,
    updatedAt: 't0',
    values: {},
    ...overrides,
  };
}

function resultsRow(overrides: Partial<ResultsDataRow> = {}): ResultsDataRow {
  return {
    resultId: 'r-1',
    studyId: 'study-1',
    fieldId: 'f-1',
    annotator: 'a@example.com',
    annotatorType: 'human_with_ai',
    schemaVersion: 1,
    entityKey: 'arm:1',
    runId: null,
    value: '10',
    notReported: false,
    updatedAt: 't0',
    ...overrides,
  };
}

function decision(overrides: Partial<Decision> = {}): Decision {
  return {
    decidedAt: 't0',
    decidedBy: 'a@example.com',
    studyId: 'study-1',
    fieldId: 'f-1',
    entityKey: '-',
    annotator: 'a@example.com',
    annotatorType: 'human_with_ai',
    schemaVersion: 1,
    action: 'accept',
    value: '10',
    note: null,
    ...overrides,
  };
}

describe('resolveAnnotatorPair', () => {
  test('StudyData / ResultsData / Decisions を横断して human annotator を 2 名見つけると ready（email 昇順）', () => {
    const result = resolveAnnotatorPair({
      studyId: 'study-1',
      studyDataRows: [studyRow({ annotator: 'z@example.com' })],
      resultsDataRows: [resultsRow({ annotator: 'a@example.com' })],
      decisions: [],
    });
    expect(result).toEqual({ kind: 'ready', annotatorA: 'a@example.com', annotatorB: 'z@example.com' });
  });

  test('ai / consensus 行は対象から除外する', () => {
    const result = resolveAnnotatorPair({
      studyId: 'study-1',
      studyDataRows: [
        studyRow({ annotator: 'ai', annotatorType: 'ai' }),
        studyRow({ annotator: 'consensus', annotatorType: 'consensus' }),
        studyRow({ annotator: 'a@example.com' }),
        studyRow({ annotator: 'b@example.com' }),
      ],
      resultsDataRows: [],
      decisions: [],
    });
    expect(result).toEqual({ kind: 'ready', annotatorA: 'a@example.com', annotatorB: 'b@example.com' });
  });

  test('他 study の行は無視する（StudyData / ResultsData 双方）', () => {
    const result = resolveAnnotatorPair({
      studyId: 'study-1',
      studyDataRows: [studyRow({ studyId: 'study-2', annotator: 'other@example.com' })],
      resultsDataRows: [resultsRow({ studyId: 'study-2', annotator: 'other2@example.com' })],
      decisions: [],
    });
    expect(result).toEqual({ kind: 'waiting', annotators: [] });
  });

  test('ResultsData の ai / consensus 行も対象から除外する', () => {
    const result = resolveAnnotatorPair({
      studyId: 'study-1',
      studyDataRows: [],
      resultsDataRows: [
        resultsRow({ annotator: 'ai', annotatorType: 'ai' }),
        resultsRow({ annotator: 'consensus', annotatorType: 'consensus' }),
        resultsRow({ annotator: 'a@example.com' }),
      ],
      decisions: [],
    });
    expect(result).toEqual({ kind: 'waiting', annotators: ['a@example.com'] });
  });

  test('1 名以下は waiting', () => {
    expect(
      resolveAnnotatorPair({ studyId: 'study-1', studyDataRows: [], resultsDataRows: [], decisions: [] }),
    ).toEqual({ kind: 'waiting', annotators: [] });
    expect(
      resolveAnnotatorPair({
        studyId: 'study-1',
        studyDataRows: [studyRow()],
        resultsDataRows: [],
        decisions: [],
      }),
    ).toEqual({ kind: 'waiting', annotators: ['a@example.com'] });
  });

  test('3 名以上は ambiguous（email 昇順）', () => {
    const result = resolveAnnotatorPair({
      studyId: 'study-1',
      studyDataRows: [
        studyRow({ annotator: 'c@example.com' }),
        studyRow({ annotator: 'a@example.com' }),
        studyRow({ annotator: 'b@example.com' }),
      ],
      resultsDataRows: [],
      decisions: [],
    });
    expect(result).toEqual({
      kind: 'ambiguous',
      annotators: ['a@example.com', 'b@example.com', 'c@example.com'],
    });
  });

  test('Decisions 由来の human annotator も数える（他 study・consensus 行は除外）', () => {
    const result = resolveAnnotatorPair({
      studyId: 'study-1',
      studyDataRows: [],
      resultsDataRows: [],
      decisions: [
        decision({ annotator: 'a@example.com' }),
        decision({ annotator: 'b@example.com' }),
        decision({ studyId: 'study-2', annotator: 'other@example.com' }),
        decision({ annotator: 'consensus', annotatorType: 'consensus' }),
      ],
    });
    expect(result).toEqual({ kind: 'ready', annotatorA: 'a@example.com', annotatorB: 'b@example.com' });
  });
});
