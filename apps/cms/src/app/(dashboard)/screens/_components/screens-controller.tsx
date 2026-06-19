"use client";

import React, { useState, useEffect, useRef } from "react";
import { Upload, Loader2, AlertCircle } from "lucide-react";

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
      name: "Outside Screen",
      contentType: "image",
      contentValue: "https://images.unsplash.com/photo-1517245386807-bb43f82c33c4?auto=format&fit=crop&w=1200&q=80",
    },

  ]);

  const [isUploading, setIsUploading] = useState(false);
  const [uploadTargetId, setUploadTargetId] = useState<string | null>(null);
  const [uploadError, setUploadError] = useState<string | null>(null);
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
    } catch (err: any) {
      setUploadError(`${uploadTargetId}:${err.message || "An unexpected error occurred during upload"}`);
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
      {/* Hidden file input */}
      <input
        type="file"
        accept="video/*,image/*"
        ref={fileInputRef}
        onChange={handleFileUpload}
        className="hidden"
        disabled={isUploading}
      />

      {/* 2-Column Screen Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6 md:gap-8 w-full h-full items-stretch min-h-0">
        {screens.map((screen) => {
          const mediaUrl = screen.contentValue.startsWith("http")
            ? screen.contentValue
            : `/${screen.contentValue}`;

          const isCurrentUploading = isUploading && uploadTargetId === screen.id;
          const currentError = uploadError?.startsWith(`${screen.id}:`)
            ? uploadError.split(`${screen.id}:`)[1]
            : null;

          return (
            <div
              key={screen.id}
              className="flex flex-col items-center justify-between gap-4 bg-[#d6d6d6] dark:bg-zinc-900 border border-zinc-350/30 dark:border-zinc-800/40 rounded-[28px] p-6 shadow-sm hover:bg-[#c8c8c8]/80 dark:hover:bg-zinc-850/50 hover:border-zinc-400/40 dark:hover:border-zinc-700/60 transition-all duration-300 h-full w-full min-h-0"
            >
              {/* Screen Title */}
              <div className="flex flex-col items-center shrink-0">
                <span className="text-[9px] font-bold text-zinc-500 dark:text-zinc-400 tracking-[0.25em] uppercase mb-1">
                  exhibition monitor
                </span>
                <h3 className="text-base font-bold text-zinc-900 dark:text-zinc-50 tracking-wide uppercase">
                  {screen.name}
                </h3>
              </div>

              {/* Screen Display Preview Box */}
              <div className="w-full flex-1 relative rounded-2xl border-4 border-zinc-950 dark:border-zinc-950 shadow-lg bg-black overflow-hidden flex items-center justify-center min-h-0">
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

              {/* Upload Button */}
              <div className="w-full flex flex-col items-center gap-2 mt-2 shrink-0">
                <button
                  onClick={() => triggerUpload(screen.id)}
                  disabled={isUploading}
                  className="w-full py-3 bg-[#8a8a8a] hover:bg-[#7a7a7a] dark:bg-zinc-800 dark:hover:bg-zinc-700 text-white rounded-xl text-xs font-bold tracking-wider uppercase transition-all duration-200 flex items-center justify-center gap-2 disabled:opacity-50"
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