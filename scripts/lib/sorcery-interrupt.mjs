/** Abort CLI requests first; callers flush and exit only after the lock releases. */
export function sorceryInterrupt(enabled) {
  const controller = new AbortController();
  let exitCode = 130;
  const interrupt = () => controller.abort(new DOMException('Interrupted', 'AbortError'));
  const terminate = () => {
    exitCode = 143;
    interrupt();
  };
  if (enabled) {
    process.on('SIGINT', interrupt);
    process.on('SIGTERM', terminate);
  }
  return {
    signal: controller.signal,
    get exitCode() { return exitCode; },
    dispose() {
      if (!enabled) return;
      process.removeListener('SIGINT', interrupt);
      process.removeListener('SIGTERM', terminate);
    },
  };
}
