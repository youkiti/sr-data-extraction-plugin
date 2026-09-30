import type { AnchoredCitation, AskPaperTurn } from '../../../src/features/verification/askPaper';
import type { AskPaperParams } from '../../../src/app/services/askPaperService';
import type { TextLayerPage } from '../../../src/domain/textLayer';

export function makeCitation(overrides: Partial<AnchoredCitation> = {}): AnchoredCitation {
  return {
    documentIndex: 1,
    documentId: 'doc-1',
    quote: '対象者は120人であった。',
    page: 1,
    anchorStatus: 'exact',
    anchoredPage: 1,
    highlightable: true,
    ...overrides,
  };
}
export function makeAskTurn(overrides: Partial<AskPaperTurn> = {}): AskPaperTurn {
  return {
    question: '何人？',
    answer: '120人',
    found: true,
    citations: [makeCitation()],
    anchoredCount: 1,
    ...overrides,
  };
}
export function makeAskParams(): AskPaperParams & { studyId: string } {
  return {
    spreadsheetId: 'sheet-1',
    studyId: 'study-1',
    question: '何人？',
    history: [],
    documents: [
      {
        documentId: 'doc-1',
        role: 'article',
        filename: '論文.pdf',
        pages: [{ page: 1, text: '対象者は120人であった。' }],
      },
    ],
    fields: [
      {
        schemaVersion: 1,
        fieldId: 'f1',
        fieldIndex: 1,
        section: 'population',
        fieldName: 'sample_size',
        fieldLabel: '人数',
        entityLevel: 'study',
        dataType: 'integer',
        unit: null,
        allowedValues: null,
        required: true,
        extractionInstruction: '人数を報告',
        example: null,
        aiGenerated: true,
        note: '秘密メモ',
        maxQuotes: null,
      },
    ],
  };
}
export function makeAskPage(): TextLayerPage {
  const text = '対象者は120人であった。';
  return {
    page: 1,
    text,
    width: 612,
    height: 792,
    rotation: 0,
    items: [
      {
        charStart: 0,
        str: text,
        transform: [1, 0, 0, 1, 0, 700],
        width: 200,
        height: 10,
        hasEOL: false,
      },
    ],
  };
}
