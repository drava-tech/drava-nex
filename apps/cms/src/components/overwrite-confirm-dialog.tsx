"use client";

import { AlertTriangle, Loader2 } from "lucide-react";
import { currentLabel, type ScreenRow } from "@/components/push-to-screen-modal";

/** The one deliberate popup in the routed /browser flow and the in-dialog
 * Add-Link push — "you're about to replace what's already playing" needs a
 * blocking confirm, not a page navigation. */
export function OverwriteConfirmDialog({
  screens,
  pending,
  onCancel,
  onConfirm,
}: {
  screens: ScreenRow[];
  pending: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm"
      onClick={onCancel}
      role="dialog"
      aria-modal="true"
      aria-label="Confirm overwrite"
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-sm overflow-hidden rounded-2xl border border-border bg-white shadow-2xl dark:bg-[#0f0f0f]"
      >
        <div className="flex items-start gap-3 p-5">
          <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-amber-500" />
          <div className="min-w-0">
            <h2 className="text-sm font-semibold text-zinc-900 dark:text-zinc-50">
              This will replace what&apos;s currently playing
            </h2>
            <ul className="mt-2 space-y-1 text-xs text-zinc-500 dark:text-zinc-400">
              {screens.map((s) => (
                <li key={s.screenId}>
                  <span className="font-medium text-zinc-700 dark:text-zinc-300">{s.screenName}</span> — currently
                  showing {currentLabel(s)}
                </li>
              ))}
            </ul>
          </div>
        </div>
        <div className="flex justify-end gap-2 border-t border-border p-4">
          <button
            type="button"
            onClick={onCancel}
            disabled={pending}
            className="h-10 rounded-full px-5 text-sm font-medium text-zinc-600 transition-colors hover:bg-zinc-100 disabled:opacity-50 dark:text-zinc-400 dark:hover:bg-white/5"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={pending}
            className="inline-flex h-10 items-center justify-center gap-2 rounded-full bg-blue-600 px-5 text-sm font-medium text-white transition-all hover:bg-blue-700 active:scale-95 disabled:cursor-not-allowed disabled:opacity-40"
          >
            {pending && <Loader2 className="h-4 w-4 animate-spin" />}
            Confirm & Send
          </button>
        </div>
      </div>
    </div>
  );
}
