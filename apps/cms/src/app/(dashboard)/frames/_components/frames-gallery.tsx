"use client";

import React, { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  AlertTriangle,
  Copy,
  LayoutTemplate,
  Loader2,
  MonitorUp,
  MoreHorizontal,
  Pencil,
  Plus,
  Search,
  Trash2,
} from "lucide-react";
import { Button } from "@platform/ui";
import { CanvasThumbnail, canvasOrientation } from "@platform/ui/templates/canvas";
import { StoryFrame } from "@platform/ui/templates/story";
import { deleteDesign, duplicateDesign, type DesignCard } from "@/actions/design-actions";
import { assignExperience, assignMedia } from "@/actions/screen-actions";
import { PushToScreenModal } from "@/components/push-to-screen-modal";
import { NewDesignDialog } from "./new-design-dialog";
import "@/templates/canvas/fonts";

type Filter = "all" | "landscape" | "portrait";
type KindFilter = "all" | "canvas" | "story";

/** A design's first page or a story's home menu, scaled into the box the caller sizes. */
function Thumb({ d, className, style }: { d: DesignCard; className?: string; style?: React.CSSProperties }) {
  return d.kind === "story" ? (
    <StoryFrame content={d.preview} still className={className} style={style} />
  ) : (
    <CanvasThumbnail content={d.preview} className={className} style={style} />
  );
}

export function FramesGallery({ designs }: { designs: DesignCard[] }) {
  const router = useRouter();
  const [filter, setFilter] = useState<Filter>("all");
  const [kind, setKind] = useState<KindFilter>("all");
  const [query, setQuery] = useState("");
  const [newOpen, setNewOpen] = useState(false);
  const [pushTarget, setPushTarget] = useState<DesignCard | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<DesignCard | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [menuId, setMenuId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [, startTransition] = useTransition();

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    return designs.filter((d) => {
      const o = canvasOrientation(d.preview.width, d.preview.height);
      if (filter === "landscape" && o === "portrait") return false;
      if (filter === "portrait" && o === "landscape") return false;
      if (kind !== "all" && d.kind !== kind) return false;
      return !q || d.name.toLowerCase().includes(q);
    });
  }, [designs, filter, kind, query]);

  const counts = useMemo(() => {
    let landscape = 0;
    let portrait = 0;
    for (const d of designs) {
      const o = canvasOrientation(d.preview.width, d.preview.height);
      if (o === "portrait") portrait++;
      else if (o === "landscape") landscape++;
    }
    return { all: designs.length, landscape, portrait };
  }, [designs]);

  const open = (d: DesignCard) => router.push(`/edit/experiences/${d.slug}`);

  const duplicate = (d: DesignCard) => {
    setMenuId(null);
    setBusyId(d.id);
    startTransition(async () => {
      const res = await duplicateDesign(d.id);
      setBusyId(null);
      if (!res.success) setError(res.error);
      else router.refresh();
    });
  };

  const remove = (d: DesignCard) => {
    setConfirmDelete(null);
    setBusyId(d.id);
    startTransition(async () => {
      const res = await deleteDesign(d.id);
      setBusyId(null);
      if (!res.success) setError(res.error ?? "Couldn't delete.");
      else router.refresh();
    });
  };

  return (
    <div className="flex h-full min-h-0 flex-col gap-5" onClick={() => setMenuId(null)}>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <div className="mr-2 flex rounded-full bg-zinc-200/80 p-0.5 dark:bg-zinc-800">
            {(
              [
                ["all", "Everything"],
                ["canvas", "Designs"],
                ["story", "Stories"],
              ] as const
            ).map(([k, label]) => (
              <button
                key={k}
                type="button"
                onClick={() => setKind(k)}
                className={`h-7 rounded-full px-3 text-xs font-medium transition-colors ${
                  kind === k ? "bg-white text-zinc-900 shadow-sm dark:bg-zinc-950 dark:text-zinc-100" : "text-zinc-500"
                }`}
              >
                {label}
              </button>
            ))}
          </div>
          {(["all", "landscape", "portrait"] as const).map((f) => (
            <button
              key={f}
              type="button"
              onClick={() => setFilter(f)}
              className={`h-8 rounded-full px-3.5 text-xs font-medium capitalize transition-colors ${
                filter === f
                  ? "bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900"
                  : "btn-surface text-zinc-600 dark:text-zinc-300"
              }`}
            >
              {f} <span className="opacity-60">{counts[f]}</span>
            </button>
          ))}
          <div className="relative ml-1">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-zinc-400" />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search designs"
              className="h-8 w-52 rounded-full border border-border bg-white pl-8 pr-3 text-xs outline-none focus:border-violet-500 dark:bg-zinc-900"
            />
          </div>
        </div>
        <Button size="pill" onClick={() => setNewOpen(true)}>
          <Plus className="h-4 w-4" /> New
        </Button>
      </div>

      {error && (
        <div className="rounded-lg border border-red-300 bg-red-50 px-3 py-2 text-xs text-red-700 dark:border-red-500/30 dark:bg-red-500/10 dark:text-red-300">
          {error}
        </div>
      )}

      <div className="min-h-0 flex-1 overflow-y-auto">
        {designs.length === 0 ? (
          <div className="flex flex-col items-center justify-center gap-3 py-24 text-center">
            <LayoutTemplate className="h-8 w-8 text-zinc-400" />
            <div>
              <p className="text-sm font-semibold text-zinc-700 dark:text-zinc-200">Nothing here yet</p>
              <p className="mt-1 text-xs text-zinc-500">
                Lay out a screen design, or build an interactive touchscreen story, then push it.
              </p>
            </div>
            <Button size="pill" onClick={() => setNewOpen(true)}>
              <Plus className="h-4 w-4" /> Create your first design
            </Button>
          </div>
        ) : visible.length === 0 ? (
          <p className="py-24 text-center text-xs text-zinc-500">No designs match.</p>
        ) : (
          <div className="grid grid-cols-[repeat(auto-fill,minmax(220px,1fr))] gap-4 pb-4">
            {visible.map((d) => {
              const o = canvasOrientation(d.preview.width, d.preview.height);
              return (
                <div
                  key={d.id}
                  className="group relative flex flex-col overflow-hidden rounded-xl border border-border bg-white dark:bg-zinc-900"
                >
                  <button
                    type="button"
                    data-plain
                    onClick={() => open(d)}
                    className="relative flex h-[200px] items-center justify-center bg-zinc-200/70 p-3 dark:bg-zinc-800/70"
                    title="Edit"
                  >
                    <Thumb
                      d={d}
                      className="rounded shadow-md"
                      style={{
                        aspectRatio: `${d.preview.width} / ${d.preview.height}`,
                        height: o === "landscape" ? undefined : "100%",
                        width: o === "landscape" ? "100%" : undefined,
                        maxHeight: "100%",
                        maxWidth: "100%",
                      }}
                    />
                    {busyId === d.id && (
                      <div className="absolute inset-0 flex items-center justify-center bg-black/30">
                        <Loader2 className="h-5 w-5 animate-spin text-white" />
                      </div>
                    )}
                  </button>
                  <div className="flex items-start justify-between gap-2 px-3 py-2.5">
                    <div className="min-w-0">
                      <p className="truncate text-sm font-semibold text-zinc-800 dark:text-zinc-100">{d.name}</p>
                      <p className="text-[11px] capitalize text-zinc-500">
                        {d.kind === "story" ? "Story" : "Design"} · {o} · {d.preview.width}×{d.preview.height}
                        {d.kind === "canvas" && d.pageCount > 1 && ` · ${d.pageCount} pages`}
                        {d.kind === "story" && ` · ${d.appCount} module${d.appCount === 1 ? "" : "s"}`}
                      </p>
                    </div>
                    <div className="flex shrink-0 items-center gap-0.5">
                      <button
                        type="button"
                        data-plain
                        onClick={() => setPushTarget(d)}
                        title="Push to screen"
                        aria-label={`Push ${d.name} to screen`}
                        className="rounded-md p-1.5 text-zinc-500 hover:bg-zinc-100 hover:text-zinc-900 dark:hover:bg-zinc-800 dark:hover:text-zinc-100"
                      >
                        <MonitorUp className="h-4 w-4" />
                      </button>
                      <div className="relative">
                        <button
                          type="button"
                          data-plain
                          onClick={(e) => {
                            e.stopPropagation();
                            setMenuId(menuId === d.id ? null : d.id);
                          }}
                          title="More"
                          aria-label={`More actions for ${d.name}`}
                          className="rounded-md p-1.5 text-zinc-500 hover:bg-zinc-100 hover:text-zinc-900 dark:hover:bg-zinc-800 dark:hover:text-zinc-100"
                        >
                          <MoreHorizontal className="h-4 w-4" />
                        </button>
                        {menuId === d.id && (
                          <div
                            onClick={(e) => e.stopPropagation()}
                            className="absolute bottom-full right-0 z-20 mb-1 w-40 overflow-hidden rounded-lg border border-border bg-white py-1 shadow-xl dark:bg-zinc-900"
                          >
                            <MenuItem onClick={() => open(d)} icon={<Pencil className="h-3.5 w-3.5" />}>Edit</MenuItem>
                            <MenuItem onClick={() => duplicate(d)} icon={<Copy className="h-3.5 w-3.5" />}>Duplicate</MenuItem>
                            <MenuItem
                              danger
                              onClick={() => {
                                setMenuId(null);
                                setConfirmDelete(d);
                              }}
                              icon={<Trash2 className="h-3.5 w-3.5" />}
                            >
                              Delete
                            </MenuItem>
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {newOpen && <NewDesignDialog onClose={() => setNewOpen(false)} />}

      {pushTarget && (
        <PushToScreenModal
          contentName={pushTarget.name}
          preview={
            <div className="absolute inset-0 bg-zinc-900 p-6">
              <Thumb d={pushTarget} style={{ width: "100%", height: "100%" }} />
            </div>
          }
          onPush={(screenId) => assignExperience(screenId, pushTarget.id)}
          isAlreadyShowing={(s) => s.currentContentKind === "experience" && s.currentExperienceId === pushTarget.id}
          onClose={() => {
            setPushTarget(null);
            router.refresh();
          }}
          onRemove={async (s) => {
            await assignMedia(s.screenId, null);
          }}
        />
      )}

      {confirmDelete && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm"
          onClick={() => setConfirmDelete(null)}
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
                  Delete &quot;{confirmDelete.name}&quot;?
                </h2>
                <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">
                  Screens showing it will fall back to their idle content.
                </p>
              </div>
            </div>
            <div className="flex justify-end gap-2 border-t border-border p-4">
              <button
                type="button"
                onClick={() => setConfirmDelete(null)}
                className="h-9 rounded-full btn-surface px-4 text-xs font-normal uppercase tracking-wider transition-colors"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => remove(confirmDelete)}
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

function MenuItem({
  onClick,
  icon,
  danger,
  children,
}: {
  onClick: () => void;
  icon: React.ReactNode;
  danger?: boolean;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      data-plain
      onClick={onClick}
      className={`flex w-full items-center gap-2 px-3 py-2 text-left text-xs hover:bg-zinc-100 dark:hover:bg-zinc-800 ${
        danger ? "text-red-600" : "text-zinc-700 dark:text-zinc-200"
      }`}
    >
      {icon}
      {children}
    </button>
  );
}
