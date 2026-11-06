// ストア購読の再描画（route 全体の replaceChildren）で、キャッシュ済み DOM が一度
// document から外れて付け直されると、ブラウザは内側スクロールコンテナの scrollTop /
// scrollLeft を 0 にリセットする（issue #192: 判定を保存するたびに検証パネルの
// スクロールが先頭へ戻る）。`data-preserve-scroll` 属性を付けたコンテナの位置を
// 再描画をまたいで退避・復元する汎用機構。documentElement の退避・復元（bootstrap の
// 既存挙動）とは独立。属性値が空なら同一 DOM インスタンスが再接続される要素だけを
// 復元する。空でない属性値はキーとして扱い、毎回作り直される要素（表のデザインの
// 編集表など）にも、同じ文書内で同じキーを持つ新しい要素へ位置を引き継ぐ。

/** 退避・復元の対象マーカー（スクロールコンテナ側が自身に付ける） */
export const PRESERVE_SCROLL_ATTRIBUTE = 'data-preserve-scroll';

export interface ScrollSnapshot {
  element: Element;
  key: string;
  top: number;
  left: number;
}

/** 再描画前に呼ぶ: マーカー付き要素の参照とスクロール位置を退避する */
export function captureScrollPositions(root: ParentNode): ScrollSnapshot[] {
  return Array.from(root.querySelectorAll(`[${PRESERVE_SCROLL_ATTRIBUTE}]`)).map((element) => ({
    element,
    key: element.getAttribute(PRESERVE_SCROLL_ATTRIBUTE)!,
    top: element.scrollTop,
    left: element.scrollLeft,
  }));
}

/**
 * 再描画後に呼ぶ: 接続中の同一インスタンスへ位置を復元する。
 * 切り離されていてキーが空でなければ、同じ文書内の同じキーを持つ要素へ復元する。
 */
export function restoreScrollPositions(snapshots: ScrollSnapshot[]): void {
  for (const snapshot of snapshots) {
    let element: Element | undefined = snapshot.element;
    if (!element.isConnected) {
      if (snapshot.key === '') {
        continue;
      }
      element = Array.from(
        element.ownerDocument.querySelectorAll(`[${PRESERVE_SCROLL_ATTRIBUTE}]`),
      ).find((candidate) => candidate.getAttribute(PRESERVE_SCROLL_ATTRIBUTE) === snapshot.key);
    }
    if (!element) {
      continue;
    }
    element.scrollTop = snapshot.top;
    element.scrollLeft = snapshot.left;
  }
}
