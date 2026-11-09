"use client";

import { useMemo, useState } from "react";
import { Check, FolderPlus, FolderPen, Search, X } from "lucide-react";
import type { ScreenGroupRow, ScreenRow } from "@platform/db";
import {
  createScreenGroup,
  renameScreenGroup,
  setScreenGroupMembers,
} from "@/actions/screen-group-actions";

interface ScreenGroupDialogProps {
  /** The group being edited; omit to create a new one. */
  group?: ScreenGroupRow;
  groups: ScreenGroupRow[];
  screens: ScreenRow[];
  onClose: () => void;
  onSaved: () => void;
}

/**
 * Create a screen group, or edit one: its name and which screens are in it.
 * Ticking a screen that is already in another group moves it here, since a
 * screen sits in one group at a time.
 */
export function ScreenGroupDialog({ group, groups, screens, onClose, onSaved }: ScreenGroupDialogProps) {
  const isEdit = Boolean(group);
  const [name, setName] = useState(group?.name ?? "");
  const [selected, setSelected] = useState<Set<string>>(
    () => new Set(group ? screens.filter((s) => s.groupId === group.id).map((s) => s.screenId) : [])
  );
  const [query, setQuery] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const groupNames = useMemo(() => new Map(groups.map((g) => [g.id, g.name])), [groups]);
  const q = query.trim().toLowerCase();
  const visible = q
    ? screens.filter((s) => s.screenName.toLowerCase().includes(q) || s.screenId.toLowerCase().includes(q))
    : screens;

  const toggle = (screenId: string) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(screenId)) next.delete(screenId);
      else next.add(screenId);
      return next;
    });

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = name.trim();
    if (!trimmed) {
      setError("Give the group a name.");
      return;
    }
    setSaving(true);
    setError(null);
    const ids = [...selected];
    let result;
    if (group) {
      result = trimmed === group.name ? { success: true as const } : await renameScreenGroup(group.id, trimmed);
      if (result.success) result = await setScreenGroupMembers(group.id, ids);
    } else {
      result = await createScreenGroup(trimmed, ids);
    }
    if (!result.success) {
      setError(result.error);
      setSaving(false);
      return;
    }
    onSaved();
  };

  const Icon = isEdit ? FolderPen : FolderPlus;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" onClick={onClose}>
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" />
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="screen-group-dialog-title"
        className="relative flex max-h-[85vh] w-full max-w-md flex-col rounded-3xl border border-border bg-popover p-6 text-popover-foreground shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-5 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Icon className="h-4 w-4 text-primary-ink" />
            <h2 id="screen-group-dialog-title" className="font-heading text-base">
              {isEdit ? "Edit group" : "New group"}
            </h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="rounded-full p-2 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="flex min-h-0 flex-1 flex-col gap-4">
          <div>
            <label htmlFor="screen-group-name" className="mb-2 block text-xs text-muted-foreground">
              Group name
            </label>
            <input
              id="screen-group-name"
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Lobby"
              maxLength={60}
              autoFocus
              className="w-full rounded-xl border border-input bg-background px-3 py-2.5 text-sm text-foreground outline-none transition-colors placeholder:text-muted-foreground focus:border-ring"
            />
          </div>

          <div className="flex min-h-0 flex-1 flex-col gap-2">
            <div className="flex items-center justify-between">
              <span className="text-xs text-muted-foreground">Screens in this group</span>
              <span className="text-xs text-muted-foreground">{selected.size} selected</span>
            </div>
            {screens.length > 6 && (
              <div className="relative flex items-center">
                <Search className="pointer-events-none absolute left-3 h-3.5 w-3.5 text-muted-foreground" />
                <input
                  type="search"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="Find a screen"
                  aria-label="Find a screen"
                  className="w-full rounded-full border border-input bg-background py-1.5 pl-8 pr-3 text-xs text-foreground outline-none placeholder:text-muted-foreground focus:border-ring"
                />
              </div>
            )}
            <ul className="min-h-0 flex-1 overflow-y-auto rounded-2xl border border-border">
              {screens.length === 0 && (
                <li className="px-4 py-6 text-center text-xs text-muted-foreground">No screens yet.</li>
              )}
              {visible.map((s) => {
                const checked = selected.has(s.screenId);
                const otherGroup = s.groupId && s.groupId !== group?.id ? groupNames.get(s.groupId) : undefined;
                return (
                  <li key={s.screenId} className="border-b border-border last:border-b-0">
                    <label className="flex cursor-pointer items-center gap-3 px-4 py-2.5 transition-colors hover:bg-muted">
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={() => toggle(s.screenId)}
                        className="peer sr-only"
                      />
                      <span
                        aria-hidden
                        className={`flex h-4 w-4 shrink-0 items-center justify-center rounded-[5px] border transition-colors peer-focus-visible:ring-2 peer-focus-visible:ring-ring ${
                          checked ? "border-primary bg-primary text-primary-foreground" : "border-input"
                        }`}
                      >
                        {checked && <Check className="h-3 w-3" strokeWidth={3} />}
                      </span>
                      <span className="min-w-0 flex-1 truncate text-sm">{s.screenName}</span>
                      {otherGroup && (
                        <span className="shrink-0 text-[11px] text-muted-foreground">
                          {checked ? `moves from ${otherGroup}` : `in ${otherGroup}`}
                        </span>
                      )}
                    </label>
                  </li>
                );
              })}
            </ul>
          </div>

          {error && <p className="text-xs text-destructive">{error}</p>}

          <button
            type="submit"
            disabled={!name.trim() || saving}
            className="w-full rounded-full bg-primary py-3 text-sm text-primary-foreground transition-opacity hover:opacity-90 disabled:opacity-50"
          >
            {saving ? "Saving…" : isEdit ? "Save group" : "Create group"}
          </button>
        </form>
      </div>
    </div>
  );
}
