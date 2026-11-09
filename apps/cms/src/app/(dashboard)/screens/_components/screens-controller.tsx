"use client";

import React, { useState, useEffect, useMemo, useRef } from "react";
import { Layers, Wifi, Plus, Trash2, Copy, Check, Ban, Play, MoreVertical, Send, FolderPlus, FolderInput, FolderPen, FolderMinus } from "lucide-react";
import { useRouter } from "next/navigation";
import {
  Badge,
  Button,
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubTrigger,
  DropdownMenuSubContent,
} from "@platform/ui";
import { removeScreen, assignExperience, assignMedia } from "@/actions/screen-actions";
import type { ScreenGroupRow, ScreenRow } from "@platform/db";
import { deleteScreenGroup, moveScreenToGroup } from "@/actions/screen-group-actions";
import { ScreenAssignmentPicker } from "./screens-assignment-picker";
import { ScreenMirror } from "./screen-mirror";
import { AddScreenModal } from "./add-screen-modal";
import { ScreenGroupDialog } from "./screen-group-dialog";
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
  groupId: string | null;
}

interface ScreensControllerProps {
  initialScreens: ScreenRow[];
  isAdmin: boolean;
  experiences: { id: string; title: string; coverImage?: string | null }[];
  initialActiveScreenIds?: string[];
  /** screenId -> whiteboard_document id, for screens currently live-pushing a saved whiteboard. */
  activeWhiteboards?: Record<string, string>;
  /** Screen groups, in display order; screens are listed under them. */
  groups?: ScreenGroupRow[];
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
  groups = [],
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
      // ?? null: a row from an older API (before screen groups) has no groupId.
      groupId: row.groupId ?? null,
      ...deriveContentInfo(row),
    })),
    [rows],
  );
  const [pickerTargetId, setPickerTargetId] = useState<string | null>(null);
  const [showAddModal, setShowAddModal] = useState(false);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [idlingId, setIdlingId] = useState<string | null>(null);
  const [blankingId, setBlankingId] = useState<string | null>(null);
  /** "new" = create dialog open; a group = editing it; null = closed. */
  const [groupDialog, setGroupDialog] = useState<"new" | ScreenGroupRow | null>(null);

  // Screens listed under each group, in group order, then the ungrouped ones.
  // A groupId pointing at a group that no longer exists counts as ungrouped.
  const sections = useMemo(() => {
    const known = new Set(groups.map((g) => g.id));
    return {
      grouped: groups.map((group) => ({ group, screens: screens.filter((s) => s.groupId === group.id) })),
      ungrouped: screens.filter((s) => !s.groupId || !known.has(s.groupId)),
    };
  }, [groups, screens]);

  const handleMoveToGroup = async (screenId: string, groupId: string | null) => {
    const result = await moveScreenToGroup(screenId, groupId);
    if (!result.success) {
      alert(result.error);
      return;
    }
    router.refresh();
  };

  const handleDeleteGroup = async (group: ScreenGroupRow, count: number) => {
    const note = count > 0 ? ` Its ${count} screen${count === 1 ? "" : "s"} will move to Ungrouped.` : "";
    if (!confirm(`Delete the group "${group.name}"?${note}`)) return;
    const result = await deleteScreenGroup(group.id);
    if (!result.success) {
      alert(result.error);
      return;
    }
    router.refresh();
  };

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

  const renderCard = (screen: ScreenConfig) => {
    const hasLiveUpdate = Boolean(liveUpdates[screen.id]);
    const isAssigned = Boolean(screen.contentLabel);
    const isOnline = activeScreenIds.has(screen.id);

    return (
      <div
        key={screen.id}
        className="group relative flex min-w-0 flex-col overflow-hidden rounded-2xl border border-border bg-card card-glow transition-all"
      >
        {/* Live mirror — exactly what the TV is showing (template/media/idle) */}
        <div className="relative w-full aspect-video shrink-0">
          <button
            type="button"
            onClick={() => openControl(screen.id)}
            title="Open control"
            className="relative h-full w-full overflow-hidden cursor-pointer"
          >
            <ScreenMirror screenId={screen.id} title={screen.name} isOnline={isOnline} loadStream={false} />
          </button>

          {isAdmin && (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button
                  type="button"
                  aria-label="Screen actions"
                  onClick={(e) => e.stopPropagation()}
                  className="absolute right-3 top-3 z-20 flex h-7 w-7 items-center justify-center rounded-full border-0 bg-black/60 text-white/80 backdrop-blur-sm transition-colors hover:text-white hover:bg-black/80"
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
                    <Check className="h-4 w-4 text-primary-ink" />
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
                {groups.length > 0 && (
                  <DropdownMenuSub>
                    <DropdownMenuSubTrigger className="cursor-pointer gap-2 py-1">
                      <FolderInput className="h-4 w-4" /> Move to group
                    </DropdownMenuSubTrigger>
                    <DropdownMenuSubContent className="w-48">
                      {groups.map((g) => (
                        <DropdownMenuItem
                          key={g.id}
                          disabled={screen.groupId === g.id}
                          className="cursor-pointer gap-2 py-1"
                          onSelect={() => handleMoveToGroup(screen.id, g.id)}
                        >
                          {screen.groupId === g.id ? <Check className="h-4 w-4" /> : <span className="w-4" />}
                          <span className="truncate">{g.name}</span>
                        </DropdownMenuItem>
                      ))}
                      {screen.groupId && (
                        <>
                          <DropdownMenuSeparator />
                          <DropdownMenuItem
                            className="cursor-pointer gap-2 py-1"
                            onSelect={() => handleMoveToGroup(screen.id, null)}
                          >
                            <FolderMinus className="h-4 w-4" /> Remove from group
                          </DropdownMenuItem>
                        </>
                      )}
                    </DropdownMenuSubContent>
                  </DropdownMenuSub>
                )}
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
              <p className="truncate font-heading text-base text-card-foreground">{screen.name}</p>
              {hasLiveUpdate && (
                <span title="Updated from screen" className="shrink-0">
                  <Wifi className="h-3.5 w-3.5 text-primary-ink animate-pulse" />
                </span>
              )}
            </div>
            <Badge
              variant="outline"
              className={`shrink-0 rounded-full bg-transparent px-3 py-1 text-xs font-light ${isOnline ? "border-status-online/60 text-primary-ink" : "border-status-offline/60 text-status-offline"}`}
            >
              {isOnline ? "Live" : "Offline"}
            </Badge>
          </div>

          <p className="truncate text-base text-muted-foreground">
            {isAssigned ? screen.contentLabel : "No content assigned"}
          </p>

          <div className="flex flex-wrap gap-2">
            <Button variant="glass" size="sm" className="flex-1 px-3 text-sm" onClick={() => openControl(screen.id)}>
              Control
            </Button>
            <Button variant="glass" size="sm" className="flex-1 px-3 text-sm" onClick={() => setPickerTargetId(screen.id)}>
              {isAssigned ? "Change" : "Assign"}
            </Button>
            <Button
              variant="glass"
              size="sm"
              className="flex-1 px-3 text-sm"
              onClick={() => handleResetToIdle(screen.id)}
              disabled={idlingId === screen.id}
              title="Clear the current assignment and fall back to the default/idle media"
            >
              {idlingId === screen.id ? "..." : "Idle"}
            </Button>
          </div>
        </div>
      </div>
    );
  };

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

      {groupDialog && (
        <ScreenGroupDialog
          group={groupDialog === "new" ? undefined : groupDialog}
          groups={groups}
          screens={rows}
          onClose={() => setGroupDialog(null)}
          onSaved={() => { setGroupDialog(null); router.refresh(); }}
        />
      )}

      <div className="flex-1 w-full h-full flex flex-col select-none min-h-0 overflow-y-auto pt-2 pb-8">
        <div className="@container mx-auto w-full max-w-full px-4 sm:px-6 lg:px-10">
          {/* Drag & Publish + Add screen row */}
          <div className="mb-6 flex flex-wrap items-center justify-end gap-2">
            <Button variant="outline" size="pill" onClick={() => router.push("/broadcast")}>
              <Send className="h-4 w-4" />
              Drag & Publish
            </Button>
            {isAdmin && (
              <Button variant="outline" size="pill" onClick={() => setGroupDialog("new")}>
                <FolderPlus className="h-4 w-4" />
                New group
              </Button>
            )}
            {isAdmin && (
              <Button variant="pill" size="pill" onClick={() => setShowAddModal(true)}>
                <Plus className="h-4 w-4" />
                Add Screen
              </Button>
            )}
          </div>

          {screens.length === 0 ? (
            <div className="flex flex-col items-center justify-center gap-3 py-24 text-center">
              <Layers className="h-8 w-8 text-zinc-400" />
              <p className="text-sm font-semibold text-zinc-500 uppercase tracking-widest">No screens yet</p>
              <p className="text-xs text-zinc-400">Add your first screen to get started.</p>
            </div>
          ) : (
            <div className="flex flex-col gap-10">
              {sections.grouped.map(({ group, screens: groupScreens }) => (
                <section key={group.id} aria-labelledby={`group-${group.id}`} className="flex flex-col gap-4">
                  <div className="flex items-center justify-between gap-3 border-b border-border pb-2">
                    <div className="flex min-w-0 items-baseline gap-3">
                      <h2 id={`group-${group.id}`} className="truncate font-heading text-lg">{group.name}</h2>
                      <span className="shrink-0 text-xs text-muted-foreground">
                        {groupScreens.length} screen{groupScreens.length === 1 ? "" : "s"}
                      </span>
                    </div>
                    {isAdmin && (
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <button
                            type="button"
                            aria-label={`Actions for ${group.name}`}
                            className="flex h-8 w-8 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                          >
                            <MoreVertical className="h-4 w-4" />
                          </button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end" className="w-48">
                          <DropdownMenuItem className="cursor-pointer gap-2 py-1" onSelect={() => setGroupDialog(group)}>
                            <FolderPen className="h-4 w-4" /> Edit group
                          </DropdownMenuItem>
                          <DropdownMenuItem
                            className="cursor-pointer gap-2 py-1 text-destructive focus:text-destructive"
                            onSelect={() => handleDeleteGroup(group, groupScreens.length)}
                          >
                            <Trash2 className="h-4 w-4" /> Delete group
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    )}
                  </div>
                  {groupScreens.length === 0 ? (
                    <div className="flex flex-col items-center justify-center gap-2 rounded-2xl border border-dashed border-border py-10 text-center">
                      <p className="text-sm text-muted-foreground">No screens in this group yet.</p>
                      {isAdmin && (
                        <Button variant="outline" size="sm" onClick={() => setGroupDialog(group)}>
                          <Plus className="h-4 w-4" /> Add screens
                        </Button>
                      )}
                    </div>
                  ) : (
                    <div className="grid grid-cols-1 gap-4 @xl:grid-cols-2 @4xl:grid-cols-3 @7xl:grid-cols-4">
                      {groupScreens.map(renderCard)}
                    </div>
                  )}
                </section>
              ))}

              {sections.ungrouped.length > 0 && (
                <section aria-label={groups.length > 0 ? "Ungrouped screens" : "Screens"} className="flex flex-col gap-4">
                  {groups.length > 0 && (
                    <div className="flex items-baseline gap-3 border-b border-border pb-2">
                      <h2 className="font-heading text-lg text-muted-foreground">Ungrouped</h2>
                      <span className="text-xs text-muted-foreground">
                        {sections.ungrouped.length} screen{sections.ungrouped.length === 1 ? "" : "s"}
                      </span>
                    </div>
                  )}
                  <div className="grid grid-cols-1 gap-4 @xl:grid-cols-2 @4xl:grid-cols-3 @7xl:grid-cols-4">
                    {sections.ungrouped.map(renderCard)}
                  </div>
                </section>
              )}
            </div>
          )}
        </div>
      </div>
    </>
  );
}
