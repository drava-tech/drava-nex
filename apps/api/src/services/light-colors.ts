/**
 * Spoken colour names -> the hex the lights are actually driven with.
 *
 * The lights only understand hex (casambi-driver.ts drops anything else without
 * a word), so "make the lights blue" needs a name -> hex step or it sets no
 * colour at all. The first group matches the CMS's own colour swatches
 * (LIGHT_PRESETS in apps/cms/src/lib/casambi-lights.ts), so a colour by voice
 * is exactly the colour the same swatch gives.
 *
 * Only colours these fixtures can really show are listed: they render any
 * chromatic colour fully saturated, so pastels (pink, lavender, beige) would
 * come out as something else entirely. Those are refused rather than faked.
 */
export const LIGHT_COLOR_NAMES: Record<string, string> = {
  // = the CMS swatches
  warmwhite: "#FFF3E0",
  neutralwhite: "#FFFFFF",
  red: "#FF0000",
  green: "#00FF00",
  cyan: "#00FFFF",
  blue: "#0000FF",
  magenta: "#FF00FF",
  // Extra standard colours
  white: "#FFFFFF",
  yellow: "#FFFF00",
  orange: "#FFA500",
  purple: "#800080",
};

/** Display names, for "I can do: ..." replies. */
export const LIGHT_COLOR_CHOICES = [
  "warm white",
  "neutral white",
  "red",
  "green",
  "blue",
  "cyan",
  "magenta",
  "yellow",
  "orange",
  "purple",
];

/**
 * A colour as said or given -> "#RRGGBB", or null if it isn't one we know.
 * Accepts a name ("Blue", "warm white", "blue light"), "#RRGGBB", "RRGGBB" or "#RGB".
 */
export function resolveLightColor(input: string): string | null {
  const raw = input.trim();
  const hex = /^#?([0-9a-f]{6})$/i.exec(raw) ?? /^#([0-9a-f]{3})$/i.exec(raw);
  if (hex) {
    const digits = hex[1]!.length === 3 ? [...hex[1]!].map((c) => c + c).join("") : hex[1]!;
    return `#${digits.toUpperCase()}`;
  }
  const key = raw
    .toLowerCase()
    .replace(/[^a-z]/g, "")
    .replace(/(colou?r|lights?|lighting)$/, "");
  return LIGHT_COLOR_NAMES[key] ?? null;
}
