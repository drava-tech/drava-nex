"use client";

import React, { useEffect, useMemo } from "react";
import { Film, Layers, Radio, Slash } from "lucide-react";
import { LiquidPill } from "./liquid-pill";
import type { ScreenRow } from "@platform/db";
import { useAppDispatch, useAppSelector } from "@/store/hooks";
import { screensHydrated, activeScreensUpdated } from "@/store/screens-slice";

type ContentKind = "experience" | "live-stream" | "media" | "none";
type ScreenStatus = "online" | "offline";



interface ScreenDetail {
  id: string;
  name: string;
  content: string;
  contentKind: ContentKind;
}

const kindMeta: Record<ContentKind, { icon: typeof Layers; label: string }> = {
  experience: { icon: Layers, label: "Experience" },
  "live-stream": { icon: Radio, label: "Live" },
  media: { icon: Film, label: "Media" },
  none: { icon: Slash, label: "—" },
};

const statusMeta: Record<ScreenStatus, { label: string; color: string }> = {
  online: { label: "Online", color: "#10b981" },
  offline: { label: "Offline", color: "#f43f5e" },
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

  if (screens.length === 0) {
    return (
      <p className="py-6 text-center text-sm text-slate-400">
        No screens configured
      </p>
    );
  }

  return (
    <ul className="flex flex-col divide-y divide-white/5">
      {screens.map((screen) => {
        const Kind = kindMeta[screen.contentKind].icon;
        const isOnline = activeScreenIds.has(screen.id);
        const status = statusMeta[isOnline ? "online" : "offline"];

        return (
          <li key={screen.id} className="flex items-center gap-3 py-3 first:pt-0 last:pb-0">
            <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl border border-white/10 bg-white/5 text-slate-300">
              <Kind className="h-4 w-4" />
            </span>
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-medium text-white">{screen.name}</p>
              <p className="truncate text-xs text-slate-400">
                {screen.content} · {screen.id}
              </p>
            </div>
            <div className="flex shrink-0 flex-col items-end gap-1.5">
              <LiquidPill>
                <span
                  className="h-1.5 w-1.5 rounded-full"
                  style={{ backgroundColor: status.color }}
                />
                {status.label}
              </LiquidPill>
              <span className="text-[11px] text-slate-500">
                {isOnline ? "Live now" : "Not connected"}
              </span>
            </div>
          </li>
        );
      })}
    </ul>
  );
}

export const ScreensTable = ScreensList;
