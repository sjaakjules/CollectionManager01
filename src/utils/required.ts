/** Check a layout invariant rather than silently dereferencing an absent entry. */
export function required<T>(value: T | null | undefined): T {
  if (value == null) throw new Error('Required layout entry is missing');
  return value;
}
