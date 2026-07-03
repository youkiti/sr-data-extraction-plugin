import { parseMarkdownFile } from '../../../../src/features/protocol/parseMarkdown';

describe('parseMarkdownFile', () => {
  test('.md ファイルを読み込み、本文とプレビューを返す', async () => {
    const parsed = await parseMarkdownFile({
      name: 'protocol.md',
      text: async () => '# プロトコル\n\nP: 成人肺炎',
    });
    expect(parsed).toEqual({
      sourceType: 'markdown',
      sourceFilename: 'protocol.md',
      plainText: '# プロトコル\n\nP: 成人肺炎',
      preview: '# プロトコル P: 成人肺炎',
    });
  });

  test('.markdown / 大文字拡張子も受け付ける', async () => {
    const text = async (): Promise<string> => 'body';
    await expect(parseMarkdownFile({ name: 'p.markdown', text })).resolves.toMatchObject({
      sourceType: 'markdown',
    });
    await expect(parseMarkdownFile({ name: 'P.MD', text })).resolves.toMatchObject({
      sourceType: 'markdown',
    });
  });

  test('Markdown 以外の拡張子は throw する', async () => {
    await expect(
      parseMarkdownFile({ name: 'protocol.docx', text: async () => '' }),
    ).rejects.toThrow('Markdown ファイルの拡張子ではありません: protocol.docx');
  });
});
