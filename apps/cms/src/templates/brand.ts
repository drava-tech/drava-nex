import { makeImage, type CanvasElement, type CanvasPage } from "@platform/ui/templates/canvas";
import type { StoryBrand } from "@platform/ui/templates/story";
import type { CanvasTheme } from "./canvas/library/themes";

/**
 * The operator's brand, set once when they create something new and applied
 * to whichever kind they make: every Design template is redrawn in it, and a
 * Story takes it as its look.
 */
export interface BrandKit {
  /** Organisation name; fills the logo slot when there's no logo image. */
  name: string;
  tagline: string;
  logoUrl: string | null;
  background: string;
  surface: string;
  text: string;
  muted: string;
  accent: string;
  accentText: string;
  headingFont: string;
  bodyFont: string;
  /** Corner radius at 1080p, in design px. */
  radius: number;
}

/** The text Design templates put where a logo goes. */
export const LOGO_PLACEHOLDER = "Your logo";

/** Dark or light text, whichever reads better on a colour. */
export function textOn(hex: string): string {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex);
  if (!m) return "#ffffff";
  const n = parseInt(m[1]!, 16);
  const [r, g, b] = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((c) => {
    const v = c / 255;
    return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r! + 0.7152 * g! + 0.0722 * b! > 0.4 ? "#0b0d12" : "#ffffff";
}

const HEX = /^#[0-9a-f]{6}$/i;

export function mix(a: string, b: string, t: number): string {
  if (!HEX.test(a) || !HEX.test(b)) return a;
  const x = parseInt(a.slice(1), 16);
  const y = parseInt(b.slice(1), 16);
  const ch = (sh: number) => Math.round(((x >> sh) & 255) * (1 - t) + ((y >> sh) & 255) * t);
  return `#${[16, 8, 0].map((sh) => ch(sh).toString(16).padStart(2, "0")).join("")}`;
}

/** Surface, text and muted colours that sit well on a chosen background. */
export function onBackground(bg: string): Pick<BrandKit, "background" | "surface" | "text" | "muted"> {
  if (!HEX.test(bg)) return { background: bg, surface: bg, text: "#ffffff", muted: "#9aa3b2" };
  return textOn(bg) === "#ffffff"
    ? { background: bg, surface: mix(bg, "#ffffff", 0.07), text: "#f5f6f8", muted: mix(bg, "#ffffff", 0.6) }
    : { background: bg, surface: mix(bg, "#ffffff", 0.7), text: "#1a1a1a", muted: mix(bg, "#000000", 0.55) };
}

export function toStoryBrand(k: BrandKit): Partial<StoryBrand> {
  const { logoUrl, background, surface, text, muted, accent, accentText, headingFont, bodyFont, radius } = k;
  return { logoUrl, background, surface, text, muted, accent, accentText, headingFont, bodyFont, radius };
}

/** A template's theme redrawn in the brand: same layout, the brand's colours, type and corners. */
export function toCanvasTheme(base: CanvasTheme, k: BrandKit): CanvasTheme {
  return {
    ...base,
    id: "brand",
    label: "Your brand",
    bg: k.background,
    bg2: base.bg2 ? mix(k.background, k.accent, 0.08) : null,
    surface: k.surface,
    text: k.text,
    muted: k.muted,
    accent: k.accent,
    accentText: k.accentText,
    head: k.headingFont,
    body: k.bodyFont,
    radius: k.radius,
  };
}

/** Puts the brand into a template's logo slot: the logo image, else the organisation name. */
export function brandLogoSlot(p: CanvasPage, k: BrandKit): CanvasPage {
  const name = k.name.trim();
  if (!k.logoUrl && !name) return p;
  const elements = p.elements.map((el): CanvasElement => {
    if (el.type !== "text" || el.text !== LOGO_PLACEHOLDER) return el;
    if (!k.logoUrl) return { ...el, text: name };
    const h = el.fontSize * 2;
    return makeImage({ x: el.x, y: el.y + el.h / 2 - h / 2, w: h * 2.5, h }, k.logoUrl, {
      fit: "contain",
      animation: el.animation,
      animationDelay: el.animationDelay,
    });
  });
  return { ...p, elements };
}
