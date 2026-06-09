import type { CanvasArea } from "@/canvas/canvasAreas";
import type { Deck } from "@/data/dataModels";
import type { QuickTransferDeckTarget } from "@/rendering/PixiStage";
import { getDeckDisplayName } from "@/ui/deckDisplay";

export function buildQuickTransferDeckTargets(
  decks: Deck[],
  canvasAreas: CanvasArea[],
): QuickTransferDeckTarget[] {
  const deckAreasByDeckId = new Map<string, CanvasArea>();
  for (const area of canvasAreas) {
    if (area.type === "deck" && area.deckId) {
      deckAreasByDeckId.set(area.deckId, area);
    }
  }

  return decks.map((deck) => {
    const area = deckAreasByDeckId.get(deck.id) ?? null;
    return {
      id: `deck:${deck.id}`,
      deckId: deck.id,
      canvasAreaId: area?.id ?? null,
      label: getDeckDisplayName(deck, area),
    };
  });
}
