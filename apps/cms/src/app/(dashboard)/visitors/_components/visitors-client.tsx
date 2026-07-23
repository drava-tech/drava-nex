"use client";

import React, { useCallback, useEffect, useState, useTransition } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Button, Badge } from "@platform/ui";
import { createVisitor, updateVisitor } from "@/actions/visitor-actions";
import { setVisionTriggerArmed } from "@/actions/vision-actions";
import { MediaPicker } from "@/components/media-picker";
import { useCmsScreenSync, type VisitorDetectedEvent } from "@/hooks/useCmsScreenSync";
import type { VisitorListItem } from "@platform/types";

interface Props {
  visitors: VisitorListItem[];
  total: number;
  page: number;
  pageSize: number;
  search: string;
  initialTriggerArmed: boolean;
}

function formatSeen(iso: string) {
  return new Date(iso).toLocaleString(undefined, {
    month: "short",
    day: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function VisitorsClient({
  visitors,
  total,
  page,
  pageSize,
  search,
  initialTriggerArmed,
}: Props) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [isPending, startTransition] = useTransition();
  const [searchInput, setSearchInput] = useState(search);
  const [editing, setEditing] = useState<string | null>(null);
  const [form, setForm] = useState({ name: "", email: "" });
  const [error, setError] = useState<string | null>(null);
  const [triggerArmed, setTriggerArmed] = useState(initialTriggerArmed);
  const [isToggling, startToggleTransition] = useTransition();

  // Manual "Add guest" — staff enrolls someone with no camera scan.
  const [showAddForm, setShowAddForm] = useState(false);
  const [addForm, setAddForm] = useState({ name: "", email: "", photoUrl: "" });
  const [showPhotoPicker, setShowPhotoPicker] = useState(false);
  const [addError, setAddError] = useState<string | null>(null);
  const [isAdding, startAddTransition] = useTransition();

  // Debug camera preview — polls the latest JPEG (boxes drawn server-side by
  // services/vision) so you can visually confirm detection without needing a
  // separate local script. cam-entrance must match VISION_CAMERAS in the
  // vision service's .env.
  const [snapshotTick, setSnapshotTick] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setSnapshotTick((t) => t + 1), 1500);
    return () => clearInterval(id);
  }, []);
  const [snapshotAvailable, setSnapshotAvailable] = useState(true);

  function toggleTrigger() {
    const next = !triggerArmed;
    setError(null);
    startToggleTransition(async () => {
      try {
        const armed = await setVisionTriggerArmed(next);
        setTriggerArmed(armed);
      } catch (err) {
        setError((err as Error).message);
      }
    });
  }

  // Live list — seeded from the server render, then mutated by WS events.
  const [items, setItems] = useState<VisitorListItem[]>(visitors);
  const [live, setLive] = useState(false);
  // Re-seed when the server re-renders (page / search navigation).
  useEffect(() => setItems(visitors), [visitors]);

  const onVisitorDetected = useCallback(
    (v: VisitorDetectedEvent) => {
      setItems((prev) => {
        const idx = prev.findIndex((x) => x.uuid === v.uuid);
        if (idx >= 0) {
          // Known visitor — bump last_seen and float to the top.
          const updated: VisitorListItem = {
            ...prev[idx]!,
            lastSeen: v.lastSeen,
            hasImage: prev[idx]!.hasImage || v.hasImage,
          };
          const next = prev.slice();
          next.splice(idx, 1);
          return [updated, ...next];
        }
        // New visitor — only inject on the first, unfiltered page so we don't
        // pollute a searched/paginated view.
        if (page !== 1 || search) return prev;
        const fresh: VisitorListItem = {
          uuid: v.uuid,
          name: v.name,
          email: "",
          role: "guest",
          hasImage: v.hasImage,
          photoUrl: null,
          firstSeen: v.lastSeen,
          lastSeen: v.lastSeen,
        };
        return [fresh, ...prev];
      });
    },
    [page, search]
  );

  useCmsScreenSync({ onVisitorDetected, onConnectionChange: setLive });

  const totalPages = Math.max(1, Math.ceil(total / pageSize));

  function navigate(nextPage: number, nextSearch: string) {
    const params = new URLSearchParams(searchParams.toString());
    if (nextSearch) params.set("search", nextSearch);
    else params.delete("search");
    if (nextPage > 1) params.set("page", String(nextPage));
    else params.delete("page");
    const qs = params.toString();
    router.push(qs ? `/visitors?${qs}` : "/visitors");
  }

  function startEdit(v: VisitorListItem) {
    setEditing(v.uuid);
    setForm({ name: v.name, email: v.email });
    setError(null);
  }

  function handleSave(uuid: string) {
    setError(null);
    const patch = { ...form };
    startTransition(async () => {
      try {
        await updateVisitor(uuid, patch);
        // Reflect the edit in the live list without a full refetch.
        setItems((prev) =>
          prev.map((x) =>
            x.uuid === uuid ? { ...x, name: patch.name, email: patch.email } : x
          )
        );
        setEditing(null);
      } catch (err) {
        setError((err as Error).message);
      }
    });
  }

  function openAddForm() {
    setAddForm({ name: "", email: "", photoUrl: "" });
    setAddError(null);
    setShowAddForm(true);
  }

  function handleAddSubmit(e: React.FormEvent) {
    e.preventDefault();
    setAddError(null);
    const name = addForm.name.trim();
    if (!name) {
      setAddError("Name is required.");
      return;
    }
    const payload = {
      name,
      email: addForm.email.trim(),
      photoUrl: addForm.photoUrl || undefined,
    };
    startAddTransition(async () => {
      try {
        const created = await createVisitor(payload);
        // Prepend so the new guest shows up immediately, same as a fresh detection.
        setItems((prev) => [created, ...prev]);
        setShowAddForm(false);
      } catch (err) {
        setAddError((err as Error).message);
      }
    });
  }

  return (
    <div className="flex flex-col gap-4">
      <form
        onSubmit={(e) => {
          e.preventDefault();
          navigate(1, searchInput.trim());
        }}
        className="flex items-center gap-2"
      >
        <input
          type="text"
          placeholder="Search name or email…"
          value={searchInput}
          onChange={(e) => setSearchInput(e.target.value)}
          className="w-64 rounded-md border border-input bg-background px-3 py-2 text-sm"
        />
        <Button type="submit" size="sm" variant="secondary">
          Search
        </Button>
        <Button type="button" size="sm" onClick={openAddForm}>
          Add guest
        </Button>
        <Button
          type="button"
          size="sm"
          variant={triggerArmed ? "default" : "secondary"}
          onClick={toggleTrigger}
          disabled={isToggling}
          className="ml-auto"
          title="While armed, a detected face switches the idle main screen to the Welcome experience"
        >
          {isToggling
            ? "Updating…"
            : triggerArmed
              ? "Welcome-screen trigger: ON"
              : "Welcome-screen trigger: OFF"}
        </Button>
        <span
          className={`inline-flex items-center gap-1.5 text-xs font-medium ${live ? "text-green-600" : "text-muted-foreground"
            }`}
          title={live ? "Receiving live detections" : "Reconnecting…"}
        >
          <span
            className={`h-2 w-2 rounded-full ${live ? "bg-green-500" : "bg-muted-foreground/50"}`}
          />
          {live ? "Live" : "Offline"}
        </span>
        <span className="text-sm text-muted-foreground">
          {total} visitor{total === 1 ? "" : "s"}
        </span>
      </form>

      <div className="rounded-lg border p-3">
        <p className="mb-2 text-xs font-medium text-muted-foreground">
          Camera preview (cam-entrance) — green box = counts as present, red = too small/far
        </p>
        {!snapshotAvailable && (
          <p className="mb-2 text-sm text-muted-foreground">
            No recent snapshot — is the vision pipeline running?
          </p>
        )}
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={`/api/vision-snapshot/cam-entrance?t=${snapshotTick}`}
          alt="Live camera detection preview"
          className={`max-h-80 rounded-md border bg-black ${snapshotAvailable ? "" : "hidden"}`}
          onError={() => setSnapshotAvailable(false)}
          onLoad={() => setSnapshotAvailable(true)}
        />
      </div>

      {error && <p className="text-sm text-destructive">{error}</p>}

      <div className="overflow-x-auto rounded-lg border">
        <table className="w-full text-sm">
          <thead className="border-b bg-muted/40">
            <tr>
              <th className="px-4 py-3 text-left font-medium">Photo</th>
              <th className="px-4 py-3 text-left font-medium">Name</th>
              <th className="px-4 py-3 text-left font-medium">Email</th>
              <th className="px-4 py-3 text-left font-medium">Role</th>
              <th className="px-4 py-3 text-left font-medium">First seen</th>
              <th className="px-4 py-3 text-left font-medium">Last seen</th>
              <th className="px-4 py-3 text-left font-medium">Actions</th>
            </tr>
          </thead>
          <tbody>
            {items.length === 0 && (
              <tr>
                <td colSpan={7} className="px-4 py-8 text-center text-muted-foreground">
                  No visitors yet.
                </td>
              </tr>
            )}
            {items.map((v) => (
              <tr key={v.uuid} className="border-b last:border-0">
                <td className="px-4 py-2">
                  {v.photoUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={v.photoUrl}
                      alt={v.name || "Unknown visitor"}
                      className="h-12 w-12 rounded-full object-cover"
                    />
                  ) : v.hasImage ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={`/api/visitors/${v.uuid}/image`}
                      alt={v.name || "Unknown visitor"}
                      className="h-12 w-12 rounded-full object-cover"
                    />
                  ) : (
                    <div
                      className="flex h-12 w-12 items-center justify-center rounded-full bg-muted text-xs text-muted-foreground"
                      title="Photo purged"
                    >
                      —
                    </div>
                  )}
                </td>
                {editing === v.uuid ? (
                  <>
                    <td className="px-4 py-2">
                      <input
                        type="text"
                        value={form.name}
                        placeholder="Name"
                        onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                        className="w-full rounded-md border border-input bg-background px-2 py-1 text-sm"
                      />
                    </td>
                    <td className="px-4 py-2">
                      <input
                        type="email"
                        value={form.email}
                        placeholder="Email"
                        onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))}
                        className="w-full rounded-md border border-input bg-background px-2 py-1 text-sm"
                      />
                    </td>
                  </>
                ) : (
                  <>
                    <td className="px-4 py-3 font-medium">
                      {v.name || <span className="text-muted-foreground italic">Unknown</span>}
                    </td>
                    <td className="px-4 py-3 text-muted-foreground">{v.email || "—"}</td>
                  </>
                )}
                <td className="px-4 py-3">
                  <Badge variant="secondary">{v.role}</Badge>
                </td>
                <td className="px-4 py-3 text-muted-foreground">{formatSeen(v.firstSeen)}</td>
                <td className="px-4 py-3 text-muted-foreground">{formatSeen(v.lastSeen)}</td>
                <td className="px-4 py-3">
                  {editing === v.uuid ? (
                    <div className="flex gap-2">
                      <Button size="sm" onClick={() => handleSave(v.uuid)} disabled={isPending}>
                        {isPending ? "Saving…" : "Save"}
                      </Button>
                      <Button
                        size="sm"
                        variant="secondary"
                        onClick={() => setEditing(null)}
                        disabled={isPending}
                      >
                        Cancel
                      </Button>
                    </div>
                  ) : (
                    <Button size="sm" variant="secondary" onClick={() => startEdit(v)}>
                      Edit
                    </Button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {totalPages > 1 && (
        <div className="flex items-center justify-end gap-2">
          <Button
            size="sm"
            variant="secondary"
            disabled={page <= 1}
            onClick={() => navigate(page - 1, search)}
          >
            Previous
          </Button>
          <span className="text-sm text-muted-foreground">
            Page {page} of {totalPages}
          </span>
          <Button
            size="sm"
            variant="secondary"
            disabled={page >= totalPages}
            onClick={() => navigate(page + 1, search)}
          >
            Next
          </Button>
        </div>
      )}

      {showAddForm && (
        <div
          className="fixed inset-0 z-[100] flex items-center justify-center"
          onClick={() => !isAdding && setShowAddForm(false)}
        >
          <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" />
          <div
            className="relative w-full max-w-sm rounded-2xl border bg-background p-5 shadow-xl"
            onClick={(e) => e.stopPropagation()}
          >
            <h2 className="mb-1 text-sm font-semibold">Add guest</h2>
            <p className="mb-4 text-xs text-muted-foreground">
              Manually enrolls a guest with no camera scan — they won&apos;t be
              recognized at the entrance camera, only listed here.
            </p>
            <form onSubmit={handleAddSubmit} className="flex flex-col gap-3">
              <div className="flex flex-col gap-1">
                <label className="text-xs font-medium text-muted-foreground">
                  Name <span className="text-destructive">*</span>
                </label>
                <input
                  type="text"
                  autoFocus
                  value={addForm.name}
                  onChange={(e) => setAddForm((f) => ({ ...f, name: e.target.value }))}
                  className="rounded-md border border-input bg-background px-3 py-2 text-sm"
                  disabled={isAdding}
                />
              </div>
              <div className="flex flex-col gap-1">
                <label className="text-xs font-medium text-muted-foreground">
                  Email (optional)
                </label>
                <input
                  type="email"
                  value={addForm.email}
                  onChange={(e) => setAddForm((f) => ({ ...f, email: e.target.value }))}
                  className="rounded-md border border-input bg-background px-3 py-2 text-sm"
                  disabled={isAdding}
                />
              </div>
              <div className="flex flex-col gap-1.5">
                <label className="text-xs font-medium text-muted-foreground">
                  Photo (optional)
                </label>
                {addForm.photoUrl ? (
                  <div className="relative h-20 w-20 group">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={addForm.photoUrl}
                      alt=""
                      className="h-20 w-20 rounded-full object-cover border"
                    />
                    <div className="absolute inset-0 flex items-center justify-center gap-1 rounded-full bg-black/0 opacity-0 transition-colors group-hover:bg-black/40 group-hover:opacity-100">
                      <button
                        type="button"
                        disabled={isAdding}
                        onClick={() => setShowPhotoPicker(true)}
                        className="rounded-md bg-white px-2 py-1 text-[10px] font-semibold text-zinc-900 disabled:opacity-50"
                      >
                        Change
                      </button>
                      <button
                        type="button"
                        disabled={isAdding}
                        onClick={() => setAddForm((f) => ({ ...f, photoUrl: "" }))}
                        className="rounded-md bg-zinc-900/80 px-2 py-1 text-[10px] font-semibold text-white disabled:opacity-50"
                      >
                        Remove
                      </button>
                    </div>
                  </div>
                ) : (
                  <button
                    type="button"
                    disabled={isAdding}
                    onClick={() => setShowPhotoPicker(true)}
                    className="flex items-center justify-center gap-2 rounded-lg border border-dashed border-zinc-300 py-4 text-xs font-semibold text-muted-foreground hover:border-zinc-400 hover:text-foreground disabled:opacity-50 dark:border-zinc-700"
                  >
                    Select from media
                  </button>
                )}
              </div>
              {addError && <p className="text-xs text-destructive">{addError}</p>}
              <div className="mt-1 flex justify-end gap-2">
                <Button
                  type="button"
                  size="sm"
                  variant="secondary"
                  onClick={() => setShowAddForm(false)}
                  disabled={isAdding}
                >
                  Cancel
                </Button>
                <Button type="submit" size="sm" disabled={isAdding}>
                  {isAdding ? "Adding…" : "Add guest"}
                </Button>
              </div>
            </form>
          </div>
        </div>
      )}

      <MediaPicker
        open={showPhotoPicker}
        onClose={() => setShowPhotoPicker(false)}
        accept="image"
        onSelect={(url) => setAddForm((f) => ({ ...f, photoUrl: url }))}
      />
    </div>
  );
}
