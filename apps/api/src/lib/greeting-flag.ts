/**
 * GREETING_ENABLED — the master switch for greet-on-arrival. OFF unless it is
 * explicitly set to 1/true/yes/on.
 *
 * Deliberately dependency-free: every caller checks this BEFORE touching
 * anything from services/greeting, so with the flag off none of that code is
 * even loaded (the greeting module is only ever import()ed behind this check).
 */
export function isGreetingEnabled(env: Record<string, string | undefined> = process.env): boolean {
  const raw = env["GREETING_ENABLED"]?.trim().toLowerCase();
  return raw === "1" || raw === "true" || raw === "yes" || raw === "on";
}
