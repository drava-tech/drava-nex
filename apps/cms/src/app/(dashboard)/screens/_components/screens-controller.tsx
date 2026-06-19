"use client";

import React, { useState, useEffect, useRef, useCallback } from "react";
import { Upload, Loader2, AlertCircle, Wifi, Layers } from "lucide-react";
import { useCmsScreenSync } from "@/hooks/useCmsScreenSync";
import { broadcastWsContentDirect } from "@/lib/broadcast";
import { ScreenAssignmentPicker } from "./screens-assignment-picker";
import type { WsContent } from "@platform/types";

interface ScreenConfig {
  id: string;
  name: string;
  contentType: "video" | "image";
  contentValue: string;
  contentLabel?: string;
}

const defaultScreens: ScreenConfig[] = [
  { id: "screen-1", name: "Main Exhibition Screen", contentType: "image", contentValue: "", contentLabel: undefined },
  { id: "screen-2", name: "Lobby Screen", contentType: "image", contentValue: "", contentLabel: undefined },
];

const STORAGE_KEY = "exhibition_screens_config_v5";

export function ScreensController() {
  const [screens, setScreens] = useState<ScreenConfig[]>(defaultScreens);
  const [pickerTargetId, setPickerTargetId] = useState<string | null>(null);
  const [isUploading, setIsUploading] = useState(false);
  const [uploadTargetId, setUploadTargetId] = useState<string | null>(null);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [liveUpdates, setLiveUpdates] = useState<Record<string, number>>({});
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved) {
      try { setScreens(JSON.parse(saved)); } catch { /* ignore */ }
    }
  }, []);

  const persist = (next: ScreenConfig[]) => {
    if (typeof window !== "undefined") {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
    }
  };

  const updateScreen = (id: string, updates: Partial<ScreenConfig>) => {
    setScreens((prev) => {
      const next = prev.map((s) => s.id === id ? { ...s, ...updates } : s);
      persist(next);
      return next;
    });
  };

  // Live sync from physical screens
  const handleScreenUpdated = useCallback((screenId: string, content: WsContent) => {
    const contentType: "video" | "image" = content.type === "video" ? "video" : "image";
    updateScreen(screenId, {
      contentType,
      contentValue: content.source,
      contentLabel: content.title,
    });
    setLiveUpdates((prev) => ({ ...prev, [screenId]: Date.now() }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useCmsScreenSync({ onScreenUpdated: handleScreenUpdated });

  // Assignment from picker
  const handleAssign = async (screenId: string, content: WsContent) => {
    const contentType: "video" | "image" = content.type === "video" ? "video" : "image";
    updateScreen(screenId, {
      contentType,
      contentValue: content.source,
      contentLabel: content.title,
    });
    setPickerTargetId(null);
    await broadcastWsContentDirect(screenId, content);
  };

  // File upload
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
      const res = await fetch("/api/upload", { method: "POST", body: formData });
      if (!res.ok) throw new Error("Upload failed. Please try another file.");
      const data = await res.json();
      if (data.success && data.filename) {
        const isVideo = file.type.startsWith("video/") || /\.(mp4|webm|mov)$/.test(file.name);
        updateScreen(uploadTargetId, {
          contentType: isVideo ? "video" : "image",
          contentValue: data.filename,
          contentLabel: file.name,
        });
      } else {
        throw new Error(data.error || "Failed to process uploaded file");
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "An unexpected error occurred";
      setUploadError(`${uploadTargetId}:${msg}`);
    } finally {
      setIsUploading(false);
      setUploadTargetId(null);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  };

  const pickerTarget = screens.find((s) => s.id === pickerTargetId) ?? null;

  return (
    <>
      <input
        type="file"
        accept="video/*,image/*"
        ref={fileInputRef}
        onChange={handleFileUpload}
        className="hidden"
        disabled={isUploading}
      />

      {/* Picker modal */}
      {pickerTarget && (
        <ScreenAssignmentPicker
          screenName={pickerTarget.name}
          currentContentLabel={pickerTarget.contentLabel}
          onAssign={(content) => handleAssign(pickerTarget.id, content)}
          onClose={() => setPickerTargetId(null)}
        />
      )}

      <div className="flex-1 w-full h-full flex flex-col justify-center select-none py-2 min-h-0 overflow-hidden">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6 md:gap-10 w-full max-w-[900px] mx-auto items-center">
          {screens.map((screen) => {
            const hasContent = Boolean(screen.contentValue);
            const mediaUrl = screen.contentValue.startsWith("http")
              ? screen.contentValue
              : screen.contentValue ? `/${screen.contentValue}` : "";
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
                {/* Header */}
                <div className="flex flex-col items-center">
                  <span className="text-[9px] font-bold text-zinc-400 dark:text-zinc-500 tracking-[0.25em] uppercase mb-1">
                    exhibition monitor
                  </span>
                  <div className="flex items-center gap-2">
                    <h3 className="text-base font-bold text-zinc-800 dark:text-zinc-200 tracking-wide uppercase">
                      {screen.name}
                    </h3>
                    {hasLiveUpdate && (
                      <span title="Updated from screen">
                        <Wifi className="h-3 w-3 text-green-500 animate-pulse" />
                      </span>
                    )}
                  </div>
                </div>

                {/* Preview */}
                <div className="w-full aspect-[16/9] relative rounded-2xl border-4 border-zinc-800 shadow-lg bg-zinc-950 overflow-hidden flex items-center justify-center shrink-0">
                  {hasContent && mediaUrl ? (
                    <div className="absolute inset-0">
                      {screen.contentType === "video" ? (
                        <video
                          key={mediaUrl}
                          src={mediaUrl}
                          className="w-full h-full object-cover"
                          autoPlay
                          loop
                          muted
                          playsInline
                        />
                      ) : (
                        <img
                          key={mediaUrl}
                          src={mediaUrl}
                          className="w-full h-full object-cover"
                          alt={screen.name}
                        />
                      )}
                    </div>
                  ) : (
                    /* Idle placeholder */
                    <div className="flex flex-col items-center gap-2 text-zinc-700">
                      <Layers className="h-6 w-6" />
                      <span className="text-[10px] font-bold tracking-widest uppercase">
                        No content assigned
                      </span>
                    </div>
                  )}

                  {/* Content label badge */}
                  {screen.contentLabel && (
                    <div className="absolute bottom-2 left-2 flex items-center gap-1.5 bg-black/70 backdrop-blur-sm rounded-full px-2.5 py-1">
                      <span className="w-1.5 h-1.5 rounded-full bg-green-400" />
                      <span className="text-[10px] font-semibold text-white tracking-wide">
                        {screen.contentLabel}
                      </span>
                    </div>
                  )}
                </div>

                {/* Actions */}
                <div className="w-full flex flex-col gap-2">
                  {/* Assign / Change */}
                  <button
                    onClick={() => setPickerTargetId(screen.id)}
                    className="w-full py-3 bg-zinc-900 hover:bg-zinc-800 text-zinc-100 rounded-xl text-xs font-bold tracking-wider uppercase transition-all duration-200 border border-zinc-700 hover:border-zinc-500 flex items-center justify-center gap-2"
                  >
                    <Layers className="h-3.5 w-3.5" />
                    <span>{hasContent ? "Change Content" : "Assign Content"}</span>
                  </button>

                  {/* Upload */}
                  <button
                    onClick={() => triggerUpload(screen.id)}
                    disabled={isUploading}
                    className="w-full py-2.5 bg-zinc-100 dark:bg-zinc-900/50 text-zinc-600 dark:text-zinc-400 rounded-xl text-[10px] font-bold tracking-wider uppercase transition-all duration-200 border border-zinc-200 dark:border-zinc-800 hover:border-zinc-400 dark:hover:border-zinc-700 flex items-center justify-center gap-2 disabled:opacity-50"
                  >
                    {isCurrentUploading ? (
                      <>
                        <Loader2 className="h-3 w-3 animate-spin" />
                        <span>Uploading...</span>
                      </>
                    ) : (
                      <>
                        <Upload className="h-3 w-3" />
                        <span>Upload Media</span>
                      </>
                    )}
                  </button>

                  {currentError && (
                    <div className="flex items-center gap-1 text-red-500 text-[10px] font-bold text-center">
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
    </>
  );
}
