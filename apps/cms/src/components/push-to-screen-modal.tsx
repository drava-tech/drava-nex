"use client";

import { useEffect, useMemo, useState } from "react";
import { Check, Loader2, MonitorPlay, Radio, X, AlertCircle } from "lucide-react";
import { getScreens } from "@/actions/screen-actions";
import { getScreenGroups } from "@/actions/screen-group-actions";
import { SearchPill, matchesSearch } from "@/components/filter-bar";
import type { DocumentKind } from "@platform/types";
import { LiveControlDialog, type LiveScreen } from "@/components/live-control-dialog";
import { ControlChooserDialog } from "@/components/control-chooser-dialog";

/**
 * Re-exported from the query that produces it so the five components importing
 * `ScreenRow` from here keep working. It used to be re-declared by hand in
 * three places, which drifted — this copy was missing `blanked` and
 * `defaultMediaName` that the other two had. Prefer importing from
 * "@platform/db" directly in new code.
 */
import type { ScreenRow } from "@platform/db";
import { useAppDispatch, useAppSelector } from "@/store/hooks";
import { fetchScreens } from "@/store/screens-thunks";
export type { ScreenRow };

interface PushToScreenModalProps {
  contentName: string;
  onClose: () => void;
  /** Content-specific preview (image/video/embed/experience iframe). Omit to
   * collapse the modal to a single centered pane — the screen list + push
   * button then fill the whole thing, for entry points with nothing to preview. */
  preview?: React.ReactNode;
  /** Rendered under the title — e.g. media's "type · size · date" line, or an
   * experience's "N online / N offline" count. Content-specific, so it's the
   * caller's job, not this component's. */
  subtitle?: React.ReactNode;
  /** Caller owns the actual assign call (assignMedia / assignExperience / etc). */
  /** Result is awaited but not inspected here — assignExperience/assignMedia
   * resolve with a delivery count that only the publish board acts on. */
  onPush: (screenId: string) => Promise<unknown>;
  /** Pre-selects a screen and skips it in the push loop — for "don't reset a
   * screen already showing this exact content" (Experiences only today). */
  isAlreadyShowing?: (screen: ScreenRow) => boolean;
  /** Passed straight through to LiveControlDialog's "Save link" button (Browser). */
  onSaveLink?: () => Promise<void>;
  /**
   * Set when the content being pushed is a page/embed (link, YouTube, Drive,
   * PDF, sheet, deck...) — passed straight through to LiveControlDialog,
   * which then switches from tap-on-mirror control to the blank OS-cursor
   * touchpad (see LiveControlDialog for why). Omit for any other content type.
   */
  showTouchpad?: boolean;
  /** Which document viewer this content opens, if any — passed straight
   * through to LiveControlDialog for the touchpad's zoom row. */
  documentKind?: DocumentKind | null;
  /** Set to push an ordered multi-item queue instead of a single piece of content. */
  queue?: QueuePushConfig;
  /**
   * When set, called with the screens just pushed to instead of the default
   * behavior (swap into LiveControlDialog/ControlChooserDialog in place) —
   * the caller takes over entirely (e.g. navigating to a dedicated live URL)
   * and is responsible for closing the modal itself.
   */
  onPushed?: (screens: LiveScreen[]) => void;
  /**
   * Renders a small "Control" button on rows where isAlreadyShowing(screen)
   * is true, for jumping straight into that screen's live-control workspace
   * without pushing again. Caller owns navigation and is responsible for
   * closing the modal itself (same contract as onPushed).
   */
  onControl?: (screen: ScreenRow) => void;
  /**
   * Renders a small "Remove" button on rows where isAlreadyShowing(screen)
   * is true, for unassigning this content from that screen (reset to idle)
   * without closing the modal. On success the modal refetches its own screen
   * list so the row drops back to its normal (not-already-showing) state.
   */
  onRemove?: (screen: ScreenRow) => Promise<void>;
  /**
   * Renders an extra footer button (left of Push) for bypassing screen
   * selection entirely — e.g. the whiteboard's "Draw without pushing" (start
   * a local-only sketch instead of picking a screen). Omit for callers that
   * always require a screen.
   */
  onSkip?: () => void;
  /** Label for the onSkip button. Defaults to "Skip". */
  skipLabel?: string;
}

export interface QueuePushConfig {
  /** Full ordered media-asset id list — handed to LiveControlDialog so it can
   * show/advance "N of M" for the queue. */
  mediaAssetIds: string[];
  /** Which item onPush actually lands on — must match what the caller's
   * onPush (assignMediaQueue) itself passes as startIndex. Defaults to 0. */
  startIndex?: number;
  /** Step the queue forward/back one item on the given (already-pushed)
   * screen. Returns the new 0-based index — DB stays authoritative. */
  onNavigate: (screenId: string, direction: "next" | "prev") => Promise<number>;
}

/** More screens than this and the list gets a search box. */
const SEARCH_FROM = 5;

/** Label for whatever a screen is currently showing, so admins know what they'd overwrite. */
export function currentLabel(screen: ScreenRow): string {
  if (screen.currentContentKind === "experience" && screen.experienceName) {
    return screen.experienceName;
  }
  if (screen.currentContentKind === "media" && screen.mediaName) {
    return screen.mediaName;
  }
  return "Nothing assigned";
}

/**
 * The one "preview → screens → push → control panel" popup used everywhere
 * in the CMS (Media Library, Browser, Experiences). Callers supply what to
 * preview (if anything) and how to actually push (assignMedia/assignExperience/
 * etc) — this component owns the screen list, selection, push button, and the
 * single-vs-multi branch into LiveControlDialog / ControlChooserDialog.
 */
export function PushToScreenModal({
  contentName,
  onClose,
  preview,
  subtitle,
  onPush,
  isAlreadyShowing,
  onSaveLink,
  showTouchpad,
  documentKind,
  queue,
  onPushed,
  onControl,
  onRemove,
  onSkip,
  skipLabel = "Skip",
}: PushToScreenModalProps) {
  // Both come from the store, shared with every other surface that shows
  // screens — so opening this modal reflects any change made elsewhere, and a
  // push made here updates those surfaces without either side re-fetching.
  const dispatch = useAppDispatch();
  const screens = useAppSelector((st) => st.screens.rows);
  const storeActiveIds = useAppSelector((st) => st.screens.activeIds);
  const activeScreenIds = useMemo(() => new Set(storeActiveIds), [storeActiveIds]);
  const [loadingScreens, setLoadingScreens] = useState(true);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [pushing, setPushing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /** Highlights the screen list as soon as the modal opens (and again if Push is clicked with nothing picked) — cleared as soon as a screen is picked. */
  const [needsSelection, setNeedsSelection] = useState(true);
  const [controlScreens, setControlScreens] = useState<LiveScreen[] | null>(null);
  const [chooserScreens, setChooserScreens] = useState<LiveScreen[] | null>(null);
  const [removingScreenId, setRemovingScreenId] = useState<string | null>(null);
  // Finding the screen in a big install: by its name, its group's, or what it's playing.
  const [query, setQuery] = useState("");
  const [groupNames, setGroupNames] = useState<Map<string, string>>(new Map());
  useEffect(() => {
    // Names only sharpen the search and the row's label; the list works without them.
    getScreenGroups()
      .then((groups) => setGroupNames(new Map(groups.map((g) => [g.id, g.name]))))
      .catch(() => {});
  }, []);
  const groupNameOf = (s: ScreenRow) => (s.groupId ? groupNames.get(s.groupId) : undefined);
  const shown = screens.filter((s) => matchesSearch(query, s.screenName, groupNameOf(s), currentLabel(s)));

  // Reusable so a successful Remove can refetch without duplicating the
  // mount-time pre-selection logic (which must stay mount-only, see below).
  const loadScreens = async (): Promise<ScreenRow[]> => {
    const rows = await getScreens();
    await dispatch(fetchScreens());
    return rows;
  };

  // Every screen in the system, for LiveControlDialog's "switch screen" dropdown.
  const allScreensForControl: LiveScreen[] = screens.map((s) => ({
    screenId: s.screenId,
    screenName: s.screenName,
    isOnline: activeScreenIds.has(s.screenId),
  }));

  // Close on Escape, and stop the page behind from scrolling under the modal.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = previousOverflow;
    };
  }, [onClose]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const screenRows = await loadScreens();
        if (cancelled) return;
        if (isAlreadyShowing) {
          const preSelected = screenRows.filter((s) => isAlreadyShowing(s)).map((s) => s.screenId);
          setSelectedIds(preSelected);
          if (preSelected.length > 0) setNeedsSelection(false);
        }
      } catch {
        if (!cancelled) setError("Could not load the screen list");
      } finally {
        if (!cancelled) setLoadingScreens(false);
      }
    })();
    return () => {
      cancelled = true;
    };
    // isAlreadyShowing is only used for the initial pre-selection — re-running
    // this fetch whenever the caller passes a new closure would refetch on
    // every render for no reason.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const toggleScreen = (screenId: string) => {
    setNeedsSelection(false);
    setSelectedIds((prev) => {
      // Queue mode only supports one target screen — there's no UI here for
      // showing N independent "N of M" indicators across multiple screens.
      if (queue) return prev[0] === screenId ? [] : [screenId];
      return prev.includes(screenId) ? prev.filter((id) => id !== screenId) : [...prev, screenId];
    });
  };

  const handleRemove = async (screen: ScreenRow) => {
    if (!onRemove) return;
    setRemovingScreenId(screen.screenId);
    setError(null);
    try {
      await onRemove(screen);
      await loadScreens(); // refetch so isAlreadyShowing(screen) goes false
      setSelectedIds((prev) => prev.filter((id) => id !== screen.screenId));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to remove from screen");
    } finally {
      setRemovingScreenId(null);
    }
  };

  const handlePush = async () => {
    if (selectedIds.length === 0) {
      setNeedsSelection(true);
      return;
    }
    setPushing(true);
    setError(null);
    try {
      const targets = screens.filter((s) => selectedIds.includes(s.screenId));
      // Screens already showing this exact content don't need re-pushing —
      // that would just reset them from the start for no reason.
      const needsPush = targets.filter((s) => !isAlreadyShowing?.(s));
      await Promise.all(needsPush.map((s) => onPush(s.screenId)));

      const pushed: LiveScreen[] = targets.map((s) => ({
        screenId: s.screenId,
        screenName: s.screenName,
        isOnline: activeScreenIds.has(s.screenId),
      }));
      if (onPushed) {
        // Caller takes over entirely (e.g. navigating to a dedicated live URL).
        onPushed(pushed);
        return;
      }
      // One screen: go straight to its control panel. Multiple: ask which
      // one to control first (control mirrors one screen at a time).
      if (pushed.length === 1) {
        setControlScreens(pushed);
      } else {
        setChooserScreens(pushed);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to push to screen");
    } finally {
      setPushing(false);
    }
  };

  // Once pushed, swap straight into the live control panel — no need to keep
  // the preview open behind it.
  if (controlScreens) {
    return (
      <LiveControlDialog
        experienceName={contentName}
        screens={controlScreens}
        allScreens={allScreensForControl}
        onSaveLink={onSaveLink}
        onClose={onClose}
        showTouchpad={showTouchpad}
        documentKind={documentKind}
        queueMediaIds={queue?.mediaAssetIds}
        initialQueueIndex={queue?.startIndex ?? 0}
        onNavigateQueue={
          queue ? (direction) => queue.onNavigate(controlScreens[0]!.screenId, direction) : undefined
        }
      />
    );
  }
  if (chooserScreens) {
    return (
      <ControlChooserDialog
        contentName={contentName}
        screens={chooserScreens}
        onChoose={(screen) => setControlScreens([screen])}
        // Dismissing the chooser shouldn't discard the push — go back to the
        // preview + screen-select pane instead.
        onClose={() => setChooserScreens(null)}
      />
    );
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-label={`Preview ${contentName}`}
    >
      <div
        className={`flex h-full max-h-[90vh] w-full flex-col overflow-hidden rounded-2xl border border-border bg-card text-card-foreground shadow-2xl ${
          preview ? "max-w-6xl lg:flex-row" : "max-w-md"
        }`}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Preview pane — omitted entirely when the caller has nothing to show. */}
        {preview && (
          <div className="relative flex min-h-0 flex-1 items-center justify-center bg-background">
            {preview}
            <button
              onClick={onClose}
              aria-label="Close preview"
              className="absolute right-4 top-4 z-10 flex h-9 w-9 items-center justify-center rounded-full bg-black/50 text-white backdrop-blur-md transition-colors hover:bg-black/70 lg:hidden"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        )}

        {/* Screens + push pane */}
        <div className={`flex w-full shrink-0 flex-col ${preview ? "border-t border-border lg:w-96 lg:border-l lg:border-t-0" : ""}`}>
          <div className="flex items-start justify-between gap-3 border-b border-border p-5">
            <div className="min-w-0">
              <h2
                className="truncate text-base font-semibold text-foreground"
                title={contentName}
              >
                {contentName}
              </h2>
              {subtitle && <div className="mt-1 text-xs text-muted-foreground">{subtitle}</div>}
            </div>
            <button
              onClick={onClose}
              aria-label="Close"
              className="hidden h-8 w-8 shrink-0 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground lg:flex"
            >
              <X className="h-4 w-4" />
            </button>
          </div>

          <div className="flex min-h-0 flex-1 flex-col">
            <div className="flex items-center gap-2 px-5 pb-2 pt-4">
              <MonitorPlay className="h-3.5 w-3.5 text-zinc-400" />
              <h3 className="text-xs font-semibold uppercase tracking-wider text-zinc-500 dark:text-zinc-400">
                Push to screen
              </h3>
            </div>

            {screens.length > SEARCH_FROM && (
              <div className="flex items-center gap-2 px-5 pb-2">
                <SearchPill value={query} onChange={setQuery} label="Search screens or groups" className="min-w-0 flex-1" autoFocus />
                {/* A group's name narrows to its screens; this then takes the lot. One target only in queue mode. */}
                {!queue && query.trim() && shown.length > 1 && (
                  <button
                    type="button"
                    onClick={() => {
                      setNeedsSelection(false);
                      setSelectedIds((prev) => [...new Set([...prev, ...shown.map((s) => s.screenId)])]);
                    }}
                    className="shrink-0 rounded-full btn-surface px-3 py-1.5 text-xs"
                  >
                    Select all {shown.length}
                  </button>
                )}
              </div>
            )}

            <div className="min-h-0 flex-1 overflow-y-auto px-3 pb-2">
              {loadingScreens ? (
                <div className="flex items-center justify-center gap-2 py-8 text-sm text-zinc-400">
                  <Loader2 className="h-4 w-4 animate-spin" /> Loading screens…
                </div>
              ) : screens.length === 0 ? (
                <p className="px-2 py-8 text-center text-sm text-zinc-400">No screens registered yet</p>
              ) : shown.length === 0 ? (
                <p className="px-2 py-8 text-center text-sm text-zinc-400">No screen or group matches &ldquo;{query.trim()}&rdquo;</p>
              ) : (
                <div
                  className={`space-y-1 rounded-lg transition-shadow ${
                    needsSelection ? "ring-2 ring-red-500 ring-offset-2 ring-offset-white dark:ring-offset-[#0f0f0f]" : ""
                  }`}
                >
                  {shown.map((screen) => {
                    const isSelected = selectedIds.includes(screen.screenId);
                    const groupName = groupNameOf(screen);
                    const isOnline = activeScreenIds.has(screen.screenId);
                    const alreadyShowing = isAlreadyShowing?.(screen) ?? false;
                    const isRemoving = removingScreenId === screen.screenId;
                    return (
                      <div
                        key={screen.screenId}
                        className={`flex items-center gap-1 rounded-lg pr-1 transition-colors ${
                          isSelected
                            ? "bg-primary/10 text-primary"
                            : "text-foreground hover:bg-accent"
                        }`}
                      >
                        <button
                          type="button"
                          onClick={() => toggleScreen(screen.screenId)}
                          disabled={isRemoving}
                          className="flex min-w-0 flex-1 items-center justify-between gap-3 px-3 py-2.5 text-left text-sm disabled:opacity-50"
                        >
                          <span className="flex min-w-0 flex-1 items-center gap-2">
                            <span
                              className={`h-1.5 w-1.5 shrink-0 rounded-full ${
                                isOnline ? "bg-[#92ff5f] shadow-[0_0_6px_#92ff5f]" : "bg-muted-foreground/40"
                              }`}
                            />
                            <span className="min-w-0 flex-1 truncate">
                              <span className="block truncate font-medium">{screen.screenName}</span>
                              <span className="block truncate text-xs text-muted-foreground">
                                {groupName && `${groupName} · `}
                                {currentLabel(screen)}
                              </span>
                            </span>
                          </span>
                          {isSelected && <Check className="h-4 w-4 shrink-0" />}
                        </button>

                        {alreadyShowing && onControl && (
                          <button
                            type="button"
                            aria-label={`Control ${screen.screenName}`}
                            title="Control"
                            onClick={(e) => {
                              e.stopPropagation();
                              onControl(screen);
                            }}
                            disabled={isRemoving}
                            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground disabled:opacity-50"
                          >
                            <Radio className="h-4 w-4" />
                          </button>
                        )}
                        {alreadyShowing && onRemove && (
                          <button
                            type="button"
                            aria-label={`Remove from ${screen.screenName}`}
                            title="Remove from this screen"
                            onClick={(e) => {
                              e.stopPropagation();
                              handleRemove(screen);
                            }}
                            disabled={isRemoving || pushing}
                            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive disabled:opacity-50"
                          >
                            {isRemoving ? <Loader2 className="h-4 w-4 animate-spin" /> : <X className="h-4 w-4" />}
                          </button>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
              {needsSelection && !loadingScreens && screens.length > 0 && (
                <p className="px-2 pt-2 text-xs font-semibold text-destructive">Select a screen to push to</p>
              )}
            </div>

            {error && (
              <p className="mx-5 mb-2 flex items-start gap-2 rounded-lg bg-destructive/10 px-3 py-2 text-xs text-destructive">
                <AlertCircle className="mt-px h-3.5 w-3.5 shrink-0" />
                {error}
              </p>
            )}

            <div className="flex flex-col gap-2 border-t border-border p-4">
              {onSkip && (
                <button
                  type="button"
                  onClick={onSkip}
                  className="inline-flex h-9 items-center justify-center rounded-full btn-surface px-4 text-xs font-normal uppercase tracking-wider transition-colors"
                >
                  {skipLabel}
                </button>
              )}
              <button
                onClick={handlePush}
                disabled={pushing || screens.length === 0 || removingScreenId !== null}
                className="inline-flex h-11 items-center justify-center gap-2 rounded-full btn-primary text-sm font-normal transition-all active:scale-95 disabled:cursor-not-allowed disabled:opacity-40"
              >
                {pushing ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin" /> Pushing…
                  </>
                ) : (
                  <>
                    <MonitorPlay className="h-4 w-4" />
                    {selectedIds.length > 0 ? `Push to ${selectedIds.length}` : "Select a screen"}
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
