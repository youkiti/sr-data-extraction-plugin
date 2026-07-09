// インライン合成 fixture（1 文字 = 10pt の等幅ジオメトリ。test-strategy.md §2.2 の方針転換注記）
import type { DocumentRecord } from '../../../../src/domain/document';
import type { Evidence } from '../../../../src/domain/evidence';
import type { TextLayerPage } from '../../../../src/domain/textLayer';
import { cellKeyOf } from '../../../../src/features/verification/cellState';
import {
  buildDocumentHighlights,
  buildStudyHighlights,
  searchPages,
} from '../../../../src/features/verification/highlights';
import type { VerificationDocumentView } from '../../../../src/features/verification/types';

/** 1 item = 1 ページ全文の等幅ページ（原点 (0, 700)、1 文字 10pt） */
function buildPage(page: number, text: string): TextLayerPage {
  return {
    page,
    text,
    width: 612,
    height: 792,
    rotation: 0,
    items: [
      {
        charStart: 0,
        str: text,
        transform: [1, 0, 0, 1, 0, 700],
        width: text.length * 10,
        height: 10,
        hasEOL: false,
      },
    ],
  };
}

function makeEvidence(overrides: Partial<Evidence> = {}): Evidence {
  return {
    evidenceId: 'ev-1',
    runId: 'run-1',
    studyId: 'study-1',
    documentId: 'doc-1',
    fieldId: 'f-1',
    entityKey: '-',
    value: '12',
    notReported: false,
    quote: 'mortality was 12 percent',
    page: 1,
    confidence: 'high',
    anchorStatus: 'exact',
    ...overrides,
  };
}

describe('buildDocumentHighlights', () => {
  const pages = [
    buildPage(1, 'in this trial mortality was 12 percent overall'),
    buildPage(2, 'we repeat: mortality was 12 percent in both arms'),
  ];

  test('exact は全ページの全出現を列挙し、ai_page に最も近い出現を既定にする', () => {
    const [highlight] = buildDocumentHighlights('doc-1', [makeEvidence({ page: 2 })], pages);
    expect(highlight).toBeDefined();
    expect(highlight?.cellKey).toBe(cellKeyOf('f-1', '-'));
    expect(highlight?.documentId).toBe('doc-1');
    expect(highlight?.occurrences.map((o) => o.page)).toEqual([1, 2]);
    expect(highlight?.selectedIndex).toBe(1);
  });

  test('ai_page が null なら先頭の出現を既定にする', () => {
    const [highlight] = buildDocumentHighlights('doc-1', [makeEvidence({ page: null })], pages);
    expect(highlight?.selectedIndex).toBe(0);
  });

  test('ai_page が 1 ページ目なら先頭の出現が最近傍として残る', () => {
    const [highlight] = buildDocumentHighlights('doc-1', [makeEvidence({ page: 1 })], pages);
    expect(highlight?.selectedIndex).toBe(0);
  });

  test('矩形は等幅ジオメトリどおりに写像される', () => {
    const [highlight] = buildDocumentHighlights('doc-1', 
      [makeEvidence({ quote: 'in this trial', page: 1 })],
      pages,
    );
    expect(highlight?.occurrences[0]?.rects).toEqual([
      { itemIndex: 0, x: 0, y: 700, width: 130, height: 10 },
    ]);
  });

  test('quote なし / anchor_status なし / failed は含めない', () => {
    expect(
      buildDocumentHighlights('doc-1', 
        [
          makeEvidence({ quote: null }),
          makeEvidence({ anchorStatus: null }),
          makeEvidence({ anchorStatus: 'failed' }),
        ],
        pages,
      ),
    ).toEqual([]);
  });

  test('正規化で空になる quote（空白のみ）は含めない', () => {
    expect(buildDocumentHighlights('doc-1', [makeEvidence({ quote: '   ' })], pages)).toEqual([]);
  });

  test('どのページにも見つからない quote は含めない', () => {
    expect(
      buildDocumentHighlights('doc-1', [makeEvidence({ quote: 'not in the document at all' })], pages),
    ).toEqual([]);
  });

  test('fuzzy は anchor 済みページ内の最良一致 1 件だけを返す', () => {
    const [highlight] = buildDocumentHighlights('doc-1', 
      [makeEvidence({ quote: 'mortality was 12 pircent', page: 2, anchorStatus: 'fuzzy' })],
      pages,
    );
    expect(highlight?.occurrences).toHaveLength(1);
    expect(highlight?.occurrences[0]?.page).toBe(2);
    expect(highlight?.selectedIndex).toBe(0);
  });

  test('fuzzy でページ番号が見つからない場合は含めない', () => {
    expect(
      buildDocumentHighlights('doc-1', [makeEvidence({ page: 9, anchorStatus: 'fuzzy' })], pages),
    ).toEqual([]);
  });

  test('fuzzy でページ本文が空（写像不能）の場合は含めない', () => {
    expect(
      buildDocumentHighlights('doc-1', 
        [makeEvidence({ page: 1, anchorStatus: 'fuzzy' })],
        [buildPage(1, '')],
      ),
    ).toEqual([]);
  });

  test('normalized はハイフネーションを跨いで一致する（正規化の共有）', () => {
    const hyphenPages = [buildPage(1, 'the exam-\nple text')];
    const [highlight] = buildDocumentHighlights('doc-1', 
      [makeEvidence({ quote: 'example text', page: 1, anchorStatus: 'normalized' })],
      hyphenPages,
    );
    expect(highlight?.occurrences).toHaveLength(1);
  });
});

describe('buildStudyHighlights', () => {
  function makeDocument(documentId: string): DocumentRecord {
    return {
      documentId,
      studyId: 'study-1',
      documentRole: 'article',
      driveFileId: `drive-${documentId}`,
      sourceFileId: `src-${documentId}`,
      filename: `${documentId}.pdf`,
      pmid: null,
      doi: null,
      textRef: null,
      textStatus: 'ok',
      pageCount: 1,
      charCount: 100,
      importedAt: '2026-07-09T00:00:00Z',
      importedBy: 'me@example.com',
      note: null,
    };
  }

  function makeView(documentId: string, text: string): VerificationDocumentView {
    return {
      document: makeDocument(documentId),
      pdf: null,
      pdfError: null,
      textPages: [buildPage(1, text)],
    };
  }

  test('文書ごとに自 document の Evidence だけをその文書のテキストへアンカリングする', () => {
    const documents = [
      makeView('doc-1', 'mortality was 12 percent in the article'),
      makeView('doc-2', 'registration says mortality was 12 percent too'),
    ];
    const evidence = [
      makeEvidence({ evidenceId: 'ev-a', documentId: 'doc-1', quote: 'mortality was 12 percent' }),
      makeEvidence({
        evidenceId: 'ev-b',
        documentId: 'doc-2',
        fieldId: 'f-2',
        quote: 'mortality was 12 percent',
      }),
    ];
    const highlights = buildStudyHighlights(documents, evidence);
    expect(highlights.map((h) => h.documentId)).toEqual(['doc-1', 'doc-2']);
    expect(highlights.every((h) => h.occurrences.length > 0)).toBe(true);
  });

  test('別文書由来の Evidence は当該文書のテキストでアンカリングしない', () => {
    const documents = [makeView('doc-1', 'nothing relevant here')];
    // documentId が documents に無い Evidence は対象文書がないため無視される
    const evidence = [makeEvidence({ documentId: 'doc-2', quote: 'mortality was 12 percent' })];
    expect(buildStudyHighlights(documents, evidence)).toEqual([]);
  });
});

describe('searchPages', () => {
  const pages = [buildPage(1, 'alpha beta alpha'), buildPage(2, 'gamma alpha')];

  test('全ページの全出現をページ順に返す', () => {
    const hits = searchPages('alpha', pages);
    expect(hits.map((hit) => hit.page)).toEqual([1, 1, 2]);
  });

  test('正規化してから照合する（大文字小文字は区別のまま、空白は圧縮）', () => {
    expect(searchPages('beta   alpha', pages)).toHaveLength(1);
  });

  test('空・空白のみのクエリは空配列', () => {
    expect(searchPages('', pages)).toEqual([]);
    expect(searchPages('   ', pages)).toEqual([]);
  });
});
