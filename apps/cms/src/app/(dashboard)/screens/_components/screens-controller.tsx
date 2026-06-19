"use client";

import React, { useState, useEffect, useRef, useCallback } from "react";
import { Upload, Loader2, AlertCircle, Wifi } from "lucide-react";
import { useCmsScreenSync } from "@/hooks/useCmsScreenSync";
import type { WsContent } from "@platform/types";

interface ScreenConfig {
  id: string;
  name: string;
  contentType: "video" | "image";
  contentValue: string;
}

export function ScreensController() {
  const [screens, setScreens] = useState<ScreenConfig[]>([
    {
      id: "screen-1",
      name: "Samsung 86 inch TV",
      contentType: "image",
      contentValue: "https://images.unsplash.com/photo-1497366216548-37526070297c?auto=format&fit=crop&w=1200&q=80",
    },
    {
      id: "screen-2",
      name: "Outside Screen 1",
      contentType: "image",
      contentValue: "https://images.unsplash.com/photo-1517245386807-bb43f82c33c4?auto=format&fit=crop&w=1200&q=80",
    },
    {
      id: "screen-3",
      name: "Outside Screen 2",
      contentType: "image",
      contentValue: "https://images.unsplash.com/photo-1531403009284-440f080d1e12?auto=format&fit=crop&w=1200&q=80",
    },
  ]);

  const [isUploading, setIsUploading] = useState(false);
  const [uploadTargetId, setUploadTargetId] = useState<string | null>(null);
  const [uploadError, setUploadError] = useState<string | null>(null);
  // Tracks which screen IDs received a live update (for pulse animation)
  const [liveUpdates, setLiveUpdates] = useState<Record<string, number>>({});
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Load from localStorage on mount
  useEffect(() => {
    if (typeof window !== "undefined") {
      const savedScreens = localStorage.getItem("exhibition_screens_config_v4");
      if (savedScreens) {
        try {
          setScreens(JSON.parse(savedScreens));
        } catch (e) {
          console.error("Failed to parse saved screen configs:", e);
        }
      }
    }
  }, []);

  // Real-time sync: update a screen card when a physical screen changes its own content
  const handleScreenUpdated = useCallback((screenId: string, content: WsContent) => {
    setScreens((prev) => {
      const next = prev.map((screen) => {
        if (screen.id !== screenId) return screen;
        const contentType: "video" | "image" =
          content.type === "video" ? "video" : "image";
        return { ...screen, contentType, contentValue: content.source };
      });
      if (typeof window !== "undefined") {
        localStorage.setItem("exhibition_screens_config_v4", JSON.stringify(next));
      }
      return next;
    });
    // Trigger brief pulse on the updated card
    setLiveUpdates((prev) => ({ ...prev, [screenId]: Date.now() }));
  }, []);

  useCmsScreenSync({ onScreenUpdated: handleScreenUpdated });

  const updateScreen = (screenId: string, updates: Partial<ScreenConfig>) => {
    setScreens((prev) => {
      const next = prev.map((screen) =>
        screen.id === screenId ? { ...screen, ...updates } : screen
      );
      if (typeof window !== "undefined") {
        localStorage.setItem("exhibition_screens_config_v4", JSON.stringify(next));
      }
      return next;
    });
  };

  const triggerUpload = (screenId: string) => {
    setUploadTargetId(screenId);
    setUploadError(null);
    fileInputRef.current?.click();
  };

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !uploadTargetId) return;

    setIsUploading(true);
    setUploadError(null);

    const formData = new FormData();
    formData.append("file", file);

    try {
      const res = await fetch("/api/upload", {
        method: "POST",
        body: formData,
      });

      if (!res.ok) {
        throw new Error("Upload failed. Please try another file.");
      }

      const data = await res.json();
      if (data.success && data.filename) {
        const isVideo =
          file.type.startsWith("video/") ||
          file.name.endsWith(".mp4") ||
          file.name.endsWith(".webm") ||
          file.name.endsWith(".mov");

        updateScreen(uploadTargetId, {
          contentType: isVideo ? "video" : "image",
          contentValue: data.filename,
        });
      } else {
        throw new Error(data.error || "Failed to process uploaded file");
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "An unexpected error occurred during upload";
      setUploadError(`${uploadTargetId}:${msg}`);
    } finally {
      setIsUploading(false);
      setUploadTargetId(null);
      if (fileInputRef.current) {
        fileInputRef.current.value = "";
      }
    }
  };

  return (
    <div className="flex-1 w-full h-full flex flex-col justify-center select-none py-2 min-h-0 overflow-hidden">
      <input
        type="file"
        accept="video/*,image/*"
        ref={fileInputRef}
        onChange={handleFileUpload}
        className="hidden"
        disabled={isUploading}
      />

      <div className="grid grid-cols-1 md:grid-cols-3 gap-6 md:gap-8 w-full max-w-[1280px] mx-auto items-center">
        {screens.map((screen) => {
          const mediaUrl = screen.contentValue.startsWith("http")
            ? screen.contentValue
            : `/${screen.contentValue}`;

          const isCurrentUploading = isUploading && uploadTargetId === screen.id;
          const currentError = uploadError?.startsWith(`${screen.id}:`)
            ? uploadError.split(`${screen.id}:`)[1]
            : null;
          const hasLiveUpdate = Boolean(liveUpdates[screen.id]);

          return (
            <div
              key={screen.id}
              className="flex flex-col items-center gap-4 bg-white dark:bg-zinc-950 border border-zinc-200 dark:border-zinc-900 rounded-[28px] p-6 shadow-sm hover:border-zinc-300 dark:hover:border-zinc-800 transition-all duration-300"
            >
              <div className="flex flex-col items-center">
                <span className="text-[9px] font-bold text-zinc-400 dark:text-zinc-500 tracking-[0.25em] uppercase mb-1">
                  exhibition monitor
                </span>
                <div className="flex items-center gap-2">
                  <h3 className="text-base font-bold text-zinc-800 dark:text-zinc-200 tracking-wide uppercase">
                    {screen.name}
                  </h3>
                  {hasLiveUpdate && (
                    <span title="Updated from screen" className="flex items-center">
                      <Wifi className="h-3 w-3 text-green-500 animate-pulse" />
                    </span>
                  )}
                </div>
              </div>

              <div className="w-full aspect-[16/9] relative rounded-2xl border-4 border-zinc-800 dark:border-zinc-800 shadow-lg bg-black overflow-hidden flex items-center justify-center shrink-0">
                <div className="absolute inset-0 w-full h-full z-0 pointer-events-none">
                  {screen.contentType === "video" ? (
                    <video
                      key={screen.contentValue}
                      src={mediaUrl}
                      className="w-full h-full object-cover"
                      autoPlay
                      loop
                      muted
                      playsInline
                    />
                  ) : (
                    <img
                      key={screen.contentValue}
                      src={mediaUrl}
                      className="w-full h-full object-cover"
                      alt={screen.name}
                    />
                  )}
                </div>
              </div>

              <div className="w-full flex flex-col items-center gap-2 mt-2">
                <button
                  onClick={() => triggerUpload(screen.id)}
                  disabled={isUploading}
                  className="w-full py-3 bg-zinc-100 hover:bg-zinc-250 dark:bg-zinc-900 dark:hover:bg-zinc-850 text-zinc-800 dark:text-zinc-200 rounded-xl text-xs font-bold tracking-wider uppercase transition-all duration-200 border border-zinc-200 dark:border-zinc-800 hover:border-zinc-400 dark:hover:border-zinc-700 flex items-center justify-center gap-2 disabled:opacity-50"
                >
                  {isCurrentUploading ? (
                    <>
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      <span>Uploading...</span>
                    </>
                  ) : (
                    <>
                      <Upload className="h-3.5 w-3.5" />
                      <span>Upload Media</span>
                    </>
                  )}
                </button>

                {currentError && (
                  <div className="flex items-center gap-1 text-red-500 text-[10px] font-bold mt-1 text-center max-w-[200px]">
                    <AlertCircle className="h-3 w-3 shrink-0" />
                    <span className="truncate">{currentError}</span>
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
