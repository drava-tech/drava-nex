"use client";

import { useEffect, useState, useTransition } from "react";
import { X, Trash2, User, GitMerge } from "lucide-react";
import { Button } from "@platform/ui";
import {
  updateVisitor,
  listVisitorPhotos,
  deleteVisitorPhoto,
  mergeVisitor,
} from "@/actions/visitor-actions";
import type { VisitorListItem } from "@platform/types";

interface Props {
  uuid: string;
  name: string;
  email: string;
  mergeTargets: VisitorListItem[];
  onClose: () => void;
  onSaved: (patch: { name: string; email: string }) => void;
  onMerged: () => void;
}

export function EditVisitorModal({ uuid, name, email, mergeTargets, onClose, onSaved, onMerged }: Props) {
  const [form, setForm] = useState({ name, email });
  const [photos, setPhotos] = useState<number[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isSaving, startSave] = useTransition();
  const [deleting, setDeleting] = useState<number | null>(null);
  const [mergeTarget, setMergeTarget] = useState("");
  const [isMerging, startMerge] = useTransition();

  useEffect(() => {
    listVisitorPhotos(uuid).then(setPhotos).catch(() => setPhotos([]));
  }, [uuid]);

  function handleSave() {
    setError(null);
    startSave(async () => {
      try {
        await updateVisitor(uuid, form);
        onSaved(form);
        onClose();
      } catch (err) {
        setError((err as Error).message);
      }
    });
  }

  function handleDelete(n: number) {
    setError(null);
    setDeleting(n);
    deleteVisitorPhoto(uuid, n)
      .then(() => setPhotos((p) => (p ?? []).filter((x) => x !== n)))
      .catch((err) => setError((err as Error).message))
      .finally(() => setDeleting(null));
  }

  function handleMerge() {
    if (!mergeTarget) return;
    const target = mergeTargets.find((item) => item.uuid === mergeTarget);
    if (!target || !window.confirm(`Merge this identity into ${target.name || "the selected visitor"}? This cannot be undone.`)) {
      return;
    }
    setError(null);
    startMerge(async () => {
      try {
        await mergeVisitor(uuid, mergeTarget);
        onMerged();
      } catch (err) {
        setError((err as Error).message);
      }
    });
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center" onClick={onClose}>
      <div className="absolute inset-0 bg-black/70 backdrop-blur-sm" />
      <div
        className="relative w-full max-w-lg max-h-[90vh] overflow-y-auto rounded-2xl border border-border bg-white p-6 dark:bg-zinc-950"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-5 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <User className="h-4 w-4 text-muted-foreground" />
            <h2 className="text-sm font-bold uppercase tracking-wide">Edit visitor</h2>
          </div>
          <button
            onClick={onClose}
            className="rounded-lg p-2 text-muted-foreground hover:bg-muted"
            aria-label="Close"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="flex flex-col gap-4">
          <div>
            <label className="mb-1 block text-xs font-medium text-muted-foreground">Name</label>
            <input
              type="text"
              value={form.name}
              placeholder="Name"
              autoFocus
              onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
              className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
            />
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-muted-foreground">Email</label>
            <input
              type="email"
              value={form.email}
              placeholder="Email"
              onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))}
              className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
            />
          </div>

          <div>
            <div className="mb-1 flex items-baseline justify-between">
              <label className="text-xs font-medium text-muted-foreground">
                Captured photos{photos ? ` (${photos.length})` : ""}
              </label>
            </div>
            {photos === null ? (
              <p className="text-sm text-muted-foreground">Loading…</p>
            ) : photos.length === 0 ? (
              <p className="text-sm text-muted-foreground">No stored photos.</p>
            ) : (
              <div className="grid grid-cols-4 gap-2 sm:grid-cols-5">
                {photos.map((n) => (
                  <div key={n} className="group relative aspect-square">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={`/api/visitors/${uuid}/photos/${n}/image`}
                      alt={`Capture ${n}`}
                      className="h-full w-full rounded-md border object-cover"
                    />
                    <button
                      onClick={() => handleDelete(n)}
                      disabled={deleting === n}
                      title="Delete this photo"
                      className="absolute right-1 top-1 rounded-md bg-black/60 p-1 text-white opacity-0 transition-opacity hover:bg-destructive group-hover:opacity-100 disabled:opacity-100"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </div>
                ))}
              </div>
            )}
            <p className="mt-1.5 text-[11px] text-muted-foreground">
              Deleting a photo also removes that face sample from recognition.
            </p>
          </div>

          {error && <p className="text-sm text-destructive">{error}</p>}

          <div className="flex justify-end gap-2">
            <Button variant="secondary" size="sm" onClick={onClose} disabled={isSaving}>
              Cancel
            </Button>
            <Button size="sm" onClick={handleSave} disabled={isSaving}>
              {isSaving ? "Saving…" : "Save"}
            </Button>
          </div>

          {mergeTargets.length > 0 && (
            <div className="border-t pt-4">
              <div className="mb-2 flex items-center gap-2 text-xs font-medium text-muted-foreground">
                <GitMerge className="h-3.5 w-3.5" />
                Merge duplicate identity
              </div>
              <div className="flex gap-2">
                <select
                  value={mergeTarget}
                  onChange={(e) => setMergeTarget(e.target.value)}
                  disabled={isSaving || isMerging}
                  className="min-w-0 flex-1 rounded-md border border-input bg-background px-3 py-2 text-sm"
                >
                  <option value="">Select the identity to keep…</option>
                  {mergeTargets.map((target) => (
                    <option key={target.uuid} value={target.uuid}>
                      {target.name || "Unknown"} · {target.uuid.slice(0, 8)}
                    </option>
                  ))}
                </select>
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={handleMerge}
                  disabled={!mergeTarget || isSaving || isMerging}
                >
                  {isMerging ? "Merging…" : "Merge"}
                </Button>
              </div>
              <p className="mt-1.5 text-[11px] text-muted-foreground">
                All recognition samples and sightings move to the selected identity.
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
