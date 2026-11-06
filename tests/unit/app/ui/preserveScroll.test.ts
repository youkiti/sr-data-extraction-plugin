// ストア再描画をまたぐ内側スクロールコンテナの退避・復元（issue #192）。
// jsdom は detach → reattach でスクロール位置をリセットしないため、reattach 後の
// リセット（scrollTop = 0）はテスト側で明示的に模して復元だけを検証する
import {
  captureScrollPositions,
  restoreScrollPositions,
  PRESERVE_SCROLL_ATTRIBUTE,
} from '../../../../src/app/ui/preserveScroll';

function preserveTarget(): HTMLElement {
  const node = document.createElement('div');
  node.setAttribute(PRESERVE_SCROLL_ATTRIBUTE, '');
  return node;
}

afterEach(() => {
  document.body.replaceChildren();
});

describe('captureScrollPositions', () => {
  test('data-preserve-scroll 付き要素の参照とスクロール位置を退避する（マーカーなしは対象外）', () => {
    const preserved = preserveTarget();
    preserved.scrollTop = 120;
    preserved.scrollLeft = 40;
    const unmarked = document.createElement('div');
    unmarked.scrollTop = 999;
    document.body.append(preserved, unmarked);

    const snapshots = captureScrollPositions(document);
    expect(snapshots).toEqual([{ element: preserved, key: '', top: 120, left: 40 }]);
  });

  test('対象要素が無ければ空配列', () => {
    expect(captureScrollPositions(document)).toEqual([]);
  });
});

describe('restoreScrollPositions', () => {
  test('キー付き要素を作り直すと同じ文書の同じキーへ縦横の位置を引き継ぐ', () => {
    const ownerDocument = document.implementation.createHTMLDocument();
    const preserved = ownerDocument.createElement('div');
    preserved.setAttribute(PRESERVE_SCROLL_ATTRIBUTE, 'editor["key"]');
    preserved.scrollTop = 1500;
    preserved.scrollLeft = 300;
    ownerDocument.body.append(preserved);
    const snapshots = captureScrollPositions(ownerDocument);

    const unrelated = ownerDocument.createElement('div');
    unrelated.setAttribute(PRESERVE_SCROLL_ATTRIBUTE, 'other');
    const replacement = preserved.cloneNode() as HTMLElement;
    ownerDocument.body.replaceChildren(unrelated, replacement);

    restoreScrollPositions(snapshots);
    expect(replacement.scrollTop).toBe(1500);
    expect(replacement.scrollLeft).toBe(300);
    expect(unrelated.scrollTop).toBe(0);
    expect(unrelated.scrollLeft).toBe(0);
  });

  test('空のキーの要素を作り直しても新しい要素へ復元しない', () => {
    const preserved = preserveTarget();
    preserved.scrollTop = 120;
    preserved.scrollLeft = 40;
    document.body.append(preserved);
    const snapshots = captureScrollPositions(document);

    const replacement = preserveTarget();
    document.body.replaceChildren(replacement);

    restoreScrollPositions(snapshots);
    expect(replacement.scrollTop).toBe(0);
    expect(replacement.scrollLeft).toBe(0);
  });

  test('一致するキーが無ければ他の要素の位置を変えない', () => {
    const preserved = preserveTarget();
    preserved.setAttribute(PRESERVE_SCROLL_ATTRIBUTE, 'schema-editor');
    preserved.scrollTop = 1500;
    preserved.scrollLeft = 300;
    document.body.append(preserved);
    const snapshots = captureScrollPositions(document);

    const replacement = preserveTarget();
    replacement.setAttribute(PRESERVE_SCROLL_ATTRIBUTE, 'other');
    replacement.scrollTop = 20;
    replacement.scrollLeft = 10;
    document.body.replaceChildren(replacement);

    restoreScrollPositions(snapshots);
    expect(replacement.scrollTop).toBe(20);
    expect(replacement.scrollLeft).toBe(10);
  });

  test('接続中の同一インスタンスへスクロール位置を復元する', () => {
    const preserved = preserveTarget();
    preserved.scrollTop = 120;
    preserved.scrollLeft = 40;
    document.body.append(preserved);
    const snapshots = captureScrollPositions(document);

    // 再描画（detach → reattach）でブラウザが位置を 0 にリセットした状況を模す
    preserved.remove();
    document.body.append(preserved);
    preserved.scrollTop = 0;
    preserved.scrollLeft = 0;

    restoreScrollPositions(snapshots);
    expect(preserved.scrollTop).toBe(120);
    expect(preserved.scrollLeft).toBe(40);
  });

  test('再描画で document へ戻らなかった要素（作り直し・破棄）は復元しない', () => {
    const discarded = preserveTarget();
    discarded.scrollTop = 80;
    document.body.append(discarded);
    const snapshots = captureScrollPositions(document);

    discarded.remove();
    discarded.scrollTop = 0;

    restoreScrollPositions(snapshots);
    expect(discarded.scrollTop).toBe(0);
  });
});
