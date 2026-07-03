import {
  extractTextLayerPages,
  type PdfDocumentLike,
  type PdfPageLike,
} from '../../../../src/lib/pdf/textLayer';

interface FakeItem {
  str?: string;
  transform?: number[];
  width?: number;
  height?: number;
  hasEOL?: boolean;
}

function makeDoc(pagesItems: FakeItem[][]): { doc: PdfDocumentLike; cleanups: jest.Mock[] } {
  const cleanups: jest.Mock[] = [];
  const pages: PdfPageLike[] = pagesItems.map((items) => {
    const cleanup = jest.fn();
    cleanups.push(cleanup);
    return {
      getViewport: () => ({ width: 612, height: 792 }),
      getTextContent: async () => ({ items }),
      cleanup,
    };
  });
  return {
    doc: {
      numPages: pages.length,
      getPage: async (n: number) => pages[n - 1] as PdfPageLike,
    },
    cleanups,
  };
}

describe('extractTextLayerPages', () => {
  test('item を読み順で連結し、hasEOL 位置に \\n を挿入、charStart を記録する', async () => {
    const { doc } = makeDoc([
      [
        { str: 'A total of ', transform: [1, 0, 0, 1, 50, 700], width: 60, height: 10 },
        { str: '120 patients', transform: [1, 0, 0, 1, 110, 700], width: 70, height: 10, hasEOL: true },
        { str: 'were enrolled.', transform: [1, 0, 0, 1, 50, 688], width: 80, height: 10 },
      ],
    ]);
    const pages = await extractTextLayerPages(doc);
    expect(pages).toHaveLength(1);
    expect(pages[0]?.text).toBe('A total of 120 patients\nwere enrolled.');
    expect(pages[0]?.items.map((item) => item.charStart)).toEqual([0, 11, 24]);
    expect(pages[0]?.width).toBe(612);
    expect(pages[0]?.height).toBe(792);
  });

  test('str を持たない item（TextMarkedContent）はスキップし、欠落プロパティは既定値で埋める', async () => {
    const { doc } = makeDoc([[{ str: 'x' }, { type: 'beginMarkedContent' } as FakeItem, { str: 'y' }]]);
    const pages = await extractTextLayerPages(doc);
    expect(pages[0]?.text).toBe('xy');
    expect(pages[0]?.items).toEqual([
      {
        charStart: 0,
        str: 'x',
        transform: [1, 0, 0, 1, 0, 0],
        width: 0,
        height: 0,
        hasEOL: false,
      },
      expect.objectContaining({ charStart: 1, str: 'y' }),
    ]);
  });

  test('複数ページを 1-indexed で返し、各ページの cleanup を呼ぶ', async () => {
    const { doc, cleanups } = makeDoc([[{ str: 'page one text' }], []]);
    const pages = await extractTextLayerPages(doc);
    expect(pages.map((p) => p.page)).toEqual([1, 2]);
    expect(pages[1]?.text).toBe('');
    for (const cleanup of cleanups) {
      expect(cleanup).toHaveBeenCalledTimes(1);
    }
  });
});
