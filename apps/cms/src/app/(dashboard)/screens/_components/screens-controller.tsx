"use client";

import React, { useState, useEffect, useCallback } from "react";
import { Layers, Wifi, Plus, Trash2, SlidersHorizontal } from "lucide-react";
import { useRouter } from "next/navigation";
import { useCmsScreenSync } from "@/hooks/useCmsScreenSync";
import { removeScreen, assignExperience, assignMedia } from "@/actions/screen-actions";
import { ScreenAssignmentPicker } from "./screens-assignment-picker";
import { ScreenMirror } from "./screen-mirror";
import { AddScreenModal } from "./add-screen-modal";
import type { WsContent } from "@platform/types";

interface ScreenConfig {
  id: string;
  name: string;
  contentType: "video" | "image" | "experience";
  contentValue: string;
  contentLabel?: string;
}

interface ScreenRow {
  screenId: string;
  screenName: string;
  currentContentKind: string | null;
  currentExperienceId: string | null;
  experienceName: string | null;
  currentMediaAssetId: string | null;
  mediaType: string | null;
  mediaUrl: string | null;
  mediaName: string | null;
}

interface ScreensControllerProps {
  initialScreens: ScreenRow[];
  isAdmin: boolean;
  experiences: { id: string; title: string }[];
  initialActiveScreenIds?: string[];
}

/** Derive the controller's display content from a screen row's content reference. */
function deriveContentInfo(row: ScreenRow): {
  contentType: "video" | "image" | "experience";
  contentValue: string;
  contentLabel?: string;
} {
  if (row.currentContentKind === "media" && row.mediaUrl) {
    return {
      contentType: row.mediaType === "video" ? "video" : "image",
      contentValue: row.mediaUrl,
      contentLabel: row.mediaName ?? undefined,
    };
  }

  if (row.currentContentKind === "experience" && row.currentExperienceId) {
    return {
      contentType: "experience",
      contentValue: row.currentExperienceId,
      contentLabel: row.experienceName ?? undefined,
    };
  }

  return { contentType: "image", contentValue: "", contentLabel: undefined };
}

export function ScreensController({
  initialScreens,
  isAdmin,
  experiences,
  initialActiveScreenIds = [],
}: ScreensControllerProps) {
  const router = useRouter();

  const [screens, setScreens] = useState<ScreenConfig[]>(() =>
    initialScreens.map((row) => ({
      id: row.screenId,
      name: row.screenName,
      ...deriveContentInfo(row),
    }))
  );
  const [pickerTargetId, setPickerTargetId] = useState<string | null>(null);
  const [showAddModal, setShowAddModal] = useState(false);

  // Open the full-page control view for a screen (Dashboard / Screens / <id>).
  const openControl = (screenId: string) => router.push(`/screen/${encodeURIComponent(screenId)}`);
  const [liveUpdates, setLiveUpdates] = useState<Record<string, number>>({});
  const [activeScreenIds, setActiveScreenIds] = useState<Set<string>>(() => new Set(initialActiveScreenIds));

  // Re-sync state whenever the server-provided screen list changes (e.g. after add/remove)
  useEffect(() => {
    setScreens(
      initialScreens.map((row) => ({
        id: row.screenId,
        name: row.screenName,
        ...deriveContentInfo(row),
      }))
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
      // content.id is the media_asset id; the screen points straight at it.
      await assignMedia(screenId, content.id);
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

                    {/* Live mirror — exactly what the TV is showing (template/media/idle) */}
                    <button
                      type="button"
                      onClick={() => openControl(screen.id)}
                      title="Open control"
                      className="group w-full aspect-[16/9] relative rounded-2xl border-[5px] border-zinc-800 dark:border-zinc-900 shadow-xl bg-zinc-950 overflow-hidden shrink-0 cursor-pointer"
                    >
                      <ScreenMirror screenId={screen.id} title={screen.name} />
                      {/* Hover hint + current content label */}
                      <div className="absolute inset-0 bg-black/0 group-hover:bg-black/30 transition-colors flex items-center justify-center">
                        <span className="opacity-0 group-hover:opacity-100 transition-opacity flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-white/90 text-zinc-900 text-[10px] font-bold uppercase tracking-wider">
                          <SlidersHorizontal className="h-3 w-3" /> Control
                        </span>
                      </div>
                      {isAssigned && (
                        <div className="absolute inset-x-0 bottom-0 bg-black/60 backdrop-blur-md py-1 px-3 text-center pointer-events-none">
                          <span className="text-white/90 font-medium text-[10px] truncate block">
                            {screen.contentLabel}
                          </span>
                        </div>
                      )}
                    </button>

                    {/* Actions: open the full control view, or change what's playing */}
                    <div className="w-full grid grid-cols-2 gap-2 border-t border-zinc-100 dark:border-zinc-900 pt-4">
                      <button
                        onClick={() => openControl(screen.id)}
                        className="py-3 bg-zinc-100 hover:bg-zinc-200 dark:bg-zinc-900 dark:hover:bg-zinc-800 text-zinc-800 dark:text-zinc-200 border border-zinc-200/60 dark:border-zinc-800/60 rounded-xl text-xs font-bold tracking-wider uppercase transition-all duration-200 flex items-center justify-center gap-2 active:scale-95"
                      >
                        <SlidersHorizontal className="h-3.5 w-3.5" />
                        <span>Control</span>
                      </button>
                      <button
                        onClick={() => setPickerTargetId(screen.id)}
                        className="py-3 bg-zinc-900 hover:bg-zinc-800 dark:bg-zinc-100 dark:hover:bg-zinc-200 text-zinc-100 dark:text-zinc-900 rounded-xl text-xs font-bold tracking-wider uppercase transition-all duration-200 flex items-center justify-center gap-2 shadow-sm active:scale-95"
                      >
                        <Layers className="h-3.5 w-3.5" />
                        <span>{isAssigned ? "Change" : "Assign"}</span>
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
