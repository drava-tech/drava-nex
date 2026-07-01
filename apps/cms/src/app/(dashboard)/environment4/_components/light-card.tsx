"use client";

import React from "react";
import { Sun, type LucideIcon } from "lucide-react";
import { Card, cn } from "@platform/ui";
import { Slider, Switch } from "./controls";

export interface Light {
  id: string;
  name: string;
  color: string; // accent / display color
  on: boolean;
  brightness: number;
  rgb?: boolean; // true → RGB strip (shows a color picker)
}

/**
 * Compact smart-home device card (reference layout): icon top-left, toggle
 * top-right, bold name + muted subtitle, a brightness slider, and a bottom stat
 * row. Neutral card surface (no color fill); the accent color only shows on the
 * icon, slider, toggle and — for RGB strips — a swatch row.
 */
export function LightCard({
  icon: Icon,
  name,
  subtitle,
  color,
  on,
  brightness,
  onToggle,
  onBrightness,
  secondary,
  rgb = false,
  onColor,
  className,
}: {
  icon: LucideIcon;
  name: string;
  subtitle: string;
  color: string;
  on: boolean;
  brightness: number;
  onToggle: (on: boolean) => void;
  onBrightness: (value: number) => void;
  secondary?: React.ReactNode;
  rgb?: boolean;
  onColor?: (hex: string) => void;
  className?: string;
}) {
  return (
    <Card
      className={cn("flex h-full flex-col gap-2.5 p-5 shadow-sm transition-opacity", !on && "opacity-70", className)}
    >
      {/* top row: icon, name + toggle */}
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 items-center gap-3">
          <span
            className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl transition-colors"
            style={{ backgroundColor: on ? `${color}26` : "var(--muted)" }}
          >
            <Icon className="h-5 w-5" color={on ? color : "currentColor"} style={{ color: on ? color : undefined }} />
          </span>
          <div className="min-w-0 space-y-0.5">
            <p className="truncate text-base font-semibold tracking-tight">{name}</p>
            <p className="truncate text-xs text-muted-foreground">{subtitle}</p>
          </div>
        </div>
        <Switch checked={on} onChange={onToggle} color={color} label={`${name} power`} />
      </div>

      {/* brightness slider */}
      <div className="flex items-center gap-3">
        <div className="min-w-0 flex-1">
          <Slider
            value={brightness}
            onChange={onBrightness}
            color={color}
            disabled={!on}
            ariaLabel={`${name} brightness`}
          />
        </div>
        <span className="w-10 shrink-0 text-right text-xs font-semibold tabular-nums text-foreground">
          {on ? `${brightness}%` : "--"}
        </span>
      </div>

      {/* bottom stat row */}
      <div className="hidden">
        <span className="inline-flex items-center gap-1.5">
          <Sun className="h-3.5 w-3.5" />
          <span className="tabular-nums">{on ? `${brightness}%` : "—"}</span>
        </span>
        {secondary}
      </div>

      {/* RGB color picker (strips only) */}
      {rgb && onColor && (
        <div className="flex items-center justify-between">
          <span className="text-xs text-muted-foreground">Color</span>
          <label
            className={cn(
              "relative inline-flex items-center gap-2",
              on ? "cursor-pointer" : "cursor-not-allowed opacity-50"
            )}
          >
            <span className="text-xs font-medium uppercase tabular-nums text-muted-foreground">
              {color}
            </span>
            <span
              className="h-7 w-7 rounded-full border border-black/10 shadow-sm"
              style={{ backgroundColor: color }}
            />
            <input
              type="color"
              value={color}
              disabled={!on}
              onChange={(e) => onColor(e.target.value)}
              aria-label={`${name} color`}
              className="absolute inset-0 h-full w-full cursor-pointer opacity-0 disabled:cursor-not-allowed"
            />
          </label>
        </div>
      )}
    </Card>
  );
}
