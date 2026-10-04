import { createPdfViewer, type PdfViewerOptions, type ViewerHighlight } from '../../../../src/app/ui/pdfViewer';
import type { TextLayerPage } from '../../../../src/domain/textLayer';
import type {
  PdfViewerDocument,
  RenderablePdfPage,
  RenderPdfPageResult,
} from '../../../../src/lib/pdf/renderPage';

function buildPage(page: number, text: string): TextLayerPage {
  return {
    page,
    text,
    width: 612,
    height: 792,
    rotation: 0,
    items: [
      {
        charStart: 0,
        str: text,
        transform: [1, 0, 0, 1, 0, 700],
        width: text.length * 10,
        height: 10,
        hasEOL: false,
      },
    ],
  };
}

const PAGES = [buildPage(1, 'alpha beta alpha'), buildPage(2, 'gamma alpha')];

function makeDocument(numPages = 2): PdfViewerDocument {
  const page: RenderablePdfPage = {
    getViewport: ({ scale }) => ({ width: 612 * scale, height: 792 * scale }),
    render: () => ({ promise: Promise.resolve() }),
  };
  return { numPages, getPage: jest.fn().mockResolvedValue(page) };
}

function makeHighlight(overrides: Partial<ViewerHighlight> = {}): ViewerHighlight {
  return {
    id: 'cell-1',
    label: '総サンプルサイズ',
    kind: 'unverified',
    occurrence: { page: 1, rects: [{ itemIndex: 0, x: 10, y: 700, width: 50, height: 10 }] },
    ...overrides,
  };
}

/**
 * renderPage の fake。renderPdfPageToCanvas と同じ戻り値の形（{ promise, cancel }）を
 * 同期的に返す。cancel 呼び出しの検査用に生成した cancel モックを cancels に積む
 */
function makeRenderPage(
  impl: () => Promise<{ width: number; height: number }> = async () => ({
    width: 612,
    height: 792,
  }),
): { renderPage: jest.Mock; cancels: jest.Mock[] } {
  const cancels: jest.Mock[] = [];
  const renderPage = jest.fn((): RenderPdfPageResult => {
    const cancel = jest.fn();
    cancels.push(cancel);
    return { promise: impl(), cancel };
  });
  return { renderPage, cancels };
}

const flush = async (): Promise<void> => {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
};

describe('選択用テキスト層', () => {
  const textPage = (): RenderablePdfPage => ({
    getViewport: ({ scale }) => ({ width: 612 * scale, height: 792 * scale }),
    getTextContent: jest.fn().mockResolvedValue({ items: [], styles: {} }),
    render: () => ({ promise: Promise.resolve() }),
  });
  const setup = (renderTextLayer: NonNullable<PdfViewerOptions['renderTextLayer']> = jest.fn((_page, container: HTMLElement, _scale) => {
    container.innerHTML = '<span>alpha beta</span>';
    return { promise: Promise.resolve(), cancel: jest.fn() };
  }), onTextSelected: jest.Mock | undefined = jest.fn()) => {
    const page = textPage();
    const doc = { numPages: 2, getPage: jest.fn().mockResolvedValue(page) };
    const viewer = createPdfViewer({
      document: doc, pages: PAGES, renderPage: makeRenderPage().renderPage,
      renderTextLayer, onTextSelected,
    });
    document.body.append(viewer.root);
    return { viewer, page, doc, renderTextLayer, onTextSelected };
  };
  afterEach(() => {
    document.body.replaceChildren();
    jest.restoreAllMocks();
  });

  test('現在のページ・倍率で描画し、ページ送り・ズーム・文書変更で作り直す', async () => {
    const { viewer, page, doc, renderTextLayer } = setup();
    await flush();
    expect(renderTextLayer).toHaveBeenLastCalledWith(page, viewer.root.querySelector('.textLayer'), 1);
    viewer.root.querySelector<HTMLButtonElement>('.pdf-viewer__next')!.click();
    await flush();
    expect(doc.getPage).toHaveBeenLastCalledWith(2);
    const zoom = viewer.root.querySelector<HTMLSelectElement>('select')!;
    zoom.value = '3';
    zoom.dispatchEvent(new Event('change'));
    await flush();
    expect(renderTextLayer).toHaveBeenLastCalledWith(page, viewer.root.querySelector('.textLayer'), 3);
    const next = textPage();
    viewer.setDocument({ numPages: 1, getPage: async () => next }, []);
    await flush();
    expect(renderTextLayer).toHaveBeenLastCalledWith(next, viewer.root.querySelector('.textLayer'), 3);
    expect(renderTextLayer).toHaveBeenCalledTimes(4);
  });

  test('メソッドのない fake は描画しない', async () => {
    const renderTextLayer = jest.fn();
    createPdfViewer({ document: makeDocument(), pages: PAGES, renderPage: makeRenderPage().renderPage, renderTextLayer });
    await flush();
    expect(renderTextLayer).not.toHaveBeenCalled();
  });

  test.each([false, true])('テキスト描画失敗でもエラー表示しない（同期例外: %s）', async (synchronous) => {
    const renderTextLayer = jest.fn(() => {
      if (synchronous) throw new Error('text');
      return { promise: Promise.reject(new Error('text')), cancel: jest.fn() };
    });
    const { viewer } = setup(renderTextLayer);
    await flush();
    expect(viewer.root.querySelector<HTMLElement>('.pdf-viewer__error')!.hidden).toBe(true);
    viewer.setHighlights([makeHighlight()], null);
    expect(viewer.root.querySelector('.pdf-viewer__hl')).not.toBeNull();
  });

  test('進行中の描画をキャンセルし、古い完了は新しい層を上書きしない', async () => {
    const pending: { container: HTMLElement; resolve: () => void; cancel: jest.Mock }[] = [];
    const renderTextLayer = jest.fn((_page, container: HTMLElement, _scale) => {
      const cancel = jest.fn();
      const promise = new Promise<void>((resolve) => pending.push({ container, resolve, cancel }));
      return { promise, cancel };
    });
    const { viewer } = setup(renderTextLayer);
    await flush();
    viewer.root.querySelector<HTMLButtonElement>('.pdf-viewer__next')!.click();
    await flush();
    expect(pending[0]!.cancel).toHaveBeenCalledTimes(1);
    pending[0]!.container.textContent = 'old';
    pending[0]!.resolve();
    await flush();
    expect(viewer.root.querySelector('.textLayer')!.textContent).toBe('');
    viewer.setDocument({ numPages: 1, getPage: async () => textPage() }, []);
    await flush();
    expect(pending[1]!.cancel).toHaveBeenCalledTimes(1);
    pending[1]!.resolve();
    pending[2]!.resolve();
    await flush();
  });

  test('getPage 待機中に文書を変更すると旧ページのテキスト描画を始めない', async () => {
    let resolve!: (page: RenderablePdfPage) => void;
    const renderTextLayer = jest.fn();
    const viewer = createPdfViewer({
      document: { numPages: 1, getPage: () => new Promise((done) => { resolve = done; }) },
      pages: [], renderPage: makeRenderPage().renderPage, renderTextLayer,
    });
    viewer.setDocument(makeDocument(), []);
    resolve(textPage());
    await flush();
    expect(renderTextLayer).not.toHaveBeenCalled();
  });

  test('層の両端を確認し、空白正規化・解除・重複抑止・clearSelection を通知する', async () => {
    const { viewer, onTextSelected } = setup();
    await flush();
    const node = viewer.root.querySelector('.textLayer span')!.firstChild!;
    const removeAllRanges = jest.fn();
    let text = '  alpha\n  beta  ';
    const selected = { anchorNode: node, focusNode: node, toString: () => text, removeAllRanges };
    const spy = jest.spyOn(document, 'getSelection').mockReturnValue(selected as unknown as Selection);
    const change = () => document.dispatchEvent(new Event('selectionchange'));
    change();
    expect(onTextSelected).toHaveBeenLastCalledWith({ page: 1, text: 'alpha beta' });
    viewer.root.dispatchEvent(new MouseEvent('mouseup'));
    expect(onTextSelected).toHaveBeenCalledTimes(1);
    text = 'beta';
    change();
    expect(onTextSelected).toHaveBeenLastCalledWith({ page: 1, text: 'beta' });
    selected.focusNode = document.body;
    change();
    expect(onTextSelected).toHaveBeenLastCalledWith({ page: 1, text: 'beta' });
    change();
    expect(onTextSelected).toHaveBeenCalledTimes(2);
    selected.focusNode = node;
    selected.anchorNode = document.body;
    change();
    expect(onTextSelected).toHaveBeenCalledTimes(2);
    selected.anchorNode = node;
    text = '\n  ';
    change();
    expect(onTextSelected).toHaveBeenCalledTimes(3);
    expect(onTextSelected).toHaveBeenLastCalledWith(null);
    text = 'alpha';
    change();
    viewer.clearSelection();
    expect(removeAllRanges).toHaveBeenCalledTimes(1);
    expect(onTextSelected).toHaveBeenLastCalledWith(null);
    spy.mockReturnValue(null);
    change();
    viewer.clearSelection();
    expect(onTextSelected).toHaveBeenCalledTimes(5);
    spy.mockReturnValue(selected as unknown as Selection);
    change();
    viewer.root.remove();
    change();
    expect(onTextSelected).toHaveBeenCalledTimes(6);
    document.body.append(viewer.root);
    viewer.root.querySelector<HTMLButtonElement>('.pdf-viewer__next')!.click();
    expect(onTextSelected).toHaveBeenLastCalledWith(null);
    await flush();
    selected.anchorNode = selected.focusNode = viewer.root.querySelector('.textLayer span')!.firstChild!;
    change();
    expect(onTextSelected).toHaveBeenLastCalledWith({ page: 2, text: 'alpha' });
    const zoom = viewer.root.querySelector<HTMLSelectElement>('select')!;
    zoom.dispatchEvent(new Event('change'));
    expect(onTextSelected).toHaveBeenLastCalledWith(null);
    await flush();
    selected.anchorNode = selected.focusNode = viewer.root.querySelector('.textLayer span')!.firstChild!;
    change();
    viewer.setDocument(makeDocument(), []);
    expect(onTextSelected).toHaveBeenLastCalledWith(null);
    await flush();
  });

  test('外側の入力欄・選択なしへの移動では選択を保持する', async () => {
    const { viewer, onTextSelected } = setup();
    await flush();
    const selection = document.getSelection()!;
    const range = document.createRange();
    range.selectNodeContents(viewer.root.querySelector('.textLayer span')!);
    selection.removeAllRanges();
    selection.addRange(range);
    document.dispatchEvent(new Event('selectionchange'));
    const input = document.createElement('input');
    document.body.append(input);
    input.focus();
    selection.removeAllRanges();
    document.dispatchEvent(new Event('selectionchange'));
    selection.selectAllChildren(document.body);
    document.dispatchEvent(new Event('selectionchange'));
    expect(onTextSelected).toHaveBeenCalledTimes(1);
    expect(onTextSelected).toHaveBeenLastCalledWith({ page: 1, text: 'alpha beta' });
    viewer.clearSelection();
    expect(onTextSelected).toHaveBeenLastCalledWith(null);
  });

  test('テキスト層のクリックを矩形内の最前面へ委譲し、ドラッグ・矩形外・検索表示を除外する', async () => {
    const onHighlightClick = jest.fn();
    const viewer = createPdfViewer({
      document: { numPages: 2, getPage: async () => textPage() }, pages: PAGES,
      renderPage: makeRenderPage().renderPage, onHighlightClick,
      renderTextLayer: (_page, container) => {
        container.innerHTML = '<span>alpha</span>';
        return { promise: Promise.resolve(), cancel: jest.fn() };
      },
    });
    document.body.append(viewer.root);
    await flush();
    const wrap = viewer.root.querySelector('.pdf-viewer__page')!;
    expect(wrap.classList.contains('pdf-viewer__page--selectable')).toBe(true);
    viewer.search('alpha');
    await flush();
    viewer.setHighlights([makeHighlight(), makeHighlight({ id: 'top' })], null);
    const buttons = viewer.root.querySelectorAll<HTMLButtonElement>('button.pdf-viewer__hl');
    buttons.forEach((button) => jest.spyOn(button, 'getBoundingClientRect').mockReturnValue(
      { left: 10, right: 30, top: 20, bottom: 40 } as DOMRect,
    ));
    const span = viewer.root.querySelector('.textLayer span')!;
    document.getSelection()!.removeAllRanges();
    for (const [clientX, clientY] of [[9, 25], [31, 25], [20, 19], [20, 41]]) {
      span.dispatchEvent(new MouseEvent('click', { bubbles: true, clientX, clientY }));
    }
    expect(onHighlightClick).not.toHaveBeenCalled();
    span.dispatchEvent(new MouseEvent('click', { bubbles: true, clientX: 20, clientY: 25 }));
    expect(onHighlightClick).toHaveBeenLastCalledWith('top');
    expect(onHighlightClick).toHaveBeenCalledTimes(1);
    document.getSelection()!.selectAllChildren(span);
    span.dispatchEvent(new MouseEvent('click', { bubbles: true, clientX: 20, clientY: 25 }));
    expect(onHighlightClick).toHaveBeenCalledTimes(1);
    // jsdom は Enter の既定動作を実行しないため、ブラウザが生成する detail=0 の click を再現する。
    buttons[0]!.focus();
    buttons[0]!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    buttons[0]!.dispatchEvent(new MouseEvent('click', { bubbles: true, detail: 0 }));
    expect(document.activeElement).toBe(buttons[0]);
    expect(buttons[0]!.tabIndex).toBe(0);
    expect(onHighlightClick).toHaveBeenLastCalledWith('cell-1');
    jest.spyOn(document, 'getSelection').mockReturnValue(null);
    span.dispatchEvent(new MouseEvent('click', { bubbles: true, clientX: 10, clientY: 40 }));
    expect(onHighlightClick).toHaveBeenLastCalledWith('top');
    viewer.setDocument(makeDocument(), PAGES);
    expect(wrap.classList.contains('pdf-viewer__page--selectable')).toBe(false);
    await flush();
    expect(wrap.classList.contains('pdf-viewer__page--selectable')).toBe(false);
  });

  test('空のテキスト層ではハイライトボタンが直接クリックを受け取る', async () => {
    const onHighlightClick = jest.fn();
    const viewer = createPdfViewer({
      document: { numPages: 1, getPage: async () => textPage() }, pages: PAGES,
      renderPage: makeRenderPage().renderPage, onHighlightClick,
      renderTextLayer: () => ({ promise: Promise.resolve(), cancel: jest.fn() }),
    });
    await flush();
    expect(viewer.root.querySelector('.pdf-viewer__page--selectable')).toBeNull();
    viewer.setHighlights([makeHighlight()], null);
    viewer.root.querySelector<HTMLButtonElement>('.pdf-viewer__hl')!.click();
    expect(onHighlightClick).toHaveBeenCalledWith('cell-1');
  });

  test('回収済みコールバックの document リスナを除去する', () => {
    const deref = jest.spyOn(WeakRef.prototype, 'deref').mockReturnValue(undefined);
    const remove = jest.spyOn(document, 'removeEventListener');
    setup();
    document.dispatchEvent(new Event('selectionchange'));
    expect(remove).toHaveBeenCalledWith('selectionchange', expect.any(Function));
    deref.mockRestore();
  });
});

describe('createPdfViewer', () => {
  test('初期表示: 1 ページ目・前へは無効・ページ表示・canvas 描画', async () => {
    const { renderPage } = makeRenderPage();
    const viewer = createPdfViewer({ document: makeDocument(), pages: PAGES, renderPage });
    await flush();
    expect(viewer.getCurrentPage()).toBe(1);
    expect(viewer.root.querySelector('.pdf-viewer__page-indicator')?.textContent).toBe(
      '1 / 2 ページ',
    );
    expect(viewer.root.querySelector<HTMLButtonElement>('.pdf-viewer__prev')?.disabled).toBe(true);
    expect(viewer.root.querySelector<HTMLButtonElement>('.pdf-viewer__next')?.disabled).toBe(false);
    expect(renderPage).toHaveBeenCalledTimes(1);
    // ページラッパは scale 1 の寸法で同期確保される
    const wrap = viewer.root.querySelector<HTMLElement>('.pdf-viewer__page');
    expect(wrap?.style.width).toBe('612px');
    expect(wrap?.style.height).toBe('792px');
    // スクロール領域はストア再描画をまたぐ位置復元の対象（issue #192）
    expect(
      viewer.root.querySelector('.pdf-viewer__scroller')?.hasAttribute('data-preserve-scroll'),
    ).toBe(true);
  });

  test('ページ送り: 次へ / 前へで移動し、端では無効化される', async () => {
    const { renderPage } = makeRenderPage();
    const viewer = createPdfViewer({ document: makeDocument(), pages: PAGES, renderPage });
    const next = viewer.root.querySelector<HTMLButtonElement>('.pdf-viewer__next');
    next?.click();
    expect(viewer.getCurrentPage()).toBe(2);
    expect(next?.disabled).toBe(true);
    viewer.root.querySelector<HTMLButtonElement>('.pdf-viewer__prev')?.click();
    expect(viewer.getCurrentPage()).toBe(1);
    await flush();
  });

  test('ズーム変更でオーバーレイとページラッパの寸法が変わる', async () => {
    const { renderPage } = makeRenderPage();
    const viewer = createPdfViewer({ document: makeDocument(), pages: PAGES, renderPage });
    viewer.setHighlights([makeHighlight()], null);
    const zoom = viewer.root.querySelector<HTMLSelectElement>('.pdf-viewer__zoom');
    zoom!.value = '1.5';
    zoom!.dispatchEvent(new Event('change'));
    await flush();
    const rect = viewer.root.querySelector<HTMLElement>('.pdf-viewer__hl');
    expect(rect?.style.left).toBe('15px');
    // top = (792 - 700 - 10) * 1.5
    expect(rect?.style.top).toBe('123px');
    expect(rect?.style.width).toBe('75px');
    expect(rect?.style.height).toBe('15px');
    const wrap = viewer.root.querySelector<HTMLElement>('.pdf-viewer__page');
    expect(wrap?.style.width).toBe('918px');
  });

  test('ズーム選択肢に 175% / 200% / 300% があり、scale 2 でオーバーレイ座標が 2 倍になる（issue #51）', async () => {
    const { renderPage } = makeRenderPage();
    const viewer = createPdfViewer({ document: makeDocument(), pages: PAGES, renderPage });
    viewer.setHighlights([makeHighlight()], null);
    const zoom = viewer.root.querySelector<HTMLSelectElement>('.pdf-viewer__zoom')!;
    expect([...zoom.options].map((option) => option.value)).toEqual([
      '0.75', '1', '1.25', '1.5', '1.75', '2', '2.5', '3',
    ]);
    const labels = [...zoom.options].map((option) => option.textContent);
    expect(labels).toContain('175%');
    expect(labels).toContain('200%');
    // issue #51: 小さい画面でも読めるよう 300% まで拡大できる
    expect(labels).toContain('300%');
    zoom.value = '2';
    zoom.dispatchEvent(new Event('change'));
    await flush();
    const rect = viewer.root.querySelector<HTMLElement>('.pdf-viewer__hl');
    expect(rect?.style.left).toBe('20px'); // 10 * 2
    // top = (792 - 700 - 10) * 2 = 164
    expect(rect?.style.top).toBe('164px');
    expect(rect?.style.width).toBe('100px'); // 50 * 2
    expect(rect?.style.height).toBe('20px'); // 10 * 2
    const wrap = viewer.root.querySelector<HTMLElement>('.pdf-viewer__page');
    expect(wrap?.style.width).toBe('1224px'); // 612 * 2
    expect(wrap?.style.height).toBe('1584px'); // 792 * 2
  });

  test('回転ページ（/Rotate 90）はハイライトを回転込みの表示座標に置く', async () => {
    const rotatedPage: TextLayerPage = {
      page: 1,
      text: 'alpha',
      width: 792, // 表示寸法（縦置き 612x792 の 90 度回転）
      height: 612,
      rotation: 90,
      items: [
        {
          charStart: 0,
          str: 'alpha',
          transform: [0, 10, -10, 0, 110, 200],
          width: 50,
          height: 10,
          hasEOL: false,
        },
      ],
    };
    const { renderPage } = makeRenderPage();
    const viewer = createPdfViewer({
      document: makeDocument(1),
      pages: [rotatedPage],
      renderPage,
    });
    viewer.setHighlights(
      [
        makeHighlight({
          occurrence: { page: 1, rects: [{ itemIndex: 0, x: 100, y: 200, width: 10, height: 50 }] },
        }),
      ],
      null,
    );
    const rect = viewer.root.querySelector<HTMLElement>('.pdf-viewer__hl');
    // left = 生 y / top = 生 x、幅と高さは入れ替わる
    expect(rect?.style.left).toBe('200px');
    expect(rect?.style.top).toBe('100px');
    expect(rect?.style.width).toBe('50px');
    expect(rect?.style.height).toBe('10px');
    const wrap = viewer.root.querySelector<HTMLElement>('.pdf-viewer__page');
    expect(wrap?.style.width).toBe('792px');
    expect(wrap?.style.height).toBe('612px');
    await flush();
  });

  test('bbox 由来（space: "display"）の矩形は回転ページでも toDisplayRect を通さない（§7.4 PR3・二重回転防止）', async () => {
    // 前テストと同じ回転 90 度ページ。'user' 空間の矩形は toDisplayRect(90°) で
    // { left: y, top: x, width: height, height: width } に写像されるが、
    // 'display' 空間（bbox 由来）は写像を通さずそのまま scale だけを掛けるはず
    const rotatedPage: TextLayerPage = {
      page: 1,
      text: 'alpha',
      width: 792,
      height: 612,
      rotation: 90,
      items: [
        {
          charStart: 0,
          str: 'alpha',
          transform: [0, 10, -10, 0, 110, 200],
          width: 50,
          height: 10,
          hasEOL: false,
        },
      ],
    };
    const { renderPage } = makeRenderPage();
    const viewer = createPdfViewer({
      document: makeDocument(1),
      pages: [rotatedPage],
      renderPage,
    });
    viewer.setHighlights(
      [
        makeHighlight({
          occurrence: {
            page: 1,
            rects: [{ itemIndex: -1, x: 50, y: 20, width: 30, height: 40 }],
            space: 'display',
          },
        }),
      ],
      null,
    );
    const rect = viewer.root.querySelector<HTMLElement>('.pdf-viewer__hl');
    // toDisplayRect(90°) を通していれば { left: 20, top: 50, width: 40, height: 30 } になるはずだが、
    // 'display' 空間はそのまま（scale=1 なので無変換）で配置される
    expect(rect?.style.left).toBe('50px');
    expect(rect?.style.top).toBe('20px');
    expect(rect?.style.width).toBe('30px');
    expect(rect?.style.height).toBe('40px');
    await flush();
  });

  test('ハイライト: 現在ページの矩形だけを描画し、クリックでコールバックが飛ぶ', async () => {
    const onHighlightClick = jest.fn();
    const { renderPage } = makeRenderPage();
    const viewer = createPdfViewer({
      document: makeDocument(),
      pages: PAGES,
      renderPage,
      onHighlightClick,
    });
    viewer.setHighlights(
      [
        makeHighlight({ kind: 'verified' }),
        makeHighlight({
          id: 'cell-2',
          occurrence: { page: 2, rects: [{ itemIndex: 0, x: 0, y: 700, width: 10, height: 10 }] },
        }),
      ],
      'cell-1',
    );
    const rects = viewer.root.querySelectorAll<HTMLButtonElement>('.pdf-viewer__hl');
    expect(rects).toHaveLength(1);
    expect(rects[0]?.classList.contains('pdf-viewer__hl--verified')).toBe(true);
    expect(rects[0]?.classList.contains('pdf-viewer__hl--active')).toBe(true);
    expect(rects[0]?.getAttribute('aria-label')).toBe('根拠: 総サンプルサイズ');
    rects[0]?.click();
    expect(onHighlightClick).toHaveBeenCalledWith('cell-1');
    await flush();
  });

  test('focusHighlight は該当ページへ移動して強調する。未知 id は無視', async () => {
    const { renderPage } = makeRenderPage();
    const viewer = createPdfViewer({ document: makeDocument(), pages: PAGES, renderPage });
    viewer.setHighlights(
      [
        makeHighlight({
          id: 'cell-2',
          occurrence: { page: 2, rects: [{ itemIndex: 0, x: 0, y: 700, width: 10, height: 10 }] },
        }),
      ],
      null,
    );
    viewer.focusHighlight('unknown');
    expect(viewer.getCurrentPage()).toBe(1);
    viewer.focusHighlight('cell-2');
    expect(viewer.getCurrentPage()).toBe(2);
    expect(
      viewer.root.querySelector('.pdf-viewer__hl')?.classList.contains('pdf-viewer__hl--active'),
    ).toBe(true);
    // onHighlightClick 未指定でもクリックは安全
    viewer.root.querySelector<HTMLButtonElement>('.pdf-viewer__hl')?.click();
    await flush();
  });

  test('テキスト検索: 一致へ移動し、同じクエリの再実行で次の一致へ循環する', async () => {
    const { renderPage } = makeRenderPage();
    const viewer = createPdfViewer({ document: makeDocument(), pages: PAGES, renderPage });
    const input = viewer.root.querySelector<HTMLInputElement>('.pdf-viewer__search-input');
    const button = viewer.root.querySelector<HTMLButtonElement>('.pdf-viewer__search-button');
    const status = viewer.root.querySelector('.pdf-viewer__search-status');
    input!.value = 'alpha';
    button!.click();
    expect(status?.textContent).toBe('1 / 3 件');
    expect(viewer.getCurrentPage()).toBe(1);
    // 検索ハイライトが現在ページに描画される
    expect(viewer.root.querySelectorAll('.pdf-viewer__hl--search')).toHaveLength(1);
    button!.click();
    expect(status?.textContent).toBe('2 / 3 件');
    button!.click();
    expect(status?.textContent).toBe('3 / 3 件');
    expect(viewer.getCurrentPage()).toBe(2);
    button!.click(); // 末尾 → 先頭へ循環
    expect(status?.textContent).toBe('1 / 3 件');
    expect(viewer.getCurrentPage()).toBe(1);
    // ヒットと別のページへ移動したら検索矩形は描かない
    viewer.root.querySelector<HTMLButtonElement>('.pdf-viewer__next')?.click();
    expect(viewer.root.querySelectorAll('.pdf-viewer__hl--search')).toHaveLength(0);
    await flush();
  });

  test('検索: 新しいクエリでリセット・不一致はメッセージ・空クエリは何もしない', async () => {
    const { renderPage } = makeRenderPage();
    const viewer = createPdfViewer({ document: makeDocument(), pages: PAGES, renderPage });
    const input = viewer.root.querySelector<HTMLInputElement>('.pdf-viewer__search-input');
    const status = viewer.root.querySelector('.pdf-viewer__search-status');
    input!.value = '  ';
    input!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' }));
    expect(status?.textContent).toBe('');
    input!.value = 'gamma';
    input!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' }));
    expect(status?.textContent).toBe('1 / 1 件');
    expect(viewer.getCurrentPage()).toBe(2);
    input!.value = 'zeta';
    input!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' }));
    expect(status?.textContent).toBe('一致する本文が見つかりません');
    // Enter 以外のキーは無視
    input!.dispatchEvent(new KeyboardEvent('keydown', { key: 'a' }));
    await flush();
  });

  test('search() API はツールバーの入力へクエリを反映して検索する', async () => {
    const { renderPage } = makeRenderPage();
    const viewer = createPdfViewer({ document: makeDocument(), pages: PAGES, renderPage });
    viewer.search('gamma alpha');
    expect(
      viewer.root.querySelector<HTMLInputElement>('.pdf-viewer__search-input')?.value,
    ).toBe('gamma alpha');
    expect(viewer.getCurrentPage()).toBe(2);
    // ページ 2 表示中にページ 1 の検索ヒットへ切り替わっても矩形は現在ページのみ
    viewer.search('beta');
    expect(viewer.getCurrentPage()).toBe(1);
    await flush();
  });

  test('canvas 描画の失敗はエラー表示になり、成功で消える', async () => {
    let call = 0;
    const { renderPage } = makeRenderPage(async () => {
      call += 1;
      if (call === 1) {
        throw new Error('worker 起動失敗');
      }
      return { width: 612, height: 792 };
    });
    const viewer = createPdfViewer({ document: makeDocument(), pages: PAGES, renderPage });
    await flush();
    const error = viewer.root.querySelector<HTMLElement>('.pdf-viewer__error');
    expect(error?.hidden).toBe(false);
    expect(error?.textContent).toBe('PDF を表示できません: worker 起動失敗');
    viewer.root.querySelector<HTMLButtonElement>('.pdf-viewer__next')?.click();
    await flush();
    expect(error?.hidden).toBe(true);
  });

  test('renderPage 未指定なら既定の renderPdfPageToCanvas で描画する', async () => {
    const viewer = createPdfViewer({ document: makeDocument(), pages: PAGES });
    await flush();
    expect(viewer.root.querySelector<HTMLElement>('.pdf-viewer__error')?.hidden).toBe(true);
  });

  test('Error 以外の throw も文字列化して表示する', async () => {
    const { renderPage } = makeRenderPage(() => Promise.reject('壊れた PDF'));
    const viewer = createPdfViewer({ document: makeDocument(), pages: PAGES, renderPage });
    await flush();
    expect(viewer.root.querySelector('.pdf-viewer__error')?.textContent).toBe(
      'PDF を表示できません: 壊れた PDF',
    );
  });

  test('描画競合: 古い描画の完了・失敗は最新の表示を上書きしない', async () => {
    const resolvers: Array<{ resolve: () => void; reject: (err: Error) => void }> = [];
    const cancels: jest.Mock[] = [];
    const renderPage = jest.fn().mockImplementation(() => {
      const cancel = jest.fn();
      cancels.push(cancel);
      const promise = new Promise<{ width: number; height: number }>((resolve, reject) => {
        resolvers.push({
          resolve: () => resolve({ width: 612, height: 792 }),
          reject,
        });
      });
      return { promise, cancel };
    });
    const viewer = createPdfViewer({ document: makeDocument(3), pages: PAGES, renderPage });
    const next = viewer.root.querySelector<HTMLButtonElement>('.pdf-viewer__next');
    next?.click(); // 2 ページ目（描画 2 件目）
    next?.click(); // 3 ページ目（描画 3 件目）
    await flush();
    expect(resolvers).toHaveLength(3);
    // 1 件目の失敗は無視される（すでに 3 件目が最新）
    resolvers[0]?.reject(new Error('古い失敗'));
    await flush();
    const error = viewer.root.querySelector<HTMLElement>('.pdf-viewer__error');
    expect(error?.hidden).toBe(true);
    // 2 件目の成功も何もしない（エラー消去は最新描画のみが行う）
    resolvers[1]?.resolve();
    await flush();
    // 3 件目（最新）の成功でエラーが消える
    resolvers[2]?.resolve();
    await flush();
    expect(error?.hidden).toBe(true);
  });

  test('テキスト層に無いページはオーバーレイを描かない（canvas 描画に任せる）', async () => {
    const { renderPage } = makeRenderPage();
    const viewer = createPdfViewer({
      document: makeDocument(3),
      pages: PAGES, // 3 ページ目のテキスト層なし
      renderPage,
    });
    viewer.setHighlights([makeHighlight()], null);
    const next = viewer.root.querySelector<HTMLButtonElement>('.pdf-viewer__next');
    next?.click();
    next?.click();
    expect(viewer.getCurrentPage()).toBe(3);
    expect(viewer.root.querySelectorAll('.pdf-viewer__hl')).toHaveLength(0);
    await flush();
  });

  describe('描画タスクの実キャンセル（issue #28 案3）', () => {
    /** render() が保留のまま（未解決）の renderPage fake。描画中に次の操作が来る状況を再現する */
    function makePendingRenderPage(): {
      renderPage: jest.Mock;
      cancels: jest.Mock[];
      resolvers: Array<(v: { width: number; height: number }) => void>;
    } {
      const cancels: jest.Mock[] = [];
      const resolvers: Array<(v: { width: number; height: number }) => void> = [];
      const renderPage = jest.fn((): RenderPdfPageResult => {
        const cancel = jest.fn();
        cancels.push(cancel);
        const promise = new Promise<{ width: number; height: number }>((resolve) => {
          resolvers.push(resolve);
        });
        return { promise, cancel };
      });
      return { renderPage, cancels, resolvers };
    }

    test('前ページの描画が完了する前にページ送りすると RenderTask を cancel する', async () => {
      const { renderPage, cancels, resolvers } = makePendingRenderPage();
      const viewer = createPdfViewer({ document: makeDocument(), pages: PAGES, renderPage });
      await flush(); // 1 ページ目の render() 呼び出しまで進める（promise は未解決のまま）
      expect(cancels[0]).not.toHaveBeenCalled();
      viewer.root.querySelector<HTMLButtonElement>('.pdf-viewer__next')?.click();
      expect(cancels[0]).toHaveBeenCalledTimes(1);
      resolvers.forEach((resolve) => resolve({ width: 612, height: 792 }));
      await flush();
    });

    test('前文書の描画が完了する前に setDocument すると RenderTask を cancel する', async () => {
      const { renderPage, cancels, resolvers } = makePendingRenderPage();
      const viewer = createPdfViewer({ document: makeDocument(), pages: PAGES, renderPage });
      await flush();
      viewer.setDocument(makeDocument(1), PAGES);
      expect(cancels[0]).toHaveBeenCalledTimes(1);
      resolvers.forEach((resolve) => resolve({ width: 612, height: 792 }));
      await flush();
    });

    test('前の描画が完了する前にズーム変更すると RenderTask を cancel する', async () => {
      const { renderPage, cancels, resolvers } = makePendingRenderPage();
      const viewer = createPdfViewer({ document: makeDocument(), pages: PAGES, renderPage });
      await flush();
      const zoom = viewer.root.querySelector<HTMLSelectElement>('.pdf-viewer__zoom')!;
      zoom.value = '1.5';
      zoom.dispatchEvent(new Event('change'));
      expect(cancels[0]).toHaveBeenCalledTimes(1);
      resolvers.forEach((resolve) => resolve({ width: 612, height: 792 }));
      await flush();
    });

    test('完了済みの描画には cancel を呼ばない（キャンセル対象が無ければ何もしない）', async () => {
      const { renderPage, cancels } = makeRenderPage();
      const viewer = createPdfViewer({ document: makeDocument(), pages: PAGES, renderPage });
      await flush(); // render() の promise が解決済み → currentRenderTask は既に null
      viewer.root.querySelector<HTMLButtonElement>('.pdf-viewer__next')?.click();
      expect(cancels[0]).not.toHaveBeenCalled();
      await flush();
    });

    test('キャンセルに伴う rejection（RenderingCancelledException 相当）はエラー表示にしない', async () => {
      const rejecters: Array<(err: Error) => void> = [];
      const renderPage = jest.fn().mockImplementation(() => {
        const cancel = jest.fn(() => {
          rejecters[rejecters.length - 1]?.(new Error('RenderingCancelledException'));
        });
        const promise = new Promise<{ width: number; height: number }>((_resolve, reject) => {
          rejecters.push(reject);
        });
        return { promise, cancel };
      });
      const viewer = createPdfViewer({ document: makeDocument(), pages: PAGES, renderPage });
      await flush();
      // 次ページへの遷移で 1 ページ目の RenderTask がキャンセル → reject されるが、
      // 連番ガードにより無視され、2 ページ目の描画だけが有効になる
      viewer.root.querySelector<HTMLButtonElement>('.pdf-viewer__next')?.click();
      await flush();
      expect(viewer.root.querySelector<HTMLElement>('.pdf-viewer__error')?.hidden).toBe(true);
    });

    test('document.getPage 待ちの間に追い越された描画は、render() 呼び出し後すぐキャンセルされる', async () => {
      const page: RenderablePdfPage = {
        getViewport: ({ scale }) => ({ width: 612 * scale, height: 792 * scale }),
        render: () => ({ promise: Promise.resolve() }),
      };
      const getPageResolvers: Array<() => void> = [];
      const doc: PdfViewerDocument = {
        numPages: 2,
        getPage: jest.fn().mockImplementation(
          () =>
            new Promise<RenderablePdfPage>((resolve) => {
              getPageResolvers.push(() => resolve(page));
            }),
        ),
      };
      const { renderPage, cancels } = makeRenderPage();
      const viewer = createPdfViewer({ document: doc, pages: PAGES, renderPage });
      // 初回描画（1 ページ目）は getPage 待ちのまま。ページ送りで 2 件目の getPage 呼び出しを積む
      viewer.root.querySelector<HTMLButtonElement>('.pdf-viewer__next')?.click();
      expect(getPageResolvers).toHaveLength(2);
      // 1 件目（古い・1 ページ目向け）を先に解決すると render() は呼ばれるが、即座にキャンセルされる
      getPageResolvers[0]?.();
      await flush();
      expect(renderPage).toHaveBeenCalledTimes(1);
      expect(cancels[0]).toHaveBeenCalledTimes(1);
      // 2 件目（最新・2 ページ目向け）を解決すると render が呼ばれ、キャンセルされない
      getPageResolvers[1]?.();
      await flush();
      expect(renderPage).toHaveBeenCalledTimes(2);
      expect(cancels[1]).not.toHaveBeenCalled();
    });
  });
});
