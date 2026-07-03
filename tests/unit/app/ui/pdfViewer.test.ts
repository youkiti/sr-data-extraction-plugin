import { createPdfViewer, type ViewerHighlight } from '../../../../src/app/ui/pdfViewer';
import type { TextLayerPage } from '../../../../src/domain/textLayer';
import type {
  PdfViewerDocument,
  RenderablePdfPage,
} from '../../../../src/lib/pdf/renderPage';

function buildPage(page: number, text: string): TextLayerPage {
  return {
    page,
    text,
    width: 612,
    height: 792,
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

const flush = async (): Promise<void> => {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
};

describe('createPdfViewer', () => {
  test('初期表示: 1 ページ目・前へは無効・ページ表示・canvas 描画', async () => {
    const renderPage = jest.fn().mockResolvedValue({ width: 612, height: 792 });
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
  });

  test('ページ送り: 次へ / 前へで移動し、端では無効化される', async () => {
    const renderPage = jest.fn().mockResolvedValue({ width: 612, height: 792 });
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
    const renderPage = jest.fn().mockResolvedValue({ width: 612, height: 792 });
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

  test('ハイライト: 現在ページの矩形だけを描画し、クリックでコールバックが飛ぶ', async () => {
    const onHighlightClick = jest.fn();
    const renderPage = jest.fn().mockResolvedValue({ width: 612, height: 792 });
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
    const renderPage = jest.fn().mockResolvedValue({ width: 612, height: 792 });
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
    const renderPage = jest.fn().mockResolvedValue({ width: 612, height: 792 });
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
    const renderPage = jest.fn().mockResolvedValue({ width: 612, height: 792 });
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
    const renderPage = jest.fn().mockResolvedValue({ width: 612, height: 792 });
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
    const renderPage = jest
      .fn()
      .mockRejectedValueOnce(new Error('worker 起動失敗'))
      .mockResolvedValue({ width: 612, height: 792 });
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
    const renderPage = jest.fn().mockRejectedValue('壊れた PDF');
    const viewer = createPdfViewer({ document: makeDocument(), pages: PAGES, renderPage });
    await flush();
    expect(viewer.root.querySelector('.pdf-viewer__error')?.textContent).toBe(
      'PDF を表示できません: 壊れた PDF',
    );
  });

  test('描画競合: 古い描画の完了・失敗は最新の表示を上書きしない', async () => {
    const resolvers: Array<{ resolve: () => void; reject: (err: Error) => void }> = [];
    const renderPage = jest.fn().mockImplementation(
      () =>
        new Promise<{ width: number; height: number }>((resolve, reject) => {
          resolvers.push({
            resolve: () => resolve({ width: 612, height: 792 }),
            reject,
          });
        }),
    );
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
    const renderPage = jest.fn().mockResolvedValue({ width: 612, height: 792 });
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
});
