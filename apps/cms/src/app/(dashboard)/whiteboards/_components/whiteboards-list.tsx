"use client";

import { useState, useTransition } from "react";
import { PenTool, Trash2, Loader2 } from "lucide-react";
import { useWhiteboardEditor } from "@/lib/whiteboard-editor-context";
import { deleteWhiteboard } from "@/actions/whiteboard-actions";

interface WhiteboardListItem {
  id: string;
  name: string;
  pageCount: number;
  updatedAt: string;
}

export function WhiteboardsList({ items }: { items: WhiteboardListItem[] }) {
  const { openWhiteboardDocument } = useWhiteboardEditor();
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const handleDelete = (id: string) => {
    setDeletingId(id);
    startTransition(async () => {
      await deleteWhiteboard(id);
      setDeletingId(null);
    });
  };

  return (
    <div className="flex flex-col gap-6 h-full min-h-0">
      <div>
        <p className="text-[9px] font-bold text-zinc-400 dark:text-zinc-500 tracking-[0.25em] uppercase mb-0.5">
          Saved Boards
        </p>
        <h1 className="text-xl font-bold text-zinc-900 dark:text-zinc-100 tracking-wide uppercase">Whiteboards</h1>
        <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">
          Start a new one from the pencil button on any page — save it there and it shows up here, fully editable.
        </p>
      </div>

      <div className="flex-1 overflow-y-auto min-h-0">
        {items.length === 0 ? (
          <div className="flex flex-col items-center justify-center gap-2 py-24 text-center">
            <PenTool className="h-6 w-6 text-zinc-400" />
            <p className="text-xs text-zinc-400 dark:text-zinc-600">No saved whiteboards yet.</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {items.map((item) => (
              <div
                key={item.id}
                className="relative flex flex-col rounded-2xl border border-zinc-200 dark:border-zinc-900 bg-white dark:bg-zinc-950 p-4 shadow-sm"
              >
                <button
                  type="button"
                  onClick={() => openWhiteboardDocument(item.id)}
                  className="flex flex-1 flex-col items-start text-left"
                >
                  <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-zinc-100 dark:bg-zinc-900 text-zinc-500 mb-3">
                    <PenTool className="h-4 w-4" />
                  </span>
                  <span className="text-sm font-bold text-zinc-800 dark:text-zinc-200 leading-tight truncate w-full">
                    {item.name}
                  </span>
                  <span className="mt-1 text-[10px] text-zinc-400 dark:text-zinc-500">
                    {item.pageCount} page{item.pageCount === 1 ? "" : "s"} · updated{" "}
                    {new Date(item.updatedAt).toLocaleDateString()}
                  </span>
                </button>
                <button
                  type="button"
                  onClick={() => handleDelete(item.id)}
                  disabled={isPending && deletingId === item.id}
                  aria-label={`Delete ${item.name}`}
                  className="absolute top-3 right-3 p-1.5 rounded-lg text-zinc-400 hover:text-red-600 hover:bg-red-50 dark:hover:bg-red-500/10 transition-colors disabled:opacity-50"
                >
                  {isPending && deletingId === item.id ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <Trash2 className="h-3.5 w-3.5" />
                  )}
                </button>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
