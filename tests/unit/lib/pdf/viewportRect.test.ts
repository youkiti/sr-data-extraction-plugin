import { toDisplayRect } from '../../../../src/lib/pdf/viewportRect';

describe('toDisplayRect', () => {
  // 共通の入力矩形（原点左下のユーザー空間）
  const rect = { x: 10, y: 20, width: 30, height: 5 };

  test('回転なし（0 度）: y 軸だけ反転する', () => {
    expect(toDisplayRect(rect, { width: 612, height: 792, rotation: 0 })).toEqual({
      left: 10,
      top: 792 - 20 - 5,
      width: 30,
      height: 5,
    });
  });

  test('90 度: x/y と幅/高さが入れ替わる（生 y → 表示 left / 生 x → 表示 top）', () => {
    // 縦置き 612x792 を /Rotate 90 で表示すると 792x612（表示寸法を渡す）
    expect(toDisplayRect(rect, { width: 792, height: 612, rotation: 90 })).toEqual({
      left: 20,
      top: 10,
      width: 5,
      height: 30,
    });
  });

  test('180 度: x 軸だけ反転する', () => {
    expect(toDisplayRect(rect, { width: 612, height: 792, rotation: 180 })).toEqual({
      left: 612 - 10 - 30,
      top: 20,
      width: 30,
      height: 5,
    });
  });

  test('270 度: 両軸反転 + 幅/高さの入れ替え', () => {
    expect(toDisplayRect(rect, { width: 792, height: 612, rotation: 270 })).toEqual({
      left: 792 - 20 - 5,
      top: 612 - 10 - 30,
      width: 5,
      height: 30,
    });
  });
});
