/**
 * Extracts a representative cover image URL from an experience's
 * templateContent JSON, so list views can show a thumbnail without a
 * dedicated coverImage column.
 *
 * Strategy: breadth-first walk (shallow matches win) that prefers values
 * stored under image-ish keys (imageUrl, cover, thumbnail, hero, …), then
 * falls back to any string that looks like an image file URL/path.
 */

const IMAGE_KEY = /image|cover|thumb|poster|photo|hero/i;
const IMAGE_EXT = /\.(png|jpe?g|webp|gif|avif|svg)(\?.*)?$/i;

const looksLikeUrl = (v: string) =>
  v.startsWith("http://") || v.startsWith("https://") || v.startsWith("/") || v.startsWith("data:image/");

export function extractCoverImage(content: unknown): string | null {
  if (!content || typeof content !== "object") return null;

  let fallback: string | null = null;
  const queue: unknown[] = [content];
  let steps = 0;

  while (queue.length > 0 && steps < 2000) {
    const node = queue.shift();
    steps++;
    if (!node || typeof node !== "object") continue;

    const entries = Array.isArray(node)
      ? node.map((v, i) => [String(i), v] as const)
      : Object.entries(node as Record<string, unknown>);

    for (const [key, value] of entries) {
      if (typeof value === "string") {
        const v = value.trim();
        if (!v || !looksLikeUrl(v)) continue;
        // Keyed image field — best signal, return immediately.
        if (IMAGE_KEY.test(key) && !/video/i.test(key)) return v;
        // Any image-looking URL — remember the first as a fallback.
        if (!fallback && IMAGE_EXT.test(v)) fallback = v;
      } else if (value && typeof value === "object") {
        queue.push(value);
      }
    }
  }

  return fallback;
}

/**
 * A picture for templates whose content holds no image of its own (the 3D
 * ones): their artwork, from public/template-covers.
 */
const TEMPLATE_COVERS: Record<string, string> = {
  "drava-mosaic": "/template-covers/drava-mosaic.webp",
  "drava-world": "/template-covers/drava-world.webp",
};

/** The experience's cover: an image from its content, else its template's. */
export function experienceCover(content: unknown, templateKey: string | null | undefined): string | null {
  return extractCoverImage(content) ?? (templateKey ? TEMPLATE_COVERS[templateKey] ?? null : null);
}
