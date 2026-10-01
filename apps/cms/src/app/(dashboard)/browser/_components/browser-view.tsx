"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { AlertCircle, Check, Loader2, MonitorPlay, Radio } from "lucide-react";
import { documentKindOfMediaType } from "@platform/types";
import { AddLinkFields, type DetectedLink } from "@/app/(dashboard)/media/_components/add-link-dialog";
import { ScreenTouchpad } from "@/app/(dashboard)/screens/_components/screen-touchpad";
import { currentLabel, type ScreenRow } from "@/components/push-to-screen-modal";
import { assignMedia } from "@/actions/screen-actions";
import { OverwriteConfirmDialog } from "@/components/overwrite-confirm-dialog";

interface BrowserViewProps {
  screens: ScreenRow[];
  activeScreenIds: string[];
  /** Set on /browser/live/[deviceId] — shows the touchpad on the right for
   * this screen instead of the empty state. deviceId = a screen's screenId,
   * same convention as experiences/[experienceId]/live/[deviceId]. */
  deviceId?: string;
}

/**
 * The routed "Browser" flow: paste a link, pick screens, send — replaced
 * the old popup-stacked AddLinkDialog -> PushToScreenModal -> LiveControlDialog
 * chain (the whiteboard FAB's "Browse URL" item now navigates here too,
 * the last caller of that popup). Left column stays mounted across
 * /browser and /browser/live/[deviceId] so another link can be queued up
 * without leaving the page; only the right pane (and the URL) changes.
 */
export function BrowserView({ screens, activeScreenIds, deviceId }: BrowserViewProps) {
  const router = useRouter();
  const activeSet = useMemo(() => new Set(activeScreenIds), [activeScreenIds]);
  const liveScreen = useMemo(
    () => (deviceId ? screens.find((s) => s.screenId === deviceId) : undefined),
    [screens, deviceId]
  );

  const [url, setUrl] = useState("");
  const [name, setName] = useState("");
  const [detected, setDetected] = useState<DetectedLink>(null);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pendingOverwrite, setPendingOverwrite] = useState<ScreenRow[] | null>(null);

  const toggleScreen = (id: string) => {
    setSelectedIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  };

  const doSend = async () => {
    setSending(true);
    setError(null);
    try {
      const res = await fetch("/api/media/link", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: url.trim(), name: name.trim() || undefined, pendingSave: true }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.success) throw new Error(data.error ?? "Failed to add link");
      const mediaId = data.media.id as string;

      const targets = screens.filter((s) => selectedIds.includes(s.screenId));
      await Promise.all(targets.map((s) => assignMedia(s.screenId, mediaId)));

      // targets is non-empty here: handleSend/doSend only run with selectedIds.length > 0.
      const target = targets.find((s) => activeSet.has(s.screenId)) ?? targets[0]!;
      router.push(`/browser/live/${target.screenId}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to send to screen");
    } finally {
      setSending(false);
      setPendingOverwrite(null);
    }
  };

  const handleSend = () => {
    if (!detected || selectedIds.length === 0 || sending) return;
    const targets = screens.filter((s) => selectedIds.includes(s.screenId));
    const overwriting = targets.filter((s) => currentLabel(s) !== "Nothing assigned");
    if (overwriting.length > 0) {
      setPendingOverwrite(overwriting);
      return;
    }
    void doSend();
  };

  return (
    // h-full, not flex-1 — the parent scroll region (dashboard-layout-client's
    // overflow-y-auto div) is a plain block container, not a flex container,
    // so flex-1 here has nothing to grow against and this collapses to
    // content height, squishing the touchpad into a thin strip. Same fix as
    // live-screen-surface.tsx.
    <div className="flex h-full min-h-0 gap-4 overflow-hidden bg-zinc-100 p-4 dark:bg-black">
      {/* Left column — link fields + screen picker */}
      <div className="flex w-full max-w-sm shrink-0 flex-col gap-4 overflow-y-auto rounded-2xl border border-border bg-white p-5 dark:bg-[#0f0f0f]">
        <h1 className="text-base font-semibold text-zinc-900 dark:text-zinc-50">Browser</h1>

        <div className="flex flex-col gap-4">
          <AddLinkFields
            url={url}
            name={name}
            onUrlChange={setUrl}
            onNameChange={setName}
            onDetectedChange={setDetected}
            autoFocus={false}
          />
        </div>

        <div className="flex min-h-0 flex-1 flex-col">
          <h2 className="mb-2 flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-zinc-500 dark:text-zinc-400">
            <MonitorPlay className="h-3.5 w-3.5" /> Screens
          </h2>
          {screens.length === 0 ? (
            <p className="px-2 py-8 text-center text-sm text-zinc-400">No screens registered yet</p>
          ) : (
            <div className="min-h-0 flex-1 space-y-1 overflow-y-auto">
              {screens.map((screen) => {
                const isSelected = selectedIds.includes(screen.screenId);
                const isOnline = activeSet.has(screen.screenId);
                return (
                  <button
                    key={screen.screenId}
                    type="button"
                    onClick={() => toggleScreen(screen.screenId)}
                    className={`flex w-full items-center justify-between gap-3 rounded-lg px-3 py-2.5 text-left text-sm transition-colors ${
                      isSelected
                        ? "bg-red-50 text-primary dark:bg-primary/10 dark:text-red-300"
                        : "text-zinc-700 hover:bg-zinc-100 dark:text-zinc-300 dark:hover:bg-white/5"
                    }`}
                  >
                    <span className="flex min-w-0 flex-1 items-center gap-2">
                      <span
                        className={`h-1.5 w-1.5 shrink-0 rounded-full ${
                          isOnline ? "bg-green-500 shadow-[0_0_6px_#22c55e]" : "bg-zinc-400"
                        }`}
                      />
                      <span className="min-w-0 flex-1 truncate">
                        <span className="block truncate font-medium">{screen.screenName}</span>
                        <span className="block truncate text-xs text-zinc-400 dark:text-zinc-500">
                          {currentLabel(screen)}
                        </span>
                      </span>
                    </span>
                    {isSelected && <Check className="h-4 w-4 shrink-0" />}
                  </button>
                );
              })}
            </div>
          )}
        </div>

        {error && (
          <p className="flex items-start gap-2 rounded-lg bg-red-50 px-3 py-2 text-xs text-red-600 dark:bg-red-500/10 dark:text-red-400">
            <AlertCircle className="mt-px h-3.5 w-3.5 shrink-0" />
            {error}
          </p>
        )}

        <button
          type="button"
          onClick={handleSend}
          disabled={!detected || selectedIds.length === 0 || sending}
          className="inline-flex h-11 shrink-0 items-center justify-center gap-2 rounded-full btn-primary text-sm font-normal transition-all active:scale-95 disabled:cursor-not-allowed disabled:opacity-40"
        >
          {sending ? (
            <>
              <Loader2 className="h-4 w-4 animate-spin" /> Sending…
            </>
          ) : (
            <>
              <MonitorPlay className="h-4 w-4" />
              {selectedIds.length > 0
                ? `Send to ${selectedIds.length} screen${selectedIds.length > 1 ? "s" : ""}`
                : "Select a screen"}
            </>
          )}
        </button>
      </div>

      {/* Right column — the big touchpad, once a screen is live */}
      <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-3">
        {deviceId ? (
          <>
            <div className="flex w-full max-w-[1600px] items-center gap-2 text-sm text-zinc-600 dark:text-zinc-400">
              <Radio className="h-4 w-4 shrink-0 text-green-500" />
              Currently controlling{" "}
              <span className="font-semibold text-zinc-900 dark:text-zinc-50">
                {liveScreen?.screenName ?? deviceId}
              </span>
            </div>
            <div className="relative flex h-full min-h-0 w-full max-w-[1600px] flex-col overflow-hidden rounded-2xl border-[3px] border-border shadow-2xl">
              {/* Derived from the server-fetched row rather than a live
                  subscription: reaching this route always follows a push, and
                  sending another link from the left column re-navigates here,
                  so the row is re-fetched either way. */}
              <ScreenTouchpad
                screenId={deviceId}
                documentKind={documentKindOfMediaType(liveScreen?.mediaType ?? "")}
              />
            </div>
          </>
        ) : (
          <div className="flex flex-col items-center gap-2 text-zinc-400 dark:text-zinc-600">
            <MonitorPlay className="h-8 w-8" />
            <p className="text-sm">Send a link to a screen to start controlling it here.</p>
          </div>
        )}
      </div>

      {pendingOverwrite && (
        <OverwriteConfirmDialog
          screens={pendingOverwrite}
          pending={sending}
          onCancel={() => setPendingOverwrite(null)}
          onConfirm={() => void doSend()}
        />
      )}
    </div>
  );
}
