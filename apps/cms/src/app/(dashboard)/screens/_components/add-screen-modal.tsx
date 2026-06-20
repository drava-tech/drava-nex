"use client";

import { useState } from "react";
import { X, Monitor } from "lucide-react";
import { addScreen } from "@/actions/screen-actions";

interface AddScreenModalProps {
  onClose: () => void;
  onAdded: () => void;
}

export function AddScreenModal({ onClose, onAdded }: AddScreenModalProps) {
  const [screenId, setScreenId] = useState("");
  const [screenName, setScreenName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const id = screenId.trim();
    const name = screenName.trim();
    if (!id || !name) { setError("Both fields are required."); return; }
    setSaving(true);
    setError(null);
    try {
      await addScreen(id, name);
      onAdded();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to add screen.");
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center" onClick={onClose}>
      <div className="absolute inset-0 bg-black/70 backdrop-blur-sm" />
      <div
        className="relative w-full max-w-sm bg-white dark:bg-zinc-950 border border-zinc-200 dark:border-zinc-800 rounded-3xl p-6"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between mb-6">
          <div className="flex items-center gap-2">
            <Monitor className="h-4 w-4 text-zinc-400" />
            <h2 className="text-sm font-bold text-zinc-900 dark:text-zinc-100 tracking-wide uppercase">
              Add Screen
            </h2>
          </div>
          <button
            onClick={onClose}
            className="p-2 rounded-xl bg-zinc-100 hover:bg-zinc-200 dark:bg-zinc-900 dark:hover:bg-zinc-800 text-zinc-500 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-200 transition-colors"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
          <div>
            <label className="text-[9px] font-bold text-zinc-500 tracking-[0.2em] uppercase block mb-2">
              Screen ID
            </label>
            <input
              type="text"
              value={screenId}
              onChange={(e) => setScreenId(e.target.value)}
              placeholder="e.g. screen-lobby"
              autoFocus
              className="w-full px-3 py-2.5 rounded-xl bg-zinc-100 dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 text-zinc-900 dark:text-zinc-100 text-sm placeholder:text-zinc-400 focus:outline-none focus:border-zinc-400 dark:focus:border-zinc-600 transition-colors"
            />
            <p className="mt-1.5 text-[10px] text-zinc-400 dark:text-zinc-600">
              Must match the ID the physical screen registers with.
            </p>
          </div>

          <div>
            <label className="text-[9px] font-bold text-zinc-500 tracking-[0.2em] uppercase block mb-2">
              Screen Name
            </label>
            <input
              type="text"
              value={screenName}
              onChange={(e) => setScreenName(e.target.value)}
              placeholder="e.g. Main Hall Display"
              className="w-full px-3 py-2.5 rounded-xl bg-zinc-100 dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 text-zinc-900 dark:text-zinc-100 text-sm placeholder:text-zinc-400 focus:outline-none focus:border-zinc-400 dark:focus:border-zinc-600 transition-colors"
            />
          </div>

          {error && (
            <p className="text-xs text-red-500 font-medium">{error}</p>
          )}

          <button
            type="submit"
            disabled={!screenId.trim() || !screenName.trim() || saving}
            className="w-full py-3 bg-zinc-900 hover:bg-zinc-800 dark:bg-zinc-100 dark:hover:bg-zinc-300 dark:text-zinc-900 disabled:opacity-50 text-zinc-100 rounded-xl text-xs font-bold tracking-wider uppercase transition-colors"
          >
            {saving ? "Adding..." : "Add Screen"}
          </button>
        </form>
      </div>
    </div>
  );
}
