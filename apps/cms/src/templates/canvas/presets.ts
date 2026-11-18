import {
  CANVAS_FONTS,
  blankPage,
  makeShape,
  makeText,
  type CanvasPage,
} from "@platform/ui/templates/canvas";

/**
 * Starter layouts. Each builds a page for ANY canvas size — positions are
 * computed from the width/height (with a unit `u` scaled off the short side),
 * so the same preset reads well in landscape, portrait, 4K or square.
 */
export interface CanvasPreset {
  id: string;
  label: string;
  build: (width: number, height: number) => CanvasPage;
}

const SANS = CANVAS_FONTS[0]!.value;
const HEADING = CANVAS_FONTS[1]!.value;
const SERIF = CANVAS_FONTS[5]!.value;

export const CANVAS_PRESETS: CanvasPreset[] = [
  {
    id: "announcement",
    label: "Announcement",
    build: (W, H) => {
      const u = Math.min(W, H) / 1080;
      const pad = 110 * u;
      const portrait = H > W;
      const page = blankPage({ color: "#f5f3ee" });
      page.elements = [
        makeShape({ x: 0, y: 0, w: W, h: 24 * u }, { fill: "#7c3aed" }),
        makeText(
          { x: pad, y: portrait ? H * 0.28 : H * 0.22, w: W - pad * 2, h: 40 * u },
          { text: "ANNOUNCEMENT", fontFamily: SANS, fontSize: Math.round(34 * u), fontWeight: 700, letterSpacing: 0.25, color: "#7c3aed" }
        ),
        makeText(
          { x: pad, y: (portrait ? H * 0.28 : H * 0.22) + 70 * u, w: W - pad * 2, h: 300 * u },
          { text: "Something big\nis coming soon", fontFamily: HEADING, fontSize: Math.round((portrait ? 80 : 120) * u), fontWeight: 700, lineHeight: 1.05, color: "#111111", animation: "slide-up" }
        ),
        makeText(
          { x: pad, y: (portrait ? H * 0.28 : H * 0.22) + 420 * u, w: Math.min(W - pad * 2, 1100 * u), h: 120 * u },
          { text: "Add a short line with the details people need to know.", fontFamily: SANS, fontSize: Math.round(42 * u), color: "#4b4b4b", animation: "fade", animationDelay: 0.3 }
        ),
      ];
      return page;
    },
  },
  {
    id: "welcome",
    label: "Welcome",
    build: (W, H) => {
      const u = Math.min(W, H) / 1080;
      const page = blankPage({ color: "#0b0b14", gradient: { from: "#1e1b4b", to: "#0b0b14", angle: 160 } });
      page.elements = [
        makeShape(
          { x: W / 2 - 360 * u, y: H / 2 - 360 * u, w: 720 * u, h: 720 * u },
          { shape: "ellipse", fill: "rgba(124,58,237,0.18)", animation: "zoom" }
        ),
        makeText(
          { x: 80 * u, y: H / 2 - 170 * u, w: W - 160 * u, h: 60 * u },
          { text: "WELCOME", fontFamily: SANS, fontSize: Math.round(40 * u), fontWeight: 700, letterSpacing: 0.4, align: "center", color: "#a78bfa", animation: "fade" }
        ),
        makeText(
          { x: 80 * u, y: H / 2 - 90 * u, w: W - 160 * u, h: 160 * u },
          { text: "Guest Name", fontFamily: HEADING, fontSize: Math.round(130 * u), fontWeight: 700, align: "center", color: "#ffffff", animation: "slide-up", animationDelay: 0.2 }
        ),
        makeText(
          { x: 80 * u, y: H / 2 + 110 * u, w: W - 160 * u, h: 60 * u },
          { text: "We're glad you're here", fontFamily: SANS, fontSize: Math.round(44 * u), align: "center", color: "#d4d4d8", animation: "fade", animationDelay: 0.5 }
        ),
      ];
      return page;
    },
  },
  {
    id: "event",
    label: "Event",
    build: (W, H) => {
      const u = Math.min(W, H) / 1080;
      const portrait = H > W;
      const page = blankPage({ color: "#111827" });
      const pad = 100 * u;
      const dateW = 300 * u;
      const dateX = portrait ? pad : pad;
      const dateY = portrait ? H * 0.18 : H / 2 - 170 * u;
      const textX = portrait ? pad : pad + dateW + 80 * u;
      const textY = portrait ? dateY + 400 * u : H / 2 - 190 * u;
      const textW = W - textX - pad;
      page.elements = [
        makeShape({ x: dateX, y: dateY, w: dateW, h: 340 * u }, { fill: "#f59e0b", radius: 28 * u, animation: "zoom" }),
        makeText(
          { x: dateX, y: dateY + 40 * u, w: dateW, h: 60 * u },
          { text: "MAR", fontFamily: SANS, fontSize: Math.round(54 * u), fontWeight: 700, align: "center", color: "#111827", letterSpacing: 0.1 }
        ),
        makeText(
          { x: dateX, y: dateY + 110 * u, w: dateW, h: 190 * u },
          { text: "24", fontFamily: HEADING, fontSize: Math.round(170 * u), fontWeight: 700, align: "center", color: "#111827", lineHeight: 1 }
        ),
        makeText(
          { x: textX, y: textY, w: textW, h: 220 * u },
          { text: "Product Launch\nEvening", fontFamily: HEADING, fontSize: Math.round((portrait ? 78 : 100) * u), fontWeight: 700, lineHeight: 1.05, color: "#ffffff", animation: "slide-left" }
        ),
        makeText(
          { x: textX, y: textY + 250 * u, w: textW, h: 120 * u },
          { text: "6:00 PM · Experience Centre, Level 2", fontFamily: SANS, fontSize: Math.round(42 * u), color: "#fbbf24", animation: "fade", animationDelay: 0.3 }
        ),
      ];
      return page;
    },
  },
  {
    id: "menu",
    label: "Menu / price list",
    build: (W, H) => {
      const u = Math.min(W, H) / 1080;
      const page = blankPage({ color: "#1c1917" });
      const pad = 110 * u;
      const items = [
        ["Espresso", "₹180"],
        ["Cappuccino", "₹240"],
        ["Cold Brew", "₹260"],
        ["Masala Chai", "₹150"],
        ["Croissant", "₹220"],
      ];
      const top = H * 0.12;
      const rowH = Math.min(140 * u, (H - top - 260 * u - pad) / items.length);
      page.elements = [
        makeText(
          { x: pad, y: top, w: W - pad * 2, h: 140 * u },
          { text: "Today's Menu", fontFamily: SERIF, fontSize: Math.round(110 * u), fontWeight: 700, italic: true, color: "#fde68a" }
        ),
        makeShape({ x: pad, y: top + 170 * u, w: W - pad * 2, h: 4 * u }, { fill: "#fde68a" }),
        ...items.flatMap(([name, price], i) => {
          const y = top + 230 * u + i * rowH;
          return [
            makeText(
              { x: pad, y, w: (W - pad * 2) * 0.7, h: 70 * u },
              { text: name!, fontFamily: SANS, fontSize: Math.round(56 * u), color: "#fafaf9", animation: "fade", animationDelay: 0.1 * i }
            ),
            makeText(
              { x: pad + (W - pad * 2) * 0.7, y, w: (W - pad * 2) * 0.3, h: 70 * u },
              { text: price!, fontFamily: SANS, fontSize: Math.round(56 * u), fontWeight: 700, align: "right", color: "#fde68a", animation: "fade", animationDelay: 0.1 * i }
            ),
          ];
        }),
      ];
      return page;
    },
  },
  {
    id: "offer",
    label: "Offer",
    build: (W, H) => {
      const u = Math.min(W, H) / 1080;
      const portrait = H > W;
      const page = blankPage({ color: "#dc2626", gradient: { from: "#ef4444", to: "#991b1b", angle: 135 } });
      const d = 620 * u;
      const cx = portrait ? W / 2 : W * 0.68;
      const cy = portrait ? H * 0.38 : H / 2;
      const textX = portrait ? 90 * u : 120 * u;
      const textW = portrait ? W - 180 * u : W * 0.42;
      const textY = portrait ? cy + d / 2 + 80 * u : H / 2 - 200 * u;
      page.elements = [
        makeShape({ x: cx - d / 2, y: cy - d / 2, w: d, h: d }, { shape: "ellipse", fill: "#fde047", animation: "zoom" }),
        makeText(
          { x: cx - d / 2, y: cy - 190 * u, w: d, h: 260 * u },
          { text: "50%", fontFamily: HEADING, fontSize: Math.round(230 * u), fontWeight: 700, align: "center", color: "#991b1b", lineHeight: 1 }
        ),
        makeText(
          { x: cx - d / 2, y: cy + 80 * u, w: d, h: 90 * u },
          { text: "OFF", fontFamily: HEADING, fontSize: Math.round(90 * u), fontWeight: 700, align: "center", color: "#991b1b", letterSpacing: 0.2 }
        ),
        makeText(
          { x: textX, y: textY, w: textW, h: 240 * u },
          { text: "Weekend\nSale", fontFamily: HEADING, fontSize: Math.round(120 * u), fontWeight: 700, lineHeight: 1, color: "#ffffff", align: portrait ? "center" : "left", animation: "slide-up" }
        ),
        makeText(
          { x: textX, y: textY + 270 * u, w: textW, h: 80 * u },
          { text: "On selected items, this weekend only", fontFamily: SANS, fontSize: Math.round(40 * u), color: "#fee2e2", align: portrait ? "center" : "left", animation: "fade", animationDelay: 0.3 }
        ),
      ];
      return page;
    },
  },
];
