// ストア購読の再描画（route 全体の replaceChildren）で、キャッシュ済み DOM が一度
// document から外れて付け直されると、ブラウザは内側スクロールコンテナの scrollTop /
// scrollLeft を 0 にリセットする（issue #192: 判定を保存するたびに検証パネルの
// スクロールが先頭へ戻る）。`data-preserve-scroll` 属性を付けたコンテナの位置を
// 再描画をまたいで退避・復元する汎用機構。documentElement の退避・復元（bootstrap の
// 既存挙動）とは独立で、同一 DOM インスタンスが再接続される要素だけが復元対象になる

/** 退避・復元の対象マーカー（スクロールコンテナ側が自身に付ける） */
export const PRESERVE_SCROLL_ATTRIBUTE = 'data-preserve-scroll';

export interface ScrollSnapshot {
  element: Element;
  top: number;
  left: number;
}

/** 再描画前に呼ぶ: マーカー付き要素の参照とスクロール位置を退避する */
export function captureScrollPositions(root: ParentNode): ScrollSnapshot[] {
  return Array.from(root.querySelectorAll(`[${PRESERVE_SCROLL_ATTRIBUTE}]`)).map((element) => ({
    element,
    top: element.scrollTop,
    left: element.scrollLeft,
  }));
}

/**
 * 再描画後に呼ぶ: 同一参照がまだ document に接続されている要素だけ位置を復元する。
 * 再描画で作り直された（= 旧インスタンスが破棄された）要素は復元しない — 新インスタンスは
 * 初期位置から始まるのが正しい（キャッシュパネルのような同一インスタンス再接続だけを救う）
 */
export function restoreScrollPositions(snapshots: ScrollSnapshot[]): void {
  for (const snapshot of snapshots) {
    if (!snapshot.element.isConnected) {
      continue;
    }
    snapshot.element.scrollTop = snapshot.top;
    snapshot.element.scrollLeft = snapshot.left;
  }
}
