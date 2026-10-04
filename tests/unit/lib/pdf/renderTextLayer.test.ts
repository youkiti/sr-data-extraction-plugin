import { TextLayer, type PageViewport } from 'pdfjs-dist';
import { renderPdfTextLayer } from '../../../../src/lib/pdf/renderTextLayer';

jest.mock('pdfjs-dist', () => ({ TextLayer: jest.fn() }));

const render = jest.fn().mockResolvedValue(undefined);
const cancel = jest.fn();
const viewport = { width: 792, height: 612, rotation: 90, userUnit: 2 } as PageViewport;
const content = { items: [], styles: {}, lang: null };
const page = {
  getViewport: jest.fn().mockReturnValue(viewport),
  getTextContent: jest.fn().mockResolvedValue(content),
  render: jest.fn(),
};

beforeEach(() => {
  jest.mocked(TextLayer).mockImplementation(() => ({ render, cancel }) as unknown as TextLayer);
});

test.each([0.75, 1, 3])('倍率 %s と回転つき viewport をそのまま渡す', async (scale) => {
  const container = document.createElement('div');
  const task = renderPdfTextLayer(page, container, scale);
  await task.promise;
  expect(page.getViewport).toHaveBeenCalledWith({ scale });
  expect(TextLayer).toHaveBeenCalledWith({ container, viewport, textContentSource: content });
  expect(container.style.getPropertyValue('--scale-factor')).toBe(String(scale));
  expect(container.style.getPropertyValue('--total-scale-factor')).toBe(String(scale * 2));
  task.cancel();
  expect(cancel).toHaveBeenCalledTimes(1);
});

test('読み込み中のキャンセルは TextLayer を生成しない', async () => {
  const task = renderPdfTextLayer(page, document.createElement('div'), 1);
  task.cancel();
  await task.promise;
  expect(TextLayer).not.toHaveBeenCalled();
});

test('描画失敗は呼び出し側へ返す', async () => {
  render.mockRejectedValueOnce(new Error('text render'));
  await expect(renderPdfTextLayer(page, document.createElement('div'), 1).promise)
    .rejects.toThrow('text render');
});
