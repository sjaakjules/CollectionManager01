import { useEffect, useState } from "react";

export type ResponsiveUiMode = "phone" | "desktop";

function detectResponsiveUiMode(): ResponsiveUiMode {
  if (typeof window === "undefined") return "desktop";
  const coarsePointer = window.matchMedia?.("(pointer: coarse)").matches ?? false;
  const hoverNone = window.matchMedia?.("(hover: none)").matches ?? false;
  const shortSide = Math.min(window.innerWidth, window.innerHeight);
  const longSide = Math.max(window.innerWidth, window.innerHeight);
  const phoneSizedViewport = shortSide <= 480 && longSide <= 960;
  return ((coarsePointer || hoverNone) && shortSide <= 820) || phoneSizedViewport
    ? "phone"
    : "desktop";
}

export function useResponsiveUiMode(): ResponsiveUiMode {
  const [mode, setMode] = useState<ResponsiveUiMode>(() => detectResponsiveUiMode());

  useEffect(() => {
    const update = () => setMode(detectResponsiveUiMode());
    update();
    window.addEventListener("resize", update);
    window.visualViewport?.addEventListener("resize", update);
    const pointerQuery = window.matchMedia?.("(pointer: coarse)");
    const hoverQuery = window.matchMedia?.("(hover: none)");
    pointerQuery?.addEventListener("change", update);
    hoverQuery?.addEventListener("change", update);
    return () => {
      window.removeEventListener("resize", update);
      window.visualViewport?.removeEventListener("resize", update);
      pointerQuery?.removeEventListener("change", update);
      hoverQuery?.removeEventListener("change", update);
    };
  }, []);

  return mode;
}
