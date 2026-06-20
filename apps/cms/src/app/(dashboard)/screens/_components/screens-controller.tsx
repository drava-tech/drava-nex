"use client";

import React, { useState, useEffect, useCallback } from "react";
import { Layers, Wifi, Plus, Trash2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useCmsScreenSync } from "@/hooks/useCmsScreenSync";
import { removeScreen, assignExperience } from "@/actions/screen-actions";
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
  initialScreens: { screenId: string; screenName: string }[];
  isAdmin: boolean;
  experiences: { id: string; title: string }[];
}

// Stores only content-assignment state keyed by screenId
type ContentState = Record<string, Pick<ScreenConfig, "contentType" | "contentValue" | "contentLabel">>;
const STORAGE_KEY = "exhibition_screens_content_v1";

export function ScreensController({ initialScreens, isAdmin, experiences }: ScreensControllerProps) {
  const router = useRouter();

  const [screens, setScreens] = useState<ScreenConfig[]>(() =>
    initialScreens.map(({ screenId, screenName }) => ({
      id: screenId,
      name: screenName,
      contentType: "image" as const,
      contentValue: "",
      contentLabel: undefined,
    }))
  );
  const [pickerTargetId, setPickerTargetId] = useState<string | null>(null);
  const [showAddModal, setShowAddModal] = useState(false);
  const [liveUpdates, setLiveUpdates] = useState<Record<string, number>>({});

  // Re-sync state whenever the server-provided screen list changes (e.g. after add/remove)
  // and merge with any saved content assignments from localStorage.
  useEffect(() => {
    const saved: ContentState = (() => {
      try { return JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "{}"); } catch { return {}; }
    })();
    setScreens(
      initialScreens.map(({ screenId, screenName }) => ({
        id: screenId,
        name: screenName,
        contentType: saved[screenId]?.contentType ?? "image",
        contentValue: saved[screenId]?.contentValue ?? "",
        contentLabel: saved[screenId]?.contentLabel,
      }))
    );
    // JSON.stringify avoids re-running on every render while still catching list changes
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [JSON.stringify(initialScreens)]);

  const persistContent = (next: ScreenConfig[]) => {
    if (typeof window === "undefined") return;
    const contentState: ContentState = {};
    for (const s of next) {
      contentState[s.id] = {
        contentType: s.contentType,
        contentValue: s.contentValue,
        contentLabel: s.contentLabel,
      };
    }
    localStorage.setItem(STORAGE_KEY, JSON.stringify(contentState));
  };

  const updateScreen = (id: string, updates: Partial<ScreenConfig>) => {
    setScreens((prev) => {
      const next = prev.map((s) => s.id === id ? { ...s, ...updates } : s);
      persistContent(next);
      return next;
    });
  };

  const handleScreenUpdated = useCallback((screenId: string, content: WsContent) => {
    const contentType: ScreenConfig["contentType"] =
      content.type === "video" ? "video" :
        content.type === "experience" ? "experience" : "image";
    updateScreen(screenId, { contentType, contentValue: content.source, contentLabel: content.title });
    setLiveUpdates((prev) => ({ ...prev, [screenId]: Date.now() }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useCmsScreenSync({ onScreenUpdated: handleScreenUpdated });

  const handleAssign = async (screenId: string, content: WsContent) => {
    const contentType: ScreenConfig["contentType"] =
      content.type === "video" ? "video" :
        content.type === "experience" ? "experience" : "image";
    updateScreen(screenId, { contentType, contentValue: content.source, contentLabel: content.title });
    setPickerTargetId(null);
    // content.id is the experience id; write DB + push happen server-side.
    await assignExperience(screenId, content.id);
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
        <div className="w-full max-w-[900px] mx-auto">
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
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6 md:gap-10 items-start">
              {screens.map((screen) => {
                const hasMedia = Boolean(screen.contentValue);
                const isExperience = screen.contentType === "experience";
                const mediaUrl = screen.contentValue.startsWith("http")
                  ? screen.contentValue
                  : screen.contentValue ? `/${screen.contentValue}` : "";
                const hasLiveUpdate = Boolean(liveUpdates[screen.id]);
                const hasContent = hasMedia || (isExperience && Boolean(screen.contentLabel));

                return (
                  <div
                    key={screen.id}
                    className="flex flex-col items-center gap-4 bg-white dark:bg-zinc-950 border border-zinc-200 dark:border-zinc-900 rounded-[28px] p-6 shadow-sm hover:border-zinc-300 dark:hover:border-zinc-800 transition-all duration-300"
                  >
                    {/* Header */}
                    <div className="flex w-full items-start justify-between">
                      <div className="flex flex-col items-center flex-1">
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

                    {/* Preview */}
                    <div className="w-full aspect-[16/9] relative rounded-2xl border-4 border-zinc-800 shadow-lg bg-zinc-950 overflow-hidden flex items-center justify-center shrink-0">
                      {isExperience && screen.contentLabel ? (
                        <div className="flex flex-col items-center justify-center gap-2 text-center px-4">
                          <span className="text-[8px] font-bold text-zinc-500 tracking-[0.35em] uppercase">
                            Now Playing
                          </span>
                          <span className="text-white font-light text-lg uppercase tracking-widest leading-tight">
                            {screen.contentLabel}
                          </span>
                        </div>
                      ) : hasMedia && mediaUrl ? (
                        <div className="absolute inset-0">
                          {screen.contentType === "video" ? (
                            <video key={mediaUrl} src={mediaUrl} className="w-full h-full object-cover" autoPlay loop muted playsInline />
                          ) : (
                            <img key={mediaUrl} src={mediaUrl} className="w-full h-full object-cover" alt={screen.name} />
                          )}
                        </div>
                      ) : (
                        <div className="flex flex-col items-center gap-2 text-zinc-500">
                          <Layers className="h-6 w-6" />
                          <span className="text-[10px] font-bold tracking-widest uppercase">No content assigned</span>
                        </div>
                      )}

                      {!isExperience && screen.contentLabel && (
                        <div className="absolute bottom-2 left-2 flex items-center gap-1.5 bg-black/70 backdrop-blur-sm rounded-full px-2.5 py-1">
                          <span className="w-1.5 h-1.5 rounded-full bg-green-400" />
                          <span className="text-[10px] font-semibold text-white tracking-wide">{screen.contentLabel}</span>
                        </div>
                      )}
                    </div>

                    {/* Action */}
                    <div className="w-full">
                      <button
                        onClick={() => setPickerTargetId(screen.id)}
                        className="w-full py-3 bg-zinc-900 hover:bg-zinc-800 text-zinc-100 rounded-xl text-xs font-bold tracking-wider uppercase transition-all duration-200 border border-zinc-700 hover:border-zinc-500 flex items-center justify-center gap-2"
                      >
                        <Layers className="h-3.5 w-3.5" />
                        <span>{hasContent ? "Change Content" : "Assign Content"}</span>
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
