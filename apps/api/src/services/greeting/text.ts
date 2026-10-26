/**
 * Pure greeting text + calendar helpers. Nothing here reads the clock, the
 * environment or the DB: callers pass `now`, the timezone and the thresholds,
 * so every rule is unit-testable (see test/greeting-text.test.ts).
 */

interface TimeRules {
  timezone: string;
  afternoonHour: number;
  eveningHour: number;
}

export interface NameRules {
  maxNames: number;
}

/**
 * The ONE place a calendar day is derived. Used both for visitor_greeting's
 * greet_date and for the "first_seen is before today" comparison, so the two can
 * never disagree about where a day starts. Returns 'YYYY-MM-DD' in `timezone`.
 */
export function dayKey(at: Date, timezone: string): string {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(at);
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? "";
  return `${get("year")}-${get("month")}-${get("day")}`;
}

/** Hour of day 0-23 in `timezone`. */
export function hourInTimezone(at: Date, timezone: string): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    hour: "2-digit",
    hourCycle: "h23",
  }).formatToParts(at);
  // h23 can still render midnight as "24" on some engines; normalise.
  return Number(parts.find((p) => p.type === "hour")?.value ?? "0") % 24;
}

export function partOfDay(at: Date, rules: TimeRules): string {
  const hour = hourInTimezone(at, rules.timezone);
  if (hour < rules.afternoonHour) return "Good morning";
  if (hour < rules.eveningHour) return "Good afternoon";
  return "Good evening";
}

// ─── Names that are safe to say out loud ─────────────────────────────────────

/** full = the name as entered; first = first word only; none = never say a name. */
export type NameMode = "full" | "first" | "none";

/** Longest name we will speak, in characters (code points). */
export const MAX_SPOKEN_NAME_CHARS = 40;

const PLACEHOLDER = /^(unknown|test|tester|guest|visitor|unnamed|anonymous|n\/a|na|none|null|undefined|-+)$/i;
// The vision preview labels an unnamed face "Unknown-<uuid8>" (and a numbered "Unknown 2"); never say
// those. A separator is required, so a real name that merely starts with "Unknown" is untouched.
const UNKNOWN_LABEL = /^unknown[\s_-]+(?:[0-9]{1,4}|[0-9a-f]{8})$/i;

function isPlaceholder(name: string): boolean {
  const n = name.replace(/[.!?,;:]+$/g, "").trim();
  return PLACEHOLDER.test(n) || UNKNOWN_LABEL.test(n);
}

/**
 * The entered name with control/format characters stripped and whitespace
 * collapsed — or "" when there is nothing real to say (empty, or a placeholder
 * such as "unknown" / "test"). A "" here means: treat the visitor as unknown.
 */
export function cleanName(raw: string): string {
  const cleaned = raw
    .replace(/[\p{Cc}\p{Cf}\p{Cs}\p{Co}\p{Cn}]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
  return cleaned && !isPlaceholder(cleaned) ? cleaned : "";
}

/**
 * What to actually say for an (already cleaned) name under GREET_NAME_MODE,
 * capped at MAX_SPOKEN_NAME_CHARS. "" means "say no name" (mode none, or the
 * first word is itself a placeholder).
 */
export function spokenName(cleaned: string, mode: NameMode): string {
  if (!cleaned || mode === "none") return "";
  const base = mode === "first" ? (cleaned.split(" ")[0] ?? "") : cleaned;
  if (!base || isPlaceholder(base)) return "";
  const chars = [...base];
  return chars.length > MAX_SPOKEN_NAME_CHARS ? chars.slice(0, MAX_SPOKEN_NAME_CHARS).join("").trim() : base;
}

/** 1 → "Priya"; 2 → "Priya and Arjun"; 3+ → "Priya, Arjun and Meera". */
export function joinNames(names: string[]): string {
  if (names.length <= 1) return names[0] ?? "";
  return `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
}

/** What the greeting calls the group: the names themselves, or "everyone". */
export function addressee(names: string[], rules: NameRules): string {
  return names.length > rules.maxNames ? "everyone" : joinNames(names);
}

export interface GreetedPerson {
  name: string;
  /** first_seen falls on a day before today (in the greeting timezone). */
  returning: boolean;
}

export function isReturning(firstSeen: Date, now: Date, timezone: string): boolean {
  return dayKey(firstSeen, timezone) < dayKey(now, timezone);
}

/**
 * Arrival (and merge) line for named visitors. "Welcome back." only when every
 * named visitor in the batch is returning; a group larger than maxNames is
 * greeted collectively and always gets plain "Welcome.".
 */
export function arrivalText(people: GreetedPerson[], now: Date, rules: TimeRules & NameRules): string {
  const pod = partOfDay(now, rules);
  const who = addressee(
    people.map((p) => p.name),
    rules
  );
  const tooMany = people.length > rules.maxNames;
  const allReturning = !tooMany && people.length > 0 && people.every((p) => p.returning);
  return `${pod}, ${who}. ${allReturning ? "Welcome back." : "Welcome."}`;
}

/** First-time introduction after the host names someone who is in the room. */
export function renameText(names: string[], now: Date, rules: TimeRules & NameRules): string {
  // GREET_NAME_MODE=none: still the greeting, just nobody is named.
  if (names.length === 0) return `${partOfDay(now, rules)}. Nice to meet you.`;
  return `${partOfDay(now, rules)}, ${addressee(names, rules)}. Nice to meet you.`;
}

/** GREET_UNKNOWN=generic: no name, no "back". */
export function genericText(now: Date, rules: TimeRules): string {
  return `${partOfDay(now, rules)}. Welcome.`;
}
