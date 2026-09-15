"use client";

import { useCallback, useEffect, useRef } from "react";

/**
 * Loads the next page when a sentinel element scrolls into view.
 *
 * An IntersectionObserver rather than scroll-offset maths: these lists live in
 * short modals whose layout shifts as items load, so `scrollHeight`/`scrollTop`
 * arithmetic would need re-tuning per container and re-throttling per scroll.
 * The observer needs neither, and it fires once per crossing rather than on
 * every scroll event.
 *
 * Attach the returned ref to a small element rendered after the last item:
 *
 *   const sentinelRef = useInfiniteScroll({ hasMore: cursor !== null, loading, onLoadMore });
 *   ...
 *   <div ref={sentinelRef} />
 *
 * `onLoadMore` may change identity freely — it is held in a ref, so the
 * observer is not torn down and rebuilt on every render.
 */
export function useInfiniteScroll({
  hasMore,
  loading,
  onLoadMore,
  /** How far before the sentinel actually appears to start loading. */
  rootMargin = "200px",
}: {
  hasMore: boolean;
  loading: boolean;
  onLoadMore: () => void;
  rootMargin?: string;
}) {
  const sentinelRef = useRef<HTMLDivElement | null>(null);

  const onLoadMoreRef = useRef(onLoadMore);
  onLoadMoreRef.current = onLoadMore;
  /** Mirrors `loading` so the observer callback reads the current value
   *  without the observer having to be rebuilt whenever it flips. */
  const loadingRef = useRef(loading);
  loadingRef.current = loading;

  const setSentinel = useCallback((el: HTMLDivElement | null) => {
    sentinelRef.current = el;
  }, []);

  useEffect(() => {
    const el = sentinelRef.current;
    // Nothing left to fetch — don't observe at all, so reaching the bottom of a
    // fully-loaded list is free.
    if (!el || !hasMore || typeof IntersectionObserver === "undefined") return;

    const observer = new IntersectionObserver(
      (entries) => {
        // loadingRef, not the captured `loading`: one fast flick can cross the
        // sentinel again before the in-flight page resolves, and firing twice
        // would append the same rows.
        if (entries.some((e) => e.isIntersecting) && !loadingRef.current) {
          onLoadMoreRef.current();
        }
      },
      { rootMargin }
    );
    observer.observe(el);
    return () => observer.disconnect();
    // `loading` is included so the observer is re-created once a page settles:
    // if the sentinel is still on screen, that re-fires and pulls the page
    // after it, which is what a list shorter than its container needs.
  }, [hasMore, loading, rootMargin]);

  return setSentinel;
}
