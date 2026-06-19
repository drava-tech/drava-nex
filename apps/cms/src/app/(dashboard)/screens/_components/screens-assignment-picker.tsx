"use client";

import { useState, useEffect } from "react";
import { X, Check } from "lucide-react";
import type { WsContent } from "@platform/types";

interface ContentItem {
  id: string;
  title: string;
  videoUrl: string;
  thumbnailUrl: string;
  source: "portfolio" | "uploaded";
}

interface ScreenAssignmentPickerProps {
  screenName: string;
  currentContentLabel?: string;
  onAssign: (content: WsContent) => void;
  onClose: () => void;
}

export function ScreenAssignmentPicker({
  screenName,
  currentContentLabel,
  onAssign,
  onClose,
}: ScreenAssignmentPickerProps) {
  const [portfolioItems, setPortfolioItems] = useState<ContentItem[]>([]);
  const [loadingPortfolio, setLoadingPortfolio] = useState(true);
  const [uploadedItems, setUploadedItems] = useState<ContentItem[]>([]);

  // Fetch portfolio verticals from the backend DB via API
  useEffect(() => {
    fetch("/api/projects")
      .then((r) => r.json())
      .then((data) => {
        setPortfolioItems(
          (data.verticals ?? []).map((v: { id: string; title: string; videoUrl: string; thumbnailUrl: string }) => ({
            id: v.id,
            title: v.title,
            videoUrl: v.videoUrl,
            thumbnailUrl: v.thumbnailUrl,
            source: "portfolio" as const,
          }))
        );
      })
      .catch(() => setPortfolioItems([]))
      .finally(() => setLoadingPortfolio(false));
  }, []);

  // Fetch uploaded items via the CMS Next.js API route
  useEffect(() => {
    fetch("/api/contents")
      .then((r) => r.json())
      .then((data) => {
        const items: ContentItem[] = (data.contents ?? [])
          .filter((c: { source?: string }) => c.source)
          .map((c: { id: string; source: string; title?: string }) => ({
            id: c.id,
            title: c.title ?? c.id,
            videoUrl: c.source,
            thumbnailUrl: "",
            source: "uploaded" as const,
          }));
        setUploadedItems(items);
      })
      .catch(() => setUploadedItems([]));
  }, []);

  const handleSelect = (item: ContentItem) => {
    onAssign({
      id: item.id,
      type: "video",
      source: item.videoUrl,
      title: item.title,
      loop: true,
      muted: true,
    });
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-end md:items-center justify-center"
      onClick={onClose}
    >
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/70 backdrop-blur-sm" />

      {/* Panel */}
      <div
        className="relative w-full max-w-2xl bg-zinc-950 border border-zinc-800 rounded-t-3xl md:rounded-3xl p-6 max-h-[80vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between mb-6">
          <div>
            <p className="text-[9px] font-bold text-zinc-500 tracking-[0.25em] uppercase mb-0.5">
              assign content
            </p>
            <h2 className="text-base font-bold text-zinc-100 tracking-wide">
              {screenName}
            </h2>
          </div>
          <button
            onClick={onClose}
            className="p-2 rounded-xl bg-zinc-900 hover:bg-zinc-800 text-zinc-400 hover:text-zinc-200 transition-colors"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Portfolio section */}
        <div className="mb-6">
          <p className="text-[9px] font-bold text-zinc-500 tracking-[0.2em] uppercase mb-3">
            Portfolio · The White Tusker
          </p>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            {loadingPortfolio
              ? Array.from({ length: 3 }).map((_, i) => (
                  <div key={i} className="rounded-2xl overflow-hidden border border-zinc-800 animate-pulse">
                    <div className="aspect-video bg-zinc-800" />
                    <div className="p-3 bg-zinc-900">
                      <div className="h-3 w-24 bg-zinc-700 rounded" />
                    </div>
                  </div>
                ))
              : portfolioItems.map((item) => {
                  const isActive = currentContentLabel === item.title;
                  return (
                    <button
                      key={item.id}
                      onClick={() => handleSelect(item)}
                      className={`relative group flex flex-col rounded-2xl overflow-hidden border transition-all duration-200 text-left
                        ${isActive
                          ? "border-zinc-300 ring-1 ring-zinc-300"
                          : "border-zinc-800 hover:border-zinc-600"
                        }`}
                    >
                      <div className="aspect-video bg-zinc-900 overflow-hidden">
                        <img
                          src={item.thumbnailUrl}
                          alt={item.title}
                          className="w-full h-full object-cover opacity-80 group-hover:opacity-100 transition-opacity"
                        />
                      </div>
                      <div className="flex items-center justify-between p-3 bg-zinc-900">
                        <span className="text-xs font-semibold text-zinc-200 leading-tight">
                          {item.title}
                        </span>
                        {isActive && (
                          <Check className="h-3.5 w-3.5 text-green-400 shrink-0 ml-2" />
                        )}
                      </div>
                    </button>
                  );
                })}
          </div>
        </div>

        {/* Uploaded section */}
        {uploadedItems.length > 0 && (
          <div>
            <p className="text-[9px] font-bold text-zinc-500 tracking-[0.2em] uppercase mb-3">
              Uploaded Media
            </p>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
              {uploadedItems.map((item) => {
                const isActive = currentContentLabel === item.title;
                return (
                  <button
                    key={item.id}
                    onClick={() => handleSelect(item)}
                    className={`rounded-xl border p-3 text-left transition-colors
                      ${isActive
                        ? "border-zinc-300 bg-zinc-800"
                        : "border-zinc-800 bg-zinc-900 hover:border-zinc-600"
                      }`}
                  >
                    <p className="text-[10px] font-bold text-zinc-400 uppercase tracking-widest mb-1">
                      video
                    </p>
                    <p className="text-xs text-zinc-200 truncate">{item.title}</p>
                    {isActive && <Check className="h-3 w-3 text-green-400 mt-1" />}
                  </button>
                );
              })}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
