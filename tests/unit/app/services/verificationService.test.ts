import type { Decision } from '../../../../src/domain/decision';
import type { DocumentRecord } from '../../../../src/domain/document';
import type { SchemaField } from '../../../../src/domain/schemaField';
import type { StudyRecord } from '../../../../src/domain/study';
import {
  decisionWriteId,
  decisionWriteSortKey,
  foldDecisionWriteTokens,
  loadVerificationBundle,
  persistConsensusWrite,
  persistDecisionWrite,
  persistInstanceDeclarations,
  persistVerifyLayoutMode,
  resultsCellKeyOf,
  saveDecisionWrite,
  type VerificationBundleInput,
  type QueuedConsensusWrite,
  type QueuedDecisionWrite,
  type QueuedWrite,
  type VerificationDeps,
} from '../../../../src/app/services/verificationService';
import type { ConsensusCellWrite, ConsensusWriteParams } from '../../../../src/features/adjudication/consensusWrites';
import {
  appendDecisionRows,
  readDecisionsByStudy,
} from '../../../../src/features/verification/decisionRepository';
import { readArmStructuresByStudy } from '../../../../src/features/verification/armStructureRepository';
import {
  AnnotationConflictError,
  readResultsDataRows,
  readStudyDataSheet,
  upsertResultsDataRows,
  upsertStudyDataRows,
} from '../../../../src/features/extraction/annotationRepository';
import { getFileBinary, getFileText } from '../../../../src/lib/google/drive';
import { showToast } from '../../../../src/app/ui/toast';
import type { OfflineQueue } from '../../../../src/lib/storage/offlineQueue';

jest.mock('../../../../src/features/verification/decisionRepository', () => ({
  appendDecisionRows: jest.fn(),
  readDecisionsByStudy: jest.fn(),
}));
jest.mock('../../../../src/features/verification/armStructureRepository', () => ({
  ...jest.requireActual('../../../../src/features/verification/armStructureRepository'),
  readArmStructuresByStudy: jest.fn(),
}));
jest.mock('../../../../src/features/extraction/annotationRepository', () => ({
  ...jest.requireActual('../../../../src/features/extraction/annotationRepository'),
  readResultsDataRows: jest.fn(),
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
const readResultsDataRowsMock = readResultsDataRows as jest.MockedFunction<typeof readResultsDataRows>;
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
    excluded: false,
    exclusionReason: null,
    exclusionNote: null,
    excludedAt: null,
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
    annotatorType: 'human_with_ai',
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

function makeQueue(): jest.Mocked<OfflineQueue<QueuedWrite>> {
  return {
    enqueue: jest.fn().mockResolvedValue(undefined),
    flush: jest.fn().mockResolvedValue({ flushedCount: 0, remainingCount: 0 }),
  };
}

function makeField(overrides: Partial<SchemaField> = {}): SchemaField {
  return {
    schemaVersion: 1,
    fieldId: 'f-1',
    fieldIndex: 1,
    section: 'population',
    fieldName: 'sample_size',
    fieldLabel: '総サンプルサイズ',
    entityLevel: 'study',
    dataType: 'text',
    unit: null,
    allowedValues: null,
    required: false,
    extractionInstruction: '',
    example: null,
    aiGenerated: false,
    note: null,
    ...overrides,
  };
}

/** issue #63: S12 裁定の consensus 書き込み 1 セルぶん（features/adjudication/consensusWrites） */
function makeConsensusWrite(overrides: Partial<ConsensusCellWrite> = {}): ConsensusCellWrite {
  return {
    field: makeField(),
    entityKey: '-',
    action: 'accept',
    value: '120',
    ...overrides,
  };
}

function makeConsensusParams(overrides: Partial<ConsensusWriteParams> = {}): ConsensusWriteParams {
  return {
    studyId: 'study-1',
    decidedBy: 'judge@example.com',
    decidedAt: 't1',
    schemaVersion: 1,
    ...overrides,
  };
}

beforeEach(() => {
  jest.clearAllMocks();
  appendDecisionRowsMock.mockResolvedValue(undefined);
  readStudyDataSheetMock.mockResolvedValue({ fieldNames: [], rows: [] });
  readResultsDataRowsMock.mockResolvedValue([]);
  upsertResultsMock.mockResolvedValue(undefined);
  upsertStudyMock.mockResolvedValue(undefined);
  readDecisionsByStudyMock.mockResolvedValue([]);
  readArmStructuresByStudyMock.mockResolvedValue([]);
  getFileBinaryMock.mockResolvedValue(new ArrayBuffer(8));
  getFileTextMock.mockResolvedValue('');
});

describe('loadVerificationBundle', () => {
  test('annotatorType は呼び出し側の入力をそのまま束へ渡す（独立二重レビュー機能 §5.2）', async () => {
    const { verification } = await loadVerificationBundle(
      makeBundleInput({ annotatorType: 'human_independent' }),
      makeDeps(),
    );
    expect(verification.annotatorType).toBe('human_independent');
  });

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

  test('layoutMode は settingsStore（chrome.storage.local）から読む（未設定は既定 focus）', async () => {
    const { layoutMode } = await loadVerificationBundle(makeBundleInput(), makeDeps());
    expect(layoutMode).toBe('focus');
  });

  test('layoutMode は deps.loadVerifyLayoutMode を注入すればそちらを使う', async () => {
    const loadVerifyLayoutMode = jest.fn().mockResolvedValue('list');
    const { layoutMode } = await loadVerificationBundle(
      makeBundleInput(),
      makeDeps({ loadVerifyLayoutMode }),
    );
    expect(layoutMode).toBe('list');
    expect(loadVerifyLayoutMode).toHaveBeenCalledTimes(1);
  });

  describe('楽観ロックのトークン取得（issue #64）', () => {
    test('自分の StudyData 行があれば updated_at をトークンに持つ', async () => {
      readStudyDataSheetMock.mockResolvedValue({
        fieldNames: ['sample_size_total'],
        rows: [
          {
            studyId: 'study-1',
            annotator: 'me@example.com',
            annotatorType: 'human_with_ai',
            schemaVersion: 1,
            runId: null,
            updatedAt: 't-study-0',
            values: { sample_size_total: '100' },
          },
        ],
      });
      const { studyRowUpdatedAt } = await loadVerificationBundle(makeBundleInput(), makeDeps());
      expect(studyRowUpdatedAt).toBe('t-study-0');
    });

    test('自分の StudyData 行が無ければ null', async () => {
      const { studyRowUpdatedAt } = await loadVerificationBundle(makeBundleInput(), makeDeps());
      expect(studyRowUpdatedAt).toBeNull();
    });

    test('自分の ResultsData 行をセルキー別 updated_at へ畳み込む（他人・他 study の行は無視）', async () => {
      readResultsDataRowsMock.mockResolvedValue([
        {
          resultId: 'r-1',
          studyId: 'study-1',
          fieldId: 'f-arm-n',
          annotator: 'me@example.com',
          annotatorType: 'human_with_ai',
          schemaVersion: 1,
          entityKey: 'arm:1',
          runId: null,
          value: '50',
          notReported: false,
          updatedAt: 't-r1',
        },
        {
          // 他人の行は無視
          resultId: 'r-2',
          studyId: 'study-1',
          fieldId: 'f-arm-n',
          annotator: 'other@example.com',
          annotatorType: 'human_with_ai',
          schemaVersion: 1,
          entityKey: 'arm:2',
          runId: null,
          value: '60',
          notReported: false,
          updatedAt: 't-r2',
        },
        {
          // 他 study の行は無視
          resultId: 'r-3',
          studyId: 'study-other',
          fieldId: 'f-arm-n',
          annotator: 'me@example.com',
          annotatorType: 'human_with_ai',
          schemaVersion: 1,
          entityKey: 'arm:1',
          runId: null,
          value: '70',
          notReported: false,
          updatedAt: 't-r3',
        },
      ]);
      const { resultsRowUpdatedAt } = await loadVerificationBundle(makeBundleInput(), makeDeps());
      expect(resultsRowUpdatedAt).toEqual({ [resultsCellKeyOf('arm:1', 'f-arm-n')]: 't-r1' });
    });
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

describe('persistVerifyLayoutMode', () => {
  test('deps.saveVerifyLayoutMode を注入すればそちらへ保存する', async () => {
    const saveVerifyLayoutMode = jest.fn().mockResolvedValue(undefined);
    await persistVerifyLayoutMode('list', makeDeps({ saveVerifyLayoutMode }));
    expect(saveVerifyLayoutMode).toHaveBeenCalledWith('list');
  });

  test('未注入なら settingsStore（chrome.storage.local）へ保存する', async () => {
    await persistVerifyLayoutMode('list', makeDeps());
    const { loadVerifyLayoutMode } = await import('../../../../src/lib/storage/settingsStore');
    await expect(loadVerifyLayoutMode()).resolves.toBe('list');
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

  test('expectedUpdatedAt（issue #64）を study 項目の upsert 行へ引き渡す', async () => {
    const write: QueuedDecisionWrite = {
      decision: makeDecision(),
      fieldName: 'sample_size_total',
      entityLevel: 'study',
      studyValues: { sample_size_total: '10' },
    };
    await saveDecisionWrite('sheet-1', write, makeDeps(), 't0');
    expect(upsertStudyMock).toHaveBeenCalledWith(
      'sheet-1',
      [expect.objectContaining({ expectedUpdatedAt: 't0' })],
      expect.anything(),
    );
  });

  test('expectedUpdatedAt（issue #64）を非 study 項目の upsert 行へ引き渡す', async () => {
    const write: QueuedDecisionWrite = {
      decision: makeDecision({ fieldId: 'f-arm-n', entityKey: 'arm:1' }),
      fieldName: 'arm_n',
      entityLevel: 'arm',
      studyValues: null,
    };
    await saveDecisionWrite('sheet-1', write, makeDeps(), null);
    expect(upsertResultsMock).toHaveBeenCalledWith(
      'sheet-1',
      [expect.objectContaining({ expectedUpdatedAt: null })],
      expect.anything(),
      expect.anything(),
    );
  });

  test('expectedUpdatedAt 省略時は undefined を渡す（チェックなし。オフラインキュー再送経路）', async () => {
    const write: QueuedDecisionWrite = {
      decision: makeDecision(),
      fieldName: 'sample_size_total',
      entityLevel: 'study',
      studyValues: { sample_size_total: '10' },
    };
    await saveDecisionWrite('sheet-1', write, makeDeps());
    expect(upsertStudyMock).toHaveBeenCalledWith(
      'sheet-1',
      [expect.objectContaining({ expectedUpdatedAt: undefined })],
      expect.anything(),
    );
  });
});

describe('persistDecisionWrite', () => {
  function makeWrite(overrides: Partial<QueuedDecisionWrite> = {}): QueuedDecisionWrite {
    return {
      decision: makeDecision(),
      fieldName: 'sample_size_total',
      entityLevel: 'study',
      studyValues: { sample_size_total: '10' },
      ...overrides,
    };
  }

  test('即時保存の成功時は written に自身を含めて saved を返す', async () => {
    const write = makeWrite();
    const result = await persistDecisionWrite('sheet-1', write, makeDeps());
    expect(result).toEqual({ status: 'saved', remainingCount: 0, written: [write] });
  });

  test('AnnotationConflictError で失敗した場合はキューへ退避せず conflict を返す（トーストも出さない）', async () => {
    const queue = makeQueue();
    const conflict = new AnnotationConflictError({
      tab: 'StudyData',
      studyId: 'study-1',
      annotator: 'me@example.com',
      entityKey: null,
      fieldId: null,
      expectedUpdatedAt: 't-old',
      actualUpdatedAt: 't-new',
    });
    upsertStudyMock.mockRejectedValueOnce(conflict);
    const result = await persistDecisionWrite(
      'sheet-1',
      makeWrite(),
      makeDeps({ decisionQueue: queue }),
      't-old',
    );
    expect(result).toEqual({ status: 'conflict', message: conflict.message });
    expect(queue.enqueue).not.toHaveBeenCalled();
    expect(showToastMock).not.toHaveBeenCalled();
  });

  test('AnnotationConflictError 以外の失敗はキューへ退避し、トーストを出す（従来どおり）', async () => {
    const queue = makeQueue();
    upsertStudyMock.mockRejectedValueOnce(new Error('network error'));
    const result = await persistDecisionWrite('sheet-1', makeWrite(), makeDeps({ decisionQueue: queue }));
    expect(result).toEqual({ status: 'queued' });
    expect(queue.enqueue).toHaveBeenCalledTimes(1);
    expect(showToastMock).toHaveBeenCalledWith(expect.stringContaining('オフラインキューへ退避'));
  });

  test('saved の written には再送成功分が順序どおり入り、再送は expectedUpdatedAt なし（シートの updated_at が変わっていても成功する）', async () => {
    const resent = makeWrite({ decision: makeDecision({ decidedAt: 't-old', fieldId: 'f-2' }) });
    const queue = makeQueue();
    queue.flush.mockImplementation(async (_sheet, _email, save) => {
      await save(resent);
      return { flushedCount: 1, remainingCount: 0 };
    });
    // 即時保存の expectedUpdatedAt は 't0' だが、シート側は既に別の値（'t9'）へ進んでいるとする。
    // 再送（2 回目呼び出し）は expectedUpdatedAt を渡さないため、コンフリクトにならず成功する
    upsertStudyMock.mockImplementationOnce(async () => undefined); // 即時保存
    upsertStudyMock.mockImplementationOnce(async (_sheet, rows) => {
      // 再送呼び出しには expectedUpdatedAt が含まれない（undefined）ことを確認
      expect(rows[0]?.expectedUpdatedAt).toBeUndefined();
    });
    const write = makeWrite();
    const result = await persistDecisionWrite(
      'sheet-1',
      write,
      makeDeps({ decisionQueue: queue }),
      't0',
    );
    expect(result.status).toBe('saved');
    if (result.status === 'saved') {
      expect(result.written).toEqual([write, resent]);
      expect(result.remainingCount).toBe(0);
    }
    expect(upsertStudyMock).toHaveBeenCalledTimes(2);
  });

  test('written には QueuedDecisionWrite のみを積む（同じ共有キューに S12 裁定の QueuedConsensusWrite が混在していても除外する。issue #63）', async () => {
    const consensusItem: QueuedConsensusWrite = {
      consensusWrites: [makeConsensusWrite()],
      consensusParams: makeConsensusParams(),
    };
    const queue = makeQueue();
    queue.flush.mockImplementation(async (_sheet, _email, save) => {
      await save(consensusItem);
      return { flushedCount: 1, remainingCount: 0 };
    });
    const write = makeWrite();
    const result = await persistDecisionWrite('sheet-1', write, makeDeps({ decisionQueue: queue }));
    expect(result.status).toBe('saved');
    if (result.status === 'saved') {
      // consensusItem は annotator 行の楽観ロック（foldDecisionWriteTokens）と無関係なので含まれない
      expect(result.written).toEqual([write]);
    }
    // それでも consensusItem 自体の再送（applyConsensusWrites 相当）は実行される
    // （study レベルの consensusWrite のため upsertStudyDataRows が即時保存 + 再送で計 2 回呼ばれる）
    expect(upsertStudyMock).toHaveBeenCalledTimes(2);
  });
});

describe('QueuedWrite の構造的判別（issue #63: QueuedDecisionWrite | QueuedConsensusWrite の共用体）', () => {
  test('decisionWriteId: QueuedConsensusWrite は studyId + decidedAt から組み立てる', () => {
    const item: QueuedConsensusWrite = {
      consensusWrites: [makeConsensusWrite()],
      consensusParams: makeConsensusParams({ studyId: 'study-9', decidedAt: 't9' }),
    };
    expect(decisionWriteId(item)).toBe('consensus|study-9|t9');
  });

  test('decisionWriteSortKey: QueuedConsensusWrite は decidedAt', () => {
    const item: QueuedConsensusWrite = {
      consensusWrites: [makeConsensusWrite()],
      consensusParams: makeConsensusParams({ decidedAt: 't9' }),
    };
    expect(decisionWriteSortKey(item)).toBe('t9');
  });

  test('decisionWriteId / decisionWriteSortKey: QueuedDecisionWrite は従来どおり decision 由来', () => {
    const item: QueuedDecisionWrite = {
      decision: makeDecision({ decidedAt: 't5', fieldId: 'f-x', entityKey: 'arm:1' }),
      fieldName: 'x',
      entityLevel: 'arm',
      studyValues: null,
    };
    expect(decisionWriteId(item)).toBe('t5|f-x|arm:1');
    expect(decisionWriteSortKey(item)).toBe('t5');
  });
});

describe('persistConsensusWrite（issue #63: S12 裁定の consensus 書き込みを検証側と共有する \'decisions\' キューへ退避する）', () => {
  test('即時保存に成功すれば saved を返し、consensus 行 upsert → Decisions 追記を行う', async () => {
    const queue = makeQueue();
    const item: QueuedConsensusWrite = {
      consensusWrites: [makeConsensusWrite()],
      consensusParams: makeConsensusParams(),
    };
    const result = await persistConsensusWrite('sheet-1', item, makeDeps({ decisionQueue: queue }));
    expect(result).toEqual({ status: 'saved', remainingCount: 0 });
    expect(upsertStudyMock).toHaveBeenCalledTimes(1);
    expect(appendDecisionRowsMock).toHaveBeenCalledTimes(1);
    // 即時保存の成功後は同じキューに残る過去の退避分（判定・裁定どちらも）も再送する
    expect(queue.flush).toHaveBeenCalledWith('sheet-1', 'judge@example.com', expect.any(Function));
  });

  test('即時保存が失敗すればキューへ退避し queued を返す（トースト表示）', async () => {
    const queue = makeQueue();
    upsertStudyMock.mockRejectedValueOnce(new Error('network error'));
    const item: QueuedConsensusWrite = {
      consensusWrites: [makeConsensusWrite()],
      consensusParams: makeConsensusParams(),
    };
    const result = await persistConsensusWrite('sheet-1', item, makeDeps({ decisionQueue: queue }));
    expect(result).toEqual({ status: 'queued' });
    expect(queue.enqueue).toHaveBeenCalledWith('sheet-1', 'judge@example.com', item);
    expect(showToastMock).toHaveBeenCalledWith(expect.stringContaining('裁定をオフラインキューへ退避'));
  });

  test('flush で QueuedDecisionWrite（検証の判定）を再送するときは saveDecisionWrite 経由になる（saveQueuedItem の分岐）', async () => {
    const decisionItem: QueuedDecisionWrite = {
      decision: makeDecision({ fieldId: 'f-2', entityKey: '-' }),
      fieldName: 'sample_size_total',
      entityLevel: 'study',
      studyValues: { sample_size_total: '5' },
    };
    const queue = makeQueue();
    queue.flush.mockImplementation(async (_sheet, _email, save) => {
      await save(decisionItem);
      return { flushedCount: 1, remainingCount: 0 };
    });
    const item: QueuedConsensusWrite = {
      consensusWrites: [makeConsensusWrite()],
      consensusParams: makeConsensusParams(),
    };
    const result = await persistConsensusWrite('sheet-1', item, makeDeps({ decisionQueue: queue }));
    expect(result).toEqual({ status: 'saved', remainingCount: 0 });
    // 即時保存の consensusWrite ぶん 1 回 + 再送の decisionItem ぶん 1 回 = 計 2 回
    expect(upsertStudyMock).toHaveBeenCalledTimes(2);
    expect(appendDecisionRowsMock).toHaveBeenCalledTimes(2);
  });

  test('decisionQueue 未注入なら検証側の判定と共有するモジュール共有キューを使う', async () => {
    const item: QueuedConsensusWrite = {
      consensusWrites: [makeConsensusWrite()],
      consensusParams: makeConsensusParams(),
    };
    await expect(
      persistConsensusWrite('sheet-1', item, makeDeps({ decisionQueue: undefined })),
    ).resolves.toEqual({ status: 'saved', remainingCount: 0 });
  });
});

describe('foldDecisionWriteTokens', () => {
  function makeWrite(overrides: Partial<QueuedDecisionWrite> = {}): QueuedDecisionWrite {
    return {
      decision: makeDecision(),
      fieldName: 'sample_size_total',
      entityLevel: 'study',
      studyValues: { sample_size_total: '10' },
      ...overrides,
    };
  }

  test('study の書き込みは studyRowUpdatedAt を更新する', () => {
    const write = makeWrite({ decision: makeDecision({ decidedAt: 't-new' }) });
    const folded = foldDecisionWriteTokens([write], {
      studyRowUpdatedAt: 't-old',
      resultsRowUpdatedAt: {},
    });
    expect(folded).toEqual({ studyRowUpdatedAt: 't-new', resultsRowUpdatedAt: {} });
  });

  test('非 study の書き込みは resultsRowUpdatedAt のセルキーを更新する', () => {
    const write = makeWrite({
      entityLevel: 'arm',
      studyValues: null,
      decision: makeDecision({ decidedAt: 't-new', fieldId: 'f-arm-n', entityKey: 'arm:1' }),
    });
    const folded = foldDecisionWriteTokens([write], {
      studyRowUpdatedAt: null,
      resultsRowUpdatedAt: {},
    });
    expect(folded).toEqual({
      studyRowUpdatedAt: null,
      resultsRowUpdatedAt: { [resultsCellKeyOf('arm:1', 'f-arm-n')]: 't-new' },
    });
  });

  test('後勝ち: written を順に見て最後の値が残る', () => {
    const first = makeWrite({ decision: makeDecision({ decidedAt: 't1' }) });
    const second = makeWrite({ decision: makeDecision({ decidedAt: 't2' }) });
    const folded = foldDecisionWriteTokens([second, first], {
      studyRowUpdatedAt: null,
      resultsRowUpdatedAt: {},
    });
    // 入力順（second, first）どおりに畳み込むため、最後に処理された first の値が残る
    expect(folded.studyRowUpdatedAt).toBe('t1');
  });

  test('入力トークンを破壊しない（新オブジェクトを返す）', () => {
    const tokens = { studyRowUpdatedAt: 't-old', resultsRowUpdatedAt: { k: 'v' } };
    const write = makeWrite({ decision: makeDecision({ decidedAt: 't-new' }) });
    const folded = foldDecisionWriteTokens([write], tokens);
    expect(folded).not.toBe(tokens);
    expect(folded.resultsRowUpdatedAt).not.toBe(tokens.resultsRowUpdatedAt);
    expect(tokens).toEqual({ studyRowUpdatedAt: 't-old', resultsRowUpdatedAt: { k: 'v' } });
  });

  test('written が空なら入力トークンをそのまま返す（値は等価）', () => {
    const tokens = { studyRowUpdatedAt: 't-old', resultsRowUpdatedAt: {} };
    const folded = foldDecisionWriteTokens([], tokens);
    expect(folded).toEqual(tokens);
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
