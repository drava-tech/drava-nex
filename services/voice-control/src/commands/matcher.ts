import type { CommandDef, CompiledPattern, PatternElement, Registry } from "./registry.js";
import { normalizeTokens, similarity, type Token } from "../utils/text.js";

/**
 * Rule-based command matching: exact pattern match first, then (optionally)
 * fuzzy. Nothing here guesses — a result below minMatchConfidence, or a fuzzy
 * result that is nearly tied with a different intent, is returned as
 * rejected and must not be executed.
 */

export type SlotValue = number | string;

/** Confidence multiplier when one stray unknown word had to be dropped. */
const STRAY_WORD_PENALTY = 0.85;

export interface MatchOptions {
  fuzzy: boolean;
  /** Per-word / whole-phrase similarity needed for a fuzzy correction (0-1). */
  fuzzyThreshold: number;
  /** Overall confidence needed to accept a match (0-1). */
  minMatchConfidence: number;
}

export interface CommandMatch {
  ok: true;
  intent: string;
  command: CommandDef;
  params: Record<string, SlotValue>;
  confidence: number;
  method: "exact" | "fuzzy";
  phrase: string;
  normalized: string;
}

export interface NoMatch {
  ok: false;
  reason: "empty" | "no_match" | "low_confidence" | "ambiguous";
  normalized: string;
  best?: { intent: string; confidence: number };
}

export type MatchResult = CommandMatch | NoMatch;

/** Match pattern elements against tokens; returns slot values or null. */
function matchElements(
  elements: PatternElement[],
  tokens: Token[],
  registry: Registry,
  ei = 0,
  ti = 0,
  params: Record<string, SlotValue> = {}
): Record<string, SlotValue> | null {
  if (ei === elements.length) return ti === tokens.length ? params : null;
  const el = elements[ei]!;
  if (el.kind === "word") {
    return tokens[ti]?.word === el.word ? matchElements(elements, tokens, registry, ei + 1, ti + 1, params) : null;
  }

  const def = el.def;
  if (def.type === "number") {
    const tok = tokens[ti];
    if (!tok || !/^\d+$/.test(tok.word)) return null;
    const n = Number(tok.word);
    if (n < def.min || n > def.max) return null;
    return matchElements(elements, tokens, registry, ei + 1, ti + 1, { ...params, [el.name]: n });
  }

  if (def.type === "enum") {
    for (const [aliasTokens, value] of registry.enumAliases.get(el.name) ?? []) {
      const fits = aliasTokens.every((w, k) => tokens[ti + k]?.word === w);
      if (!fits) continue;
      const r = matchElements(elements, tokens, registry, ei + 1, ti + aliasTokens.length, { ...params, [el.name]: value });
      if (r) return r;
    }
    return null;
  }

  // Free text (a device/screen/content name): shortest span first, so the
  // literal words after it ("on", "screen") anchor where it ends. The value
  // is the words as spoken, so the CMS resolves the name, not us.
  for (let end = ti + 1; end <= tokens.length; end++) {
    const span = tokens.slice(ti, end).map((t) => t.source);
    if (def.anchor && !def.anchor.includes(span[0]!) && !def.anchor.includes(span[span.length - 1]!)) continue;
    const value = aliasFor(span, def.aliasesFrom, registry) ?? span.join(" ");
    const r = matchElements(elements, tokens, registry, ei + 1, end, { ...params, [el.name]: value });
    if (r) return r;
  }
  return null;
}

/** Words around a spoken name that aren't part of it ("tusker edge lights", "tusker 27 screen"). */
const NAME_NOISE = new Set(["light", "lights", "screen", "display"]);

/** The real CMS name when the whole spoken name is an alias from enum slot `from`. */
function aliasFor(span: string[], from: string | undefined, registry: Registry): string | null {
  if (!from) return null;
  const words = span.filter((w, i) => !(NAME_NOISE.has(w) && (i === 0 || i === span.length - 1)));
  for (const [aliasTokens, value] of registry.enumAliases.get(from) ?? []) {
    if (aliasTokens.length === words.length && aliasTokens.every((w, k) => words[k] === w)) return value;
  }
  return null;
}

function firstExact(patterns: CompiledPattern[], tokens: Token[], registry: Registry) {
  for (const pattern of patterns) {
    const params = matchElements(pattern.elements, tokens, registry);
    if (params) return { pattern, params };
  }
  return null;
}

function isNumber(word: string): boolean {
  return /^\d+$/.test(word);
}

export function matchCommand(text: string, registry: Registry, options: MatchOptions): MatchResult {
  const tokens = normalizeTokens(text, registry.rewrites);
  const normalized = tokens.map((t) => t.word).join(" ");
  if (tokens.length === 0) return { ok: false, reason: "empty", normalized };

  const exact = firstExact(registry.patterns, tokens, registry);
  if (exact) {
    return {
      ok: true,
      intent: exact.pattern.command.intent,
      command: exact.pattern.command,
      params: exact.params,
      confidence: 1,
      method: "exact",
      phrase: exact.pattern.phrase,
      normalized,
    };
  }
  if (!options.fuzzy) return { ok: false, reason: "no_match", normalized };

  const fuzzyPatterns = registry.patterns.filter((p) => p.command.fuzzy !== false);
  const candidates: Array<{ pattern: CompiledPattern; params: Record<string, SlotValue>; confidence: number }> = [];

  // (a) Word-level correction: snap each unknown word to the closest registry
  // word ("brightnes" -> "brightness"), then require an exact pattern match.
  // A corrected word keeps its spoken source, so a name slot is unaffected.
  let corrected = false;
  let wordConfidence = 1;
  const correctedTokens = tokens.map((t) => {
    if (registry.vocabulary.has(t.word) || isNumber(t.word)) return t;
    let best = { word: t.word, score: 0 };
    for (const v of registry.vocabulary) {
      const s = similarity(t.word, v);
      if (s > best.score) best = { word: v, score: s };
    }
    if (best.score < options.fuzzyThreshold) return t;
    corrected = true;
    wordConfidence = Math.min(wordConfidence, best.score);
    return { word: best.word, source: t.source };
  });
  if (corrected) {
    const hit = firstExact(fuzzyPatterns, correctedTokens, registry);
    if (hit) candidates.push({ ...hit, confidence: wordConfidence });
  }

  // (b) One stray word at the start or end that the registry doesn't know
  // (Vosk often mishears the first word after a pause: "that ac 22 degrees").
  // Only words outside the vocabulary are dropped, never a command word.
  const base = corrected ? correctedTokens : tokens;
  const trims: Token[][] = [];
  if (base.length > 1 && !registry.vocabulary.has(base[0]!.word) && !isNumber(base[0]!.word)) trims.push(base.slice(1));
  const last = base[base.length - 1]!;
  if (base.length > 1 && !registry.vocabulary.has(last.word) && !isNumber(last.word)) trims.push(base.slice(0, -1));
  for (const trimmed of trims) {
    const hit = firstExact(fuzzyPatterns, trimmed, registry);
    if (hit) candidates.push({ ...hit, confidence: wordConfidence * STRAY_WORD_PENALTY });
  }

  // (c) Whole-phrase similarity against slot-free patterns ("lights of" ~
  // "lights off"). Slot patterns are excluded: a parameter must be heard,
  // never inferred from a near miss.
  for (const pattern of fuzzyPatterns) {
    if (pattern.slotCount > 0) continue;
    const phrase = pattern.elements.map((e) => (e.kind === "word" ? e.word : "")).join(" ");
    const score = similarity(normalized, phrase);
    if (score >= options.fuzzyThreshold) candidates.push({ pattern, params: {}, confidence: score });
  }

  if (candidates.length === 0) return { ok: false, reason: "no_match", normalized };
  candidates.sort((a, b) => b.confidence - a.confidence);
  const best = candidates[0]!;
  const bestInfo = { intent: best.pattern.command.intent, confidence: best.confidence };

  // A near tie between two different intents is a coin flip — refuse it.
  const rival = candidates.find((c) => c.pattern.command.intent !== best.pattern.command.intent);
  if (rival && best.confidence - rival.confidence < 0.05) {
    return { ok: false, reason: "ambiguous", normalized, best: bestInfo };
  }
  if (best.confidence < options.minMatchConfidence) {
    return { ok: false, reason: "low_confidence", normalized, best: bestInfo };
  }
  return {
    ok: true,
    intent: best.pattern.command.intent,
    command: best.pattern.command,
    params: best.params,
    confidence: best.confidence,
    method: "fuzzy",
    phrase: best.pattern.phrase,
    normalized,
  };
}
