import { createTextViewer } from '../../../../src/app/ui/textViewer';

describe('createTextViewer', () => {
  test('初期状態は根拠未選択の案内文言', () => {
    const viewer = createTextViewer();
    expect(viewer.root.querySelector('.text-viewer__empty')).not.toBeNull();
    expect(viewer.root.querySelector('.text-viewer__snippet')).toBeNull();
    // 本文領域はストア再描画をまたぐスクロール位置復元の対象（issue #192）
    expect(
      viewer.root.querySelector('.text-viewer__body')?.hasAttribute('data-preserve-scroll'),
    ).toBe(true);
  });

  test('located ありはスニペット（出所文書 / ページ番号 / mark 強調 / 前後文脈）を表示する', () => {
    const viewer = createTextViewer();
    viewer.setSnippet({
      documentLabel: 'smith2020.pdf（本論文）',
      quote: 'mortality was 12 percent',
      located: { page: 3, before: 'intro. ', after: ' overall.' },
    });
    expect(viewer.root.querySelector('.text-viewer__doc-label')?.textContent).toBe(
      'smith2020.pdf（本論文）',
    );
    expect(viewer.root.querySelector('.text-viewer__page')?.textContent).toBe('3 ページ');
    const snippet = viewer.root.querySelector('.text-viewer__snippet');
    expect(snippet?.textContent).toBe('intro. mortality was 12 percent overall.');
    const mark = snippet?.querySelector('mark.text-viewer__mark');
    expect(mark?.textContent).toBe('mortality was 12 percent');
    expect(viewer.root.querySelector('.text-viewer__empty')).toBeNull();
  });

  test('located が null は再特定不能表示（quote 全文 + 案内）', () => {
    const viewer = createTextViewer();
    viewer.setSnippet({
      documentLabel: 'jones2021.pdf（試験登録）',
      quote: 'a quote nowhere to be found',
      located: null,
    });
    expect(viewer.root.querySelector('.text-viewer__doc-label')?.textContent).toBe(
      'jones2021.pdf（試験登録）',
    );
    expect(viewer.root.querySelector('.text-viewer__unresolved-note')?.textContent).toContain(
      '再特定できません',
    );
    expect(viewer.root.querySelector('.text-viewer__quote-full')?.textContent).toBe(
      'a quote nowhere to be found',
    );
    expect(viewer.root.querySelector('.text-viewer__page')).toBeNull();
  });

  test('null を渡すと未選択表示へ戻る', () => {
    const viewer = createTextViewer();
    viewer.setSnippet({
      documentLabel: 'smith2020.pdf（本論文）',
      quote: 'mortality was 12 percent',
      located: { page: 1, before: '', after: '' },
    });
    viewer.setSnippet(null);
    expect(viewer.root.querySelector('.text-viewer__empty')).not.toBeNull();
    expect(viewer.root.querySelector('.text-viewer__doc-label')).toBeNull();
  });
});
