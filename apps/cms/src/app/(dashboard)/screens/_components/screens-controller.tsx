"use client";

import React, { useState, useEffect } from "react";
import { 
  Tv, 
  Volume2, 
  Sun, 
  Power, 
  Video, 
  Image as ImageIcon, 
  X,
  ChevronLeft,
  ChevronRight,
  Maximize2,
  Minimize2,
  Upload,
  Loader2,
  Check
} from "lucide-react";

interface ScreenConfig {
  id: string;
  name: string;
  status: "LIVE" | "STANDBY" | "OFFLINE";
  volume: number;
  brightness: number;
  contentType: "video" | "image";
  contentValue: string;
}

export function ScreensController() {
  const [screens, setScreens] = useState<ScreenConfig[]>([
    {
      id: "screen-1",
      name: "Screen 1",
      status: "LIVE",
      volume: 80,
      brightness: 90,
      contentType: "video",
      contentValue: "experience_intro.mp4",
    },
    {
      id: "screen-2",
      name: "Screen 2",
      status: "LIVE",
      volume: 0,
      brightness: 85,
      contentType: "video",
      contentValue: "brand_solutions_loop.webm",
    },
    {
      id: "screen-3",
      name: "Screen 3",
      status: "STANDBY",
      volume: 50,
      brightness: 70,
      contentType: "image",
      contentValue: "welcome_backdrop.png",
    },
  ]);

  const [activeScreenIndex, setActiveScreenIndex] = useState(0);
  const [isFullscreen, setIsFullscreen] = useState(false);

  // Track content editing
  const [isEditing, setIsEditing] = useState(false);
  const [tempType, setTempType] = useState<"video" | "image">("video");
  const [tempValue, setTempValue] = useState<string>("");
  const [isUploading, setIsUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [uploadSuccess, setUploadSuccess] = useState<string | null>(null);

  // Load from localStorage on mount (prevents SSR hydration mismatch)
  useEffect(() => {
    if (typeof window !== "undefined") {
      const savedScreens = localStorage.getItem("exhibition_screens_config");
      if (savedScreens) {
        try {
          setScreens(JSON.parse(savedScreens));
        } catch (e) {
          console.error("Failed to parse saved screen configs:", e);
        }
      }
      const savedIndex = localStorage.getItem("exhibition_active_screen_idx");
      if (savedIndex) {
        setActiveScreenIndex(parseInt(savedIndex, 10));
      }
    }
  }, []);

  const activeScreen = screens[activeScreenIndex] || screens[0] || {
    id: "screen-1",
    name: "Screen 1",
    status: "LIVE",
    volume: 80,
    brightness: 90,
    contentType: "video",
    contentValue: "experience_intro.mp4",
  };

  // Listen for ESC key to exit fullscreen
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setIsFullscreen(false);
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, []);

  const updateActiveScreen = (updates: Partial<ScreenConfig>) => {
    setScreens((prev) => {
      const next = prev.map((screen, idx) => (idx === activeScreenIndex ? { ...screen, ...updates } : screen));
      if (typeof window !== "undefined") {
        localStorage.setItem("exhibition_screens_config", JSON.stringify(next));
      }
      return next;
    });
  };

  const startEditing = () => {
    setIsEditing(true);
    setTempType(activeScreen.contentType);
    setTempValue(activeScreen.contentValue);
    setUploadError(null);
    setUploadSuccess(null);
  };

  const saveContentChanges = () => {
    updateActiveScreen({
      contentType: tempType,
      contentValue: tempValue,
    });
    setIsEditing(false);
  };

  // Handle local file upload
  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setIsUploading(true);
    setUploadError(null);
    setUploadSuccess(null);

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
        // Sense type from filename/mime type
        const isVideo = file.type.startsWith("video/") || 
                        file.name.endsWith(".mp4") || 
                        file.name.endsWith(".webm") || 
                        file.name.endsWith(".mov");
        setTempType(isVideo ? "video" : "image");
        setTempValue(data.filename);
        setUploadSuccess(`Ready: ${data.filename}`);
      } else {
        throw new Error(data.error || "Failed to process uploaded file");
      }
    } catch (err: any) {
      setUploadError(err.message || "An unexpected error occurred during upload");
    } finally {
      setIsUploading(false);
    }
  };

  // Resolve display friendly details
  const getContentDetails = () => {
    switch (activeScreen.contentType) {
      case "video":
        return {
          icon: <Video className="h-4 w-4 text-sky-400" />,
          label: "Video Loop",
          format: activeScreen.contentValue.split(".").pop()?.toUpperCase() || "MP4",
          badgeClass: "bg-sky-500/20 text-sky-300 border border-sky-500/30",
        };
      case "image":
        return {
          icon: <ImageIcon className="h-4 w-4 text-emerald-400" />,
          label: "Static Graphic",
          format: activeScreen.contentValue.split(".").pop()?.toUpperCase() || "PNG",
          badgeClass: "bg-emerald-500/20 text-emerald-300 border border-emerald-500/30",
        };
    }
  };

  const details = getContentDetails();

  const handleNextScreen = () => {
    setIsEditing(false);
    setActiveScreenIndex((prev) => {
      const next = (prev + 1) % screens.length;
      if (typeof window !== "undefined") {
        localStorage.setItem("exhibition_active_screen_idx", next.toString());
      }
      return next;
    });
  };

  const handlePrevScreen = () => {
    setIsEditing(false);
    setActiveScreenIndex((prev) => {
      const next = (prev - 1 + screens.length) % screens.length;
      if (typeof window !== "undefined") {
        localStorage.setItem("exhibition_active_screen_idx", next.toString());
      }
      return next;
    });
  };

  const getPreviewStyle = (value: string) => {
    const ext = value.split(".").pop()?.toLowerCase();
    if (ext === "mp4" || ext === "webm" || ext === "mov") {
      return "bg-gradient-to-tr from-violet-950 via-zinc-900 to-indigo-900";
    }
    return "bg-gradient-to-tr from-teal-950 via-slate-900 to-cyan-900";
  };

  // Sub-component for rendering inner content feed (to share code between maximized and standard views)
  const renderScreenContent = () => {
    const mediaUrl = `/${activeScreen.contentValue}`;

    return (
      <div className={`absolute inset-0 w-full h-full flex flex-col justify-between p-6 transition-all duration-500 ${activeScreen.status === "OFFLINE" ? "bg-black" : getPreviewStyle(activeScreen.contentValue)}`}>
        
        {/* Actual Live Video/Image Playback Rendering */}
        {activeScreen.status !== "OFFLINE" && (
          <div className="absolute inset-0 w-full h-full pointer-events-none z-0">
            {activeScreen.contentType === "video" ? (
              <video
                key={activeScreen.contentValue}
                src={mediaUrl}
                className="w-full h-full object-cover"
                autoPlay
                loop
                muted
                playsInline
              />
            ) : (
              <img
                key={activeScreen.contentValue}
                src={mediaUrl}
                className="w-full h-full object-cover"
                alt={activeScreen.name}
              />
            )}
            {/* Overlay to dim slightly for UI legibility */}
            <div className="absolute inset-0 bg-black/15" />
          </div>
        )}

        {/* Floating Left chevron navigation INSIDE the screen */}
        <button
          onClick={handlePrevScreen}
          className="absolute left-4 top-1/2 -translate-y-1/2 z-20 w-11 h-11 bg-black/55 hover:bg-black/75 border border-white/10 text-white rounded-full transition-all hover:scale-105 active:scale-95 flex items-center justify-center shadow-lg"
          title="Previous Screen"
        >
          <ChevronLeft className="h-6 w-6 stroke-[2.5]" />
        </button>

        {/* Floating Right chevron navigation INSIDE the screen */}
        <button
          onClick={handleNextScreen}
          className="absolute right-4 top-1/2 -translate-y-1/2 z-20 w-11 h-11 bg-black/55 hover:bg-black/75 border border-white/10 text-white rounded-full transition-all hover:scale-105 active:scale-95 flex items-center justify-center shadow-lg"
          title="Next Screen"
        >
          <ChevronRight className="h-6 w-6 stroke-[2.5]" />
        </button>

        {/* Active Screen Info Header (Top overlay) */}
        {activeScreen.status !== "OFFLINE" && (
          <div className="flex justify-between items-start z-10 shrink-0 select-none">
            {/* Screen indicator and Title */}
            <div className="flex flex-col gap-1.5 bg-black/60 backdrop-blur-md border border-white/10 rounded-2xl px-4 py-2.5 text-white">
              <div className="flex items-center gap-2">
                <Tv className="h-4 w-4 text-zinc-400" />
                <span className="font-extrabold text-sm tracking-tight">{activeScreen.name}</span>
                <span
                  className={`text-[8px] font-bold w-16 text-center py-0.5 rounded-full tracking-wider transition-all shrink-0 inline-block ${
                    activeScreen.status === "LIVE"
                      ? "bg-emerald-500/20 text-emerald-300 animate-pulse"
                      : activeScreen.status === "STANDBY"
                      ? "bg-zinc-500/20 text-zinc-300"
                      : "bg-red-500/20 text-red-300"
                  }`}
                >
                  {activeScreen.status}
                </span>
              </div>
              
              {/* Dots indicator */}
              <div className="flex gap-1 mt-1">
                {screens.map((_, idx) => (
                  <span
                    key={idx}
                    className={`h-1 rounded-full transition-all ${idx === activeScreenIndex ? "w-4 bg-white" : "w-1 bg-white/30"
                      }`}
                  />
                ))}
              </div>
            </div>

            {/* Media Format Metadata Tag */}
            <div className="bg-black/60 backdrop-blur-md border border-white/10 rounded-2xl px-4 py-2.5 flex items-center gap-2 text-white">
              {details.icon}
              <div className="text-left leading-none">
                <p className="text-[9px] text-zinc-400 font-bold uppercase mb-0.5">{details.label}</p>
                <p className="text-xs text-white font-extrabold truncate max-w-[150px]">{activeScreen.contentValue}</p>
              </div>
              <span className={`text-[9px] font-mono px-1.5 py-0.5 rounded font-bold shadow-sm ${details.badgeClass}`}>
                {details.format}
              </span>
            </div>
          </div>
        )}

        {/* Centered Controller/Offline HUD/Content Editor Overlay */}
        <div className="flex-1 flex items-center justify-center z-10 min-h-0">
          {activeScreen.status === "OFFLINE" ? (
            <div className="flex flex-col items-center gap-3 text-center">
              <div className="h-14 w-14 rounded-full bg-zinc-900 border border-zinc-800 flex items-center justify-center text-red-500 shadow-inner">
                <Power className="h-6 w-6" />
              </div>
              <div>
                <h4 className="text-zinc-400 font-bold text-sm">Display Screen Offline</h4>
                <p className="text-[11px] text-zinc-550">Power on display feed to configure settings.</p>
              </div>
              <button
                onClick={() => updateActiveScreen({ status: "LIVE" })}
                className="mt-2 py-2 px-6 bg-white hover:bg-zinc-200 text-black rounded-xl text-xs font-bold transition-all shadow-md animate-bounce"
              >
                Power On Display
              </button>
            </div>
          ) : isEditing ? (
            <div className="bg-black/85 backdrop-blur-lg border border-white/10 p-5 rounded-3xl w-full max-w-[350px] flex flex-col gap-3 text-white shadow-2xl animate-in fade-in zoom-in-95 duration-200">
              <div className="flex items-center justify-between border-b border-white/10 pb-2">
                <h4 className="text-[10px] font-bold uppercase tracking-wider text-zinc-400">Configure Screen Feed</h4>
                <button onClick={() => setIsEditing(false)} className="text-zinc-400 hover:text-white">
                  <X className="h-4 w-4" />
                </button>
              </div>

              {/* Only Local File Upload view */}
              <div className="flex flex-col gap-3 animate-in fade-in duration-150 py-1">
                <label className="text-[9px] font-bold text-zinc-400 uppercase tracking-wider">Upload New Media File</label>
                
                <label className="border border-dashed border-white/20 hover:border-white/45 rounded-2xl p-6 flex flex-col items-center justify-center gap-2 cursor-pointer transition-colors bg-white/5">
                  <input
                    type="file"
                    accept="video/*,image/*"
                    onChange={handleFileUpload}
                    className="hidden"
                    disabled={isUploading}
                  />
                  {isUploading ? (
                    <>
                      <Loader2 className="h-6 w-6 text-zinc-400 animate-spin" />
                      <span className="text-[10px] text-zinc-400">Uploading to workspace...</span>
                    </>
                  ) : uploadSuccess ? (
                    <>
                      <Check className="h-6 w-6 text-emerald-400" />
                      <span className="text-[10px] text-emerald-300 font-bold text-center truncate max-w-[220px]">
                        {uploadSuccess}
                      </span>
                    </>
                  ) : (
                    <>
                      <Upload className="h-6 w-6 text-zinc-400" />
                      <span className="text-[10px] text-zinc-350 font-bold">Choose video or image file</span>
                      <span className="text-[8px] text-zinc-500">Supports MP4, WEBM, MOV, PNG, JPG, SVG</span>
                    </>
                  )}
                </label>

                {uploadError && (
                  <p className="text-[9px] text-red-400 font-bold leading-tight">{uploadError}</p>
                )}
              </div>

              {/* Action save */}
              <div className="flex gap-2 justify-end mt-1 border-t border-white/10 pt-3">
                <button
                  onClick={() => setIsEditing(false)}
                  className="px-3.5 py-1.5 bg-white/10 hover:bg-white/20 text-white text-xs font-bold rounded-lg transition-colors"
                >
                  Cancel
                </button>
                <button
                  onClick={saveContentChanges}
                  disabled={isUploading || !uploadSuccess}
                  className="px-4 py-1.5 bg-white hover:bg-zinc-200 text-black text-xs font-bold rounded-lg transition-colors disabled:opacity-40"
                >
                  Save Changes
                </button>
              </div>
            </div>
          ) : (
            <div className="opacity-0 hover:opacity-100 transition-opacity duration-300 inset-0 absolute flex items-center justify-center bg-black/10 pointer-events-none" />
          )}
        </div>

        {/* Bottom Control HUD Overlay Panel inside simulated display preview */}
        {activeScreen.status !== "OFFLINE" && !isEditing && (
          <div className="bg-black/60 backdrop-blur-md border border-white/10 rounded-2xl p-4 flex flex-col md:flex-row items-center gap-4 z-10 shrink-0 select-none text-white shadow-lg">
            
            {/* Range sliders container */}
            <div className="flex-1 w-full grid grid-cols-2 gap-4">
              {/* Brightness inside Preview */}
              <div className="flex flex-col gap-1">
                <div className="flex items-center justify-between text-[10px] font-bold text-zinc-300">
                  <div className="flex items-center gap-1.5">
                    <Sun className="h-3.5 w-3.5" />
                    <span>Brightness Control</span>
                  </div>
                  <span className="font-mono text-white w-8 text-right shrink-0">{activeScreen.brightness}%</span>
                </div>
                <input
                  type="range"
                  min="0"
                  max="100"
                  value={activeScreen.brightness}
                  onChange={(e) => updateActiveScreen({ brightness: parseInt(e.target.value) })}
                  className="w-full h-1 bg-white/25 rounded-lg appearance-none cursor-pointer accent-white"
                />
              </div>

              {/* Volume inside Preview */}
              <div className="flex flex-col gap-1">
                <div className="flex items-center justify-between text-[10px] font-bold text-zinc-300">
                  <div className="flex items-center gap-1.5">
                    <Volume2 className="h-3.5 w-3.5" />
                    <span>Volume Control</span>
                  </div>
                  <span className="font-mono text-white w-8 text-right shrink-0">{activeScreen.volume}%</span>
                </div>
                <input
                  type="range"
                  min="0"
                  max="100"
                  value={activeScreen.volume}
                  onChange={(e) => updateActiveScreen({ volume: parseInt(e.target.value) })}
                  className="w-full h-1 bg-white/25 rounded-lg appearance-none cursor-pointer accent-white"
                />
              </div>
            </div>

            {/* Action Buttons inside Preview */}
            <div className="flex items-center gap-2 shrink-0 w-full md:w-auto justify-end border-t md:border-t-0 pt-2 md:pt-0 border-white/10">
              <button
                onClick={startEditing}
                className="w-32 py-1.5 bg-white/10 hover:bg-white/20 border border-white/10 text-white rounded-xl text-xs font-bold transition-all text-center shrink-0"
              >
                Change Media
              </button>
              <button
                onClick={() => updateActiveScreen({ status: activeScreen.status === "LIVE" ? "STANDBY" : "LIVE" })}
                className="w-28 py-1.5 bg-white hover:bg-zinc-200 text-black rounded-xl text-xs font-bold transition-all text-center shrink-0"
              >
                {activeScreen.status === "LIVE" ? "Standby" : "Live"}
              </button>
              <button
                onClick={() => updateActiveScreen({ status: "OFFLINE" })}
                className="w-10 h-8 flex items-center justify-center bg-red-500/25 hover:bg-red-500/40 text-red-300 rounded-xl transition-all border border-red-500/30 shrink-0"
                title="Power Off"
              >
                <Power className="h-4 w-4" />
              </button>

              {/* Maximize/Minimize Toggle button */}
              <button
                onClick={() => setIsFullscreen(!isFullscreen)}
                className="w-10 h-8 flex items-center justify-center bg-white/10 hover:bg-white/20 border border-white/10 text-white rounded-xl transition-all shrink-0"
                title={isFullscreen ? "Exit Fullscreen" : "Maximize Preview"}
              >
                {isFullscreen ? <Minimize2 className="h-4 w-4" /> : <Maximize2 className="h-4 w-4" />}
              </button>
            </div>
          </div>
        )}

      </div>
    );
  };

  // Maximized/Fullscreen Overlay view
  if (isFullscreen) {
    return (
      <div className="fixed inset-0 z-[100] bg-black w-screen h-screen flex items-center justify-center select-none overflow-hidden animate-in fade-in duration-200">
        <div className="w-full h-full relative overflow-hidden">
          {renderScreenContent()}
        </div>
      </div>
    );
  }

  // Normal inline dashboard view
  return (
    <div className="flex-1 w-full min-h-0 flex items-center justify-center pt-2 pb-4">
      {/* Outer physical display enclosure - STABLE aspect size scaled up for maximum view */}
      <div className="w-full max-w-[960px] aspect-[16/9] relative rounded-[32px] border-8 border-zinc-800 dark:border-zinc-800 shadow-2xl bg-black overflow-hidden shrink-0 transition-all">
        {renderScreenContent()}
      </div>
    </div>
  );
}