"use client";

import React, { useEffect, useMemo } from "react";
import { Film, Layers, Radio, Slash } from "lucide-react";
import { Badge } from "@platform/ui";
import type { ScreenRow } from "@platform/db";
import { useAppDispatch, useAppSelector } from "@/store/hooks";
import { screensHydrated, activeScreensUpdated } from "@/store/screens-slice";
import { SampleBadge } from "./sample-badge";

/** Shown only when no screens exist at all — a fresh install. */
const SAMPLE_SCREENS: ScreenDetail[] = [
  { id: "main-screen", name: "Main Screen", content: "Showreel.mp4", contentKind: "media" },
  { id: "lobby", name: "Lobby Display", content: "Welcome Screen", contentKind: "experience" },
  { id: "facade", name: "Facade", content: "Unassigned", contentKind: "none" },
];

type ContentKind = "experience" | "live-stream" | "media" | "none";
type ScreenStatus = "online" | "offline";



interface ScreenDetail {
  id: string;
  name: string;
  content: string;
  contentKind: ContentKind;
}

const kindMeta: Record<ContentKind, { icon: typeof Layers; label: string }> = {
  experience: { icon: Layers, label: "Portfolio" },
  "live-stream": { icon: Radio, label: "Live" },
  media: { icon: Film, label: "Media" },
  none: { icon: Slash, label: "—" },
};

const statusMeta: Record<ScreenStatus, { label: string; color: string }> = {
  online: { label: "Online", color: "var(--success)" },
  offline: { label: "Offline", color: "var(--destructive)" },
};

function toScreenDetail(row: ScreenRow): ScreenDetail {
  if (row.blanked) {
    return {
      id: row.screenId,
      name: row.screenName,
      content: "Screen stopped",
      contentKind: "none",
    };
  }

  if (row.currentContentKind === "experience") {
    return {
      id: row.screenId,
      name: row.screenName,
      content: row.experienceName ?? "Assigned experience",
      contentKind: "experience",
    };
  }

  if (row.currentContentKind === "media") {
    return {
      id: row.screenId,
      name: row.screenName,
      content: row.mediaName ?? "Assigned media",
      contentKind: "media",
    };
  }

  if (row.defaultMediaName) {
    return {
      id: row.screenId,
      name: row.screenName,
      content: `${row.defaultMediaName} (default)`,
      contentKind: "media",
    };
  }

  return {
    id: row.screenId,
    name: row.screenName,
    content: "Unassigned",
    contentKind: "none",
  };
}

export function ScreensList({
  initialScreens,
  initialActiveScreenIds,
}: {
  initialScreens: ScreenRow[];
  initialActiveScreenIds: string[];
}) {
  const dispatch = useAppDispatch();
  const storeRows = useAppSelector((st) => st.screens.rows);
  const storeActiveIds = useAppSelector((st) => st.screens.activeIds);

  useEffect(() => {
    dispatch(screensHydrated(initialScreens));
    dispatch(activeScreensUpdated(initialActiveScreenIds));
  }, [dispatch, initialScreens, initialActiveScreenIds]);

  // Props until the hydrate dispatch lands, store after — the effect above runs
  // only once the first paint is done, so without this the table renders empty.
  const rows = storeRows.length > 0 ? storeRows : initialScreens;

  // Derived, not stored. This used to be useState seeded at mount and then
  // patched by a local WS handler; the row itself is now kept current by the
  // store, so the view model is just a pure function of it and can never drift
  // from what the other screen surfaces show.
  const screens = useMemo(() => rows.map(toScreenDetail), [rows]);
  const activeScreenIds = useMemo(
    () => new Set(storeActiveIds.length > 0 ? storeActiveIds : initialActiveScreenIds),
    [storeActiveIds, initialActiveScreenIds],
  );

  // Placeholders rather than an empty card on a fresh install. Badged and
  // dimmed — an operator must never read these as screens they actually own.
  const isSample = screens.length === 0;
  const shown = isSample ? SAMPLE_SCREENS : screens;

  return (
    <>
    {isSample && (
      <div className="px-6 pb-3">
        <SampleBadge title="No screens configured yet — these are examples" />
      </div>
    )}
    <ul className={`flex flex-col divide-y divide-border ${isSample ? "opacity-50" : ""}`}>
      {shown.map((screen) => {
        const Kind = kindMeta[screen.contentKind].icon;
        const isOnline = isSample ? screen.id !== "facade" : activeScreenIds.has(screen.id);
        const status = statusMeta[isOnline ? "online" : "offline"];

        return (
          // px-6 matches CardHeader's p-6, so a row lines up under the card
          // title. The padding lives on the row and not on CardContent (which
          // this card sets to px-0) so the divide-y rules still run the full
          // width of the card instead of stopping short on both sides.
          <li key={screen.id} className="flex items-center gap-3 px-6 py-3 first:pt-0 last:pb-0">
            <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl border border-border bg-muted/60 text-foreground/80">
              <Kind className="h-4 w-4" />
            </span>
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-medium text-foreground">{screen.name}</p>
              <p className="truncate text-xs text-muted-foreground">
                {screen.content} · {screen.id}
              </p>
            </div>
            <div className="flex shrink-0 flex-col items-end gap-1.5">
              <Badge variant="outline" className="gap-1.5 font-normal">
                <span
                  className="h-1.5 w-1.5 rounded-full"
                  style={{ backgroundColor: status.color }}
                />
                {status.label}
              </Badge>
              <span className="text-[11px] text-muted-foreground">
                {isOnline ? "Live now" : "Not connected"}
              </span>
            </div>
          </li>
        );
      })}
    </ul>
    </>
  );
}

export const ScreensTable = ScreensList;
