"use client";

import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useRouter } from "next/navigation";
import {
  motion,
  animate,
  useAnimation,
  useMotionValue,
  type PanInfo,
} from "framer-motion";
import {
  CalendarRange,
  Check,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  FileSpreadsheet,
  FileText,
  Image as ImageIcon,
  Layers,
  Loader2,
  Mail,
  Presentation,
  RefreshCw,
  Search,
  Video,
  X,
} from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@platform/ui";
import { PUSHABLE_MEDIA_TYPES, mediaThumbnailSrc } from "@/lib/media-tiles";
import { assignExperience, assignMedia } from "@/actions/screen-actions";
import {
  currentLabel,
  type ScreenRow,
} from "@/components/push-to-screen-modal";
import { DateRangeCalendar } from "@/components/date-range-calendar";
import { boardDefaults, readBoardSnapshot, saveBoardSnapshot } from "./publish-board-state";

/** The group filter's value for screens in no group. */
const UNGROUPED = "__ungrouped__";

/** For the media-only board, which keeps no memory between visits. */
const noSnapshot: typeof saveBoardSnapshot = () => {};

/** The media-only board pages through the library looking for the opened item, up to this many pages. */
const FOCUS_MAX_PAGES = 40;
import { useAppDispatch, useAppSelector } from "@/store/hooks";
import {
  activeScreensUpdated,
  screenContentUpdated,
  screenRowRestored,
  screensHydrated,
} from "@/store/screens-slice";

/** How far / how fast a card must be swiped up before it counts as "publish" —
 * deliberately strict (near the card's full height) so an accidental brush
 * or light flick never fires a real publish. */
const SWIPE_DISTANCE = 260;
const SWIPE_VELOCITY = 900;

/** SwipeCard's own local fly-off/reset duration — the full-screen "opening
 * the screen" cover (triggerPublish) must never start before this finishes,
 * or the two animations visibly overlap. */
const CARD_RESET_MS = 240;

/** Matches the cover's own 0.45s rise, so navigation starts as it lands. */
const COVER_SETTLE_MS = 450;

/**
 * Hard ceiling on the "Opening …" cover. If the navigation it starts hasn't
 * replaced this page by now it isn't going to — give the board back instead of
 * leaving an opaque panel over the whole surface.
 */
const COVER_BAIL_MS = 8_000;

/** useLayoutEffect so a remembered carousel position is already in place on the
 * first painted frame rather than visibly jumping there afterwards. The
 * useEffect fallback only covers the SSR pass, where there is by definition
 * nothing restored to jump to (see publish-board-state.ts). */
const useIsomorphicLayoutEffect =
  typeof window === "undefined" ? useEffect : useLayoutEffect;

interface ExperienceOption {
  id: string;
  title: string;
  coverImage: string | null;
  typeIds: string[];
}

interface ExperienceTag {
  id: string;
  name: string;
}

export interface MediaItem {
  id: string;
  name: string;
  type: string;
  url: string;
  source: string | null;
  createdAt: string | null;
  /** Small derived tile; null for videos and pre-backfill images. */
  thumbnailUrl?: string | null;
}

/** Every non-experience card carries the media asset's own classified type
 * (see apps/api/src/routes/media.ts's ALLOWED map) — "image"/"video" render a
 * real preview, the rest fall back to a file-type icon (see CardVisual). */
export type MediaCardType =
  | "image"
  | "video"
  | "document"
  | "sheet"
  | "presentation"
  | "word";

const MEDIA_TYPE_LABELS: Record<MediaCardType, string> = {
  video: "Video",
  image: "Image",
  document: "PDF",
  sheet: "Sheet",
  presentation: "PPT",
  word: "Word",
};

interface ContentCard {
  id: string;
  type: "experience" | MediaCardType;
  title: string;
  thumbnail: string | null;
  typeIds?: string[];
  /** Videos: the file, for a frame when there's no poster yet. */
  videoUrl?: string;
}

interface PublishBoardProps {
  initialScreens: ScreenRow[];
  /** Connected screen ids at render time; the store keeps them current after. */
  initialActiveScreenIds: string[];
  experiences: ExperienceOption[];
  experienceTypes: ExperienceTag[];
  /** Screen groups, for the group dropdown beside the screen bar. */
  screenGroups?: { id: string; name: string }[];
  /**
   * The Media page's view: media only (no Portfolio switch), opened on this
   * item, with a way back to the list. Keeps none of Our Story's remembered
   * state, and doesn't disturb it.
   */
  focusMedia?: { id: string; onBack: () => void };
}

/**
 * Hold a card and swipe it up to publish it to whichever screen the box at
 * the top currently shows — arrows on either side page through every
 * registered screen without leaving the page. Publishing reuses the same
 * assignExperience/assignMedia actions (DB write + realtime WS broadcast) as
 * the checkbox-list pickers elsewhere in the CMS; the screen box plays a
 * quick "opening" flash when new content lands on it.
 */
export function PublishBoard({
  initialScreens,
  initialActiveScreenIds,
  experiences,
  experienceTypes,
  screenGroups = [],
  focusMedia,
}: PublishBoardProps) {
  // Publishing navigates to the live page and coming back mounts a fresh
  // board, so everything the user had set up would be lost — restored here
  // from the per-document snapshot (see publish-board-state.ts). On a genuinely
  // first visit every value below is the same default as before, so the
  // server-rendered markup is unchanged. Captured in a ref so its identity is
  // stable for the lifetime of this mount.
  const restored = useRef(
    focusMedia ? { ...boardDefaults(), filter: "media" as const } : readBoardSnapshot(),
  ).current;
  const saveSnapshot = focusMedia ? noSnapshot : saveBoardSnapshot;
  const dispatch = useAppDispatch();
  const storeRows = useAppSelector((s) => s.screens.rows);
  const screens = storeRows.length > 0 ? storeRows : initialScreens;
  // Kept live by StoreSync's ACTIVE_SCREENS_LIST — the same source the
  // experiences list and browser view read for their online dots. Whether the
  // screen in the box is actually attached is the single most useful thing to
  // show here. Seeded from the
  // server prop and falling back to it until the socket's first list arrives,
  // so the dot is never wrongly amber on the first frame (same shape as
  // projects-list.tsx).
  const storeActiveIds = useAppSelector((s) => s.screens.activeIds);
  useEffect(() => {
    dispatch(activeScreensUpdated(initialActiveScreenIds));
  }, [dispatch, initialActiveScreenIds]);
  const activeScreenIds =
    storeActiveIds.length > 0 ? storeActiveIds : initialActiveScreenIds;
  const [targetIndex, setTargetIndex] = useState(restored.targetIndex);
  /** Narrows the screen dropdown to one group; UNGROUPED = screens in none. */
  const [groupFilter, setGroupFilter] = useState<string | null>(restored.groupFilter);
  /** What the filter's two rows are called on screen (the values stay internal). */
  const FILTER_LABELS = { experiences: "Portfolio", media: "Media" } as const;
  const [filter, setFilter] = useState<"experiences" | "media">(
    restored.filter,
  );
  /** Only meaningful (and shown) while filter === "experiences" — narrows to one tag. */
  const [tagFilter, setTagFilter] = useState<string | null>(restored.tagFilter);
  /** Only meaningful (and shown) while filter === "experiences" — title or tag name. */
  const [experienceSearch, setExperienceSearch] = useState(restored.experienceSearch);
  /** Only meaningful (and shown) while filter === "media" — narrows to one media type. */
  const [mediaTypeFilter, setMediaTypeFilter] = useState<MediaCardType | null>(
    restored.mediaTypeFilter,
  );
  /** Only meaningful while filter === "media" — narrows to email-ingested items only. */
  const [emailOnly, setEmailOnly] = useState(restored.emailOnly);
  /** Only meaningful while filter === "media" — "" | "YYYY-MM-DD", open-ended if either is empty. */
  const [mediaDateFrom, setMediaDateFrom] = useState(restored.mediaDateFrom);
  const [mediaDateTo, setMediaDateTo] = useState(restored.mediaDateTo);
  // Seeded from the snapshot so a return visit has its cards (and therefore
  // its scroll position) on the very first frame instead of flashing the
  // "Loading content…" spinner while /api/media is re-fetched below.
  const [mediaItems, setMediaItems] = useState<MediaItem[]>(
    restored.mediaItems ?? [],
  );
  const [loadingMedia, setLoadingMedia] = useState(
    restored.mediaItems === null,
  );
  /** Keyset cursor for the next page, or null at the end of the list. */
  const [nextCursor, setNextCursor] = useState<string | null>(
    restored.mediaNextCursor,
  );
  const [loadingMore, setLoadingMore] = useState(false);
  /** Read by the scroll handler, which must not re-subscribe per state change. */
  const loadingMoreRef = useRef(false);
  const nextCursorRef = useRef<string | null>(restored.mediaNextCursor);
  nextCursorRef.current = nextCursor;
  /** Bumped on every filter change; a response tagged with a stale seq is
   *  dropped, so a slow first page can't overwrite a newer filter's results. */
  const requestSeqRef = useRef(0);
  /** Which media types actually exist under the current source/date filter.
   *  Comes from the server (GET /api/media/stats) rather than from the loaded
   *  rows: with keyset paging the client has only seen the pages it scrolled
   *  through, so deriving the dropdown locally would hide types further down. */
  const [presentMediaTypes, setPresentMediaTypes] = useState<string[]>([]);
  const [pushingId, setPushingId] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<{
    message: string;
    // "warning" = the push itself worked, but nothing was there to receive it.
    tone: "success" | "warning" | "error";
  } | null>(null);
  const boxControls = useAnimation();
  const router = useRouter();
  const [covering, setCovering] = useState<{
    screenId: string;
    screenName: string;
  } | null>(null);
  // Drives the cover's navigation, and guarantees the cover can always be
  // dismissed. This used to hang off the cover's own onAnimationComplete, which
  // framer-motion does not fire when the animation is interrupted — and an
  // incoming SCREEN_UPDATED re-render is enough to interrupt it. When it didn't
  // fire there was no other exit anywhere in this component (there is still no
  // other setCovering(null) call by design — this effect owns it), so the board
  // sat behind an opaque full-screen "Opening …" panel until a manual reload.
  const coverNavRef = useRef<string | null>(null);
  useEffect(() => {
    if (!covering) {
      coverNavRef.current = null;
      return;
    }
    if (coverNavRef.current === covering.screenId) return;
    coverNavRef.current = covering.screenId;
    const target = `/broadcast/live/${covering.screenId}`;
    const nav = window.setTimeout(() => router.push(target), COVER_SETTLE_MS);
    // The destination re-runs the expensive getExperiences() and has no
    // loading.tsx, so a slow or failed navigation is entirely possible. Hand
    // the board back rather than leaving the operator with a dead screen.
    const bail = window.setTimeout(() => setCovering(null), COVER_BAIL_MS);
    return () => {
      window.clearTimeout(nav);
      window.clearTimeout(bail);
    };
  }, [covering, router]);

  const scrollerRef = useRef<HTMLDivElement | null>(null);
  const slideRefs = useRef<Map<string, HTMLDivElement>>(new Map());
  /** Slides currently parked at the off-screen end state, so updateSlideTransforms
   *  can skip rewriting styles that would not change. */
  const parkedSlidesRef = useRef<Set<string>>(new Set());

  // The carousel's filters, as /api/media query params. Type/source/date are
  // applied by the server now rather than after the fetch — under keyset paging
  // a client-side filter would show an empty row whenever the first page
  // happened to contain no matches, while matches sat unfetched further down.
  const mediaQuery = useCallback(
    (extra?: Record<string, string>) => {
      const params = new URLSearchParams({
        // Only pushable file kinds ever become cards; the pasted-link kinds
        // (youtube/drive/link) have no real file behind them.
        types: mediaTypeFilter ? mediaTypeFilter : PUSHABLE_MEDIA_TYPES.join(","),
        ...extra,
      });
      if (emailOnly) params.set("sources", "email");
      if (mediaDateFrom) params.set("dateFrom", mediaDateFrom);
      if (mediaDateTo) params.set("dateTo", mediaDateTo);
      return params;
    },
    [mediaTypeFilter, emailOnly, mediaDateFrom, mediaDateTo],
  );

  /**
   * Load one keyset page. `cursor === null` starts a fresh walk (a filter
   * change, or "Load Email"); otherwise it appends the next page.
   *
   * Keyset rather than page/offset because rows are constantly inserted at the
   * HEAD of this list — Gmail ingest below, and any MEDIA_LIBRARY_UPDATED. An
   * offset window would shift under every such insert and the following page
   * would repeat or skip cards mid-scroll.
   */
  const loadMediaPage = useCallback(
    async (cursor: string | null) => {
      if (loadingMoreRef.current) return;
      loadingMoreRef.current = true;
      const seq = cursor === null ? ++requestSeqRef.current : requestSeqRef.current;
      if (cursor === null) setLoadingMedia(true);
      else setLoadingMore(true);

      try {
        const params = mediaQuery({ mode: "cursor", limit: "30" });
        if (cursor) params.set("cursor", cursor);
        const res = await fetch(`/api/media?${params.toString()}`);
        if (!res.ok) throw new Error(`media request failed: ${res.status}`);
        const data = (await res.json()) as {
          media?: MediaItem[];
          nextCursor?: string | null;
        };
        // A newer filter has already started its own walk — drop this page
        // rather than mixing two filters' rows into one carousel.
        if (seq !== requestSeqRef.current) return;

        const page = data.media ?? [];
        const cursorOut = data.nextCursor ?? null;
        setMediaItems((prev) => {
          // Append-and-dedupe: a row can legitimately arrive twice if it was
          // inserted above the cursor between two pages.
          const merged = cursor === null ? page : [...prev, ...page];
          const seen = new Set<string>();
          const deduped = merged.filter((m) =>
            seen.has(m.id) ? false : (seen.add(m.id), true),
          );
          saveSnapshot({ mediaItems: deduped, mediaNextCursor: cursorOut });
          return deduped;
        });
        setNextCursor(cursorOut);
        nextCursorRef.current = cursorOut;
      } catch (err) {
        console.error("Failed to load media for publish board:", err);
      } finally {
        loadingMoreRef.current = false;
        setLoadingMedia(false);
        setLoadingMore(false);
      }
    },
    [mediaQuery, saveSnapshot],
  );

  // Restart the walk whenever a media filter changes. Deliberately not keyed on
  // `filter`/`tagFilter` — those switch between the experience and media rows
  // and narrow experiences, neither of which changes the media query.
  //
  // The mount pass is skipped on a return visit: the snapshot already carries
  // the pages the user had scrolled through AND the cursor to continue from, so
  // refetching page 1 here would throw those away and strand the scroll restore
  // (which is waiting for exactly those cards) at the start of the list.
  const skipInitialLoadRef = useRef(restored.mediaItems !== null);
  useEffect(() => {
    if (skipInitialLoadRef.current) {
      skipInitialLoadRef.current = false;
      return;
    }
    void loadMediaPage(null);
  }, [loadMediaPage]);

  // Which media types exist under the current source/date filter, for the type
  // dropdown. Deliberately asks WITHOUT the type filter applied, or selecting
  // one type would collapse the dropdown to just that type.
  useEffect(() => {
    const params = new URLSearchParams();
    if (emailOnly) params.set("sources", "email");
    if (mediaDateFrom) params.set("dateFrom", mediaDateFrom);
    if (mediaDateTo) params.set("dateTo", mediaDateTo);
    let cancelled = false;
    fetch(`/api/media/stats?${params.toString()}`)
      .then((res) => (res.ok ? res.json() : null))
      .then((data: { byType?: { type: string }[] } | null) => {
        if (cancelled || !data?.byType) return;
        setPresentMediaTypes(data.byType.map((t) => t.type));
      })
      .catch(() => {
        // Non-fatal: the dropdown just keeps its previous options.
      });
    return () => {
      cancelled = true;
    };
  }, [emailOnly, mediaDateFrom, mediaDateTo]);

  // On-demand Gmail ingest — pulls the last 2 days of attachments/links into
  // media_asset, same action as the "Load Email" button on the Media Library
  // page (apps/cms/src/app/(dashboard)/media/page.tsx) — a plain refetch is
  // all that's needed here to show the new items.
  const [loadingInbox, setLoadingInbox] = useState(false);
  const handleLoadFromEmail = async () => {
    setLoadingInbox(true);
    try {
      const res = await fetch("/api/media/gmail/load", { method: "POST" });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.success)
        throw new Error(data.error ?? "Could not load email");
      // Restart the keyset walk from the top rather than appending: the new
      // items were inserted at the HEAD of the ordering, so they belong to
      // page 1 and no cursor further down would ever reach them.
      await loadMediaPage(null);
      // /api/media already returns newest-first, so the just-loaded items land
      // at the front of mediaItems/cards — but the scroller's pixel position
      // doesn't know that on its own, so without this it can keep showing
      // whatever was already centered instead of the new newest item.
      if (scrollerRef.current) scrollerRef.current.scrollLeft = 0;
      // ...and the snapshot must forget whichever card *was* centred, or a
      // later return visit would scroll back to it and undo this jump.
      saveSnapshot({ centredCardKey: null });
      setFeedback({ message: "Loaded new media from email", tone: "success" });
    } catch (err) {
      setFeedback({
        message: err instanceof Error ? err.message : "Could not load email",
        tone: "error",
      });
    } finally {
      setLoadingInbox(false);
    }
  };

  useEffect(() => {
    dispatch(screensHydrated(initialScreens));
  }, [dispatch, initialScreens]);

  // "Now showing" is kept correct by the store: StoreSync dispatches
  // screenContentUpdated for every SCREEN_UPDATED, so a reassignment from
  // anywhere else (another tab, the touch picker) lands here too — this
  // component no longer needs its own socket or its own copy of the mapping.

  useEffect(() => {
    if (!feedback) return;
    // A warning is the one banner that carries information the operator can't
    // get anywhere else on this page (the wall is dead), so it stays up long
    // enough to actually be read.
    const timer = setTimeout(
      () => setFeedback(null),
      feedback.tone === "warning" ? 6000 : 2500,
    );
    return () => clearTimeout(timer);
  }, [feedback]);

  // Everything the user picked, remembered for the trip to the live page and
  // back. The carousel position is saved separately, from the scroll handler.
  useEffect(() => {
    saveSnapshot({
      filter,
      tagFilter,
      experienceSearch,
      mediaTypeFilter,
      emailOnly,
      mediaDateFrom,
      mediaDateTo,
      targetIndex,
      groupFilter,
    });
  }, [
    groupFilter,
    filter,
    tagFilter,
    experienceSearch,
    mediaTypeFilter,
    emailOnly,
    mediaDateFrom,
    mediaDateTo,
    targetIndex,
    saveSnapshot,
  ]);

  // Only offer tags that actually have at least one experience — same
  // convention as experiences/_components/projects-list.tsx's category filter.
  const availableTags = useMemo(() => {
    const present = new Set(experiences.flatMap((e) => e.typeIds));
    return experienceTypes.filter((t) => present.has(t.id));
  }, [experiences, experienceTypes]);

  // Same "only offer what's actually present" convention, for media types.
  // presentMediaTypes comes from GET /api/media/stats under the current
  // source/date filter, so it covers the whole library rather than only the
  // keyset pages scrolled so far.
  const availableMediaTypes = useMemo(
    () =>
      presentMediaTypes
        .filter((t): t is MediaCardType => t in MEDIA_TYPE_LABELS)
        .map((t) => ({ type: t, label: MEDIA_TYPE_LABELS[t] })),
    [presentMediaTypes],
  );

  const searchQuery = experienceSearch.trim().toLowerCase();

  const cards = useMemo<ContentCard[]>(() => {
    const tagNames = new Map(experienceTypes.map((t) => [t.id, t.name.toLowerCase()]));
    const experienceCards: ContentCard[] = experiences
      .filter((e) => !tagFilter || e.typeIds.includes(tagFilter))
      .filter(
        (e) =>
          !searchQuery ||
          e.title.toLowerCase().includes(searchQuery) ||
          e.typeIds.some((id) => tagNames.get(id)?.includes(searchQuery))
      )
      .map((e) => ({
        id: e.id,
        type: "experience",
        title: e.title,
        thumbnail: e.coverImage,
        typeIds: e.typeIds,
      }));
    // No client-side type/source/date filtering here any more — mediaItems is
    // already the filtered result set, page by page, from the server.
    const mediaCards: ContentCard[] = mediaItems.map((m) => ({
      id: m.id,
      type: m.type as MediaCardType,
      title: m.name,
      // ponytail: For videos without a pre-generated thumbnail image, avoid passing original video .mp4 URL
      // to prevent Android WebView from mounting native <video> decoders across carousel slides.
      thumbnail: m.type === "video" ? (m.thumbnailUrl ?? null) : mediaThumbnailSrc(m),
      videoUrl: m.type === "video" ? m.url : undefined,
    }));
    return filter === "experiences" ? experienceCards : mediaCards;
  }, [experiences, experienceTypes, mediaItems, filter, tagFilter, searchQuery]);

  // Falls back to the first screen rather than null: targetIndex can be
  // restored from a previous mount, and the screens list is re-fetched by the
  // server on every visit, so a remembered index can outlive its screen.
  const targetScreen = screens[targetIndex] ?? screens[0] ?? null;

  // Only groups that have a screen in them; and "No group" only when some
  // screen is in none while others are grouped.
  const groupOptions = useMemo(() => {
    const used = new Set(screens.map((s) => s.groupId ?? UNGROUPED));
    const named = screenGroups.filter((g) => used.has(g.id));
    return named.length > 0 && used.has(UNGROUPED)
      ? [...named, { id: UNGROUPED, name: "No group" }]
      : named;
  }, [screens, screenGroups]);
  // A remembered group that's since been emptied or deleted means "all".
  const activeGroup = groupOptions.some((g) => g.id === groupFilter) ? groupFilter : null;
  const screensInGroup = useMemo(
    () => (activeGroup ? screens.filter((s) => (s.groupId ?? UNGROUPED) === activeGroup) : screens),
    [screens, activeGroup],
  );
  const pickGroup = (id: string | null) => {
    setGroupFilter(id);
    // Keep the screen if it's in the group; otherwise move to the group's first.
    const inGroup = id ? screens.filter((s) => (s.groupId ?? UNGROUPED) === id) : screens;
    if (targetScreen && inGroup.some((s) => s.screenId === targetScreen.screenId)) return;
    const first = inGroup[0];
    if (first) setTargetIndex(screens.findIndex((s) => s.screenId === first.screenId));
  };

  /** The slide wearing the "this is what a swipe publishes" glow. */
  const centredKeyRef = useRef<string | null>(null);

  /** Caches static layout centers (offsetLeft + offsetWidth / 2) so scroll frames do not force DOM layout reads per card. */
  const cachedCentersRef = useRef<Map<string, number>>(new Map());

  const setSlideRef = useCallback((key: string, el: HTMLDivElement | null) => {
    if (el) {
      slideRefs.current.set(key, el);
    } else {
      slideRefs.current.delete(key);
      cachedCentersRef.current.delete(key);
      // Drop the parked mark with the element. A key that came back later
      // (after a filter switch, say) would otherwise be skipped by
      // updateSlideTransforms while its fresh element still had no transform.
      parkedSlidesRef.current.delete(key);
    }
  }, []);

  // Coverflow effect: scale/nudge/fade each slide by its live distance from
  // the scroller's horizontal center — the centered card sits at full size,
  // neighbors shrink and nudge in slightly, staying individually visible and
  // tappable rather than stacking behind the center card. Writes style
  // directly (no React state) so it stays smooth at scroll-event frequency.
  const updateSlideTransforms = useCallback(() => {
    const scroller = scrollerRef.current;
    if (!scroller) return;
    const viewportCenter = scroller.clientWidth / 2;
    const scrollLeft = scroller.scrollLeft;
    // Whichever card ends up nearest the centre is also the one to scroll back
    // to on a return visit — recorded here rather than in a separate pass
    // because this already walks every slide measuring exactly that distance.
    let nearestKey: string | null = null;
    let nearestDistance = Infinity;

    // ponytail: Cached static layout centers reduce per-frame DOM layout reads from 2N to 1 during scroll.
    const measured: { el: HTMLDivElement; key: string; offset: number }[] = [];
    const centers = cachedCentersRef.current;
    slideRefs.current.forEach((el, key) => {
      let center = centers.get(key);
      if (center === undefined) {
        center = el.offsetLeft + el.offsetWidth / 2;
        centers.set(key, center);
      }
      const elCenterInViewport = center - scrollLeft;
      const offset = (elCenterInViewport - viewportCenter) / viewportCenter;
      measured.push({ el, key, offset });
      const distance = Math.abs(offset);
      if (distance < nearestDistance) {
        nearestDistance = distance;
        nearestKey = key;
      }
    });

    for (const { el, key, offset } of measured) {
      const clamped = Math.max(-1.4, Math.min(1.4, offset));
      const proximity = Math.min(Math.abs(clamped), 1);
      // Skip writing to slides whose style can no longer change, so per-frame
      // work stays proportional to the few cards on screen rather than to every
      // page loaded so far.
      const parked = Math.abs(offset) >= 1.4;
      if (parked && parkedSlidesRef.current.has(key)) continue;
      if (parked) parkedSlidesRef.current.add(key);
      else parkedSlidesRef.current.delete(key);

      const scale = 1 - proximity * 0.35;
      const nudge = -clamped * 18;
      // ponytail: translate3d forces hardware GPU layer promotion on Android WebView,
      // preventing main-thread re-rasterization on scroll frames.
      el.style.transform = `translate3d(${nudge}px, 0px, 0px) scale(${scale})`;
      el.style.opacity = String(1 - proximity * 0.35);
      const nextZ = String(5 - Math.round(proximity * 5));
      if (el.style.zIndex !== nextZ) {
        el.style.zIndex = nextZ;
      }
    }

    if (nearestKey && nearestKey !== centredKeyRef.current) {
      if (centredKeyRef.current) slideRefs.current.get(centredKeyRef.current)?.removeAttribute("data-centred");
      slideRefs.current.get(nearestKey)?.setAttribute("data-centred", "true");
      centredKeyRef.current = nearestKey;
    }
    if (nearestKey) saveSnapshot({ centredCardKey: nearestKey });
  }, [saveSnapshot]);

  /**
   * Pull the next keyset page when the scroller nears its right-hand end.
   *
   * Deliberately folded into the existing rAF-throttled scroll pass rather than
   * given its own listener: one handler, one measurement, one frame budget.
   * loadingMoreRef (not the loadingMore state) is the guard so a single scroll
   * burst can't fire several overlapping requests before the first resolves.
   */
  const maybeLoadMore = useCallback(
    (scroller: HTMLDivElement) => {
      if (loadingMoreRef.current || !nextCursorRef.current) return;
      // Roughly five cards' width of runway, so the next page is in flight
      // before the user reaches the end rather than after.
      const runway = 5 * 384;
      const remaining =
        scroller.scrollWidth - scroller.scrollLeft - scroller.clientWidth;
      if (remaining <= runway) void loadMediaPage(nextCursorRef.current);
    },
    [loadMediaPage],
  );

  useEffect(() => {
    const scroller = scrollerRef.current;
    if (!scroller) return;
    // The card set just changed, so every slide needs one unconditional styling
    // pass before the skip-if-parked optimisation can be trusted again.
    parkedSlidesRef.current.clear();
    cachedCentersRef.current.clear();
    centredKeyRef.current = null;
    updateSlideTransforms();

    let ticking = false;
    const onScroll = () => {
      if (ticking) return;
      ticking = true;
      requestAnimationFrame(() => {
        ticking = false;
        updateSlideTransforms();
        maybeLoadMore(scroller);
      });
    };
    const onResize = () => {
      cachedCentersRef.current.clear();
      onScroll();
    };
    // A plain mouse wheel only ever generates vertical delta, and this row has
    // no vertical overflow to scroll — redirect it to horizontal so a normal
    // mouse (not just touch/trackpad swipes) can browse the carousel too.
    const onWheel = (e: WheelEvent) => {
      if (Math.abs(e.deltaY) <= Math.abs(e.deltaX)) return;
      e.preventDefault();
      scroller.scrollLeft += e.deltaY;
    };
    scroller.addEventListener("scroll", onScroll, { passive: true });
    scroller.addEventListener("wheel", onWheel, { passive: false });
    window.addEventListener("resize", onResize);
    return () => {
      scroller.removeEventListener("scroll", onScroll);
      scroller.removeEventListener("wheel", onWheel);
      window.removeEventListener("resize", onResize);
    };
  }, [cards, updateSlideTransforms, maybeLoadMore]);

  /** Guards the one-shot carousel restore below against running twice, and
   *  against running at all once the user has moved the carousel themselves. */
  const scrollRestoredRef = useRef(false);
  /** The filter-reset effect below must skip its own mount invocation — that
   *  first pass belongs to the restore, not to a real filter change. */
  const filterResetArmedRef = useRef(false);

  // Put the carousel back on the card the user was last looking at. Deferred
  // until there are cards to scroll to: on a first visit to /broadcast with
  // filter === "media", they only arrive once /api/media resolves (a return
  // visit has them on the first frame, seeded from the snapshot).
  useIsomorphicLayoutEffect(() => {
    if (scrollRestoredRef.current || cards.length === 0) return;
    scrollRestoredRef.current = true;
    const el = restored.centredCardKey
      ? slideRefs.current.get(restored.centredCardKey)
      : null;
    if (!el) return;
    // "instant" because the scroller carries `scroll-smooth` — the default
    // would animate all the way across from the far left instead of just
    // starting where the user left off.
    el.scrollIntoView({
      behavior: "instant",
      inline: "center",
      block: "nearest",
    });
    updateSlideTransforms();
  }, [cards, restored.centredCardKey, updateSlideTransforms]);

  // The Media page's board: centre the item it was opened on. It may be
  // further down than the first page, so keep paging until it arrives (or the
  // list ends, when the carousel just stays at the start).
  const focusDoneRef = useRef(false);
  const focusPagesRef = useRef(0);
  useIsomorphicLayoutEffect(() => {
    if (!focusMedia || focusDoneRef.current || loadingMedia || cards.length === 0) return;
    const el = slideRefs.current.get(
      [...slideRefs.current.keys()].find((k) => k.endsWith(`:${focusMedia.id}`)) ?? "",
    );
    if (el) {
      focusDoneRef.current = true;
      el.scrollIntoView({ behavior: "instant", inline: "center", block: "nearest" });
      updateSlideTransforms();
      return;
    }
    if (!nextCursor || focusPagesRef.current >= FOCUS_MAX_PAGES) {
      focusDoneRef.current = true;
      return;
    }
    if (!loadingMore) {
      focusPagesRef.current += 1;
      void loadMediaPage(nextCursor);
    }
  }, [cards, focusMedia, loadingMedia, loadingMore, nextCursor, loadMediaPage, updateSlideTransforms]);

  // Only an explicit filter (or tag/media-type) switch should jump the
  // carousel back to the start — publishing a card, a screen-sync update,
  // etc. must never reset scroll position (cards itself doesn't change from
  // those, but nothing here should assume that and reset on its account
  // either). The mount pass is skipped for the same reason: it isn't a switch,
  // it's where a remembered position gets restored above.
  useEffect(() => {
    if (!filterResetArmedRef.current) {
      filterResetArmedRef.current = true;
      return;
    }
    // A real filter switch also cancels a restore still waiting on its cards,
    // so it can't fire later and undo this jump.
    scrollRestoredRef.current = true;
    focusDoneRef.current = true;
    const scroller = scrollerRef.current;
    if (scroller) scroller.scrollLeft = 0;
  }, [
    filter,
    tagFilter,
    searchQuery,
    mediaTypeFilter,
    emailOnly,
    mediaDateFrom,
    mediaDateTo,
  ]);

  // Click-and-drag with a mouse to browse the carousel. Touch/trackpad users
  // already get native panning (touchAction: "pan-x" on each card below), but
  // a mouse has no native way to drag-scroll a div, so it's wired up by hand
  // here — gated to pointerType "mouse" only so touch/pen keep using the
  // native path instead of being double-driven by both at once.
  useEffect(() => {
    const scroller = scrollerRef.current;
    if (!scroller) return;
    let dragging = false;
    let startX = 0;
    let startScrollLeft = 0;
    /** Pending "drop the smooth-scroll override" timer, if a settle is running. */
    let settleTimer: number | undefined;

    const onPointerDown = (e: PointerEvent) => {
      if (e.pointerType !== "mouse") return;
      dragging = true;
      startX = e.clientX;
      startScrollLeft = scroller.scrollLeft;
      scroller.style.cursor = "grabbing";
      // Mandatory snap keeps pulling toward a snap point while this handler
      // writes scrollLeft underneath it, which makes a hand drag feel sticky
      // and steppy. Suspended for the drag only; stopDragging restores it so
      // releasing still settles onto a card, and wheel/touch keep snapping.
      scroller.style.scrollSnapType = "none";
      // Cancel any settle animation still running from the previous release —
      // otherwise this drag would be animated rather than tracking 1:1.
      if (settleTimer !== undefined) {
        window.clearTimeout(settleTimer);
        settleTimer = undefined;
      }
      scroller.style.scrollBehavior = "";
      // Stops the browser starting a native image drag-ghost when the press
      // lands on a thumbnail <img>, without affecting SwipeCard's own
      // pointerdown-driven vertical drag (preventDefault here doesn't stop
      // the event from also reaching that separate listener).
      e.preventDefault();
    };
    const onPointerMove = (e: PointerEvent) => {
      if (!dragging) return;
      scroller.scrollLeft = startScrollLeft - (e.clientX - startX);
    };
    const stopDragging = () => {
      // Cursor and snapping are restored on every path below — a pointercancel
      // can arrive without a matching move, and leaving snapping switched off
      // would silently disable it for the rest of the session. Both writes are
      // idempotent, so running them on a non-drag pointerup costs nothing.
      const wasDragging = dragging;
      dragging = false;
      scroller.style.cursor = "";

      // The smooth settle only belongs to a real drag. This runs on every
      // window pointerup — including a plain tap on a card to publish it — and
      // leaving scroll-behavior:smooth armed after those would make an
      // immediately following wheel scroll feel laggy for no reason. Snapping
      // is still restored here, idempotently, so it can never stay disabled.
      if (!wasDragging) {
        scroller.style.scrollSnapType = "";
        return;
      }

      // Order matters: restoring snap is what triggers the re-snap, and this
      // scroller's scroll-behavior is `auto` (see className), so smooth has to
      // be in place BEFORE snapping comes back or the card teleports to centre
      // instead of settling. Dropped again once the settle has run, so the next
      // drag still tracks the pointer exactly.
      scroller.style.scrollBehavior = "smooth";
      scroller.style.scrollSnapType = "";
      settleTimer = window.setTimeout(() => {
        scroller.style.scrollBehavior = "";
        settleTimer = undefined;
      }, 400);
    };

    scroller.addEventListener("pointerdown", onPointerDown);
    window.addEventListener("pointermove", onPointerMove);
    window.addEventListener("pointerup", stopDragging);
    window.addEventListener("pointercancel", stopDragging);
    return () => {
      if (settleTimer !== undefined) window.clearTimeout(settleTimer);
      scroller.removeEventListener("pointerdown", onPointerDown);
      window.removeEventListener("pointermove", onPointerMove);
      window.removeEventListener("pointerup", stopDragging);
      window.removeEventListener("pointercancel", stopDragging);
    };
  }, []);

  // Explicit prev/next controls — a guaranteed way to move between cards
  // regardless of input device (mouse with no trackpad, no touch, etc.),
  // finding whichever slide is currently nearest-center and stepping from it.
  const scrollToAdjacentCard = useCallback(
    (direction: 1 | -1) => {
      const scroller = scrollerRef.current;
      if (!scroller || cards.length === 0) return;
      const rect = scroller.getBoundingClientRect();
      const centerX = rect.left + rect.width / 2;
      let activeIndex = 0;
      let smallestOffset = Infinity;
      cards.forEach((card, i) => {
        const el = slideRefs.current.get(`${card.type}:${card.id}`);
        if (!el) return;
        const elRect = el.getBoundingClientRect();
        const offset = Math.abs(elRect.left + elRect.width / 2 - centerX);
        if (offset < smallestOffset) {
          smallestOffset = offset;
          activeIndex = i;
        }
      });
      const nextCard =
        cards[Math.max(0, Math.min(cards.length - 1, activeIndex + direction))];
      if (!nextCard) return;
      slideRefs.current.get(`${nextCard.type}:${nextCard.id}`)?.scrollIntoView({
        behavior: "smooth",
        inline: "center",
        block: "nearest",
      });
    },
    [cards],
  );

  const triggerPublish = useCallback(
    (card: ContentCard) => {
      if (!targetScreen) return;
      const { screenId, screenName } = targetScreen;

      // Pushing content that's already live on this screen is a no-op on the
      // real device — its player dedupes by content key and never reloads
      // (see useContentPreloader). Skip the redundant DB write/broadcast and
      // the "opening" landing animation (nothing is actually landing), but
      // still take the user to the live control page like any other publish
      // — its mirror now replays the screen's real current state correctly
      // (see replayable-window-event.ts), so there's no reset-to-overview
      // flash to avoid anymore.
      const alreadyShowing =
        card.type === "experience"
          ? targetScreen.currentContentKind === "experience" &&
            targetScreen.currentExperienceId === card.id
          : targetScreen.currentContentKind === "media" &&
            targetScreen.currentMediaAssetId === card.id;
      if (alreadyShowing) {
        setFeedback({
          message: `"${card.title}" is already showing on ${screenName}`,
          tone: "success",
        });
        window.setTimeout(
          () => setCovering({ screenId, screenName }),
          CARD_RESET_MS,
        );
        return;
      }

      setPushingId(card.id);
      // Snapshot for the rollback in the catch below. Taken before the
      // optimistic dispatch, and deliberately a copy — the row in the store is
      // about to be mutated in place by the reducer.
      const priorRow = { ...targetScreen };
      // Optimistic update so the box's "now showing" line reflects the push
      // immediately. Same reducer the WebSocket echo uses, so the mapping from
      // content to row lives in exactly one place now.
      dispatch(
        screenContentUpdated(
          card.type === "experience"
            ? { screenId, kind: "experience", id: card.id, title: card.title }
            : {
                screenId,
                kind: "media",
                id: card.id,
                title: card.title,
                mediaType: card.type,
                mediaUrl: card.thumbnail,
              },
        ),
      );
      // The screen "opening" as the swiped content lands on it.
      void boxControls.start({
        scale: [1, 1.035, 1],
        transition: { duration: 0.45, ease: "easeOut" },
      });
      (async () => {
        try {
          const result =
            card.type === "experience"
              ? await assignExperience(screenId, card.id)
              : await assignMedia(screenId, card.id);
          // The push can succeed at every layer — DB written, broadcast sent —
          // and still change nothing, because the panel's page died and never
          // reconnected. The optimistic dispatch above has already moved this
          // board's "now showing" line, so without this the operator has no way
          // to tell a live wall from a dead one.
          setFeedback(
            result.players === 0
              ? {
                  message: `Pushed "${card.title}", but no display is connected to ${screenName}`,
                  tone: "warning",
                }
              : {
                  message: `Pushed "${card.title}" to ${screenName}`,
                  tone: "success",
                },
          );
          // Delayed to match SwipeCard's own local fly-off/reset timeout
          // (CARD_RESET_MS) below — otherwise a fast response can start the
          // full-screen cover while the card is still mid-animation.
          window.setTimeout(
            () => setCovering({ screenId, screenName }),
            CARD_RESET_MS,
          );
        } catch (err) {
          console.error("Failed to push content:", err);
          // Undo the optimistic write. Without this the row keeps claiming the
          // card is live, and the `alreadyShowing` guard above then short-
          // circuits every retry — the card becomes permanently unpublishable
          // until a real SCREEN_UPDATED or a full reload corrects the row.
          dispatch(screenRowRestored(priorRow));
          setFeedback({
            message: `Failed to push "${card.title}" to ${screenName}`,
            tone: "error",
          });
        } finally {
          setPushingId(null);
        }
      })();
    },
    [targetScreen, boxControls],
  );

  return (
    <div className="relative flex flex-1 min-h-0 flex-col gap-4 p-4 select-none">
      {/* Publish target: a group, then a screen in it. */}
      <div className="flex shrink-0 items-center gap-2">
        {groupOptions.length > 0 && (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button
                type="button"
                aria-label="Screen group"
                className={`flex h-12 max-w-[40%] shrink-0 items-center gap-2 rounded-xl border px-4 text-sm font-semibold uppercase tracking-wide shadow-[var(--card-shadow)] transition-colors hover:border-primary/50 ${activeGroup ? "border-primary/50 bg-card text-primary-ink" : "bg-card text-card-foreground"}`}
              >
                <Layers className="h-4 w-4 shrink-0" />
                <span className="truncate">
                  {activeGroup ? groupOptions.find((g) => g.id === activeGroup)?.name : "All screens"}
                </span>
                <ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground" />
              </button>
            </DropdownMenuTrigger>
            {/* z-[300]: above the carousel's centred card (inline z-index up to 5). */}
            <DropdownMenuContent align="start" className="z-[300] max-h-[60vh] min-w-56 overflow-y-auto">
              {[{ id: null as string | null, name: "All screens" }, ...groupOptions].map((g) => {
                const count = g.id ? screens.filter((s) => (s.groupId ?? UNGROUPED) === g.id).length : screens.length;
                return (
                  <DropdownMenuItem
                    key={g.id ?? "all"}
                    onSelect={() => pickGroup(g.id)}
                    className="flex cursor-pointer items-center gap-3 py-2"
                  >
                    <span className="min-w-0 flex-1 truncate text-sm font-semibold uppercase tracking-wide">{g.name}</span>
                    <span className="shrink-0 text-xs tabular-nums text-muted-foreground">{count}</span>
                    {activeGroup === g.id ? <Check className="h-4 w-4 shrink-0 text-primary-ink" /> : <span className="w-4 shrink-0" />}
                  </DropdownMenuItem>
                );
              })}
            </DropdownMenuContent>
          </DropdownMenu>
        )}
        <DropZone
          screen={targetScreen}
          screens={screensInGroup}
          activeScreenIds={activeScreenIds}
          onPick={(screenId) => {
            const i = screens.findIndex((s) => s.screenId === screenId);
            if (i >= 0) setTargetIndex(i);
          }}
          isPushing={pushingId !== null}
          controls={boxControls}
        />
      </div>

      {/* Feedback banner / gesture hint */}
      <div className="flex h-6 shrink-0 items-center justify-center">
        {feedback ? (
          <span
            className={`rounded-full px-3 py-1 text-xs font-semibold ${
              feedback.tone === "success"
                ? "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400"
                : feedback.tone === "warning"
                  ? "bg-amber-500/10 text-amber-600 dark:text-amber-400"
                  : "bg-red-500/10 text-red-600 dark:text-red-400"
            }`}
          >
            {feedback.message}
          </span>
        ) : (
          <span className="text-[10px] font-semibold uppercase tracking-widest text-zinc-400 dark:text-zinc-600">
            Swipe left/right to browse • hold and swipe up to publish
          </span>
        )}
      </div>

      {/* Filter (left) + Load from email (right). */}
      <div className="flex shrink-0 items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-2">
          {focusMedia ? (
            <button
              type="button"
              onClick={focusMedia.onBack}
              className="flex items-center gap-1.5 rounded-full btn-active px-4 py-1.5 text-xs uppercase tracking-wider transition-colors"
            >
              <ChevronLeft className="h-3.5 w-3.5" />
              All media
            </button>
          ) : (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button
                type="button"
                className="flex items-center gap-1.5 rounded-full btn-active px-4 py-1.5 text-xs uppercase tracking-wider transition-colors"
              >
                {FILTER_LABELS[filter]}
                <ChevronDown className="h-3.5 w-3.5" />
              </button>
            </DropdownMenuTrigger>
            {/* z-[300]: the coverflow effect above gives the centered card an
              inline z-index up to 5 (updateSlideTransforms) — this must
              always outrank that or cards poke over the open menu. */}
            <DropdownMenuContent align="start" className="z-[300]">
              {(["experiences", "media"] as const).map((key) => (
                <DropdownMenuItem
                  key={key}
                  className="cursor-pointer text-xs font-semibold uppercase tracking-wider"
                  onSelect={() => {
                    setFilter(key);
                    if (key !== "experiences") {
                      setTagFilter(null);
                      setExperienceSearch("");
                    }
                    if (key !== "media") {
                      setMediaTypeFilter(null);
                      setEmailOnly(false);
                      setMediaDateFrom("");
                      setMediaDateTo("");
                    }
                  }}
                >
                  {FILTER_LABELS[key]}
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
          )}

          {/* Second-level filter — only once "Experiences" is picked, and only
            offering tags that at least one experience actually has. */}
          {filter === "experiences" && availableTags.length > 0 && (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button
                  type="button"
                  className="flex items-center gap-1.5 btn-surface rounded-full px-4 py-1.5 text-xs uppercase tracking-wider transition-colors"
                >
                  {tagFilter
                    ? (availableTags.find((t) => t.id === tagFilter)?.name ??
                      "Tag")
                    : "All tags"}
                  <ChevronDown className="h-3.5 w-3.5" />
                </button>
              </DropdownMenuTrigger>
              {/* z-[300]: the coverflow effect above gives the centered card an
              inline z-index up to 5 (updateSlideTransforms) — this must
              always outrank that or cards poke over the open menu. */}
              <DropdownMenuContent align="start" className="z-[300]">
                <DropdownMenuItem
                  className="cursor-pointer text-xs font-semibold uppercase tracking-wider"
                  onSelect={() => setTagFilter(null)}
                >
                  All tags
                </DropdownMenuItem>
                {availableTags.map((tag) => (
                  <DropdownMenuItem
                    key={tag.id}
                    className="cursor-pointer text-xs font-semibold uppercase tracking-wider"
                    onSelect={() => setTagFilter(tag.id)}
                  >
                    {tag.name}
                  </DropdownMenuItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>
          )}

          {/* Search — narrows experiences by title or tag name. */}
          {filter === "experiences" && (
            <div className="relative flex items-center">
              <Search className="pointer-events-none absolute left-3 h-3.5 w-3.5 text-muted-foreground" />
              <input
                type="search"
                value={experienceSearch}
                onChange={(e) => setExperienceSearch(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Escape") setExperienceSearch("");
                }}
                placeholder="Search portfolio"
                aria-label="Search portfolio"
                className="h-8 w-44 rounded-full border border-border bg-card pl-8 pr-8 text-xs text-foreground placeholder:text-muted-foreground outline-none transition-[width,border-color] focus:w-60 focus:border-ring sm:w-56 sm:focus:w-72 [&::-webkit-search-cancel-button]:hidden"
              />
              {experienceSearch && (
                <button
                  type="button"
                  onClick={() => setExperienceSearch("")}
                  aria-label="Clear search"
                  className="absolute right-2 rounded-full p-0.5 text-muted-foreground hover:text-foreground"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              )}
            </div>
          )}

          {/* Second-level filter — only once "Media" is picked, and only
            offering types that are actually present (Video, Image, PDF, ...). */}
          {filter === "media" && availableMediaTypes.length > 0 && (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button
                  type="button"
                  className="flex items-center gap-1.5 btn-surface rounded-full px-4 py-1.5 text-xs uppercase tracking-wider transition-colors"
                >
                  {mediaTypeFilter
                    ? MEDIA_TYPE_LABELS[mediaTypeFilter]
                    : "All types"}
                  <ChevronDown className="h-3.5 w-3.5" />
                </button>
              </DropdownMenuTrigger>
              {/* z-[300]: the coverflow effect above gives the centered card an
              inline z-index up to 5 (updateSlideTransforms) — this must
              always outrank that or cards poke over the open menu. */}
              <DropdownMenuContent align="start" className="z-[300]">
                <DropdownMenuItem
                  className="cursor-pointer text-xs font-semibold uppercase tracking-wider"
                  onSelect={() => setMediaTypeFilter(null)}
                >
                  All types
                </DropdownMenuItem>
                {availableMediaTypes.map(({ type, label }) => (
                  <DropdownMenuItem
                    key={type}
                    className="cursor-pointer text-xs font-semibold uppercase tracking-wider"
                    onSelect={() => setMediaTypeFilter(type)}
                  >
                    {label}
                  </DropdownMenuItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>
          )}

          {/* Third-level filter — a single range-select calendar, not two
              separate date inputs (unlike the Media Library page's picker). */}
          {filter === "media" && (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button
                  type="button"
                  className={`flex items-center gap-1.5 rounded-full px-4 py-1.5 text-xs uppercase tracking-wider transition-colors ${
                    mediaDateFrom || mediaDateTo
                      ? "btn-active"
                      : "btn-surface"
                  }`}
                >
                  <CalendarRange className="h-3.5 w-3.5" />
                  {!mediaDateFrom && !mediaDateTo
                    ? "Date Range"
                    : mediaDateFrom && mediaDateTo
                      ? `${mediaDateFrom} → ${mediaDateTo}`
                      : mediaDateFrom
                        ? `From ${mediaDateFrom}`
                        : `Until ${mediaDateTo}`}
                  <ChevronDown className="h-3.5 w-3.5" />
                </button>
              </DropdownMenuTrigger>
              {/* z-[300]: the coverflow effect above gives the centered card an
              inline z-index up to 5 (updateSlideTransforms) — this must
              always outrank that or cards poke over the open menu. */}
              <DropdownMenuContent align="start" className="z-[300] p-3">
                <DateRangeCalendar
                  from={mediaDateFrom}
                  to={mediaDateTo}
                  onChange={(from, to) => {
                    setMediaDateFrom(from);
                    setMediaDateTo(to);
                  }}
                />
              </DropdownMenuContent>
            </DropdownMenu>
          )}
        </div>

        <div className="flex items-center gap-2">
          {/* Source filter — only meaningful while actually browsing media. */}
          {filter === "media" && (
            <button
              type="button"
              onClick={() => setEmailOnly((v) => !v)}
              aria-pressed={emailOnly}
              title={
                emailOnly
                  ? "Showing only media from email — click to show all"
                  : "Show only media that came in from email"
              }
              className={`flex items-center gap-1.5 rounded-full px-4 py-1.5 text-xs uppercase tracking-wider transition-colors ${
                emailOnly
                  ? "btn-active"
                  : "btn-surface"
              }`}
            >
              {emailOnly ? (
                <Check className="h-3.5 w-3.5" />
              ) : (
                <Mail className="h-3.5 w-3.5" />
              )}
              From Email
            </button>
          )}

          <button
            type="button"
            onClick={handleLoadFromEmail}
            disabled={loadingInbox}
            title="Load last 2 days from email"
            className="flex items-center gap-1.5 btn-surface rounded-full px-4 py-1.5 text-xs uppercase tracking-wider transition-colors disabled:cursor-not-allowed disabled:opacity-50"
          >
            <RefreshCw
              className={`h-3.5 w-3.5 ${loadingInbox ? "animate-spin" : ""}`}
            />
            {loadingInbox ? "Loading…" : "Load Email"}
          </button>
        </div>
      </div>

      {/* Content carousel */}
      <div className="flex min-h-0 flex-1 flex-col gap-2">
        {loadingMedia && filter !== "experiences" && cards.length === 0 ? (
          <div className="flex items-center justify-center gap-2 py-16 text-sm text-zinc-400">
            <Loader2 className="h-4 w-4 animate-spin" /> Loading content…
          </div>
        ) : cards.length === 0 ? (
          <div className="flex flex-col items-center justify-center gap-2 py-16 text-center">
            <Layers className="h-8 w-8 text-zinc-400" />
            <p className="text-sm text-zinc-400">
              {filter === "experiences" && searchQuery
                ? `Nothing in the portfolio matches "${experienceSearch.trim()}".`
                : "No content to publish yet."}
            </p>
          </div>
        ) : (
          <>
            <div
              ref={scrollerRef}
              // Deliberately NO `scroll-smooth`. Setting scrollLeft counts as a
              // scrolling API call, so with scroll-behavior:smooth the browser
              // ANIMATES it — and both the drag handler and the wheel handler
              // below assign scrollLeft on every event. Each one kicked off a
              // new easing animation that the next immediately interrupted, so
              // the carousel was permanently easing toward a target that had
              // already moved and could never track the cursor.
              //
              // Nothing loses smoothness: the two programmatic scrolls that
              // want it ask for it themselves — scrollToAdjacentCard passes
              // behavior:"smooth", and the position restore passes
              // behavior:"instant" precisely to opt out of this class.
              className="no-scrollbar relative flex min-h-0 flex-1 cursor-grab items-center gap-1 overflow-x-auto overflow-y-visible snap-x snap-mandatory"
              style={{
                paddingLeft: "calc(50% - 12rem)",
                paddingRight: "calc(50% - 12rem)",
              }}
            >
              {cards.map((card) => {
                const key = `${card.type}:${card.id}`;
                return (
                  <div
                    key={key}
                    ref={(el) => setSlideRef(key, el)}
                    className="group/slide w-96 shrink-0 snap-center"
                  >
                    <SwipeCard
                      card={card}
                      pushing={pushingId === card.id}
                      onPublish={triggerPublish}
                    />
                  </div>
                );
              })}
              {/* Tail spinner for the next keyset page. Rendered inside the
                  scroller so it occupies real width — that keeps the runway
                  maybeLoadMore measures against from collapsing the moment the
                  last card is reached. Not registered as a slide, so the
                  coverflow pass ignores it. */}
              {loadingMore && filter !== "experiences" && (
                <div className="flex w-48 shrink-0 items-center justify-center">
                  <Loader2 className="h-5 w-5 animate-spin text-zinc-400" />
                </div>
              )}
            </div>

            <div className="flex shrink-0 items-center justify-center gap-4">
              <button
                type="button"
                onClick={() => scrollToAdjacentCard(-1)}
                aria-label="Previous card"
                className="flex h-10 w-10 items-center justify-center rounded-full btn-surface transition-colors"
              >
                <ChevronLeft className="h-5 w-5" />
              </button>
              <button
                type="button"
                onClick={() => scrollToAdjacentCard(1)}
                aria-label="Next card"
                className="flex h-10 w-10 items-center justify-center rounded-full btn-surface transition-colors"
              >
                <ChevronRight className="h-5 w-5" />
              </button>
            </div>
          </>
        )}
      </div>

      {covering && (
        <motion.div
          initial={{ y: "100%" }}
          animate={{ y: 0 }}
          transition={{ duration: 0.45, ease: [0.16, 1, 0.3, 1] }}
          className="absolute inset-0 z-[200] flex items-center justify-center bg-zinc-950"
        >
          <span className="text-sm font-bold uppercase tracking-widest text-white/70">
            Opening {covering.screenName}…
          </span>
        </motion.div>
      )}
    </div>
  );
}

function DropZone({
  screen,
  screens,
  activeScreenIds,
  onPick,
  isPushing,
  controls,
}: {
  screen: ScreenRow | null;
  screens: ScreenRow[];
  /** Connected displays — a screen not in here means a push lands nowhere. */
  activeScreenIds: string[];
  onPick: (screenId: string) => void;
  isPushing: boolean;
  controls: ReturnType<typeof useAnimation>;
}) {
  const isOnline = screen ? activeScreenIds.includes(screen.screenId) : false;
  return (
    <motion.div animate={controls} className="w-full flex-1">
      <DropdownMenu>
        <DropdownMenuTrigger asChild disabled={screens.length === 0}>
          <button
            type="button"
            aria-label={screen ? `Publishing to ${screen.screenName}. Choose another screen` : "No screens"}
            className="flex h-12 w-full items-center justify-between gap-3 rounded-xl border bg-card px-4 text-left text-card-foreground shadow-[var(--card-shadow)] transition-colors hover:border-primary/50 disabled:cursor-default"
                >
            <span className="flex min-w-0 items-center gap-2">
              {screen && (
                <span
                  title={isOnline ? "Display connected" : "No display connected"}
                  className={`h-2 w-2 shrink-0 rounded-full ${
                    isOnline ? "bg-emerald-400" : "bg-amber-400"
                  }`}
                />
              )}
              <span className="truncate text-sm font-bold uppercase tracking-wide text-card-foreground">
                {screen ? screen.screenName : "No screens registered yet"}
              </span>
            </span>
            <span className="flex min-w-0 items-center gap-2">
              {screen && (
                <span className="min-w-0 truncate text-xs text-muted-foreground">
                  {isPushing
                    ? "Publishing…"
                    : isOnline
                      ? currentLabel(screen)
                      : "Offline — nothing will change on the wall"}
                </span>
              )}
              {screens.length > 0 && <ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground" />}
            </span>
          </button>
        </DropdownMenuTrigger>
        {/* z-[300]: above the carousel's centred card (inline z-index up to 5). */}
        <DropdownMenuContent
          align="start"
          className="z-[300] max-h-[60vh] w-[var(--radix-dropdown-menu-trigger-width)] overflow-y-auto"
        >
          {screens.map((s) => {
            const online = activeScreenIds.includes(s.screenId);
            const picked = s.screenId === screen?.screenId;
            return (
              <DropdownMenuItem
                key={s.screenId}
                onSelect={() => onPick(s.screenId)}
                className="flex cursor-pointer items-center gap-3 py-2"
              >
                <span
                  title={online ? "Display connected" : "No display connected"}
                  className={`h-2 w-2 shrink-0 rounded-full ${online ? "bg-emerald-400" : "bg-amber-400"}`}
                />
                <span className="min-w-0 flex-1 truncate text-sm font-semibold uppercase tracking-wide">{s.screenName}</span>
                <span className="max-w-[45%] shrink-0 truncate text-xs text-muted-foreground">
                  {online ? currentLabel(s) : "Offline"}
                </span>
                {picked ? <Check className="h-4 w-4 shrink-0 text-primary-ink" /> : <span className="w-4 shrink-0" />}
              </DropdownMenuItem>
            );
          })}
        </DropdownMenuContent>
      </DropdownMenu>
    </motion.div>
  );
}

/**
 * The swipe is a local gesture only. It used to stream PUBLISH_DRAG_* commands
 * to the target screen so the TV could mirror the operator's finger live, but
 * that rise competed with the content's own push-up transition and had to
 * suppress it. The TV now stays on the current content until the push lands and
 * then plays the standard slide, so there is nothing to broadcast mid-drag.
 */
function SwipeCard({
  card,
  pushing,
  onPublish,
}: {
  card: ContentCard;
  pushing?: boolean;
  onPublish: (card: ContentCard) => void;
}) {
  const y = useMotionValue(0);
  const opacity = useMotionValue(1);

  const handleDragEnd = (
    _event: MouseEvent | TouchEvent | PointerEvent,
    info: PanInfo,
  ) => {
    const swipedUp =
      info.offset.y < -SWIPE_DISTANCE || info.velocity.y < -SWIPE_VELOCITY;
    if (swipedUp) {
      animate(y, -400, { duration: 0.22, ease: "easeIn" });
      animate(opacity, 0, { duration: 0.22 });
      onPublish(card);
      window.setTimeout(() => {
        y.set(0);
        opacity.set(0);
        animate(opacity, 1, { duration: 0.25 });
      }, CARD_RESET_MS);
    } else {
      animate(y, 0, { type: "spring", stiffness: 500, damping: 32 });
    }
  };

  return (
    <motion.div
      drag="y"
      style={{ y, opacity, touchAction: "pan-x" }}
      onDragEnd={handleDragEnd}
      whileDrag={{ scale: 1.05, zIndex: 10 }}
      className="cursor-grab active:cursor-grabbing"
    >
      <CardVisual card={card} pushing={pushing} />
    </motion.div>
  );
}

/** Non-visual file types (document/sheet/presentation/word) have no real
 * image to preview — a fallback icon instead of attempting <img src=file.pdf>. */
const FILE_TYPE_ICONS: Record<
  Exclude<MediaCardType, "image" | "video">,
  typeof FileText
> = {
  document: FileText,
  word: FileText,
  sheet: FileSpreadsheet,
  presentation: Presentation,
};

function CardVisual({
  card,
  pushing,
}: {
  card: ContentCard;
  pushing?: boolean;
}) {
  const FileIcon =
    card.type === "experience" || card.type === "image" || card.type === "video"
      ? null
      : FILE_TYPE_ICONS[card.type];

  // ponytail: Carousel cards use static images/icons instead of HTML5 <video> elements to avoid
  // instantiating native hardware decoders per video slide in Android WebView / APK containers.
  // A video with no poster yet gets one frame grabbed into a still (useVideoFrame),
  // one video at a time and only once it's on screen; no <video> stays mounted.
  const frameRef = useRef<HTMLDivElement | null>(null);
  const frame = useVideoFrame(
    card.type === "video" && !card.thumbnail ? card.videoUrl : undefined,
    frameRef,
  );
  const picture = card.thumbnail ?? frame;
  return (
    // The centred card (the one a swipe up publishes) stands out in lime.
    <div className="relative flex flex-col overflow-hidden rounded-2xl border border-border bg-zinc-50 text-left shadow-sm transition-[box-shadow,border-color] duration-300 group-data-[centred=true]/slide:border-primary group-data-[centred=true]/slide:shadow-[0_0_0_1px_var(--primary),0_12px_48px_-4px_color-mix(in_srgb,var(--primary)_55%,transparent)] dark:bg-[#111]">
      <div ref={frameRef} className="relative aspect-[4/3] w-full overflow-hidden bg-zinc-200 dark:bg-zinc-800/60">
        {picture &&
        (card.type === "image" || card.type === "experience" || card.type === "video") ? (
          <img
            src={picture}
            alt={card.title}
            className="h-full w-full object-cover"
            loading="lazy"
            decoding="async"
          />
        ) : (
          <div className="flex h-full w-full items-center justify-center">
            {card.type === "video" ? (
              <Video className="h-8 w-8 text-zinc-400" />
            ) : FileIcon ? (
              <FileIcon className="h-8 w-8 text-zinc-400" />
            ) : (
              <Layers className="h-6 w-6 text-zinc-400" />
            )}
          </div>
        )}
        <div className="absolute bottom-1.5 left-1.5 flex items-center gap-1 rounded-full bg-black/75 px-2 py-0.5 text-[9px] font-bold uppercase tracking-wide text-white">
          {card.type === "video" ? (
            <Video className="h-2.5 w-2.5" />
          ) : card.type === "image" ? (
            <ImageIcon className="h-2.5 w-2.5" />
          ) : FileIcon ? (
            <FileIcon className="h-2.5 w-2.5" />
          ) : (
            <Layers className="h-2.5 w-2.5" />
          )}
          {card.type === "experience"
            ? "experience"
            : MEDIA_TYPE_LABELS[card.type]}
        </div>
        {pushing && (
          <div className="absolute inset-0 flex items-center justify-center bg-black/40">
            <Loader2 className="h-5 w-5 animate-spin text-white" />
          </div>
        )}
      </div>
      <div className="p-2.5">
        <p
          className="truncate text-xs font-bold text-zinc-800 dark:text-zinc-200"
          title={card.title}
        >
          {card.title}
        </p>
      </div>
    </div>
  );
}

// ─── A still from a video that has no poster yet ─────────────────────────────

/** Grabbed stills by video URL, for the life of the page. */
const videoFrames = new Map<string, string | null>();
/** One video decoded at a time: a carousel of them must not open a decoder each. */
let frameQueue: Promise<void> = Promise.resolve();

function grabVideoFrame(url: string): Promise<string | null> {
  return new Promise((resolve) => {
    const video = document.createElement("video");
    video.muted = true;
    video.playsInline = true;
    video.preload = "metadata";
    let settled = false;
    const finish = (still: string | null) => {
      if (settled) return;
      settled = true;
      window.clearTimeout(timer);
      // Let the decoder go straight away.
      video.removeAttribute("src");
      video.load();
      resolve(still);
    };
    const timer = window.setTimeout(() => finish(null), 15_000);
    video.addEventListener("loadedmetadata", () => {
      // A second in (a fade from black would give a black still), or halfway in a short clip.
      video.currentTime = Math.min(1, (video.duration || 0) / 2);
    });
    video.addEventListener("seeked", () => {
      try {
        const w = Math.min(640, video.videoWidth || 640);
        const h = Math.round(w * ((video.videoHeight || 9) / (video.videoWidth || 16)));
        const canvas = document.createElement("canvas");
        canvas.width = w;
        canvas.height = h;
        canvas.getContext("2d")?.drawImage(video, 0, 0, w, h);
        finish(canvas.toDataURL("image/jpeg", 0.72));
      } catch {
        finish(null);
      }
    });
    video.addEventListener("error", () => finish(null));
    video.src = url;
  });
}

/** A still of `url` once `ref`'s element scrolls into view; null until then (or if it can't be read). */
function useVideoFrame(url: string | undefined, ref: React.RefObject<HTMLElement | null>): string | null {
  const [still, setStill] = useState<string | null>(() => (url ? videoFrames.get(url) ?? null : null));
  useEffect(() => {
    if (!url) return;
    if (videoFrames.has(url)) {
      setStill(videoFrames.get(url) ?? null);
      return;
    }
    const el = ref.current;
    if (!el) return;
    let cancelled = false;
    const observer = new IntersectionObserver((entries) => {
      if (!entries.some((e) => e.isIntersecting)) return;
      observer.disconnect();
      frameQueue = frameQueue.then(async () => {
        if (cancelled) return;
        if (!videoFrames.has(url)) videoFrames.set(url, await grabVideoFrame(url));
        if (!cancelled) setStill(videoFrames.get(url) ?? null);
      });
    });
    observer.observe(el);
    return () => {
      cancelled = true;
      observer.disconnect();
    };
  }, [url, ref]);
  return still;
}
