import { parseDocxFile } from '../../../../src/features/protocol/parseDocx';

describe('parseDocxFile', () => {
  const buffer = new ArrayBuffer(8);

  test('.docx ファイルを extractor でテキスト化し、本文とプレビューを返す', async () => {
    const extract = jest.fn(async () => 'P: 成人肺炎\nI: 抗菌薬 A');
    const parsed = await parseDocxFile(
      { name: 'protocol.docx', arrayBuffer: async () => buffer },
      extract,
    );
    expect(extract).toHaveBeenCalledWith(buffer);
    expect(parsed).toEqual({
      sourceType: 'docx',
      sourceFilename: 'protocol.docx',
      plainText: 'P: 成人肺炎\nI: 抗菌薬 A',
      preview: 'P: 成人肺炎 I: 抗菌薬 A',
    });
  });

  test('大文字拡張子（.DOCX）も受け付ける', async () => {
    await expect(
      parseDocxFile({ name: 'P.DOCX', arrayBuffer: async () => buffer }, async () => 'body'),
    ).resolves.toMatchObject({ sourceType: 'docx', sourceFilename: 'P.DOCX' });
  });

  test('.docx 以外の拡張子は throw する', async () => {
    const extract = jest.fn(async () => '');
    await expect(
      parseDocxFile({ name: 'protocol.md', arrayBuffer: async () => buffer }, extract),
    ).rejects.toThrow('.docx ファイルの拡張子ではありません: protocol.md');
    expect(extract).not.toHaveBeenCalled();
  });
});
