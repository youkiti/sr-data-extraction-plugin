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
 * （等幅近似）。回転テキスト（/Rotate 90 の表ページ等。item transform の a, b, c, d が
 * 回転を含む）は、基線方向へ按分した区間 + 上方向の押し出しの外接矩形として扱う
 * （90 度単位の回転では正確、斜めの透かし等は bbox 近似）
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
    // 基線方向（読み進む向き）と上方向の単位ベクトル。退化した transform は水平テキスト扱い
    const [a, b, c, d, e, f] = item.transform;
    const advanceNorm = Math.hypot(a, b);
    const upNorm = Math.hypot(c, d);
    const dirX = advanceNorm === 0 ? 1 : a / advanceNorm;
    const dirY = advanceNorm === 0 ? 0 : b / advanceNorm;
    const upX = upNorm === 0 ? 0 : c / upNorm;
    const upY = upNorm === 0 ? 1 : d / upNorm;
    // 按分した基線区間の両端 + 上方向 height ぶんの押し出しで外接矩形を作る
    const x0 = e + dirX * item.width * startFraction;
    const y0 = f + dirY * item.width * startFraction;
    const x1 = e + dirX * item.width * endFraction + upX * item.height;
    const y1 = f + dirY * item.width * endFraction + upY * item.height;
    rects.push({
      itemIndex,
      x: Math.min(x0, x1),
      y: Math.min(y0, y1),
      width: Math.abs(x1 - x0),
      height: Math.abs(y1 - y0),
    });
  });
  return rects;
}
