import {
  collectAnnotatorTypesForEmail,
  readAnnotatorTypesForEmail,
} from '../../../../src/features/project/reviewerWorkRepository';
import { readAllDecisions } from '../../../../src/features/verification/decisionRepository';
import { readAllStudyDataRows, readAllResultsDataRows } from '../../../../src/features/extraction/annotationRepository';
import { readAllArmStructures } from '../../../../src/features/verification/armStructureRepository';

jest.mock('../../../../src/features/verification/decisionRepository');
jest.mock('../../../../src/features/extraction/annotationRepository');
jest.mock('../../../../src/features/verification/armStructureRepository');

const google = { fetch: jest.fn(), getAccessToken: jest.fn() };
const email = 'reviewer@example.com';

beforeEach(() => {
  jest.mocked(readAllDecisions).mockResolvedValue([]);
  jest.mocked(readAllStudyDataRows).mockResolvedValue([]);
  jest.mocked(readAllResultsDataRows).mockResolvedValue([]);
  jest.mocked(readAllArmStructures).mockResolvedValue([]);
});

test('email の完全一致で人間の型だけを重複なく集める', () => {
  expect(collectAnnotatorTypesForEmail([
    { annotator: email, annotatorType: 'human_with_ai' },
    { annotator: email, annotatorType: 'human_with_ai' },
    { annotator: email, annotatorType: 'human_independent' },
    { annotator: email, annotatorType: 'ai' },
    { annotator: email, annotatorType: 'consensus' },
    { annotator: email.toUpperCase(), annotatorType: 'human_independent' },
    { annotator: ` ${email}`, annotatorType: 'human_with_ai' },
  ], email)).toEqual(new Set(['human_with_ai', 'human_independent']));
});

test.each(['Decisions', 'StudyData', 'ResultsData', 'ArmStructures'] as const)(
  '%s だけにある作業も取得し、毎回全ソースを読み直す', async (source) => {
    const row = { annotator: email, annotatorType: 'human_with_ai' as const,
      studyId: 'study', schemaVersion: 1, runId: '', updatedAt: 't', values: {},
      decidedAt: 't', decidedBy: email, fieldId: 'field', entityKey: 'study',
      action: 'accept' as const, value: '値', note: null, resultId: 'result', notReported: false,
      version: 1, armKey: 'arm:1', armName: '群', confirmedAt: 't',
    };
    if (source === 'Decisions') jest.mocked(readAllDecisions).mockResolvedValue([row]);
    if (source === 'StudyData') jest.mocked(readAllStudyDataRows).mockResolvedValue([row]);
    if (source === 'ResultsData') jest.mocked(readAllResultsDataRows).mockResolvedValue([row]);
    if (source === 'ArmStructures') jest.mocked(readAllArmStructures).mockResolvedValue([row]);
    for (let i = 0; i < 2; i++) {
      expect(await readAnnotatorTypesForEmail('sheet', email, google)).toEqual(new Set(['human_with_ai']));
    }
    for (const reader of [readAllDecisions, readAllStudyDataRows, readAllResultsDataRows, readAllArmStructures]) {
      expect(reader).toHaveBeenCalledTimes(2);
      expect(reader).toHaveBeenCalledWith('sheet', google);
    }
  },
);

test('読み込み失敗は呼び出し元に伝える', async () => {
  jest.mocked(readAllArmStructures).mockRejectedValueOnce(new Error('読込失敗'));
  await expect(readAnnotatorTypesForEmail('sheet', email, google)).rejects.toThrow('読込失敗');
});


test('別 email・大文字違い・前後空白の行だけにある作業型は集めない', () => {
  const types = collectAnnotatorTypesForEmail([
    { annotator: email, annotatorType: 'human_with_ai' },
    { annotator: email.toUpperCase(), annotatorType: 'human_independent' },
    { annotator: ` ${email} `, annotatorType: 'human_independent' },
    { annotator: 'other@example.com', annotatorType: 'human_independent' },
  ], email);
  expect(types).toEqual(new Set(['human_with_ai']));
  expect(types.has('human_independent')).toBe(false);
});
