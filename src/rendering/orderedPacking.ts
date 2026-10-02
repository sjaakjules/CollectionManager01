export interface PackedBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** Choose shelf breaks by fitted size, keeping the user's reading order intact. */
export function packOrderedGroups(
  sizes: ReadonlyArray<{ width: number; height: number }>,
  aspect: number,
  gap: number,
): PackedBox[] {
  const target = Number.isFinite(aspect) && aspect > 0 ? aspect : 16 / 9;
  let best: PackedBox[] = [];
  let bestScore = Infinity;
  // Bounded even for a catalogue grouped by individual card names. Each pass
  // is linear; this runs on layout changes, never on an animation frame.
  for (let columns = 1; columns <= Math.min(sizes.length, 32); columns++) {
    let x = 0, y = 0, rowHeight = 0, width = 0;
    const boxes = sizes.map((size, index) => {
      if (index > 0 && index % columns === 0) {
        y += rowHeight + gap;
        x = 0;
        rowHeight = 0;
      }
      const box = { ...size, x, y };
      x += size.width + gap;
      width = Math.max(width, x - gap);
      rowHeight = Math.max(rowHeight, size.height);
      return box;
    });
    const height = y + rowHeight;
    // Minimizing fitted height maximizes the size of cards in the overview.
    // The small area tie-break avoids excess whitespace at equal fit sizes.
    const score = Math.max(width / target, height) + Math.sqrt(width * height) * 0.025;
    if (score < bestScore) {
      bestScore = score;
      best = boxes;
    }
  }
  return best;
}
