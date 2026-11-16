/** Exact, reviewed release corrections only; never fuzzy-match a saved card. */
export function canonicalCardName(name: string): string {
  if (typeof name !== 'string') return name; // The storage sanitizer handles incomplete old entries.
  return name.trim().toLowerCase() === 'reed-cord measurer' ? 'Reed Cord Measurer' : name;
}

/** Storage-only migration. This retired prefix is never used for networking. */
export function canonicalDeckId(id: string): string {
  return id.startsWith('curiosa-') ? `sorcery-${id.slice(8)}` : id;
}
