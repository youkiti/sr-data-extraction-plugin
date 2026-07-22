// studySelection（抽出の対象選択モデル）の単体テスト
import type { DocumentRecord } from '../../../../src/domain/document';
import type { StudyRecord } from '../../../../src/domain/study';
import {
  areAllUnextractedStudiesSelected,
  buildExtractionCandidates,
  buildStudySelection,
  documentsForStudies,
  selectableUnextractedStudyIds,
} from '../../../../src/features/documents/studySelection';

function makeDocument(overrides: Partial<DocumentRecord> & { documentId: string }): DocumentRecord {
  return {
    studyId: 's1',
    documentRole: 'article',
    driveFileId: 'drive-1',
    sourceFileId: 'src-1',
    filename: `${overrides.documentId}.pdf`,
    pmid: null,
    doi: null,
    textRef: 'ref',
    textStatus: 'ok',
    pageCount: 1,
    charCount: 100,
    importedAt: 't0',
    importedBy: 'me',
    note: null,
    excluded: false,
    exclusionReason: null,
    exclusionNote: null,
    excludedAt: null,
    ...overrides,
  };
}

function makeStudy(studyId: string): StudyRecord {
  return {
    studyId,
    studyLabel: `label-${studyId}`,
    registrationId: null,
    createdAt: 't0',
    createdBy: 'me',
    note: null,
  };
}

describe('buildStudySelection', () => {
  it('アクティブ study を作成順で返し、配下文書を role 固定順 → 取り込み順で並べる', () => {
    const documents = [
      makeDocument({ documentId: 'reg', studyId: 's1', documentRole: 'registration' }),
      makeDocument({ documentId: 'art', studyId: 's1', documentRole: 'article' }),
      makeDocument({ documentId: 'b', studyId: 's2', documentRole: 'article' }),
    ];
    const studies = [makeStudy('s1'), makeStudy('s2')];
    const selection = buildStudySelection(studies, documents);
    expect(selection.map((item) => item.study.studyId)).toEqual(['s1', 's2']);
    // s1 内は article → registration の順（role 固定順）
    expect(selection[0]?.documents.map((d) => d.documentId)).toEqual(['art', 'reg']);
    expect(selection[0]?.hasTextLayer).toBe(true);
  });

  it('参照 0 の study 行（非アクティブ）は除外する', () => {
    const documents = [makeDocument({ documentId: 'a', studyId: 's1' })];
    const studies = [makeStudy('s1'), makeStudy('s2-orphan')];
    const selection = buildStudySelection(studies, documents);
    expect(selection.map((item) => item.study.studyId)).toEqual(['s1']);
  });

  it('全文書が no_text_layer の study は hasTextLayer=false', () => {
    const documents = [
      makeDocument({ documentId: 'a', studyId: 's1', textStatus: 'no_text_layer' }),
      makeDocument({ documentId: 'b', studyId: 's1', textStatus: 'no_text_layer' }),
    ];
    const selection = buildStudySelection([makeStudy('s1')], documents);
    expect(selection[0]?.hasTextLayer).toBe(false);
  });

  it('1 件でもテキスト層があれば hasTextLayer=true', () => {
    const documents = [
      makeDocument({ documentId: 'a', studyId: 's1', textStatus: 'no_text_layer' }),
      makeDocument({ documentId: 'b', studyId: 's1', textStatus: 'ok' }),
    ];
    const selection = buildStudySelection([makeStudy('s1')], documents);
    expect(selection[0]?.hasTextLayer).toBe(true);
  });

  it('DOCUMENT_ROLE_ORDER に無いロールは末尾へ並べる（未知が先・防御的フォールバック）', () => {
    const documents = [
      makeDocument({
        documentId: 'weird',
        studyId: 's1',
        documentRole: 'unknown' as DocumentRecord['documentRole'],
      }),
      makeDocument({ documentId: 'art', studyId: 's1', documentRole: 'article' }),
    ];
    const selection = buildStudySelection([makeStudy('s1')], documents);
    expect(selection[0]?.documents.map((d) => d.documentId)).toEqual(['art', 'weird']);
  });

  it('未知ロールが複数あっても末尾へ取り込み順で並べる（比較の全方向を網羅）', () => {
    const documents = [
      makeDocument({ documentId: 'art', studyId: 's1', documentRole: 'article' }),
      makeDocument({
        documentId: 'wa',
        studyId: 's1',
        documentRole: 'weird-a' as DocumentRecord['documentRole'],
      }),
      makeDocument({
        documentId: 'wb',
        studyId: 's1',
        documentRole: 'weird-b' as DocumentRecord['documentRole'],
      }),
    ];
    const selection = buildStudySelection([makeStudy('s1')], documents);
    expect(selection[0]?.documents.map((d) => d.documentId)).toEqual(['art', 'wa', 'wb']);
  });
});

describe('documentsForStudies', () => {
  it('選択 study の配下文書だけを作成順 → role 順で返す', () => {
    const documents = [
      makeDocument({ documentId: 'a1', studyId: 's1' }),
      makeDocument({ documentId: 'b1', studyId: 's2' }),
      makeDocument({ documentId: 'c1', studyId: 's3' }),
    ];
    const selection = buildStudySelection([makeStudy('s1'), makeStudy('s2'), makeStudy('s3')], documents);
    const picked = documentsForStudies(selection, ['s1', 's3']);
    expect(picked.map((d) => d.documentId)).toEqual(['a1', 'c1']);
  });

  it('選択が空なら空配列', () => {
    const documents = [makeDocument({ documentId: 'a', studyId: 's1' })];
    const selection = buildStudySelection([makeStudy('s1')], documents);
    expect(documentsForStudies(selection, [])).toEqual([]);
  });
});

describe('buildExtractionCandidates（issue #181: 除外文書を除いた抽出候補）', () => {
  it('除外なしなら buildStudySelection と同じ全件を返す', () => {
    const documents = [
      makeDocument({ documentId: 'a', studyId: 's1' }),
      makeDocument({ documentId: 'b', studyId: 's2' }),
    ];
    const studies = [makeStudy('s1'), makeStudy('s2')];
    expect(buildExtractionCandidates(studies, documents)).toEqual(
      buildStudySelection(studies, documents),
    );
  });

  it('全文書が除外された study は候補から外れる', () => {
    const documents = [
      makeDocument({ documentId: 'a', studyId: 's1', excluded: true }),
      makeDocument({ documentId: 'b', studyId: 's1', documentRole: 'registration', excluded: true }),
      makeDocument({ documentId: 'c', studyId: 's2' }),
    ];
    const studies = [makeStudy('s1'), makeStudy('s2')];
    const candidates = buildExtractionCandidates(studies, documents);
    expect(candidates.map((item) => item.study.studyId)).toEqual(['s2']);
  });

  it('一部除外の study は残り文書で候補になる', () => {
    const documents = [
      makeDocument({ documentId: 'a', studyId: 's1', documentRole: 'article', excluded: true }),
      makeDocument({ documentId: 'b', studyId: 's1', documentRole: 'registration', excluded: false }),
    ];
    const studies = [makeStudy('s1')];
    const candidates = buildExtractionCandidates(studies, documents);
    expect(candidates).toHaveLength(1);
    expect(candidates[0]?.documents.map((d) => d.documentId)).toEqual(['b']);
  });
});

// issue #180: 全選択トグルの対象判定
describe('selectableUnextractedStudyIds', () => {
  it('抽出済みを除外して選択リストの並び順で返す', () => {
    const documents = [
      makeDocument({ documentId: 'a', studyId: 's1' }),
      makeDocument({ documentId: 'b', studyId: 's2' }),
      makeDocument({ documentId: 'c', studyId: 's3' }),
    ];
    const selection = buildStudySelection(
      [makeStudy('s1'), makeStudy('s2'), makeStudy('s3')],
      documents,
    );
    expect(selectableUnextractedStudyIds(selection, ['s2'])).toEqual(['s1', 's3']);
  });

  it('抽出済み配列が空なら全件を返す', () => {
    const documents = [makeDocument({ documentId: 'a', studyId: 's1' })];
    const selection = buildStudySelection([makeStudy('s1')], documents);
    expect(selectableUnextractedStudyIds(selection, [])).toEqual(['s1']);
  });

  it('全部抽出済みなら空配列を返す', () => {
    const documents = [
      makeDocument({ documentId: 'a', studyId: 's1' }),
      makeDocument({ documentId: 'b', studyId: 's2' }),
    ];
    const selection = buildStudySelection([makeStudy('s1'), makeStudy('s2')], documents);
    expect(selectableUnextractedStudyIds(selection, ['s1', 's2'])).toEqual([]);
  });
});

describe('areAllUnextractedStudiesSelected', () => {
  it('未抽出すべてが選択済みなら true', () => {
    expect(areAllUnextractedStudiesSelected(['s1', 's2'], ['s1', 's2', 's3'])).toBe(true);
  });

  it('一部が未選択なら false', () => {
    expect(areAllUnextractedStudiesSelected(['s1', 's2'], ['s1'])).toBe(false);
  });

  it('未抽出が 0 件なら true（every の性質上）', () => {
    expect(areAllUnextractedStudiesSelected([], [])).toBe(true);
  });
});
