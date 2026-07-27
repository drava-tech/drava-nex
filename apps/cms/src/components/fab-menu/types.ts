import type { ReactNode } from "react";

export interface FabMenuItem {
  /** Stable identifier — also used as the React key. */
  id: string;
  /** Text shown in the label pill next to the mini FAB. */
  label: string;
  /** Icon rendered inside the circular mini FAB (e.g. a lucide-react icon element). */
  icon: ReactNode;
  /** Invoked when this item is activated (click, Enter, or Space). Purely a callback — no business logic lives here. */
  onClick?: () => void;
  /** Disables interaction and dims the item. */
  disabled?: boolean;
}

export type FabMenuPosition = "bottom-right" | "bottom-left" | "top-right" | "top-left";

export type FabMenuDirection = "up" | "down" | "left" | "right";
