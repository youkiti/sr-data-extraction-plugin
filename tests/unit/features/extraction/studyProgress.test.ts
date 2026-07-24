import {
  createStudyProgressTracker,
  describeBatchFailure,
} from '../../../../src/features/extraction/studyProgress';
import type { BatchFailure, RunProgress } from '../../../../src/features/extraction/executeRun';
import type { PlannedBatch } from '../../../../src/features/extraction/planRun';

function batch(studyId: string, section: string | null = null): PlannedBatch {
  return {
    studyId,
    documentIds: [`${studyId}-doc`],
    imageDocumentIds: [],
    augmentedImageDocumentIds: [],
    section,
    fieldIds: ['f-1'],
    tokensInEstimate: 100,
    tokensOutEstimate: 10,
    overBudget: false,
  };
}

function progress(
  studyId: string,
  section: string | null = null,
  failure: BatchFailure | null = null,
): RunProgress {
  return { totalBatches: 0, completedBatches: 0, studyId, section, failure };
}

describe('describeBatchFailure', () => {
  test('section なしは reason（detail）、section ありは先頭に section を付ける', () => {
    expect(
      describeBatchFailure({
        studyId: 's1',
        section: null,
        reason: 'api_error',
        detail: 'boom',
        failureKind: null,
      }),
    ).toBe('api_error（boom）');
    expect(
      describeBatchFailure({
        studyId: 's1',
        section: 'methods',
        reason: 'format_error',
        detail: 'bad json',
        failureKind: null,
      }),
    ).toBe('methods: format_error（bad json）');
  });
});

describe('createStudyProgressTracker', () => {
  test('初期状態は全 study が待機中（指定順）+ バッチ数 0/総数', () => {
    const tracker = createStudyProgressTracker(['s1', 's2'], [batch('s1'), batch('s2')]);
    expect(tracker.rows()).toEqual([
      {
        studyId: 's1',
        status: 'queued',
        completedBatches: 0,
        totalBatches: 1,
        detail: null,
        failureKind: null,
      },
      {
        studyId: 's2',
        status: 'queued',
        completedBatches: 0,
        totalBatches: 1,
        detail: null,
        failureKind: null,
      },
    ]);
  });

  test('計画に 1 バッチも現れない study は最初から failed（総バッチ数 0・failureKind は不明）', () => {
    const tracker = createStudyProgressTracker(['s1', 's2'], [batch('s1')]);
    expect(tracker.rows()[1]).toEqual({
      studyId: 's2',
      status: 'failed',
      completedBatches: 0,
      totalBatches: 0,
      detail: '抽出計画から除外されました（テキスト層のある文書がありません）',
      failureKind: null,
    });
  });

  test('バッチ完了で running → 全バッチ完了で done に畳み込む（処理済みバッチ数も進む）', () => {
    const tracker = createStudyProgressTracker(
      ['s1'],
      [batch('s1', 'methods'), batch('s1', 'results')],
    );
    tracker.onProgress(progress('s1', 'methods'));
    expect(tracker.rows()[0]).toEqual({
      studyId: 's1',
      status: 'running',
      completedBatches: 1,
      totalBatches: 2,
      detail: null,
      failureKind: null,
    });
    tracker.onProgress(progress('s1', 'results'));
    expect(tracker.rows()[0]).toEqual({
      studyId: 's1',
      status: 'done',
      completedBatches: 2,
      totalBatches: 2,
      detail: null,
      failureKind: null,
    });
  });

  test('失敗バッチで failed になり、後続バッチの成功でも上書きしない（failureKind 不明）', () => {
    const failure: BatchFailure = {
      studyId: 's1',
      section: 'methods',
      reason: 'api_error',
      detail: 'boom',
      failureKind: null,
    };
    const tracker = createStudyProgressTracker(
      ['s1'],
      [batch('s1', 'methods'), batch('s1', 'results')],
    );
    tracker.onProgress(progress('s1', 'methods', failure));
    expect(tracker.rows()[0]).toEqual({
      studyId: 's1',
      status: 'failed',
      completedBatches: 1,
      totalBatches: 2,
      detail: 'methods: api_error（boom）',
      failureKind: null,
    });
    tracker.onProgress(progress('s1', 'results'));
    expect(tracker.rows()[0]).toMatchObject({ status: 'failed', completedBatches: 2 });
  });

  test('失敗バッチの failureKind を ExtractStudyRow.failureKind へ伝播する', () => {
    const failure: BatchFailure = {
      studyId: 's1',
      section: null,
      reason: 'api_error',
      detail: 'timeout',
      failureKind: 'timeout',
    };
    const tracker = createStudyProgressTracker(['s1'], [batch('s1')]);
    tracker.onProgress(progress('s1', null, failure));
    expect(tracker.rows()[0]?.failureKind).toBe('timeout');
  });

  test('計画外 study のバッチ・進捗は無視する（契約上は起こらない）', () => {
    const tracker = createStudyProgressTracker(['s1'], [batch('s1'), batch('unknown')]);
    tracker.onProgress(progress('unknown'));
    expect(tracker.rows()).toEqual([
      {
        studyId: 's1',
        status: 'queued',
        completedBatches: 0,
        totalBatches: 1,
        detail: null,
        failureKind: null,
      },
    ]);
    // 計画外バッチは総数に数えない = s1 の 1 バッチ完了で done
    tracker.onProgress(progress('s1'));
    expect(tracker.rows()).toEqual([
      {
        studyId: 's1',
        status: 'done',
        completedBatches: 1,
        totalBatches: 1,
        detail: null,
        failureKind: null,
      },
    ]);
  });
});
