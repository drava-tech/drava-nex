// Metric-compatible open substitutes for the Microsoft fonts decks are built
// with (the same ones ChromeOS and LibreOffice use). Kiosk machines rarely have
// Calibri & co., and without a metric-compatible stand-in every text box
// reflows and overflows its shape. Ported from cms-platform's SlidesViewer.
import "@fontsource/arimo"
import "@fontsource/caladea"
import "@fontsource/carlito"
import "@fontsource/cousine"
import "@fontsource/gelasio"
import "@fontsource/tinos"

/** Office typeface (lowercased) → bundled substitute stack. */
const FONT_SUBSTITUTES: Record<string, string> = {
  calibri: "Carlito, sans-serif",
  "calibri light": "Carlito, sans-serif",
  cambria: "Caladea, serif",
  arial: "Arimo, Arial, sans-serif",
  "times new roman": "Tinos, 'Times New Roman', serif",
  "courier new": "Cousine, 'Courier New', monospace",
  georgia: "Gelasio, Georgia, serif",
}

/**
 * pptx-preview writes font-family as inline styles on the elements it
 * generates, so substitution means walking the rendered DOM after each render.
 */
export function patchFonts(host: HTMLElement) {
  const walker = document.createTreeWalker(host, NodeFilter.SHOW_ELEMENT)
  for (let node = walker.nextNode() as HTMLElement | null; node; node = walker.nextNode() as HTMLElement | null) {
    const family = node.style?.fontFamily
    if (!family) continue
    const first = family.split(",")[0]!.trim().replace(/^["']|["']$/g, "").toLowerCase()
    const substitute = FONT_SUBSTITUTES[first]
    if (substitute) node.style.fontFamily = substitute
  }
}
