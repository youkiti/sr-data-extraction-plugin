import {
  renderPdfPageToCanvas,
  type RenderablePdfPage,
} from '../../../../src/lib/pdf/renderPage';

function makePage(): { page: RenderablePdfPage; render: jest.Mock } {
  const render = jest.fn().mockReturnValue({ promise: Promise.resolve() });
  const page: RenderablePdfPage = {
    getViewport: ({ scale }) => ({ width: 612.5 * scale, height: 792.25 * scale }),
    render,
  };
  return { page, render };
}

describe('renderPdfPageToCanvas', () => {
  test('viewport に合わせて canvas 寸法を設定し、canvas パラメータで描画する', async () => {
    const { page, render } = makePage();
    const canvas = document.createElement('canvas');
    const size = await renderPdfPageToCanvas(page, canvas, 2);
    expect(canvas.width).toBe(1225); // floor(612.5 * 2)
    expect(canvas.height).toBe(1584); // floor(792.25 * 2)
    expect(size).toEqual({ width: 1225, height: 1584 });
    expect(render).toHaveBeenCalledWith({
      canvas,
      viewport: { width: 1225, height: 1584.5 },
    });
  });

  test('描画の失敗はそのまま伝播する', async () => {
    const render = jest.fn().mockReturnValue({ promise: Promise.reject(new Error('render 失敗')) });
    const page: RenderablePdfPage = {
      getViewport: ({ scale }) => ({ width: 100 * scale, height: 100 * scale }),
      render,
    };
    await expect(
      renderPdfPageToCanvas(page, document.createElement('canvas'), 1),
    ).rejects.toThrow('render 失敗');
  });
});
