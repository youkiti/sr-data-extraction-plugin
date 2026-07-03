import {
  MIN_SUBSTANTIVE_PAGE_CHARS,
} from '../../../../src/features/documents/detectTextStatus';
import { PAGE_SEPARATOR } from '../../../../src/features/documents/extractedText';
import {
  extractTextLayer,
  type DisposablePdfDocument,
} from '../../../../src/features/documents/extractTextLayer';

const SUBSTANTIVE = 'a'.repeat(MIN_SUBSTANTIVE_PAGE_CHARS);

/** ページ別テキストだけ持つ fake PDF ドキュメント */
function makeDoc(pageTexts: string[]): { doc: DisposablePdfDocument; destroy: jest.Mock } {
  const destroy = jest.fn();
  return {
    destroy,
    doc: {
      numPages: pageTexts.length,
      getPage: async (n: number) => ({
        getViewport: () => ({ width: 612, height: 792 }),
        getTextContent: async () => ({ items: [{ str: pageTexts[n - 1] as string }] }),
        cleanup: jest.fn(),
      }),
      destroy,
    },
  };
}

describe('extractTextLayer', () => {
  test('テキスト層抽出 → status 判定 → extracted_texts 本文の組み立てまで行い、destroy する', async () => {
    const { doc, destroy } = makeDoc([SUBSTANTIVE, `${SUBSTANTIVE}!`]);
    const result = await extractTextLayer(new ArrayBuffer(1), { loadPdf: async () => doc });
    expect(result.textStatus).toBe('ok');
    expect(result.pageCount).toBe(2);
    expect(result.charCount).toBe(SUBSTANTIVE.length * 2 + 1);
    expect(result.pages.map((page) => page.page)).toEqual([1, 2]);
    expect(result.serializedText).toBe(`${SUBSTANTIVE}${PAGE_SEPARATOR}${SUBSTANTIVE}!`);
    expect(destroy).toHaveBeenCalledTimes(1);
  });

  test('no_text_layer（全ページ実質テキストなし）は本文を作らない（※Q7）', async () => {
    const { doc } = makeDoc(['p. 1', '']);
    const result = await extractTextLayer(new ArrayBuffer(1), { loadPdf: async () => doc });
    expect(result.textStatus).toBe('no_text_layer');
    expect(result.serializedText).toBeNull();
  });

  test('抽出が失敗しても destroy は必ず呼ぶ', async () => {
    const destroy = jest.fn();
    const broken: DisposablePdfDocument = {
      numPages: 1,
      getPage: async () => {
        throw new Error('corrupt page');
      },
      destroy,
    };
    await expect(
      extractTextLayer(new ArrayBuffer(1), { loadPdf: async () => broken }),
    ).rejects.toThrow('corrupt page');
    expect(destroy).toHaveBeenCalledTimes(1);
  });
});
