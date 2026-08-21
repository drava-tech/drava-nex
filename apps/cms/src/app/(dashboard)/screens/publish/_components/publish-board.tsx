"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { motion, animate, useAnimation, useMotionValue, type PanInfo } from "framer-motion";
import { ChevronLeft, ChevronRight, Image as ImageIcon, Layers, Loader2, Video, Wifi, WifiOff } from "lucide-react";
import { assignExperience, assignMedia } from "@/actions/screen-actions";
import { useCmsScreenSync } from "@/hooks/useCmsScreenSync";
import { ScreenMirror } from "@/app/(dashboard)/screens/_components/screen-mirror";
import { currentLabel, type ScreenRow } from "@/components/push-to-screen-modal";
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
  initialActiveScreenIds: string[];
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
export function PublishBoard({ initialScreens, initialActiveScreenIds, experiences }: PublishBoardProps) {
  const [screens, setScreens] = useState<ScreenRow[]>(initialScreens);
  const [activeScreenIds, setActiveScreenIds] = useState<Set<string>>(() => new Set(initialActiveScreenIds));
  const [targetIndex, setTargetIndex] = useState(0);
  const [filter, setFilter] = useState<"all" | "experiences" | "media">("all");
  const [mediaItems, setMediaItems] = useState<MediaItem[]>([]);
  const [loadingMedia, setLoadingMedia] = useState(true);
  const [pushingId, setPushingId] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<{ message: string; tone: "success" | "error" } | null>(null);
  const boxControls = useAnimation();

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

  useCmsScreenSync({
    onScreenUpdated: handleScreenUpdated,
    onActiveScreensUpdated: (ids) => setActiveScreenIds(new Set(ids)),
  });

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
  const targetOnline = targetScreen ? activeScreenIds.has(targetScreen.screenId) : false;

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

        <DropZone screen={targetScreen} isOnline={targetOnline} isPushing={pushingId !== null} controls={boxControls} />

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
            Hold a card and swipe up to publish it
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

      {/* Content grid */}
      <div className="min-h-0 flex-1 overflow-y-auto">
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
          <div className="grid grid-cols-2 gap-3 pb-4 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
            {cards.map((card) => (
              <SwipeCard
                key={`${card.type}:${card.id}`}
                card={card}
                pushing={pushingId === card.id}
                onPublish={triggerPublish}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function DropZone({
  screen,
  isOnline,
  isPushing,
  controls,
}: {
  screen: ScreenRow | null;
  isOnline: boolean;
  isPushing: boolean;
  controls: ReturnType<typeof useAnimation>;
}) {
  return (
    <motion.div
      animate={controls}
      className="relative h-56 w-full flex-1 overflow-hidden rounded-2xl border-2 border-[#432992] bg-zinc-950 shadow-lg md:h-64"
    >
      {!screen ? (
        <div className="flex h-full items-center justify-center">
          <p className="text-xs font-semibold uppercase tracking-wider text-zinc-500">No screens registered yet</p>
        </div>
      ) : (
        <>
          <ScreenMirror key={screen.screenId} screenId={screen.screenId} title={screen.screenName} />
          <div className="pointer-events-none absolute inset-x-0 top-0 flex items-center gap-1.5 bg-gradient-to-b from-black/70 to-transparent p-3">
            {isOnline ? (
              <Wifi className="h-3.5 w-3.5 text-green-400" />
            ) : (
              <WifiOff className="h-3.5 w-3.5 text-zinc-400" />
            )}
            <span className="text-sm font-bold uppercase tracking-wide text-white">{screen.screenName}</span>
          </div>
          <div className="pointer-events-none absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/70 to-transparent p-3 text-center">
            <span className="text-[11px] text-white/80">
              {isPushing ? "Publishing…" : `now showing: ${currentLabel(screen)}`}
            </span>
          </div>
        </>
      )}
    </motion.div>
  );
}

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

  const handleDragEnd = (_event: MouseEvent | TouchEvent | PointerEvent, info: PanInfo) => {
    const swipedUp = info.offset.y < -SWIPE_DISTANCE || info.velocity.y < -SWIPE_VELOCITY;
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
      style={{ y, opacity, touchAction: "none" }}
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
