import type { CmsEndpoint } from "./registry.js";
import type { CommandMatch, SlotValue } from "./matcher.js";
import type { VoiceControlConfig } from "../config/config.js";
import { timeOfDayGreeting } from "../utils/time.js";

/**
 * Turns a matched command into what to do next, with no I/O:
 *  - "request": a CMS call
 *  - "ask":     a required name is missing — speak the question, do nothing
 *               (slot says which one, so a follow-up answer can fill it)
 *  - "reply":   the registry answers directly (e.g. unsupported hardware)
 */

export interface CmsRequest {
  endpoint: CmsEndpoint;
  body: Record<string, unknown>;
}

export type Resolution =
  | { kind: "request"; request: CmsRequest }
  | { kind: "ask"; question: string; slot: string }
  | { kind: "reply"; text: string; shutdown?: boolean };

/** "{slot}", or "{a|b}" = the first of a, b that has a value. */
const SLOT_REF = /^\{(\w+(?:\|\w+)*)\}$/;

function refNames(value: string): string[] | null {
  const ref = SLOT_REF.exec(value);
  return ref ? ref[1]!.split("|") : null;
}

/**
 * Replace "{slot}" values with typed slot values. Missing slots drop the key;
 * an object left empty is dropped too (e.g. params: { times } with no steps).
 */
function fill(value: unknown, slots: Record<string, SlotValue>): unknown {
  if (typeof value === "string") {
    const names = refNames(value);
    return names ? names.map((n) => slots[n]).find((v) => v !== undefined) : value;
  }
  if (value && typeof value === "object" && !Array.isArray(value)) {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) {
      const filled = fill(v, slots);
      if (filled !== undefined) out[k] = filled;
    }
    return Object.keys(out).length > 0 ? out : undefined;
  }
  return value;
}

/** Every slot reference in a body template, as its list of alternative names. */
function referencedSlots(value: unknown, out: string[][] = []): string[][] {
  if (typeof value === "string") {
    const names = refNames(value);
    if (names) out.push(names);
  } else if (value && typeof value === "object") {
    for (const v of Object.values(value)) referencedSlots(v, out);
  }
  return out;
}

export function resolveCommand(
  match: CommandMatch,
  defaults: VoiceControlConfig["defaults"],
  now: Date = new Date()
): Resolution {
  const { command } = match;
  // {timeGreeting} = greeting for the current IST time, whatever was said.
  if (command.reply) {
    const text = command.reply.replace(/\{timeGreeting\}/g, timeOfDayGreeting(now));
    return command.system === "shutdown" ? { kind: "reply", text, shutdown: true } : { kind: "reply", text };
  }
  const cms = command.cms!;

  const slots: Record<string, SlotValue> = { ...match.params };
  // fallbacks / ask are keyed by a reference's first name.
  for (const names of referencedSlots(cms.body)) {
    if (names.some((n) => slots[n] !== undefined)) continue;
    const name = names[0]!;
    const defaultKey = cms.fallbacks?.[name] as keyof VoiceControlConfig["defaults"] | undefined;
    const configured = defaultKey ? defaults[defaultKey] : null;
    if (configured) slots[name] = configured;
    else if (cms.ask?.[name]) return { kind: "ask", question: cms.ask[name]!, slot: name };
  }

  // An all-optional body (e.g. { action } with no target) fills to at least {}.
  const body = (fill(cms.body, slots) as Record<string, unknown> | undefined) ?? {};
  return { kind: "request", request: { endpoint: cms.endpoint, body } };
}
