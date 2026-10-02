import { useEffect, useState } from "react";

import { detectResponsiveUiMode, type ResponsiveUiMode } from '@/utils/responsiveMode';
export type { ResponsiveUiMode } from '@/utils/responsiveMode';

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
