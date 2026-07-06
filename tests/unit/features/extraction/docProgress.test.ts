import {
  createDocProgressTracker,
  describeBatchFailure,
} from '../../../../src/features/extraction/docProgress';
import type { BatchFailure, RunProgress } from '../../../../src/features/extraction/executeRun';
import type { PlannedBatch } from '../../../../src/features/extraction/planRun';

function batch(documentId: string, section: string | null = null): PlannedBatch {
  return {
    documentId,
    section,
    fieldIds: ['f-1'],
    tokensInEstimate: 100,
    tokensOutEstimate: 10,
    overBudget: false,
  };
}

function progress(
  documentId: string,
  section: string | null = null,
  failure: BatchFailure | null = null,
): RunProgress {
  return { totalBatches: 0, completedBatches: 0, documentId, section, failure };
}

describe('describeBatchFailure', () => {
  test('section なしは reason（detail）、section ありは先頭に section を付ける', () => {
    expect(
      describeBatchFailure({ documentId: 'd1', section: null, reason: 'api_error', detail: 'boom' }),
    ).toBe('api_error（boom）');
    expect(
      describeBatchFailure({
        documentId: 'd1',
        section: 'methods',
        reason: 'format_error',
        detail: 'bad json',
      }),
    ).toBe('methods: format_error（bad json）');
  });
});

describe('createDocProgressTracker', () => {
  test('初期状態は全 document が待機中（指定順）+ バッチ数 0/総数', () => {
    const tracker = createDocProgressTracker(['d1', 'd2'], [batch('d1'), batch('d2')]);
    expect(tracker.rows()).toEqual([
      { documentId: 'd1', status: 'queued', completedBatches: 0, totalBatches: 1, detail: null },
      { documentId: 'd2', status: 'queued', completedBatches: 0, totalBatches: 1, detail: null },
    ]);
  });

  test('計画に 1 バッチも現れない document は最初から failed（総バッチ数 0）', () => {
    const tracker = createDocProgressTracker(['d1', 'd2'], [batch('d1')]);
    expect(tracker.rows()[1]).toEqual({
      documentId: 'd2',
      status: 'failed',
      completedBatches: 0,
      totalBatches: 0,
      detail: '抽出計画から除外されました（テキスト層がない可能性があります）',
    });
  });

  test('バッチ完了で running → 全バッチ完了で done に畳み込む（処理済みバッチ数も進む）', () => {
    const tracker = createDocProgressTracker(
      ['d1'],
      [batch('d1', 'methods'), batch('d1', 'results')],
    );
    tracker.onProgress(progress('d1', 'methods'));
    expect(tracker.rows()[0]).toEqual({
      documentId: 'd1',
      status: 'running',
      completedBatches: 1,
      totalBatches: 2,
      detail: null,
    });
    tracker.onProgress(progress('d1', 'results'));
    expect(tracker.rows()[0]).toEqual({
      documentId: 'd1',
      status: 'done',
      completedBatches: 2,
      totalBatches: 2,
      detail: null,
    });
  });

  test('失敗バッチで failed になり、後続バッチの成功でも上書きしない', () => {
    const failure: BatchFailure = {
      documentId: 'd1',
      section: 'methods',
      reason: 'api_error',
      detail: 'boom',
    };
    const tracker = createDocProgressTracker(
      ['d1'],
      [batch('d1', 'methods'), batch('d1', 'results')],
    );
    tracker.onProgress(progress('d1', 'methods', failure));
    expect(tracker.rows()[0]).toEqual({
      documentId: 'd1',
      status: 'failed',
      completedBatches: 1,
      totalBatches: 2,
      detail: 'methods: api_error（boom）',
    });
    tracker.onProgress(progress('d1', 'results'));
    expect(tracker.rows()[0]).toMatchObject({ status: 'failed', completedBatches: 2 });
  });

  test('計画外 document のバッチ・進捗は無視する（契約上は起こらない）', () => {
    const tracker = createDocProgressTracker(['d1'], [batch('d1'), batch('unknown')]);
    tracker.onProgress(progress('unknown'));
    expect(tracker.rows()).toEqual([
      { documentId: 'd1', status: 'queued', completedBatches: 0, totalBatches: 1, detail: null },
    ]);
    // 計画外バッチは総数に数えない = d1 の 1 バッチ完了で done
    tracker.onProgress(progress('d1'));
    expect(tracker.rows()).toEqual([
      { documentId: 'd1', status: 'done', completedBatches: 1, totalBatches: 1, detail: null },
    ]);
  });
});
