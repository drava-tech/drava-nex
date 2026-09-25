/**
 * Text helpers shared by the command matcher and parameter extractors.
 * Vosk emits lowercase words with numbers spelled out ("twenty two"), so
 * normalization converts number words to digits before matching.
 */

const FILLERS = new Set(["the", "a", "an", "please", "my", "to", "can", "could", "would", "you", "will", "kindly", "hey", "okay", "ok", "uh", "um"]);

/** Multi-word spoken forms rewritten before matching, e.g. Vosk's "a c" -> "ac". */
export type Rewrites = Array<[RegExp, string]>;

export function compileRewrites(map: Record<string, string>): Rewrites {
  return Object.entries(map).map(([from, to]) => {
    const words = basicNormalize(from).split(" ");
    return [new RegExp(String.raw`\b${words.join(String.raw`\s+`)}\b`, "g"), to];
  });
}

const UNITS: Record<string, number> = {
  zero: 0, oh: 0, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9,
  ten: 10, eleven: 11, twelve: 12, thirteen: 13, fourteen: 14, fifteen: 15, sixteen: 16,
  seventeen: 17, eighteen: 18, nineteen: 19,
};
const TENS: Record<string, number> = {
  twenty: 20, thirty: 30, forty: 40, fifty: 50, sixty: 60, seventy: 70, eighty: 80, ninety: 90,
};

/** Lowercase, strip punctuation, collapse whitespace, "%" -> "percent". */
export function basicNormalize(text: string): string {
  return text
    .toLowerCase()
    .replace(/%/g, " percent ")
    .replace(/°c?/g, " degrees ")
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * A normalized token. `source` is the spoken (numbers-as-digits) word before
 * any fuzzy correction, so a name slot always carries what was actually said
 * — "screen 2", which the CMS matches against a real name like "screen-2".
 */
export interface Token {
  word: string;
  source: string;
}

/**
 * Tokenize with spelled-out numbers (0-100) replaced by digits:
 * "twenty two" -> "22", "one hundred" / "a hundred" -> "100".
 */
export function tokenizeNumbers(text: string, rewrites: Rewrites = []): Token[] {
  let normalized = basicNormalize(text);
  for (const [pattern, to] of rewrites) normalized = normalized.replace(pattern, to);
  const words = normalized.split(" ").filter(Boolean);
  const out: Token[] = [];
  for (let i = 0; i < words.length; i++) {
    const w = words[i]!;
    const prev = out[out.length - 1];
    if (w === "hundred" && prev && (prev.word === "1" || prev.word === "a")) {
      out[out.length - 1] = { word: "100", source: "100" };
      continue;
    }
    if (TENS[w] !== undefined) {
      const next = words[i + 1];
      const unit = next !== undefined ? UNITS[next] : undefined;
      if (unit !== undefined && unit > 0 && unit < 10) {
        out.push({ word: String(TENS[w]! + unit), source: String(TENS[w]! + unit) });
        i++;
      } else {
        out.push({ word: String(TENS[w]), source: String(TENS[w]) });
      }
      continue;
    }
    if (UNITS[w] !== undefined && w !== "oh") {
      out.push({ word: String(UNITS[w]), source: String(UNITS[w]) });
      continue;
    }
    out.push({ word: w, source: w });
  }
  return out;
}

/** Tokens used for matching: numbers converted, filler words dropped. */
export function normalizeTokens(text: string, rewrites: Rewrites = []): Token[] {
  return tokenizeNumbers(text, rewrites).filter((t) => !FILLERS.has(t.word));
}

/** Full normalization used for matching, as a string. */
export function normalize(text: string, rewrites: Rewrites = []): string {
  return normalizeTokens(text, rewrites)
    .map((t) => t.word)
    .join(" ");
}

/** Levenshtein distance (iterative, two rows). */
export function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  let cur = new Array<number>(b.length + 1);
  for (let i = 1; i <= a.length; i++) {
    cur[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      cur[j] = Math.min(prev[j]! + 1, cur[j - 1]! + 1, prev[j - 1]! + cost);
    }
    [prev, cur] = [cur, prev];
  }
  return prev[b.length]!;
}

/** 1.0 = identical, 0.0 = nothing in common (normalized edit distance). */
export function similarity(a: string, b: string): number {
  const max = Math.max(a.length, b.length);
  return max === 0 ? 1 : 1 - levenshtein(a, b) / max;
}
