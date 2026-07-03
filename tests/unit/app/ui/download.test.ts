import { downloadTextFile } from '../../../../src/app/ui/download';

describe('downloadTextFile', () => {
  const createObjectURL = jest.fn(() => 'blob:mock-url');
  const revokeObjectURL = jest.fn();

  beforeEach(() => {
    // jsdom は createObjectURL を実装しないためモックを差す
    (URL as unknown as { createObjectURL: unknown }).createObjectURL = createObjectURL;
    (URL as unknown as { revokeObjectURL: unknown }).revokeObjectURL = revokeObjectURL;
  });

  test('Blob URL の <a download> をクリックし、URL を破棄する（既定 = グローバル document）', () => {
    const click = jest.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
    downloadTextFile('data.csv', 'a,b', 'text/csv');
    expect(createObjectURL).toHaveBeenCalledTimes(1);
    expect(createObjectURL.mock.calls[0]).toHaveLength(1);
    expect(click).toHaveBeenCalledTimes(1);
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:mock-url');
    click.mockRestore();
  });

  test('明示した Document で <a> を生成し、href / download を設定する', () => {
    const clicked: HTMLAnchorElement[] = [];
    const anchor = document.createElement('a');
    anchor.click = () => clicked.push(anchor);
    const doc = { createElement: jest.fn(() => anchor) } as unknown as Document;
    downloadTextFile('audit.csv', 'x', 'text/csv', doc);
    expect(doc.createElement).toHaveBeenCalledWith('a');
    expect(anchor.getAttribute('href')).toBe('blob:mock-url');
    expect(anchor.download).toBe('audit.csv');
    expect(clicked).toHaveLength(1);
  });
});
