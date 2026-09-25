import { readFileSync } from "node:fs";
import { compileRewrites, normalize, tokenizeNumbers, type Rewrites } from "../utils/text.js";

/**
 * Loads config/commands.json and compiles every phrase into flat patterns
 * (alternatives and optional words expanded), so the matcher only ever walks
 * a sequence of literal words and slots.
 */

export type SlotDef =
  | { type: "number"; min: number; max: number }
  | { type: "enum"; values: Record<string, string[]> }
  /** anchor: the captured name must start or end with one of these words ("screen 2", "lobby screen"). */
  | { type: "text"; anchor?: string[]; aliasesFrom?: string };

/** Routes under apps/api's /api/voice-control (routes/voice-control.ts). */
export type CmsEndpoint = "lights" | "ac" | "volume" | "door" | "screen" | "content";

export interface CmsMapping {
  endpoint: CmsEndpoint;
  body: Record<string, unknown>;
  /** slot -> key under config.defaults, used when the slot wasn't spoken. */
  fallbacks?: Record<string, string>;
  /** slot -> question spoken instead of executing when the slot is still missing. */
  ask?: Record<string, string>;
}

export interface CommandDef {
  intent: string;
  phrases: string[];
  /** false = exact matches only (safety-sensitive commands such as the door). */
  fuzzy?: boolean;
  cms?: CmsMapping;
  /** Spoken instead of calling the CMS (for commands the hardware can't do). */
  reply?: string;
  /** "shutdown": stop Travis after speaking the reply. */
  system?: "shutdown";
}

export type PatternElement = { kind: "word"; word: string } | { kind: "slot"; name: string; def: SlotDef };

export interface CompiledPattern {
  command: CommandDef;
  phrase: string;
  elements: PatternElement[];
  slotCount: number;
}

export interface Registry {
  slots: Record<string, SlotDef>;
  commands: CommandDef[];
  patterns: CompiledPattern[];
  /** Every literal word the registry can match — the fuzzy corrector's dictionary. */
  vocabulary: Set<string>;
  /** Normalized enum aliases per slot, longest first: [aliasTokens, canonicalValue]. */
  enumAliases: Map<string, Array<[string[], string]>>;
  /** Spoken-form rewrites applied to recognized text before matching. */
  rewrites: Rewrites;
}

interface RegistryFile {
  rewrites?: Record<string, string>;
  slots: Record<string, SlotDef>;
  commands: CommandDef[];
}

/** Expand "(a|b) c [d|e] {slot}" into every concrete token sequence. */
export function expandPhrase(phrase: string): string[][] {
  // Lowercase words but not {slotNames}, which are case-sensitive keys.
  const source = phrase
    .replace(/\{\w+\}|[^{}]+/g, (part) => (part.startsWith("{") ? part : part.toLowerCase()))
    .replace(/\s+/g, " ")
    .trim();
  let pos = 0;

  function parseSequence(stopChars: string): string[][] {
    let seqs: string[][] = [[]];
    while (pos < source.length && !stopChars.includes(source[pos]!)) {
      const ch = source[pos]!;
      if (ch === " ") {
        pos++;
        continue;
      }
      let options: string[][];
      if (ch === "(" || ch === "[") {
        const close = ch === "(" ? ")" : "]";
        pos++;
        options = [];
        for (;;) {
          options.push(...parseSequence(`|${close}`));
          if (source[pos] === "|") {
            pos++;
            continue;
          }
          if (source[pos] !== close) throw new Error(`Unclosed "${ch}" in phrase: ${phrase}`);
          pos++;
          break;
        }
        if (ch === "[") options.push([]);
      } else {
        let end = pos;
        while (end < source.length && !" ()[]|".includes(source[end]!)) end++;
        options = [[source.slice(pos, end)]];
        pos = end;
      }
      const next: string[][] = [];
      for (const s of seqs) for (const o of options) next.push([...s, ...o]);
      seqs = next;
    }
    return seqs;
  }

  const out = parseSequence("");
  if (pos !== source.length) throw new Error(`Unexpected "${source[pos]}" in phrase: ${phrase}`);
  return out;
}

function compileTokens(tokens: string[], slots: Record<string, SlotDef>, phrase: string): PatternElement[] {
  const elements: PatternElement[] = [];
  for (const tok of tokens) {
    const slot = /^\{(\w+)\}$/.exec(tok);
    if (slot) {
      const def = slots[slot[1]!];
      if (!def) throw new Error(`Unknown slot {${slot[1]}} in phrase: ${phrase}`);
      elements.push({ kind: "slot", name: slot[1]!, def });
      continue;
    }
    // Literal words go through the same normalization as spoken text, so
    // fillers vanish and number words become digits on both sides.
    for (const word of normalize(tok).split(" ").filter(Boolean)) elements.push({ kind: "word", word });
  }
  return elements;
}

export function buildRegistry(file: RegistryFile): Registry {
  const patterns: CompiledPattern[] = [];
  const vocabulary = new Set<string>();
  const seen = new Set<string>();

  for (const command of file.commands) {
    if (!command.intent || !Array.isArray(command.phrases) || command.phrases.length === 0) {
      throw new Error(`Command entry needs an intent and at least one phrase: ${JSON.stringify(command)}`);
    }
    if (!command.cms && !command.reply) throw new Error(`Command ${command.intent} needs "cms" or "reply".`);
    for (const phrase of command.phrases) {
      for (const tokens of expandPhrase(phrase)) {
        const elements = compileTokens(tokens, file.slots, phrase);
        if (elements.length === 0) continue;
        // The same normalized pattern under an earlier entry would always win,
        // so a duplicate is dead — skip it rather than let it mislead.
        const key = elements.map((e) => (e.kind === "word" ? e.word : `{${e.name}}`)).join(" ");
        if (seen.has(key)) continue;
        seen.add(key);
        for (const e of elements) if (e.kind === "word") vocabulary.add(e.word);
        patterns.push({ command, phrase, elements, slotCount: elements.filter((e) => e.kind === "slot").length });
      }
    }
  }

  const enumAliases = new Map<string, Array<[string[], string]>>();
  for (const [name, def] of Object.entries(file.slots)) {
    if (def.type !== "enum") continue;
    const list: Array<[string[], string]> = [];
    for (const [value, aliases] of Object.entries(def.values)) {
      for (const alias of aliases) {
        const tokens = tokenizeNumbers(alias).map((t) => t.word);
        tokens.forEach((t) => vocabulary.add(t));
        list.push([tokens, value]);
      }
    }
    list.sort((a, b) => b[0].length - a[0].length);
    enumAliases.set(name, list);
  }

  return { slots: file.slots, commands: file.commands, patterns, vocabulary, enumAliases, rewrites: compileRewrites(file.rewrites ?? {}) };
}

export function loadRegistry(path: string): Registry {
  return buildRegistry(JSON.parse(readFileSync(path, "utf8")) as RegistryFile);
}
