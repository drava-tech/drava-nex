import type { CSSProperties } from "react";

// "Liquid glass" material, referenced from the liquid-glass UI kit mockups:
// a frosted pill/panel tinted by its OWN accent color (not a neutral dark
// chip with a colored halo around it), with a bright top specular streak
// and a glow bleeding out beneath. Pure style helpers (no "use client"), so
// safe to import from server or client components alike.

export type LiquidAccent = "blue" | "violet" | "amber" | "emerald" | "rose" | "slate";

const ACCENT_CSS: Record<LiquidAccent, string> = {
  blue: "#38bdf8",
  violet: "#a78bfa",
  amber: "#f59e0b",
  emerald: "#10b981",
  rose: "#f43f5e",
  slate: "#cbd5e1",
};

export const LIQUID_BASE =
  "relative inline-flex items-center justify-center gap-2 overflow-hidden rounded-full border backdrop-blur-xl transition-all duration-200 hover:-translate-y-0.5";

// Rounded-rect variant for card-shaped surfaces (KPI tiles) rather than
// literal pill buttons.
export const LIQUID_PANEL =
  "relative overflow-hidden rounded-2xl border backdrop-blur-xl transition-all duration-200 hover:-translate-y-0.5";

// Builds the tinted-glass fill + rim + glow from any valid CSS color (hex,
// rgb(), or a var(--chart-n) reference) via color-mix(), so chart-driven
// callers and fixed accents share one implementation. `intensity` trades
// saturation for legibility: "button" for pills/badges that are mostly
// color, "panel" for larger content surfaces that still need to hold text.
function buildLiquidStyle(color: string, intensity: "button" | "panel"): CSSProperties {
  const [top, mid, bottom, borderA, glowA] =
    intensity === "button" ? [34, 14, 48, 55, 65] : [20, 7, 24, 40, 55];
  return {
    background: [
      `linear-gradient(180deg,`,
      `color-mix(in srgb, ${color} ${top}%, transparent) 0%,`,
      `color-mix(in srgb, ${color} ${mid}%, transparent) 50%,`,
      `color-mix(in srgb, ${color} ${bottom}%, transparent) 100%)`,
    ].join(" "),
    borderColor: `color-mix(in srgb, ${color} ${borderA}%, transparent)`,
    boxShadow: [
      `0 14px 32px -10px color-mix(in srgb, ${color} ${glowA}%, transparent)`,
      `0 0 0 1px color-mix(in srgb, ${color} 16%, transparent) inset`,
      `0 1px 0 0 rgba(255,255,255,0.28) inset`,
    ].join(", "),
  };
}

export function liquidGlowFromColor(color: string): CSSProperties {
  return buildLiquidStyle(color, "button");
}

export function liquidGlowStyle(accent: LiquidAccent): CSSProperties {
  return buildLiquidStyle(ACCENT_CSS[accent], "button");
}

export function liquidPanelFromColor(color: string): CSSProperties {
  return buildLiquidStyle(color, "panel");
}

export function liquidPanelStyle(accent: LiquidAccent): CSSProperties {
  return buildLiquidStyle(ACCENT_CSS[accent], "panel");
}

// White-to-violet vertical gradient for KPI text content (values/labels) —
// background-clip: text needs the color painted as a background image, with
// the text's own color made transparent so that image shows through the
// glyphs instead of behind them.
export const textGradientStyle: CSSProperties = {
  backgroundImage: "linear-gradient(to bottom, #FFFFFF, #9978FF)",
  WebkitBackgroundClip: "text",
  backgroundClip: "text",
  color: "transparent",
};

// Dashboard-wide card border treatment, independent of the per-datum accent
// colors above: "solid" is a flat brand violet; "gradient" is a glossy
// shimmer sheen. Selectable per panel — currently every dashboard card uses
// "solid", with "gradient" available for a future highlight/hero panel.
export type BorderVariant = "solid" | "gradient";

const SOLID_BORDER_COLOR = "#432992";
export const GRADIENT_BORDER_IMAGE =
  "linear-gradient(135deg, #1B006D 6%, #DED3FF 33%, #FFFFFF 50%, #DED3FF 80%, #1B006D 97%)";

// Layers a border variant onto an existing liquid-glass style (e.g. from
// liquidPanelStyle), preserving its fill gradient and glow box-shadow.
// "gradient" needs the standard two-layer background technique — a flat
// border-color can only ever hold one color, so the panel's own fill is
// painted into the padding-box while the shimmer is painted into the
// border-box beneath it; `border: 1px solid transparent` reserves the ring's
// width without covering that layer with a flat color.
export function withBorderVariant(base: CSSProperties, variant: BorderVariant): CSSProperties {
  if (variant === "solid") {
    return { ...base, borderColor: SOLID_BORDER_COLOR };
  }
  const fill = typeof base.background === "string" ? base.background : "transparent";
  return {
    ...base,
    background: `${fill} padding-box, ${GRADIENT_BORDER_IMAGE} border-box`,
    border: "1px solid transparent",
  };
}

// Same border treatment for a plain panel with no existing liquid-glass base
// style (e.g. the shared shadcn `Card`) — `fillColor` defaults to the card's
// own design-token background so it doesn't hardcode a duplicate color.
// `borderImage` lets a caller shift the shimmer's highlight position without
// touching the shared default (e.g. the sidebar's active-item pill nudges
// its highlight right, independent of the Screen Uptime card's border).
export function panelBorderStyle(
  variant: BorderVariant,
  fillColor = "var(--card)",
  borderImage: string = GRADIENT_BORDER_IMAGE
): CSSProperties {
  if (variant === "solid") {
    return { borderColor: SOLID_BORDER_COLOR };
  }
  return {
    background: `linear-gradient(${fillColor}, ${fillColor}) padding-box, ${borderImage} border-box`,
    border: "1px solid transparent",
  };
}

// Subtle violet fill for the sidebar's active nav pill — a 135deg gradient
// between the two brand violets at 10% opacity, sitting behind the solid
// border (panelBorderStyle("solid")).
export const ACTIVE_NAV_BACKGROUND =
  "linear-gradient(135deg, rgba(67, 41, 146, 0.1) 0%, rgba(89, 69, 147, 0.1) 100%)";

// Same shimmer stops as GRADIENT_BORDER_IMAGE, with the bright highlight
// nudged right — used for the sidebar's active nav pill / Admin button.
export const GRADIENT_BORDER_IMAGE_RIGHT =
  "linear-gradient(135deg, #1B006D 16%, #DED3FF 40%, #FFFFFF 52%, #DED3FF 60%, #1B006D 100%)";

// Lighter touch for large card surfaces that must stay dark/legible: a
// tinted rim + glow only, no fill tint — echoes the reference kit's
// "Pro plan" / "Tabs" panels, which stay dark and let the accent show only
// at the edge.
export function liquidCardGlow(color: string): CSSProperties {
  return {
    borderColor: `color-mix(in srgb, ${color} 32%, transparent)`,
    boxShadow: [
      `0 30px 60px -28px color-mix(in srgb, ${color} 50%, transparent)`,
      `0 1px 0 0 rgba(255,255,255,0.07) inset`,
    ].join(", "),
  };
}
