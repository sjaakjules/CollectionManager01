import type { CSSProperties } from "react";
import type { ThresholdGroup } from "@/data/dataModels";
import {
  DECK_ELEMENT_ICONS,
  DECK_ELEMENT_LABELS,
  type DeckElementId,
} from "@/ui/deckDisplay";

export type ElementIconId = DeckElementId | Extract<ThresholdGroup, "multiple" | "none">;

const EXTRA_ELEMENT_ICONS: Record<Extract<ElementIconId, "multiple" | "none">, string> = {
  multiple: "/assets/buttons/multi.png",
  none: "/assets/buttons/none.png",
};

const EXTRA_ELEMENT_LABELS: Record<Extract<ElementIconId, "multiple" | "none">, string> = {
  multiple: "Multiple",
  none: "None",
};

const ELEMENT_ICON_PATHS: Record<ElementIconId, string> = {
  ...DECK_ELEMENT_ICONS,
  ...EXTRA_ELEMENT_ICONS,
};

export const ELEMENT_ICON_LABELS: Record<ElementIconId, string> = {
  ...DECK_ELEMENT_LABELS,
  ...EXTRA_ELEMENT_LABELS,
};

interface ElementIconProps {
  element: ElementIconId;
  decorative?: boolean;
  className?: string;
}

type ElementIconStyle = CSSProperties & {
  "--element-symbol-mask": string;
};

export function ElementIcon({
  element,
  decorative = false,
  className = "",
}: ElementIconProps) {
  const label = ELEMENT_ICON_LABELS[element];
  const style: ElementIconStyle = {
    "--element-symbol-mask": `url("${ELEMENT_ICON_PATHS[element]}")`,
  };
  const classes = ["element-symbol", `element-symbol-${element}`, className]
    .filter(Boolean)
    .join(" ");

  return (
    <span
      className={classes}
      style={style}
      role={decorative ? undefined : "img"}
      aria-label={decorative ? undefined : label}
      aria-hidden={decorative ? true : undefined}
      title={decorative ? undefined : label}
    />
  );
}
