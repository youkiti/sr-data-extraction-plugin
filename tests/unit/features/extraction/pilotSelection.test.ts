import type { ExtractionRun } from '../../../../src/domain/extractionRun';
import type { SchemaVersion } from '../../../../src/domain/schemaVersion';
import type { StudySelectionItem } from '../../../../src/features/documents/studySelection';
import {
  usedPilotStudyIds,
  defaultPilotStudyIds,
  revisionUsedStudyIds,
} from '../../../../src/features/extraction/pilotSelection';

function run(overrides: Partial<ExtractionRun> = {}): ExtractionRun {
  return {
    runId: 'r',
    runType: 'pilot',
    schemaVersion: 1,
    studyIds: ['s1'],
    provider: 'gemini',
    requestedModel: 'model',
    modelVersion: null,
    inputMode: 'text_only',
    status: 'done',
    startedAt: '01',
    finishedAt: null,
    tokensIn: null,
    tokensOut: null,
    costEstimate: null,
    fieldIds: null,
    warnings: null,
    ...overrides,
  };
}
function version(overrides: Partial<SchemaVersion> = {}): SchemaVersion {
  return {
    schemaVersion: 2,
    parentVersion: 1,
    protocolVersion: 1,
    createdAt: '02',
    createdByType: 'pilot_revision',
    createdBy: 'me',
    note: null,
    ...overrides,
  };
}
function candidate(id: string, hasTextLayer = true): StudySelectionItem {
  return {
    study: {
      studyId: id,
      studyLabel: id,
      createdBy: 'me',
      createdAt: '01',
      registrationId: null,
      note: null,
      reviewSet: null,
    },
    documents: [],
    hasTextLayer,
  };
}

test('全パイロットの study を重複なく集計し、他の実行種別は除外する', () => {
  expect(
    usedPilotStudyIds([
      run(),
      run({ studyIds: ['s1', 's2'], startedAt: null }),
      run({ runType: 'full', studyIds: ['s3'] }),
      run({ runType: 'single_study', studyIds: ['s4'] }),
    ]),
  ).toEqual(new Set(['s1', 's2']));
  expect(usedPilotStudyIds([])).toEqual(new Set());
});

test('未使用を順に選び、不足していても使用済みで補充しない', () => {
  const candidates = [
    candidate('s1'),
    candidate('scan', false),
    candidate('s2'),
    candidate('s3'),
    candidate('s4'),
  ];
  expect(defaultPilotStudyIds(candidates, new Set())).toEqual(['s1', 's2', 's3']);
  expect(defaultPilotStudyIds(candidates, new Set(['s1', 's2', 's3']))).toEqual(['s4']);
  expect(defaultPilotStudyIds(candidates, new Set(), 1)).toEqual(['s1']);
  expect(defaultPilotStudyIds(candidates, new Set(), 0)).toEqual([]);
  expect(defaultPilotStudyIds(candidates, new Set(), -1)).toEqual([]);
  expect(defaultPilotStudyIds(candidates, new Set(['s1', 's2', 's3', 's4']))).toEqual([
    's1',
    's2',
    's3',
  ]);
  expect(defaultPilotStudyIds([candidate('scan', false)], new Set())).toEqual([]);
  expect(defaultPilotStudyIds([], new Set())).toEqual([]);
});

test('過去パイロット < 改訂版 < 今回の厳密な時刻順で共通 study を判定する', () => {
  const current = run({ runId: 'current', studyIds: ['s1', 's2', 's3', 's1'], startedAt: '03' });
  expect(
    revisionUsedStudyIds(current, [run({ studyIds: ['s1', 'outside'] })], [version()]),
  ).toEqual(new Set(['s1']));
  for (const previous of [
    run({ runId: 'current' }),
    run({ runType: 'full' }),
    run({ startedAt: null }),
    run({ startedAt: '02' }),
    run({ startedAt: '04' }),
  ]) {
    expect(revisionUsedStudyIds(current, [previous], [version()])).toEqual(new Set());
  }
  for (const v of [
    version({ createdByType: 'user_edit' }),
    version({ createdByType: 'ai_draft' }),
    version({ createdAt: '03' }),
    version({ createdAt: '04' }),
    version({ createdAt: '01' }),
  ]) {
    expect(revisionUsedStudyIds(current, [run()], [v])).toEqual(new Set());
  }
  expect(revisionUsedStudyIds(run({ startedAt: null }), [run()], [version()])).toEqual(new Set());
  expect(revisionUsedStudyIds(current, [], [version()])).toEqual(new Set());
  expect(revisionUsedStudyIds(current, [run()], [])).toEqual(new Set());
});
