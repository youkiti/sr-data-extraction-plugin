// インライン合成 fixture（1 文字 = 10pt の等幅ジオメトリ。test-strategy.md §2.2 の方針転換注記）
import type { DocumentRecord } from '../../../../src/domain/document';
import type { Evidence } from '../../../../src/domain/evidence';
import type { TextLayerPage } from '../../../../src/domain/textLayer';
import { cellKeyOf } from '../../../../src/features/verification/cellState';
import {
  bboxToDisplayRect,
  buildDocumentHighlights,
  buildDocumentTextMatches,
  buildStudyTextMatches,
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
    bboxPage: null,
    bbox: null,
    relocatedFrom: null,
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

  test('アンカリング経路の Evidence は source: "anchor"（§7.4 PR3 の回帰確認）', () => {
    const [highlight] = buildDocumentHighlights('doc-1', [makeEvidence({ page: 2 })], pages);
    expect(highlight?.source).toBe('anchor');
    expect(highlight?.status).toBe('exact');
    // アンカリング経路の矩形は 'user' 空間（省略時の既定。toDisplayRect で写像する前提）
    expect(highlight?.occurrences[0]?.space).toBeUndefined();
  });
});

describe('bboxToDisplayRect（§7.3 案(i): box → 表示フレーム矩形へ直接変換）', () => {
  test('0-1000 正規化の bbox をページ表示寸法（scale 1）へ写像する', () => {
    expect(
      bboxToDisplayRect(
        { ymin: 100, xmin: 200, ymax: 300, xmax: 400 },
        { width: 612, height: 792 },
      ),
    ).toEqual({ itemIndex: -1, x: 122.4, y: 79.2, width: 122.4, height: 158.4 });
  });

  test('全面 bbox（0,0,1000,1000）はページ全体を覆う矩形になる', () => {
    expect(
      bboxToDisplayRect({ ymin: 0, xmin: 0, ymax: 1000, xmax: 1000 }, { width: 600, height: 800 }),
    ).toEqual({ itemIndex: -1, x: 0, y: 0, width: 600, height: 800 });
  });
});

describe('buildDocumentHighlights の bbox 経路（pdf_native の box_2d。§7.4 PR3）', () => {
  const pages = [
    buildPage(1, 'in this trial mortality was 12 percent overall'),
    buildPage(2, 'we repeat: mortality was 12 percent in both arms'),
  ];

  test('bbox / bboxPage がある Evidence は bbox 経路（source/status/space/selectedIndex）で生成する', () => {
    const [highlight] = buildDocumentHighlights(
      'doc-1',
      [
        makeEvidence({
          anchorStatus: null,
          bboxPage: 1,
          bbox: { ymin: 100, xmin: 200, ymax: 300, xmax: 400 },
        }),
      ],
      pages,
    );
    expect(highlight).toEqual({
      evidenceId: 'ev-1',
      documentId: 'doc-1',
      cellKey: cellKeyOf('f-1', '-'),
      status: null,
      source: 'bbox',
      occurrences: [
        {
          page: 1,
          rects: [bboxToDisplayRect({ ymin: 100, xmin: 200, ymax: 300, xmax: 400 }, pages[0]!)],
          space: 'display',
        },
      ],
      selectedIndex: 0,
    });
  });

  test('bboxPage が指すページが pages に無ければ skip する', () => {
    expect(
      buildDocumentHighlights(
        'doc-1',
        [
          makeEvidence({
            anchorStatus: null,
            bboxPage: 5,
            bbox: { ymin: 100, xmin: 200, ymax: 300, xmax: 400 },
          }),
        ],
        pages,
      ),
    ).toEqual([]);
  });

  test('bbox 経路はテキスト層アンカリング（quote 再特定）より先に判定される', () => {
    // quote / anchorStatus がテキスト層アンカリング的に有効に見えても、bbox があれば bbox 経路を使う
    const [highlight] = buildDocumentHighlights(
      'doc-1',
      [
        makeEvidence({
          quote: 'mortality was 12 percent',
          anchorStatus: 'exact',
          page: 1,
          bboxPage: 2,
          bbox: { ymin: 0, xmin: 0, ymax: 100, xmax: 100 },
        }),
      ],
      pages,
    );
    expect(highlight?.source).toBe('bbox');
    expect(highlight?.occurrences).toHaveLength(1);
    expect(highlight?.occurrences[0]?.page).toBe(2);
  });
});

describe('buildDocumentTextMatches', () => {
  const pages = [
    buildPage(1, 'in this trial mortality was 12 percent overall'),
    buildPage(2, 'we repeat: mortality was 12 percent in both arms'),
  ];

  test('矩形なしで出現位置（page + range）だけを返す（rects 実体化前でも計算できる）', () => {
    const [match] = buildDocumentTextMatches('doc-1', [makeEvidence({ page: 2 })], pages);
    expect(match).toBeDefined();
    expect(match?.cellKey).toBe(cellKeyOf('f-1', '-'));
    expect(match?.documentId).toBe('doc-1');
    expect(match?.occurrences).toEqual([
      { page: 1, range: { start: 14, end: 38 } },
      { page: 2, range: { start: 11, end: 35 } },
    ]);
    expect(match?.selectedIndex).toBe(1);
  });

  test('quote なし / anchor_status なし / failed は含めない', () => {
    expect(
      buildDocumentTextMatches(
        'doc-1',
        [
          makeEvidence({ quote: null }),
          makeEvidence({ anchorStatus: null }),
          makeEvidence({ anchorStatus: 'failed' }),
        ],
        pages,
      ),
    ).toEqual([]);
  });

  test('どのページにも見つからない quote は含めない', () => {
    expect(
      buildDocumentTextMatches(
        'doc-1',
        [makeEvidence({ quote: 'not in the document at all' })],
        pages,
      ),
    ).toEqual([]);
  });

  test('正規化で空になる quote（空白のみ）は含めない', () => {
    expect(buildDocumentTextMatches('doc-1', [makeEvidence({ quote: '   ' })], pages)).toEqual([]);
  });

  test('fuzzy は anchor 済みページ内の最良一致 1 件だけを返す', () => {
    const [match] = buildDocumentTextMatches(
      'doc-1',
      [makeEvidence({ quote: 'mortality was 12 pircent', page: 2, anchorStatus: 'fuzzy' })],
      pages,
    );
    expect(match?.occurrences).toHaveLength(1);
    expect(match?.occurrences[0]?.page).toBe(2);
  });

  test('fuzzy でページ番号が見つからない場合は含めない', () => {
    expect(
      buildDocumentTextMatches('doc-1', [makeEvidence({ page: 9, anchorStatus: 'fuzzy' })], pages),
    ).toEqual([]);
  });

  test('fuzzy でページ本文が空（写像不能）の場合は含めない', () => {
    expect(
      buildDocumentTextMatches(
        'doc-1',
        [makeEvidence({ page: 1, anchorStatus: 'fuzzy' })],
        [buildPage(1, '')],
      ),
    ).toEqual([]);
  });

  test('同じ quote に対する出現件数・ページ順序は buildDocumentHighlights（rects 実体化）と一致する', () => {
    const evidence = [makeEvidence({ page: 2 })];
    const matches = buildDocumentTextMatches('doc-1', evidence, pages);
    const highlights = buildDocumentHighlights('doc-1', evidence, pages);
    expect(matches[0]?.occurrences.map((o) => o.page)).toEqual(
      highlights[0]?.occurrences.map((o) => o.page),
    );
    expect(matches[0]?.selectedIndex).toBe(highlights[0]?.selectedIndex);
  });
});

describe('buildStudyTextMatches', () => {
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
      extractedPages: [{ page: 1, text }],
      extractedTextError: null,
    };
  }

  test('文書ごとに自 document の Evidence だけをその文書の extracted_texts へアンカリングする', () => {
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
    const matches = buildStudyTextMatches(documents, evidence);
    expect(matches.map((m) => m.documentId)).toEqual(['doc-1', 'doc-2']);
    expect(matches.every((m) => m.occurrences.length > 0)).toBe(true);
  });

  test('別文書由来の Evidence は当該文書のテキストでアンカリングしない', () => {
    const documents = [makeView('doc-1', 'nothing relevant here')];
    // documentId が documents に無い Evidence は対象文書がないため無視される
    const evidence = [makeEvidence({ documentId: 'doc-2', quote: 'mortality was 12 percent' })];
    expect(buildStudyTextMatches(documents, evidence)).toEqual([]);
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
