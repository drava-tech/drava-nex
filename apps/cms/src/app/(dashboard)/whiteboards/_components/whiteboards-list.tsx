"use client";

import { useState, useTransition } from "react";
import { PenTool, Trash2, Loader2 } from "lucide-react";
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from "@platform/ui";
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
      </div>

      <div className="flex-1 overflow-y-auto min-h-0">
        {items.length === 0 ? (
          <div className="flex flex-col items-center justify-center gap-2 py-24 text-center">
            <PenTool className="h-6 w-6 text-zinc-400" />
            <p className="text-xs text-zinc-400 dark:text-zinc-600">No saved whiteboards yet.</p>
          </div>
        ) : (
          <div className="rounded-2xl border border-zinc-200 dark:border-zinc-900 overflow-hidden">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Name</TableHead>
                  <TableHead>Pages</TableHead>
                  <TableHead>Updated</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {items.map((item) => (
                  <TableRow key={item.id}>
                    <TableCell>
                      <button
                        type="button"
                        onClick={() => openWhiteboardDocument(item.id)}
                        className="flex items-center gap-3 text-left"
                      >
                        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-zinc-100 dark:bg-zinc-900 text-zinc-500">
                          <PenTool className="h-3.5 w-3.5" />
                        </span>
                        <span className="text-sm font-bold text-zinc-800 dark:text-zinc-200 leading-tight hover:underline">
                          {item.name}
                        </span>
                      </button>
                    </TableCell>
                    <TableCell className="text-zinc-500 dark:text-zinc-400">
                      {item.pageCount} page{item.pageCount === 1 ? "" : "s"}
                    </TableCell>
                    <TableCell className="text-zinc-500 dark:text-zinc-400">
                      {new Date(item.updatedAt).toLocaleDateString(undefined, {
                        year: "numeric",
                        month: "short",
                        day: "numeric",
                      })}
                    </TableCell>
                    <TableCell className="text-right">
                      <button
                        type="button"
                        onClick={() => handleDelete(item.id)}
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
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </div>
    </div>
  );
}
