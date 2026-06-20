"use client";

import React, { useState, useEffect, useCallback } from "react";
import { Layers, Wifi, Plus, Trash2, Monitor } from "lucide-react";
import { useRouter } from "next/navigation";
import { useCmsScreenSync } from "@/hooks/useCmsScreenSync";
import { removeScreen, assignExperience, assignMedia, sendRemoteCommand } from "@/actions/screen-actions";
import { ScreenAssignmentPicker } from "./screens-assignment-picker";
import { AddScreenModal } from "./add-screen-modal";
import type { WsContent } from "@platform/types";

interface ScreenConfig {
  id: string;
  name: string;
  contentType: "video" | "image" | "experience";
  contentValue: string;
  contentLabel?: string;
}

interface ScreensControllerProps {
  initialScreens: {
    screenId: string;
    screenName: string;
    currentExperienceId: string | null;
    experienceName: string | null;
  }[];
  isAdmin: boolean;
  experiences: { id: string; title: string }[];
  initialActiveScreenIds?: string[];
}

function parseExperienceInfo(currentExperienceId: string | null, experienceName: string | null): {
  contentType: "video" | "image" | "experience";
  contentValue: string;
  contentLabel?: string;
} {
  if (!currentExperienceId || !experienceName) {
    return {
      contentType: "image",
      contentValue: "",
      contentLabel: undefined,
    };
  }

  if (experienceName.startsWith("[MEDIA:video] ")) {
    const filename = experienceName.replace("[MEDIA:video] ", "");
    return {
      contentType: "video",
      contentValue: filename.startsWith("http") ? filename : `/media/${filename}`,
      contentLabel: filename.startsWith("http") ? filename.split("/").pop()?.split("?")[0] : filename,
    };
  }

  if (experienceName.startsWith("[MEDIA:image] ")) {
    const filename = experienceName.replace("[MEDIA:image] ", "");
    return {
      contentType: "image",
      contentValue: filename.startsWith("http") ? filename : `/media/${filename}`,
      contentLabel: filename.startsWith("http") ? filename.split("/").pop()?.split("?")[0] : filename,
    };
  }

  return {
    contentType: "experience",
    contentValue: currentExperienceId,
    contentLabel: experienceName,
  };
}

export function ScreensController({
  initialScreens,
  isAdmin,
  experiences,
  initialActiveScreenIds = [],
}: ScreensControllerProps) {
  const router = useRouter();

  const [screens, setScreens] = useState<ScreenConfig[]>(() =>
    initialScreens.map(({ screenId, screenName, currentExperienceId, experienceName }) => {
      const info = parseExperienceInfo(currentExperienceId, experienceName);
      return {
        id: screenId,
        name: screenName,
        ...info,
      };
    })
  );
  const [pickerTargetId, setPickerTargetId] = useState<string | null>(null);
  const [showAddModal, setShowAddModal] = useState(false);
  const [liveUpdates, setLiveUpdates] = useState<Record<string, number>>({});
  const [activeScreenIds, setActiveScreenIds] = useState<Set<string>>(() => new Set(initialActiveScreenIds));

  // Re-sync state whenever the server-provided screen list changes (e.g. after add/remove)
  useEffect(() => {
    setScreens(
      initialScreens.map(({ screenId, screenName, currentExperienceId, experienceName }) => {
        const info = parseExperienceInfo(currentExperienceId, experienceName);
        return {
          id: screenId,
          name: screenName,
          ...info,
        };
      })
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [JSON.stringify(initialScreens)]);

  const updateScreen = (id: string, updates: Partial<ScreenConfig>) => {
    setScreens((prev) => prev.map((s) => s.id === id ? { ...s, ...updates } : s));
  };

  const handleScreenUpdated = useCallback((screenId: string, content: WsContent) => {
    const contentType: ScreenConfig["contentType"] =
      content.type === "video" ? "video" :
        content.type === "experience" ? "experience" : "image";
    
    // For video/image from live sync, content.source is already full url/path
    updateScreen(screenId, { contentType, contentValue: content.source, contentLabel: content.title });
    setLiveUpdates((prev) => ({ ...prev, [screenId]: Date.now() }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useCmsScreenSync({
    onScreenUpdated: handleScreenUpdated,
    onActiveScreensUpdated: (ids) => {
      setActiveScreenIds(new Set(ids));
    },
  });

  const handleAssign = async (screenId: string, content: WsContent) => {
    const contentType: ScreenConfig["contentType"] =
      content.type === "video" ? "video" :
        content.type === "experience" ? "experience" : "image";

    const contentValue = content.type === "experience" ? content.id : content.source;

    updateScreen(screenId, { 
      contentType, 
      contentValue, 
      contentLabel: content.title 
    });
    setPickerTargetId(null);

    if (content.type === "video" || content.type === "image") {
      // It's a media asset. content.title is the filename.
      await assignMedia(screenId, content.title ?? "", content.type);
    } else {
      // content.id is the experience id; write DB + push happen server-side.
      await assignExperience(screenId, content.id);
    }
  };

  const pickerTarget = screens.find((s) => s.id === pickerTargetId) ?? null;

  return (
    <>
      {pickerTarget && (
        <ScreenAssignmentPicker
          screenName={pickerTarget.name}
          currentContentLabel={pickerTarget.contentLabel}
          experiences={experiences}
          onAssign={(content) => handleAssign(pickerTarget.id, content)}
          onClose={() => setPickerTargetId(null)}
        />
      )}

      {showAddModal && (
        <AddScreenModal
          onClose={() => setShowAddModal(false)}
          onAdded={() => { setShowAddModal(false); router.refresh(); }}
        />
      )}

      <div className="flex-1 w-full h-full flex flex-col select-none min-h-0 overflow-y-auto py-2">
        <div className="w-full max-w-full mx-auto px-4 md:px-8">
          {/* Add screen row — admin only */}
          {isAdmin && (
            <div className="flex justify-end mb-6">
              <button
                onClick={() => setShowAddModal(true)}
                className="flex items-center gap-2 px-4 py-2 rounded-xl bg-zinc-900 hover:bg-zinc-800 dark:bg-zinc-100 dark:hover:bg-zinc-300 dark:text-zinc-900 text-zinc-100 text-xs font-bold tracking-wider uppercase transition-colors"
              >
                <Plus className="h-3.5 w-3.5" />
                Add Screen
              </button>
            </div>
          )}

          {screens.length === 0 ? (
            <div className="flex flex-col items-center justify-center gap-3 py-24 text-center">
              <Layers className="h-8 w-8 text-zinc-400" />
              <p className="text-sm font-semibold text-zinc-500 uppercase tracking-widest">No screens yet</p>
              <p className="text-xs text-zinc-400">Add your first screen to get started.</p>
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6 md:gap-8 items-start">
              {screens.map((screen) => {
                const hasLiveUpdate = Boolean(liveUpdates[screen.id]);
                const isAssigned = Boolean(screen.contentLabel);
                const isOnline = activeScreenIds.has(screen.id);

                return (
                  <div
                    key={screen.id}
                    className={`flex flex-col items-center gap-4 bg-white dark:bg-zinc-950 border rounded-[28px] p-6 shadow-sm transition-all duration-300
                      ${isOnline
                        ? "border-green-200 dark:border-green-950/60 shadow-[0_0_15px_rgba(34,197,94,0.05)]"
                        : "border-zinc-200 dark:border-zinc-900 hover:border-zinc-300 dark:hover:border-zinc-800"
                      }`}
                  >
                    {/* Header */}
                    <div className="flex w-full items-start justify-between">
                      <div className="flex flex-col items-center flex-1">
                        <div className="flex items-center gap-2 mb-1">
                          <span className={`w-2 h-2 rounded-full ${isOnline ? "bg-green-500 animate-pulse shadow-[0_0_8px_#22c55e]" : "bg-zinc-400"}`} />
                          <span className="text-[9px] font-bold text-zinc-400 dark:text-zinc-500 tracking-[0.25em] uppercase">
                            {isOnline ? "Online" : "Offline"}
                          </span>
                        </div>
                        <div className="flex items-center gap-2">
                          <h3 className="text-base font-bold text-zinc-800 dark:text-zinc-200 tracking-wide uppercase">
                            {screen.name}
                          </h3>
                          {hasLiveUpdate && (
                            <span title="Updated from screen">
                              <Wifi className="h-3.5 w-3.5 text-green-500 animate-pulse" />
                            </span>
                          )}
                        </div>
                        <span className="text-[9px] text-zinc-400 dark:text-zinc-600 mt-0.5 font-mono">
                          {screen.id}
                        </span>
                      </div>
                      {isAdmin && (
                        <button
                          onClick={() => removeScreen(screen.id).then(() => router.refresh())}
                          className="p-1.5 rounded-lg text-zinc-400 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-950/30 transition-colors shrink-0"
                          title="Remove screen"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      )}
                    </div>

                    {/* Preview (Mock 16:9 Display Frame) */}
                    <div className="w-full aspect-[16/9] relative rounded-2xl border-[5px] border-zinc-800 dark:border-zinc-900 shadow-xl bg-zinc-950 overflow-hidden flex items-center justify-center shrink-0">
                      {isAssigned ? (
                        screen.contentType === "video" ? (
                          <div className="absolute inset-0 w-full h-full">
                            <video
                              src={screen.contentValue}
                              className="w-full h-full object-cover"
                              muted
                              playsInline
                              autoPlay
                              loop
                            />
                            <div className="absolute inset-x-0 bottom-0 bg-black/70 backdrop-blur-md py-1.5 px-3 flex flex-col items-center justify-center text-center">
                              <span className="text-[7px] font-bold text-zinc-400 tracking-[0.25em] uppercase">
                                Video Stream
                              </span>
                              <span className="text-white font-medium text-[10px] truncate max-w-full">
                                {screen.contentLabel}
                              </span>
                            </div>
                          </div>
                        ) : screen.contentType === "image" ? (
                          <div className="absolute inset-0 w-full h-full">
                            <img
                              src={screen.contentValue}
                              alt={screen.contentLabel}
                              className="w-full h-full object-cover"
                            />
                            <div className="absolute inset-x-0 bottom-0 bg-black/70 backdrop-blur-md py-1.5 px-3 flex flex-col items-center justify-center text-center">
                              <span className="text-[7px] font-bold text-zinc-400 tracking-[0.25em] uppercase">
                                Image Signage
                              </span>
                              <span className="text-white font-medium text-[10px] truncate max-w-full">
                                {screen.contentLabel}
                              </span>
                            </div>
                          </div>
                        ) : (
                          <div className="flex flex-col items-center justify-center gap-2 text-center px-4">
                            <span className="text-[8px] font-bold text-zinc-500 tracking-[0.35em] uppercase">
                              Now Playing
                            </span>
                            <span className="text-white font-light text-base uppercase tracking-widest leading-tight">
                              {screen.contentLabel}
                            </span>
                          </div>
                        )
                      ) : (
                        <div className="absolute inset-0 w-full h-full">
                          <video
                            src="/media/4k_render_intro_animation_0003.mp4"
                            className="w-full h-full object-cover opacity-45 filter grayscale-[20%]"
                            muted
                            playsInline
                            autoPlay
                            loop
                          />
                          <div className="absolute inset-0 bg-black/40 flex flex-col items-center justify-center gap-1.5">
                            <Monitor className="h-5 w-5 text-white/70 animate-pulse" />
                            <span className="text-[8px] font-bold text-white/50 tracking-[0.25em] uppercase">Standby Loop</span>
                          </div>
                        </div>
                      )}
                    </div>

                    {/* Control Actions Panel */}
                    <div className="w-full flex flex-col gap-3 border-t border-zinc-100 dark:border-zinc-900 pt-4">
                      {/* Three Slide Options (Only active when screen is online and assigned) */}
                      <div className="grid grid-cols-3 gap-2">
                        {[
                          { label: "Overview", index: 0 },
                          { label: "Features", index: 1 },
                          { label: "Metrics", index: 2 },
                        ].map((slide) => (
                          <button
                            key={slide.index}
                            onClick={() => sendRemoteCommand(screen.id, "SET_SLIDE", slide.index)}
                            disabled={!isOnline || !isAssigned}
                            className={`py-2.5 px-2 rounded-xl text-[10px] font-semibold tracking-wide uppercase transition-all duration-200 border text-center
                              ${!isOnline || !isAssigned
                                ? "bg-zinc-50 dark:bg-zinc-900/50 text-zinc-300 dark:text-zinc-800 cursor-not-allowed border-transparent"
                                : "bg-zinc-100 hover:bg-zinc-200 dark:bg-zinc-900 dark:hover:bg-zinc-850 text-zinc-700 dark:text-zinc-300 border-zinc-200/50 dark:border-zinc-800/60 active:scale-95"
                              }`}
                            title={isOnline && isAssigned ? `Go to ${slide.label} slide` : "Screen must be online and assigned to control"}
                          >
                            {slide.label}
                          </button>
                        ))}
                      </div>

                      {/* Content Picker Action */}
                      <button
                        onClick={() => setPickerTargetId(screen.id)}
                        className="w-full py-3 bg-zinc-900 hover:bg-zinc-800 dark:bg-zinc-100 dark:hover:bg-zinc-200 text-zinc-100 dark:text-zinc-900 rounded-xl text-xs font-bold tracking-wider uppercase transition-all duration-200 flex items-center justify-center gap-2 shadow-sm"
                      >
                        <Layers className="h-3.5 w-3.5" />
                        <span>{isAssigned ? "Change Experience" : "Assign Experience"}</span>
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </>
  );
}
