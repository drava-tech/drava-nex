"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { motion, animate, useAnimation, useMotionValue, type PanInfo } from "framer-motion";
import { ChevronLeft, ChevronRight, Image as ImageIcon, Layers, Loader2, Video } from "lucide-react";
import { assignExperience, assignMedia } from "@/actions/screen-actions";
import { useCmsScreenSync } from "@/hooks/useCmsScreenSync";
import { currentLabel, type ScreenRow } from "@/components/push-to-screen-modal";
import { PublishScreenBridge } from "./publish-screen-bridge";
import { PUBLISH_DRAG_START, PUBLISH_DRAG_PROGRESS, PUBLISH_DRAG_END } from "@/lib/publish-drag-protocol";
import type { WsContent } from "@platform/types";

/** How far / how fast a card must be swiped up before it counts as "publish". */
const SWIPE_DISTANCE = 110;
const SWIPE_VELOCITY = 500;

interface ExperienceOption {
  id: string;
  title: string;
  coverImage: string | null;
}

interface MediaItem {
  id: string;
  name: string;
  type: string;
  url: string;
}

interface ContentCard {
  id: string;
  type: "experience" | "image" | "video";
  title: string;
  thumbnail: string | null;
}

interface PublishBoardProps {
  initialScreens: ScreenRow[];
  experiences: ExperienceOption[];
}

/**
 * Hold a card and swipe it up to publish it to whichever screen the box at
 * the top currently shows — arrows on either side page through every
 * registered screen without leaving the page. Publishing reuses the same
 * assignExperience/assignMedia actions (DB write + realtime WS broadcast) as
 * the checkbox-list pickers elsewhere in the CMS; the screen box plays a
 * quick "opening" flash when new content lands on it.
 */
export function PublishBoard({ initialScreens, experiences }: PublishBoardProps) {
  const [screens, setScreens] = useState<ScreenRow[]>(initialScreens);
  const [targetIndex, setTargetIndex] = useState(0);
  const [filter, setFilter] = useState<"all" | "experiences" | "media">("all");
  const [mediaItems, setMediaItems] = useState<MediaItem[]>([]);
  const [loadingMedia, setLoadingMedia] = useState(true);
  const [pushingId, setPushingId] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<{ message: string; tone: "success" | "error" } | null>(null);
  const boxControls = useAnimation();
  const sendDragRef = useRef<(command: string, value?: unknown) => void>(() => {});
  const scrollerRef = useRef<HTMLDivElement | null>(null);
  const slideRefs = useRef<Map<string, HTMLDivElement>>(new Map());

  useEffect(() => {
    fetch("/api/media")
      .then((res) => res.json())
      .then((data) => {
        const files = (data.media || []).filter(
          (item: MediaItem) => item.type === "image" || item.type === "video"
        );
        setMediaItems(files);
      })
      .catch((err) => console.error("Failed to load media for publish board:", err))
      .finally(() => setLoadingMedia(false));
  }, []);

  // Keeps "now showing" / online-dot correct if a screen is reassigned from
  // elsewhere (another tab, the touch picker) while this page stays open.
  const handleScreenUpdated = useCallback((screenId: string, content: WsContent) => {
    setScreens((prev) =>
      prev.map((s) => {
        if (s.screenId !== screenId) return s;
        if (content.type === "video" || content.type === "image") {
          return {
            ...s,
            currentContentKind: "media",
            currentMediaAssetId: content.id,
            mediaType: content.type,
            mediaUrl: content.source,
            mediaName: content.title ?? null,
          };
        }
        return {
          ...s,
          currentContentKind: "experience",
          currentExperienceId: content.id,
          experienceName: content.title ?? null,
        };
      })
    );
  }, []);

  useCmsScreenSync({ onScreenUpdated: handleScreenUpdated });

  useEffect(() => {
    if (!feedback) return;
    const timer = setTimeout(() => setFeedback(null), 2500);
    return () => clearTimeout(timer);
  }, [feedback]);

  const cards = useMemo<ContentCard[]>(() => {
    const experienceCards: ContentCard[] = experiences.map((e) => ({
      id: e.id,
      type: "experience",
      title: e.title,
      thumbnail: e.coverImage,
    }));
    const mediaCards: ContentCard[] = mediaItems.map((m) => ({
      id: m.id,
      type: m.type === "video" ? "video" : "image",
      title: m.name,
      thumbnail: m.url,
    }));
    if (filter === "experiences") return experienceCards;
    if (filter === "media") return mediaCards;
    return [...experienceCards, ...mediaCards];
  }, [experiences, mediaItems, filter]);

  const targetScreen = screens[targetIndex] ?? null;

  const setSlideRef = useCallback((key: string, el: HTMLDivElement | null) => {
    if (el) slideRefs.current.set(key, el);
    else slideRefs.current.delete(key);
  }, []);

  // Coverflow effect: scale/nudge/fade each slide by its live distance from
  // the scroller's horizontal center — the centered card sits at full size,
  // neighbors shrink and nudge in slightly, staying individually visible and
  // tappable rather than stacking behind the center card. Writes style
  // directly (no React state) so it stays smooth at scroll-event frequency —
  // same ref-mutation pattern already used for PublishDragOverlay's live drag
  // progress.
  //
  // Positions are derived from offsetLeft/scrollLeft (pure layout values,
  // unaffected by the transform this function itself applies), not
  // getBoundingClientRect — that would read back the *already-transformed*
  // position and feed it into computing the next transform, compounding on
  // itself frame over frame.
  const updateSlideTransforms = useCallback(() => {
    const scroller = scrollerRef.current;
    if (!scroller) return;
    const viewportCenter = scroller.clientWidth / 2;
    slideRefs.current.forEach((el) => {
      const elCenterInViewport = el.offsetLeft + el.offsetWidth / 2 - scroller.scrollLeft;
      const offset = (elCenterInViewport - viewportCenter) / viewportCenter;
      const clamped = Math.max(-1.4, Math.min(1.4, offset));
      const proximity = Math.min(Math.abs(clamped), 1);
      const scale = 1 - proximity * 0.35;
      const nudge = -clamped * 18;
      el.style.transform = `translateX(${nudge}px) scale(${scale})`;
      el.style.opacity = String(1 - proximity * 0.35);
      el.style.zIndex = String(100 - Math.round(proximity * 10));
    });
  }, []);

  useEffect(() => {
    const scroller = scrollerRef.current;
    if (!scroller) return;
    updateSlideTransforms();

    let ticking = false;
    const onScroll = () => {
      if (ticking) return;
      ticking = true;
      requestAnimationFrame(() => {
        ticking = false;
        updateSlideTransforms();
      });
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
    window.addEventListener("resize", onScroll);
    return () => {
      scroller.removeEventListener("scroll", onScroll);
      scroller.removeEventListener("wheel", onWheel);
      window.removeEventListener("resize", onScroll);
    };
  }, [cards, updateSlideTransforms]);

  // Only an explicit filter switch should jump the carousel back to the
  // start — publishing a card, a screen-sync update, etc. must never reset
  // scroll position (cards itself doesn't change from those, but nothing
  // here should assume that and reset on its account either).
  useEffect(() => {
    const scroller = scrollerRef.current;
    if (scroller) scroller.scrollLeft = 0;
  }, [filter]);

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

    const onPointerDown = (e: PointerEvent) => {
      if (e.pointerType !== "mouse") return;
      dragging = true;
      startX = e.clientX;
      startScrollLeft = scroller.scrollLeft;
      scroller.style.cursor = "grabbing";
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
      dragging = false;
      scroller.style.cursor = "";
    };

    scroller.addEventListener("pointerdown", onPointerDown);
    window.addEventListener("pointermove", onPointerMove);
    window.addEventListener("pointerup", stopDragging);
    window.addEventListener("pointercancel", stopDragging);
    return () => {
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
      const nextCard = cards[Math.max(0, Math.min(cards.length - 1, activeIndex + direction))];
      if (!nextCard) return;
      slideRefs.current.get(`${nextCard.type}:${nextCard.id}`)?.scrollIntoView({
        behavior: "smooth",
        inline: "center",
        block: "nearest",
      });
    },
    [cards]
  );

  const sendDragEvent = useCallback(
    (command: string, value?: unknown) => sendDragRef.current(command, value),
    []
  );

  const triggerPublish = useCallback(
    (card: ContentCard) => {
      if (!targetScreen) return;
      const { screenId, screenName } = targetScreen;
      setPushingId(card.id);
      // Optimistic update so the box's "now showing" line reflects the push
      // immediately, same pattern as screens-controller.tsx's handleAssign.
      setScreens((prev) =>
        prev.map((s) => {
          if (s.screenId !== screenId) return s;
          if (card.type === "image" || card.type === "video") {
            return {
              ...s,
              currentContentKind: "media",
              currentMediaAssetId: card.id,
              mediaType: card.type,
              mediaUrl: card.thumbnail ?? s.mediaUrl,
              mediaName: card.title,
            };
          }
          return { ...s, currentContentKind: "experience", currentExperienceId: card.id, experienceName: card.title };
        })
      );
      // The screen "opening" as the swiped content lands on it.
      void boxControls.start({
        scale: [1, 1.035, 1],
        transition: { duration: 0.45, ease: "easeOut" },
      });
      (async () => {
        try {
          if (card.type === "image" || card.type === "video") {
            await assignMedia(screenId, card.id);
          } else {
            await assignExperience(screenId, card.id);
          }
          setFeedback({ message: `Pushed "${card.title}" to ${screenName}`, tone: "success" });
        } catch (err) {
          console.error("Failed to push content:", err);
          setFeedback({ message: `Failed to push "${card.title}" to ${screenName}`, tone: "error" });
        } finally {
          setPushingId(null);
        }
      })();
    },
    [targetScreen, boxControls]
  );

  return (
    <div className="flex flex-1 min-h-0 flex-col gap-4 p-4 select-none">
      {targetScreen && (
        <PublishScreenBridge key={targetScreen.screenId} screenId={targetScreen.screenId} sendRef={sendDragRef} />
      )}
      {/* Screen switcher / publish target */}
      <div className="flex shrink-0 items-center gap-3">
        <button
          type="button"
          onClick={() => setTargetIndex((i) => (screens.length ? (i - 1 + screens.length) % screens.length : 0))}
          disabled={screens.length < 2}
          aria-label="Previous screen"
          className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full border border-[#432992] bg-zinc-500/10 text-zinc-600 transition-colors hover:bg-zinc-500/20 disabled:opacity-30 dark:text-zinc-300"
        >
          <ChevronLeft className="h-5 w-5" />
        </button>

        <DropZone screen={targetScreen} isPushing={pushingId !== null} controls={boxControls} />

        <button
          type="button"
          onClick={() => setTargetIndex((i) => (screens.length ? (i + 1) % screens.length : 0))}
          disabled={screens.length < 2}
          aria-label="Next screen"
          className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full border border-[#432992] bg-zinc-500/10 text-zinc-600 transition-colors hover:bg-zinc-500/20 disabled:opacity-30 dark:text-zinc-300"
        >
          <ChevronRight className="h-5 w-5" />
        </button>
      </div>

      {/* Feedback banner / gesture hint */}
      <div className="flex h-6 shrink-0 items-center justify-center">
        {feedback ? (
          <span
            className={`rounded-full px-3 py-1 text-xs font-semibold ${
              feedback.tone === "success"
                ? "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400"
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

      {/* Filter pills */}
      <div className="flex shrink-0 justify-center gap-2">
        {(["all", "experiences", "media"] as const).map((key) => (
          <button
            key={key}
            onClick={() => setFilter(key)}
            className={`rounded-full px-4 py-1.5 text-xs font-semibold uppercase tracking-wider transition-all ${
              filter === key
                ? "bg-white text-zinc-900 shadow-sm dark:bg-zinc-800 dark:text-zinc-50"
                : "text-zinc-500 hover:text-zinc-900 dark:hover:text-zinc-300"
            }`}
          >
            {key}
          </button>
        ))}
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
            <p className="text-sm text-zinc-400">No content to publish yet.</p>
          </div>
        ) : (
          <>
            <div
              ref={scrollerRef}
              className="no-scrollbar relative flex min-h-0 flex-1 cursor-grab items-center gap-1 overflow-x-auto overflow-y-visible snap-x snap-mandatory scroll-smooth"
              style={{ paddingLeft: "calc(50% - 12rem)", paddingRight: "calc(50% - 12rem)" }}
            >
              {cards.map((card) => {
                const key = `${card.type}:${card.id}`;
                return (
                  <div key={key} ref={(el) => setSlideRef(key, el)} className="w-96 shrink-0 snap-center">
                    <SwipeCard
                      card={card}
                      pushing={pushingId === card.id}
                      onPublish={triggerPublish}
                      sendDrag={sendDragEvent}
                    />
                  </div>
                );
              })}
            </div>

            {/* A dedicated row below the carousel rather than an overlay on
                the images — keeps these clickable regardless of the
                coverflow scale effect's inline z-index on the cards above. */}
            <div className="flex shrink-0 items-center justify-center gap-4">
              <button
                type="button"
                onClick={() => scrollToAdjacentCard(-1)}
                aria-label="Previous card"
                className="flex h-10 w-10 items-center justify-center rounded-full border border-[#432992] bg-zinc-500/10 text-zinc-600 transition-colors hover:bg-zinc-500/20 dark:text-zinc-300"
              >
                <ChevronLeft className="h-5 w-5" />
              </button>
              <button
                type="button"
                onClick={() => scrollToAdjacentCard(1)}
                aria-label="Next card"
                className="flex h-10 w-10 items-center justify-center rounded-full border border-[#432992] bg-zinc-500/10 text-zinc-600 transition-colors hover:bg-zinc-500/20 dark:text-zinc-300"
              >
                <ChevronRight className="h-5 w-5" />
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

function DropZone({
  screen,
  isPushing,
  controls,
}: {
  screen: ScreenRow | null;
  isPushing: boolean;
  controls: ReturnType<typeof useAnimation>;
}) {
  return (
    <motion.div
      animate={controls}
      className="flex h-12 w-full flex-1 items-center justify-between gap-3 rounded-xl border-2 border-[#432992] bg-zinc-950 px-4 shadow-sm"
    >
      <span className="truncate text-sm font-bold uppercase tracking-wide text-white">
        {screen ? screen.screenName : "No screens registered yet"}
      </span>
      {screen && (
        <span className="shrink-0 truncate text-xs text-white/60">
          {isPushing ? "Publishing…" : currentLabel(screen)}
        </span>
      )}
    </motion.div>
  );
}

function SwipeCard({
  card,
  pushing,
  onPublish,
  sendDrag,
}: {
  card: ContentCard;
  pushing?: boolean;
  onPublish: (card: ContentCard) => void;
  sendDrag: (command: string, value?: unknown) => void;
}) {
  const y = useMotionValue(0);
  const opacity = useMotionValue(1);
  const latestProgress = useRef(0);
  const rafScheduled = useRef(false);

  const handleDragStart = () => {
    sendDrag(PUBLISH_DRAG_START, { cardId: card.id, title: card.title, thumbnail: card.thumbnail, type: card.type });
  };

  const handleDrag = (_event: MouseEvent | TouchEvent | PointerEvent, info: PanInfo) => {
    latestProgress.current = Math.min(1, Math.max(0, -info.offset.y / SWIPE_DISTANCE));
    if (!rafScheduled.current) {
      rafScheduled.current = true;
      requestAnimationFrame(() => {
        rafScheduled.current = false;
        sendDrag(PUBLISH_DRAG_PROGRESS, { cardId: card.id, progress: latestProgress.current });
      });
    }
  };

  const handleDragEnd = (_event: MouseEvent | TouchEvent | PointerEvent, info: PanInfo) => {
    const swipedUp = info.offset.y < -SWIPE_DISTANCE || info.velocity.y < -SWIPE_VELOCITY;
    sendDrag(PUBLISH_DRAG_END, { cardId: card.id, committed: swipedUp });
    if (swipedUp) {
      animate(y, -400, { duration: 0.22, ease: "easeIn" });
      animate(opacity, 0, { duration: 0.22 });
      onPublish(card);
      window.setTimeout(() => {
        y.set(0);
        opacity.set(0);
        animate(opacity, 1, { duration: 0.25 });
      }, 240);
    } else {
      animate(y, 0, { type: "spring", stiffness: 500, damping: 32 });
    }
  };

  return (
    <motion.div
      drag="y"
      style={{ y, opacity, touchAction: "pan-x" }}
      onDragStart={handleDragStart}
      onDrag={handleDrag}
      onDragEnd={handleDragEnd}
      whileDrag={{ scale: 1.05, zIndex: 10 }}
      className="cursor-grab active:cursor-grabbing"
    >
      <CardVisual card={card} pushing={pushing} />
    </motion.div>
  );
}

function CardVisual({ card, pushing }: { card: ContentCard; pushing?: boolean }) {
  return (
    <div className="relative flex flex-col overflow-hidden rounded-2xl border border-[#432992] bg-zinc-50 text-left shadow-sm dark:bg-[#111]">
      <div className="relative aspect-[4/3] w-full overflow-hidden bg-zinc-200 dark:bg-zinc-800/60">
        {card.thumbnail ? (
          card.type === "video" ? (
            <video src={card.thumbnail} className="h-full w-full object-cover" muted playsInline />
          ) : (
            <img src={card.thumbnail} alt={card.title} className="h-full w-full object-cover" loading="lazy" />
          )
        ) : (
          <div className="flex h-full w-full items-center justify-center">
            <Layers className="h-6 w-6 text-zinc-400" />
          </div>
        )}
        <div className="absolute bottom-1.5 left-1.5 flex items-center gap-1 rounded-full bg-black/50 px-2 py-0.5 text-[9px] font-bold uppercase tracking-wide text-white backdrop-blur-sm">
          {card.type === "video" ? (
            <Video className="h-2.5 w-2.5" />
          ) : card.type === "image" ? (
            <ImageIcon className="h-2.5 w-2.5" />
          ) : (
            <Layers className="h-2.5 w-2.5" />
          )}
          {card.type}
        </div>
        {pushing && (
          <div className="absolute inset-0 flex items-center justify-center bg-black/40">
            <Loader2 className="h-5 w-5 animate-spin text-white" />
          </div>
        )}
      </div>
      <div className="p-2.5">
        <p className="truncate text-xs font-bold text-zinc-800 dark:text-zinc-200" title={card.title}>
          {card.title}
        </p>
      </div>
    </div>
  );
}
