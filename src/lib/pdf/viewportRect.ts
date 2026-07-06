// PDF ユーザー空間の矩形 → 表示座標（CSS 左上原点・scale 1）への変換。
// pdfjs の PageViewport 変換（ページ回転込み）を 90 度単位で再現する。
// width / height は TextLayerPage の表示寸法（回転適用後）を渡すこと
import type { PageRotation } from '../../domain/textLayer';

/** 変換対象の矩形（原点左下の PDF ユーザー空間・ポイント単位） */
export interface UserSpaceRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** 表示ページの寸法と回転（TextLayerPage の該当フィールドと同じ） */
export interface DisplayPageDims {
  width: number;
  height: number;
  rotation: PageRotation;
}

/** CSS 配置用の矩形（原点左上・scale 1 のポイント単位） */
export interface DisplayRect {
  left: number;
  top: number;
  width: number;
  height: number;
}

/**
 * ユーザー空間矩形を表示座標へ写像する。回転別の式は pdfjs の viewport transform に対応:
 * 0°=[1,0,0,-1,0,H] / 90°=[0,1,1,0,0,0] / 180°=[-1,0,0,1,W,0] / 270°=[0,-1,-1,0,W,H]
 */
export function toDisplayRect(rect: UserSpaceRect, page: DisplayPageDims): DisplayRect {
  switch (page.rotation) {
    case 90:
      return { left: rect.y, top: rect.x, width: rect.height, height: rect.width };
    case 180:
      return {
        left: page.width - rect.x - rect.width,
        top: rect.y,
        width: rect.width,
        height: rect.height,
      };
    case 270:
      return {
        left: page.width - rect.y - rect.height,
        top: page.height - rect.x - rect.width,
        width: rect.height,
        height: rect.width,
      };
    default:
      return {
        left: rect.x,
        top: page.height - rect.y - rect.height,
        width: rect.width,
        height: rect.height,
      };
  }
}
