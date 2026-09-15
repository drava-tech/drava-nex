"use client";

import { createContext, useContext, useMemo, type ReactNode } from "react";

interface PortfolioScreenState {
  /**
   * True for a CMS-side embed of a live screen (the mirror iframe), false for
   * the real TV — and false for the editor stage and the standalone preview
   * tab, which are nobody's mirror.
   *
   * Two things hang off it, and they are the same two `VideoRenderer` hangs off
   * its own `preview` prop:
   *  - Audio only ever leaves the real panel, so a mirror plays muted. That is
   *    also what lets a mirror autoplay at all: unmuted autoplay is blocked
   *    without a gesture inside that iframe, which is why a mirror joining a
   *    film already in progress used to sit frozen on one frame.
   *  - Only the non-mirror reports its position on the throttle, so one client
   *    owns the timeline and mirrors never fight it. Both still broadcast the
   *    discrete things a person does — play, pause, seek.
   */
  mirror: boolean;
}

const PortfolioScreenContext = createContext<PortfolioScreenState>({ mirror: false });

/**
 * Tells the portfolio's video surfaces which side of the glass they are on.
 *
 * A context rather than a prop because the film player sits five components
 * below the renderer (PortfolioApp → VerticalView → GallerySectionView →
 * FilmsGridView) and none of the four in between has any other reason to know.
 */
export function PortfolioScreenProvider({
  mirror = false,
  children,
}: {
  mirror?: boolean;
  children: ReactNode;
}) {
  const value = useMemo(() => ({ mirror }), [mirror]);
  return <PortfolioScreenContext.Provider value={value}>{children}</PortfolioScreenContext.Provider>;
}

export function usePortfolioScreen(): PortfolioScreenState {
  return useContext(PortfolioScreenContext);
}
