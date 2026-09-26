"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import type { WsContent } from "@platform/types";
import { readWelcomeContent } from "@platform/ui/templates/welcome";

interface PreloadState {
  active: WsContent;
  activeKey: string;
  staged: WsContent | null;
  stagedKey: string | null;
}

interface UseContentPreloaderReturn {
  activeContent: WsContent;
  activeKey: string;
  queueContent: (incoming: WsContent) => void;
}

export function useContentPreloader(initial: WsContent): UseContentPreloaderReturn {
  const [state, setState] = useState<PreloadState>({
    active: initial,
    activeKey: getContentKey(initial),
    staged: null,
    stagedKey: null,
  });
  const preloadAbortRef = useRef<AbortController | null>(null);

  const queueContent = useCallback((incoming: WsContent) => {
    const incomingKey = getContentKey(incoming);
    setState((prev) => {
      if (prev.activeKey === incomingKey || prev.stagedKey === incomingKey) return prev;
      return { ...prev, staged: incoming, stagedKey: incomingKey };
    });
  }, []);

  useEffect(() => {
    if (!state.staged || !state.stagedKey) return;
    const content = state.staged;
    const contentKey = state.stagedKey;

    // Cancel any in-flight preload
    preloadAbortRef.current?.abort();
    preloadAbortRef.current = new AbortController();
    const { signal } = preloadAbortRef.current;

    let cancelled = false;
    signal.addEventListener("abort", () => { cancelled = true; });

    const promote = () => {
      if (!cancelled) {
        setState({ active: content, activeKey: contentKey, staged: null, stagedKey: null });
      }
    };

    const videoUrl = preloadVideoUrl(content);

    if (content.type === "image") {
      const img = new Image();
      img.onload = promote;
      img.onerror = promote; // still switch even if preload fails
      img.src = content.source;
    } else if (videoUrl) {
      const video = document.createElement("video");
      video.preload = "auto";
      const timer = setTimeout(promote, 3_000); // max 3s wait
      // Releasing the element is not optional housekeeping. Without it this
      // detached <video> keeps pulling the whole file while VideoRenderer's
      // real element pulls the same URL, so every push downloaded the video
      // TWICE concurrently — on a busy LAN that reads as rebuffering and
      // judder, i.e. "bad quality". Clearing src and calling load() aborts
      // the in-flight fetch; the real element then reads from the HTTP cache.
      const release = () => {
        clearTimeout(timer);
        video.oncanplaythrough = null;
        video.onerror = null;
        video.removeAttribute("src");
        video.load();
      };
      video.oncanplaythrough = () => { release(); promote(); };
      video.onerror = () => { release(); promote(); };
      video.src = videoUrl;
      video.load();
      // Also covers the staged item changing again before this one buffered.
      return release;
    } else {
      // html / stream / experience with nothing to buffer — promote immediately
      promote();
    }
    return undefined;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.stagedKey]);

  return { activeContent: state.active, activeKey: state.activeKey, queueContent };
}

/**
 * The URL worth buffering before this content goes on screen, or null if there
 * is nothing to warm.
 *
 * A plain video is its own source. A Welcome experience carries its video
 * inside templateContent and is `type: "experience"`, so it used to fall
 * through to the immediate-promote branch above — mounting a full-screen
 * <video> with a completely empty buffer. That is the worst possible starting
 * condition for the two media renderers to lock to each other: the picture
 * starts as soon as the first frame decodes while the audio output is still
 * opening, then the audio drops whatever it fell behind by to catch up, which
 * is audible as a swallowed word. Buffering first lets both start together.
 */
function preloadVideoUrl(content: WsContent): string | null {
  if (content.type === "video") return content.source || null;
  if (content.type === "experience" && content.templateKey === "welcome") {
    return readWelcomeContent(content.templateContent)?.videoUrl || null;
  }
  return null;
}

function getContentKey(content: WsContent): string {
  return JSON.stringify([
    content.id,
    content.type,
    content.source,
    content.loop ?? null,
    content.muted ?? null,
    content.title ?? null,
    content.templateKey ?? null,
    content.templateContent ?? null,
  ]);
}
