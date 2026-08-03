"use client";

import { forwardRef } from "react";
import { motion, type Variants } from "framer-motion";
import { cn } from "@platform/ui";
import type { FabMenuItem } from "./types";

export const FAB_ITEM_SIZE = 36;

export const fabItemVariants: Variants = {
  closed: (labelSide: "left" | "right") => ({
    opacity: 0,
    scale: 0.4,
    x: labelSide === "left" ? 12 : -12,
  }),
  open: {
    opacity: 1,
    scale: 1,
    x: 0,
    transition: { type: "spring", stiffness: 420, damping: 28 },
  },
  exit: (labelSide: "left" | "right") => ({
    opacity: 0,
    scale: 0.4,
    x: labelSide === "left" ? 12 : -12,
    transition: { duration: 0.12 },
  }),
};

interface FabItemProps {
  item: FabMenuItem;
  labelSide: "left" | "right";
  tabIndex: number;
  onActivate: (item: FabMenuItem) => void;
  onKeyDown: (event: React.KeyboardEvent<HTMLButtonElement>) => void;
  /** Positioning offset from the FabMenu wrapper (top/bottom/left/right). */
  style?: React.CSSProperties;
}

/** A single mini FAB: circular icon button + pill label, laid out so the label never overlaps the button. */
export const FabItem = forwardRef<HTMLButtonElement, FabItemProps>(function FabItem(
  { item, labelSide, tabIndex, onActivate, onKeyDown, style },
  ref
) {
  return (
    <motion.div
      custom={labelSide}
      variants={fabItemVariants}
      onClick={() => !item.disabled && onActivate(item)}
      className={cn(
        "pointer-events-auto absolute flex items-center gap-3",
        labelSide === "left" ? "right-0 flex-row" : "left-0 flex-row-reverse",
        item.disabled ? "cursor-not-allowed" : "cursor-pointer"
      )}
      style={{ width: "max-content", ...style }}
    >
      <span
        aria-hidden="true"
        className={cn(
          "select-none whitespace-nowrap rounded-full border border-border bg-popover px-3 py-1.5 text-xs font-semibold text-popover-foreground shadow-md transition-colors",
          item.disabled ? "opacity-50" : "hover:bg-accent hover:text-accent-foreground"
        )}
      >
        {item.label}
      </span>
      <button
        ref={ref}
        type="button"
        role="menuitem"
        id={`fab-menu-item-${item.id}`}
        aria-label={item.label}
        tabIndex={tabIndex}
        disabled={item.disabled}
        onClick={(e) => {
          e.stopPropagation();
          onActivate(item);
        }}
        onKeyDown={onKeyDown}
        className={cn(
          "flex shrink-0 items-center justify-center rounded-full border border-border bg-card text-card-foreground shadow-lg transition-colors",
          "hover:bg-accent hover:text-accent-foreground",
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background",
          "active:scale-90",
          "disabled:pointer-events-none disabled:opacity-50"
        )}
        style={{ width: FAB_ITEM_SIZE, height: FAB_ITEM_SIZE }}
      >
        <span className="flex items-center justify-center [&_svg]:h-4 [&_svg]:w-4">{item.icon}</span>
      </button>
    </motion.div>
  );
});
