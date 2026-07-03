import { extractDocxText } from '../../../../src/lib/docx/extractDocxText';
import mammoth from 'mammoth';

jest.mock('mammoth', () => ({
  extractRawText: jest.fn(),
}));

const extractRawTextMock = mammoth.extractRawText as jest.MockedFunction<
  typeof mammoth.extractRawText
>;

describe('extractDocxText', () => {
  test('mammoth.extractRawText に ArrayBuffer を渡し、value を返す', async () => {
    const buffer = new ArrayBuffer(8);
    extractRawTextMock.mockResolvedValue({ value: 'P: 成人肺炎', messages: [] });
    await expect(extractDocxText(buffer)).resolves.toBe('P: 成人肺炎');
    expect(extractRawTextMock).toHaveBeenCalledWith({ arrayBuffer: buffer });
  });
});
