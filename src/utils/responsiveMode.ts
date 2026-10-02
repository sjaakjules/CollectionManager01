export type ResponsiveUiMode = 'phone' | 'desktop';

export function detectResponsiveUiMode(): ResponsiveUiMode {
  if (typeof window === 'undefined') return 'desktop';
  const coarse = window.matchMedia?.('(pointer: coarse)').matches ?? false;
  const noHover = window.matchMedia?.('(hover: none)').matches ?? false;
  const short = Math.min(window.innerWidth, window.innerHeight);
  const long = Math.max(window.innerWidth, window.innerHeight);
  return ((coarse || noHover) && short <= 820) || (short <= 480 && long <= 960) ? 'phone' : 'desktop';
}
