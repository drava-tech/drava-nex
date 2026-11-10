import type { MediaCardType, MediaItem } from "./publish-board";

/**
 * Per-document memory of the publish board's UI state.
 *
 * Publishing deliberately navigates away (publish-board.tsx's
 * `router.push("/broadcast/live/<screenId>")` once the "Opening …" cover
 * lands), and coming back through LiveScreenSurface's `<Link href="/broadcast">`
 * re-runs the async server page and mounts a brand-new PublishBoard — so every
 * useState and the carousel's raw scrollLeft would otherwise be gone by the
 * time the user is looking at the board again.
 *
 * Module scope lives exactly as long as the document: it survives that
 * unmount/remount, and it dies on a hard reload. That is precisely the wanted
 * lifetime — an in-app trip to the live page and back keeps your place, F5
 * starts clean — so this is deliberately NOT sessionStorage/localStorage
 * (unlike environment-view.tsx's "cms_environment_panel", which *wants* to
 * outlive a reload). Those would need a reload check plus validation of every
 * persisted value against the current experiences/tags/media, and would let a
 * days-old date-range filter silently hide everything.
 *
 * It also keeps hydration safe for free: the only render that hydrates SSR
 * HTML is a fresh document load, where this snapshot is still DEFAULTS, so the
 * server and client markup agree. The return navigation is a client-side
 * render with no hydration at all.
 */
export interface PublishBoardSnapshot {
  filter: "experiences" | "media";
  tagFilter: string | null;
  /** Experience search text; matches the title or a tag name. "" = no search. */
  experienceSearch: string;
  mediaTypeFilter: MediaCardType | null;
  emailOnly: boolean;
  /** "" | "YYYY-MM-DD", open-ended if either is empty. */
  mediaDateFrom: string;
  mediaDateTo: string;
  targetIndex: number;
  /** The screen group the screen list is narrowed to; null = all screens. */
  groupFilter: string | null;
  /** `${card.type}:${card.id}` of the card nearest the carousel's centre. */
  centredCardKey: string | null;
  /** Cached /api/media rows, so the carousel renders — and can be scrolled
   *  back to centredCardKey — on the first frame, with no loading flash.
   *  null means "never fetched in this document yet".
   *
   *  This is however many keyset pages the user had scrolled through, not the
   *  whole library (see publish-board.tsx's loadMediaPage). */
  mediaItems: MediaItem[] | null;
  /** Keyset cursor for the page AFTER the last one in mediaItems, so a return
   *  visit can keep scrolling instead of dead-ending at whatever was cached.
   *  null means either "not fetched yet" or "reached the end of the list" —
   *  mediaItems === null distinguishes the two. */
  mediaNextCursor: string | null;
}

/** Must match PublishBoard's own initial useState values exactly, or a first
 *  visit would render something other than what the server sent. */
const DEFAULTS: PublishBoardSnapshot = {
  filter: "experiences",
  tagFilter: null,
  experienceSearch: "",
  mediaTypeFilter: null,
  emailOnly: false,
  mediaDateFrom: "",
  mediaDateTo: "",
  targetIndex: 0,
  groupFilter: null,
  centredCardKey: null,
  mediaItems: null,
  mediaNextCursor: null,
};

let snapshot: PublishBoardSnapshot = { ...DEFAULTS };

/** A fresh board's state, for a board that keeps no memory (the Media page's). */
export function boardDefaults(): PublishBoardSnapshot {
  return { ...DEFAULTS };
}

export function readBoardSnapshot(): PublishBoardSnapshot {
  return snapshot;
}

export function saveBoardSnapshot(patch: Partial<PublishBoardSnapshot>): void {
  snapshot = { ...snapshot, ...patch };
}
