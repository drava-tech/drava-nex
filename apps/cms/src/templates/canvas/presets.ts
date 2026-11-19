import {
  CANVAS_FONTS,
  blankPage,
  makeImage,
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
  {
    id: "case-study",
    label: "Case study",
    build: (W, H) => {
      const u = Math.min(W, H) / 1080;
      const portrait = H > W;
      const page = blankPage({ color: "#0f1115" });
      const pad = 90 * u;
      // Landscape: photo down the left 44%, story on the right. Portrait: photo on top.
      const img = portrait ? { x: 0, y: 0, w: W, h: H * 0.36 } : { x: 0, y: 0, w: W * 0.44, h: H };
      const tx = portrait ? pad : img.w + pad;
      const tw = W - tx - pad;
      let y = portrait ? img.h + 70 * u : H * 0.1;
      const els: CanvasPage["elements"] = [
        makeImage(img, "/media/brand-experiences.png", { animation: "fade" }),
        makeShape({ x: portrait ? 0 : img.w - 10 * u, y: portrait ? img.h - 10 * u : 0, w: portrait ? W : 10 * u, h: portrait ? 10 * u : H }, { fill: "#92ff5f" }),
        makeText({ x: tx, y, w: tw, h: 40 * u }, { text: "CASE STUDY", fontFamily: SANS, fontSize: Math.round(26 * u), fontWeight: 700, letterSpacing: 0.3, color: "#92ff5f" }),
      ];
      y += 56 * u;
      els.push(
        makeText({ x: tx, y, w: tw, h: 150 * u }, { text: "Client name", fontFamily: HEADING, fontSize: Math.round(84 * u), fontWeight: 700, lineHeight: 1.05, color: "#ffffff", animation: "slide-up" }),
        makeText({ x: tx, y: y + 110 * u, w: tw, h: 50 * u }, { text: "Project title · Year · Location", fontFamily: SANS, fontSize: Math.round(30 * u), color: "#9aa3b2", animation: "fade", animationDelay: 0.2 })
      );
      y += 210 * u;
      const blocks: [string, string][] = [
        ["The challenge", "One or two lines on the problem the client came to us with."],
        ["Our approach", "What we designed and built, and why it worked."],
        ["The result", "The outcome, in the client's terms — footfall, sales, time saved."],
      ];
      const blockH = portrait ? 150 * u : Math.min(150 * u, (H * 0.68 - y) / blocks.length);
      blocks.forEach(([label, text], i) => {
        const by = y + i * blockH;
        els.push(
          makeText({ x: tx, y: by, w: tw, h: 34 * u }, { text: label.toUpperCase(), fontFamily: SANS, fontSize: Math.round(22 * u), fontWeight: 700, letterSpacing: 0.15, color: "#92ff5f", animation: "fade", animationDelay: 0.3 + i * 0.15 }),
          makeText({ x: tx, y: by + 40 * u, w: tw, h: 90 * u }, { text, fontFamily: SANS, fontSize: Math.round(30 * u), lineHeight: 1.35, color: "#e4e6eb", animation: "fade", animationDelay: 0.3 + i * 0.15 })
        );
      });
      // The headline number, bottom of the text column.
      const sy = portrait ? H - pad - 170 * u : H - pad - 170 * u;
      const statW = Math.min(tw / 2 - 20 * u, 420 * u);
      [
        ["+40%", "Visitor dwell time"],
        ["3 mo", "Concept to launch"],
      ].forEach(([n, cap], i) => {
        const sx = tx + i * (statW + 40 * u);
        els.push(
          makeShape({ x: sx, y: sy, w: statW, h: 170 * u }, { fill: "#1a1d24", radius: 20 * u, animation: "zoom", animationDelay: 0.7 + i * 0.15 }),
          makeText({ x: sx + 30 * u, y: sy + 22 * u, w: statW - 60 * u, h: 80 * u }, { text: n!, fontFamily: HEADING, fontSize: Math.round(64 * u), fontWeight: 700, color: "#ffffff", animation: "fade", animationDelay: 0.8 + i * 0.15 }),
          makeText({ x: sx + 30 * u, y: sy + 108 * u, w: statW - 60 * u, h: 40 * u }, { text: cap!, fontFamily: SANS, fontSize: Math.round(24 * u), color: "#9aa3b2", animation: "fade", animationDelay: 0.8 + i * 0.15 })
        );
      });
      page.elements = els;
      return page;
    },
  },
  {
    id: "timeline",
    label: "Timeline",
    build: (W, H) => {
      const u = Math.min(W, H) / 1080;
      const portrait = H > W;
      const page = blankPage({ color: "#f3ece0" });
      const pad = 100 * u;
      const ink = "#2b2118";
      const accent = "#a8742c";
      const items: [string, string, string][] = [
        ["1974", "Founded", "A workshop, three people and one lathe."],
        ["1983", "First factory", "Forty craftspeople under one roof."],
        ["1999", "Design studio", "Ideas and making, side by side."],
        ["2012", "National award", "Restoration project of the year."],
        ["2024", "Fifty years", "Three generations, one promise."],
      ];
      const els: CanvasPage["elements"] = [
        makeText({ x: pad, y: pad * 0.9, w: W - pad * 2, h: 40 * u }, { text: "OUR JOURNEY", fontFamily: SANS, fontSize: Math.round(26 * u), fontWeight: 700, letterSpacing: 0.3, color: accent }),
        makeText({ x: pad, y: pad * 0.9 + 50 * u, w: W - pad * 2, h: 120 * u }, { text: "Fifty years in five moments", fontFamily: SERIF, fontSize: Math.round(76 * u), fontWeight: 700, color: ink, animation: "slide-up" }),
      ];
      if (portrait) {
        // A vertical spine with the milestones stacked down the right of it.
        const top = pad * 0.9 + 240 * u;
        const lineX = pad + 30 * u;
        const step = (H - top - pad) / items.length;
        els.push(makeShape({ x: lineX - 3 * u, y: top, w: 6 * u, h: H - top - pad }, { fill: accent, opacity: 0.35 }));
        items.forEach(([year, title, text], i) => {
          const y = top + i * step;
          const d = 0.25 + i * 0.15;
          els.push(
            makeShape({ x: lineX - 22 * u, y: y + 6 * u, w: 44 * u, h: 44 * u }, { shape: "ellipse", fill: accent, animation: "zoom", animationDelay: d }),
            makeText({ x: lineX + 60 * u, y, w: W - lineX - 60 * u - pad, h: 64 * u }, { text: year, fontFamily: SERIF, fontSize: Math.round(54 * u), fontWeight: 700, color: accent, animation: "fade", animationDelay: d }),
            makeText({ x: lineX + 60 * u, y: y + 70 * u, w: W - lineX - 60 * u - pad, h: 46 * u }, { text: title, fontFamily: SANS, fontSize: Math.round(34 * u), fontWeight: 700, color: ink, animation: "fade", animationDelay: d }),
            makeText({ x: lineX + 60 * u, y: y + 118 * u, w: W - lineX - 60 * u - pad, h: 80 * u }, { text, fontFamily: SANS, fontSize: Math.round(27 * u), lineHeight: 1.35, color: "#7a6a58", animation: "fade", animationDelay: d })
          );
        });
      } else {
        // A horizontal spine; years above it, the story below.
        const lineY = H * 0.56;
        const colW = (W - pad * 2) / items.length;
        els.push(makeShape({ x: pad, y: lineY - 3 * u, w: W - pad * 2, h: 6 * u }, { fill: accent, opacity: 0.35 }));
        items.forEach(([year, title, text], i) => {
          const x = pad + i * colW;
          const d = 0.25 + i * 0.15;
          els.push(
            makeText({ x, y: lineY - 120 * u, w: colW - 30 * u, h: 80 * u }, { text: year, fontFamily: SERIF, fontSize: Math.round(70 * u), fontWeight: 700, color: accent, animation: "slide-up", animationDelay: d }),
            makeShape({ x: x, y: lineY - 20 * u, w: 40 * u, h: 40 * u }, { shape: "ellipse", fill: accent, animation: "zoom", animationDelay: d }),
            makeText({ x, y: lineY + 60 * u, w: colW - 40 * u, h: 50 * u }, { text: title, fontFamily: SANS, fontSize: Math.round(34 * u), fontWeight: 700, color: ink, animation: "fade", animationDelay: d + 0.1 }),
            makeText({ x, y: lineY + 112 * u, w: colW - 40 * u, h: 110 * u }, { text, fontFamily: SANS, fontSize: Math.round(26 * u), lineHeight: 1.4, color: "#7a6a58", animation: "fade", animationDelay: d + 0.1 })
          );
        });
      }
      page.elements = els;
      return page;
    },
  },
];
