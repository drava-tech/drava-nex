import {
  listDevices,
  getDevice,
  listScreens,
  listExperiences,
  listMediaAssets,
  setScreenExperience,
  setScreenMedia,
  setScreenBlanked as persistScreenBlanked,
  advanceScreenQueue,
  type Device,
} from "@platform/db";
import {
  getDeviceDriver,
  getIrDriver,
  getCasambiDriver,
  applyLightState,
  applyIrCommand,
} from "./devices.js";
import { toggleDoorLock } from "./home-assistant.js";
import {
  applyAmbientMode,
  resolveAmbientMode,
  listAmbientModes,
  prepareGroupsForColor,
  whiteChannelFor,
} from "./ambient-modes.js";
import { resolveLightColor, LIGHT_COLOR_CHOICES } from "./light-colors.js";
import {
  clearTakeoverFlag,
  setScreenBlankState,
  sendCommandToScreen,
  getConnectedScreenIds,
} from "../ws/gateway.js";
import { pushScreenContent } from "../routes/screens.js";
import { SCREEN_ALIASES, DEVICE_ALIASES, DEVICE_GROUP_ALIASES, type AliasRule } from "./voice-aliases.js";

// Remote-command names understood by the kiosk client, defined in
// apps/cms/src/lib/display/playback-protocol.ts. apps/api has no dependency
// on the CMS frontend package (and the gateway's command channel is an
// untyped string with no allowlist there either — see that file's own
// comment), so these are repeated as plain string literals rather than
// imported across a package boundary that doesn't otherwise exist.
const SCREEN_CMD_SEEK = "MEDIA_SEEK";
const SCREEN_CMD_SET_PAUSED = "MEDIA_SET_PAUSED";
const SCREEN_CMD_RESET_STATE = "RESET_STATE";
/** Matches the CMS's own transport buttons (live-screen-surface.tsx). */
const SEEK_STEP_SECONDS = 10;

/**
 * Everything a voice agent can do to cms-platform, in one place.
 *
 * This is the single implementation behind two front doors: TRAVIS's room-mic
 * voice engine (calling in over HTTP through apps/api/src/routes/voice-internal.ts,
 * shared-secret authenticated) and the in-CMS browser voice agent (calling
 * these functions directly, in-process, from an authenticated operator's own
 * WebSocket session — see the VOICE_REGISTER role in ws/gateway.ts). Each
 * function here does exactly what the equivalent human-facing route already
 * does (same DB writes, same broadcasts, same side effects like clearing a
 * takeover flag) — voice is a new input modality, not a new control plane.
 */

export type VoiceCallerRole = "GUEST" | "ADMIN" | "SUPERADMIN";

export class VoiceActionError extends Error {
  code: string;
  constructor(message: string, code = "VOICE_ACTION_ERROR") {
    super(message);
    this.code = code;
  }
}

function requireAdminRole(role: VoiceCallerRole): void {
  if (role !== "ADMIN" && role !== "SUPERADMIN") {
    throw new VoiceActionError("This action requires an admin.", "FORBIDDEN");
  }
}

// ─── Name resolution ──────────────────────────────────────────────────────

// British/American spelling variants that show up in real venue/room names
// ("Experience Centre" vs. spoken "Experience Center") and would otherwise
// miss an exact match by one letter. Deliberately a small whole-word map, not
// a general -re/-er or -our/-or suffix rule — a suffix rule would also catch
// "hour", "tour", "your", "four", "colour of the light" etc. and silently
// mangle unrelated words.
const SPELLING_VARIANTS: Record<string, string> = {
  centre: "center",
  theatre: "theater",
  litre: "liter",
  metre: "meter",
  fibre: "fiber",
  calibre: "caliber",
};

// Devices/screens are routinely named with a trailing number ("Stretch Fabric
// 0", "screen 2"), but speech-to-text renders a spoken number as a word
// ("stretch fabric zero"), not a digit — an exact-string match would never
// close that gap on its own.
const NUMBER_WORDS: Record<string, string> = {
  zero: "0",
  one: "1",
  two: "2",
  three: "3",
  four: "4",
  five: "5",
  six: "6",
  seven: "7",
  eight: "8",
  nine: "9",
  ten: "10",
};

// Teens and tens complete the set, so spoken numbers up to 99 read the same as
// their digits ("twenty seven" / "27", "eighty-six" / "86"): a person says the
// number one way and speech-to-text may write it either, so every name match
// treats the two forms as identical, not just the aliases in voice-aliases.ts.
const TEEN_WORDS: Record<string, string> = {
  eleven: "11",
  twelve: "12",
  thirteen: "13",
  fourteen: "14",
  fifteen: "15",
  sixteen: "16",
  seventeen: "17",
  eighteen: "18",
  nineteen: "19",
};
const TENS_WORDS: Record<string, number> = {
  twenty: 20,
  thirty: 30,
  forty: 40,
  fifty: 50,
  sixty: 60,
  seventy: 70,
  eighty: 80,
  ninety: 90,
};

const WORD_SUBSTITUTIONS: Record<string, string> = { ...SPELLING_VARIANTS, ...NUMBER_WORDS, ...TEEN_WORDS };

/** Spoken words -> digits; "twenty seven" (two words) becomes the single token "27". */
function substituteWords(words: string[]): string[] {
  const out: string[] = [];
  for (let i = 0; i < words.length; i++) {
    const word = words[i]!;
    const tens = TENS_WORDS[word];
    if (tens === undefined) {
      out.push(WORD_SUBSTITUTIONS[word] ?? word);
      continue;
    }
    // A unit word right after a tens word completes the number ("seven" -> 27);
    // "zero" never does — "twenty zero" isn't a number anyone says.
    const unit = Number(NUMBER_WORDS[words[i + 1] ?? ""]);
    if (unit >= 1 && unit <= 9) {
      out.push(String(tens + unit));
      i++;
    } else {
      out.push(String(tens));
    }
  }
  return out;
}

function normalize(s: string): string {
  const words = s
    .trim()
    .toLowerCase()
    // Real names are routinely hyphenated/concatenated ("tv-86inch") while
    // speech never reproduces that punctuation — a spoken "TV 86 inch" would
    // otherwise never match "tv-86inch" no matter how clearly it's said.
    // Hyphens become word breaks, and a digit/letter boundary becomes one
    // too, so both sides converge on the same word sequence before matching.
    .replace(/-/g, " ")
    .replace(/(\d)([a-z])/g, "$1 $2")
    .replace(/([a-z])(\d)/g, "$1 $2")
    .split(/\s+/);
  return substituteWords(words).join(" ");
}

/** normalize() with all separators removed — the form voice-aliases.ts stores. */
function compact(s: string): string {
  return normalize(s).replace(/[\s_-]+/g, "");
}

/** Items a spoken alias stands for, matched by real name or real id. */
function aliasCandidates<T>(
  spoken: string,
  rules: AliasRule[],
  items: T[],
  nameOf: (item: T) => string,
  idOf: (item: T) => string
): T[] {
  const q = compact(spoken);
  const rule = rules.find((r) => r.spoken.includes(q));
  if (!rule) return [];
  return items.filter((i) => rule.realNames.includes(compact(nameOf(i))) || rule.ids?.includes(idOf(i)));
}

/** What Travis says for a real name: the user's alias when one exists, else the real name. */
function labelFor(rules: AliasRule[], name: string, id?: string): string {
  const key = compact(name);
  const rule = rules.find((r) => r.display && (r.realNames.includes(key) || (id !== undefined && r.ids?.includes(id))));
  return rule?.display ?? name;
}
/** True when a rule with a display alias covers this name/id — i.e. it has a user-facing alias. */
function hasDisplayAlias(rules: AliasRule[], name: string, id?: string): boolean {
  const key = compact(name);
  return rules.some((r) => r.display && (r.realNames.includes(key) || (id !== undefined && r.ids?.includes(id))));
}
const deviceLabel = (name: string) => labelFor(DEVICE_ALIASES, name);
const screenLabel = (screenId: string, name: string) => labelFor(SCREEN_ALIASES, name, screenId);

/** Live screen ids, or an empty set if the gateway can't say — only used to break a tie. */
function connectedScreenIds(): Set<string> {
  try {
    return new Set(getConnectedScreenIds());
  } catch {
    return new Set();
  }
}

/** Classic edit-distance, iterative to avoid recursion cost on short names. */
function levenshtein(a: string, b: string): number {
  const m = a.length;
  const n = b.length;
  if (m === 0) return n;
  if (n === 0) return m;
  const dp = new Array<number>(n + 1);
  for (let j = 0; j <= n; j++) dp[j] = j;
  for (let i = 1; i <= m; i++) {
    let prev = dp[0]!;
    dp[0] = i;
    for (let j = 1; j <= n; j++) {
      const tmp = dp[j]!;
      dp[j] = a[i - 1] === b[j - 1] ? prev : 1 + Math.min(prev, dp[j]!, dp[j - 1]!);
      prev = tmp;
    }
  }
  return dp[n]!;
}

/** 1.0 = identical, 0.0 = completely different, scaled by the longer string. */
function similarity(a: string, b: string): number {
  const maxLen = Math.max(a.length, b.length);
  if (maxLen === 0) return 1;
  return 1 - levenshtein(a, b) / maxLen;
}

/** Below this, a mis-transcription is too different from any real name to
 * safely guess — e.g. "screen too" vs "screen 2" scores well above this,
 * but two unrelated names don't. Tuned conservatively; raising it trades
 * fewer good catches for fewer wrong guesses. */
const FUZZY_MIN_SIMILARITY = 0.55;

/**
 * Resolve a spoken target ("the lobby lights", "screen 2") against a list of
 * named things. Exact match wins outright; otherwise a unique substring match
 * (either direction) wins; otherwise, ONLY when neither exact nor substring
 * matching found anything at all (not when they found several — that's
 * genuine ambiguity, not a transcription problem), a fuzzy edit-distance
 * fallback catches a close mis-transcription (e.g. Gemini's STT rendering
 * "The White Tusker PORT-FOLIO" as "the white task of portfolio") — accepted
 * only if there's a single similar-enough name with a clear lead over the
 * next-closest, so a genuine near-tie between two real names still falls
 * through to a clarifying question rather than a guess.
 */
export function resolveByName<T>(query: string, items: T[], getName: (item: T) => string): T | null {
  const q = normalize(query);
  if (!q) return null;

  const exact = items.filter((i) => normalize(getName(i)) === q);
  if (exact.length === 1) return exact[0]!;

  const partial = items.filter((i) => {
    const n = normalize(getName(i));
    return n.includes(q) || q.includes(n);
  });
  if (partial.length === 1) return partial[0]!;
  if (partial.length > 1) return null;

  const scored = items
    .map((i) => ({ item: i, score: similarity(q, normalize(getName(i))) }))
    .filter((s) => s.score >= FUZZY_MIN_SIMILARITY)
    .sort((a, b) => b.score - a.score);
  if (scored.length === 0) return null;
  if (scored.length === 1) return scored[0]!.item;
  return scored[0]!.score - scored[1]!.score >= 0.1 ? scored[0]!.item : null;
}

// ─── Reads (for name resolution + "what's the status" questions) ──────────

export async function listVoiceDevices(allowedDeviceIds?: Set<string> | null) {
  const devices = await listDevices();
  const isControllable = (d: (typeof devices)[number]) => {
    // The saved scenes (Relax, Ambient, ...) are retired from voice: the
    // ambient modes (see ambient-modes.ts) are the lighting presets now.
    if (d.type === "scene") return false;
    // Outside the voice agent's allow-list it can't act on the device
    // (runDeviceCommand refuses with FORBIDDEN_SCOPE), so don't advertise it.
    if (allowedDeviceIds && !allowedDeviceIds.has(d.id)) return false;
    return true;
  };
  return devices.filter(isControllable).map((d) => ({
    id: d.id,
    deviceId: d.deviceId,
    type: d.type,
    name: deviceLabel(d.name),
    state: d.state,
  }));
}

export async function listVoiceScreens() {
  return (await listScreens()).map((s) => ({
    screenId: s.screenId,
    screenName: screenLabel(s.screenId, s.screenName),
    blanked: s.blanked,
    currentContentKind: s.currentContentKind,
    experienceName: s.experienceName,
    mediaName: s.mediaName,
  }));
}

export async function listVoiceExperiences() {
  return listExperiences();
}

export async function listVoiceMedia() {
  const { items } = await listMediaAssets({ pageSize: 100 });
  return items.map((m) => ({ id: m.id, name: m.name, type: m.type }));
}

// ─── Short-lived name caches, for resolution only ───────────────────────────
//
// Every voice command re-scans the full device/screen/experience/media list
// to resolve a spoken name ("the AC", "Relax") to an id — a full table fetch
// on every single utterance, even though these names change rarely. Caching
// that lookup for a few seconds removes a real, avoidable DB round trip from
// each command.
//
// Deliberately NOT cached: anything with mutable state. A device's current
// on/off/brightness or a screen's current content must stay always-fresh —
// applyLightState merges into the device's *current* state, so acting on a
// stale cached row could silently revert an unrelated change made seconds
// earlier. These caches hold id/name pairs only, never state; the device
// resolver re-fetches the live row by id once a name has resolved.

const NAME_CACHE_TTL_MS = 10_000;

function ttlCache<T>(load: () => Promise<T>, ttlMs: number): () => Promise<T> {
  let cached: { value: T; at: number } | null = null;
  let pending: Promise<T> | null = null;
  return () => {
    if (cached && Date.now() - cached.at < ttlMs) return Promise.resolve(cached.value);
    if (pending) return pending;
    pending = load()
      .then((value) => {
        cached = { value, at: Date.now() };
        return value;
      })
      .finally(() => {
        pending = null;
      });
    return pending;
  };
}

const getCachedDeviceNames = ttlCache(
  async () => (await listDevices()).filter((d) => d.type !== "scene").map((d) => ({ id: d.id, name: d.name })),
  NAME_CACHE_TTL_MS
);
const getCachedScreenNames = ttlCache(
  async () => (await listScreens()).map((s) => ({ screenId: s.screenId, screenName: s.screenName })),
  NAME_CACHE_TTL_MS
);
const getCachedExperienceNames = ttlCache(listExperiences, NAME_CACHE_TTL_MS);
const getCachedMediaNames = ttlCache(
  async () => (await listMediaAssets({ pageSize: 100 })).items.map((m) => ({ id: m.id, name: m.name })),
  NAME_CACHE_TTL_MS
);

async function resolveDeviceByTarget(target: string): Promise<Device> {
  const byId = await getDevice(target);
  if (byId) return byId;
  const names = await getCachedDeviceNames();

  const [aliased] = aliasCandidates(target, DEVICE_ALIASES, names, (d) => d.name, (d) => d.id);
  if (aliased) {
    const fresh = await getDevice(aliased.id);
    if (fresh) return fresh;
  }

  // Devices with an alias are reachable only by it, so their real names stay
  // out of the general matcher ("strip light" must not find "tusker edge").
  const unaliased = names.filter((d) => !hasDisplayAlias(DEVICE_ALIASES, d.name));
  const match = resolveByName(target, unaliased, (d) => d.name);
  if (!match) {
    throw new VoiceActionError(
      `I couldn't find exactly one device matching "${target}". Which one did you mean?`,
      "AMBIGUOUS_TARGET"
    );
  }
  // The cache only ever holds id/name — fetch the live row before acting on
  // it, since its state may have changed since the name was cached.
  const fresh = await getDevice(match.id);
  if (!fresh) {
    throw new VoiceActionError(`"${match.name}" no longer exists.`, "NOT_FOUND");
  }
  return fresh;
}

/** Strip a trailing " <number>" from a normalized name, e.g. "stretch fabric
 *  0" -> "stretch fabric". Returns null when there's no trailing number. */
function deviceBaseName(name: string): string | null {
  const m = /^(.*\S)\s+\d+$/.exec(normalize(name));
  return m ? m[1]! : null;
}

/**
 * Resolve a spoken device target to one OR MORE real devices. Devices that
 * are numbered variants of the same base name ("Stretch Fabric 0"/"Stretch
 * Fabric 1", or "tusker L1"/"tusker L2") are physically used together as one fixture:
 * - Saying "tusker L3" or "stretch fabric" means both fixtures together.
 * - Saying "tusker L1" or "tusker L2" targets that specific individual fixture.
 */
async function resolveDeviceGroupByTarget(target: string): Promise<Device[]> {
  const byId = await getDevice(target);
  if (byId) return [byId];

  const names = await getCachedDeviceNames();

  const qClean = compact(target);
  const group = DEVICE_GROUP_ALIASES.find((g) => g.spoken.includes(qClean));
  if (group) {
    const members = names.filter((d) => group.memberRealNames.includes(compact(d.name)));
    if (members.length > 0) {
      const fresh = await Promise.all(members.map((d) => getDevice(d.id)));
      return fresh.filter((d): d is Device => d !== null);
    }
  }

  const [aliased] = aliasCandidates(target, DEVICE_ALIASES, names, (d) => d.name, (d) => d.id);
  if (aliased) {
    const fresh = await getDevice(aliased.id);
    if (fresh) return [fresh];
  }

  // Single-device resolution first (exact or uniquely-partial name match) —
  // reuses the same matcher every other resolveXByTarget uses, so this never
  // drifts from their behavior on the common case.
  const unaliased = names.filter((d) => !hasDisplayAlias(DEVICE_ALIASES, d.name));
  const single = resolveByName(target, unaliased, (d) => d.name);
  if (single) {
    const fresh = await getDevice(single.id);
    return fresh ? [fresh] : [];
  }

  const q = normalize(target);
  const groupMembers = unaliased.filter((d) => deviceBaseName(d.name) === q);
  if (groupMembers.length > 1) {
    const fresh = await Promise.all(groupMembers.map((d) => getDevice(d.id)));
    return fresh.filter((d): d is Device => d !== null);
  }

  throw new VoiceActionError(
    `I couldn't find exactly one device matching "${target}". Which one did you mean?`,
    "AMBIGUOUS_TARGET"
  );
}

/**
 * The real names to offer back with a "which one did you mean?" error. Without
 * them the model fills the gap from imagination — it answered a failed
 * "screen 2" lookup by offering a "Lobby Screen" that doesn't exist, straight
 * out of the example phrases in its own instructions. Capped so a big media
 * library doesn't turn one error into a wall of text read aloud.
 */
function optionsHint(names: string[], noun: string, max = 8): string {
  if (names.length === 0) return "";
  // Deduped: two rows can carry the same spoken alias (the 27-inch is registered
  // twice), and offering "tusker 27, tusker 27" would read as a bug.
  const unique = [...new Set(names)];
  const shown = unique.slice(0, max).join(", ");
  const more = unique.length > max ? `, and ${unique.length - max} more` : "";
  return ` The ${noun} are: ${shown}${more}. Only offer these.`;
}

async function resolveScreenByTarget(target: string): Promise<{ screenId: string; screenName: string }> {
  const names = await getCachedScreenNames();
  // Always hand back the alias (or the real name when there is none) as
  // screenName: it is only ever spoken back, and the user never says "tv-86inch".
  const named = (s: { screenId: string; screenName: string }) => ({
    screenId: s.screenId,
    screenName: screenLabel(s.screenId, s.screenName),
  });

  const byId = names.find((s) => s.screenId === target);
  if (byId) return named(byId);

  const candidates = aliasCandidates(target, SCREEN_ALIASES, names, (s) => s.screenName, (s) => s.screenId);
  if (candidates.length > 0) {
    // The same physical screen can be registered under more than one id (the
    // 27-inch is both "kiosk" and "screen-2"): prefer the one actually connected.
    const live = connectedScreenIds();
    return named(candidates.find((s) => live.has(s.screenId)) ?? candidates[0]!);
  }

  // Screens that have an alias are reachable only by it: leaving their real
  // names in the general matcher would let "86 inch" or "kiosk" still find
  // tv-86inch / kiosk by substring, when the user's names for them are the aliases.
  const unaliased = names.filter((s) => !hasDisplayAlias(SCREEN_ALIASES, s.screenName, s.screenId));
  const match = resolveByName(target, unaliased, (s) => s.screenName);
  if (!match) {
    throw new VoiceActionError(
      `I couldn't find exactly one screen matching "${target}". Which one did you mean?` +
        optionsHint(names.map((s) => screenLabel(s.screenId, s.screenName)), "screens"),
      "AMBIGUOUS_TARGET"
    );
  }
  return named(match);
}

async function resolveExperienceByTarget(target: string): Promise<{ id: string; title: string }> {
  const experiences = await getCachedExperienceNames();
  const byId = experiences.find((e) => e.id === target);
  if (byId) return byId;
  const match = resolveByName(target, experiences, (e) => e.title);
  if (!match) {
    throw new VoiceActionError(
      `I couldn't find exactly one experience matching "${target}". Which one did you mean?` +
        optionsHint(experiences.map((e) => e.title), "experiences"),
      "AMBIGUOUS_TARGET"
    );
  }
  return match;
}

async function resolveMediaByTarget(target: string): Promise<{ id: string; name: string }> {
  const media = await getCachedMediaNames();
  const byId = media.find((m) => m.id === target);
  if (byId) return byId;
  const match = resolveByName(target, media, (m) => m.name);
  if (!match) {
    throw new VoiceActionError(
      `I couldn't find exactly one media item matching "${target}". Which one did you mean?` +
        optionsHint(media.map((m) => m.name), "media items"),
      "AMBIGUOUS_TARGET"
    );
  }
  return match;
}

// ─── Device control ─────────────────────────────────────────────────────

export interface DeviceCommandInput {
  action:
    | "lights_on"
    | "lights_off"
    | "lights_set"
    | "scene_recall"
    | "ac_command"
    | "lock"
    | "unlock"
    | "status"
    | "good_night"
    | "good_morning"
    | "ambient_mode"
    | "all_lights_on"
    | "all_lights_off";
  /** Free-text device/room name, or a device id. Not needed for lock/unlock. */
  target?: string;
  brightness?: number;
  color?: string;
  /** AC/IR codebook verb, e.g. "power_on" | "set_temp" | "set_mode" | "set_fan". */
  command?: string;
  params?: Record<string, unknown>;
  /** Casambi mesh scene number, for a network-level (not device-scoped) scene_recall. */
  meshScene?: number;
  meshLevel?: number;
}

export interface VoiceActionResult {
  message: string;
  /** The resolved device/screen's real name, once name resolution succeeded
   *  — e.g. "Relax" instead of whatever the caller actually said ("the relax
   *  scene", "relax"). Callers (voice-internal.ts's logging) prefer this over
   *  the raw spoken text so a human reading the log later sees a real name,
   *  not a transcript fragment. Absent when there was nothing to resolve
   *  (lock/unlock) or resolution never happened (the call failed first). */
  resolvedTarget?: string;
  /** Same idea as resolvedTarget, for screen_control's separate content
   *  target (the experience/media name), once resolved. */
  resolvedContent?: string;
}

/**
 * Patch that turns a light on. Same degenerate-brightness guard as the
 * regular lights_on path — a light last synced at 0% (e.g. genuinely off)
 * should light up at full brightness, not silently stay dark. Shared by
 * every "turn everything on" fan-out so the guard lives in one place.
 */
function lightOnPatch(d: Device): { on: true; brightness?: number } {
  const priorBrightness = (d.state as { brightness?: number } | null)?.brightness;
  return priorBrightness && priorBrightness > 0 ? { on: true } : { on: true, brightness: 100 };
}

/**
 * "Turn on all the lights" — the on-side counterpart to good_night, same
 * reasoning: the model has no eager device list to enumerate itself, and
 * would risk missing one. AC is deliberately excluded (unlike good_night) —
 * "all the lights" doesn't imply the AC the way "good night"/"shut
 * everything down" implies powering off everything.
 */
async function runAllLightsOn(allowedDeviceIds: Set<string> | null | undefined): Promise<VoiceActionResult> {
  const devices = await listDevices();
  const scoped = allowedDeviceIds ? devices.filter((d) => allowedDeviceIds.has(d.id)) : devices;
  const lights = scoped.filter((d) => d.type === "light");

  const results = await Promise.allSettled(lights.map((d) => applyLightState(d, lightOnPatch(d))));
  const onCount = results.filter((r) => r.status === "fulfilled").length;
  const failCount = results.length - onCount;

  if (lights.length === 0) {
    return { message: "There are no lights to turn on." };
  }
  const base = `Turned on ${onCount} light${onCount === 1 ? "" : "s"}.`;
  return {
    message: failCount > 0 ? `${base} ${failCount} light${failCount === 1 ? "" : "s"} didn't respond.` : base,
  };
}

/**
 * "Turn off all the lights" — the lights-only counterpart to good_night.
 * Added after good_night's AC side effect surprised a "turn off all the
 * lights" request: that phrase doesn't mention the AC, so it shouldn't be
 * silently switched off as a side effect of the closest available broad
 * action. good_night stays reserved for an explicit "shut everything down"/
 * "we're done for the day" framing that actually implies the AC too.
 */
async function runAllLightsOff(allowedDeviceIds: Set<string> | null | undefined): Promise<VoiceActionResult> {
  const devices = await listDevices();
  const scoped = allowedDeviceIds ? devices.filter((d) => allowedDeviceIds.has(d.id)) : devices;
  const lights = scoped.filter((d) => d.type === "light");

  const results = await Promise.allSettled(lights.map((d) => applyLightState(d, { on: false })));
  const offCount = results.filter((r) => r.status === "fulfilled").length;
  const failCount = results.length - offCount;

  if (lights.length === 0) {
    return { message: "There are no lights to turn off." };
  }
  const base = `Turned off ${offCount} light${offCount === 1 ? "" : "s"}.`;
  return {
    message: failCount > 0 ? `${base} ${failCount} light${failCount === 1 ? "" : "s"} didn't respond.` : base,
  };
}

/**
 * "Bye" / "shut everything down" — turns off every light and the AC
 * in one call, rather than requiring the model to enumerate devices itself
 * (which it has no eager list of, and which would risk missing one). Runs
 * best-effort: one unresponsive light on the mesh shouldn't fail the whole
 * request or hide that every OTHER light did turn off.
 */
async function runGoodNight(allowedDeviceIds: Set<string> | null | undefined): Promise<VoiceActionResult> {
  const devices = await listDevices();
  const scoped = allowedDeviceIds ? devices.filter((d) => allowedDeviceIds.has(d.id)) : devices;
  const lights = scoped.filter((d) => d.type === "light");
  const ac = scoped.find((d) => (d.config as { irDevice?: string } | null)?.irDevice === "ac");

  const lightResults = await Promise.allSettled(lights.map((d) => applyLightState(d, { on: false })));
  const lightsOffCount = lightResults.filter((r) => r.status === "fulfilled").length;
  const lightFailures = lightResults.length - lightsOffCount;

  let acOff = false;
  let acFailed = false;
  if (ac) {
    const driver = getIrDriver();
    if (driver) {
      try {
        await applyIrCommand(ac, driver, { command: "power_off" });
        acOff = true;
      } catch {
        acFailed = true;
      }
    }
  }

  const parts: string[] = [];
  if (lightsOffCount > 0) parts.push(`${lightsOffCount} light${lightsOffCount === 1 ? "" : "s"}`);
  if (acOff) parts.push("the AC");
  const problems: string[] = [];
  if (lightFailures > 0) problems.push(`${lightFailures} light${lightFailures === 1 ? "" : "s"} didn't respond`);
  if (acFailed) problems.push("the AC didn't respond");

  const base = parts.length > 0 ? `Turned off ${parts.join(" and ")}.` : "Nothing to turn off.";
  return { message: problems.length > 0 ? `${base} ${problems.join(", ")}.` : base };
}

/**
 * "Travis, meeting mode" — put every light into a saved ambient mode (colour,
 * brightness, strip light on/off; edited in the CMS). Lights only: unlike "hi"
 * it never touches the AC.
 */
async function runAmbientMode(
  target: string | undefined,
  allowedDeviceIds: Set<string> | null | undefined
): Promise<VoiceActionResult> {
  const labels = (await listAmbientModes()).map((m) => m.label);
  if (!target) {
    throw new VoiceActionError("Which mode did you mean?" + optionsHint(labels, "modes"), "NEEDS_TARGET");
  }
  const mode = await resolveAmbientMode(target);
  if (!mode) {
    throw new VoiceActionError(
      `I couldn't find a mode matching "${target}". Which one did you mean?` + optionsHint(labels, "modes"),
      "AMBIGUOUS_TARGET"
    );
  }

  const { applied, failed } = await applyAmbientMode(mode, { allowedDeviceIds });
  if (applied === 0) {
    throw new VoiceActionError(
      failed > 0 ? "The lights didn't respond." : "There are no lights this voice agent can change.",
      failed > 0 ? "DRIVER_ERROR" : "FORBIDDEN_SCOPE"
    );
  }
  const base = `${mode.label} mode is on.`;
  return {
    message: failed > 0 ? `${base} ${failed} light${failed === 1 ? "" : "s"} didn't respond.` : base,
    resolvedTarget: `${mode.label} mode`,
  };
}

/**
 * "Hi" / "turn everything on" — the mirror image of good_night:
 * every light on and the AC powered on, in one call.
 *
 * Triggered by the phrase alone, never by the clock: there is deliberately no
 * time-of-day check anywhere here, so saying it at 9pm or 3am does exactly
 * what it does at 8am.
 *
 * The AC comes back on with whatever mode/temperature/fan it was last set to
 * (the IR driver replays the stored state on power_on), not a fixed default —
 * the same "resume what was last chosen" behaviour a plain "turn on the AC"
 * has. power_on is absolute rather than a toggle, so repeating this while the
 * AC is already running changes nothing. Best-effort like good_night: one
 * unresponsive fixture doesn't hide that everything else came on.
 */
async function runGoodMorning(allowedDeviceIds: Set<string> | null | undefined): Promise<VoiceActionResult> {
  const devices = await listDevices();
  const scoped = allowedDeviceIds ? devices.filter((d) => allowedDeviceIds.has(d.id)) : devices;
  const lights = scoped.filter((d) => d.type === "light");
  const ac = scoped.find((d) => (d.config as { irDevice?: string } | null)?.irDevice === "ac");

  // "Travis hi": the lights come up in the Entry mode (its saved colour and
  // brightness from the CMS), not just "on". (Pre-entry is what the room is set to
  // when the dev stack starts: infra/scripts/dev-stack.mjs.) If that mode is missing — the
  // ambient_mode table not migrated yet — fall back to plain "on" rather than
  // leaving the room dark.
  const entryMode = await resolveAmbientMode("entry").catch((err) => {
    console.error("[voice] entry mode unavailable, turning lights on plainly:", err);
    return null;
  });
  let lightsOnCount: number;
  let lightFailures: number;
  if (entryMode) {
    const r = await applyAmbientMode(entryMode, { allowedDeviceIds });
    lightsOnCount = r.applied;
    lightFailures = r.failed;
  } else {
    const lightResults = await Promise.allSettled(lights.map((d) => applyLightState(d, lightOnPatch(d))));
    lightsOnCount = lightResults.filter((r) => r.status === "fulfilled").length;
    lightFailures = lightResults.length - lightsOnCount;
  }

  let acOn = false;
  let acFailed = false;
  if (ac) {
    const driver = getIrDriver();
    if (driver) {
      try {
        await applyIrCommand(ac, driver, { command: "power_on" });
        acOn = true;
      } catch {
        acFailed = true;
      }
    }
  }

  const parts: string[] = [];
  if (lightsOnCount > 0) {
    parts.push(entryMode ? `the lights in ${entryMode.label.toLowerCase()} mode` : `${lightsOnCount} light${lightsOnCount === 1 ? "" : "s"}`);
  }
  if (acOn) parts.push("the AC");
  const problems: string[] = [];
  if (lightFailures > 0) problems.push(`${lightFailures} light${lightFailures === 1 ? "" : "s"} didn't respond`);
  if (acFailed) problems.push("the AC didn't respond");

  const base = parts.length > 0 ? `Turned on ${parts.join(" and ")}.` : "Nothing to turn on.";
  return { message: problems.length > 0 ? `${base} ${problems.join(", ")}.` : base };
}

type TvAudioKey = "Volume Up" | "Volume Down" | "mute";

/** The TV remote key a spoken volume/mute command means, or null if it isn't one. */
function tvAudioKeyFor(command: string | undefined): TvAudioKey | null {
  const c = (command ?? "").toLowerCase().replace(/[\s_\-]+/g, "");
  if (c === "volumeup" || c === "volup" || c === "volumeplus" || c === "volume+") return "Volume Up";
  if (c === "volumedown" || c === "voldown" || c === "volumeminus" || c === "volume-") return "Volume Down";
  if (c === "mute" || c === "unmute") return "mute";
  return null;
}

/**
 * Volume and mute for the room's sound. The speaker that makes the sound is
 * the soundbar, but the soundbar's own remote is unreachable through the Tuya
 * project (permission denied) — the CMS drives the audio through the TV's
 * remote, and the TV forwards its volume to the soundbar. So every audio
 * request, whatever it was aimed at ("the soundbar", "the TV", just "volume"),
 * goes to the TV's IR remote, exactly like the CMS's own TV remote buttons.
 *
 * This deliberately does NOT touch the PC's system volume (the audio bridge).
 * That is a different thing — it moved this laptop's speakers while Travis
 * announced "volume is now N%" — and it must not be reported as the TV's.
 * The TV's remote is one-way: there is no level to read back or set, so the
 * reply says how many presses were sent and nothing about a resulting level.
 * A failed press surfaces as an error instead of a cheerful confirmation.
 */
async function runTvAudio(
  key: TvAudioKey,
  input: DeviceCommandInput,
  allowedDeviceIds: Set<string> | null | undefined
): Promise<VoiceActionResult> {
  const devices = await listDevices();
  const scoped = allowedDeviceIds ? devices.filter((d) => allowedDeviceIds.has(d.id)) : devices;
  const tv = scoped.find((d) => (d.config as { irDevice?: string } | null)?.irDevice === "tv");
  if (!tv) throw new VoiceActionError("I can't reach the TV's remote to change the volume.", "UNSUPPORTED");
  const driver = getIrDriver();
  if (!driver) throw new VoiceActionError("IR control is not configured.", "UNSUPPORTED");

  // "mute" is a single toggle key on this remote — there is no separate unmute.
  const times =
    key === "mute" ? 1 : Math.min(10, Math.max(1, Math.round(Number(input.params?.["times"] ?? 1)) || 1));

  let pressed = 0;
  try {
    for (let i = 0; i < times; i++) {
      await applyIrCommand(tv, driver, { command: key });
      pressed++;
    }
  } catch (err) {
    if (pressed === 0) throw err;
    return {
      message: `Only ${pressed} of ${times} volume presses reached the TV before it stopped responding.`,
      resolvedTarget: tv.name,
    };
  }

  if (key === "mute") {
    return {
      message: "Pressed mute on the TV. It's a toggle, so that switched mute on or off — the TV doesn't say which.",
      resolvedTarget: tv.name,
    };
  }
  const direction = key === "Volume Up" ? "up" : "down";
  return {
    message: `Turned the volume ${direction} ${pressed} step${pressed === 1 ? "" : "s"} on the TV.`,
    resolvedTarget: tv.name,
  };
}

/**
 * A CMS "scene" device (config.driver === "scene") isn't itself a light —
 * its config.targets is a map of {deviceId: {on, color, brightness}} for
 * several OTHER real lights that should update together (the Relax/Focus/
 * Ambient/Presentation presets). The generic DeviceDriver.triggerScene()
 * has no way to reach across devices like that — it only ever sees the one
 * device it was called on, which is why this used to silently no-op no
 * matter what the CMS scene was configured to do. Handled here instead, the
 * same fan-out pattern as runGoodNight. Falls back to the driver's own
 * triggerScene for a device that ISN'T a composite scene (kept for whatever
 * non-Casambi hardware scene concept a future driver might add).
 */
async function runSceneRecall(
  device: Device,
  allowedDeviceIds: Set<string> | null | undefined
): Promise<VoiceActionResult> {
  const config = device.config as {
    driver?: string;
    targets?: Record<string, { on?: boolean; color?: string; brightness?: number }>;
  } | null;

  if (config?.driver !== "scene" || !config.targets) {
    await getDeviceDriver(device).triggerScene(device);
    return { message: `Scene "${device.name}" triggered.`, resolvedTarget: device.name };
  }

  const allTargets = Object.entries(config.targets);
  if (allTargets.length === 0) {
    throw new VoiceActionError(
      `"${device.name}" isn't set up correctly — it has no target lights configured.`,
      "UNSUPPORTED"
    );
  }

  // Resolve BEFORE checking scope, not after: an allow-list only ever
  // contains ids of devices that actually exist, so a stale/nonexistent
  // target id can never appear in it either way — checking scope first would
  // make every stale-target scene misreport as "not permitted" instead of
  // "not set up correctly", masking the real problem behind an unrelated one.
  const resolved = await Promise.all(
    allTargets.map(async ([targetId, state]) => ({ targetId, state, target: await getDevice(targetId) }))
  );
  const existing = resolved.filter(
    (r): r is typeof r & { target: Device } => r.target !== null
  );
  if (existing.length === 0) {
    throw new VoiceActionError(
      `"${device.name}" isn't set up correctly — none of its target lights could be found.`,
      "UNSUPPORTED"
    );
  }

  const inScope = existing.filter((r) => !allowedDeviceIds || allowedDeviceIds.has(r.targetId));
  if (inScope.length === 0) {
    // Distinct from "not set up correctly": the scene's targets DO exist,
    // this caller just isn't permitted to control them — conflating the two
    // would misreport a scope restriction as a broken scene.
    throw new VoiceActionError(
      `This voice agent isn't permitted to control any of "${device.name}"'s lights.`,
      "FORBIDDEN_SCOPE"
    );
  }

  const results = await Promise.allSettled(
    inScope.map(({ target, state }) =>
      applyLightState(target, {
        on: state.on ?? true,
        ...(state.color ? { color: state.color } : {}),
        ...(state.brightness !== undefined ? { brightness: state.brightness } : {}),
      })
    )
  );
  const okCount = results.filter((r) => r.status === "fulfilled").length;
  const failCount = results.length - okCount;

  if (okCount === 0) {
    throw new VoiceActionError(
      `"${device.name}" isn't set up correctly — none of its target lights could be updated.`,
      "UNSUPPORTED"
    );
  }
  const message =
    failCount > 0
      ? `Recalled "${device.name}" — ${okCount} of ${inScope.length} lights updated.`
      : `Recalled "${device.name}".`;
  return { message, resolvedTarget: device.name };
}

function describeLightState(name: string, state: Record<string, unknown> | null): string {
  const on = Boolean(state?.["on"]);
  const brightness = state?.["brightness"];
  if (!on) return `${name} is off.`;
  return typeof brightness === "number" ? `${name} is on at ${brightness}%.` : `${name} is on.`;
}

/** Same as describeLightState, but for a plain on/off command that produced
 *  no actual change — "X is already on" instead of implying an action just
 *  happened when nothing was actually done. */
function describeAlreadyState(name: string, state: Record<string, unknown> | null): string {
  const on = Boolean(state?.["on"]);
  const brightness = state?.["brightness"];
  if (!on) return `${name} is already off.`;
  return typeof brightness === "number" ? `${name} is already on at ${brightness}%.` : `${name} is already on.`;
}

/**
 * All physical-device voice actions: lights, IR/AC, Casambi scenes, door lock.
 * Admin-only, matching the equivalent HTTP routes.
 *
 * `allowedDeviceIds`, when given, scopes which resolved device ids this
 * caller may actually act on — checked AFTER name resolution (against the
 * real device.id), never against the raw spoken target, since a spoken
 * phrase can never be expected to equal a stored id.
 */
export async function runDeviceCommand(
  input: DeviceCommandInput,
  role: VoiceCallerRole,
  allowedDeviceIds?: Set<string> | null
): Promise<VoiceActionResult> {
  requireAdminRole(role);

  if (input.action === "lock" || input.action === "unlock") {
    const event = await toggleDoorLock(input.action === "lock" ? "locked" : "unlocked", "voice");
    return { message: `Door ${event.action}.` };
  }

  if (input.action === "scene_recall" && typeof input.meshScene === "number") {
    const driver = getCasambiDriver();
    if (!driver) throw new VoiceActionError("Casambi is not configured.", "UNSUPPORTED");
    await driver.triggerMeshScene(input.meshScene, input.meshLevel ?? 255);
    return { message: `Scene ${input.meshScene} recalled.` };
  }

  if (input.action === "good_night") {
    return runGoodNight(allowedDeviceIds);
  }

  if (input.action === "ambient_mode") {
    return runAmbientMode(input.target, allowedDeviceIds);
  }

  if (input.action === "good_morning") {
    return runGoodMorning(allowedDeviceIds);
  }

  if (input.action === "all_lights_on") {
    return runAllLightsOn(allowedDeviceIds);
  }

  if (input.action === "all_lights_off") {
    return runAllLightsOff(allowedDeviceIds);
  }

  // Volume/mute never needs (or trusts) a target: it always goes to the TV.
  if (input.action === "ac_command") {
    const audioKey = tvAudioKeyFor(input.command);
    if (audioKey) return runTvAudio(audioKey, input, allowedDeviceIds);
  }

  if (!input.target) {
    throw new VoiceActionError("Which device did you mean?", "NEEDS_TARGET");
  }

  if (input.action === "status" || input.action === "lights_on" || input.action === "lights_off" || input.action === "lights_set") {
    const group = await resolveDeviceGroupByTarget(input.target);
    const scoped = allowedDeviceIds ? group.filter((d) => allowedDeviceIds.has(d.id)) : group;
    if (scoped.length === 0) {
      throw new VoiceActionError(`This voice agent isn't permitted to control "${input.target}".`, "FORBIDDEN_SCOPE");
    }
    const l3 = DEVICE_GROUP_ALIASES.find((g) => g.display === "tusker L3")!;
    const isL3Group = scoped.length > 1 && scoped.every((d) => l3.memberRealNames.includes(compact(d.name)));
    const groupName = isL3Group ? l3.display : scoped.map((d) => deviceLabel(d.name)).join(" and ");

    if (input.action === "status") {
      const first = scoped[0];
      if (first) {
        const cfg = first.config as { irDevice?: string } | null;
        if (cfg?.irDevice === "tv" || cfg?.irDevice === "soundbar") {
          return {
            message:
              "The TV's volume can't be read back — its remote only sends volume up, volume down and mute.",
            resolvedTarget: deviceLabel(first.name),
          };
        }
        if (cfg?.irDevice === "ac") {
          const state = (first.state as Record<string, unknown> | null) ?? {};
          const power = state.power ? "on" : "off";
          const temp = state.temp ? ` set to ${state.temp}°C` : "";
          return {
            message: `${deviceLabel(first.name)} is ${power}${temp}.`,
            resolvedTarget: deviceLabel(first.name),
          };
        }
      }
      return {
        message: scoped.map((d) => describeLightState(deviceLabel(d.name), d.state as Record<string, unknown> | null)).join(" "),
        resolvedTarget: groupName,
      };
    }

    const on = input.action !== "lights_off";
    // Captured before the change, so the reply can tell "genuinely just
    // turned on" apart from "was already on" — asking a device to turn on
    // when it's already on shouldn't get the same confirmation as a real
    // transition, since nothing actually happened.
    const priorOnById = new Map(scoped.map((d) => [d.id, Boolean((d.state as { on?: boolean } | null)?.on)]));

    // A colour has to reach the lights as its hex (they understand nothing
    // else — a bare "blue" used to be dropped silently), and the fixtures have
    // to be on the LEDs that can show it first.
    let colorHex: string | undefined;
    let siblingsToRestore: Device[] = [];
    if (input.color && on) {
      const resolved = resolveLightColor(input.color);
      if (!resolved) {
        throw new VoiceActionError(
          `I don't have a colour called "${input.color}". The colours I can do are: ${LIGHT_COLOR_CHOICES.join(", ")}.`,
          "AMBIGUOUS_TARGET"
        );
      }
      colorHex = resolved;
      siblingsToRestore = await prepareGroupsForColor(scoped, colorHex);
    }

    const updated = await Promise.all(
      scoped.map((d) => {
        // Turning on with no explicit brightness restores whatever was last
        // persisted (see applyLightState's merge) — correct when that's a
        // real prior level (30% stays 30%), but if it's 0 (e.g. synced back
        // from hardware faithfully reporting 0% while off), "turn on" would
        // otherwise restore a degenerate value indistinguishable from still
        // being off. Default to full brightness in that case, same as what
        // a user actually means by "turn it on".
        const priorBrightness = (d.state as { brightness?: number } | null)?.brightness;
        const brightness =
          input.brightness !== undefined
            ? input.brightness
            : on && !(priorBrightness && priorBrightness > 0)
              ? 100
              : undefined;
        return applyLightState(d, {
          on,
          ...(brightness !== undefined ? { brightness } : {}),
          ...(colorHex ? { color: colorHex, white: whiteChannelFor(colorHex) } : {}),
        });
      })
    );
    // Put back anything the scene recall switched on that wasn't asked for.
    await Promise.allSettled(
      siblingsToRestore.map((d) => {
        const prior = (d.state as { on?: boolean; brightness?: number } | null) ?? {};
        return applyLightState(d, {
          on: prior.on === true,
          ...(prior.brightness !== undefined ? { brightness: prior.brightness } : {}),
        });
      })
    );
    // lights_set always describes the result, even with no "on" transition —
    // setting a specific brightness/color is itself meaningful action. Only
    // a plain on/off toggle that changed nothing gets the "already" phrasing.
    const isPlainToggle = input.action === "lights_on" || input.action === "lights_off";
    const noneChanged = isPlainToggle && scoped.every((d) => priorOnById.get(d.id) === on);
    // A colour request is confirmed with the colour (in the user's own words),
    // not with the light's brightness — "set it to warm white" answered with
    // "...is on at 1%" never said whether the colour took.
    const colorSpoken = colorHex ? input.color : undefined;
    const atBrightness = input.brightness !== undefined ? ` at ${input.brightness}%` : "";
    return {
      message: colorSpoken
        ? scoped.length === 1
          ? `${deviceLabel(updated[0]!.name)} is now ${colorSpoken}${atBrightness}.`
          : `${isL3Group ? `${l3.display} is` : `${groupName} are`} now ${colorSpoken}${atBrightness}.`
        : scoped.length === 1
          ? (noneChanged ? describeAlreadyState : describeLightState)(
              deviceLabel(updated[0]!.name),
              updated[0]!.state as Record<string, unknown> | null
            )
          : isL3Group
            ? `${l3.display} ${noneChanged ? "is already" : "is now"} ${on ? "on" : "off"}.`
            : `${groupName} ${noneChanged ? "are already" : "are now"} ${on ? "on" : "off"}.`,
      resolvedTarget: groupName,
    };
  }

  // scene_recall / ac_command act on exactly one device — a group name here
  // (rare in practice; groups exist for co-located lights, not scenes/IR)
  // asks for clarification rather than guessing which member was meant.
  const device = await resolveDeviceByTarget(input.target);
  if (allowedDeviceIds && !allowedDeviceIds.has(device.id)) {
    throw new VoiceActionError(`This voice agent isn't permitted to control "${deviceLabel(device.name)}".`, "FORBIDDEN_SCOPE");
  }

  switch (input.action) {
    case "scene_recall":
      return runSceneRecall(device, allowedDeviceIds);

    case "ac_command": {
      const driver = getIrDriver();
      if (!driver) throw new VoiceActionError("IR control is not configured.", "UNSUPPORTED");
      if (!input.command) throw new VoiceActionError("Which command did you mean?", "NEEDS_TARGET");

      // Volume/mute was already routed to the TV above, so this is the AC, or
      // some other remote key. A failed send is an error, not a success.
      await applyIrCommand(device, driver, { command: input.command, params: input.params });
      return { message: `Sent "${input.command}" to ${deviceLabel(device.name)}.`, resolvedTarget: deviceLabel(device.name) };
    }

    default:
      throw new VoiceActionError(`Unsupported device action: ${input.action}`, "UNSUPPORTED");
  }
}

// ─── Screen / content control ──────────────────────────────────────────────

export interface ScreenCommandInput {
  action:
    | "assign_experience"
    | "assign_media"
    | "idle"
    | "stop"
    | "status"
    | "play"
    | "pause"
    | "seek_forward"
    | "seek_back"
    | "next_item"
    | "previous_item"
    | "reset_view";
  /** Free-text screen name, or a screenId. */
  screen: string;
  /** Free-text experience/media name or id — required for assign_experience/assign_media. */
  content?: string;
}

/**
 * All screen/content voice actions. Guest-or-admin, matching screens.ts's
 * requireGuestOrAdmin — a voice-driven "push this to screen 2" carries the
 * same authorization bar as clicking the equivalent CMS button.
 *
 * `allowedScreenIds`, when given, scopes which resolved screens this caller
 * may act on — checked AFTER name resolution (against the real screenId),
 * same reasoning as runDeviceCommand's allowedDeviceIds.
 */
export async function runScreenCommand(
  input: ScreenCommandInput,
  role: VoiceCallerRole,
  allowedScreenIds?: Set<string> | null
): Promise<VoiceActionResult> {
  if (role !== "GUEST" && role !== "ADMIN" && role !== "SUPERADMIN") {
    throw new VoiceActionError("Not authorized.", "FORBIDDEN");
  }

  const { screenId, screenName } = await resolveScreenByTarget(input.screen);
  if (allowedScreenIds && !allowedScreenIds.has(screenId)) {
    throw new VoiceActionError(`This voice agent isn't permitted to control "${screenName}".`, "FORBIDDEN_SCOPE");
  }

  switch (input.action) {
    case "assign_experience": {
      if (!input.content) throw new VoiceActionError("Which experience did you mean?", "NEEDS_TARGET");
      const experience = await resolveExperienceByTarget(input.content);
      await setScreenExperience(screenId, experience.id);
      clearTakeoverFlag(screenId);
      setScreenBlankState(screenId, false);
      await pushScreenContent(screenId);
      return {
        message: `Pushed "${experience.title}" to ${screenName}.`,
        resolvedTarget: screenName,
        resolvedContent: experience.title,
      };
    }

    case "assign_media": {
      if (!input.content) throw new VoiceActionError("Which media item did you mean?", "NEEDS_TARGET");
      const media = await resolveMediaByTarget(input.content);
      await setScreenMedia(screenId, media.id);
      clearTakeoverFlag(screenId);
      setScreenBlankState(screenId, false);
      await pushScreenContent(screenId);
      return {
        message: `Pushed "${media.name}" to ${screenName}.`,
        resolvedTarget: screenName,
        resolvedContent: media.name,
      };
    }

    case "idle": {
      // Same mutation the CMS's own screen-card "Idle" button performs
      // (screens-controller.tsx's handleResetToIdle → assignMedia(id, null)):
      // clear the assignment so the screen falls back to its configured
      // default/idle media, rather than the separate blank/black-screen
      // overlay this used to offer.
      await setScreenMedia(screenId, null);
      clearTakeoverFlag(screenId);
      setScreenBlankState(screenId, false);
      await pushScreenContent(screenId);
      return {
        message: `${screenName} is now idle.`,
        resolvedTarget: screenName,
      };
    }

    case "stop": {
      // The CMS screen's own "Stop" button (POST /api/screens/:id/blank with
      // blanked:true): saved so a reconnecting screen stays black, then
      // broadcast. Assigning content or going idle un-blanks it again, so
      // there's no separate resume needed to get the screen back.
      await persistScreenBlanked(screenId, true);
      setScreenBlankState(screenId, true);
      return { message: `${screenName} is stopped (black screen).`, resolvedTarget: screenName };
    }

    case "status": {
      const screens = await listVoiceScreens();
      const screen = screens.find((s) => s.screenId === screenId);
      if (!screen) throw new VoiceActionError("Screen not found.", "NOT_FOUND");
      const showing = screen.experienceName ?? screen.mediaName ?? "nothing";
      return {
        message: `${screen.screenName} is ${screen.blanked ? "blanked" : `showing ${showing}`}.`,
        resolvedTarget: screenName,
      };
    }

    // The four cases below are the same remote-command channel the CMS's own
    // transport buttons use (live-screen-surface.tsx's handleSeek/
    // handleTogglePlay/resetState) — deliberately NOT a generic "send any
    // command" passthrough like that panel has, since this surface has no
    // per-user login. Only these specific, content-safe commands are reachable
    // by voice; the kiosk-process controls next to them in the CMS (refresh/
    // minimize/maximize/close the app) and the camera/admin-only actions are
    // intentionally not exposed here at all.
    case "play":
    case "pause": {
      const delivered = sendCommandToScreen(screenId, SCREEN_CMD_SET_PAUSED, {
        paused: input.action === "pause",
      });
      if (delivered === 0) {
        throw new VoiceActionError(`${screenName} isn't connected right now.`, "NOT_FOUND");
      }
      return { message: `${screenName} ${input.action === "pause" ? "paused" : "playing"}.`, resolvedTarget: screenName };
    }

    case "seek_forward":
    case "seek_back": {
      const delta = input.action === "seek_forward" ? SEEK_STEP_SECONDS : -SEEK_STEP_SECONDS;
      const delivered = sendCommandToScreen(screenId, SCREEN_CMD_SEEK, { delta });
      if (delivered === 0) {
        throw new VoiceActionError(`${screenName} isn't connected right now.`, "NOT_FOUND");
      }
      return {
        message: `${screenName} skipped ${input.action === "seek_forward" ? "forward" : "back"} ${SEEK_STEP_SECONDS} seconds.`,
        resolvedTarget: screenName,
      };
    }

    case "reset_view": {
      const delivered = sendCommandToScreen(screenId, SCREEN_CMD_RESET_STATE);
      if (delivered === 0) {
        throw new VoiceActionError(`${screenName} isn't connected right now.`, "NOT_FOUND");
      }
      return { message: `${screenName} reset to the start.`, resolvedTarget: screenName };
    }

    case "next_item":
    case "previous_item": {
      const direction = input.action === "next_item" ? "next" : "prev";
      const result = await advanceScreenQueue(screenId, direction);
      if (!result) {
        throw new VoiceActionError(`${screenName} doesn't have a playlist queued right now.`, "UNSUPPORTED");
      }
      clearTakeoverFlag(screenId);
      await pushScreenContent(screenId);
      return {
        message: `${screenName} moved to item ${result.index + 1} of ${result.length}.`,
        resolvedTarget: screenName,
      };
    }

    default:
      throw new VoiceActionError(`Unsupported screen action: ${input.action}`, "UNSUPPORTED");
  }
}
