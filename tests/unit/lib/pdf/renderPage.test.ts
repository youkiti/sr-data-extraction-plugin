import {
  renderPdfPageToCanvas,
  MAX_CANVAS_TOTAL_PIXELS,
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
  test('dpr=1 は従来同等: canvas 内部解像度と CSS 表示寸法が scale 基準で一致する', async () => {
    const { page, render } = makePage();
    const canvas = document.createElement('canvas');
    const size = await renderPdfPageToCanvas(page, canvas, 2, { devicePixelRatio: 1 });
    expect(canvas.width).toBe(1225); // floor(612.5 * 2)
    expect(canvas.height).toBe(1584); // floor(792.25 * 2)
    expect(canvas.style.width).toBe('1225px');
    expect(canvas.style.height).toBe('1584.5px');
    expect(size).toEqual({ width: 1225, height: 1584.5 });
    expect(render).toHaveBeenCalledWith({
      canvas,
      viewport: { width: 1225, height: 1584.5 },
    });
  });

  test('dpr=2: canvas 内部解像度は 2 倍に、CSS 表示寸法は scale 基準のまま据え置く', async () => {
    const { page, render } = makePage();
    const canvas = document.createElement('canvas');
    const size = await renderPdfPageToCanvas(page, canvas, 1, { devicePixelRatio: 2 });
    // CSS 表示寸法（scale=1 基準。ハイライトオーバーレイとの位置整合のため不変）
    expect(canvas.style.width).toBe('612.5px');
    expect(canvas.style.height).toBe('792.25px');
    expect(size).toEqual({ width: 612.5, height: 792.25 });
    // 内部解像度は devicePixelRatio 分（scale(1) * outputScale(2)）
    expect(canvas.width).toBe(1225); // floor(612.5 * 2)
    expect(canvas.height).toBe(1584); // floor(792.25 * 2)
    expect(render).toHaveBeenCalledWith({
      canvas,
      viewport: { width: 1225, height: 1584.5 },
    });
  });

  test('総画素数が上限を超える場合は outputScale を按分で縮小する', async () => {
    const render = jest.fn().mockReturnValue({ promise: Promise.resolve() });
    const page: RenderablePdfPage = {
      getViewport: ({ scale }) => ({ width: 1000 * scale, height: 1000 * scale }),
      render,
    };
    const canvas = document.createElement('canvas');
    const size = await renderPdfPageToCanvas(page, canvas, 1, {
      devicePixelRatio: 4,
      maxTotalPixels: 4_000_000,
    });
    // shrinkFactor = sqrt(4,000,000 / (1000*1000)) = 2 → outputScale = min(4, 2) = 2
    expect(canvas.width).toBe(2000);
    expect(canvas.height).toBe(2000);
    // CSS 表示寸法は scale 基準のまま変化しない
    expect(canvas.style.width).toBe('1000px');
    expect(canvas.style.height).toBe('1000px');
    expect(size).toEqual({ width: 1000, height: 1000 });
  });

  test('outputScale は 1 未満にならない（CSS 解像度そのものが上限超のケースでも従来品質を維持）', async () => {
    const render = jest.fn().mockReturnValue({ promise: Promise.resolve() });
    const page: RenderablePdfPage = {
      getViewport: ({ scale }) => ({ width: 5000 * scale, height: 5000 * scale }),
      render,
    };
    const canvas = document.createElement('canvas');
    const size = await renderPdfPageToCanvas(page, canvas, 1, {
      devicePixelRatio: 1,
      maxTotalPixels: 1000, // 5000 * 5000 = 25,000,000 は dpr=1 でも上限を超える
    });
    expect(canvas.width).toBe(5000);
    expect(canvas.height).toBe(5000);
    expect(size).toEqual({ width: 5000, height: 5000 });
  });

  test('options 省略時は globalThis.devicePixelRatio が使われる', async () => {
    const originalDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'devicePixelRatio');
    Object.defineProperty(globalThis, 'devicePixelRatio', { value: 3, configurable: true });
    try {
      const { page } = makePage();
      const canvas = document.createElement('canvas');
      const size = await renderPdfPageToCanvas(page, canvas, 1);
      expect(canvas.width).toBe(Math.floor(612.5 * 3));
      expect(canvas.height).toBe(Math.floor(792.25 * 3));
      expect(canvas.style.width).toBe('612.5px');
      expect(size).toEqual({ width: 612.5, height: 792.25 });
    } finally {
      if (originalDescriptor === undefined) {
        delete (globalThis as { devicePixelRatio?: number }).devicePixelRatio;
      } else {
        Object.defineProperty(globalThis, 'devicePixelRatio', originalDescriptor);
      }
    }
  });

  test('options 省略かつ globalThis.devicePixelRatio 未定義なら 1 として扱う', async () => {
    const originalDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'devicePixelRatio');
    delete (globalThis as { devicePixelRatio?: number }).devicePixelRatio;
    try {
      const { page } = makePage();
      const canvas = document.createElement('canvas');
      const size = await renderPdfPageToCanvas(page, canvas, 2);
      expect(canvas.width).toBe(1225); // floor(612.5 * 2) = dpr フォールバック 1 相当
      expect(canvas.height).toBe(1584);
      expect(size).toEqual({ width: 1225, height: 1584.5 });
    } finally {
      if (originalDescriptor !== undefined) {
        Object.defineProperty(globalThis, 'devicePixelRatio', originalDescriptor);
      }
    }
  });

  test('MAX_CANVAS_TOTAL_PIXELS は 4096×4096 相当（既定の上限）', () => {
    expect(MAX_CANVAS_TOTAL_PIXELS).toBe(4096 * 4096);
  });

  test('描画の失敗はそのまま伝播する', async () => {
    const render = jest.fn().mockReturnValue({ promise: Promise.reject(new Error('render 失敗')) });
    const page: RenderablePdfPage = {
      getViewport: ({ scale }) => ({ width: 100 * scale, height: 100 * scale }),
      render,
    };
    await expect(
      renderPdfPageToCanvas(page, document.createElement('canvas'), 1, { devicePixelRatio: 1 }),
    ).rejects.toThrow('render 失敗');
  });
});
