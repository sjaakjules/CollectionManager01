/** Desktop selection policy shared by canvas cards and cards inside decks. */
export function getCardClickSelection(options: {
  clickedKey: string;
  stackKeys: string[];
  selectedKeys: ReadonlySet<string>;
  additive?: boolean;
  doubleClick?: boolean;
  dragging?: boolean;
}): string[] {
  const { clickedKey, stackKeys, selectedKeys, additive, doubleClick, dragging } = options;
  const selected = selectedKeys.has(clickedKey);
  // Starting a drag must keep an existing marquee/stack selection intact.
  if (dragging && selected) return [...selectedKeys];
  if (additive) {
    const next = new Set(selectedKeys);
    if (selected && !dragging) next.delete(clickedKey);
    else next.add(clickedKey);
    return [...next];
  }
  if (doubleClick || !selected) return stackKeys.length ? stackKeys : [clickedKey];
  return [clickedKey];
}
