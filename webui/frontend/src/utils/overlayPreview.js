const anchorPosition = (size, elementSize, align, offset) => {
  if (align === "right" || align === "bottom") return size - elementSize - offset;
  if (align === "center") return Math.trunc(size / 2) - Math.trunc(elementSize / 2) + offset;
  return offset;
};

export function getPreviewSpriteBounds(sprite, offset, canvasW, canvasH) {
  const source = sprite.placement;
  const target = offset || source;
  const left = sprite.left
    + anchorPosition(canvasW, sprite.width, target.align, Number(target.x) || 0)
    - anchorPosition(canvasW, sprite.width, source.align, Number(source.x) || 0);
  const top = sprite.top
    + anchorPosition(canvasH, sprite.height, target.valign, Number(target.y) || 0)
    - anchorPosition(canvasH, sprite.height, source.valign, Number(source.y) || 0);
  return {
    key: sprite.key, canvasW, canvasH, left, top,
    right: left + sprite.width, bottom: top + sprite.height,
    w: sprite.width, h: sprite.height,
    cx: left + sprite.width / 2, cy: top + sprite.height / 2,
    leftPct: left / canvasW * 100, rightPct: (left + sprite.width) / canvasW * 100,
    topPct: top / canvasH * 100, bottomPct: (top + sprite.height) / canvasH * 100,
  };
}

export function getPreviewSpriteOffset(sprite, left, top, align, valign, canvasW, canvasH) {
  const source = sprite.placement;
  const biasX = sprite.left - anchorPosition(canvasW, sprite.width, source.align, Number(source.x) || 0);
  const biasY = sprite.top - anchorPosition(canvasH, sprite.height, source.valign, Number(source.y) || 0);
  const offsetFor = (position, size, elementSize, alignment) => {
    if (alignment === "right" || alignment === "bottom") return size - elementSize - position;
    if (alignment === "center") return position - Math.trunc(size / 2) + Math.trunc(elementSize / 2);
    return position;
  };
  return {
    x: Math.round(offsetFor(left - biasX, canvasW, sprite.width, align)),
    y: Math.round(offsetFor(top - biasY, canvasH, sprite.height, valign)),
  };
}