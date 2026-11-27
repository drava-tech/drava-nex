import { CANVAS_FONTS } from "@platform/ui/templates/canvas";

/**
 * Looks the template library is drawn in. Each is a palette plus a type
 * pairing; layouts only ever read colours and fonts from here, so the same
 * layout reads as a different brand in each theme.
 */
export interface CanvasTheme {
  id: string;
  label: string;
  bg: string;
  /** Second gradient stop for the page background; null = flat. */
  bg2: string | null;
  /** Cards and panels. */
  surface: string;
  text: string;
  muted: string;
  accent: string;
  /** Text that sits on the accent colour. */
  accentText: string;
  head: string;
  body: string;
  headWeight: number;
  /** Corner radius at 1080p, in design px. */
  radius: number;
}

const F = Object.fromEntries(CANVAS_FONTS.map((f) => [f.label, f.value])) as Record<string, string>;
const INTER = F["Inter"]!;
const EXPANDED = F["Archivo Expanded"]!;
const GELASIO = F["Gelasio"]!;
const CALADEA = F["Caladea"]!;
const TINOS = F["Tinos"]!;
const ARIMO = F["Arimo"]!;

export const CANVAS_THEMES = {
  nex: { id: "nex", label: "Nex", bg: "#0b0d12", bg2: "#141a24", surface: "#171c26", text: "#f5f6f8", muted: "#9aa3b2", accent: "#92ff5f", accentText: "#0b0d12", head: EXPANDED, body: INTER, headWeight: 700, radius: 22 },
  ivory: { id: "ivory", label: "Ivory", bg: "#f4efe6", bg2: null, surface: "#fffaf2", text: "#1f1a14", muted: "#7a6d5c", accent: "#b5652b", accentText: "#fffaf2", head: GELASIO, body: INTER, headWeight: 700, radius: 6 },
  gold: { id: "gold", label: "Midnight gold", bg: "#0c0f1e", bg2: "#1b2040", surface: "#161a31", text: "#f6f1e3", muted: "#a9a38f", accent: "#d6b25e", accentText: "#0c0f1e", head: TINOS, body: INTER, headWeight: 700, radius: 4 },
  ocean: { id: "ocean", label: "Ocean", bg: "#05182b", bg2: "#0b3a5e", surface: "#0e2b49", text: "#eaf4ff", muted: "#8fb0d0", accent: "#38bdf8", accentText: "#05182b", head: EXPANDED, body: INTER, headWeight: 700, radius: 18 },
  ember: { id: "ember", label: "Ember", bg: "#1a0f0c", bg2: "#3b1a10", surface: "#2a1a15", text: "#fff3ec", muted: "#c9a99a", accent: "#ff6a3d", accentText: "#1a0f0c", head: EXPANDED, body: INTER, headWeight: 700, radius: 16 },
  mono: { id: "mono", label: "Mono", bg: "#ffffff", bg2: null, surface: "#f1f1f1", text: "#0a0a0a", muted: "#6b6b6b", accent: "#0a0a0a", accentText: "#ffffff", head: EXPANDED, body: INTER, headWeight: 700, radius: 0 },
  forest: { id: "forest", label: "Forest", bg: "#0e1d16", bg2: "#1a3b2b", surface: "#18322a", text: "#eef5ef", muted: "#9db8a6", accent: "#c8e66b", accentText: "#0e1d16", head: GELASIO, body: INTER, headWeight: 700, radius: 14 },
  blush: { id: "blush", label: "Blush", bg: "#fbeee9", bg2: null, surface: "#ffffff", text: "#2a1a1f", muted: "#8a6b73", accent: "#d9466f", accentText: "#ffffff", head: GELASIO, body: INTER, headWeight: 700, radius: 24 },
  violet: { id: "violet", label: "Ultraviolet", bg: "#12061f", bg2: "#2e0f56", surface: "#22103d", text: "#f7f2ff", muted: "#b7a6d6", accent: "#b388ff", accentText: "#12061f", head: EXPANDED, body: INTER, headWeight: 700, radius: 26 },
  sand: { id: "sand", label: "Sand", bg: "#eee5d6", bg2: null, surface: "#f8f3ea", text: "#2b2620", muted: "#7d7264", accent: "#2f5d50", accentText: "#f8f3ea", head: CALADEA, body: INTER, headWeight: 700, radius: 10 },
  signal: { id: "signal", label: "Signal", bg: "#111111", bg2: null, surface: "#1e1e1e", text: "#ffffff", muted: "#a8a8a8", accent: "#ffcc00", accentText: "#111111", head: EXPANDED, body: ARIMO, headWeight: 700, radius: 8 },
  clinic: { id: "clinic", label: "Clean blue", bg: "#f2f6fb", bg2: null, surface: "#ffffff", text: "#0f2236", muted: "#5b708a", accent: "#1f6feb", accentText: "#ffffff", head: INTER, body: INTER, headWeight: 700, radius: 18 },
  red: { id: "red", label: "Studio red", bg: "#f6f6f4", bg2: null, surface: "#ffffff", text: "#111111", muted: "#6b6b6b", accent: "#e1251b", accentText: "#ffffff", head: EXPANDED, body: INTER, headWeight: 700, radius: 24 },
  slate: { id: "slate", label: "Slate", bg: "#1b1f27", bg2: "#262c38", surface: "#252b36", text: "#f2f4f7", muted: "#98a2b3", accent: "#f2f4f7", accentText: "#1b1f27", head: INTER, body: INTER, headWeight: 700, radius: 12 },
} satisfies Record<string, CanvasTheme>;

export type CanvasThemeId = keyof typeof CANVAS_THEMES;
