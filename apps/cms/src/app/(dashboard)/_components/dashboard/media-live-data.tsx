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

export interface DashboardMediaAsset {
  id: string;
  name: string;
  type: string;
  sizeBytes: number | null;
  createdAt: string;
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

const DashboardMediaContext = createContext<DashboardMediaAsset[] | null>(null);

export function DashboardMediaProvider({
  initialAssets,
  children,
}: {
  initialAssets: DashboardMediaAsset[];
  children: ReactNode;
}) {
  const [assets, setAssets] = useState(initialAssets);

  const refresh = useCallback(async () => {
    try {
      const response = await fetch("/api/media", { cache: "no-store" });
      if (!response.ok) return;
      const data = (await response.json()) as { media?: DashboardMediaAsset[] };
      if (Array.isArray(data.media)) setAssets(data.media);
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
    <DashboardMediaContext.Provider value={assets}>
      {children}
    </DashboardMediaContext.Provider>
  );
}

export function useDashboardMedia(): DashboardMediaAsset[] {
  const assets = useContext(DashboardMediaContext);
  if (!assets) {
    throw new Error("useDashboardMedia must be used inside DashboardMediaProvider");
  }
  return assets;
}
