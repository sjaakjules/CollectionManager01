interface ImageRectangle {
  left: number;
  top: number;
  width: number;
  height: number;
}

export function fittedImageRectangle(box: ImageRectangle, width: number, height: number): ImageRectangle {
  const scale = Math.min(box.width / width, box.height / height);
  const fittedWidth = width * scale;
  const fittedHeight = height * scale;
  return {
    left: box.left + (box.width - fittedWidth) / 2,
    top: box.top + (box.height - fittedHeight) / 2,
    width: fittedWidth,
    height: fittedHeight,
  };
}

export function hoveredFrameIndex(clientX: number, fitted: ImageRectangle, count: number): number {
  const position = (clientX - fitted.left) / Math.max(1, fitted.width);
  return Math.max(0, Math.min(count - 1, Math.floor(position * count)));
}
