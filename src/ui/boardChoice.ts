import type { ActiveBoard } from "@/data/dataModels";

export type DeckAddBoard = Extract<ActiveBoard, "mainboard" | "sideboard" | "maybeboard">;

export interface BoardChoiceOption {
  board: DeckAddBoard;
  label: string;
}

export const BOARD_CHOICE_OPTIONS: BoardChoiceOption[] = [
  { board: "mainboard", label: "Main" },
  { board: "sideboard", label: "Side" },
  { board: "maybeboard", label: "Maybe" },
];

export function getBoardChoiceLabel(board: DeckAddBoard): string {
  return BOARD_CHOICE_OPTIONS.find((option) => option.board === board)?.label ?? "Main";
}
