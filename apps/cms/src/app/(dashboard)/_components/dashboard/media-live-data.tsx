"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react";
import { useCmsScreenSync } from "@/hooks/useCmsScreenSync";

/** The newest few uploads, for the "recent uploads" list. */
export interface DashboardMediaAsset {
  id: string;
  name: string;
  type: string;
  sizeBytes: number | null;
  createdAt: string;
}

/**
 * Whole-library figures, computed by the API with COUNT/SUM/GROUP BY.
 *
 * This used to be the entire media table, shipped to the browser and reduced
 * here — which meant the dashboard re-downloaded the whole library on mount, on
 * every WS reconnect, and on every browser tab focus. The aggregates are what
 * the cards actually render, so the API computes them directly
 * (GET /api/media/stats) and this payload stays small however large the
 * library grows.
 */
export interface DashboardMediaStats {
  total: number;
  totalBytes: number;
  byType: { type: string; count: number; bytes: number }[];
  recentCount: number;
  recent: DashboardMediaAsset[];
}

export type DashboardMediaGroup = "video" | "image" | "document" | "other";

const DOCUMENT_TYPES = new Set(["document", "sheet", "presentation", "word"]);

export function dashboardMediaGroup(type: string): DashboardMediaGroup {
  if (type === "video") return "video";
  if (type === "image") return "image";
  if (DOCUMENT_TYPES.has(type)) return "document";
  return "other";
}

export function formatMediaBytes(bytes: number | null): string {
  if (bytes === null) return "—";
  if (bytes === 0) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB"];
  const unit = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  const value = bytes / 1024 ** unit;
  return `${value >= 10 || unit === 0 ? value.toFixed(0) : value.toFixed(1)} ${units[unit]}`;
}

/** Roll the per-type rows up into the four groups the cards chart. */
export function groupMediaStats(byType: DashboardMediaStats["byType"]) {
  const counts = { video: 0, image: 0, document: 0, other: 0 };
  const bytes = { video: 0, image: 0, document: 0, other: 0 };
  for (const row of byType) {
    const group = dashboardMediaGroup(row.type);
    counts[group] += row.count;
    bytes[group] += row.bytes;
  }
  return { counts, bytes };
}

const DashboardMediaContext = createContext<DashboardMediaStats | null>(null);

export function DashboardMediaProvider({
  initialStats,
  children,
}: {
  initialStats: DashboardMediaStats;
  children: ReactNode;
}) {
  const [stats, setStats] = useState(initialStats);

  const refresh = useCallback(async () => {
    try {
      const response = await fetch("/api/media/stats", { cache: "no-store" });
      if (!response.ok) return;
      const data = (await response.json()) as Partial<DashboardMediaStats>;
      if (typeof data.total === "number" && Array.isArray(data.byType)) {
        setStats({
          total: data.total,
          totalBytes: data.totalBytes ?? 0,
          byType: data.byType,
          recentCount: data.recentCount ?? 0,
          recent: data.recent ?? [],
        });
      }
    } catch {
      // Keep the last known-good snapshot while the API or network reconnects.
    }
  }, []);

  useCmsScreenSync({
    onMediaLibraryUpdated: refresh,
    onConnectionChange: (connected) => {
      if (connected) void refresh();
    },
  });

  useEffect(() => {
    const refreshOnFocus = () => void refresh();
    window.addEventListener("focus", refreshOnFocus);
    return () => window.removeEventListener("focus", refreshOnFocus);
  }, [refresh]);

  return (
    <DashboardMediaContext.Provider value={stats}>
      {children}
    </DashboardMediaContext.Provider>
  );
}

export function useDashboardMedia(): DashboardMediaStats {
  const stats = useContext(DashboardMediaContext);
  if (!stats) {
    throw new Error("useDashboardMedia must be used inside DashboardMediaProvider");
  }
  return stats;
}
