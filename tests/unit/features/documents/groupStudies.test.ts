import type { DocumentRecord } from '../../../../src/domain/document';
import type { StudyRecord } from '../../../../src/domain/study';
import {
  findMergeCandidates,
  hasExtractedData,
  ignoredCandidateKey,
  mergeStudies,
  separateDocuments,
} from '../../../../src/features/documents/groupStudies';

function makeStudy(overrides: Partial<StudyRecord> = {}): StudyRecord {
  return {
    studyId: 'study-1',
    studyLabel: 'Smith 2020',
    registrationId: null,
    createdAt: 't1',
    createdBy: 'me@example.com',
    note: null,
    ...overrides,
  };
}

function makeDoc(overrides: Partial<DocumentRecord> = {}): DocumentRecord {
  return {
    documentId: 'doc-1',
    studyId: 'study-1',
    documentRole: 'article',
    driveFileId: 'drive-1',
    sourceFileId: 'src-1',
    filename: 'a.pdf',
    pmid: null,
    doi: null,
    textRef: null,
    textStatus: 'ok',
    pageCount: null,
    charCount: null,
    importedAt: 't1',
    importedBy: 'me@example.com',
    note: null,
    excluded: false,
    exclusionReason: null,
    exclusionNote: null,
    excludedAt: null,
    ...overrides,
  };
}

describe('mergeStudies', () => {
  const studies = [
    makeStudy({ studyId: 'study-1', studyLabel: 'Smith 2020', registrationId: 'NCT01234567' }),
    makeStudy({ studyId: 'study-2', studyLabel: 'Smith 2020 reg' }),
  ];
  const documents = [
    makeDoc({ documentId: 'd1', studyId: 'study-1' }),
    makeDoc({ documentId: 'd2', studyId: 'study-2' }),
    makeDoc({ documentId: 'd3', studyId: 'other' }),
  ];

  test('既定は最初に取り込まれた study の値を引き継ぎ、全文書を新 study へ付け替える', () => {
    const result = mergeStudies({
      studies,
      documents,
      targetStudyIds: ['study-2', 'study-1'], // 選択順が作成順と逆でも作成順で解決
      createdBy: 'me@example.com',
      createdAt: 't2',
      newStudyId: 'study-new',
    });
    expect(result.newStudy).toEqual({
      studyId: 'study-new',
      studyLabel: 'Smith 2020', // study-1（作成順先頭）の値
      registrationId: 'NCT01234567',
      createdAt: 't2',
      createdBy: 'me@example.com',
      note: null,
    });
    expect(result.reassignments).toEqual([
      { documentId: 'd1', studyId: 'study-new' },
      { documentId: 'd2', studyId: 'study-new' },
    ]);
    expect(result.supersededStudyIds).toEqual(['study-1', 'study-2']);
  });

  test('label / registration_id / note の明示指定を優先する', () => {
    const result = mergeStudies({
      studies,
      documents,
      targetStudyIds: ['study-1', 'study-2'],
      label: '統合後ラベル',
      registrationId: 'ISRCTN12345678',
      note: 'merged',
      createdBy: 'me@example.com',
      createdAt: 't2',
      newStudyId: 'study-new',
    });
    expect(result.newStudy.studyLabel).toBe('統合後ラベル');
    expect(result.newStudy.registrationId).toBe('ISRCTN12345678');
    expect(result.newStudy.note).toBe('merged');
  });

  test('registration_id に null を明示指定できる', () => {
    const result = mergeStudies({
      studies,
      documents,
      targetStudyIds: ['study-1', 'study-2'],
      registrationId: null,
      createdBy: 'me@example.com',
      createdAt: 't2',
      newStudyId: 'study-new',
    });
    expect(result.newStudy.registrationId).toBeNull();
  });

  test('2 件未満は throw / 未知の study_id は throw', () => {
    expect(() =>
      mergeStudies({
        studies,
        documents,
        targetStudyIds: ['study-1'],
        createdBy: 'x',
        createdAt: 't',
        newStudyId: 'n',
      }),
    ).toThrow('2 件以上の study が必要です');
    expect(() =>
      mergeStudies({
        studies,
        documents,
        targetStudyIds: ['study-1', 'unknown'],
        createdBy: 'x',
        createdAt: 't',
        newStudyId: 'n',
      }),
    ).toThrow('未知の study_id が含まれています');
  });
});

describe('separateDocuments', () => {
  const documents = [
    makeDoc({ documentId: 'd1', studyId: 'study-1' }),
    makeDoc({ documentId: 'd2', studyId: 'study-1' }),
  ];

  test('指定文書を新 study へ付け替える', () => {
    const result = separateDocuments({
      documents,
      documentIds: ['d2'],
      label: 'Split study',
      registrationId: 'NCT99999999',
      note: 'split',
      createdBy: 'me@example.com',
      createdAt: 't2',
      newStudyId: 'study-new',
    });
    expect(result.newStudy).toEqual({
      studyId: 'study-new',
      studyLabel: 'Split study',
      registrationId: 'NCT99999999',
      createdAt: 't2',
      createdBy: 'me@example.com',
      note: 'split',
    });
    expect(result.reassignments).toEqual([{ documentId: 'd2', studyId: 'study-new' }]);
    expect(result.supersededStudyIds).toEqual(['study-1']);
  });

  test('registration_id / note 未指定は null になる', () => {
    const result = separateDocuments({
      documents,
      documentIds: ['d1'],
      label: 'X',
      createdBy: 'x',
      createdAt: 't',
      newStudyId: 'n',
    });
    expect(result.newStudy.registrationId).toBeNull();
    expect(result.newStudy.note).toBeNull();
  });

  test('空指定は throw / 未知の document_id は throw', () => {
    expect(() =>
      separateDocuments({
        documents,
        documentIds: [],
        label: 'X',
        createdBy: 'x',
        createdAt: 't',
        newStudyId: 'n',
      }),
    ).toThrow('1 件以上指定してください');
    expect(() =>
      separateDocuments({
        documents,
        documentIds: ['unknown'],
        label: 'X',
        createdBy: 'x',
        createdAt: 't',
        newStudyId: 'n',
      }),
    ).toThrow('未知の document_id が含まれています');
  });
});

describe('hasExtractedData', () => {
  test('いずれかが抽出済み study 集合に含まれれば true', () => {
    const extracted = new Set(['study-2']);
    expect(hasExtractedData(['study-1', 'study-2'], extracted)).toBe(true);
    expect(hasExtractedData(['study-1'], extracted)).toBe(false);
  });
});

describe('findMergeCandidates', () => {
  test('同一 registration_id のアクティブ study が 2 件以上のグループを返す（null / 空 / 単独は除外）', () => {
    const active = [
      makeStudy({ studyId: 's1', registrationId: 'NCT01234567' }),
      makeStudy({ studyId: 's2', registrationId: 'NCT01234567' }),
      makeStudy({ studyId: 's3', registrationId: 'NCT01234567' }),
      makeStudy({ studyId: 's4', registrationId: 'ISRCTN1' }), // 単独 → 除外
      makeStudy({ studyId: 's5', registrationId: null }), // null → 除外
      makeStudy({ studyId: 's6', registrationId: '' }), // 空 → 除外
    ];
    expect(findMergeCandidates(active)).toEqual([
      { registrationId: 'NCT01234567', studyIds: ['s1', 's2', 's3'] },
    ]);
  });

  test('候補が無ければ空配列', () => {
    expect(findMergeCandidates([makeStudy({ registrationId: 'NCT1' })])).toEqual([]);
  });
});

describe('ignoredCandidateKey', () => {
  test('study_id をソートして向き非依存のキーにする', () => {
    expect(ignoredCandidateKey(['s2', 's1'])).toBe('s1|s2');
    expect(ignoredCandidateKey(['s1', 's2'])).toBe('s1|s2');
  });
});
