import type { Decision } from '../../../../src/domain/decision';
import type { DocumentRecord } from '../../../../src/domain/document';
import type { StudyRecord } from '../../../../src/domain/study';
import {
  loadVerificationBundle,
  persistInstanceDeclarations,
  saveDecisionWrite,
  type VerificationBundleInput,
  type QueuedDecisionWrite,
  type VerificationDeps,
} from '../../../../src/app/services/verificationService';
import {
  appendDecisionRows,
  readDecisionsByStudy,
} from '../../../../src/features/verification/decisionRepository';
import { readArmStructuresByStudy } from '../../../../src/features/verification/armStructureRepository';
import {
  readStudyDataSheet,
  upsertResultsDataRows,
  upsertStudyDataRows,
} from '../../../../src/features/extraction/annotationRepository';
import { getFileBinary, getFileText } from '../../../../src/lib/google/drive';
import { showToast } from '../../../../src/app/ui/toast';

jest.mock('../../../../src/features/verification/decisionRepository', () => ({
  appendDecisionRows: jest.fn(),
  readDecisionsByStudy: jest.fn(),
}));
jest.mock('../../../../src/features/verification/armStructureRepository', () => ({
  ...jest.requireActual('../../../../src/features/verification/armStructureRepository'),
  readArmStructuresByStudy: jest.fn(),
}));
jest.mock('../../../../src/features/extraction/annotationRepository', () => ({
  readStudyDataSheet: jest.fn(),
  upsertResultsDataRows: jest.fn(),
  upsertStudyDataRows: jest.fn(),
}));
jest.mock('../../../../src/lib/google/drive', () => ({
  getFileBinary: jest.fn(),
  getFileText: jest.fn(),
}));
jest.mock('../../../../src/app/ui/toast', () => ({
  showToast: jest.fn(),
}));

const appendDecisionRowsMock = appendDecisionRows as jest.MockedFunction<typeof appendDecisionRows>;
const readDecisionsByStudyMock = readDecisionsByStudy as jest.MockedFunction<
  typeof readDecisionsByStudy
>;
const readArmStructuresByStudyMock = readArmStructuresByStudy as jest.MockedFunction<
  typeof readArmStructuresByStudy
>;
const readStudyDataSheetMock = readStudyDataSheet as jest.MockedFunction<typeof readStudyDataSheet>;
const upsertResultsMock = upsertResultsDataRows as jest.MockedFunction<typeof upsertResultsDataRows>;
const upsertStudyMock = upsertStudyDataRows as jest.MockedFunction<typeof upsertStudyDataRows>;
const getFileBinaryMock = getFileBinary as jest.MockedFunction<typeof getFileBinary>;
const getFileTextMock = getFileText as jest.MockedFunction<typeof getFileText>;
const showToastMock = showToast as jest.MockedFunction<typeof showToast>;

function makeDeps(overrides: Partial<VerificationDeps> = {}): VerificationDeps {
  return {
    google: {
      fetch: jest.fn() as unknown as typeof fetch,
      getAccessToken: jest.fn().mockResolvedValue('token'),
    },
    profile: {
      getProfileUserInfo: jest.fn().mockResolvedValue({ email: 'me@example.com', id: 'uid' }),
    },
    loadPdf: jest.fn(),
    ...overrides,
  };
}

function makeDocument(overrides: Partial<DocumentRecord> = {}): DocumentRecord {
  return {
    documentId: 'doc-1',
    studyId: 'study-1',
    documentRole: 'article',
    driveFileId: 'drive-1',
    sourceFileId: 'src-1',
    filename: 'smith2020.pdf',
    pmid: null,
    doi: null,
    textRef: 'https://drive.google.com/file/d/txt-1/view',
    textStatus: 'ok',
    pageCount: 1,
    charCount: 100,
    importedAt: 't0',
    importedBy: 'me@example.com',
    note: null,
    ...overrides,
  };
}

function makeStudy(overrides: Partial<StudyRecord> = {}): StudyRecord {
  return {
    studyId: 'study-1',
    studyLabel: 'Smith 2020',
    registrationId: null,
    createdAt: 't0',
    createdBy: 'me@example.com',
    note: null,
    ...overrides,
  };
}

function makeBundleInput(overrides: Partial<VerificationBundleInput> = {}): VerificationBundleInput {
  return {
    spreadsheetId: 'sheet-1',
    study: makeStudy(),
    documents: [makeDocument()],
    fields: [],
    evidence: [],
    schemaVersion: 1,
    ...overrides,
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
  readDecisionsByStudyMock.mockResolvedValue([]);
  readArmStructuresByStudyMock.mockResolvedValue([]);
  getFileBinaryMock.mockResolvedValue(new ArrayBuffer(8));
  getFileTextMock.mockResolvedValue('');
});

describe('loadVerificationBundle', () => {
  test('PDF バイナリを 1 件も読まず、extracted_texts だけを先読みする（issue #28 案3）', async () => {
    getFileTextMock.mockResolvedValue('page one\fpage two');
    const { verification } = await loadVerificationBundle(makeBundleInput(), makeDeps());
    expect(getFileBinaryMock).not.toHaveBeenCalled();
    expect(getFileTextMock).toHaveBeenCalledWith('txt-1', expect.anything());
    expect(verification.documents).toEqual([
      {
        document: makeDocument(),
        extractedPages: [
          { page: 1, text: 'page one' },
          { page: 2, text: 'page two' },
        ],
        extractedTextError: null,
      },
    ]);
  });

  test('textRef が null（no_text_layer）の文書は extracted_texts を読まず空配列にする', async () => {
    const { verification } = await loadVerificationBundle(
      makeBundleInput({ documents: [makeDocument({ textRef: null })] }),
      makeDeps(),
    );
    expect(getFileTextMock).not.toHaveBeenCalled();
    expect(verification.documents[0]).toMatchObject({ extractedPages: [], extractedTextError: null });
  });

  test('text_ref からファイル ID を解決できない場合は extractedTextError に残す', async () => {
    const { verification } = await loadVerificationBundle(
      makeBundleInput({ documents: [makeDocument({ textRef: 'not-a-drive-url' })] }),
      makeDeps(),
    );
    expect(getFileTextMock).not.toHaveBeenCalled();
    expect(verification.documents[0]?.extractedPages).toEqual([]);
    expect(verification.documents[0]?.extractedTextError).toContain('ファイル ID を解決できません');
  });

  test('extracted_texts の読込失敗は空配列 + extractedTextError に留め、bundle 全体を失敗させない', async () => {
    getFileTextMock.mockRejectedValue(new Error('403 forbidden'));
    const { verification } = await loadVerificationBundle(makeBundleInput(), makeDeps());
    expect(verification.documents[0]).toMatchObject({
      extractedPages: [],
      extractedTextError: '403 forbidden',
    });
  });

  test('loadPdfView は documentId から driveFileId を解決して PDF を遅延読込する', async () => {
    const deps = makeDeps({
      loadPdf: jest.fn().mockResolvedValue({
        numPages: 1,
        getPage: jest.fn().mockResolvedValue({
          getViewport: () => ({ width: 10, height: 10 }),
          getTextContent: async () => ({ items: [] }),
          cleanup: jest.fn(),
        }),
        destroy: jest.fn().mockResolvedValue(undefined),
      }),
    });
    const { verification } = await loadVerificationBundle(makeBundleInput(), deps);
    const loaded = await verification.loadPdfView('doc-1');
    expect(getFileBinaryMock).toHaveBeenCalledWith('drive-1', expect.anything());
    expect(loaded.pdf).not.toBeNull();
  });

  test('loadPdfView / retryPdfView は study 配下にない documentId をエラーとして返す（throw しない）', async () => {
    const { verification } = await loadVerificationBundle(makeBundleInput(), makeDeps());
    const loaded = await verification.loadPdfView('doc-ghost');
    expect(loaded.pdf).toBeNull();
    expect(loaded.pdfError).toContain('doc-ghost');
    expect(getFileBinaryMock).not.toHaveBeenCalled();
    const retried = await verification.retryPdfView('doc-ghost');
    expect(retried.pdfError).toContain('doc-ghost');
  });

  test('disposePdf は loadPdfView でキャッシュされた PDF をすべて破棄する', async () => {
    const destroy = jest.fn().mockResolvedValue(undefined);
    const deps = makeDeps({
      loadPdf: jest.fn().mockResolvedValue({
        numPages: 1,
        getPage: jest.fn().mockResolvedValue({
          getViewport: () => ({ width: 10, height: 10 }),
          getTextContent: async () => ({ items: [] }),
          cleanup: jest.fn(),
        }),
        destroy,
      }),
    });
    const { verification } = await loadVerificationBundle(makeBundleInput(), deps);
    await verification.loadPdfView('doc-1');
    expect(destroy).not.toHaveBeenCalled();
    await verification.disposePdf?.();
    expect(destroy).toHaveBeenCalledTimes(1);
  });
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
