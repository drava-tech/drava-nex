/**
 * Spoken aliases for TRAVIS. These exist ONLY at the voice layer: the CMS,
 * database and every other client keep the original screen/device names
 * ("tv-86inch", "Stretch Fabric 0", ...) — renaming them in the database
 * breaks name-keyed CMS features (the Broadcast page filters on "tv-86inch"),
 * so an alias is a lookup table here, never a rename there.
 *
 * All strings below are in "compact" form: lowercased, spaces/hyphens removed,
 * and run through voice-actions' normalize() first (so British "centre" is
 * already "center", and a digit/letter boundary is a word break that compacts
 * away — "tv-86inch" -> "tv86inch"). normalize() also turns spoken numbers into
 * digits ("twenty seven" -> "27"), so list each alias once, with digits.
 */

export interface AliasRule {
  /** What Travis says back — the name the user actually uses. Omit to keep the real name. */
  display?: string;
  /** Compact spoken forms that resolve to this target. */
  spoken: string[];
  /** Compact real names (from the database) this alias stands for. */
  realNames: string[];
  /** Real ids (screens: screenId) this alias stands for, alongside realNames. */
  ids?: string[];
}

export const SCREEN_ALIASES: AliasRule[] = [
  {
    display: "tusker 86",
    spoken: ["tusker86"],
    realNames: ["tv86inch"],
    ids: ["main-screen"],
  },
  {
    // The 27-inch display, only ever called "tusker 27" by voice. Both ids are
    // listed because it has been registered under each ("screen-2" and
    // "kiosk"); see resolveScreenByTarget for how a live one is preferred.
    display: "tusker 27",
    spoken: ["tusker27"],
    realNames: ["kiosk"],
    ids: ["screen-2", "kiosk"],
  },
];

// A device with a display alias is reachable by voice only through that alias
// (see hasDisplayAlias in voice-actions.ts) — never by its real name.
export const DEVICE_ALIASES: AliasRule[] = [
  { display: "tusker L1", spoken: ["tuskerl1"], realNames: ["stretchfabric0"] },
  { display: "tusker L2", spoken: ["tuskerl2"], realNames: ["stretchfabric1"] },
  { display: "tusker edge", spoken: ["tuskeredge"], realNames: ["striplight"] },
  // No display alias below — Travis keeps saying the real name for these.
  { spoken: ["ac", "theac", "tuskerac", "airconditioner"], realNames: ["experiencecenterac"] },
  { spoken: ["tv", "thetv", "television", "tusker86"], realNames: ["tv"] },
  { spoken: ["soundbar", "thesoundbar", "speaker", "thespeaker", "speakers"], realNames: ["soundbar"] },
];

/**
 * A spoken name that means several devices used together. "tusker L3" is both
 * fabric fixtures — the union of L1 and L2's real names.
 */
export interface GroupAlias {
  display: string;
  spoken: string[];
  memberRealNames: string[];
}

export const DEVICE_GROUP_ALIASES: GroupAlias[] = [
  {
    display: "tusker L3",
    spoken: ["tuskerl3"],
    memberRealNames: ["stretchfabric0", "stretchfabric1"],
  },
];
