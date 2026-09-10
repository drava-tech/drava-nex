"use client";

import React, { useState, useEffect, useMemo, useRef } from "react";
import { Layers, Wifi, Plus, Trash2, SlidersHorizontal, Copy, Check, RotateCcw, Ban, Play, MoreVertical, Send } from "lucide-react";
import { useRouter } from "next/navigation";
import { Badge, DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem } from "@platform/ui";
import { removeScreen, assignExperience, assignMedia } from "@/actions/screen-actions";
import type { ScreenRow } from "@platform/db";
import { ScreenAssignmentPicker } from "./screens-assignment-picker";
import { ScreenMirror } from "./screen-mirror";
import { AddScreenModal } from "./add-screen-modal";
import { GRADIENT_BORDER_IMAGE } from "@/app/(dashboard)/_components/dashboard/liquid-glass";
import type { WsContent } from "@platform/types";
import { useAppDispatch, useAppSelector } from "@/store/hooks";
import { screensHydrated, activeScreensUpdated, screenContentUpdated } from "@/store/screens-slice";
import { setScreenBlanked as setScreenBlankedThunk } from "@/store/screens-thunks";

interface ScreenConfig {
  id: string;
  name: string;
  contentType: "video" | "image" | "experience";
  contentValue: string;
  contentLabel?: string;
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

  const dispatch = useAppDispatch();
  const storeRows = useAppSelector((st) => st.screens.rows);
  // Props until the hydrate dispatch lands, store after.
  const rows = storeRows.length > 0 ? storeRows : initialScreens;
  // Derived, not stored. This was useState seeded at mount and then patched by
  // hand from three places; the row is now kept current by the store, so the
  // view model is a pure function of it and cannot drift from the other
  // surfaces showing the same screens.
  const screens = useMemo<ScreenConfig[]>(
    () => rows.map((row) => ({
      id: row.screenId,
      name: row.screenName,
      blanked: row.blanked,
      ...deriveContentInfo(row),
    })),
    [rows],
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
    try {
      // The thunk owns the optimistic update and the rollback on failure.
      await dispatch(setScreenBlankedThunk(screenId, next));
    } catch (err) {
      console.error("Failed to toggle screen blank state:", err);
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
  // "Just changed" pulse. Previously stamped by this component's own WS handler;
  // now derived by diffing the store rows, so it still fires for changes made
  // anywhere (another tab, the touch picker) without a second subscription.
  const [liveUpdates, setLiveUpdates] = useState<Record<string, number>>({});
  const previousRowsRef = useRef(rows);
  useEffect(() => {
    const before = previousRowsRef.current;
    previousRowsRef.current = rows;
    if (before === rows) return;
    const changed = rows.filter((row) => {
      const prev = before.find((r) => r.screenId === row.screenId);
      return prev && (
        prev.currentContentKind !== row.currentContentKind ||
        prev.currentExperienceId !== row.currentExperienceId ||
        prev.currentMediaAssetId !== row.currentMediaAssetId
      );
    });
    if (changed.length === 0) return;
    const stamp = Date.now();
    setLiveUpdates((prev) => ({
      ...prev,
      ...Object.fromEntries(changed.map((row) => [row.screenId, stamp])),
    }));
  }, [rows]);
  const storeActiveIds = useAppSelector((st) => st.screens.activeIds);
  const activeScreenIds = useMemo(
    () => new Set(storeActiveIds.length > 0 ? storeActiveIds : initialActiveScreenIds),
    [storeActiveIds, initialActiveScreenIds],
  );

  // Re-hydrate whenever the server-provided list changes (e.g. after add/remove,
  // which router.refresh()es the page). SCREEN_UPDATED and ACTIVE_SCREENS_LIST
  // are handled centrally by the store's StoreSync, so this component no longer
  // needs its own socket or its own copy of that mapping.
  useEffect(() => {
    dispatch(screensHydrated(initialScreens));
  }, [dispatch, initialScreens]);

  useEffect(() => {
    dispatch(activeScreensUpdated(initialActiveScreenIds));
  }, [dispatch, initialActiveScreenIds]);

  const handleAssign = async (screenId: string, content: WsContent) => {
    dispatch(screenContentUpdated(
      content.type === "experience"
        ? { screenId, kind: "experience", id: content.id, title: content.title ?? null }
        : {
            screenId,
            kind: "media",
            id: content.id,
            title: content.title ?? null,
            mediaType: content.type,
            mediaUrl: content.source,
          },
    ));
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
          screenId={pickerTarget.id}
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
              onClick={() => router.push("/broadcast")}
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
                              onSelect={() => {
                                if (!confirm(`Remove "${screen.name}"? This cannot be undone.`)) return;
                                removeScreen(screen.id).then(() => router.refresh());
                              }}
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
