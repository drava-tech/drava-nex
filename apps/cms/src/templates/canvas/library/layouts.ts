import type { CanvasElement, CanvasPage } from "@platform/ui/templates/canvas";
import { circle, column, ctx, headingParts, image, measure, page, pill, rect, text, type Ctx } from "./engine";
import { pics } from "./stock";
import type { CanvasTheme } from "./themes";

/** The words (and pictures) a template fills a layout with. */
export interface Copy {
  eyebrow?: string;
  title: string;
  body?: string;
  cta?: string;
  footer?: string;
  /** Top corner mark, e.g. a logo placeholder. */
  brand?: string;
  images?: string[];
  /** Rows, cards or stats, depending on the layout. */
  items?: { label: string; value?: string; note?: string }[];
  /** Big figure: a stat, an offer, a date day. */
  value?: string;
  /** Event layouts. */
  date?: { month: string; day: string; weekday?: string };
  /** 0–1, for progress bars. */
  progress?: number;
}

export type Layout = (W: number, H: number, th: CanvasTheme, k: Copy) => CanvasPage;

const IMG = pics("workspace", "cafeTables", "skyline");
const img = (k: Copy, i = 0) => k.images?.[i] ?? IMG[i % IMG.length]!;
const alpha = (hex: string, a: number) => {
  const m = /^#([0-9a-f]{6})$/i.exec(hex);
  if (!m) return hex;
  const n = parseInt(m[1]!, 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
};

/** Small brand mark and footer line most layouts share. */
function chrome(c: Ctx, k: Pick<Copy, "brand" | "footer">, o: { color?: string; muted?: string } = {}): CanvasElement[] {
  const out: CanvasElement[] = [];
  const { W, H, pad, th } = c;
  if (k.brand) out.push(text(c, pad, pad * 0.7, W / 2, k.brand, { size: 24, weight: 700, upper: true, ls: 0.24, color: o.color ?? th.text, anim: "fade" }).el);
  if (k.footer) {
    const t = text(c, pad, 0, W - pad * 2, k.footer, { size: 24, upper: true, ls: 0.2, weight: 600, color: o.muted ?? th.muted, anim: "fade", delay: 0.6 });
    t.el.y = H - pad * 0.7 - t.h;
    out.push(t.el);
  }
  return out;
}

// ─── Hero: centred headline over a soft glow ──────────────────────────────────
export const hero: Layout = (W, H, th, k) => {
  const c = ctx(W, H, th);
  const { u, pad } = c;
  const S = Math.min(W, H);
  const p = page(c);
  p.elements = [
    circle(W * 0.82, H * 0.12, S * 0.62, alpha(th.accent, 0.1), { animation: "zoom" }),
    circle(W * 0.1, H * 0.95, S * 0.3, "transparent", { stroke: alpha(th.accent, 0.35), strokeWidth: 3 * u }),
    ...column(c, { x: pad, y: pad, w: W - pad * 2, h: H - pad * 2 }, headingParts(c, k, { title: c.portrait ? 120 : 150, bar: true }), { align: "center", v: "center" }),
    ...chrome(c, k),
  ];
  return p;
};

// ─── Editorial: left-aligned, accent rule, sits low on the screen ─────────────
export const editorial: Layout = (W, H, th, k) => {
  const c = ctx(W, H, th);
  const { u, pad } = c;
  const p = page(c);
  const top = H * (c.portrait ? 0.3 : 0.18);
  const bottom = H - pad * 1.6;
  p.elements = [
    rect(pad, top, 8 * u, bottom - top, th.accent, { animation: "fade" }),
    ...column(c, { x: pad + 56 * u, y: top, w: Math.min(W - pad * 2 - 56 * u, 1500 * u), h: bottom - top }, headingParts(c, k, { title: c.portrait ? 110 : 130 }), { v: "bottom" }),
    ...chrome(c, k),
  ];
  return p;
};

// ─── Split: picture on one side, words on the other ───────────────────────────
export const split: Layout = (W, H, th, k) => {
  const c = ctx(W, H, th);
  const { u, pad, portrait, square } = c;
  const p = page(c, { flat: true });
  const r = th.radius * u;
  const stacked = portrait || square;
  const inset = 40 * u;
  const pic = stacked
    ? { x: inset, y: inset, w: W - inset * 2, h: H * (square ? 0.46 : 0.5) - inset }
    : { x: inset, y: inset, w: W * 0.5 - inset, h: H - inset * 2 };
  const box = stacked
    ? { x: pad, y: pic.y + pic.h + 60 * u, w: W - pad * 2, h: H - (pic.y + pic.h + 60 * u) - pad }
    : { x: W * 0.5 + pad * 0.8, y: pad, w: W * 0.5 - pad * 1.8, h: H - pad * 2 };
  p.elements = [
    image(pic.x, pic.y, pic.w, pic.h, img(k), { radius: r, animation: "fade" }),
    ...column(c, box, headingParts(c, k, { title: stacked ? 96 : 100, body: 36 }), { v: stacked ? "top" : "center" }),
  ];
  if (k.footer) p.elements.push(...chrome(c, { footer: k.footer }).map((e) => ({ ...e, x: box.x, w: box.w })));
  return p;
};

// ─── Full bleed: photo edge to edge, words over a shaded foot ─────────────────
function fullbleed(center: boolean): Layout {
  return (W, H, th, k) => {
    const c = ctx(W, H, th);
    const { u, pad } = c;
    const p = page(c, { flat: true, color: "#000000" });
    p.elements = [
      image(0, 0, W, H, img(k), { animation: "zoom" }),
      rect(0, 0, W, H, center ? "rgba(0,0,0,0.52)" : "rgba(0,0,0,0.22)"),
      ...(center ? [] : [rect(0, H * 0.45, W, H * 0.55, "rgba(0,0,0,0.45)")]),
      ...column(
        c,
        { x: pad, y: pad, w: Math.min(W - pad * 2, center ? W : 1500 * u), h: H - pad * 2 - (k.footer ? 60 * u : 0) },
        headingParts(c, k, { title: c.portrait ? 110 : 140, titleColor: "#ffffff", bodyColor: "rgba(255,255,255,0.82)", bar: center }),
        { align: center ? "center" : "left", v: center ? "center" : "bottom" }
      ),
      ...chrome(c, k, { color: "#ffffff", muted: "rgba(255,255,255,0.7)" }),
    ];
    return p;
  };
}
export const photo = fullbleed(false);
export const photoCenter = fullbleed(true);

// ─── Frame: inset border, centred serif — invitations, welcomes, thanks ───────
export const frame: Layout = (W, H, th, k) => {
  const c = ctx(W, H, th);
  const { u } = c;
  const p = page(c);
  const o = 48 * u;
  const i = 68 * u;
  const pad = 160 * u;
  p.elements = [
    rect(o, o, W - o * 2, H - o * 2, "transparent", { stroke: th.accent, strokeWidth: 3 * u }),
    rect(i, i, W - i * 2, H - i * 2, "transparent", { stroke: alpha(th.accent, 0.45), strokeWidth: 1.5 * u }),
    ...column(
      c,
      { x: pad, y: pad, w: W - pad * 2, h: H - pad * 2 },
      [
        { t: "text", str: k.eyebrow, o: { size: 30, upper: true, ls: 0.34, weight: 600, color: th.accent } },
        { t: "bar", w: 140, h: 2, gap: 34 },
        { t: "text", str: k.title, o: { size: c.portrait ? 120 : 140, font: "head", fit: true, min: 44, lh: 1.08 }, gap: 40 },
        { t: "bar", w: 140, h: 2, gap: 40 },
        { t: "text", str: k.body, o: { size: 38, color: th.muted }, gap: 40 },
        { t: "text", str: k.footer, o: { size: 26, upper: true, ls: 0.22, weight: 600, color: th.muted }, gap: 50 },
      ],
      { align: "center", v: "center" }
    ),
  ];
  return p;
};

// ─── Big figure: one number people remember ───────────────────────────────────
export const bigStat: Layout = (W, H, th, k) => {
  const c = ctx(W, H, th);
  const { u, pad, portrait, square } = c;
  const p = page(c);
  const stacked = portrait || square;
  const figure = text(c, pad, 0, stacked ? W - pad * 2 : W * 0.5, k.value ?? "100", { size: 420, font: "head", fit: true, min: 120, color: th.accent, lh: 0.95, anim: "zoom" });
  const right = { x: stacked ? pad : W * 0.5 + pad * 1.2, w: stacked ? W - pad * 2 : W * 0.5 - pad * 2.2 };
  if (stacked) {
    const words = column(c, { x: pad, y: 0, w: W - pad * 2, h: 0 }, headingParts(c, { title: k.title, body: k.body }, { title: 80 }));
    const wordsH = Math.max(...words.map((e) => e.y + e.h));
    const total = figure.h + 50 * u + wordsH;
    const top = (H - total) / 2;
    figure.el.y = top;
    for (const e of words) e.y += top + figure.h + 50 * u;
    p.elements = [rect(pad, top - 60 * u, 120 * u, 8 * u, th.accent), figure.el, ...words];
  } else {
    figure.el.y = (H - figure.h) / 2;
    p.elements = [
      figure.el,
      rect(W * 0.5 + pad * 0.5, H * 0.28, 3 * u, H * 0.44, alpha(th.text, 0.2)),
      ...column(c, { x: right.x, y: pad, w: right.w, h: H - pad * 2 }, headingParts(c, { eyebrow: k.eyebrow, title: k.title, body: k.body }, { title: 84 }), { v: "center" }),
    ];
  }
  p.elements.push(...chrome(c, { brand: k.brand, footer: k.footer }));
  return p;
};

// ─── Stat cards: three or four figures in a row ───────────────────────────────
export const stats: Layout = (W, H, th, k) => {
  const c = ctx(W, H, th);
  const { u, pad, portrait } = c;
  const p = page(c);
  const items = k.items ?? [];
  const head = column(c, { x: pad, y: pad * 1.1, w: W - pad * 2, h: 0 }, headingParts(c, { eyebrow: k.eyebrow, title: k.title }, { title: portrait ? 90 : 96 }));
  const headBottom = Math.max(...head.map((e) => e.y + e.h)) + 70 * u;
  const cols = portrait ? (items.length === 4 ? 2 : 1) : c.square && items.length >= 4 ? 2 : items.length;
  const rows = Math.ceil(items.length / cols);
  const gap = 32 * u;
  const areaH = H - headBottom - pad - (k.footer ? 60 * u : 0);
  const cw = (W - pad * 2 - gap * (cols - 1)) / cols;
  const ch = Math.min((areaH - gap * (rows - 1)) / rows, 520 * u);
  const els: CanvasElement[] = [...head];
  // Labels never break mid-word: size them to the card's longest word.
  const inner = cw - 88 * u;
  const longestWord = Math.max(...items.flatMap((it) => `${it.label} ${it.note ?? ""}`.split(/\s+/)).map((w) => measure(c, w, { size: 36, weight: 600 })));
  const ls = Math.min(1, (inner * 0.95) / Math.max(1, longestWord));
  items.forEach((it, i) => {
    const x = pad + (i % cols) * (cw + gap);
    const y = headBottom + Math.floor(i / cols) * (ch + gap);
    els.push(rect(x, y, cw, ch, th.surface, { radius: th.radius * u, animation: "slide-up", animationDelay: 0.15 * i }));
    els.push(rect(x + 44 * u, y + 44 * u, 60 * u, 6 * u, th.accent, { radius: 3 * u }));
    const inner = column(
      c,
      { x: x + 44 * u, y: y + 44 * u, w: cw - 88 * u, h: ch - 88 * u },
      [
        { t: "text", str: it.value, o: { size: 150, font: "head", fit: true, min: 50, color: th.accent, lh: 1, delay: 0.2 + 0.15 * i } },
        { t: "text", str: it.label, o: { size: 36 * ls, weight: 600, delay: 0.3 + 0.15 * i }, gap: 18 },
        { t: "text", str: it.note, o: { size: 26 * Math.max(ls, 0.85), color: th.muted, delay: 0.35 + 0.15 * i }, gap: 10 },
      ],
      { v: "bottom" }
    );
    els.push(...inner);
  });
  p.elements = [...els, ...chrome(c, { footer: k.footer })];
  return p;
};

// ─── List board: menus, prices, directories, results ──────────────────────────
export const list: Layout = (W, H, th, k) => {
  const c = ctx(W, H, th);
  const { u, pad, portrait } = c;
  const p = page(c);
  const items = k.items ?? [];
  const head = column(c, { x: pad, y: pad * 1.1, w: W - pad * 2, h: 0 }, headingParts(c, { eyebrow: k.eyebrow, title: k.title, body: k.body }, { title: portrait ? 96 : 100, body: 32 }));
  const top = Math.max(...head.map((e) => e.y + e.h)) + 70 * u;
  const cols = !portrait && !c.square && items.length > 5 ? 2 : 1;
  const perCol = Math.ceil(items.length / cols);
  const gapX = 110 * u;
  const colW = (W - pad * 2 - gapX * (cols - 1)) / cols;
  const areaH = H - top - pad - (k.footer ? 50 * u : 0);
  const base = (items.some((i) => i.note) ? 150 : 110) * u;
  const grow = portrait ? 1.3 : 1;
  const rowH = Math.min(areaH / Math.max(1, perCol), base * grow * (portrait ? 1.25 : 1));
  const s = Math.min(grow, rowH / base);
  const els: CanvasElement[] = [...head];
  items.forEach((it, i) => {
    const col = Math.floor(i / perCol);
    const x = pad + col * (colW + gapX);
    const y = top + (i % perCol) * rowH;
    const d = 0.25 + 0.07 * i;
    const valW = it.value ? Math.min(colW * 0.5, measure(c, it.value, { size: 44 * s, weight: 700 }) * 1.08 + 8 * u) : 0;
    const lab = text(c, x, y, colW - valW - 20 * u, it.label, { size: 44 * s, weight: 600, lh: 1.25, anim: "fade", delay: d });
    els.push(lab.el);
    if (it.value) els.push(text(c, x + colW - valW, y, valW, it.value, { size: 44 * s, weight: 700, align: "right", color: th.accent, anim: "fade", delay: d }).el);
    if (it.note) els.push(text(c, x, y + lab.h + 2 * u, colW - valW, it.note, { size: 27 * Math.max(s, 0.8), color: th.muted, lh: 1.25, anim: "fade", delay: d }).el);
    els.push(rect(x, y + rowH - 22 * u, colW, 2 * u, alpha(th.text, 0.14)));
  });
  p.elements = [...els, ...chrome(c, { footer: k.footer })];
  return p;
};

// ─── Agenda: a timeline of times and sessions ─────────────────────────────────
export const agenda: Layout = (W, H, th, k) => {
  const c = ctx(W, H, th);
  const { u, pad, portrait } = c;
  const p = page(c);
  const items = k.items ?? [];
  const head = column(c, { x: pad, y: pad * 1.1, w: W - pad * 2, h: 0 }, headingParts(c, { eyebrow: k.eyebrow, title: k.title }, { title: portrait ? 96 : 100 }));
  const top = Math.max(...head.map((e) => e.y + e.h)) + 80 * u;
  const areaH = H - top - pad - (k.footer ? 50 * u : 0);
  const rowH = Math.min(areaH / Math.max(1, items.length), (portrait ? 240 : 170) * u);
  const s = Math.min(portrait ? 1.25 : 1, rowH / (150 * u));
  const timeW = (portrait || c.square ? 200 : 280) * u;
  const lineX = pad + timeW + 40 * u;
  const els: CanvasElement[] = [...head, rect(lineX - 1.5 * u, top + 10 * u, 3 * u, rowH * (items.length - 1) + 20 * u, alpha(th.text, 0.2))];
  items.forEach((it, i) => {
    const y = top + i * rowH;
    const d = 0.25 + 0.1 * i;
    els.push(text(c, pad, y - 4 * u, timeW, it.value ?? "", { size: 38 * Math.min(s, 1.15), weight: 700, align: "right", color: th.accent, anim: "fade", delay: d }).el);
    els.push(circle(lineX, y + 22 * u, 14 * u, i === 0 ? th.accent : th.bg, { stroke: th.accent, strokeWidth: 4 * u, animation: "zoom", animationDelay: d }));
    const lab = text(c, lineX + 54 * u, y - 4 * u, W - lineX - 54 * u - pad, it.label, { size: 42 * s, weight: 600, lh: 1.2, anim: "slide-left", delay: d });
    els.push(lab.el);
    if (it.note) els.push(text(c, lineX + 54 * u, lab.el.y + lab.h + 4 * u, W - lineX - 54 * u - pad, it.note, { size: 28 * Math.max(s, 0.8), color: th.muted, lh: 1.2, anim: "fade", delay: d }).el);
  });
  p.elements = [...els, ...chrome(c, { footer: k.footer })];
  return p;
};

// ─── Event: a date block and the details ──────────────────────────────────────
export const event: Layout = (W, H, th, k) => {
  const c = ctx(W, H, th);
  const { u, pad, portrait, square } = c;
  const p = page(c);
  const stacked = portrait || square;
  const dw = 330 * u;
  const dh = 380 * u;
  const d = k.date ?? { month: "MAR", day: "24" };
  const dx = stacked ? pad : pad;
  const dy = stacked ? H * (portrait ? 0.2 : 0.14) : (H - dh) / 2;
  const card: CanvasElement[] = [
    rect(dx, dy, dw, dh, th.accent, { radius: th.radius * u, animation: "zoom" }),
    text(c, dx, dy + 44 * u, dw, d.month, { size: 50, weight: 700, upper: true, ls: 0.14, align: "center", color: th.accentText }).el,
    text(c, dx, dy + 108 * u, dw, d.day, { size: 180, font: "head", align: "center", color: th.accentText, lh: 1, fit: true, min: 80 }).el,
  ];
  if (d.weekday) card.push(text(c, dx, dy + dh - 78 * u, dw, d.weekday, { size: 28, weight: 600, upper: true, ls: 0.2, align: "center", color: th.accentText }).el);
  const box = stacked ? { x: pad, y: dy + dh + 80 * u, w: W - pad * 2, h: H - (dy + dh + 80 * u) - pad } : { x: pad + dw + 100 * u, y: pad, w: W - pad * 2 - dw - 100 * u, h: H - pad * 2 };
  p.elements = [
    circle(W * 0.9, H * 0.9, Math.min(W, H) * 0.45, alpha(th.accent, 0.07)),
    ...card,
    ...column(c, box, [
      { t: "text", str: k.eyebrow, o: { size: 28, weight: 700, upper: true, ls: 0.28, color: th.accent } },
      { t: "text", str: k.title, o: { size: stacked ? 96 : 110, font: "head", fit: true, min: 40 }, gap: 26 },
      { t: "text", str: k.body, o: { size: 40, color: th.muted }, gap: 30 },
      ...(k.items ?? []).map((it, i) => ({ t: "text" as const, str: `${it.label}${it.value ? `  ·  ${it.value}` : ""}`, o: { size: 34, weight: 600, color: th.text }, gap: i ? 12 : 44 })),
      { t: "pill", str: k.cta, gap: 48 },
    ], { v: stacked ? "top" : "center" }),
    ...chrome(c, { brand: k.brand, footer: k.footer }),
  ];
  return p;
};

// ─── Quote: one line worth reading ────────────────────────────────────────────
export const quote: Layout = (W, H, th, k) => {
  const c = ctx(W, H, th);
  const { u, pad, portrait } = c;
  const p = page(c);
  const w = Math.min(W - pad * 2, 1500 * u);
  const x = (W - w) / 2;
  const mark = text(c, x - 10 * u, 0, 400 * u, "“", { size: 380, font: "head", color: th.accent, lh: 1, anim: "zoom" });
  const body = column(c, { x, y: 0, w, h: H - pad * 2 - 240 * u }, [
    { t: "text", str: k.title, o: { size: portrait ? 72 : 84, font: "head", lh: 1.18, italic: /Gelasio|Tinos|Caladea/.test(th.head) } },
    { t: "bar", w: 80, h: 4, gap: 56 },
    { t: "text", str: k.eyebrow, o: { size: 32, weight: 700, upper: true, ls: 0.18 }, gap: 30 },
    { t: "text", str: k.body, o: { size: 30, color: th.muted }, gap: 10 },
  ]);
  const bodyH = Math.max(...body.map((e) => e.y + e.h));
  const total = 240 * u + bodyH;
  const top = Math.max(pad * 0.9 + 60 * u, (H - total) / 2);
  mark.el.y = top - 60 * u;
  mark.el.h = 230 * u;
  for (const e of body) e.y += top + 240 * u;
  p.elements = [mark.el, ...body, ...chrome(c, { brand: k.brand, footer: k.footer })];
  return p;
};

// ─── Countdown: days, hours, minutes to go ────────────────────────────────────
export const countdown: Layout = (W, H, th, k) => {
  const c = ctx(W, H, th);
  const { u, pad, portrait } = c;
  const p = page(c);
  const items = k.items ?? [
    { label: "Days", value: "12" },
    { label: "Hours", value: "08" },
    { label: "Minutes", value: "45" },
    { label: "Seconds", value: "30" },
  ];
  const cols = portrait ? 2 : items.length;
  const rows = Math.ceil(items.length / cols);
  const gap = 30 * u;
  const bw = Math.min((W - pad * 2 - gap * (cols - 1)) / cols, 380 * u);
  const bh = bw * 1.05;
  const gridW = bw * cols + gap * (cols - 1);
  const head = column(c, { x: pad, y: 0, w: W - pad * 2, h: 0 }, headingParts(c, { eyebrow: k.eyebrow, title: k.title }, { title: portrait ? 100 : 110 }), { align: "center" });
  const headH = Math.max(...head.map((e) => e.y + e.h));
  const foot = k.body ? text(c, pad, 0, W - pad * 2, k.body, { size: 36, color: th.muted, align: "center", anim: "fade", delay: 0.8 }) : null;
  const total = headH + 80 * u + rows * bh + (rows - 1) * gap + (foot ? 70 * u + foot.h : 0);
  const top = (H - total) / 2;
  for (const e of head) e.y += top;
  const gridY = top + headH + 80 * u;
  const els: CanvasElement[] = [...head];
  items.forEach((it, i) => {
    const x = (W - gridW) / 2 + (i % cols) * (bw + gap);
    const y = gridY + Math.floor(i / cols) * (bh + gap);
    els.push(rect(x, y, bw, bh, th.surface, { radius: th.radius * u, stroke: alpha(th.accent, 0.3), strokeWidth: 2 * u, animation: "zoom", animationDelay: 0.2 + i * 0.1 }));
    const lab = text(c, x, 0, bw, it.label, { size: Math.min(28, (bw * 0.13) / u), weight: 700, upper: true, ls: 0.2, align: "center", color: th.muted, fit: true, min: 14 });
    lab.el.y = y + bh - bh * 0.12 - lab.h;
    const num = text(c, x + bw * 0.08, 0, bw * 0.84, it.value ?? "00", { size: Math.min(200, (bh * 0.46) / u), font: "head", fit: true, min: 40, align: "center", color: th.accent, lh: 1 });
    num.el.y = y + (lab.el.y - y - num.h) / 2 + bh * 0.03;
    els.push(num.el, lab.el);
  });
  if (foot) {
    foot.el.y = gridY + rows * bh + (rows - 1) * gap + 70 * u;
    els.push(foot.el);
  }
  p.elements = [...els, ...chrome(c, { brand: k.brand, footer: k.footer })];
  return p;
};

// ─── Notice: banner, message, points to remember ──────────────────────────────
export const notice: Layout = (W, H, th, k) => {
  const c = ctx(W, H, th);
  const { u, pad, portrait } = c;
  const p = page(c, { flat: true });
  const band = 170 * u;
  const els: CanvasElement[] = [
    rect(0, 0, W, band, th.accent, { animation: "fade" }),
    circle(pad + 45 * u, band / 2, 45 * u, "transparent", { stroke: th.accentText, strokeWidth: 6 * u }),
    text(c, pad, band / 2 - 38 * u, 90 * u, k.value ?? "!", { size: 58, weight: 700, align: "center", color: th.accentText, lh: 1.2 }).el,
    text(c, pad + 130 * u, band / 2 - 22 * u, W - pad * 2 - 130 * u, k.eyebrow ?? "Notice", { size: 36, weight: 700, upper: true, ls: 0.2, color: th.accentText, lh: 1.2 }).el,
  ];
  const parts = [
    { t: "text" as const, str: k.title, o: { size: portrait ? 104 : 120, font: "head" as const, fit: true, min: 44 } },
    { t: "text" as const, str: k.body, o: { size: 40, color: th.muted }, gap: 36 },
    ...(k.items ?? []).map((it, i) => ({ t: "text" as const, str: `■  ${it.label}`, o: { size: 38, weight: 600 }, gap: i ? 20 : 56 })),
  ];
  els.push(...column(c, { x: pad, y: band + pad, w: Math.min(W - pad * 2, 1500 * u), h: H - band - pad * 2 - 80 * u }, parts, { v: "center" }));
  // Bullet squares in the accent colour: recolour the glyph by splitting it out.
  for (const e of els) {
    if (e.type === "text" && e.text.startsWith("■  ")) {
      els.push({ ...rect(e.x, e.y + e.fontSize * 0.42, e.fontSize * 0.42, e.fontSize * 0.42, th.accent, { radius: 2 * u }), animation: e.animation, animationDelay: e.animationDelay });
      e.text = e.text.slice(3);
      e.x += e.fontSize * 0.9;
      e.w -= e.fontSize * 0.9;
    }
  }
  if (k.footer) {
    els.push(rect(0, H - 110 * u, W, 110 * u, th.surface));
    els.push(text(c, pad, H - 110 * u + 36 * u, W - pad * 2, k.footer, { size: 28, weight: 600, upper: true, ls: 0.16, color: th.muted }).el);
  }
  p.elements = els;
  return p;
};

// ─── Wayfinding: arrows to where people are going ─────────────────────────────
export const wayfinding: Layout = (W, H, th, k) => {
  const c = ctx(W, H, th);
  const { u, pad, portrait } = c;
  const p = page(c);
  const items = k.items ?? [];
  const head = column(c, { x: pad, y: pad * 1.1, w: W - pad * 2, h: 0 }, headingParts(c, { eyebrow: k.eyebrow, title: k.title }, { title: portrait ? 100 : 110 }));
  const top = Math.max(...head.map((e) => e.y + e.h)) + 70 * u;
  const cols = !portrait && !c.square && items.length > 4 ? 2 : 1;
  const perCol = Math.ceil(items.length / cols);
  const gapX = 80 * u;
  const colW = (W - pad * 2 - gapX * (cols - 1)) / cols;
  const areaH = H - top - pad - (k.footer ? 50 * u : 0);
  const rowH = Math.min(areaH / Math.max(1, perCol), 190 * u);
  const r = Math.min(rowH * 0.36, 58 * u);
  const els: CanvasElement[] = [...head];
  items.forEach((it, i) => {
    const x = pad + Math.floor(i / perCol) * (colW + gapX);
    const y = top + (i % perCol) * rowH;
    const d = 0.25 + 0.08 * i;
    els.push(circle(x + r, y + r, r, th.accent, { animation: "zoom", animationDelay: d }));
    els.push(text(c, x, y + r - r * 0.72, r * 2, it.value ?? "→", { size: (r * 1.1) / u, weight: 700, align: "center", color: th.accentText, lh: 1.2, delay: d }).el);
    const noteW = it.note ? Math.min(colW * 0.4, measure(c, it.note, { size: 28, weight: 600, upper: true, ls: 0.14 }) * 1.1 + 8 * u) : 0;
    els.push(text(c, x + r * 2 + 36 * u, y + r - 34 * u, colW - r * 2 - 36 * u - noteW - 20 * u, it.label, { size: 48, weight: 600, lh: 1.2, anim: "slide-left", delay: d, fit: true, min: 26 }).el);
    if (it.note) els.push(text(c, x + colW - noteW, y + r - 20 * u, noteW, it.note, { size: 28, weight: 600, upper: true, ls: 0.14, align: "right", color: th.muted, lh: 1.2, delay: d }).el);
    if (i % perCol < perCol - 1) els.push(rect(x, y + rowH - 14 * u, colW, 2 * u, alpha(th.text, 0.12)));
  });
  p.elements = [...els, ...chrome(c, { footer: k.footer })];
  return p;
};

// ─── Promotion: a big offer, a badge and a picture ────────────────────────────
export const promo: Layout = (W, H, th, k) => {
  const c = ctx(W, H, th);
  const { u, pad, portrait, square } = c;
  const p = page(c, { flat: true });
  const stacked = portrait || square;
  const pic = stacked ? { x: 0, y: 0, w: W, h: H * (square ? 0.42 : 0.46) } : { x: W * 0.52, y: 0, w: W * 0.48, h: H };
  const box = stacked ? { x: pad, y: pic.h + 70 * u, w: W - pad * 2, h: H - pic.h - 70 * u - pad } : { x: pad, y: pad, w: W * 0.52 - pad * 1.6, h: H - pad * 2 };
  const badgeR = 120 * u;
  const bx = stacked ? W - pad - badgeR : pic.x + pic.w - badgeR - 70 * u;
  const by = stacked ? pic.h : badgeR + 70 * u;
  p.elements = [
    image(pic.x, pic.y, pic.w, pic.h, img(k), { animation: "fade" }),
    ...column(c, box, [
      { t: "text", str: k.eyebrow, o: { size: 28, weight: 700, upper: true, ls: 0.28, color: th.accent } },
      { t: "text", str: k.value, o: { size: 300, font: "head", fit: true, min: 90, color: th.accent, lh: 0.95, anim: "zoom" }, gap: 16 },
      { t: "text", str: k.title, o: { size: 84, font: "head", fit: true, min: 40 }, gap: 18 },
      { t: "text", str: k.body, o: { size: 36, color: th.muted }, gap: 28 },
      { t: "pill", str: k.cta, gap: 44 },
    ], { v: stacked ? "top" : "center" }),
  ];
  const badge = k.items?.[0]?.label;
  if (badge) {
    p.elements.push(circle(bx, by, badgeR, th.text, { animation: "zoom", animationDelay: 0.5 }));
    p.elements.push(text(c, bx - badgeR, by - 40 * u, badgeR * 2, badge, { size: 34, weight: 700, upper: true, ls: 0.06, align: "center", color: th.bg, lh: 1.15, fit: true, min: 18, delay: 0.5 }).el);
  }
  if (k.footer) p.elements.push(...chrome(c, { footer: k.footer }).map((e) => ({ ...e, x: box.x, w: box.w })));
  return p;
};

// ─── Cards: three pictures with captions — projects, people, products ────────
export const cards: Layout = (W, H, th, k) => {
  const c = ctx(W, H, th);
  const { u, pad, portrait } = c;
  const p = page(c);
  const items = (k.items ?? []).slice(0, portrait ? 3 : 4);
  const head = column(c, { x: pad, y: pad * 1.1, w: W - pad * 2, h: 0 }, headingParts(c, { eyebrow: k.eyebrow, title: k.title }, { title: portrait ? 90 : 96 }));
  const top = Math.max(...head.map((e) => e.y + e.h)) + 70 * u;
  const gap = 32 * u;
  const areaH = H - top - pad;
  const els: CanvasElement[] = [...head];
  const r = th.radius * u;
  items.forEach((it, i) => {
    const d = 0.2 + 0.12 * i;
    if (portrait) {
      const ch = (areaH - gap * (items.length - 1)) / items.length;
      const y = top + i * (ch + gap);
      els.push(rect(pad, y, W - pad * 2, ch, th.surface, { radius: r, animation: "slide-up", animationDelay: d }));
      els.push(image(pad, y, ch * 1.1, ch, img(k, i), { radius: r, animation: "fade", animationDelay: d }));
      els.push(...column(c, { x: pad + ch * 1.1 + 40 * u, y: y + 30 * u, w: W - pad * 2 - ch * 1.1 - 80 * u, h: ch - 60 * u }, [
        { t: "text", str: it.value, o: { size: 24, weight: 700, upper: true, ls: 0.2, color: th.accent, delay: d } },
        { t: "text", str: it.label, o: { size: 44, weight: 700, font: "head", fit: true, min: 26, delay: d }, gap: 12 },
        { t: "text", str: it.note, o: { size: 28, color: th.muted, delay: d }, gap: 10 },
      ], { v: "center" }));
    } else {
      const cw = (W - pad * 2 - gap * (items.length - 1)) / items.length;
      const x = pad + i * (cw + gap);
      const ih = areaH * 0.62;
      els.push(rect(x, top, cw, areaH, th.surface, { radius: r, animation: "slide-up", animationDelay: d }));
      els.push(image(x, top, cw, ih, img(k, i), { radius: r, animation: "fade", animationDelay: d }));
      els.push(...column(c, { x: x + 36 * u, y: top + ih + 30 * u, w: cw - 72 * u, h: areaH - ih - 60 * u }, [
        { t: "text", str: it.value, o: { size: 22, weight: 700, upper: true, ls: 0.2, color: th.accent, delay: d } },
        { t: "text", str: it.label, o: { size: 40, weight: 700, font: "head", fit: true, min: 24, delay: d }, gap: 12 },
        { t: "text", str: it.note, o: { size: 26, color: th.muted, delay: d }, gap: 10 },
      ]));
    }
  });
  p.elements = els;
  return p;
};

// ─── Mosaic: a big picture and two small ones, with a title band ──────────────
export const mosaic: Layout = (W, H, th, k) => {
  const c = ctx(W, H, th);
  const { u, pad, portrait, square } = c;
  const p = page(c, { flat: true });
  const g = 16 * u;
  const stacked = portrait || square;
  const els: CanvasElement[] = [];
  let textBox: { x: number; y: number; w: number; h: number };
  if (stacked) {
    const bigH = H * 0.42;
    const smallH = H * 0.2;
    els.push(image(0, 0, W, bigH, img(k, 0), { animation: "fade" }));
    els.push(image(0, bigH + g, (W - g) / 2, smallH, img(k, 1), { animation: "fade", animationDelay: 0.15 }));
    els.push(image((W + g) / 2, bigH + g, (W - g) / 2, smallH, img(k, 2), { animation: "fade", animationDelay: 0.3 }));
    textBox = { x: pad, y: bigH + smallH + g + 70 * u, w: W - pad * 2, h: H - (bigH + smallH + g + 70 * u) - pad };
  } else {
    const bigW = W * 0.6;
    els.push(image(0, 0, bigW, H, img(k, 0), { animation: "fade" }));
    els.push(image(bigW + g, 0, W - bigW - g, (H - g) / 2, img(k, 1), { animation: "fade", animationDelay: 0.15 }));
    els.push(image(bigW + g, (H + g) / 2, W - bigW - g, (H - g) / 2, img(k, 2), { animation: "fade", animationDelay: 0.3 }));
    const bandH = H * 0.42;
    els.push(rect(0, H - bandH, bigW * 0.86, bandH, th.bg, { animation: "slide-up" }));
    textBox = { x: pad, y: H - bandH + 60 * u, w: bigW * 0.86 - pad * 1.5, h: bandH - 120 * u };
  }
  els.push(...column(c, textBox, headingParts(c, { eyebrow: k.eyebrow, title: k.title, body: k.body }, { title: stacked ? 84 : 76, body: 32 }), { v: stacked ? "top" : "center" }));
  p.elements = els;
  return p;
};

// ─── Profile: a person, their role and a line about them ──────────────────────
export const profile: Layout = (W, H, th, k) => {
  const c = ctx(W, H, th);
  const { u, pad, portrait, square } = c;
  const p = page(c);
  const stacked = portrait || square;
  const d = (stacked ? (square ? 380 : 560) : 640) * u;
  const px = stacked ? (W - d) / 2 : pad + 40 * u;
  const py = stacked ? (square ? pad : H * 0.12) : (H - d) / 2;
  const parts = [
    { t: "text" as const, str: k.eyebrow, o: { size: 28, weight: 700, upper: true, ls: 0.28, color: th.accent } },
    { t: "text" as const, str: k.title, o: { size: stacked ? 96 : 110, font: "head" as const, fit: true, min: 40 }, gap: 24 },
    { t: "text" as const, str: k.value, o: { size: 38, weight: 600, color: th.accent }, gap: 14 },
    { t: "text" as const, str: k.body, o: { size: 38, color: th.muted, italic: true }, gap: 40 },
  ];
  p.elements = [
    circle(px + d / 2 + 26 * u, py + d / 2 + 26 * u, d / 2, alpha(th.accent, 0.35)),
    image(px, py, d, d, img(k), { radius: d / 2, animation: "zoom" }),
    ...column(
      c,
      stacked ? { x: pad, y: py + d + 80 * u, w: W - pad * 2, h: H - (py + d + 80 * u) - pad } : { x: px + d + 140 * u, y: pad, w: W - (px + d + 140 * u) - pad, h: H - pad * 2 },
      parts,
      { align: stacked ? "center" : "left", v: stacked ? "top" : "center" }
    ),
    ...chrome(c, { brand: k.brand, footer: k.footer }),
  ];
  return p;
};

// ─── Goal tracker: a headline figure, a progress bar and supporting stats ────
export const goal: Layout = (W, H, th, k) => {
  const c = ctx(W, H, th);
  const { u, pad, portrait } = c;
  const p = page(c);
  const head = column(c, { x: pad, y: pad * 1.1, w: W - pad * 2, h: 0 }, headingParts(c, { eyebrow: k.eyebrow, title: k.title }, { title: portrait ? 84 : 90 }));
  let y = Math.max(...head.map((e) => e.y + e.h)) + (portrait ? 120 : 70) * u;
  const els: CanvasElement[] = [...head];
  const fig = text(c, pad, y, W - pad * 2, k.value ?? "72%", { size: portrait ? 260 : 240, font: "head", fit: true, min: 90, color: th.accent, lh: 1, anim: "zoom" });
  els.push(fig.el);
  y += fig.h + 10 * u;
  if (k.body) {
    const b = text(c, pad, y, W - pad * 2, k.body, { size: 38, color: th.muted, anim: "fade", delay: 0.2 });
    els.push(b.el);
    y += b.h + 40 * u;
  }
  const barH = 34 * u;
  const pct = Math.min(1, Math.max(0, k.progress ?? 0.72));
  els.push(rect(pad, y, W - pad * 2, barH, th.surface, { radius: barH / 2 }));
  els.push(rect(pad, y, (W - pad * 2) * pct, barH, th.accent, { radius: barH / 2, animation: "slide-left", animationDelay: 0.3 }));
  y += barH + (portrait ? 120 : 80) * u;
  const items = k.items ?? [];
  const cols = portrait ? 1 : Math.max(1, items.length);
  const gap = 40 * u;
  const cw = (W - pad * 2 - gap * (cols - 1)) / cols;
  items.forEach((it, i) => {
    const x = pad + (i % cols) * (cw + gap);
    const yy = y + Math.floor(i / cols) * 190 * u;
    els.push(rect(x, yy, 4 * u, 140 * u, th.accent));
    els.push(text(c, x + 34 * u, yy, cw - 34 * u, it.value ?? "", { size: 76, font: "head", fit: true, min: 30, lh: 1, anim: "fade", delay: 0.4 + i * 0.1 }).el);
    els.push(text(c, x + 34 * u, yy + 90 * u, cw - 34 * u, it.label, { size: 28, color: th.muted, anim: "fade", delay: 0.4 + i * 0.1 }).el);
  });
  p.elements = [...els, ...chrome(c, { footer: k.footer })];
  return p;
};

// ─── Now / next: a headline with a ticker bar along the foot ──────────────────
export const nowNext: Layout = (W, H, th, k) => {
  const c = ctx(W, H, th);
  const { u, pad, portrait } = c;
  const p = page(c);
  const barH = (portrait ? 230 : 170) * u;
  const els: CanvasElement[] = [
    ...column(c, { x: pad, y: pad, w: Math.min(W - pad * 2, 1600 * u), h: H - barH - pad * 2 }, headingParts(c, k, { title: portrait ? 120 : 140 }), { v: "center" }),
    rect(0, H - barH, W, barH, th.surface, { animation: "slide-up" }),
  ];
  const next = k.items?.[0];
  if (next) {
    const lab = pill(c, pad, H - barH / 2 - 35 * u, next.label, { size: 26, delay: 0.5 });
    els.push(...lab.els);
    const tx = pad + lab.w + 40 * u;
    const right = next.value ? 360 * u : 0;
    els.push(text(c, tx, H - barH / 2 - 30 * u, W - tx - pad - right, next.note ?? "", { size: 42, weight: 600, lh: 1.2, delay: 0.55, fit: true, min: 22 }).el);
    if (next.value) els.push(text(c, W - pad - right, H - barH / 2 - 30 * u, right, next.value, { size: 42, weight: 700, align: "right", color: th.accent, lh: 1.2, delay: 0.6 }).el);
  }
  if (k.brand) els.push(...chrome(c, { brand: k.brand }));
  p.elements = els;
  return p;
};

export const LAYOUTS = {
  hero,
  editorial,
  split,
  photo,
  photoCenter,
  frame,
  bigStat,
  stats,
  list,
  agenda,
  event,
  quote,
  countdown,
  notice,
  wayfinding,
  promo,
  cards,
  mosaic,
  profile,
  goal,
  nowNext,
} satisfies Record<string, Layout>;

export type LayoutId = keyof typeof LAYOUTS;
