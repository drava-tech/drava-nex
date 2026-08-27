"use client";

import { useEffect, useRef, useState, type RefObject } from "react";

/**
 * True once the element has scrolled into view — then stays true forever
 * (disconnects the observer instead of toggling back), since this is for
 * lazily mounting signage content that shouldn't unload again once shown,
 * not for an infinite list that needs to reclaim off-screen work.
 */
export function useInView<T extends HTMLElement>(rootMargin = "200px"): [RefObject<T | null>, boolean] {
  const ref = useRef<T>(null);
  const [inView, setInView] = useState(false);

  useEffect(() => {
    if (inView) return;
    const el = ref.current;
    if (!el) return;
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          setInView(true);
          io.disconnect();
        }
      },
      { rootMargin }
    );
    io.observe(el);
    return () => io.disconnect();
  }, [inView, rootMargin]);

  return [ref, inView];
}
