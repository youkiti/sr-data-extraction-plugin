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

describe('遅延ロード', () => {
  test('利用前にはロードせず、同時呼び出しと次回呼び出しでロード結果を共有する', async () => {
    jest.resetModules();
    const factory = jest.fn(() => ({
      extractRawText: jest.fn().mockResolvedValue({ value: '本文', messages: [] }),
    }));
    jest.doMock('mammoth', factory);
    const wrapper = await import('../../../../src/lib/docx/extractDocxText');
    expect(factory).not.toHaveBeenCalled();
    await Promise.all([
      wrapper.extractDocxText(new ArrayBuffer(1)),
      wrapper.extractDocxText(new ArrayBuffer(2)),
    ]);
    await wrapper.extractDocxText(new ArrayBuffer(3));
    expect(factory).toHaveBeenCalledTimes(1);
  });

  test('チャンク取得失敗を呼び出し元へ伝え、次回は再試行する', async () => {
    jest.resetModules();
    const factory = jest.fn(() => ({
      extractRawText: jest.fn().mockResolvedValue({ value: '本文', messages: [] }),
    }));
    factory.mockImplementationOnce(() => {
      throw new Error('chunk load failed');
    });
    jest.doMock('mammoth', factory);
    const wrapper = await import('../../../../src/lib/docx/extractDocxText');
    await expect(wrapper.extractDocxText(new ArrayBuffer(1))).rejects.toThrow('chunk load failed');
    await expect(wrapper.extractDocxText(new ArrayBuffer(2))).resolves.toEqual('本文');
    expect(factory).toHaveBeenCalledTimes(2);
  });
});
