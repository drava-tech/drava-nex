"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { PenTool, Plus, Trash2, Loader2, AlertTriangle } from "lucide-react";
import { Button } from "@platform/ui";
import { deleteWhiteboard } from "@/actions/whiteboard-actions";

interface WhiteboardListItem {
  id: string;
  name: string;
  pageCount: number;
  updatedAt: string;
}

export function WhiteboardsList({ items }: { items: WhiteboardListItem[] }) {
  const router = useRouter();
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [confirmTarget, setConfirmTarget] = useState<WhiteboardListItem | null>(null);
  const [isPending, startTransition] = useTransition();

  const handleDelete = (id: string) => {
    setConfirmTarget(null);
    setDeletingId(id);
    startTransition(async () => {
      await deleteWhiteboard(id);
      setDeletingId(null);
    });
  };

  return (
    <div className="flex flex-col gap-6 h-full min-h-0">
      <div className="flex items-center justify-between gap-3">
        <div>
          <p className="text-[9px] font-bold text-zinc-400 dark:text-zinc-500 tracking-[0.25em] uppercase mb-0.5">
            Saved Boards
          </p>
          <h1 className="text-xl font-bold text-zinc-900 dark:text-zinc-100 tracking-wide uppercase">Whiteboards</h1>
        </div>
        <Button size="pill" onClick={() => router.push("/whiteboards/new")}>
          <Plus className="h-4 w-4" /> New Board
        </Button>
      </div>

      <div className="flex-1 overflow-y-auto min-h-0">
        {items.length === 0 ? (
          <div className="flex flex-col items-center justify-center gap-2 py-24 text-center">
            <PenTool className="h-6 w-6 text-zinc-400" />
            <p className="text-xs text-zinc-400 dark:text-zinc-600">No saved whiteboards yet.</p>
          </div>
        ) : (
          <div className="overflow-hidden rounded-xl border">
            <table className="w-full text-sm">
              <thead className="border-b bg-muted/40 text-left text-xs text-muted-foreground">
                <tr>
                  <th className="px-4 py-3 font-medium">Name</th>
                  <th className="px-4 py-3 font-medium">Pages</th>
                  <th className="px-4 py-3 font-medium">Updated</th>
                  <th className="px-4 py-3 text-right font-medium">Actions</th>
                </tr>
              </thead>
              <tbody>
                {items.map((item) => (
                  <tr key={item.id} className="border-b last:border-0 hover:bg-muted/30">
                    <td className="px-4 py-3">
                      <button
                        type="button"
                        data-plain
                        onClick={() => router.push(`/whiteboards/${item.id}`)}
                        className="flex items-center gap-3 text-left"
                      >
                        <span className="flex h-8 w-8 shrink-0 items-center justify-center text-zinc-500">
                          <PenTool className="h-3.5 w-3.5" />
                        </span>
                        <span className="text-sm font-bold text-zinc-800 dark:text-zinc-200 leading-tight hover:underline">
                          {item.name}
                        </span>
                      </button>
                    </td>
                    <td className="px-4 py-3 text-zinc-500 dark:text-zinc-400">
                      {item.pageCount} page{item.pageCount === 1 ? "" : "s"}
                    </td>
                    <td className="px-4 py-3 text-zinc-500 dark:text-zinc-400">
                      {new Date(item.updatedAt).toLocaleDateString(undefined, {
                        year: "numeric",
                        month: "short",
                        day: "numeric",
                      })}
                    </td>
                    <td className="px-4 py-3 text-right">
                      <button
                        type="button"
                        onClick={() => setConfirmTarget(item)}
                        disabled={isPending && deletingId === item.id}
                        aria-label={`Delete ${item.name}`}
                        className="inline-flex p-1.5 rounded-lg text-zinc-400 hover:text-red-600 hover:bg-red-50 dark:hover:bg-red-500/10 transition-colors disabled:opacity-50"
                      >
                        {isPending && deletingId === item.id ? (
                          <Loader2 className="h-3.5 w-3.5 animate-spin" />
                        ) : (
                          <Trash2 className="h-3.5 w-3.5" />
                        )}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {confirmTarget && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm"
          onClick={() => setConfirmTarget(null)}
          role="dialog"
          aria-modal="true"
          aria-label="Confirm delete"
        >
          <div
            onClick={(e) => e.stopPropagation()}
            className="w-full max-w-sm overflow-hidden rounded-2xl border border-border bg-white shadow-2xl dark:bg-[#0f0f0f]"
          >
            <div className="flex items-start gap-3 p-5">
              <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-amber-500" />
              <div className="min-w-0">
                <h2 className="text-sm font-semibold text-zinc-900 dark:text-zinc-50">
                  Delete &quot;{confirmTarget.name}&quot;?
                </h2>
                <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">
                  This can&apos;t be undone — all {confirmTarget.pageCount} page
                  {confirmTarget.pageCount === 1 ? "" : "s"} will be permanently removed.
                </p>
              </div>
            </div>
            <div className="flex justify-end gap-2 border-t border-border p-4">
              <button
                type="button"
                onClick={() => setConfirmTarget(null)}
                className="h-9 rounded-full btn-surface px-4 text-xs font-normal uppercase tracking-wider transition-colors"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => handleDelete(confirmTarget.id)}
                className="inline-flex h-9 items-center justify-center gap-2 rounded-full bg-red-600 px-4 text-xs font-bold uppercase tracking-wider text-white transition-colors hover:bg-red-700"
              >
                Delete
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
