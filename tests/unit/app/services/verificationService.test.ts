import type { Decision } from '../../../../src/domain/decision';
import {
  persistInstanceDeclarations,
  saveDecisionWrite,
  type QueuedDecisionWrite,
  type VerificationDeps,
} from '../../../../src/app/services/verificationService';
import { appendDecisionRows } from '../../../../src/features/verification/decisionRepository';
import {
  readStudyDataSheet,
  upsertResultsDataRows,
  upsertStudyDataRows,
} from '../../../../src/features/extraction/annotationRepository';
import { showToast } from '../../../../src/app/ui/toast';

jest.mock('../../../../src/features/verification/decisionRepository', () => ({
  appendDecisionRows: jest.fn(),
  readDecisionsByStudy: jest.fn(),
}));
jest.mock('../../../../src/features/extraction/annotationRepository', () => ({
  readStudyDataSheet: jest.fn(),
  upsertResultsDataRows: jest.fn(),
  upsertStudyDataRows: jest.fn(),
}));
jest.mock('../../../../src/app/ui/toast', () => ({
  showToast: jest.fn(),
}));

const appendDecisionRowsMock = appendDecisionRows as jest.MockedFunction<typeof appendDecisionRows>;
const readStudyDataSheetMock = readStudyDataSheet as jest.MockedFunction<typeof readStudyDataSheet>;
const upsertResultsMock = upsertResultsDataRows as jest.MockedFunction<typeof upsertResultsDataRows>;
const upsertStudyMock = upsertStudyDataRows as jest.MockedFunction<typeof upsertStudyDataRows>;
const showToastMock = showToast as jest.MockedFunction<typeof showToast>;

function makeDeps(): VerificationDeps {
  return {
    google: {
      fetch: jest.fn() as unknown as typeof fetch,
      getAccessToken: jest.fn().mockResolvedValue('token'),
    },
    profile: {
      getProfileUserInfo: jest.fn().mockResolvedValue({ email: 'me@example.com', id: 'uid' }),
    },
    loadPdf: jest.fn(),
  };
}

function makeDecision(overrides: Partial<Decision> = {}): Decision {
  return {
    decidedAt: 't1',
    decidedBy: 'me@example.com',
    studyId: 'study-1',
    fieldId: 'f-out',
    entityKey: 'outcome:mortality|arm:1',
    annotator: 'me@example.com',
    annotatorType: 'human_with_ai',
    schemaVersion: 1,
    action: 'edit',
    value: '10',
    note: null,
    ...overrides,
  };
}

function makeDeclaration(overrides: Partial<Decision> = {}): Decision {
  return makeDecision({
    fieldId: '__entity_instance__',
    value: 'outcome:mortality|arm:1',
    note: 'outcome_instance_declared',
    ...overrides,
  });
}

beforeEach(() => {
  jest.clearAllMocks();
  appendDecisionRowsMock.mockResolvedValue(undefined);
  readStudyDataSheetMock.mockResolvedValue({ fieldNames: [], rows: [] });
  upsertResultsMock.mockResolvedValue(undefined);
  upsertStudyMock.mockResolvedValue(undefined);
});

describe('saveDecisionWrite', () => {
  test('インスタンス宣言イベントは通常の判定保存経路で保存しない', async () => {
    const decision = makeDeclaration();
    const write: QueuedDecisionWrite = {
      decision,
      fieldName: '__entity_instance__',
      entityLevel: 'outcome_result',
      studyValues: null,
    };
    await expect(saveDecisionWrite('sheet-1', write, makeDeps())).rejects.toThrow(
      '通常の判定保存経路',
    );
    expect(upsertResultsMock).not.toHaveBeenCalled();
    expect(appendDecisionRowsMock).not.toHaveBeenCalled();
  });
});

describe('persistInstanceDeclarations', () => {
  test('空配列なら何もしない', async () => {
    await persistInstanceDeclarations('sheet-1', [], makeDeps());
    expect(appendDecisionRowsMock).not.toHaveBeenCalled();
  });

  test('インスタンス宣言ではない Decision は拒否する', async () => {
    await expect(persistInstanceDeclarations('sheet-1', [makeDecision()], makeDeps())).rejects.toThrow(
      'インスタンス宣言ではない',
    );
    expect(appendDecisionRowsMock).not.toHaveBeenCalled();
  });

  test('追記失敗時はトーストを出して例外を外へ投げない', async () => {
    appendDecisionRowsMock.mockRejectedValue(new Error('offline'));
    await expect(
      persistInstanceDeclarations('sheet-1', [makeDeclaration()], makeDeps()),
    ).resolves.toBeUndefined();
    expect(showToastMock).toHaveBeenCalledWith(
      expect.stringContaining('インスタンス宣言の保存に失敗しました'),
    );
  });
});
