import { selectFinalAnnotator } from '../../../../src/features/export/finalAnnotator';
import type { AnnotatorTagged } from '../../../../src/features/export/finalAnnotator';

const row = (annotator: string, annotatorType: AnnotatorTagged['annotatorType']): AnnotatorTagged => ({
  annotator,
  annotatorType,
});

describe('selectFinalAnnotator', () => {
  test('consensus 行があればそれを返す（Q6 の既定）', () => {
    const rows = [row('ai', 'ai'), row('a@example.com', 'human_with_ai'), row('b@example.com', 'consensus')];
    expect(selectFinalAnnotator(rows)).toEqual(row('b@example.com', 'consensus'));
  });

  test('consensus がなければ唯一の human 行（human_with_ai）を返す', () => {
    const rows = [row('ai', 'ai'), row('a@example.com', 'human_with_ai')];
    expect(selectFinalAnnotator(rows)).toEqual(row('a@example.com', 'human_with_ai'));
  });

  test('human_independent も human として扱う', () => {
    const rows = [row('a@example.com', 'human_independent')];
    expect(selectFinalAnnotator(rows)).toEqual(row('a@example.com', 'human_independent'));
  });

  test('consensus が複数あれば null（同一キー重複はバリデーション違反）', () => {
    const rows = [row('a@example.com', 'consensus'), row('b@example.com', 'consensus')];
    expect(selectFinalAnnotator(rows)).toBeNull();
  });

  test('human が複数で consensus なしは null（adjudication 前の二重抽出）', () => {
    const rows = [row('a@example.com', 'human_with_ai'), row('b@example.com', 'human_independent')];
    expect(selectFinalAnnotator(rows)).toBeNull();
  });

  test('ai 行のみ・空集合は null', () => {
    expect(selectFinalAnnotator([row('ai', 'ai')])).toBeNull();
    expect(selectFinalAnnotator([])).toBeNull();
  });
});
