// マッチ文字範囲 → テキスト層 span 座標への写像（architecture.md §2.3 の最終段）。
// ページ生テキスト上の文字範囲を、範囲と重なる item ごとの矩形（PDF ユーザー空間）へ変換する。
// pdfViewer はこの矩形を viewport 変換してオーバーレイ描画する
import type { CharRange } from '../../domain/anchor';
import type { TextLayerItem } from '../../domain/textLayer';

/** ハイライト矩形（PDF ユーザー空間・ポイント単位。原点は左下） */
export interface HighlightRect {
  /** 由来 item の index（デバッグ・fixture 照合用） */
  itemIndex: number;
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * 文字範囲と重なる item ごとに矩形を返す。item 内の部分一致は文字数比例で幅を按分する
 * （等幅近似）。MVP は水平テキストのみ対応し、transform の平行移動成分（e, f）を原点に使う
 */
export function highlightMap(items: readonly TextLayerItem[], range: CharRange): HighlightRect[] {
  const rects: HighlightRect[] = [];
  if (range.start >= range.end) {
    return rects;
  }
  items.forEach((item, itemIndex) => {
    const len = item.str.length;
    if (len === 0) {
      return; // 空 item（改行のみ等）は矩形を持たない
    }
    const itemStart = item.charStart;
    const overlapStart = Math.max(range.start, itemStart);
    const overlapEnd = Math.min(range.end, itemStart + len);
    if (overlapStart >= overlapEnd) {
      return;
    }
    const startFraction = (overlapStart - itemStart) / len;
    const endFraction = (overlapEnd - itemStart) / len;
    rects.push({
      itemIndex,
      x: item.transform[4] + item.width * startFraction,
      y: item.transform[5],
      width: item.width * (endFraction - startFraction),
      height: item.height,
    });
  });
  return rects;
}
