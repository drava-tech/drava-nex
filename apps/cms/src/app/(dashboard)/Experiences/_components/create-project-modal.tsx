"use client";

import React, { useState, useTransition } from "react";
import { X, Loader2 } from "lucide-react";
import { createProject } from "@/actions/project-actions";

interface CreateProjectModalProps {
  onClose: () => void;
}

function deriveSlug(name: string): string {
  return name
    .toLowerCase()
    .replace(/\s+/g, "-")
    .replace(/[^a-z0-9-]/g, "")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
}

export function CreateProjectModal({ onClose }: CreateProjectModalProps) {
  const [name, setName] = useState("");
  const [slug, setSlug] = useState("");
  const [slugEdited, setSlugEdited] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const handleNameChange = (value: string) => {
    setName(value);
    if (!slugEdited) {
      setSlug(deriveSlug(value));
    }
  };

  const handleSlugChange = (value: string) => {
    setSlug(value);
    setSlugEdited(true);
  };

  const handleSubmit = (e: React.SyntheticEvent) => {
    e.preventDefault();
    setError(null);
    startTransition(async () => {
      const result = await createProject(name, slug);
      if (result.success) {
        onClose();
      } else {
        setError(result.error ?? "An unexpected error occurred.");
      }
    });
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-end md:items-center justify-center"
      onClick={onClose}
    >
      <div className="absolute inset-0 bg-black/60 dark:bg-black/70 backdrop-blur-sm" />

      <div
        className="relative w-full max-w-md bg-white border border-zinc-200 dark:bg-zinc-950 dark:border-zinc-800 rounded-t-3xl md:rounded-3xl p-6"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between mb-6">
          <div>
            <p className="text-[9px] font-bold text-zinc-400 dark:text-zinc-500 tracking-[0.25em] uppercase mb-0.5">
              new experience
            </p>
            <h2 className="text-base font-bold text-zinc-900 dark:text-zinc-100 tracking-wide">
              Create Experience
            </h2>
          </div>
          <button
            onClick={onClose}
            className="p-2 rounded-xl bg-zinc-100 hover:bg-zinc-200 dark:bg-zinc-900 dark:hover:bg-zinc-800 text-zinc-500 hover:text-zinc-800 dark:text-zinc-400 dark:hover:text-zinc-200 transition-colors"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
          <div className="flex flex-col gap-1.5">
            <label className="text-[10px] font-bold text-zinc-400 dark:text-zinc-500 uppercase tracking-[0.2em]">
              Project Name
            </label>
            <input
              type="text"
              value={name}
              onChange={(e) => handleNameChange(e.target.value)}
              placeholder="My New Project"
              required
              disabled={isPending}
              className="w-full bg-zinc-100 border border-zinc-300 focus:border-zinc-500 dark:bg-zinc-900 dark:border-zinc-800 dark:focus:border-zinc-600 rounded-xl px-4 py-3 text-sm text-zinc-900 dark:text-zinc-100 placeholder:text-zinc-400 dark:placeholder:text-zinc-600 outline-none transition-colors disabled:opacity-50"
            />
          </div>

          <div className="flex flex-col gap-1.5">
            <label className="text-[10px] font-bold text-zinc-400 dark:text-zinc-500 uppercase tracking-[0.2em]">
              Slug
            </label>
            <input
              type="text"
              value={slug}
              onChange={(e) => handleSlugChange(e.target.value)}
              placeholder="my-new-project"
              required
              disabled={isPending}
              className="w-full bg-zinc-100 border border-zinc-300 focus:border-zinc-500 dark:bg-zinc-900 dark:border-zinc-800 dark:focus:border-zinc-600 rounded-xl px-4 py-3 text-sm text-zinc-900 dark:text-zinc-100 placeholder:text-zinc-400 dark:placeholder:text-zinc-600 outline-none transition-colors font-mono disabled:opacity-50"
            />
            <p className="text-[10px] text-zinc-400 dark:text-zinc-600">
              URL: /projects/{slug || "…"}
            </p>
          </div>

          {error && (
            <p className="text-xs text-red-500 dark:text-red-400 font-medium -mt-1">{error}</p>
          )}

          <button
            type="submit"
            disabled={isPending || !name.trim() || !slug.trim()}
            className="w-full py-3 bg-zinc-900 text-zinc-100 hover:bg-zinc-800 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-white rounded-xl text-xs font-bold tracking-wider uppercase transition-all duration-200 disabled:opacity-40 disabled:cursor-not-allowed flex items-center justify-center gap-2 mt-1"
          >
            {isPending ? (
              <>
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                <span>Creating…</span>
              </>
            ) : (
              <span>Create Experience</span>
            )}
          </button>
        </form>
      </div>
    </div>
  );
}
