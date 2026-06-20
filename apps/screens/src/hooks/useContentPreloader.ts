"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import type { WsContent } from "@platform/types";

interface PreloadState {
  active: WsContent;
  activeKey: string;
  staged: WsContent | null;
  stagedKey: string | null;
}

interface UseContentPreloaderReturn {
  activeContent: WsContent;
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
      // html / stream / experience — promote immediately
      promote();
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.stagedKey]);

  return { activeContent: state.active, queueContent };
}

function getContentKey(content: WsContent): string {
  return JSON.stringify([
    content.id,
    content.type,
    content.source,
    content.loop ?? null,
    content.muted ?? null,
    content.title ?? null,
  ]);
}
