import { distinctAnnotators } from '../../../../../src/features/export/rset/annotatorPool';
import { makeResultsDataRow } from './testHelpers';

describe('distinctAnnotators', () => {
  test('空配列は空配列を返す', () => {
    expect(distinctAnnotators([])).toEqual([]);
  });

  test('同一 (annotator, annotator_type) は 1 件へ畳み込む', () => {
    const rows = [
      makeResultsDataRow({ resultId: 'r-1', annotator: 'a@example.com', annotatorType: 'human_with_ai' }),
      makeResultsDataRow({ resultId: 'r-2', annotator: 'a@example.com', annotatorType: 'human_with_ai' }),
    ];
    expect(distinctAnnotators(rows)).toEqual([{ annotator: 'a@example.com', annotatorType: 'human_with_ai' }]);
  });

  test('annotator_type が異なれば別エントリとして数える', () => {
    const rows = [
      makeResultsDataRow({ resultId: 'r-1', annotator: 'a@example.com', annotatorType: 'human_with_ai' }),
      makeResultsDataRow({ resultId: 'r-2', annotator: 'a@example.com', annotatorType: 'human_independent' }),
    ];
    expect(distinctAnnotators(rows)).toEqual([
      { annotator: 'a@example.com', annotatorType: 'human_with_ai' },
      { annotator: 'a@example.com', annotatorType: 'human_independent' },
    ]);
  });
});
