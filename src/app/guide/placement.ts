export interface Size { width: number; height: number }
export interface Box { top: number; bottom: number; left: number; right: number }
export interface CardPlacementInput {
  viewport: Size;
  card: Size;
  target: Box | null;
  margin: number;
  gap: number;
  pad: number;
}

export function intersectsViewport(box: Box, viewport: Size): boolean {
  return box.bottom > 0 && box.top < viewport.height && box.right > 0 && box.left < viewport.width;
}

/** 下 → 上 → 左 → 右 → 画面下端の順で配置し、画面内に収める。 */
export function computeTourCardPosition(input: CardPlacementInput): { left: number; top: number } {
  const { viewport, card, target, margin, gap, pad } = input;
  const clamp = (value: number, limit: number): number => Math.max(margin, Math.min(value, limit - margin));
  const topLimit = viewport.height - card.height;
  const leftLimit = viewport.width - card.width;
  const bottom = clamp(topLimit, topLimit);
  if (!target || !intersectsViewport(target, viewport)) return { left: clamp(leftLimit, leftLimit), top: bottom };
  const left = clamp(target.left, leftLimit);
  const below = target.bottom + pad + gap;
  if (below + card.height <= viewport.height - margin) return { left, top: clamp(below, topLimit) };
  const above = target.top - pad - gap - card.height;
  if (above >= margin) return { left, top: clamp(above, topLimit) };
  const sideTop = clamp(target.top - pad, topLimit);
  const before = target.left - pad - gap - card.width;
  if (before >= margin) return { left: before, top: sideTop };
  const after = target.right + pad + gap;
  if (after + card.width <= viewport.width - margin) return { left: after, top: sideTop };
  return { left, top: bottom };
}
