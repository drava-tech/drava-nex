"use client";

import { useEffect, useState } from "react";
import { PortfolioApp } from "./portfolio-app";
import type { PortfolioContent, PortfolioViewState } from "./content";

/**
 * State-driven portfolio navigation for live screens: local navigation emits a
 * `screen-control` window event that the player shell relays over WebSocket to
 * every client of this screen (the physical TV and any CMS mirror), and inbound
 * `portfolio-set-view` events are applied WITHOUT re-emitting — re-broadcasting
 * an applied command would loop through the gateway's echo-to-sender.
 * Old `{ cardIndex }`-only payloads coalesce sectionIndex to null.
 */
export function PortfolioLiveApp({ content }: { content?: PortfolioContent }) {
  const [view, setView] = useState<PortfolioViewState>({ cardIndex: null, sectionIndex: null });

  const navigate = (v: PortfolioViewState) => {
    setView(v);
    if (typeof window === "undefined") return;
    window.dispatchEvent(
      new CustomEvent("screen-control", {
        detail: { command: "SET_PORTFOLIO_VIEW", value: { cardIndex: v.cardIndex, sectionIndex: v.sectionIndex } },
      })
    );
  };

  useEffect(() => {
    const onSetView = (e: Event) => {
      const detail = (e as CustomEvent<{ cardIndex?: number | null; sectionIndex?: number | null }>).detail;
      setView({ cardIndex: detail?.cardIndex ?? null, sectionIndex: detail?.sectionIndex ?? null });
    };
    window.addEventListener("portfolio-set-view", onSetView);
    return () => window.removeEventListener("portfolio-set-view", onSetView);
  }, []);

  return <PortfolioApp content={content} view={view} onNavigate={navigate} />;
}
