"use client";

import React, { useState, useEffect, useCallback } from "react";
import { Layers, Wifi, Plus, Trash2, SlidersHorizontal, Copy, Check, RotateCcw, Ban, Play, MoreVertical, Send } from "lucide-react";
import { useRouter } from "next/navigation";
import { Badge, DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem } from "@platform/ui";
import { useCmsScreenSync } from "@/hooks/useCmsScreenSync";
import { removeScreen, assignExperience, assignMedia, setScreenBlanked } from "@/actions/screen-actions";
import { ScreenAssignmentPicker } from "./screens-assignment-picker";
import { ScreenMirror } from "./screen-mirror";
import { AddScreenModal } from "./add-screen-modal";
import { GRADIENT_BORDER_IMAGE } from "@/app/(dashboard)/_components/dashboard/liquid-glass";
import type { WsContent } from "@platform/types";

interface ScreenConfig {
  id: string;
  name: string;
  contentType: "video" | "image" | "experience";
  contentValue: string;
  contentLabel?: string;
  blanked: boolean;
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
  blanked: boolean;
}

interface ScreensControllerProps {
  initialScreens: ScreenRow[];
  isAdmin: boolean;
  experiences: { id: string; title: string; coverImage?: string | null }[];
  initialActiveScreenIds?: string[];
  /** screenId -> whiteboard_document id, for screens currently live-pushing a saved whiteboard. */
  activeWhiteboards?: Record<string, string>;
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
  activeWhiteboards = {},
}: ScreensControllerProps) {
  const router = useRouter();

  const [screens, setScreens] = useState<ScreenConfig[]>(() =>
    initialScreens.map((row) => ({
      id: row.screenId,
      name: row.screenName,
      blanked: row.blanked,
      ...deriveContentInfo(row),
    }))
  );
  const [pickerTargetId, setPickerTargetId] = useState<string | null>(null);
  const [showAddModal, setShowAddModal] = useState(false);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [idlingId, setIdlingId] = useState<string | null>(null);
  const [blankingId, setBlankingId] = useState<string | null>(null);

  // Clears the current assignment so the screen falls back to its default/idle
  // media — same effect as "nothing assigned yet".
  const handleResetToIdle = async (screenId: string) => {
    setIdlingId(screenId);
    try {
      await assignMedia(screenId, null);
    } catch (err) {
      console.error("Failed to reset to idle:", err);
    } finally {
      setIdlingId(null);
    }
  };

  // Toggle the full-black overlay for a screen (Stop/Resume).
  const handleToggleBlank = async (screenId: string, next: boolean) => {
    setBlankingId(screenId);
    updateScreen(screenId, { blanked: next });
    try {
      await setScreenBlanked(screenId, next);
    } catch (err) {
      console.error("Failed to toggle screen blank state:", err);
      updateScreen(screenId, { blanked: !next });
    } finally {
      setBlankingId(null);
    }
  };

  const copyScreenUrl = async (screenId: string) => {
    const url = `${window.location.origin}/display/${encodeURIComponent(screenId)}`;
    await navigator.clipboard.writeText(url);
    setCopiedId(screenId);
    setTimeout(() => setCopiedId((current) => (current === screenId ? null : current)), 2000);
  };

  // Open the full-page control view for a screen — its own live whiteboard
  // session (Dashboard / Whiteboards / <id> / Live / <id>) if one is
  // currently being pushed there, otherwise the generic per-screen control
  // view (Dashboard / Screens / <id>).
  const openControl = (screenId: string) => {
    const whiteboardId = activeWhiteboards[screenId];
    if (whiteboardId) {
      router.push(`/whiteboards/${encodeURIComponent(whiteboardId)}/live/${encodeURIComponent(screenId)}`);
    } else {
      router.push(`/screens/${encodeURIComponent(screenId)}`);
    }
  };
  const [liveUpdates, setLiveUpdates] = useState<Record<string, number>>({});
  const [activeScreenIds, setActiveScreenIds] = useState<Set<string>>(() => new Set(initialActiveScreenIds));

  // Re-sync state whenever the server-provided screen list changes (e.g. after add/remove)
  useEffect(() => {
    setScreens(
      initialScreens.map((row) => ({
        id: row.screenId,
        name: row.screenName,
        blanked: row.blanked,
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
        <div className="w-full max-w-full mx-auto px-4">
          {/* Drag & Publish + Add screen row */}
          <div className="flex items-center justify-end gap-2 mb-6">
            <button
              onClick={() => router.push("/screens/publish")}
              className="flex items-center gap-2 px-4 py-2 rounded-xl border border-[#432992] bg-zinc-500/10 hover:bg-zinc-500/20 text-zinc-700 dark:text-zinc-300 text-xs font-bold tracking-wider uppercase transition-colors"
            >
              <Send className="h-3.5 w-3.5" />
              Drag & Publish
            </button>
            {isAdmin && (
              <button
                onClick={() => setShowAddModal(true)}
                className="flex items-center gap-2 px-4 py-2 rounded-xl bg-zinc-900 hover:bg-zinc-800 dark:bg-zinc-100 dark:hover:bg-zinc-300 dark:text-zinc-900 text-zinc-100 text-xs font-bold tracking-wider uppercase transition-colors"
              >
                <Plus className="h-3.5 w-3.5" />
                Add Screen
              </button>
            )}
          </div>

          {screens.length === 0 ? (
            <div className="flex flex-col items-center justify-center gap-3 py-24 text-center">
              <Layers className="h-8 w-8 text-zinc-400" />
              <p className="text-sm font-semibold text-zinc-500 uppercase tracking-widest">No screens yet</p>
              <p className="text-xs text-zinc-400">Add your first screen to get started.</p>
            </div>
          ) : (
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
              {screens.map((screen) => {
                const hasLiveUpdate = Boolean(liveUpdates[screen.id]);
                const isAssigned = Boolean(screen.contentLabel);
                const isOnline = activeScreenIds.has(screen.id);

                return (
                  <div
                    key={screen.id}
                    className="group relative flex flex-col overflow-hidden rounded-2xl border border-[#432992] bg-[#0b0518] transition-all hover:ring-2 hover:ring-sky-500 focus-within:ring-2 focus-within:ring-sky-500"
                  >
                    {/* Live mirror — exactly what the TV is showing (template/media/idle) */}
                    <div className="relative w-full aspect-video shrink-0">
                      <button
                        type="button"
                        onClick={() => openControl(screen.id)}
                        title="Open control"
                        style={{
                          background: `linear-gradient(to bottom right, #1c1033, #0a0518) padding-box, ${GRADIENT_BORDER_IMAGE} border-box`,
                          border: "1px solid transparent",
                        }}
                        className="relative h-full w-full rounded-2xl overflow-hidden cursor-pointer"
                      >
                        <ScreenMirror screenId={screen.id} title={screen.name} isOnline={isOnline} loadStream={false} />
                        {/* Hover hint */}
                        <div className="absolute inset-0 bg-black/0 group-hover:bg-black/30 transition-colors flex items-center justify-center">
                          <span className="opacity-0 group-hover:opacity-100 transition-opacity flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-white/90 text-zinc-900 text-[10px] font-bold uppercase tracking-wider">
                            <SlidersHorizontal className="h-3 w-3" /> Control
                          </span>
                        </div>
                      </button>

                      {isAdmin && (
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <button
                              type="button"
                              aria-label="Screen actions"
                              onClick={(e) => e.stopPropagation()}
                              className="absolute right-3 top-3 z-20 flex h-7 w-7 items-center justify-center rounded-full border-0 bg-[#432992] text-white/80 backdrop-blur-sm transition-colors hover:text-white"
                            >
                              <MoreVertical className="h-4 w-4" />
                            </button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end" className="w-52">
                            <DropdownMenuItem
                              className="cursor-pointer gap-2 py-1"
                              onSelect={() => copyScreenUrl(screen.id)}
                            >
                              {copiedId === screen.id ? (
                                <Check className="h-4 w-4 text-green-500" />
                              ) : (
                                <Copy className="h-4 w-4" />
                              )}
                              {copiedId === screen.id ? "Copied!" : "Copy display URL"}
                            </DropdownMenuItem>
                            <DropdownMenuItem
                              disabled={blankingId === screen.id}
                              className="cursor-pointer gap-2 py-1"
                              onSelect={() => handleToggleBlank(screen.id, !screen.blanked)}
                            >
                              {screen.blanked ? <Play className="h-4 w-4" /> : <Ban className="h-4 w-4" />}
                              {blankingId === screen.id ? "..." : screen.blanked ? "Resume" : "Stop"}
                            </DropdownMenuItem>
                            <DropdownMenuItem
                              className="cursor-pointer gap-2 py-1 text-destructive focus:text-destructive"
                              onSelect={() => removeScreen(screen.id).then(() => router.refresh())}
                            >
                              <Trash2 className="h-4 w-4" /> Remove screen
                            </DropdownMenuItem>
                          </DropdownMenuContent>
                        </DropdownMenu>
                      )}
                    </div>

                    {/* Name + status, content-description, and actions */}
                    <div className="flex flex-col gap-3 p-4">
                      <div className="flex items-center justify-between gap-2">
                        <div className="flex min-w-0 items-center gap-2">
                          <p className="truncate text-base font-light text-white">{screen.name}</p>
                          {hasLiveUpdate && (
                            <span title="Updated from screen" className="shrink-0">
                              <Wifi className="h-3.5 w-3.5 text-green-500 animate-pulse" />
                            </span>
                          )}
                        </div>
                        <Badge
                          variant="secondary"
                          className="shrink-0 rounded-full border-0 bg-white/10 px-3 py-1 text-[11px] font-light text-slate-300"
                        >
                          <span
                            className={`mr-1.5 h-1.5 w-1.5 rounded-full ${isOnline ? "bg-green-500 animate-pulse shadow-[0_0_6px_#22c55e]" : "bg-zinc-400"}`}
                          />
                          {isOnline ? "Online" : "Offline"}
                        </Badge>
                      </div>

                      <p className="truncate text-sm text-white/40">
                        {isAssigned ? screen.contentLabel : "No content assigned"}
                      </p>

                      <div className="grid grid-cols-3 gap-2">
                        <button
                          onClick={() => openControl(screen.id)}
                          className="rounded-full border border-[#432992] bg-transparent py-1.5 text-xs font-light text-white transition-colors hover:bg-white/10 flex items-center justify-center gap-1.5"
                        >
                          <SlidersHorizontal className="h-3.5 w-3.5" />
                          <span>Control</span>
                        </button>
                        <button
                          onClick={() => setPickerTargetId(screen.id)}
                          className="rounded-full bg-white py-1.5 text-xs font-light text-[#0b0518] transition-colors hover:bg-white/90 flex items-center justify-center gap-1.5"
                        >
                          <Layers className="h-3.5 w-3.5" />
                          <span>{isAssigned ? "Change" : "Assign"}</span>
                        </button>
                        <button
                          onClick={() => handleResetToIdle(screen.id)}
                          disabled={idlingId === screen.id}
                          title="Clear the current assignment and fall back to the default/idle media"
                          className="rounded-full border border-[#432992] bg-transparent py-1.5 text-xs font-light text-white transition-colors hover:bg-white/10 flex items-center justify-center gap-1.5 disabled:opacity-50"
                        >
                          <RotateCcw className="h-3.5 w-3.5" />
                          <span>{idlingId === screen.id ? "..." : "Idle"}</span>
                        </button>
                      </div>
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
