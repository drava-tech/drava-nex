"use client";

import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { Plus } from "lucide-react";
import { cn } from "@platform/ui";
import { FabItem, FAB_ITEM_SIZE } from "./fab-item";
import type { FabMenuDirection, FabMenuItem, FabMenuPosition } from "./types";

const MAIN_FAB_SIZE = 44;
/** Gap between the edges of consecutive FABs — keeps spacing uniform regardless of item count. */
const ITEM_SPACING = 16;
const STEP = FAB_ITEM_SIZE + ITEM_SPACING;

const POSITION_CLASSES: Record<FabMenuPosition, string> = {
  "bottom-right": "bottom-6 right-6",
  "bottom-left": "bottom-6 left-6",
  "top-right": "top-6 right-6",
  "top-left": "top-6 left-6",
};

export interface FabMenuProps {
  /** The mini actions revealed when the menu opens. Unlimited length — spacing/layout adapt automatically. */
  items: FabMenuItem[];
  /** Which screen corner the FAB anchors to. */
  position?: FabMenuPosition;
  /** Which way the mini FABs fan out from the main button. */
  direction?: FabMenuDirection;
  /** Icon shown on the closed main FAB (rotates 45° into an "×" on open). Defaults to a "+". */
  icon?: React.ReactNode;
  /** Accessible name for the main trigger button. */
  label?: string;
  /** Controlled open state. Omit to let the component manage its own state. */
  open?: boolean;
  defaultOpen?: boolean;
  onOpenChange?: (open: boolean) => void;
  className?: string;
}

/**
 * Reusable Material-style Speed Dial FAB. Purely presentational — item
 * `onClick` callbacks are the only hook into application logic.
 */
export function FabMenu({
  items,
  position = "bottom-right",
  direction = "up",
  icon,
  label = "Actions",
  open: openProp,
  defaultOpen = false,
  onOpenChange,
  className,
}: FabMenuProps) {
  const [internalOpen, setInternalOpen] = useState(defaultOpen);
  const isControlled = openProp !== undefined;
  const open = isControlled ? openProp : internalOpen;

  const setOpen = useCallback(
    (next: boolean) => {
      if (!isControlled) setInternalOpen(next);
      onOpenChange?.(next);
    },
    [isControlled, onOpenChange]
  );

  const menuId = useId();
  const triggerRef = useRef<HTMLButtonElement>(null);
  const itemRefs = useRef<(HTMLButtonElement | null)[]>([]);
  const wrapperRef = useRef<HTMLDivElement>(null);

  const labelSide: "left" | "right" = position.includes("right") ? "left" : "right";
  const horizontalSide: "left" | "right" = position.includes("right") ? "right" : "left";
  const isVertical = direction === "up" || direction === "down";

  // Click outside closes the menu.
  useEffect(() => {
    if (!open) return;
    const onPointerDown = (e: PointerEvent) => {
      if (wrapperRef.current && !wrapperRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener("pointerdown", onPointerDown);
    return () => document.removeEventListener("pointerdown", onPointerDown);
  }, [open, setOpen]);

  // Escape closes and returns focus to the trigger.
  useEffect(() => {
    if (!open) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setOpen(false);
        triggerRef.current?.focus();
      }
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [open, setOpen]);

  // Focus trap entry point: move focus onto the first item once expanded.
  useEffect(() => {
    if (!open) return;
    const raf = requestAnimationFrame(() => itemRefs.current[0]?.focus());
    return () => cancelAnimationFrame(raf);
  }, [open]);

  const handleActivate = useCallback(
    (item: FabMenuItem) => {
      if (item.disabled) return;
      item.onClick?.();
      setOpen(false);
      triggerRef.current?.focus();
    },
    [setOpen]
  );

  const handleTriggerKeyDown = (e: React.KeyboardEvent<HTMLButtonElement>) => {
    const opensWith = direction === "down" ? "ArrowDown" : direction === "left" ? "ArrowLeft" : direction === "right" ? "ArrowRight" : "ArrowUp";
    if (e.key === opensWith) {
      e.preventDefault();
      if (!open) setOpen(true);
      requestAnimationFrame(() => itemRefs.current[0]?.focus());
    }
  };

  // Roving keyboard navigation between mini FABs, oriented to match `direction`.
  const handleItemKeyDown = useCallback(
    (index: number) => (e: React.KeyboardEvent<HTMLButtonElement>) => {
      const count = items.length;
      const forwardKey = direction === "up" ? "ArrowUp" : direction === "down" ? "ArrowDown" : direction === "left" ? "ArrowLeft" : "ArrowRight";
      const backwardKey = direction === "up" ? "ArrowDown" : direction === "down" ? "ArrowUp" : direction === "left" ? "ArrowRight" : "ArrowLeft";

      if (e.key === forwardKey) {
        e.preventDefault();
        itemRefs.current[(index + 1) % count]?.focus();
      } else if (e.key === backwardKey) {
        e.preventDefault();
        if (index === 0) triggerRef.current?.focus();
        else itemRefs.current[index - 1]?.focus();
      } else if (e.key === "Home") {
        e.preventDefault();
        itemRefs.current[0]?.focus();
      } else if (e.key === "End") {
        e.preventDefault();
        itemRefs.current[count - 1]?.focus();
      } else if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        handleActivate(items[index]!);
      } else if (e.key === "Tab") {
        setOpen(false);
      }
    },
    [items, direction, handleActivate, setOpen]
  );

  const itemStyles = useMemo<React.CSSProperties[]>(() => {
    return items.map((_, index) => {
      const offset = MAIN_FAB_SIZE + ITEM_SPACING + index * STEP;
      if (isVertical) {
        return {
          [direction === "up" ? "bottom" : "top"]: offset,
          [horizontalSide]: 0,
        } as React.CSSProperties;
      }
      return {
        [direction === "left" ? "right" : "left"]: offset,
        top: "50%",
        transform: "translateY(-50%)",
      } as React.CSSProperties;
    });
  }, [items, direction, isVertical, horizontalSide]);

  return (
    <div ref={wrapperRef} className={cn("fixed z-[400]", POSITION_CLASSES[position], className)}>
      <div className="relative" style={{ width: MAIN_FAB_SIZE, height: MAIN_FAB_SIZE }}>
        <AnimatePresence>
          {open && (
            <motion.div
              role="menu"
              id={menuId}
              aria-orientation={isVertical ? "vertical" : "horizontal"}
              aria-label={label}
              initial="closed"
              animate="open"
              exit="closed"
              variants={{
                open: { transition: { staggerChildren: 0.06, delayChildren: 0.02 } },
                closed: { transition: { staggerChildren: 0.04, staggerDirection: -1 } },
              }}
            >
              {items.map((item, index) => (
                <FabItem
                  key={item.id}
                  ref={(el) => {
                    itemRefs.current[index] = el;
                  }}
                  item={item}
                  labelSide={labelSide}
                  tabIndex={open ? 0 : -1}
                  onActivate={handleActivate}
                  onKeyDown={handleItemKeyDown(index)}
                  style={itemStyles[index]}
                />
              ))}
            </motion.div>
          )}
        </AnimatePresence>

        <button
          ref={triggerRef}
          type="button"
          aria-haspopup="menu"
          aria-expanded={open}
          aria-controls={menuId}
          aria-label={open ? `Close ${label}` : `Open ${label}`}
          onClick={() => setOpen(!open)}
          onKeyDown={handleTriggerKeyDown}
          className={cn(
            "flex items-center justify-center rounded-full bg-primary text-primary-foreground shadow-2xl transition-shadow",
            "hover:shadow-primary/30 hover:shadow-2xl",
            "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background",
            "active:scale-95"
          )}
          style={{ width: MAIN_FAB_SIZE, height: MAIN_FAB_SIZE }}
        >
          <motion.span
            className="flex items-center justify-center [&_svg]:h-5 [&_svg]:w-5"
            animate={{ rotate: open ? 45 : 0 }}
            transition={{ type: "spring", stiffness: 400, damping: 24 }}
          >
            {icon ?? <Plus />}
          </motion.span>
        </button>
      </div>
    </div>
  );
}
