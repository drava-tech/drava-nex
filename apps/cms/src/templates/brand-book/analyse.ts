import { CANVAS_FONTS } from "@platform/ui/templates/canvas";

/**
 * Brand book analyser. Runs in the browser, needs no AI service and never
 * sends the file anywhere: pdf.js reads the PDF and every heuristic below
 * runs on what it finds.
 *
 *   text      → colour codes (HEX / RGB / CMYK) with their role labels,
 *               the brand name, a labelled tagline
 *   fonts     → the embedded font families: biggest text = heading,
 *               most-set text = body, mapped to the fonts screens can show
 *   pixels    → the colours that actually dominate the pages
 *   shapes    → logo candidates: compact non-text marks on the cover and on
 *               pages that talk about the logo
 *
 * An image (a one-page brand sheet) gets the pixel and logo passes only.
 */

export interface BrandColour {
  hex: string;
  /** Role the book gives it ("Primary", "Accent"…), or a colour name. */
  label: string | null;
  /** Written in the book as a code, or measured off the pages. */
  source: "declared" | "measured";
}

export interface BrandFont {
  family: string;
  role: "heading" | "body" | "other";
  /** The closest font screens can show (a CANVAS_FONTS value). */
  mapped: string;
  mappedLabel: string;
}

export interface LogoCandidate {
  /** PNG, cropped and — on a plain background — with the background keyed out. */
  dataUrl: string;
  width: number;
  height: number;
  page: number;
}

export interface BrandBookResult {
  name: string | null;
  tagline: string | null;
  colours: BrandColour[];
  fonts: BrandFont[];
  logos: LogoCandidate[];
  suggestion: { background: string; accent: string; headingFont: string | null; bodyFont: string | null };
  pages: number;
  notes: string[];
}

type Progress = (message: string) => void;

const MAX_PAGES = 30;

/** Pages that draw the logo with guides on it, or show how not to use it. */
const CONSTRUCTION =
  /\b(spacing|clear\s?space|exclusion\s?zone|safe\s?(zone|area)|construction|grid|factor|minimum\s?size|min\.?\s?size|proportions?|misuse|incorrect|don'?t|do not|never)\b/i;
const SMALL_W = 360;
const LARGE_W = 1100;

// ─── Colour maths ─────────────────────────────────────────────────────────────

type RGB = [number, number, number];

const clamp = (n: number) => Math.max(0, Math.min(255, Math.round(n)));
const toHex = ([r, g, b]: RGB) => `#${[r, g, b].map((c) => clamp(c).toString(16).padStart(2, "0")).join("")}`;
const fromHex = (hex: string): RGB => {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
};
const dist = (a: RGB, b: RGB) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);

function luminance([r, g, b]: RGB): number {
  const f = (c: number) => {
    const v = c / 255;
    return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
}

function contrast(a: RGB, b: RGB): number {
  const [x, y] = [luminance(a), luminance(b)].sort((p, q) => q - p) as [number, number];
  return (x + 0.05) / (y + 0.05);
}

/** HSL saturation and lightness, 0–1. */
function sl([r, g, b]: RGB): { s: number; l: number } {
  const [mx, mn] = [Math.max(r, g, b) / 255, Math.min(r, g, b) / 255];
  const l = (mx + mn) / 2;
  const s = mx === mn ? 0 : l > 0.5 ? (mx - mn) / (2 - mx - mn) : (mx - mn) / (mx + mn);
  return { s, l };
}

const cmykToRgb = (c: number, m: number, y: number, k: number): RGB => {
  const [C, M, Y, K] = [c, m, y, k].map((v) => Math.min(100, v) / 100) as [number, number, number, number];
  return [255 * (1 - C) * (1 - K), 255 * (1 - M) * (1 - K), 255 * (1 - Y) * (1 - K)];
};

// ─── Text: colour codes, name, tagline ────────────────────────────────────────

const ROLE = /\b(primary|secondary|tertiary|accent|highlight|background|core|main|neutral|dark|light|supporting|base)\b/gi;
const CODE_WORDS = new Set(["PANTONE", "PMS", "CMYK", "RGB", "HEX", "RAL", "WEB", "PRINT", "SCREEN", "DIGITAL", "COLOUR", "COLOR", "C", "M", "Y", "K", "R", "G", "B"]);

function labelBefore(text: string, at: number): string | null {
  const before = text.slice(Math.max(0, at - 90), at);
  const roles = [...before.matchAll(ROLE)];
  const role = roles.length ? roles[roles.length - 1]![1]! : null;
  // A colour's own name usually sits right before its codes: "Midnight Blue  Pantone 289C  RGB…"
  const named = [...before.matchAll(/\b([A-Z][a-z]{2,}(?:\s[A-Z][a-z]{2,}){0,2})\b/g)]
    .map((m) => m[1]!)
    .filter((w) => !w.split(" ").some((p) => CODE_WORDS.has(p.toUpperCase())));
  const name = named.length ? named[named.length - 1]! : null;
  if (role && name && !name.toLowerCase().includes(role.toLowerCase())) return `${cap(role)} · ${name}`;
  return role ? cap(role) : name;
}

type Labeler = (at: number) => string | null;

const cap = (s: string) => s[0]!.toUpperCase() + s.slice(1).toLowerCase();

/**
 * Brand books often lay colours out in a grid — every heading first, then
 * every code — so "the words just before the code" can be another swatch's.
 * With positions, take the nearest role word above (or level with) the code.
 */
function spatialLabeler(items: PdfTextItem[], starts: number[], text: string): Labeler {
  const roles = items
    .map((it) => ({ it, m: new RegExp(ROLE.source, "i").exec(it.str) }))
    .filter((r): r is { it: PdfTextItem; m: RegExpExecArray } => !!r.m);
  return (at) => {
    let lo = 0;
    let hi = starts.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (starts[mid]! <= at) lo = mid;
      else hi = mid - 1;
    }
    const code = items[lo];
    if (!code || !roles.length) return labelBefore(text, at);
    const [cx, cy] = [code.transform[4]!, code.transform[5]!];
    let best: (typeof roles)[number] | null = null;
    let bestScore = Infinity;
    for (const r of roles) {
      const dy = r.it.transform[5]! - cy; // PDF y grows upwards: above = positive
      if (dy < -2) continue;
      const score = dy + Math.abs(r.it.transform[4]! - cx) * 0.6;
      if (score < bestScore) {
        bestScore = score;
        best = r;
      }
    }
    return best ? cap(best.m[1]!) : labelBefore(text, at);
  };
}

function declaredColours(text: string, label: Labeler = (at) => labelBefore(text, at)): { rgb: RGB; label: string | null; at: number }[] {
  const out: { rgb: RGB; label: string | null; at: number; print?: boolean }[] = [];
  const push = (rgb: RGB, at: number, print = false) => out.push({ rgb, label: label(at), at, print });
  for (const m of text.matchAll(/(?:#\s?|\bHEX\s*:?\s*#?\s?)([0-9a-f]{6}|[0-9a-f]{3})\b/gi)) {
    let h = m[1]!;
    if (h.length === 3) h = h.replace(/./g, (c) => c + c);
    push(fromHex(`#${h}`), m.index!);
  }
  const num = "(\\d{1,3})";
  const sep = "[\\s,/:.]+";
  for (const m of text.matchAll(new RegExp(`\\bRGB\\s*:?\\s*${num}${sep}${num}${sep}${num}\\b`, "gi"))) {
    const v = [m[1], m[2], m[3]].map(Number) as RGB;
    if (v.every((c) => c <= 255)) push(v, m.index!);
  }
  for (const m of text.matchAll(new RegExp(`\\bR\\s*:?\\s*${num}\\s*G\\s*:?\\s*${num}\\s*B\\s*:?\\s*${num}\\b`, "g"))) {
    const v = [m[1], m[2], m[3]].map(Number) as RGB;
    if (v.every((c) => c <= 255)) push(v, m.index!);
  }
  for (const m of text.matchAll(new RegExp(`\\bC\\s*:?\\s*${num}\\s*M\\s*:?\\s*${num}\\s*Y\\s*:?\\s*${num}\\s*K\\s*:?\\s*${num}\\b`, "g"))) {
    const v = [m[1], m[2], m[3], m[4]].map(Number);
    if (v.every((c) => c <= 100)) push(cmykToRgb(v[0]!, v[1]!, v[2]!, v[3]!), m.index!, true);
  }
  for (const m of text.matchAll(new RegExp(`\\bCMYK\\s*:?\\s*${num}${sep}${num}${sep}${num}${sep}${num}\\b`, "gi"))) {
    const v = [m[1], m[2], m[3], m[4]].map(Number);
    if (v.every((c) => c <= 100)) push(cmykToRgb(v[0]!, v[1]!, v[2]!, v[3]!), m.index!, true);
  }
  // CMYK is a print approximation: when the same swatch also gives a screen
  // value (HEX / RGB) close by, the screen value wins.
  const screen = out.filter((c) => !c.print);
  return out
    .filter((c) => !c.print || !screen.some((x) => Math.abs(x.at - c.at) < 160 && dist(x.rgb, c.rgb) < 70))
    .sort((a, b) => a.at - b.at)
    .map(({ rgb, label, at }) => ({ rgb, label, at }));
}

const GENERIC = /\b(brand(ing)?|guide(line)?s?|book|manual|identity|style|standards?|visual|design|system|toolkit|version|edition|contents|introduction|corporate|v?\d+(\.\d+)*|20\d\d)\b/gi;

function cleanName(s: string | null | undefined): string | null {
  if (!s) return null;
  const out = s.replace(/[_]+/g, " ").replace(GENERIC, " ").replace(/[|•·:–—\-&]+\s*$/g, "").replace(/\s+/g, " ").trim();
  return out.length >= 2 && out.length <= 48 && /[a-z]/i.test(out) ? out : null;
}

function findTagline(text: string): string | null {
  const m = /\b(tag\s?line|slogan|strapline|brand\s?line|motto)\b\s*[:\-–—]?\s*["“‘']?([^"”’\n]{6,90}?)["”’]?(?:\s{2,}|[.!]|$)/i.exec(text);
  const t = m?.[2]?.trim();
  return t && t.split(/\s+/).length >= 2 && t.split(/\s+/).length <= 12 ? t : null;
}

// ─── Fonts ────────────────────────────────────────────────────────────────────

const STYLE_WORDS =
  /(Extra|Ultra|Semi|Demi)?(Bold|Black|Heavy|Light|Thin|Hairline|Medium|Regular|Book|Italic|Oblique|Condensed|Cond|Narrow)$/i;

function familyOf(raw: string): string | null {
  let n = raw.replace(/^[A-Z]{6}\+/, "").split(/[-,]/)[0]!;
  n = n.replace(/(PSMT|PS|MT|Std|Pro|LT|OT|W\d+)$/g, "");
  for (let i = 0; i < 3; i++) n = n.replace(STYLE_WORDS, "");
  n = n.replace(/([a-z])([A-Z])/g, "$1 $2").replace(/_/g, " ").trim();
  n = n.replace(/\s+(V|VF|Var|Variable)$/i, "").trim();
  if (n.length < 3 || /^(g d\d|f\d|t\d|ttf|font|symbol|zapf|dingbats)/i.test(n)) return null;
  return n;
}

/** The closest font screens can show for a brand font. */
export function closestFont(family: string): { label: string; value: string } {
  const f = family.toLowerCase();
  const pick = (label: string) => CANVAS_FONTS.find((c) => c.label === label) ?? CANVAS_FONTS[0]!;
  if (/mono|courier|code|consol|menlo/.test(f)) return pick("Cousine");
  if (/expanded|extended|\bex\b|\bext\b|wide|eurostile|archivo|druk|monument|clash/.test(f)) return pick("Archivo Expanded");
  if (/times|tinos|minion|baskerville|caslon|didot|bodoni|garamond|sabon/.test(f)) return pick("Tinos");
  if (/cambria|caladea|palatino|book antiqua|charter/.test(f)) return pick("Caladea");
  if (
    (/serif/.test(f) && !/sans/.test(f)) ||
    /georgia|gelasio|playfair|merriweather|lora|cormorant|crimson|libre|freight|tiempos|canela|recoleta|domaine|sectra|slab|chronicle|publico|noe/.test(f)
  )
    return pick("Gelasio");
  if (/calibri|carlito|segoe|candara|corbel/.test(f)) return pick("Carlito");
  if (/arial|helvetica|arimo|liberation|nimbus/.test(f)) return pick("Arimo");
  return pick("Inter");
}

// ─── Pixels: dominant colours ─────────────────────────────────────────────────

class ColourCounter {
  private buckets = new Map<number, { n: number; r: number; g: number; b: number }>();
  add(img: ImageData) {
    const d = img.data;
    for (let i = 0; i < d.length; i += 4 * 3) {
      if (d[i + 3]! < 200) continue;
      const [r, g, b] = [d[i]!, d[i + 1]!, d[i + 2]!];
      const key = ((r >> 4) << 8) | ((g >> 4) << 4) | (b >> 4);
      const e = this.buckets.get(key) ?? { n: 0, r: 0, g: 0, b: 0 };
      e.n++;
      e.r += r;
      e.g += g;
      e.b += b;
      this.buckets.set(key, e);
    }
  }
  top(limit: number): { rgb: RGB; share: number }[] {
    const all = [...this.buckets.values()];
    const total = all.reduce((s, e) => s + e.n, 0) || 1;
    const merged: { rgb: RGB; n: number }[] = [];
    for (const e of all.sort((a, b) => b.n - a.n)) {
      const rgb: RGB = [e.r / e.n, e.g / e.n, e.b / e.n];
      const near = merged.find((m) => dist(m.rgb, rgb) < 34);
      if (near) near.n += e.n;
      else merged.push({ rgb, n: e.n });
    }
    return merged
      .sort((a, b) => b.n - a.n)
      .filter((m) => m.n / total > 0.006)
      .slice(0, limit)
      .map((m) => ({ rgb: m.rgb.map(clamp) as RGB, share: m.n / total }));
  }
}

// ─── Shapes: logo candidates ──────────────────────────────────────────────────

interface Box {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

function borderColour(img: ImageData): RGB {
  const { width: w, height: h, data: d } = img;
  const counts = new Map<number, { n: number; rgb: RGB }>();
  const at = (x: number, y: number) => {
    const i = (y * w + x) * 4;
    const rgb: RGB = [d[i]!, d[i + 1]!, d[i + 2]!];
    const k = ((rgb[0] >> 3) << 10) | ((rgb[1] >> 3) << 5) | (rgb[2] >> 3);
    const e = counts.get(k) ?? { n: 0, rgb };
    e.n++;
    counts.set(k, e);
  };
  for (let x = 0; x < w; x += 4) {
    at(x, 0);
    at(x, h - 1);
  }
  for (let y = 0; y < h; y += 4) {
    at(0, y);
    at(w - 1, y);
  }
  return [...counts.values()].sort((a, b) => b.n - a.n)[0]?.rgb ?? [255, 255, 255];
}

/**
 * Compact marks on a page that aren't text: build an ink mask on a coarse
 * grid, blank out the text boxes, close small gaps, then flood-fill.
 */
function findMarks(img: ImageData, textBoxes: Box[], bg: RGB): Box[] {
  const { width: w, height: h, data: d } = img;
  const cell = 4;
  const gw = Math.ceil(w / cell);
  const gh = Math.ceil(h / cell);
  const ink = new Uint8Array(gw * gh);
  for (let y = 0; y < h; y += 2) {
    for (let x = 0; x < w; x += 2) {
      const i = (y * w + x) * 4;
      if (d[i + 3]! < 100) continue;
      if (Math.abs(d[i]! - bg[0]) + Math.abs(d[i + 1]! - bg[1]) + Math.abs(d[i + 2]! - bg[2]) > 60) ink[((y / cell) | 0) * gw + ((x / cell) | 0)] = 1;
    }
  }
  for (const t of textBoxes) {
    for (let gy = Math.max(0, (t.y0 / cell) | 0); gy <= Math.min(gh - 1, (t.y1 / cell) | 0); gy++)
      for (let gx = Math.max(0, (t.x0 / cell) | 0); gx <= Math.min(gw - 1, (t.x1 / cell) | 0); gx++) ink[gy * gw + gx] = 0;
  }
  // Close gaps of a couple of cells so a logo's letters join into one mark.
  const r = 3;
  const grown = new Uint8Array(gw * gh);
  for (let gy = 0; gy < gh; gy++)
    for (let gx = 0; gx < gw; gx++) {
      if (!ink[gy * gw + gx]) continue;
      for (let dy = -r; dy <= r; dy++)
        for (let dx = -r; dx <= r; dx++) {
          const [x, y] = [gx + dx, gy + dy];
          if (x >= 0 && y >= 0 && x < gw && y < gh) grown[y * gw + x] = 1;
        }
    }
  const seen = new Uint8Array(gw * gh);
  const boxes: Box[] = [];
  const stack: number[] = [];
  for (let s = 0; s < grown.length; s++) {
    if (!grown[s] || seen[s]) continue;
    let [x0, y0, x1, y1, inkCells] = [gw, gh, 0, 0, 0];
    stack.push(s);
    seen[s] = 1;
    while (stack.length) {
      const p = stack.pop()!;
      const [x, y] = [p % gw, (p / gw) | 0];
      if (ink[p]) inkCells++;
      x0 = Math.min(x0, x);
      y0 = Math.min(y0, y);
      x1 = Math.max(x1, x);
      y1 = Math.max(y1, y);
      for (const q of [p - 1, p + 1, p - gw, p + gw]) {
        if (q < 0 || q >= grown.length || seen[q] || !grown[q]) continue;
        if ((q === p - 1 && x === 0) || (q === p + 1 && x === gw - 1)) continue;
        seen[q] = 1;
        stack.push(q);
      }
    }
    if (inkCells < 6) continue;
    // Undo the growth so the box hugs the mark.
    boxes.push({ x0: (x0 + r) * cell, y0: (y0 + r) * cell, x1: (x1 - r + 1) * cell, y1: (y1 - r + 1) * cell });
  }
  const area = w * h;
  return boxes.filter((b) => {
    const [bw, bh] = [b.x1 - b.x0, b.y1 - b.y0];
    if (bw <= 0 || bh <= 0) return false;
    const share = (bw * bh) / area;
    const aspect = bw / bh;
    const touchesEdge = b.x0 <= 6 || b.y0 <= 6 || b.x1 >= w - 6 || b.y1 >= h - 6;
    return share > 0.004 && share < 0.35 && aspect > 0.2 && aspect < 9 && !touchesEdge;
  });
}

function cropMark(canvas: HTMLCanvasElement, b: Box, bg: RGB): LogoCandidate & { score: number } {
  const pad = Math.round(Math.max(b.x1 - b.x0, b.y1 - b.y0) * 0.08);
  const x = Math.max(0, b.x0 - pad);
  const y = Math.max(0, b.y0 - pad);
  const w = Math.min(canvas.width - x, b.x1 - b.x0 + pad * 2);
  const h = Math.min(canvas.height - y, b.y1 - b.y0 + pad * 2);
  const out = document.createElement("canvas");
  out.width = w;
  out.height = h;
  const g = out.getContext("2d")!;
  g.drawImage(canvas, x, y, w, h, 0, 0, w, h);
  // Key out a plain page background so the logo sits on any screen colour.
  const img = g.getImageData(0, 0, w, h);
  const d = img.data;
  for (let i = 0; i < d.length; i += 4) {
    const e = Math.abs(d[i]! - bg[0]) + Math.abs(d[i + 1]! - bg[1]) + Math.abs(d[i + 2]! - bg[2]);
    if (e < 24) d[i + 3] = 0;
    else if (e < 60) d[i + 3] = Math.round(((e - 24) / 36) * d[i + 3]!);
  }
  g.putImageData(img, 0, 0);
  const area = ((b.x1 - b.x0) * (b.y1 - b.y0)) / (canvas.width * canvas.height);
  return { dataUrl: out.toDataURL("image/png"), width: w, height: h, page: 0, score: Math.min(area, 0.08) };
}

// ─── pdf.js (typed just as far as we use it) ──────────────────────────────────

interface PdfTextItem {
  str: string;
  transform: number[];
  width: number;
  fontName: string;
  hasEOL?: boolean;
}
interface PdfViewport {
  width: number;
  height: number;
  convertToViewportRectangle(rect: number[]): number[];
}
interface PdfPage {
  getViewport(o: { scale: number }): PdfViewport;
  getTextContent(): Promise<{ items: (PdfTextItem | { type: string })[] }>;
  getOperatorList(): Promise<unknown>;
  render(o: { canvasContext: CanvasRenderingContext2D; viewport: PdfViewport }): { promise: Promise<void> };
  commonObjs: { get(id: string): { name?: string } | undefined };
  cleanup(): void;
}
interface PdfDoc {
  numPages: number;
  getPage(n: number): Promise<PdfPage>;
  getMetadata(): Promise<{ info?: { Title?: string } }>;
  destroy(): Promise<void>;
}

async function openPdf(file: File): Promise<PdfDoc> {
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
  pdfjs.GlobalWorkerOptions.workerSrc = "/display/pdfjs/pdf.worker.min.mjs";
  const data = new Uint8Array(await file.arrayBuffer());
  return (await pdfjs.getDocument({ data, standardFontDataUrl: "/display/pdfjs/standard_fonts/", isEvalSupported: false }).promise) as unknown as PdfDoc;
}

async function renderPage(page: PdfPage, width: number): Promise<{ canvas: HTMLCanvasElement; viewport: PdfViewport }> {
  const base = page.getViewport({ scale: 1 });
  const viewport = page.getViewport({ scale: width / base.width });
  const canvas = document.createElement("canvas");
  canvas.width = Math.ceil(viewport.width);
  canvas.height = Math.ceil(viewport.height);
  const ctx = canvas.getContext("2d", { willReadFrequently: true })!;
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  await page.render({ canvasContext: ctx, viewport }).promise;
  return { canvas, viewport };
}

const pixels = (c: HTMLCanvasElement) => c.getContext("2d", { willReadFrequently: true })!.getImageData(0, 0, c.width, c.height);

function scaled(c: HTMLCanvasElement, width: number): HTMLCanvasElement {
  const out = document.createElement("canvas");
  out.width = width;
  out.height = Math.max(1, Math.round((c.height * width) / c.width));
  out.getContext("2d")!.drawImage(c, 0, 0, out.width, out.height);
  return out;
}

// ─── The analyser ─────────────────────────────────────────────────────────────

interface Run {
  str: string;
  size: number;
  family: string | null;
  page: number;
}

export async function analyseBrandBook(file: File, onProgress: Progress = () => {}): Promise<BrandBookResult> {
  const notes: string[] = [];
  const counter = new ColourCounter();
  const runs: Run[] = [];
  const declared: { rgb: RGB; label: string | null }[] = [];
  const logos: (LogoCandidate & { score: number })[] = [];
  let tagline: string | null = null;
  let allText = "";
  let title: string | null = null;
  let pages = 1;

  const isPdf = file.type === "application/pdf" || /\.pdf$/i.test(file.name);

  if (isPdf) {
    onProgress("Opening the brand book…");
    const doc = await openPdf(file);
    try {
      pages = doc.numPages;
      title = (await doc.getMetadata().catch(() => null))?.info?.Title ?? null;
      const n = Math.min(pages, MAX_PAGES);
      if (pages > MAX_PAGES) notes.push(`Read the first ${MAX_PAGES} of ${pages} pages.`);
      for (let i = 1; i <= n; i++) {
        onProgress(`Reading page ${i} of ${n}…`);
        const page = await doc.getPage(i);
        await page.getOperatorList(); // loads the page's fonts, so their real names resolve
        const tc = await page.getTextContent();
        const items = tc.items.filter((it): it is PdfTextItem => "str" in it);
        let text = "";
        const starts: number[] = [];
        for (const it of items) {
          starts.push(text.length);
          text += it.str + (it.hasEOL ? "\n" : " ");
          if (!it.str.trim()) continue;
          let family: string | null = null;
          try {
            const f = page.commonObjs.get(it.fontName);
            family = f?.name ? familyOf(f.name) : null;
          } catch {
            /* font not resolved — fine */
          }
          runs.push({ str: it.str.trim(), size: Math.hypot(it.transform[2]!, it.transform[3]!), family, page: i });
        }
        declared.push(...declaredColours(text, spatialLabeler(items, starts, text)));
        tagline ??= findTagline(text);
        allText += `${text}\n`;

        // Logo pages, but not the ones that draw the logo with construction
        // marks (clear space, grids, "the X factor") or show it misused.
        const construction = CONSTRUCTION.test(text);
        const wantsLogo = i === 1 || (/\blogo(type|mark)?s?\b/i.test(text) && !construction && logos.filter((l) => l.page > 1).length < 3);
        const { canvas, viewport } = await renderPage(page, wantsLogo ? LARGE_W : SMALL_W);
        counter.add(pixels(wantsLogo ? scaled(canvas, SMALL_W) : canvas));
        if (wantsLogo) {
          const img = pixels(canvas);
          const bg = borderColour(img);
          const boxes = items
            .filter((it) => it.str.trim())
            .map((it) => {
              const size = Math.hypot(it.transform[2]!, it.transform[3]!);
              const [x, y] = [it.transform[4]!, it.transform[5]!];
              const [a, b, c, d] = viewport.convertToViewportRectangle([x, y - size * 0.25, x + it.width, y + size]);
              return { x0: Math.min(a!, c!), y0: Math.min(b!, d!), x1: Math.max(a!, c!), y1: Math.max(b!, d!) };
            });
          for (const box of findMarks(img, boxes, bg).slice(0, 4)) {
            const cand = cropMark(canvas, box, bg);
            // A clean logo is one compact mark; guides and brackets around it spread the ink thin.
            logos.push({ ...cand, page: i, score: cand.score * (i === 1 ? 1.5 : 1) * (/\bcolou?r\b/i.test(text) ? 1.2 : 1) * (construction ? 0.2 : 1) });
          }
        }
        page.cleanup();
      }
    } finally {
      void doc.destroy();
    }
  } else {
    onProgress("Reading the image…");
    const bmp = await createImageBitmap(file);
    const canvas = document.createElement("canvas");
    const w = Math.min(LARGE_W, bmp.width);
    canvas.width = w;
    canvas.height = Math.round((bmp.height * w) / bmp.width);
    canvas.getContext("2d")!.drawImage(bmp, 0, 0, canvas.width, canvas.height);
    counter.add(pixels(scaled(canvas, SMALL_W)));
    const img = pixels(canvas);
    const bg = borderColour(img);
    for (const box of findMarks(img, [], bg).slice(0, 4)) logos.push({ ...cropMark(canvas, box, bg), page: 1 });
    notes.push("An image has no text, so the name, tagline and fonts couldn't be read — fill those in.");
  }

  onProgress("Putting it together…");

  // Colours: what the book writes down first, then what dominates its pages.
  const colours: BrandColour[] = [];
  const addColour = (rgb: RGB, label: string | null, source: BrandColour["source"]) => {
    const near = colours.find((c) => dist(fromHex(c.hex), rgb) < 20);
    if (near) {
      near.label ??= label;
      return;
    }
    colours.push({ hex: toHex(rgb), label, source });
  };
  for (const d of declared) addColour(d.rgb, d.label, "declared");
  const measured = counter.top(12);
  for (const m of measured) {
    const { s } = sl(m.rgb);
    if (colours.length >= 12) break;
    // Once the book has declared its colours, only add measured ones that are clearly colours.
    if (declared.length && s < 0.25) continue;
    addColour(m.rgb, null, "measured");
  }
  if (!declared.length && isPdf) notes.push("No colour codes were written in the book, so colours were measured from its pages.");

  // Fonts: biggest text is set in the heading face, most text in the body face.
  const byFamily = new Map<string, { chars: number; sizeChars: number; max: number }>();
  for (const r of runs) {
    if (!r.family) continue;
    const e = byFamily.get(r.family) ?? { chars: 0, sizeChars: 0, max: 0 };
    e.chars += r.str.length;
    e.sizeChars += r.str.length * r.size;
    e.max = Math.max(e.max, r.size);
    byFamily.set(r.family, e);
  }
  const fams = [...byFamily.entries()].filter(([, e]) => e.chars >= 8);
  const body = fams.sort((a, b) => b[1].chars - a[1].chars)[0]?.[0] ?? null;
  const heading = [...fams].sort((a, b) => b[1].sizeChars / b[1].chars - a[1].sizeChars / a[1].chars)[0]?.[0] ?? body;
  const fonts: BrandFont[] = fams
    .sort((a, b) => b[1].chars - a[1].chars)
    .slice(0, 5)
    .map(([family]) => {
      const m = closestFont(family);
      return { family, role: family === heading ? "heading" : family === body ? "body" : "other", mapped: m.value, mappedLabel: m.label };
    });
  if (isPdf && !fonts.length) notes.push("The fonts in this PDF aren't named (they may be outlined), so pick fonts yourself.");

  const { name, headlineTagline } = nameAndHeadline(runs, title, file.name, allText);
  tagline ??= headlineTagline;

  const topLogos = logos
    .sort((a, b) => b.score - a.score)
    .slice(0, 4)
    .map(({ score: _score, ...l }) => l);
  if (!topLogos.length) notes.push("No logo could be cut out cleanly — choose one from your media library.");

  return { name, tagline, colours, fonts, logos: topLogos, suggestion: suggest(colours, fonts), pages, notes };
}

const SECTION = /\b(logo|usage|colou?rs?|palette|typeface|typography|fonts?|spacing|clear\s?space|contents|gradient|guidelines?|imagery|icons?)\b/i;
const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/**
 * Name: the PDF title (minus "Brand Book 2026"), else short big words on the
 * cover, else the file name — then spelled the way the book's own text does.
 * Tagline fallback: a short headline the book repeats, or its biggest one.
 */
function nameAndHeadline(runs: Run[], title: string | null, fileName: string, allText: string): { name: string | null; headlineTagline: string | null } {
  // Headline blocks: consecutive runs in one size and face, joined ("Technology should make" + "life feel easier.").
  const sizes = runs.map((r) => r.size).sort((a, b) => a - b);
  const bodySize = sizes[Math.floor(sizes.length / 2)] ?? 12;
  const blocks: { text: string; size: number; page: number; family: string | null }[] = [];
  for (const r of runs) {
    const last = blocks[blocks.length - 1];
    if (last && last.page === r.page && last.family === r.family && Math.abs(last.size - r.size) < 0.5) last.text += ` ${r.str}`;
    else blocks.push({ text: r.str, size: r.size, page: r.page, family: r.family });
  }
  const headlines = blocks.filter((b) => b.size >= bodySize * 1.4).map((b) => ({ ...b, text: b.text.replace(/\s+/g, " ").trim() }));

  const short = (t: string) => t.split(" ").length <= 4 && !/[.!?,]$/.test(t);
  const raw =
    cleanName(title) ??
    headlines
      .filter((b) => b.page === 1 && short(b.text))
      .map((b) => cleanName(b.text))
      .find(Boolean) ??
    cleanName(fileName.replace(/\.[a-z0-9]+$/i, "").replace(/[-_.]+/g, " "));

  let name = raw;
  if (raw) {
    const spellings = new Map<string, number>();
    for (const m of allText.matchAll(new RegExp(`\\b${escapeRe(raw)}\\b`, "gi"))) spellings.set(m[0], (spellings.get(m[0]) ?? 0) + 1);
    // Title Case is how a name is written in a sentence; lower/ALL CAPS is styling.
    const titled = [...spellings.entries()].filter(([k]) => /^[A-Z][a-z]/.test(k)).sort((a, b) => b[1] - a[1])[0]?.[0];
    name = titled ?? raw;
  }

  const counts = new Map<string, number>();
  const candidates = headlines.filter((b) => {
    const words = b.text.split(" ").length;
    return words >= 3 && words <= 10 && !SECTION.test(b.text) && !(name && b.text.toLowerCase() === name.toLowerCase());
  });
  for (const b of candidates) counts.set(b.text.toLowerCase(), (counts.get(b.text.toLowerCase()) ?? 0) + 1);
  const best = [...candidates].sort((a, b) => counts.get(b.text.toLowerCase())! - counts.get(a.text.toLowerCase())! || b.size - a.size)[0];
  return { name, headlineTagline: best?.text ?? null };
}

/** A screen-friendly pick: a dark brand colour as the background where there is one, the boldest colour as accent. */
function suggest(colours: BrandColour[], fonts: BrandFont[]): BrandBookResult["suggestion"] {
  const all = colours.map((c) => ({ ...c, rgb: fromHex(c.hex), ...sl(fromHex(c.hex)) }));
  const roleIs = (c: (typeof all)[number], re: RegExp) => !!c.label && re.test(c.label);

  const dark = all.filter((c) => luminance(c.rgb) < 0.05).sort((a, b) => luminance(a.rgb) - luminance(b.rgb));
  const light = all.filter((c) => luminance(c.rgb) > 0.8);
  const bg = dark.find((c) => c.s > 0.15) ?? dark[0] ?? light[0];
  const background = bg?.hex ?? "#0b0d12";
  const bgRgb = fromHex(background);

  const vivid = all
    .filter((c) => c.hex !== background && c.s > 0.3 && c.l > 0.2 && c.l < 0.85)
    .sort((a, b) => Number(roleIs(b, /primary|accent|highlight/i)) - Number(roleIs(a, /primary|accent|highlight/i)) || b.s - a.s);
  let accent = vivid.find((c) => contrast(c.rgb, bgRgb) >= 3) ?? vivid[0] ?? all.find((c) => c.hex !== background && contrast(c.rgb, bgRgb) >= 3);
  if (!accent) accent = { hex: luminance(bgRgb) < 0.4 ? "#ffffff" : "#111111" } as (typeof all)[number];

  const heading = fonts.find((f) => f.role === "heading")?.mapped ?? fonts[0]?.mapped ?? null;
  const body = fonts.find((f) => f.role === "body")?.mapped ?? heading;
  return { background, accent: accent.hex, headingFont: heading, bodyFont: body };
}
