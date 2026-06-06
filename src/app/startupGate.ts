const STARTUP_GATE_PARAMS = ["debugSplash", "holdStartup", "pauseStartup"];
const DISABLED_VALUES = new Set(["0", "false", "off", "no"]);

export function isStartupGateEnabled(search: string): boolean {
  const params = new URLSearchParams(search);

  return STARTUP_GATE_PARAMS.some((param) => {
    if (!params.has(param)) return false;
    const value = params.get(param)?.trim().toLowerCase() ?? "";
    return !DISABLED_VALUES.has(value);
  });
}

