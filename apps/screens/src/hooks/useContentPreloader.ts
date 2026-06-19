"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import type { WsContent } from "@platform/types";

interface PreloadState {
  active: WsContent;
  staged: WsContent | null;
}

interface UseContentPreloaderReturn {
  activeContent: WsContent;
  queueContent: (incoming: WsContent) => void;
}

export function useContentPreloader(initial: WsContent): UseContentPreloaderReturn {
  const [state, setState] = useState<PreloadState>({ active: initial, staged: null });
  const preloadAbortRef = useRef<AbortController | null>(null);

  const queueContent = useCallback((incoming: WsContent) => {
    // Skip if it's already what we're showing or preloading
    setState((prev) => {
      if (prev.active.id === incoming.id) return prev;
      return { ...prev, staged: incoming };
    });
  }, []);

  useEffect(() => {
    if (!state.staged) return;
    const content = state.staged;

    // Cancel any in-flight preload
    preloadAbortRef.current?.abort();
    preloadAbortRef.current = new AbortController();
    const { signal } = preloadAbortRef.current;

    let cancelled = false;
    signal.addEventListener("abort", () => { cancelled = true; });

    const promote = () => {
      if (!cancelled) {
        setState({ active: content, staged: null });
      }
    };

    if (content.type === "image") {
      const img = new Image();
      img.onload = promote;
      img.onerror = promote; // still switch even if preload fails
      img.src = content.source;
    } else if (content.type === "video") {
      const video = document.createElement("video");
      video.preload = "auto";
      const timer = setTimeout(promote, 3_000); // max 3s wait
      video.oncanplaythrough = () => { clearTimeout(timer); promote(); };
      video.onerror = () => { clearTimeout(timer); promote(); };
      video.src = content.source;
      video.load();
    } else {
      // html / stream — promote immediately
      promote();
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.staged?.id]);

  return { activeContent: state.active, queueContent };
}
