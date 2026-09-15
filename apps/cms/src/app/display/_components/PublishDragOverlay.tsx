"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { CONTENT_PLAYING_EVENT } from "@/lib/display/playback-protocol";
import type {
  PublishDragEndPayload,
  PublishDragProgressPayload,
  PublishDragStartPayload,
} from "@/lib/publish-drag-protocol";

/** Safety net: if the real CONTENT_UPDATE never arrives (e.g. the publish call failed), don't leave the panel stuck covering the screen forever. */
const MAX_HOLD_MS = 5_000;

/**
 * Ceiling on an *in-progress* gesture, refreshed by every progress frame.
 *
 * A drag that simply stops producing events — the operator's socket blips, the
 * browser swallows the pointer sequence as `pointercancel`, the CMS tab is
 * navigated away mid-swipe — used to leave this panel parked at whatever
 * fraction it had reached, with nothing on any path able to clear it: the only
 * other reset is a subsequent PUBLISH_DRAG_START. On the wall that reads as the
 * screen freezing halfway through a transition. No physical drag has a gap this
 * long between frames, so refreshing on progress cannot cut a live gesture off.
 */
const DRAG_STALL_MS = 10_000;

interface PublishDragOverlayProps {
  /** The id of whatever content is actually live right now — used to know when the real CONTENT_UPDATE for a committed drag has landed, so the held panel can lift. */
  activeContentId: string;
}

/**
 * Mirrors the CMS operator's swipe-up gesture in real time: as PUBLISH_DRAG_*
 * commands arrive (dispatched as window events by LiveScreenPlayer's
 * handleCommand), a full-bleed panel showing the dragged card's own thumbnail
 * rises off the bottom of the screen by the same proportion the operator has
 * dragged — pinned live, not a replay after the fact. Rendered as a sibling
 * of the normal .screen-content-fade content div (never remounted by a real
 * content swap), same placement pattern as WhiteboardScreenOverlay.
 *
 * `transform` is mutated directly on the DOM node (never through React state)
 * so progress updates apply instantly, one-to-one with each incoming value —
 * routing them through a render would risk a stale/eased frame. `transition`
 * is the only style property React manages, toggled on only for the final
 * settle after the gesture ends.
 */
export function PublishDragOverlay({ activeContentId }: PublishDragOverlayProps) {
  const [preview, setPreview] = useState<PublishDragStartPayload | null>(null);
  const [committed, setCommitted] = useState(false);
  const [settling, setSettling] = useState(false);
  const panelRef = useRef<HTMLDivElement | null>(null);
  const cardIdRef = useRef<string | null>(null);
  const holdTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Every path that leaves this panel on screen must arm one of these. Clearing
  // the panel is always safe: the real content is underneath it either way, so
  // the worst case of lifting too early is a visible cut, while the worst case
  // of never lifting is a dead screen.
  const clearPanel = useCallback(() => {
    if (holdTimerRef.current) clearTimeout(holdTimerRef.current);
    holdTimerRef.current = null;
    cardIdRef.current = null;
    setPreview(null);
    setCommitted(false);
  }, []);

  const armPanelTimeout = useCallback((ms: number) => {
    if (holdTimerRef.current) clearTimeout(holdTimerRef.current);
    holdTimerRef.current = setTimeout(() => {
      cardIdRef.current = null;
      setPreview(null);
      setCommitted(false);
    }, ms);
  }, []);

  useEffect(() => {
    const onStart = (e: Event) => {
      const detail = (e as CustomEvent<PublishDragStartPayload>).detail;
      cardIdRef.current = detail.cardId;
      setSettling(false);
      setCommitted(false);
      setPreview(detail);
      armPanelTimeout(DRAG_STALL_MS);
    };
    const onProgress = (e: Event) => {
      const detail = (e as CustomEvent<PublishDragProgressPayload>).detail;
      if (detail.cardId !== cardIdRef.current) return;
      armPanelTimeout(DRAG_STALL_MS); // the gesture is demonstrably still alive
      const panel = panelRef.current;
      if (panel) panel.style.transform = `translateY(${(1 - detail.progress) * 100}%)`;
    };
    const onEnd = (e: Event) => {
      const detail = (e as CustomEvent<PublishDragEndPayload>).detail;
      if (detail.cardId !== cardIdRef.current) return;
      setSettling(true);
      const panel = panelRef.current;
      if (detail.committed) {
        setCommitted(true);
        if (panel) panel.style.transform = "translateY(0)";
        armPanelTimeout(MAX_HOLD_MS);
      } else {
        if (panel) panel.style.transform = "translateY(100%)";
        armPanelTimeout(300);
      }
    };

    // The real lift signal for a committed drag. Content *promotion* is not
    // enough on its own: useContentPreloader promotes on a 3s timeout whether
    // or not the video actually buffered, so lifting there can reveal a frozen
    // black frame — the exact "stuck mid-transition" this overlay was meant to
    // hide. A renderer only fires this once it has genuinely started.
    const onPlaying = (e: Event) => {
      const id = (e as CustomEvent<{ id?: string }>).detail?.id;
      if (!cardIdRef.current || id !== cardIdRef.current) return;
      clearPanel();
    };

    window.addEventListener("publish-drag-start", onStart);
    window.addEventListener("publish-drag-progress", onProgress);
    window.addEventListener("publish-drag-end", onEnd);
    window.addEventListener(CONTENT_PLAYING_EVENT, onPlaying);
    return () => {
      window.removeEventListener("publish-drag-start", onStart);
      window.removeEventListener("publish-drag-progress", onProgress);
      window.removeEventListener("publish-drag-end", onEnd);
      window.removeEventListener(CONTENT_PLAYING_EVENT, onPlaying);
      if (holdTimerRef.current) clearTimeout(holdTimerRef.current);
    };
  }, [armPanelTimeout, clearPanel]);

  // Initialize each newly-mounted panel below the fold before any progress
  // event has a chance to move it.
  useEffect(() => {
    if (preview && panelRef.current) panelRef.current.style.transform = "translateY(100%)";
  }, [preview]);

  // The real content for a committed drag has been promoted underneath. For
  // anything that paints as soon as it mounts (image/html/experience) that is
  // the moment to lift. Video is the exception — it can be promoted with an
  // empty buffer — so there we wait for CONTENT_PLAYING_EVENT above, backed by
  // the MAX_HOLD_MS ceiling armed at drag-end so this can never wait forever.
  useEffect(() => {
    if (!committed || !preview || activeContentId !== preview.cardId) return;
    if (preview.type === "video") return;
    clearPanel();
  }, [committed, preview, activeContentId, clearPanel]);

  if (!preview) return null;

  return (
    <div
      ref={panelRef}
      className="fixed inset-0 z-30 bg-zinc-950"
      style={{ transition: settling ? "transform 300ms cubic-bezier(0.16, 1, 0.3, 1)" : undefined }}
    >
      {preview.type === "video" ? (
        <video
          src={preview.thumbnail ?? undefined}
          className="h-full w-full object-cover"
          muted
          autoPlay
          loop
          playsInline
        />
      ) : (preview.type === "image" || preview.type === "experience") && preview.thumbnail ? (
        // Only image/experience thumbnails are real images — document/sheet/
        // presentation/word cards carry their raw file URL here instead, which
        // isn't renderable as <img>, so those just fall through to the plain panel.
        <img src={preview.thumbnail} alt={preview.title} className="h-full w-full object-cover" />
      ) : null}
    </div>
  );
}
